-- Journey 3 J3-I4: one complete bounded update for an already-published Site.
-- The previous direct Page guard remains the authority for every earlier action.

alter function private.assert_direct_page_action_shape_v1(
  text, jsonb, jsonb, jsonb
) rename to assert_direct_page_action_shape_pre_j3_i4_v1;

create function private.assert_direct_page_action_shape_v1(
  action_kind text,
  base_snapshot jsonb,
  candidate_snapshot jsonb,
  operations jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  operation jsonb;
  base_page jsonb;
  candidate_page jsonb;
  target_key text;
begin
  if action_kind <> 'publish_page_changes' then
    if action_kind in ('rename_page', 'save_page_layout')
      and jsonb_typeof(operations) = 'array'
      and jsonb_array_length(operations) = 1
    then
      operation := operations -> 0;
      target_key := operation ->> 'key';
      select value into base_page
      from jsonb_array_elements(base_snapshot -> 'pages') as value
      where value ->> 'key' = target_key;
      if base_page ->> 'audience' = 'public'
        and base_page ->> 'status' = 'published'
      then
        raise exception 'direct_page_action_shape_invalid'
          using errcode = '22023';
      end if;
    end if;
    perform private.assert_direct_page_action_shape_pre_j3_i4_v1(
      action_kind,
      base_snapshot,
      candidate_snapshot,
      operations
    );
    return;
  end if;

  if jsonb_typeof(operations) <> 'array'
    or jsonb_array_length(operations) <> 1
  then
    raise exception 'direct_page_action_shape_invalid'
      using errcode = '22023';
  end if;

  perform private.assert_configuration_operations_v1(operations);

  operation := operations -> 0;
  if operation ->> 'op' <> 'set_page' then
    raise exception 'direct_page_action_shape_invalid'
      using errcode = '22023';
  end if;

  target_key := operation ->> 'key';
  select value into base_page
  from jsonb_array_elements(base_snapshot -> 'pages') as value
  where value ->> 'key' = target_key;
  select value into candidate_page
  from jsonb_array_elements(candidate_snapshot -> 'pages') as value
  where value ->> 'key' = target_key;

  if base_page is null
    or candidate_page is null
    or not (base_page ->> 'is_active')::boolean
    or base_page ->> 'audience' <> 'public'
    or base_page ->> 'status' <> 'published'
    or candidate_page ->> 'id' <> base_page ->> 'id'
    or candidate_page ->> 'key' <> base_page ->> 'key'
    or candidate_page ->> 'slug' <> base_page ->> 'slug'
    or candidate_page ->> 'audience' <> 'public'
    or candidate_page ->> 'status' <> 'published'
    or candidate_page ->> 'is_active' <> base_page ->> 'is_active'
    or operation ->> 'slug' <> base_page ->> 'slug'
    or operation ->> 'audience' <> 'public'
    or operation ->> 'status' <> 'published'
    or operation ->> 'is_active' <> base_page ->> 'is_active'
    or candidate_page ->> 'title' <> operation ->> 'title'
    or candidate_page -> 'layout_json' <> operation -> 'layout_json'
    or (candidate_page - 'title' - 'layout_json') <>
      (base_page - 'title' - 'layout_json')
    or (
      candidate_page ->> 'title' = base_page ->> 'title'
      and private.direct_page_layouts_equal_v1(
        base_page -> 'layout_json',
        candidate_page -> 'layout_json'
      )
    )
    or not private.direct_page_snapshot_collections_unchanged_v1(
      base_snapshot,
      candidate_snapshot
    )
    or exists (
      select 1
      from jsonb_array_elements(base_snapshot -> 'pages') as existing_page
      where existing_page ->> 'key' <> target_key
        and not exists (
          select 1
          from jsonb_array_elements(candidate_snapshot -> 'pages') as next_page
          where next_page = existing_page
        )
    )
    or exists (
      select 1
      from jsonb_array_elements(candidate_snapshot -> 'pages') as next_page
      where next_page ->> 'key' <> target_key
        and not exists (
          select 1
          from jsonb_array_elements(base_snapshot -> 'pages') as existing_page
          where existing_page = next_page
        )
    )
  then
    raise exception 'direct_page_action_shape_invalid'
      using errcode = '22023';
  end if;

  -- Stable capability atoms retain their exact identity and configuration.
  if exists (
    select 1
    from jsonb_array_elements(base_page -> 'layout_json' -> 'blocks') as block
    where block ->> 'type' not in ('heading', 'text', 'divider')
      and block ? 'id'
      and not exists (
        select 1
        from jsonb_array_elements(
          candidate_page -> 'layout_json' -> 'blocks'
        ) as candidate_block
        where candidate_block = block
      )
  ) then
    raise exception 'direct_page_action_shape_invalid'
      using errcode = '22023';
  end if;

  -- Locked atoms form the same multiset after ignoring IDs. This also protects
  -- legacy atoms that predate stable IDs while allowing the bounded action to
  -- assign their first stable presentation identity.
  if exists (
    select 1
    from (
      select block - 'id' as signature, count(*) as amount
      from jsonb_array_elements(base_page -> 'layout_json' -> 'blocks') as block
      where block ->> 'type' not in ('heading', 'text', 'divider')
      group by block - 'id'
    ) as base_locked
    full join (
      select block - 'id' as signature, count(*) as amount
      from jsonb_array_elements(
        candidate_page -> 'layout_json' -> 'blocks'
      ) as block
      where block ->> 'type' not in ('heading', 'text', 'divider')
      group by block - 'id'
    ) as candidate_locked using (signature)
    where base_locked.amount is distinct from candidate_locked.amount
  ) then
    raise exception 'direct_page_action_shape_invalid'
      using errcode = '22023';
  end if;
end;
$$;

comment on function private.assert_direct_page_action_shape_v1(
  text, jsonb, jsonb, jsonb
) is
  'Validates existing bounded direct Page actions and one J3-I4 complete published Site update; public identity and lifecycle are preserved, content atoms are bounded, and capability atoms may only move.';

revoke all on function private.assert_direct_page_action_shape_pre_j3_i4_v1(
  text, jsonb, jsonb, jsonb
) from public;
revoke all on function private.assert_direct_page_action_shape_v1(
  text, jsonb, jsonb, jsonb
) from public;

create or replace function public.apply_direct_page_configuration_change(
  expected_business_id uuid,
  expected_actor_id uuid,
  expected_base_version_id uuid,
  expected_head_revision bigint,
  requested_action_kind text,
  requested_operations jsonb
)
returns public.configuration_change_sets
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  proposed public.configuration_change_sets;
  validated public.configuration_change_sets;
  applied public.configuration_change_sets;
  base_version public.configuration_versions;
begin
  if current_actor_id is null then
    raise exception 'configuration_authentication_required'
      using errcode = '42501';
  end if;
  if current_actor_id is distinct from expected_actor_id then
    raise exception 'configuration_actor_context_mismatch'
      using errcode = '42501';
  end if;
  if not private.can_manage_tenant(expected_business_id) then
    raise exception 'configuration_owner_or_admin_required'
      using errcode = '42501';
  end if;
  if requested_action_kind not in (
    'create_page',
    'rename_page',
    'save_page_layout',
    'publish_page_changes'
  ) then
    raise exception 'direct_page_action_shape_invalid'
      using errcode = '22023';
  end if;

  proposed := public.propose_configuration_change(
    expected_business_id,
    expected_actor_id,
    expected_base_version_id,
    expected_head_revision,
    left('Page Workspace: ' || requested_action_kind, 120),
    'direct_page_workspace:' || requested_action_kind,
    requested_operations
  );

  select version.* into base_version
  from public.configuration_versions as version
  where version.business_id = expected_business_id
    and version.id = proposed.base_version_id;
  if not found then
    raise exception 'direct_page_action_shape_invalid'
      using errcode = '22023';
  end if;

  perform private.assert_direct_page_action_shape_v1(
    requested_action_kind,
    base_version.snapshot_json,
    proposed.candidate_snapshot_json,
    proposed.operations_json
  );

  validated := public.validate_configuration_change(
    expected_business_id,
    expected_actor_id,
    proposed.id
  );
  if validated.status <> 'validated'
    or validated.validation_result_json ->> 'outcome' <> 'valid'
  then
    raise exception 'direct_configuration_change_incompatible'
      using errcode = 'P0001';
  end if;

  applied := public.apply_configuration_change(
    expected_business_id,
    expected_actor_id,
    proposed.id
  );
  if applied.status <> 'applied' then
    raise exception 'direct_configuration_change_incompatible'
      using errcode = 'P0001';
  end if;
  return applied;
end;
$$;

revoke all on function public.apply_direct_page_configuration_change(
  uuid, uuid, uuid, bigint, text, jsonb
) from public, anon, service_role;
grant execute on function public.apply_direct_page_configuration_change(
  uuid, uuid, uuid, bigint, text, jsonb
) to authenticated;

comment on function public.apply_direct_page_configuration_change(
  uuid, uuid, uuid, bigint, text, jsonb
) is
  'Atomically applies bounded direct Page actions, including one complete J3-I4 published Site update, through the existing configuration lifecycle.';
