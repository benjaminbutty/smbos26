/*
 * Milestone 12 Phase 12B
 *
 * This migration adds the narrow, generic confirmed Record-update boundary.
 * The ordinary graph update RPC and its validation trigger remain unchanged.
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

create function private.graph_record_update_schema_v1(
  target_business_id uuid,
  target_object_definition_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'object', jsonb_build_object(
      'id', object_definition.id,
      'key', object_definition.key,
      'singular_label', object_definition.singular_label,
      'plural_label', object_definition.plural_label,
      'description', object_definition.description,
      'kind', object_definition.kind,
      'semantic_type', object_definition.semantic_type,
      'icon', object_definition.icon,
      'is_active', object_definition.is_active
    ),
    'fields', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', field_definition.id,
            'key', field_definition.key,
            'label', field_definition.label,
            'field_type', field_definition.field_type,
            'required', field_definition.required,
            'default_value', field_definition.default_value,
            'settings_json', field_definition.settings_json,
            'position', field_definition.position,
            'is_active', field_definition.is_active
          )
          order by field_definition.position,
            field_definition.key,
            field_definition.id
        )
        from public.field_definitions as field_definition
        where field_definition.business_id = $1
          and field_definition.object_definition_id = $2
      ),
      '[]'::jsonb
    ),
    'trusted_preorder_roles', coalesce(
      (
        select jsonb_agg(
          role_metadata.value
          order by role_metadata.preorder_key, role_metadata.role
        )
        from (
          select
            preorder.key as preorder_key,
            'customer'::text as role,
            jsonb_build_object(
              'preorder_key', preorder.key,
              'role', 'customer',
              'object_definition_id', preorder.customer_object_definition_id
            ) as value
          from public.preorder_experiences as preorder
          where preorder.business_id = $1
            and preorder.customer_object_definition_id = $2
            and preorder.is_active

          union all

          select
            preorder.key,
            'product'::text,
            jsonb_build_object(
              'preorder_key', preorder.key,
              'role', 'product',
              'object_definition_id', preorder.product_object_definition_id
            )
          from public.preorder_experiences as preorder
          where preorder.business_id = $1
            and preorder.product_object_definition_id = $2
            and preorder.is_active

          union all

          select
            preorder.key,
            'order'::text,
            jsonb_build_object(
              'preorder_key', preorder.key,
              'role', 'order',
              'object_definition_id', preorder.order_object_definition_id
            )
          from public.preorder_experiences as preorder
          where preorder.business_id = $1
            and preorder.order_object_definition_id = $2
            and preorder.is_active

          union all

          select
            preorder.key,
            'order_item'::text,
            jsonb_build_object(
              'preorder_key', preorder.key,
              'role', 'order_item',
              'object_definition_id', preorder.order_item_object_definition_id
            )
          from public.preorder_experiences as preorder
          where preorder.business_id = $1
            and preorder.order_item_object_definition_id = $2
            and preorder.is_active
        ) as role_metadata
      ),
      '[]'::jsonb
    ),
    'update_eligibility', private.graph_record_update_eligibility_v1(
      $1,
      $2
    )
  )
  from public.object_definitions as object_definition
  where object_definition.business_id = $1
    and object_definition.id = $2;
$$;

create function private.graph_record_update_schema_checksum_v1(
  target_business_id uuid,
  target_object_definition_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        private.graph_record_update_schema_v1($1, $2)::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create function private.graph_record_update_selector_text_v1(value text)
returns text
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select lower(btrim(normalize(value, NFKC)) collate "und-x-icu");
$$;

create function private.canonicalize_graph_record_update_selector_v1(
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
  requested_clause jsonb;
  canonical_clause jsonb;
  canonical_clauses jsonb := '[]'::jsonb;
  field_definition public.field_definitions;
  field_key text;
  requested_field_type text;
  value_key text;
  raw_value jsonb;
  raw_text text;
  canonical_option text;
  option_match_count integer;
begin
  if jsonb_typeof(requested_selector) <> 'array'
    or jsonb_array_length(requested_selector) not between 1 and 3
  then
    raise exception 'record_update_selector_invalid'
      using errcode = '22023';
  end if;

  for requested_clause in
    select value
    from jsonb_array_elements(requested_selector)
  loop
    if jsonb_typeof(requested_clause) <> 'object' then
      raise exception 'record_update_selector_invalid'
        using errcode = '22023';
    end if;

    field_key := requested_clause ->> 'field_key';
    requested_field_type := requested_clause ->> 'field_type';
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
      and field_definition_value.object_definition_id
        = target_object_definition_id
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
      or (select count(*) from jsonb_object_keys(requested_clause)) <> 3
      or exists (
        select 1
        from jsonb_object_keys(requested_clause) as property(key)
        where property.key not in ('field_key', 'field_type', value_key)
      )
      or not (requested_clause ? value_key)
    then
      raise exception 'record_update_selector_invalid'
        using errcode = '22023';
    end if;

    raw_value := requested_clause -> value_key;
    if raw_value = 'null'::jsonb then
      raise exception 'record_update_selector_invalid'
        using errcode = '22023';
    end if;

    case requested_field_type
      when 'short_text' then
        if jsonb_typeof(raw_value) <> 'string' then
          raise exception 'record_update_selector_invalid'
            using errcode = '22023';
        end if;
        raw_text := raw_value #>> '{}';
        if char_length(raw_text) < 1 or char_length(raw_text) > 500 then
          raise exception 'record_update_selector_invalid'
            using errcode = '22023';
        end if;
        raw_text := private.graph_record_update_selector_text_v1(raw_text);
        if raw_text = '' then
          raise exception 'record_update_selector_invalid'
            using errcode = '22023';
        end if;
        canonical_clause := jsonb_build_object(
          'field_key', field_key,
          'field_type', requested_field_type,
          'string_value', raw_text
        );
      when 'email' then
        if not private.graph_field_value_is_valid(
          raw_value,
          field_definition.field_type,
          field_definition.settings_json
        ) or char_length(raw_value #>> '{}') > 320 then
          raise exception 'record_update_selector_invalid'
            using errcode = '22023';
        end if;
        canonical_clause := jsonb_build_object(
          'field_key', field_key,
          'field_type', requested_field_type,
          'string_value', raw_value #>> '{}'
        );
      when 'phone' then
        if jsonb_typeof(raw_value) <> 'string' then
          raise exception 'record_update_selector_invalid'
            using errcode = '22023';
        end if;
        raw_text := raw_value #>> '{}';
        if raw_text <> btrim(raw_text)
          or char_length(raw_text) < 1
          or char_length(raw_text) > 120
        then
          raise exception 'record_update_selector_invalid'
            using errcode = '22023';
        end if;
        canonical_clause := jsonb_build_object(
          'field_key', field_key,
          'field_type', requested_field_type,
          'string_value', raw_text
        );
      when 'url' then
        if not private.graph_field_value_is_valid(
          raw_value,
          field_definition.field_type,
          field_definition.settings_json
        ) or char_length(raw_value #>> '{}') > 2048 then
          raise exception 'record_update_selector_invalid'
            using errcode = '22023';
        end if;
        canonical_clause := jsonb_build_object(
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
        canonical_clause := jsonb_build_object(
          'field_key', field_key,
          'field_type', requested_field_type,
          'number_value', raw_value
        );
      when 'boolean' then
        if jsonb_typeof(raw_value) <> 'boolean' then
          raise exception 'record_update_selector_invalid'
            using errcode = '22023';
        end if;
        canonical_clause := jsonb_build_object(
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
        canonical_clause := jsonb_build_object(
          'field_key', field_key,
          'field_type', requested_field_type,
          'date_value', raw_value #>> '{}'
        );
      when 'datetime' then
        if raw_value #>> '{}' !~ '(Z|[+-][0-9]{2}:?[0-9]{2})$'
          or not private.graph_field_value_is_valid(
            raw_value,
            field_definition.field_type,
            field_definition.settings_json
          )
        then
          raise exception 'record_update_selector_invalid'
            using errcode = '22023';
        end if;
        canonical_clause := jsonb_build_object(
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
        where private.graph_record_update_selector_text_v1(
          option_value #>> '{}'
        ) = private.graph_record_update_selector_text_v1(raw_value #>> '{}')
        ;
        if option_match_count is distinct from 1 then
          raise exception 'record_update_selector_invalid'
            using errcode = '22023';
        end if;
        canonical_clause := jsonb_build_object(
          'field_key', field_key,
          'field_type', requested_field_type,
          'option_value', canonical_option
        );
    end case;

    canonical_clauses := canonical_clauses || jsonb_build_array(
      canonical_clause
    );
  end loop;

  if (
    select count(*) from jsonb_array_elements(canonical_clauses)
  ) <> (
    select count(distinct value ->> 'field_key')
    from jsonb_array_elements(canonical_clauses)
  ) then
    raise exception 'record_update_selector_invalid'
      using errcode = '22023';
  end if;

  return jsonb_build_object(
    'schema_version', 1,
    'object_definition_id', target_object_definition_id,
    'clauses', coalesce(
      (
        select jsonb_agg(value order by value ->> 'field_key')
        from jsonb_array_elements(canonical_clauses)
      ),
      '[]'::jsonb
    )
  );
end;
$$;

create function private.graph_record_update_selector_checksum_v1(
  target_object_definition_id uuid,
  canonical_selector jsonb
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'schema_version', 1,
          'object_definition_id', $1,
          'clauses', $2 -> 'clauses'
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create function private.graph_record_matches_update_selector_v1(
  record_data_json jsonb,
  canonical_selector jsonb
)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  clause jsonb;
  field_key text;
  field_type text;
begin
  for clause in
    select value
    from jsonb_array_elements(canonical_selector -> 'clauses')
  loop
    field_key := clause ->> 'field_key';
    field_type := clause ->> 'field_type';
    if not (record_data_json ? field_key) then
      return false;
    end if;

    case field_type
      when 'short_text' then
        if private.graph_record_update_selector_text_v1(
          record_data_json ->> field_key
        ) is distinct from clause ->> 'string_value' then
          return false;
        end if;
      when 'email', 'phone', 'url' then
        if (record_data_json -> field_key)
            is distinct from (clause -> 'string_value') then
          return false;
        end if;
      when 'number', 'currency' then
        if (record_data_json -> field_key)
            is distinct from (clause -> 'number_value') then
          return false;
        end if;
      when 'boolean' then
        if (record_data_json -> field_key)
            is distinct from (clause -> 'boolean_value') then
          return false;
        end if;
      when 'date' then
        if (record_data_json ->> field_key)
            is distinct from (clause ->> 'date_value') then
          return false;
        end if;
      when 'datetime' then
        if (record_data_json ->> field_key)
            is distinct from (clause ->> 'datetime_value') then
          return false;
        end if;
      when 'select', 'status' then
        if (record_data_json ->> field_key)
            is distinct from (clause ->> 'option_value') then
          return false;
        end if;
      else
        return false;
    end case;
  end loop;
  return true;
end;
$$;

create function private.graph_record_update_target_state_v1(
  target_record public.records
)
returns jsonb
language sql
immutable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'id', target_record.id,
    'business_id', target_record.business_id,
    'object_definition_id', target_record.object_definition_id,
    'record_status', target_record.record_status,
    'data_json', target_record.data_json,
    'created_by', target_record.created_by,
    'created_at', target_record.created_at,
    'updated_at', target_record.updated_at
  );
$$;

create function private.graph_record_update_target_checksum_v1(
  target_record public.records
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        private.graph_record_update_target_state_v1($1)::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function private.graph_record_update_eligibility_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.graph_record_update_schema_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.graph_record_update_schema_checksum_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.graph_record_update_selector_text_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function private.canonicalize_graph_record_update_selector_v1(
  uuid, uuid, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.graph_record_update_selector_checksum_v1(
  uuid, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.graph_record_matches_update_selector_v1(
  jsonb, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.graph_record_update_target_state_v1(public.records)
  from public, anon, authenticated, service_role;
revoke all on function private.graph_record_update_target_checksum_v1(public.records)
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
  current_business public.businesses;
  current_head public.business_configuration_heads;
  current_object public.object_definitions;
  current_eligibility jsonb;
  canonical_selector jsonb;
  selector_digest text;
  target_record public.records;
  matching_record_ids uuid[];
  update_fields jsonb;
  selector_current_values jsonb;
  current_update_values jsonb;
  internal_views jsonb;
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

  select business.*
  into current_business
  from public.businesses as business
  where business.id = expected_business_id;
  if not found then
    raise exception 'record_update_business_not_found'
      using errcode = 'P0002';
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

  begin
    canonical_selector := private.canonicalize_graph_record_update_selector_v1(
      expected_business_id,
      current_object.id,
      requested_selector
    );
  exception
    when others then
      if sqlerrm like 'record_update_selector_invalid%' then
        raise;
      end if;
      raise exception 'record_update_selector_invalid'
        using errcode = '22023';
  end;

  selector_digest := private.graph_record_update_selector_checksum_v1(
    current_object.id,
    canonical_selector
  );

  if requested_update_field_keys is null
    or coalesce(array_length(requested_update_field_keys, 1), 0) not between 1 and 5
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
      or field_key = 'record_status'
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
        canonical_selector
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
    and record_value.id = matching_record_ids[1];
  if not found then
    return jsonb_build_object(
      'schema_version', 1,
      'state', 'not_found',
      'object_key', current_object.key,
      'singular_label', current_object.singular_label
    );
  end if;

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
        'label', field_definition.label,
        'settings_json', field_definition.settings_json,
        'value', target_record.data_json -> field_definition.key
      ) order by canonical_clause ->> 'field_key'
    ),
    '[]'::jsonb
  )
  into selector_current_values
  from jsonb_array_elements(canonical_selector -> 'clauses')
    as clauses(canonical_clause)
  join public.field_definitions as field_definition
    on field_definition.business_id = expected_business_id
    and field_definition.object_definition_id = current_object.id
    and field_definition.key = canonical_clause ->> 'field_key';

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

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'key', view_definition.key,
        'name', view_definition.name,
        'view_type', view_definition.view_type,
        'object_key', current_object.key
      ) order by view_definition.key, view_definition.id
    ),
    '[]'::jsonb
  )
  into internal_views
  from public.views as view_definition
  where view_definition.business_id = expected_business_id
    and view_definition.object_definition_id = current_object.id
    and view_definition.audience = 'internal'::public.experience_audience
    and view_definition.is_active
    and view_definition.view_type <> 'detail'::public.experience_view_type;

  return jsonb_build_object(
    'schema_version', 1,
    'state', 'ready',
    'business_id', current_business.id,
    'actor_id', current_actor_id,
    'base_version_id', current_head.active_version_id,
    'head_revision', current_head.head_revision,
    'object_definition_id', current_object.id,
    'object_key', current_object.key,
    'singular_label', current_object.singular_label,
    'object_schema_digest', private.graph_record_update_schema_checksum_v1(
      expected_business_id,
      current_object.id
    ),
    'canonical_selector', canonical_selector,
    'selector_digest', selector_digest,
    'target_record_id', target_record.id,
    'target_record_digest', private.graph_record_update_target_checksum_v1(
      target_record
    ),
    'selector_current_values', selector_current_values,
    'update_fields', update_fields,
    'current_update_values', current_update_values,
    'internal_views', internal_views
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
  expected_object_schema_digest text,
  requested_selector jsonb,
  expected_selector_digest text,
  expected_record_id uuid,
  expected_record_digest text,
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
  locked_object public.object_definitions;
  target_record public.records;
  current_eligibility jsonb;
  canonical_selector jsonb;
  selector_digest text;
  current_schema_digest text;
  current_target_digest text;
  matching_record_ids uuid[];
  selector_request jsonb;
  updated_record public.records;
  field_definition public.field_definitions;
  patch_field_key text;
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

  /* Head share -> selector read -> Record update -> Object update. */
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
    and object_definition.key = target_object_key;
  if not found then
    raise exception 'record_update_object_not_found'
      using errcode = 'P0002';
  end if;
  if current_object.id is distinct from expected_object_definition_id then
    raise exception 'record_update_schema_changed'
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

  current_schema_digest := private.graph_record_update_schema_checksum_v1(
    expected_business_id,
    current_object.id
  );
  if current_schema_digest is distinct from expected_object_schema_digest then
    raise exception 'record_update_schema_changed'
      using errcode = 'P0001';
  end if;

  selector_request := requested_selector;
  if jsonb_typeof(requested_selector) = 'object'
    and requested_selector ? 'clauses'
  then
    if requested_selector ->> 'schema_version' <> '1'
      or requested_selector ->> 'object_definition_id'
        is distinct from current_object.id::text
      or (select count(*) from jsonb_object_keys(requested_selector)) <> 3
      or not (requested_selector ? 'schema_version')
      or not (requested_selector ? 'object_definition_id')
    then
      raise exception 'record_update_selector_changed'
        using errcode = 'P0001';
    end if;
    selector_request := requested_selector -> 'clauses';
  end if;

  begin
    canonical_selector := private.canonicalize_graph_record_update_selector_v1(
      expected_business_id,
      current_object.id,
      selector_request
    );
  exception
    when others then
      if sqlerrm like 'record_update_selector_invalid%' then
        raise;
      end if;
      raise exception 'record_update_selector_invalid'
        using errcode = '22023';
  end;

  selector_digest := private.graph_record_update_selector_checksum_v1(
    current_object.id,
    canonical_selector
  );
  if selector_digest is distinct from expected_selector_digest then
    raise exception 'record_update_selector_changed'
      using errcode = 'P0001';
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
        canonical_selector
      )
    order by record_value.id
    limit 2
  ) as record_value;

  if coalesce(array_length(matching_record_ids, 1), 0) = 0 then
    raise exception 'record_update_selector_not_found'
      using errcode = 'P0002';
  end if;
  if array_length(matching_record_ids, 1) > 1 then
    raise exception 'record_update_selector_ambiguous'
      using errcode = 'P0003';
  end if;
  if matching_record_ids[1] is distinct from expected_record_id then
    raise exception 'record_update_target_changed'
      using errcode = 'P0001';
  end if;

  select record_value.*
  into target_record
  from public.records as record_value
  where record_value.business_id = expected_business_id
    and record_value.id = expected_record_id
  for update;
  if not found then
    raise exception 'record_update_target_changed'
      using errcode = 'P0001';
  end if;
  if target_record.record_status <> 'active'::public.graph_record_status then
    raise exception 'record_update_target_archived'
      using errcode = 'P0001';
  end if;

  select object_definition.*
  into locked_object
  from public.object_definitions as object_definition
  where object_definition.business_id = expected_business_id
    and object_definition.id = current_object.id
  for update;
  if not found then
    raise exception 'record_update_object_not_found'
      using errcode = 'P0002';
  end if;

  current_eligibility := private.graph_record_update_eligibility_v1(
    expected_business_id,
    locked_object.id
  );
  if coalesce((current_eligibility ->> 'eligible')::boolean, false) = false then
    raise exception 'record_update_object_ineligible'
      using errcode = '23514';
  end if;

  current_schema_digest := private.graph_record_update_schema_checksum_v1(
    expected_business_id,
    locked_object.id
  );
  if current_schema_digest is distinct from expected_object_schema_digest then
    raise exception 'record_update_schema_changed'
      using errcode = 'P0001';
  end if;

  select array_agg(record_value.id order by record_value.id)
  into matching_record_ids
  from (
    select record_value.id
    from public.records as record_value
    where record_value.business_id = expected_business_id
      and record_value.object_definition_id = locked_object.id
      and record_value.record_status = 'active'::public.graph_record_status
      and private.graph_record_matches_update_selector_v1(
        record_value.data_json,
        canonical_selector
      )
    order by record_value.id
    limit 2
  ) as record_value;
  if coalesce(array_length(matching_record_ids, 1), 0) = 0 then
    raise exception 'record_update_selector_not_found'
      using errcode = 'P0002';
  end if;
  if array_length(matching_record_ids, 1) > 1 then
    raise exception 'record_update_selector_ambiguous'
      using errcode = 'P0003';
  end if;
  if matching_record_ids[1] is distinct from expected_record_id then
    raise exception 'record_update_target_changed'
      using errcode = 'P0001';
  end if;

  select record_value.*
  into target_record
  from public.records as record_value
  where record_value.business_id = expected_business_id
    and record_value.id = expected_record_id
  for update;
  if not found then
    raise exception 'record_update_target_changed'
      using errcode = 'P0001';
  end if;
  if target_record.record_status <> 'active'::public.graph_record_status then
    raise exception 'record_update_target_archived'
      using errcode = 'P0001';
  end if;

  current_target_digest := private.graph_record_update_target_checksum_v1(
    target_record
  );
  if current_target_digest is distinct from expected_record_digest then
    raise exception 'record_update_target_changed'
      using errcode = 'P0001';
  end if;

  if jsonb_typeof(requested_data_patch) <> 'object'
    or (
      select count(*) from jsonb_object_keys(requested_data_patch)
    ) not between 1 and 5
  then
    raise exception 'record_update_patch_invalid'
      using errcode = '22023';
  end if;

  for patch_field_key in
    select key
    from jsonb_object_keys(requested_data_patch) as patch_fields(key)
  loop
    if patch_field_key = 'record_status'
      or patch_field_key !~ '^[a-z][a-z0-9_]*$'
      or char_length(patch_field_key) > 80
    then
      raise exception 'record_update_patch_invalid'
        using errcode = '22023';
    end if;

    if requested_data_patch -> patch_field_key = 'null'::jsonb then
      raise exception 'record_update_patch_invalid'
        using errcode = '22023';
    end if;

    select field_definition_value.*
    into field_definition
    from public.field_definitions as field_definition_value
    where field_definition_value.business_id = expected_business_id
      and field_definition_value.object_definition_id = locked_object.id
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

  /* The existing generic RPC and records_validate remain the final authority. */
  updated_record := public.update_graph_record(
    expected_business_id,
    expected_record_id,
    requested_data_patch,
    null::public.graph_record_status
  );

  if updated_record.business_id is distinct from expected_business_id
    or updated_record.object_definition_id is distinct from locked_object.id
    or updated_record.id is distinct from expected_record_id
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
  uuid, uuid, uuid, bigint, text, uuid, text, jsonb, text, uuid, text, jsonb
) from public, anon, service_role;
grant execute on function public.update_confirmed_graph_record(
  uuid, uuid, uuid, bigint, text, uuid, text, jsonb, text, uuid, text, jsonb
) to authenticated;

comment on function public.get_confirmed_graph_record_update_state(
  uuid, uuid, text, jsonb, text[]
) is
  'Returns only bounded exact-target Record-update state after authenticated Owner/Admin checks; no candidate Records are disclosed.';

comment on function public.update_confirmed_graph_record(
  uuid, uuid, uuid, bigint, text, uuid, text, jsonb, text, uuid, text, jsonb
) is
  'Atomically updates one exact generic Record after head, selector, schema and target currentness checks; Record locking precedes Object locking and the existing graph update trigger remains authoritative.';
