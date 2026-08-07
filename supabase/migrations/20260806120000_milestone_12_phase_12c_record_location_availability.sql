/*
 * Milestone 12 Phase 12C
 *
 * Resolve one generic Record-to-Location availability action without exposing
 * candidate Records or adding a second selector language. The existing
 * Record-location table, uniqueness constraint, trigger, and create/remove
 * RPCs remain the mutation boundary.
 */

create function private.graph_record_location_eligibility_v1(
  target_business_id uuid,
  target_object_definition_id uuid
)
  returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with reasons(reason_code) as (
    select 'tenant_not_visible'::text
    where not private.is_business_member($1)

    union all

    select 'inactive_object'::text
    from public.object_definitions as object_definition
    where object_definition.business_id = $1
      and object_definition.id = $2
      and not object_definition.is_active

    union all

    select 'preorder_order_object'::text
    where exists (
      select 1
      from public.preorder_experiences as preorder
      where preorder.business_id = $1
        and preorder.order_object_definition_id = $2
        and preorder.is_active
    )

    union all

    select 'preorder_order_item_object'::text
    where exists (
      select 1
      from public.preorder_experiences as preorder
      where preorder.business_id = $1
        and preorder.order_item_object_definition_id = $2
        and preorder.is_active
    )
  )
  select jsonb_build_object(
    'eligible', not exists (select 1 from reasons),
    'reason_codes', coalesce(
      (
        select jsonb_agg(reason_code order by reason_code)
        from reasons
      ),
      '[]'::jsonb
    )
  );
$$;

revoke all on function private.graph_record_location_eligibility_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.graph_record_location_eligibility_v1(uuid, uuid)
  to authenticated;

/*
 * The existing public RPC is also the manual mutation boundary. Keep the
 * preorder transaction's direct insert path unchanged, but prevent a generic
 * caller from independently linking an active preorder Order or Order Item.
 */
create or replace function public.create_record_location_link(
  expected_business_id uuid,
  target_record_id uuid,
  target_location_id uuid
)
returns public.record_location_links
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_object_definition_id uuid;
  target_eligibility jsonb;
  created_link public.record_location_links;
begin
  select record_value.object_definition_id
  into target_object_definition_id
  from public.records as record_value
  where record_value.business_id = expected_business_id
    and record_value.id = target_record_id;

  if not found then
    raise exception 'Location links require a same-tenant Record'
      using errcode = 'P0002';
  end if;

  target_eligibility := private.graph_record_location_eligibility_v1(
    expected_business_id,
    target_object_definition_id
  );
  if coalesce((target_eligibility ->> 'eligible')::boolean, false) = false then
    raise exception 'record_location_link_object_ineligible'
      using errcode = '23514';
  end if;

  insert into public.record_location_links (
    business_id,
    record_id,
    location_id
  )
  values (
    expected_business_id,
    target_record_id,
    target_location_id
  )
  returning * into created_link;

  return created_link;
end;
$$;

create function public.get_confirmed_record_location_link_state(
  expected_business_id uuid,
  expected_actor_id uuid,
  target_object_key text,
  requested_selector jsonb,
  target_location_id uuid,
  requested_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  current_object public.object_definitions;
  current_eligibility jsonb;
  current_location public.locations;
  resolved_selector jsonb;
  matching_record_ids uuid[];
  target_record public.records;
  current_link public.record_location_links;
  current_link_id uuid;
  destination_view_key text;
  pair_state text;
begin
  if current_actor_id is null then
    raise exception 'record_location_link_authentication_required'
      using errcode = '42501';
  end if;

  if current_actor_id is distinct from expected_actor_id then
    raise exception 'record_location_link_actor_context_mismatch'
      using errcode = '42501';
  end if;

  if not private.can_manage_tenant(expected_business_id) then
    raise exception 'record_location_link_owner_or_admin_required'
      using errcode = '42501';
  end if;

  if requested_action not in ('link', 'unlink') then
    raise exception 'record_location_link_action_invalid'
      using errcode = '22023';
  end if;

  select object_definition.*
  into current_object
  from public.object_definitions as object_definition
  where object_definition.business_id = expected_business_id
    and object_definition.key = target_object_key;
  if not found then
    raise exception 'record_location_link_object_not_found'
      using errcode = 'P0002';
  end if;

  current_eligibility := private.graph_record_location_eligibility_v1(
    expected_business_id,
    current_object.id
  );
  if coalesce((current_eligibility ->> 'eligible')::boolean, false) = false then
    return jsonb_build_object(
      'schema_version', 1,
      'state', 'ineligible',
      'object_key', current_object.key,
      'singular_label', current_object.singular_label,
      'reason_codes', current_eligibility -> 'reason_codes'
    );
  end if;

  select location.*
  into current_location
  from public.locations as location
  where location.business_id = expected_business_id
    and location.id = target_location_id;
  if not found then
    return jsonb_build_object(
      'schema_version', 1,
      'state', 'location_not_found',
      'object_key', current_object.key,
      'singular_label', current_object.singular_label,
      'location_id', target_location_id
    );
  end if;

  if requested_action = 'link' and not current_location.is_active then
    return jsonb_build_object(
      'schema_version', 1,
      'state', 'location_inactive',
      'object_key', current_object.key,
      'singular_label', current_object.singular_label,
      'location_id', current_location.id,
      'location_name', current_location.name
    );
  end if;

  /* Phase 12B owns selector validation and canonical matching semantics. */
  resolved_selector := private.graph_record_update_selector_v1(
    expected_business_id,
    current_object.id,
    requested_selector
  );

  select array_agg(record_value.id order by record_value.id)
  into matching_record_ids
  from (
    select record_value.id
    from public.records as record_value
    where record_value.business_id = expected_business_id
      and record_value.object_definition_id = current_object.id
      and record_value.record_status = 'active'::public.graph_record_status
      and private.graph_record_matches_update_selector_v1(
        record_value.data_json,
        resolved_selector
      )
    order by record_value.id
    limit 2
  ) as record_value;

  if coalesce(array_length(matching_record_ids, 1), 0) = 0 then
    return jsonb_build_object(
      'schema_version', 1,
      'state', 'not_found',
      'object_key', current_object.key,
      'singular_label', current_object.singular_label
    );
  end if;

  if array_length(matching_record_ids, 1) > 1 then
    return jsonb_build_object(
      'schema_version', 1,
      'state', 'ambiguous',
      'object_key', current_object.key,
      'singular_label', current_object.singular_label,
      'match_count_class', '2_or_more'
    );
  end if;

  select record_value.*
  into target_record
  from public.records as record_value
  where record_value.business_id = expected_business_id
    and record_value.id = matching_record_ids[1]
    and record_value.object_definition_id = current_object.id
    and record_value.record_status = 'active'::public.graph_record_status;
  if not found then
    return jsonb_build_object(
      'schema_version', 1,
      'state', 'not_found',
      'object_key', current_object.key,
      'singular_label', current_object.singular_label
    );
  end if;

  select link.*
  into current_link
  from public.record_location_links as link
  where link.business_id = expected_business_id
    and link.record_id = target_record.id
    and link.location_id = current_location.id;
  current_link_id := current_link.id;
  pair_state := case when current_link_id is not null then 'linked' else 'unlinked' end;

  if requested_action = 'link' and pair_state = 'linked' then
    return jsonb_build_object(
      'schema_version', 1,
      'state', 'already_linked',
      'object_key', current_object.key,
      'singular_label', current_object.singular_label,
      'location_name', current_location.name
    );
  end if;

  if requested_action = 'unlink' and pair_state = 'unlinked' then
    return jsonb_build_object(
      'schema_version', 1,
      'state', 'already_unlinked',
      'object_key', current_object.key,
      'singular_label', current_object.singular_label,
      'location_name', current_location.name
    );
  end if;

  select view_definition.key
  into destination_view_key
  from public.views as view_definition
  where view_definition.business_id = expected_business_id
    and view_definition.object_definition_id = current_object.id
    and view_definition.audience = 'internal'::public.experience_audience
    and view_definition.is_active
    and view_definition.view_type <> 'detail'::public.experience_view_type
  order by view_definition.key, view_definition.id
  limit 1;

  return jsonb_build_object(
    'schema_version', 1,
    'state', 'ready',
    'business_id', expected_business_id,
    'actor_id', current_actor_id,
    'object_definition_id', current_object.id,
    'object_key', current_object.key,
    'singular_label', current_object.singular_label,
    'target_record_id', target_record.id,
    'target_location_id', current_location.id,
    'location_name', current_location.name,
    'location_is_active', current_location.is_active,
    'action', requested_action,
    'expected_pair_state', pair_state,
    'selector', resolved_selector,
    'destination_view_key', destination_view_key
  );
end;
$$;

/* The same eligibility rule protects generic unlink as well as generic link. */
create or replace function public.remove_record_location_link(
  expected_business_id uuid,
  target_record_location_link_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_object_definition_id uuid;
  target_eligibility jsonb;
  removed_count integer;
begin
  select record_value.object_definition_id
  into target_object_definition_id
  from public.record_location_links as link
  join public.records as record_value
    on record_value.business_id = link.business_id
   and record_value.id = link.record_id
  where link.business_id = expected_business_id
    and link.id = target_record_location_link_id;

  if not found then
    return false;
  end if;

  target_eligibility := private.graph_record_location_eligibility_v1(
    expected_business_id,
    target_object_definition_id
  );
  if coalesce((target_eligibility ->> 'eligible')::boolean, false) = false then
    raise exception 'record_location_link_object_ineligible'
      using errcode = '23514';
  end if;

  delete from public.record_location_links
  where business_id = expected_business_id
    and id = target_record_location_link_id;

  get diagnostics removed_count = row_count;
  return removed_count = 1;
end;
$$;

revoke all on function public.get_confirmed_record_location_link_state(
  uuid, uuid, text, jsonb, uuid, text
) from public, anon, service_role;
grant execute on function public.get_confirmed_record_location_link_state(
  uuid, uuid, text, jsonb, uuid, text
) to authenticated;

comment on function public.get_confirmed_record_location_link_state(
  uuid, uuid, text, jsonb, uuid, text
) is
  'Resolves one exact active generic Record and Location pair for an authenticated Owner/Admin without exposing candidate Records or link rows.';
