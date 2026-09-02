-- Lenni Table Workbench v0 (Stage 1)
--
-- Extends the existing generic Table/View contract. It deliberately adds no
-- business-specific table, copied Record value, or second configuration lane.

create or replace function private.assert_valid_view_config_shape(
  requested_view_type public.experience_view_type,
  config jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  width_key text;
  width_value jsonb;
  column_value jsonb;
  column_key text;
  field_keys jsonb := '[]'::jsonb;
  visible_width_keys text[] := array[]::text[];
  seen_columns text[] := array[]::text[];
begin
  if jsonb_typeof(config) <> 'object' then
    raise exception 'View configuration must be a JSON object'
      using errcode = '22023';
  end if;

  if requested_view_type = 'table' then
    if config ? 'schema_version' then
      if not private.experience_json_has_only_keys(
        config,
        array[
          'schema_version', 'role', 'columns', 'fields', 'title_field',
          'column_widths', 'create_form_key', 'edit_form_key',
          'include_archived', 'filters', 'filter_match', 'sorts', 'group'
        ]
      )
        or config ->> 'schema_version' <> '2'
        or config ->> 'role' not in ('primary', 'saved')
        or jsonb_typeof(config -> 'columns') <> 'array'
        or jsonb_array_length(config -> 'columns') not between 1 and 50
        or not private.experience_key_is_valid(config ->> 'title_field')
        or not (config ? 'filters')
        or not (config ? 'filter_match')
        or not (config ? 'sorts')
        or not (config ? 'group')
      then
        raise exception 'Invalid canonical Table View configuration'
          using errcode = '22023';
      end if;

      for column_value in
        select value from jsonb_array_elements(config -> 'columns')
      loop
        if column_value ->> 'kind' = 'field' then
          if not private.experience_json_has_only_keys(
            column_value, array['kind', 'field_key']
          ) or not private.experience_key_is_valid(column_value ->> 'field_key')
          then
            raise exception 'Invalid canonical Table field column'
              using errcode = '22023';
          end if;
          column_key := 'field:' || (column_value ->> 'field_key');
          field_keys := field_keys || jsonb_build_array(column_value ->> 'field_key');
          visible_width_keys := array_append(
            visible_width_keys, column_value ->> 'field_key'
          );
        elsif column_value ->> 'kind' = 'connection' then
          if not private.experience_json_has_only_keys(
            column_value, array['kind', 'relationship_key', 'direction', 'label']
          )
            or not private.experience_key_is_valid(column_value ->> 'relationship_key')
            or column_value ->> 'direction' not in ('source', 'target')
            or (
              column_value ? 'label' and (
                jsonb_typeof(column_value -> 'label') <> 'string'
                or not private.experience_string_is_valid(column_value ->> 'label', 120)
              )
            )
          then
            raise exception 'Invalid canonical Table connection column'
              using errcode = '22023';
          end if;
          column_key := 'connection:' || (column_value ->> 'relationship_key') ||
            ':' || (column_value ->> 'direction');
          visible_width_keys := array_append(visible_width_keys, column_key);
        elsif column_value ->> 'kind' = 'connected_field' then
          if not private.experience_json_has_only_keys(
            column_value,
            array['kind', 'relationship_key', 'direction', 'target_field_key', 'label']
          )
            or not private.experience_key_is_valid(column_value ->> 'relationship_key')
            or column_value ->> 'direction' not in ('source', 'target')
            or not private.experience_key_is_valid(column_value ->> 'target_field_key')
            or (
              column_value ? 'label' and (
                jsonb_typeof(column_value -> 'label') <> 'string'
                or not private.experience_string_is_valid(column_value ->> 'label', 120)
              )
            )
          then
            raise exception 'Invalid canonical Table connected property column'
              using errcode = '22023';
          end if;
          column_key := 'connected_field:' || (column_value ->> 'relationship_key') ||
            ':' || (column_value ->> 'direction') || ':' ||
            (column_value ->> 'target_field_key');
          visible_width_keys := array_append(visible_width_keys, column_key);
        else
          raise exception 'Invalid canonical Table column kind'
            using errcode = '22023';
        end if;
        if column_key = any(seen_columns) then
          raise exception 'Canonical Table columns must be unique'
            using errcode = '22023';
        end if;
        seen_columns := array_append(seen_columns, column_key);
      end loop;

      if config ? 'fields' then
        if not private.experience_string_array_is_valid(config -> 'fields', false)
          or config -> 'fields' <> field_keys
        then
          raise exception 'Canonical Table fields do not match field columns'
            using errcode = '22023';
        end if;
      end if;
      if not field_keys @> jsonb_build_array(config ->> 'title_field') then
        raise exception 'Canonical Table title property must be a field column'
          using errcode = '22023';
      end if;
      perform private.assert_table_view_query_shape_v1(config);
    else
      if not private.experience_json_has_only_keys(
        config,
        array[
          'fields', 'title_field', 'column_widths', 'create_form_key',
          'edit_form_key', 'include_archived'
        ]
      ) or not private.experience_string_array_is_valid(config -> 'fields', false)
      then
        raise exception 'Invalid Table View configuration'
          using errcode = '22023';
      end if;
    end if;

    if config ? 'column_widths'
      and jsonb_typeof(config -> 'column_widths') <> 'object'
    then
      raise exception 'Table column_widths must be an object'
        using errcode = '22023';
    end if;
    if config ? 'column_widths' then
      for width_key, width_value in
        select key, value from jsonb_each(config -> 'column_widths')
      loop
        if not (
          case
            when config ? 'schema_version' then width_key = any(visible_width_keys)
            else exists (
              select 1
              from jsonb_array_elements_text(config -> 'fields') as visible_field
              where visible_field = width_key
            )
          end
        ) then
          raise exception 'Table column_widths may only target visible columns'
            using errcode = '22023';
        end if;
        if jsonb_typeof(width_value) <> 'number'
          or (width_value #>> '{}') !~ '^[0-9]+$'
          or (width_value #>> '{}')::integer not between 128 and 640
        then
          raise exception 'Table column widths must be integers from 128 to 640'
            using errcode = '22023';
        end if;
      end loop;
    end if;
  elsif requested_view_type = 'list' then
    if not private.experience_json_has_only_keys(
      config,
      array['primary_field', 'secondary_fields', 'create_form_key', 'edit_form_key', 'include_archived']
    ) or not private.experience_key_is_valid(config ->> 'primary_field')
      or not private.experience_string_array_is_valid(config -> 'secondary_fields', true)
    then
      raise exception 'Invalid List View configuration' using errcode = '22023';
    end if;
  elsif requested_view_type = 'cards' then
    if not private.experience_json_has_only_keys(
      config,
      array['title_field', 'subtitle_field', 'image_field', 'supporting_fields', 'create_form_key', 'edit_form_key', 'include_archived']
    ) or not private.experience_key_is_valid(config ->> 'title_field')
      or not private.experience_string_array_is_valid(config -> 'supporting_fields', true)
    then
      raise exception 'Invalid Cards View configuration' using errcode = '22023';
    end if;
  elsif requested_view_type = 'detail' then
    if not private.experience_json_has_only_keys(
      config, array['fields', 'title_field', 'edit_form_key', 'include_archived']
    ) or not private.experience_string_array_is_valid(config -> 'fields', false)
    then
      raise exception 'Invalid Detail View configuration' using errcode = '22023';
    end if;
  else
    raise exception 'Unsupported View type' using errcode = '22023';
  end if;

  if config ? 'title_field' and (
    jsonb_typeof(config -> 'title_field') <> 'string'
    or not private.experience_key_is_valid(config ->> 'title_field')
  ) then
    raise exception 'Invalid View title field' using errcode = '22023';
  end if;
  if config ? 'subtitle_field' and (
    jsonb_typeof(config -> 'subtitle_field') <> 'string'
    or not private.experience_key_is_valid(config ->> 'subtitle_field')
  ) then
    raise exception 'Invalid View subtitle field' using errcode = '22023';
  end if;
  if config ? 'image_field' and (
    jsonb_typeof(config -> 'image_field') <> 'string'
    or not private.experience_key_is_valid(config ->> 'image_field')
  ) then
    raise exception 'Invalid View image field' using errcode = '22023';
  end if;
  if config ? 'create_form_key' and (
    jsonb_typeof(config -> 'create_form_key') <> 'string'
    or not private.experience_key_is_valid(config ->> 'create_form_key')
  ) then
    raise exception 'Invalid create Form reference' using errcode = '22023';
  end if;
  if config ? 'edit_form_key' and (
    jsonb_typeof(config -> 'edit_form_key') <> 'string'
    or not private.experience_key_is_valid(config ->> 'edit_form_key')
  ) then
    raise exception 'Invalid edit Form reference' using errcode = '22023';
  end if;
  if config ? 'include_archived'
    and jsonb_typeof(config -> 'include_archived') <> 'boolean'
  then
    raise exception 'View include_archived must be a boolean' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.bulk_update_table_records(
  expected_business_id uuid,
  requested_view_key text,
  requested_field_key text,
  requested_value jsonb,
  requested_records jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_view public.views;
  selected jsonb;
  target_record public.records;
  record_id uuid;
  expected_updated_at timestamptz;
  proposed_data jsonb;
  result_ids jsonb := '[]'::jsonb;
begin
  if not private.is_business_member(expected_business_id) then
    raise exception 'table_bulk_membership_required' using errcode = '42501';
  end if;
  if not private.experience_key_is_valid(requested_view_key)
    or not private.experience_key_is_valid(requested_field_key)
    or jsonb_typeof(requested_records) <> 'array'
    or jsonb_array_length(requested_records) not between 1 and 100
  then
    raise exception 'table_bulk_input_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(requested_records) as item
    where jsonb_typeof(item.value) <> 'object'
      or not private.experience_json_has_only_keys(
        item.value, array['record_id', 'expected_updated_at']
      )
      or (item.value ->> 'record_id') is null
      or (item.value ->> 'expected_updated_at') is null
  ) then
    raise exception 'table_bulk_selection_invalid' using errcode = '22023';
  end if;
  if (
    select count(*)
    from (
      select (item.value ->> 'record_id')::uuid as record_id
      from jsonb_array_elements(requested_records) as item
    ) as selected_ids
  ) <> (
    select count(distinct (item.value ->> 'record_id')::uuid)
    from jsonb_array_elements(requested_records) as item
  ) then
    raise exception 'table_bulk_selection_invalid' using errcode = '22023';
  end if;

  select view_definition.* into target_view
  from public.views as view_definition
  where view_definition.business_id = expected_business_id
    and view_definition.key = requested_view_key
    and view_definition.view_type = 'table'
    and view_definition.audience = 'internal'
    and view_definition.is_active;
  if not found then
    raise exception 'table_bulk_view_not_found' using errcode = 'P0002';
  end if;
  if requested_field_key = target_view.config_json ->> 'title_field'
    or not (
      exists (
        select 1
        from jsonb_array_elements_text(
          coalesce(target_view.config_json -> 'fields', '[]'::jsonb)
        ) as visible_field
        where visible_field = requested_field_key
      )
      or exists (
        select 1
        from jsonb_array_elements(
          coalesce(target_view.config_json -> 'columns', '[]'::jsonb)
        ) as visible_column
        where visible_column ->> 'kind' = 'field'
          and visible_column ->> 'field_key' = requested_field_key
      )
    )
  then
    raise exception 'table_bulk_field_invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.field_definitions as field_definition
    where field_definition.business_id = expected_business_id
      and field_definition.object_definition_id = target_view.object_definition_id
      and field_definition.key = requested_field_key
      and field_definition.is_active
      and field_definition.field_type in (
        'short_text', 'long_text', 'number', 'currency', 'boolean', 'date',
        'datetime', 'email', 'phone', 'url', 'select', 'status', 'multi_select'
      )
  ) then
    raise exception 'table_bulk_field_invalid' using errcode = '22023';
  end if;

  -- Lock in UUID order. Every validation failure is raised inside this one
  -- transaction, so no selected Record can be partially updated.
  for selected in
    select item.value
    from jsonb_array_elements(requested_records) as item
    order by (item.value ->> 'record_id')::uuid
  loop
    record_id := (selected ->> 'record_id')::uuid;
    expected_updated_at := (selected ->> 'expected_updated_at')::timestamptz;
    select record_value.* into target_record
    from public.records as record_value
    where record_value.business_id = expected_business_id
      and record_value.object_definition_id = target_view.object_definition_id
      and record_value.id = record_id
      and record_value.record_status = 'active'
    for update;
    if not found then
      raise exception 'table_bulk_record_not_found' using errcode = 'P0002';
    end if;
    if target_record.updated_at is distinct from expected_updated_at then
      raise exception 'table_bulk_record_stale' using errcode = 'P0001';
    end if;
    proposed_data := target_record.data_json ||
      jsonb_build_object(requested_field_key, requested_value);
    perform private.assert_valid_graph_record_data(
      expected_business_id,
      target_view.object_definition_id,
      proposed_data
    );
    update public.records as record_value
    set data_json = proposed_data
    where record_value.business_id = expected_business_id
      and record_value.id = record_id;
    result_ids := result_ids || jsonb_build_array(record_id);
  end loop;

  return jsonb_build_object('record_ids', result_ids);
end;
$$;

revoke all on function public.bulk_update_table_records(uuid, text, text, jsonb, jsonb)
  from public, anon, service_role;
grant execute on function public.bulk_update_table_records(uuid, text, text, jsonb, jsonb)
  to authenticated;
comment on function public.bulk_update_table_records(uuid, text, text, jsonb, jsonb) is
  'Bounded atomic direct-Field update for up to 100 loaded Table Records.';

create or replace function private.workspace_connected_field_values(
  target_business_id uuid,
  current_record public.records,
  config jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  column_value jsonb;
  target_value text;
  result jsonb := '{}'::jsonb;
  property_key text;
begin
  for column_value in
    select value
    from jsonb_array_elements(coalesce(config -> 'columns', '[]'::jsonb)) as value
    where value ->> 'kind' = 'connected_field'
  loop
    property_key := 'connected_field:' || (column_value ->> 'relationship_key') ||
      ':' || (column_value ->> 'direction') || ':' ||
      (column_value ->> 'target_field_key');
    select target_record.data_json ->> (column_value ->> 'target_field_key')
    into target_value
    from public.record_relationships as edge
    join public.relationship_definitions as relationship_definition
      on relationship_definition.business_id = target_business_id
     and relationship_definition.id = edge.relationship_definition_id
     and relationship_definition.key = column_value ->> 'relationship_key'
     and relationship_definition.is_active
    join public.records as target_record
      on target_record.business_id = target_business_id
     and target_record.record_status = 'active'
     and (
       (column_value ->> 'direction' = 'source' and target_record.id = edge.target_record_id)
       or (column_value ->> 'direction' = 'target' and target_record.id = edge.source_record_id)
     )
    where edge.business_id = target_business_id
      and (
        (column_value ->> 'direction' = 'source' and edge.source_record_id = current_record.id)
        or (column_value ->> 'direction' = 'target' and edge.target_record_id = current_record.id)
      )
    order by target_record.id
    limit 1;
    result := result || jsonb_build_object(property_key, target_value);
  end loop;
  return result;
end;
$$;

-- A projection remains a value, not copied data. The matching one-hop
-- Connection is returned solely so the Record context can open its source.
create or replace function private.workspace_connected_field_connection_values(
  target_business_id uuid,
  current_record public.records,
  config jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  relationship_key text;
  connection_direction text;
  connection_key text;
  labels jsonb;
  result jsonb := '{}'::jsonb;
begin
  for relationship_key, connection_direction in
    select distinct value ->> 'relationship_key', value ->> 'direction'
    from jsonb_array_elements(coalesce(config -> 'columns', '[]'::jsonb)) as value
    where value ->> 'kind' = 'connected_field'
  loop
    connection_key := 'connection:' || relationship_key || ':' || connection_direction;
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', target_record.id,
          'label', private.workspace_record_label(target_business_id, target_record)
        ) order by target_record.id
      ),
      '[]'::jsonb
    )
    into labels
    from public.record_relationships as edge
    join public.relationship_definitions as relationship_definition
      on relationship_definition.business_id = target_business_id
     and relationship_definition.id = edge.relationship_definition_id
     and relationship_definition.key = relationship_key
     and relationship_definition.is_active
    join public.records as target_record
      on target_record.business_id = target_business_id
     and target_record.record_status = 'active'
     and (
       (connection_direction = 'source' and target_record.id = edge.target_record_id)
       or (connection_direction = 'target' and target_record.id = edge.source_record_id)
     )
    where edge.business_id = target_business_id
      and (
        (connection_direction = 'source' and edge.source_record_id = current_record.id)
        or (connection_direction = 'target' and edge.target_record_id = current_record.id)
      );
    result := result || jsonb_build_object(connection_key, labels);
  end loop;
  return result;
end;
$$;

create or replace function private.workspace_record_matches_search(
  target_business_id uuid,
  current_record public.records,
  config jsonb,
  requested_search text
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  column_value jsonb;
  search_term text := lower(btrim(coalesce(requested_search, '')));
begin
  if search_term = '' then return true; end if;
  for column_value in
    select value
    from jsonb_array_elements(
      coalesce(
        config -> 'columns',
        (
          select coalesce(
            jsonb_agg(jsonb_build_object('kind', 'field', 'field_key', legacy_field)),
            '[]'::jsonb
          )
          from jsonb_array_elements_text(coalesce(config -> 'fields', '[]'::jsonb)) as legacy_field
        ),
        '[]'::jsonb
      )
    )
  loop
    if column_value ->> 'kind' = 'field'
      and coalesce(lower(current_record.data_json ->> (column_value ->> 'field_key')), '')
        like '%' || search_term || '%'
    then
      return true;
    end if;
    if column_value ->> 'kind' in ('connection', 'connected_field') and exists (
      select 1
      from public.record_relationships as edge
      join public.relationship_definitions as relationship_definition
        on relationship_definition.business_id = target_business_id
       and relationship_definition.id = edge.relationship_definition_id
       and relationship_definition.key = column_value ->> 'relationship_key'
       and relationship_definition.is_active
      join public.records as target_record
        on target_record.business_id = target_business_id
       and target_record.record_status = 'active'
       and (
         (column_value ->> 'direction' = 'source' and target_record.id = edge.target_record_id)
         or (column_value ->> 'direction' = 'target' and target_record.id = edge.source_record_id)
       )
      where edge.business_id = target_business_id
        and (
          (column_value ->> 'direction' = 'source' and edge.source_record_id = current_record.id)
          or (column_value ->> 'direction' = 'target' and edge.target_record_id = current_record.id)
        )
        and (
          case when column_value ->> 'kind' = 'connection'
            then lower(private.workspace_record_label(target_business_id, target_record))
            else lower(coalesce(target_record.data_json ->> (column_value ->> 'target_field_key'), ''))
          end
        ) like '%' || search_term || '%'
    ) then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- The former four-argument reader is superseded. All application callers use
-- this version, so search cannot accidentally degrade to client-only filtering.
drop function if exists public.query_view_records(uuid, text, integer, integer);

create function public.query_view_records(
  expected_business_id uuid,
  requested_view_key text,
  requested_limit integer default 50,
  requested_offset integer default 0,
  requested_search text default ''
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_view public.views;
  target_timezone text;
  config jsonb;
  object_id uuid;
  total_count bigint;
  records_json jsonb;
  groups_json jsonb := '[]'::jsonb;
  sort_value jsonb;
  property_kind text;
  property_key text;
  field_type public.graph_field_type;
  sort_sql text := '';
  aggregate_sort_sql text;
  direction_sql text;
  connection_direction text;
  connection_cardinality text;
  is_field_sort boolean;
  group_expression_sql text := 'null';
  group_record_expression_sql text := 'null';
  search_term text := btrim(coalesce(requested_search, ''));
begin
  if not private.is_business_member(expected_business_id) then
    raise exception 'workspace_query_membership_required' using errcode = '42501';
  end if;
  if requested_limit is null or requested_limit not between 1 and 250
    or requested_offset is null or requested_offset not between 0 and 1000000
    or char_length(search_term) > 200
  then
    raise exception 'workspace_query_paging_invalid' using errcode = '22023';
  end if;
  select view_definition.* into target_view
  from public.views as view_definition
  where view_definition.business_id = expected_business_id
    and view_definition.key = requested_view_key
    and view_definition.view_type = 'table'
    and view_definition.audience = 'internal'
    and view_definition.is_active;
  if not found then
    raise exception 'workspace_query_view_not_found' using errcode = 'P0002';
  end if;
  config := target_view.config_json;
  object_id := target_view.object_definition_id;
  perform private.assert_valid_view_config_shape('table', config);
  select business.timezone into target_timezone
  from public.businesses as business where business.id = expected_business_id;
  target_timezone := coalesce(target_timezone, 'UTC');

  for sort_value in select value from jsonb_array_elements(coalesce(config -> 'sorts', '[]'::jsonb))
  loop
    property_kind := split_part(sort_value ->> 'property', ':', 1);
    property_key := split_part(sort_value ->> 'property', ':', 2);
    if property_kind = 'field' then
      select definition.field_type into field_type from public.field_definitions as definition
      where definition.business_id = expected_business_id
        and definition.object_definition_id = object_id
        and definition.key = property_key and definition.is_active;
      is_field_sort := found;
      if not is_field_sort then raise exception 'workspace_query_sort_invalid' using errcode = '22023'; end if;
    elsif property_kind = 'connection' then
      is_field_sort := false;
      connection_direction := null;
      connection_cardinality := null;
      select column_value ->> 'direction' into connection_direction
      from jsonb_array_elements(config -> 'columns') as column_value
      where column_value ->> 'kind' = 'connection'
        and column_value ->> 'relationship_key' = property_key
        and column_value ->> 'direction' = split_part(sort_value ->> 'property', ':', 3);
      select relationship_definition.cardinality::text into connection_cardinality
      from public.relationship_definitions as relationship_definition
      where relationship_definition.business_id = expected_business_id
        and relationship_definition.key = property_key and relationship_definition.is_active;
      if connection_direction is null or connection_cardinality is null
        or connection_cardinality = 'many_to_many'
        or (connection_cardinality = 'one_to_many' and connection_direction = 'target')
      then raise exception 'workspace_query_sort_invalid' using errcode = '22023'; end if;
    else
      raise exception 'workspace_query_sort_invalid' using errcode = '22023';
    end if;
    direction_sql := case when sort_value ->> 'direction' = 'descending' then 'desc' else 'asc' end;
    if is_field_sort and field_type in ('number', 'currency') then
      sort_sql := sort_sql || case when sort_sql = '' then '' else ', ' end ||
        format('nullif(r.data_json ->> %L, '''')::numeric %s nulls last', property_key, direction_sql);
    elsif is_field_sort then
      sort_sql := sort_sql || case when sort_sql = '' then '' else ', ' end ||
        format('r.data_json ->> %L %s nulls last', property_key, direction_sql);
    else
      sort_sql := sort_sql || case when sort_sql = '' then '' else ', ' end ||
        format('private.workspace_record_connection_sort_value($1, r, %L, %L) %s nulls last', property_key, connection_direction, direction_sql);
    end if;
  end loop;

  if config -> 'group' <> 'null'::jsonb then
    property_kind := split_part(config ->> 'group', ':', 1);
    property_key := split_part(config ->> 'group', ':', 2);
    if property_kind = 'field' then
      if not exists (
        select 1 from public.field_definitions as definition
        where definition.business_id = expected_business_id
          and definition.object_definition_id = object_id
          and definition.key = property_key and definition.is_active
          and definition.field_type in ('select', 'status', 'boolean', 'date', 'datetime')
      ) then raise exception 'workspace_query_group_invalid' using errcode = '22023'; end if;
      group_expression_sql := format('selected_record.data_json -> %L', property_key);
      group_record_expression_sql := format('r.data_json -> %L', property_key);
    elsif property_kind = 'connection' then
      connection_direction := split_part(config ->> 'group', ':', 3);
      if not exists (
        select 1 from jsonb_array_elements(config -> 'columns') as column_value
        where column_value ->> 'kind' = 'connection'
          and column_value ->> 'relationship_key' = property_key
          and column_value ->> 'direction' = connection_direction
      ) or not exists (
        select 1 from public.relationship_definitions as definition
        where definition.business_id = expected_business_id and definition.key = property_key
          and definition.is_active and (
            definition.cardinality = 'one_to_one' or
            (definition.cardinality = 'one_to_many' and connection_direction = 'source')
          )
      ) then raise exception 'workspace_query_group_invalid' using errcode = '22023'; end if;
      group_expression_sql := format(
        'to_jsonb(private.workspace_record_connection_sort_value($1, selected_record, %L, %L))', property_key, connection_direction);
      group_record_expression_sql := format(
        'to_jsonb(private.workspace_record_connection_sort_value($1, r, %L, %L))', property_key, connection_direction);
    else
      raise exception 'workspace_query_group_invalid' using errcode = '22023';
    end if;
  end if;
  if sort_sql = '' then sort_sql := 'r.created_at desc, r.id'; else sort_sql := sort_sql || ', r.created_at desc, r.id'; end if;
  aggregate_sort_sql := replace(replace(sort_sql, 'r.', 'selected_record.'), ', r,', ', selected_record,');

  select count(*) into total_count
  from public.records as record_value
  where record_value.business_id = expected_business_id
    and record_value.object_definition_id = object_id
    and (coalesce(config ->> 'include_archived', 'false')::boolean or record_value.record_status = 'active')
    and private.workspace_record_matches(expected_business_id, record_value, config, target_timezone)
    and private.workspace_record_matches_search(expected_business_id, record_value, config, search_term);

  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(
       ''record'', to_jsonb(selected_record),
       ''connections'', private.workspace_connection_values($1, selected_record, $3) || private.workspace_connected_field_connection_values($1, selected_record, $3),
       ''projections'', private.workspace_connected_field_values($1, selected_record, $3),
       ''group_value'', case when ($3 ->> ''group'') is null then null else %s end
     ) order by %s), ''[]''::jsonb)
     from (
       select r.* from public.records as r
       where r.business_id = $1 and r.object_definition_id = $2
         and (coalesce($3 ->> ''include_archived'', ''false'')::boolean or r.record_status = ''active'')
         and private.workspace_record_matches($1, r, $3, $4)
         and private.workspace_record_matches_search($1, r, $3, $5)
       order by %s limit $6 offset $7
     ) as selected_record',
    group_expression_sql, aggregate_sort_sql, sort_sql
  ) into records_json using expected_business_id, object_id, config, target_timezone,
    search_term, requested_limit, requested_offset;

  if config -> 'group' <> 'null'::jsonb then
    execute format(
      'select coalesce(jsonb_agg(jsonb_build_object(''value'', grouped.value, ''count'', grouped.count)
        order by grouped.value::text), ''[]''::jsonb)
       from (
         select %s as value, count(*) from public.records as r
         where r.business_id = $1 and r.object_definition_id = $2
           and (coalesce($3 ->> ''include_archived'', ''false'')::boolean or r.record_status = ''active'')
           and private.workspace_record_matches($1, r, $3, $4)
           and private.workspace_record_matches_search($1, r, $3, $5)
         group by %s
       ) as grouped',
      group_record_expression_sql, group_record_expression_sql
    ) into groups_json using expected_business_id, object_id, config, target_timezone, search_term;
  end if;

  return jsonb_build_object(
    'view_key', requested_view_key, 'records', records_json,
    'total_count', total_count, 'limit', requested_limit, 'offset', requested_offset,
    'has_more', total_count > requested_offset + requested_limit,
    'group', config -> 'group', 'groups', groups_json
  );
end;
$$;

revoke all on function public.query_view_records(uuid, text, integer, integer, text)
  from public, anon;
grant execute on function public.query_view_records(uuid, text, integer, integer, text)
  to authenticated;

create or replace function private.assert_stage_1_connected_projections_v1(
  candidate jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  view_definition jsonb;
  column_value jsonb;
  relationship_definition jsonb;
  target_object_key text;
begin
  for view_definition in
    select value
    from jsonb_array_elements(candidate -> 'views') as value
    where value ->> 'view_type' = 'table'
      and value ->> 'audience' = 'internal'
      and (value ->> 'is_active')::boolean
      and value -> 'config_json' ->> 'schema_version' = '2'
  loop
    for column_value in
      select value
      from jsonb_array_elements(view_definition -> 'config_json' -> 'columns') as value
      where value ->> 'kind' = 'connected_field'
    loop
      select value into relationship_definition
      from jsonb_array_elements(candidate -> 'relationship_definitions') as value
      where value ->> 'key' = column_value ->> 'relationship_key'
        and (value ->> 'is_active')::boolean;
      if relationship_definition is null then
        raise exception 'stage_1_connected_projection_relationship_invalid'
          using errcode = '23514';
      end if;
      if (column_value ->> 'direction' = 'source'
          and relationship_definition ->> 'source_object_key' <> view_definition ->> 'object_key')
        or (column_value ->> 'direction' = 'target'
          and relationship_definition ->> 'target_object_key' <> view_definition ->> 'object_key')
        or not (
          relationship_definition ->> 'cardinality' = 'one_to_one'
          or (
            relationship_definition ->> 'cardinality' = 'one_to_many'
            and column_value ->> 'direction' = 'target'
          )
        )
      then
        raise exception 'stage_1_connected_projection_direction_invalid'
          using errcode = '23514';
      end if;
      target_object_key := case when column_value ->> 'direction' = 'source'
        then relationship_definition ->> 'target_object_key'
        else relationship_definition ->> 'source_object_key'
      end;
      if not exists (
        select 1
        from jsonb_array_elements(candidate -> 'field_definitions') as field_definition
        where field_definition ->> 'object_key' = target_object_key
          and field_definition ->> 'key' = column_value ->> 'target_field_key'
          and (field_definition ->> 'is_active')::boolean
          and field_definition ->> 'field_type' <> 'file'
      ) then
        raise exception 'stage_1_connected_projection_field_invalid'
          using errcode = '23514';
      end if;
    end loop;
  end loop;
end;
$$;

create or replace function private.validate_internal_workspace_change_set()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.candidate_snapshot_json is not null then
    perform private.assert_internal_workspace_snapshot_v1(
      new.candidate_snapshot_json
    );
    perform private.assert_stage_1_connected_projections_v1(
      new.candidate_snapshot_json
    );
  end if;
  return new;
end;
$$;

create or replace function private.assert_internal_workspace_action_shape_v1(
  action_kind text,
  candidate_snapshot jsonb,
  operations jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  operation_count integer;
  view_count integer;
  relationship_count integer;
  view_operation jsonb;
begin
  if action_kind not in (
    'create_connection_property', 'add_existing_connection_property',
    'rename_connection_property', 'add_connected_property',
    'create_saved_view', 'duplicate_saved_view', 'rename_saved_view',
    'update_view_query', 'archive_saved_view', 'configure_saved_view'
  ) then
    raise exception 'internal_workspace_action_invalid' using errcode = '22023';
  end if;
  perform private.assert_configuration_operations_v1(operations);

  select count(*) into operation_count from jsonb_array_elements(operations);
  select count(*) into view_count
  from jsonb_array_elements(operations) as value where value ->> 'op' = 'set_view';
  select count(*) into relationship_count
  from jsonb_array_elements(operations) as value where value ->> 'op' = 'set_relationship';
  select value into view_operation
  from jsonb_array_elements(operations) as value where value ->> 'op' = 'set_view'
  limit 1;

  if action_kind = 'create_connection_property' then
    if operation_count not between 2 and 3 or relationship_count <> 1
      or view_count not between 1 and 2 then
      raise exception 'internal_workspace_action_invalid' using errcode = '22023';
    end if;
  elsif action_kind in (
    'add_existing_connection_property', 'rename_connection_property',
    'add_connected_property'
  ) then
    if operation_count <> 1 or view_count <> 1 or relationship_count <> 0 then
      raise exception 'internal_workspace_action_invalid' using errcode = '22023';
    end if;
  elsif action_kind in (
    'create_saved_view', 'duplicate_saved_view', 'configure_saved_view',
    'rename_saved_view', 'update_view_query'
  ) then
    if operation_count <> 1 or view_count <> 1 or relationship_count <> 0
      or view_operation -> 'config_json' ->> 'schema_version' <> '2'
      or view_operation -> 'config_json' ->> 'role' <> 'saved'
      or not (view_operation ->> 'is_active')::boolean
    then
      raise exception 'internal_workspace_action_invalid' using errcode = '22023';
    end if;
  elsif action_kind = 'archive_saved_view' then
    if operation_count <> 1 or view_count <> 1 or relationship_count <> 0
      or view_operation -> 'config_json' ->> 'schema_version' <> '2'
      or view_operation -> 'config_json' ->> 'role' <> 'saved'
      or (view_operation ->> 'is_active')::boolean
    then
      raise exception 'internal_workspace_action_invalid' using errcode = '22023';
    end if;
  end if;

  perform private.assert_internal_workspace_snapshot_v1(candidate_snapshot);
  perform private.assert_stage_1_connected_projections_v1(candidate_snapshot);
end;
$$;
