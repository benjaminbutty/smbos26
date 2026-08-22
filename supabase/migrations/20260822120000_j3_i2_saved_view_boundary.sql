-- Journey 3 I2: one coherent Saved View action. The read-only draft query
-- boundary is defined below after the existing persisted query is factored.

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
    'create_connection_property',
    'add_existing_connection_property',
    'rename_connection_property',
    'create_saved_view',
    'duplicate_saved_view',
    'rename_saved_view',
    'update_view_query',
    'archive_saved_view',
    'configure_saved_view'
  ) then
    raise exception 'internal_workspace_action_invalid'
      using errcode = '22023';
  end if;
  perform private.assert_configuration_operations_v1(operations);

  select count(*) into operation_count
  from jsonb_array_elements(operations);
  select count(*) into view_count
  from jsonb_array_elements(operations) as value
  where value ->> 'op' = 'set_view';
  select count(*) into relationship_count
  from jsonb_array_elements(operations) as value
  where value ->> 'op' = 'set_relationship';
  select value into view_operation
  from jsonb_array_elements(operations) as value
  where value ->> 'op' = 'set_view'
  limit 1;

  if action_kind = 'create_connection_property' then
    if operation_count not between 2 and 3
      or relationship_count <> 1
      or view_count not between 1 and 2
    then
      raise exception 'internal_workspace_action_invalid'
        using errcode = '22023';
    end if;
  elsif action_kind in (
    'add_existing_connection_property',
    'rename_connection_property'
  ) then
    if operation_count <> 1 or view_count <> 1 or relationship_count <> 0 then
      raise exception 'internal_workspace_action_invalid'
        using errcode = '22023';
    end if;
  elsif action_kind in (
    'create_saved_view',
    'duplicate_saved_view',
    'configure_saved_view'
  ) then
    if operation_count <> 1
      or view_count <> 1
      or relationship_count <> 0
      or view_operation -> 'config_json' ->> 'schema_version' <> '2'
      or view_operation -> 'config_json' ->> 'role' <> 'saved'
      or not (view_operation ->> 'is_active')::boolean
    then
      raise exception 'internal_workspace_action_invalid'
        using errcode = '22023';
    end if;
  elsif action_kind in ('rename_saved_view', 'update_view_query') then
    if operation_count <> 1
      or view_count <> 1
      or relationship_count <> 0
      or view_operation -> 'config_json' ->> 'schema_version' <> '2'
      or view_operation -> 'config_json' ->> 'role' <> 'saved'
      or not (view_operation ->> 'is_active')::boolean
    then
      raise exception 'internal_workspace_action_invalid'
        using errcode = '22023';
    end if;
  elsif action_kind = 'archive_saved_view' then
    if operation_count <> 1
      or view_count <> 1
      or relationship_count <> 0
      or view_operation -> 'config_json' ->> 'schema_version' <> '2'
      or view_operation -> 'config_json' ->> 'role' <> 'saved'
      or (view_operation ->> 'is_active')::boolean
    then
      raise exception 'internal_workspace_action_invalid'
        using errcode = '22023';
    end if;
  end if;

  perform private.assert_internal_workspace_snapshot_v1(candidate_snapshot);
end;
$$;

create or replace function public.preview_table_view_records(
  expected_business_id uuid,
  requested_source_view_key text,
  requested_query jsonb,
  requested_columns jsonb,
  requested_limit integer default 50,
  requested_offset integer default 0
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
  title_field text;
  fields jsonb;
  column_value jsonb;
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
begin
  if not private.can_manage_tenant(expected_business_id) then
    raise exception 'workspace_preview_owner_or_admin_required'
      using errcode = '42501';
  end if;
  if requested_limit is null or requested_limit not between 1 and 250
    or requested_offset is null or requested_offset not between 0 and 1000000
    or jsonb_typeof(requested_query) <> 'object'
    or jsonb_typeof(requested_columns) <> 'array'
  then
    raise exception 'workspace_preview_input_invalid'
      using errcode = '22023';
  end if;

  select view_definition.* into target_view
  from public.views as view_definition
  where view_definition.business_id = expected_business_id
    and view_definition.key = requested_source_view_key
    and view_definition.view_type = 'table'
    and view_definition.audience = 'internal'
    and view_definition.is_active;
  if not found then
    raise exception 'workspace_query_view_not_found'
      using errcode = 'P0002';
  end if;
  object_id := target_view.object_definition_id;
  title_field := coalesce(
    target_view.config_json ->> 'title_field',
    target_view.config_json -> 'fields' ->> 0
  );
  select coalesce(jsonb_agg(value ->> 'field_key' order by ordinal), '[]'::jsonb)
  into fields
  from jsonb_array_elements(requested_columns) with ordinality as selected(value, ordinal)
  where value ->> 'kind' = 'field';
  config := jsonb_build_object(
    'schema_version', 2,
    'role', 'saved',
    'columns', requested_columns,
    'fields', fields,
    'title_field', title_field,
    'include_archived', coalesce(
      (target_view.config_json ->> 'include_archived')::boolean,
      false
    ),
    'filters', requested_query -> 'filters',
    'filter_match', requested_query -> 'filter_match',
    'sorts', requested_query -> 'sorts',
    'group', requested_query -> 'group'
  );
  perform private.assert_valid_view_config_shape('table', config);

  for column_value in select value from jsonb_array_elements(requested_columns)
  loop
    if column_value ->> 'kind' = 'field' then
      if not exists (
        select 1 from public.field_definitions as definition
        where definition.business_id = expected_business_id
          and definition.object_definition_id = object_id
          and definition.key = column_value ->> 'field_key'
          and definition.is_active
      ) then
        raise exception 'workspace_preview_column_invalid' using errcode = '22023';
      end if;
    elsif column_value ->> 'kind' = 'connection' then
      if not exists (
        select 1 from public.relationship_definitions as definition
        where definition.business_id = expected_business_id
          and definition.key = column_value ->> 'relationship_key'
          and definition.is_active
          and (
            (column_value ->> 'direction' = 'source'
              and definition.source_object_definition_id = object_id)
            or (column_value ->> 'direction' = 'target'
              and definition.target_object_definition_id = object_id)
          )
      ) then
        raise exception 'workspace_preview_column_invalid' using errcode = '22023';
      end if;
    end if;
  end loop;

  select business.timezone into target_timezone
  from public.businesses as business where business.id = expected_business_id;
  target_timezone := coalesce(target_timezone, 'UTC');

  for sort_value in
    select value from jsonb_array_elements(config -> 'sorts') as value
  loop
    property_kind := split_part(sort_value ->> 'property', ':', 1);
    property_key := split_part(sort_value ->> 'property', ':', 2);
    if property_kind = 'field' then
      select definition.field_type into field_type
      from public.field_definitions as definition
      where definition.business_id = expected_business_id
        and definition.object_definition_id = object_id
        and definition.key = property_key and definition.is_active;
      is_field_sort := found;
      if not is_field_sort then
        raise exception 'workspace_query_sort_invalid' using errcode = '22023';
      end if;
    elsif property_kind = 'connection' then
      is_field_sort := false;
      connection_direction := split_part(sort_value ->> 'property', ':', 3);
      select definition.cardinality::text into connection_cardinality
      from public.relationship_definitions as definition
      where definition.business_id = expected_business_id
        and definition.key = property_key and definition.is_active;
      if not exists (
        select 1 from jsonb_array_elements(config -> 'columns') as item
        where item ->> 'kind' = 'connection'
          and item ->> 'relationship_key' = property_key
          and item ->> 'direction' = connection_direction
      ) or connection_cardinality is null
        or connection_cardinality = 'many_to_many'
        or (connection_cardinality = 'one_to_many' and connection_direction = 'target')
      then
        raise exception 'workspace_query_sort_invalid' using errcode = '22023';
      end if;
    else
      raise exception 'workspace_query_sort_invalid' using errcode = '22023';
    end if;
    direction_sql := case when sort_value ->> 'direction' = 'descending'
      then 'desc' else 'asc' end;
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
      ) then
        raise exception 'workspace_query_group_invalid' using errcode = '22023';
      end if;
      group_expression_sql := format('selected_record.data_json -> %L', property_key);
      group_record_expression_sql := format('r.data_json -> %L', property_key);
    elsif property_kind = 'connection' then
      connection_direction := split_part(config ->> 'group', ':', 3);
      if not exists (
        select 1 from jsonb_array_elements(config -> 'columns') as item
        where item ->> 'kind' = 'connection'
          and item ->> 'relationship_key' = property_key
          and item ->> 'direction' = connection_direction
      ) or not exists (
        select 1 from public.relationship_definitions as definition
        where definition.business_id = expected_business_id
          and definition.key = property_key and definition.is_active
          and (definition.cardinality = 'one_to_one'
            or (definition.cardinality = 'one_to_many' and connection_direction = 'source'))
      ) then
        raise exception 'workspace_query_group_invalid' using errcode = '22023';
      end if;
      group_expression_sql := format('to_jsonb(private.workspace_record_connection_sort_value($1, selected_record, %L, %L))', property_key, connection_direction);
      group_record_expression_sql := format('to_jsonb(private.workspace_record_connection_sort_value($1, r, %L, %L))', property_key, connection_direction);
    else
      raise exception 'workspace_query_group_invalid' using errcode = '22023';
    end if;
  end if;
  if sort_sql = '' then sort_sql := 'r.created_at desc, r.id';
  else sort_sql := sort_sql || ', r.created_at desc, r.id'; end if;
  aggregate_sort_sql := replace(replace(sort_sql, 'r.', 'selected_record.'), ', r,', ', selected_record,');

  select count(*) into total_count from public.records as record_value
  where record_value.business_id = expected_business_id
    and record_value.object_definition_id = object_id
    and (coalesce(config ->> 'include_archived', 'false')::boolean
      or record_value.record_status = 'active')
    and private.workspace_record_matches(expected_business_id, record_value, config, target_timezone);

  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(
       ''record'', to_jsonb(selected_record),
       ''connections'', private.workspace_connection_values($1, selected_record, $3),
       ''group_value'', case when ($3 ->> ''group'') is null then null else %s end
     ) order by %s), ''[]''::jsonb)
     from (select r.* from public.records as r
       where r.business_id = $1 and r.object_definition_id = $2
         and (coalesce($3 ->> ''include_archived'', ''false'')::boolean or r.record_status = ''active'')
         and private.workspace_record_matches($1, r, $3, $4)
       order by %s limit $5 offset $6) as selected_record',
    group_expression_sql, aggregate_sort_sql, sort_sql
  ) into records_json using expected_business_id, object_id, config,
    target_timezone, requested_limit, requested_offset;

  if config -> 'group' <> 'null'::jsonb then
    execute format(
      'select coalesce(jsonb_agg(jsonb_build_object(''value'', grouped.value, ''count'', grouped.count)
        order by grouped.value::text), ''[]''::jsonb)
       from (select %s as value, count(*) from public.records as r
         where r.business_id = $1 and r.object_definition_id = $2
           and (coalesce($3 ->> ''include_archived'', ''false'')::boolean or r.record_status = ''active'')
           and private.workspace_record_matches($1, r, $3, $4)
         group by %s) as grouped',
      group_record_expression_sql, group_record_expression_sql
    ) into groups_json using expected_business_id, object_id, config, target_timezone;
  end if;

  return jsonb_build_object(
    'view_key', requested_source_view_key,
    'records', records_json,
    'total_count', total_count,
    'limit', requested_limit,
    'offset', requested_offset,
    'has_more', total_count > requested_offset + requested_limit,
    'group', config -> 'group',
    'groups', groups_json
  );
end;
$$;

revoke all on function public.preview_table_view_records(
  uuid, text, jsonb, jsonb, integer, integer
) from public, anon;
grant execute on function public.preview_table_view_records(
  uuid, text, jsonb, jsonb, integer, integer
) to authenticated;

comment on function public.preview_table_view_records(
  uuid, text, jsonb, jsonb, integer, integer
) is 'Owner/Admin-only read of current authoritative Records through one unsaved bounded typed Table query and exact mixed-column selection; it persists nothing.';
