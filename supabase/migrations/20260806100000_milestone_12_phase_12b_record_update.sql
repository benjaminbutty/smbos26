/*
 * Milestone 12 Phase 12B
 *
 * This migration adds the narrow, generic confirmed Record-update boundary.
 * Builder resolves one exact active Record in PostgreSQL, shows the current
 * values, and commits only a signed server-selected target after confirmation.
 * The ordinary graph update RPC and its validation/updated_at triggers remain
 * unchanged.
 */

create function private.graph_record_update_eligibility_v1(
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
    select 'inactive_object'::text
    from public.object_definitions as object_definition
    where object_definition.business_id = $1
      and object_definition.id = $2
      and not object_definition.is_active

    union all

    select 'preorder_customer_object'::text
    where exists (
      select 1
      from public.preorder_experiences as preorder
      where preorder.business_id = $1
        and preorder.customer_object_definition_id = $2
        and preorder.is_active
    )

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

    union all

    select 'no_selector_fields'::text
    where not exists (
      select 1
      from public.field_definitions as field_definition
      where field_definition.business_id = $1
        and field_definition.object_definition_id = $2
        and field_definition.is_active
        and field_definition.field_type in (
          'short_text'::public.graph_field_type,
          'email'::public.graph_field_type,
          'phone'::public.graph_field_type,
          'url'::public.graph_field_type,
          'number'::public.graph_field_type,
          'currency'::public.graph_field_type,
          'boolean'::public.graph_field_type,
          'date'::public.graph_field_type,
          'datetime'::public.graph_field_type,
          'select'::public.graph_field_type,
          'status'::public.graph_field_type
        )
    )

    union all

    select 'no_update_fields'::text
    where not exists (
      select 1
      from public.field_definitions as field_definition
      where field_definition.business_id = $1
        and field_definition.object_definition_id = $2
        and field_definition.is_active
        and field_definition.field_type <> 'file'::public.graph_field_type
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

/* PostgreSQL owns selector validation and the configured-option spelling. */
create function private.graph_record_update_selector_v1(
  target_business_id uuid,
  target_object_definition_id uuid,
  requested_selector jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  field_definition public.field_definitions;
  field_key text;
  requested_field_type text;
  value_key text;
  raw_value jsonb;
  raw_text text;
  canonical_option text;
  option_match_count integer;
begin
  if jsonb_typeof(requested_selector) <> 'object'
    or (select count(*) from jsonb_object_keys(requested_selector)) <> 3
  then
    raise exception 'record_update_selector_invalid'
      using errcode = '22023';
  end if;

  field_key := requested_selector ->> 'field_key';
  requested_field_type := requested_selector ->> 'field_type';
  if field_key is null
    or field_key !~ '^[a-z][a-z0-9_]*$'
    or char_length(field_key) > 80
    or requested_field_type is null
  then
    raise exception 'record_update_selector_invalid'
      using errcode = '22023';
  end if;

  select field_definition_value.*
  into field_definition
  from public.field_definitions as field_definition_value
  where field_definition_value.business_id = target_business_id
    and field_definition_value.object_definition_id = target_object_definition_id
    and field_definition_value.key = field_key;
  if not found or not field_definition.is_active then
    raise exception 'record_update_selector_invalid'
      using errcode = '22023';
  end if;

  if requested_field_type <> field_definition.field_type::text
    or requested_field_type not in (
      'short_text', 'email', 'phone', 'url', 'number', 'currency',
      'boolean', 'date', 'datetime', 'select', 'status'
    )
  then
    raise exception 'record_update_selector_invalid'
      using errcode = '22023';
  end if;

  value_key := case requested_field_type
    when 'short_text' then 'string_value'
    when 'email' then 'string_value'
    when 'phone' then 'string_value'
    when 'url' then 'string_value'
    when 'number' then 'number_value'
    when 'currency' then 'number_value'
    when 'boolean' then 'boolean_value'
    when 'date' then 'date_value'
    when 'datetime' then 'datetime_value'
    when 'select' then 'option_value'
    when 'status' then 'option_value'
    else null
  end;

  if value_key is null
    or exists (
      select 1
      from jsonb_object_keys(requested_selector) as property(key)
      where property.key not in ('field_key', 'field_type', value_key)
    )
    or not (requested_selector ? value_key)
  then
    raise exception 'record_update_selector_invalid'
      using errcode = '22023';
  end if;

  raw_value := requested_selector -> value_key;
  if raw_value = 'null'::jsonb then
    raise exception 'record_update_selector_invalid'
      using errcode = '22023';
  end if;

  case requested_field_type
    when 'short_text' then
      if jsonb_typeof(raw_value) <> 'string'
        or char_length(raw_value #>> '{}') not between 1 and 500
      then
        raise exception 'record_update_selector_invalid'
          using errcode = '22023';
      end if;
      raw_text := lower(
        btrim(normalize(raw_value #>> '{}', NFKC)) collate "und-x-icu"
      );
      if raw_text = '' then
        raise exception 'record_update_selector_invalid'
          using errcode = '22023';
      end if;
      return jsonb_build_object(
        'field_key', field_key,
        'field_type', requested_field_type,
        'string_value', raw_text
      );
    when 'email', 'url' then
      if not private.graph_field_value_is_valid(
        raw_value,
        field_definition.field_type,
        field_definition.settings_json
      ) then
        raise exception 'record_update_selector_invalid'
          using errcode = '22023';
      end if;
      return jsonb_build_object(
        'field_key', field_key,
        'field_type', requested_field_type,
        'string_value', raw_value #>> '{}'
      );
    when 'phone' then
      if jsonb_typeof(raw_value) <> 'string'
        or raw_value #>> '{}' <> btrim(raw_value #>> '{}')
        or not private.graph_field_value_is_valid(
          raw_value,
          field_definition.field_type,
          field_definition.settings_json
        )
      then
        raise exception 'record_update_selector_invalid'
          using errcode = '22023';
      end if;
      return jsonb_build_object(
        'field_key', field_key,
        'field_type', requested_field_type,
        'string_value', raw_value #>> '{}'
      );
    when 'number', 'currency' then
      if not private.graph_field_value_is_valid(
        raw_value,
        field_definition.field_type,
        field_definition.settings_json
      ) then
        raise exception 'record_update_selector_invalid'
          using errcode = '22023';
      end if;
      return jsonb_build_object(
        'field_key', field_key,
        'field_type', requested_field_type,
        'number_value', raw_value
      );
    when 'boolean' then
      if jsonb_typeof(raw_value) <> 'boolean' then
        raise exception 'record_update_selector_invalid'
          using errcode = '22023';
      end if;
      return jsonb_build_object(
        'field_key', field_key,
        'field_type', requested_field_type,
        'boolean_value', raw_value
      );
    when 'date' then
      if not private.graph_field_value_is_valid(
        raw_value,
        field_definition.field_type,
        field_definition.settings_json
      ) then
        raise exception 'record_update_selector_invalid'
          using errcode = '22023';
      end if;
      return jsonb_build_object(
        'field_key', field_key,
        'field_type', requested_field_type,
        'date_value', raw_value #>> '{}'
      );
    when 'datetime' then
      if not private.graph_field_value_is_valid(
        raw_value,
        field_definition.field_type,
        field_definition.settings_json
      ) then
        raise exception 'record_update_selector_invalid'
          using errcode = '22023';
      end if;
      return jsonb_build_object(
        'field_key', field_key,
        'field_type', requested_field_type,
        'datetime_value', raw_value #>> '{}'
      );
    when 'select', 'status' then
      if jsonb_typeof(raw_value) <> 'string' then
        raise exception 'record_update_selector_invalid'
          using errcode = '22023';
      end if;
      select min(option_value #>> '{}'), count(*)
      into canonical_option, option_match_count
      from jsonb_array_elements(field_definition.settings_json -> 'options')
        as option_value
      where lower(
        btrim(normalize(option_value #>> '{}', NFKC)) collate "und-x-icu"
      ) = lower(
        btrim(normalize(raw_value #>> '{}', NFKC)) collate "und-x-icu"
      );
      if option_match_count is distinct from 1 then
        raise exception 'record_update_selector_invalid'
          using errcode = '22023';
      end if;
      return jsonb_build_object(
        'field_key', field_key,
        'field_type', requested_field_type,
        'option_value', canonical_option
      );
  end case;

  raise exception 'record_update_selector_invalid'
    using errcode = '22023';
end;
$$;

create function private.graph_record_matches_update_selector_v1(
  record_data_json jsonb,
  resolved_selector jsonb
)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  field_key text := resolved_selector ->> 'field_key';
  field_type text := resolved_selector ->> 'field_type';
begin
  if not (record_data_json ? field_key) then
    return false;
  end if;

  case field_type
    when 'short_text' then
      return lower(
        btrim(normalize(record_data_json ->> field_key, NFKC)) collate "und-x-icu"
      ) = resolved_selector ->> 'string_value';
    when 'email', 'phone', 'url' then
      return (record_data_json -> field_key)
        is not distinct from (resolved_selector -> 'string_value');
    when 'number', 'currency' then
      return (record_data_json -> field_key)
        is not distinct from (resolved_selector -> 'number_value');
    when 'boolean' then
      return (record_data_json -> field_key)
        is not distinct from (resolved_selector -> 'boolean_value');
    when 'date' then
      return (record_data_json ->> field_key)
        is not distinct from (resolved_selector ->> 'date_value');
    when 'datetime' then
      return (record_data_json ->> field_key)
        is not distinct from (resolved_selector ->> 'datetime_value');
    when 'select', 'status' then
      return lower(
        btrim(normalize(record_data_json ->> field_key, NFKC)) collate "und-x-icu"
      ) = lower(
        btrim(normalize(resolved_selector ->> 'option_value', NFKC)) collate "und-x-icu"
      );
    else
      return false;
  end case;
end;
$$;

revoke all on function private.graph_record_update_eligibility_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.graph_record_update_selector_v1(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.graph_record_matches_update_selector_v1(jsonb, jsonb)
  from public, anon, authenticated, service_role;

create function public.get_confirmed_graph_record_update_state(
  expected_business_id uuid,
  expected_actor_id uuid,
  target_object_key text,
  requested_selector jsonb,
  requested_update_field_keys text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  current_head public.business_configuration_heads;
  current_object public.object_definitions;
  current_eligibility jsonb;
  resolved_selector jsonb;
  target_record public.records;
  matching_record_ids uuid[];
  selector_value jsonb;
  update_fields jsonb;
  current_update_values jsonb;
  destination_view_key text;
begin
  if current_actor_id is null then
    raise exception 'record_update_authentication_required'
      using errcode = '42501';
  end if;

  if current_actor_id is distinct from expected_actor_id then
    raise exception 'record_update_actor_context_mismatch'
      using errcode = '42501';
  end if;

  if not private.can_manage_tenant(expected_business_id) then
    raise exception 'record_update_owner_or_admin_required'
      using errcode = '42501';
  end if;

  select head.*
  into current_head
  from public.business_configuration_heads as head
  where head.business_id = expected_business_id;
  if not found then
    raise exception 'record_update_configuration_changed'
      using errcode = 'P0001';
  end if;

  select object_definition.*
  into current_object
  from public.object_definitions as object_definition
  where object_definition.business_id = expected_business_id
    and object_definition.key = target_object_key;
  if not found then
    raise exception 'record_update_object_not_found'
      using errcode = 'P0002';
  end if;

  current_eligibility := private.graph_record_update_eligibility_v1(
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

  resolved_selector := private.graph_record_update_selector_v1(
    expected_business_id,
    current_object.id,
    requested_selector
  );

  if requested_update_field_keys is null
    or coalesce(array_length(requested_update_field_keys, 1), 0) not between 1 and 3
    or (
      select count(*) from unnest(requested_update_field_keys)
    ) <> (
      select count(distinct field_key)
      from unnest(requested_update_field_keys) as fields(field_key)
    )
  then
    raise exception 'record_update_patch_invalid'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(requested_update_field_keys) as fields(field_key)
    where field_key is null
      or field_key !~ '^[a-z][a-z0-9_]*$'
      or char_length(field_key) > 80
      or not exists (
        select 1
        from public.field_definitions as field_definition
        where field_definition.business_id = expected_business_id
          and field_definition.object_definition_id = current_object.id
          and field_definition.key = fields.field_key
          and field_definition.is_active
          and field_definition.field_type <> 'file'::public.graph_field_type
      )
  ) then
    raise exception 'record_update_patch_invalid'
      using errcode = '22023';
  end if;

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
    and record_value.object_definition_id = current_object.id;
  if not found then
    return jsonb_build_object(
      'schema_version', 1,
      'state', 'not_found',
      'object_key', current_object.key,
      'singular_label', current_object.singular_label
    );
  end if;

  select jsonb_build_object(
    'field_key', field_definition.key,
    'field_type', field_definition.field_type,
    'label', field_definition.label,
    'settings_json', field_definition.settings_json,
    'value', target_record.data_json -> field_definition.key
  )
  into selector_value
  from public.field_definitions as field_definition
  where field_definition.business_id = expected_business_id
    and field_definition.object_definition_id = current_object.id
    and field_definition.key = resolved_selector ->> 'field_key';

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'key', field_definition.key,
        'label', field_definition.label,
        'field_type', field_definition.field_type,
        'required', field_definition.required,
        'settings_json', field_definition.settings_json,
        'position', field_definition.position,
        'is_active', field_definition.is_active
      ) order by requested_fields.ordinality
    ),
    '[]'::jsonb
  )
  into update_fields
  from unnest(requested_update_field_keys) with ordinality
    as requested_fields(field_key, ordinality)
  join public.field_definitions as field_definition
    on field_definition.business_id = expected_business_id
    and field_definition.object_definition_id = current_object.id
    and field_definition.key = requested_fields.field_key;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'field_key', field_definition.key,
        'field_type', field_definition.field_type,
        'value', target_record.data_json -> field_definition.key
      ) order by requested_fields.ordinality
    ),
    '[]'::jsonb
  )
  into current_update_values
  from unnest(requested_update_field_keys) with ordinality
    as requested_fields(field_key, ordinality)
  join public.field_definitions as field_definition
    on field_definition.business_id = expected_business_id
    and field_definition.object_definition_id = current_object.id
    and field_definition.key = requested_fields.field_key;

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
    'base_version_id', current_head.active_version_id,
    'head_revision', current_head.head_revision,
    'object_definition_id', current_object.id,
    'object_key', current_object.key,
    'singular_label', current_object.singular_label,
    'target_record_id', target_record.id,
    'expected_updated_at', target_record.updated_at,
    'selector', selector_value,
    'update_fields', update_fields,
    'current_update_values', current_update_values,
    'destination_view_key', destination_view_key
  );
end;
$$;

create function public.update_confirmed_graph_record(
  expected_business_id uuid,
  expected_actor_id uuid,
  expected_base_version_id uuid,
  expected_head_revision bigint,
  target_object_key text,
  expected_object_definition_id uuid,
  target_record_id uuid,
  expected_record_updated_at timestamptz,
  requested_data_patch jsonb
)
returns public.records
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  current_head public.business_configuration_heads;
  current_object public.object_definitions;
  target_record public.records;
  current_eligibility jsonb;
  updated_record public.records;
  patch_field_key text;
  field_definition public.field_definitions;
begin
  if current_actor_id is null then
    raise exception 'record_update_authentication_required'
      using errcode = '42501';
  end if;

  if current_actor_id is distinct from expected_actor_id then
    raise exception 'record_update_actor_context_mismatch'
      using errcode = '42501';
  end if;

  if not private.can_manage_tenant(expected_business_id) then
    raise exception 'record_update_owner_or_admin_required'
      using errcode = '42501';
  end if;

  /* Head share -> target Record lock -> Object share through records_validate. */
  select head.*
  into current_head
  from public.business_configuration_heads as head
  where head.business_id = expected_business_id
  for share;
  if not found
    or current_head.active_version_id is distinct from expected_base_version_id
    or current_head.head_revision is distinct from expected_head_revision
  then
    raise exception 'record_update_configuration_changed'
      using errcode = 'P0001';
  end if;

  select object_definition.*
  into current_object
  from public.object_definitions as object_definition
  where object_definition.business_id = expected_business_id
    and object_definition.id = expected_object_definition_id
    and object_definition.key = target_object_key;
  if not found then
    raise exception 'record_update_target_changed'
      using errcode = 'P0001';
  end if;

  current_eligibility := private.graph_record_update_eligibility_v1(
    expected_business_id,
    current_object.id
  );
  if coalesce((current_eligibility ->> 'eligible')::boolean, false) = false then
    raise exception 'record_update_object_ineligible'
      using errcode = '23514';
  end if;

  select record_value.*
  into target_record
  from public.records as record_value
  where record_value.business_id = expected_business_id
    and record_value.id = target_record_id
    and record_value.object_definition_id = current_object.id
  for update;
  if not found then
    raise exception 'record_update_target_changed'
      using errcode = 'P0001';
  end if;

  if target_record.record_status <> 'active'::public.graph_record_status then
    raise exception 'record_update_target_archived'
      using errcode = 'P0001';
  end if;

  if target_record.updated_at is distinct from expected_record_updated_at then
    raise exception 'record_update_target_changed'
      using errcode = 'P0001';
  end if;

  if jsonb_typeof(requested_data_patch) <> 'object'
    or (
      select count(*) from jsonb_object_keys(requested_data_patch)
    ) not between 1 and 3
  then
    raise exception 'record_update_patch_invalid'
      using errcode = '22023';
  end if;

  for patch_field_key in
    select key
    from jsonb_object_keys(requested_data_patch) as patch_fields(key)
  loop
    if patch_field_key !~ '^[a-z][a-z0-9_]*$'
      or requested_data_patch -> patch_field_key = 'null'::jsonb
    then
      raise exception 'record_update_patch_invalid'
        using errcode = '22023';
    end if;

    select field_definition_value.*
    into field_definition
    from public.field_definitions as field_definition_value
    where field_definition_value.business_id = expected_business_id
      and field_definition_value.object_definition_id = current_object.id
      and field_definition_value.key = patch_field_key;
    if not found
      or not field_definition.is_active
      or field_definition.field_type = 'file'::public.graph_field_type
      or not private.graph_field_value_is_valid(
        requested_data_patch -> patch_field_key,
        field_definition.field_type,
        field_definition.settings_json
      )
    then
      raise exception 'record_update_patch_invalid'
        using errcode = '22023';
    end if;
  end loop;

  if (target_record.data_json || requested_data_patch)
      is not distinct from target_record.data_json
  then
    raise exception 'record_update_no_change'
      using errcode = 'P0001';
  end if;

  /* The target is already locked; the existing validation and timestamp
     triggers remain the final graph integrity authority. */
  update public.records as record_value
  set data_json = target_record.data_json || requested_data_patch
  where record_value.business_id = expected_business_id
    and record_value.id = target_record_id
  returning record_value.* into updated_record;

  if not found
    or updated_record.business_id is distinct from expected_business_id
    or updated_record.object_definition_id is distinct from current_object.id
    or updated_record.id is distinct from target_record_id
    or updated_record.record_status <> 'active'::public.graph_record_status
  then
    raise exception 'record_update_failed'
      using errcode = 'P0001';
  end if;

  return updated_record;
end;
$$;

revoke all on function public.get_confirmed_graph_record_update_state(
  uuid, uuid, text, jsonb, text[]
) from public, anon, service_role;
grant execute on function public.get_confirmed_graph_record_update_state(
  uuid, uuid, text, jsonb, text[]
) to authenticated;

revoke all on function public.update_confirmed_graph_record(
  uuid, uuid, uuid, bigint, text, uuid, uuid, timestamptz, jsonb
) from public, anon, service_role;
grant execute on function public.update_confirmed_graph_record(
  uuid, uuid, uuid, bigint, text, uuid, uuid, timestamptz, jsonb
) to authenticated;

comment on function public.get_confirmed_graph_record_update_state(
  uuid, uuid, text, jsonb, text[]
) is
  'Resolves one exact active generic Record for an authenticated Owner/Admin without exposing candidate rows or complete Record data.';

comment on function public.update_confirmed_graph_record(
  uuid, uuid, uuid, bigint, text, uuid, uuid, timestamptz, jsonb
) is
  'Atomically updates one signed server-selected generic Record after configuration and updated_at currentness checks; no selector re-query is performed.';
