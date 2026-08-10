-- Internal Workspace Engine V1.
--
-- Table View schema V1 remains readable for immutable historical snapshots.
-- New and changed Table Views use the canonical schema_version 2 shape below.
-- The configuration projector remains authoritative; operational Record and
-- Connection writes use the narrow RPCs at the end of this migration.

create or replace function private.experience_table_property_key_is_valid(
  property_key text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    property_key ~ '^field:[a-z][a-z0-9_]{0,79}$'
      or property_key ~ '^connection:[a-z][a-z0-9_]{0,79}:(source|target)$',
    false
  );
$$;

create or replace function private.assert_table_view_query_shape_v1(
  config jsonb
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  filter_value jsonb;
  sort_value jsonb;
  operator text;
  list_length integer;
begin
  if jsonb_typeof(config -> 'filters') <> 'array'
    or jsonb_array_length(config -> 'filters') > 20
    or jsonb_typeof(config -> 'sorts') <> 'array'
    or jsonb_array_length(config -> 'sorts') > 5
    or config ->> 'filter_match' not in ('all', 'any')
    or (
      config -> 'group' <> 'null'::jsonb
      and not private.experience_table_property_key_is_valid(config ->> 'group')
    )
  then
    raise exception 'Invalid Table View query'
      using errcode = '22023';
  end if;

  for filter_value in
    select value
    from jsonb_array_elements(config -> 'filters')
  loop
    if not private.experience_json_has_only_keys(
      filter_value,
      array['property', 'operator', 'value', 'values']
    )
      or not private.experience_table_property_key_is_valid(
        filter_value ->> 'property'
      )
      or filter_value ->> 'operator' not in (
        'is',
        'is_not',
        'contains',
        'does_not_contain',
        'is_empty',
        'is_not_empty',
        'greater_than',
        'greater_than_or_equal',
        'less_than',
        'less_than_or_equal',
        'on_or_before',
        'on_or_after',
        'between',
        'is_any_of',
        'contains_any',
        'contains_all',
        'is_yes',
        'is_no'
      )
    then
      raise exception 'Invalid Table View filter'
        using errcode = '22023';
    end if;

    operator := filter_value ->> 'operator';
    if operator in ('is_empty', 'is_not_empty', 'is_yes', 'is_no')
      and (filter_value ? 'value' or filter_value ? 'values')
    then
      raise exception 'Table View filter does not accept a value'
        using errcode = '22023';
    end if;
    if operator not in ('is_empty', 'is_not_empty', 'is_yes', 'is_no')
      and not (filter_value ? 'value' or filter_value ? 'values')
    then
      raise exception 'Table View filter requires a value'
        using errcode = '22023';
    end if;
    if operator in ('is_any_of', 'contains_any', 'contains_all', 'between')
      and jsonb_typeof(filter_value -> 'values') <> 'array'
    then
      raise exception 'Table View list filter requires values'
        using errcode = '22023';
    end if;
    if operator = 'between'
      and jsonb_array_length(filter_value -> 'values') <> 2
    then
      raise exception 'Table View between filter requires two values'
        using errcode = '22023';
    end if;
    if operator not in ('is_any_of', 'contains_any', 'contains_all', 'between')
      and filter_value ? 'values'
    then
      raise exception 'Table View filter accepts one value'
        using errcode = '22023';
    end if;
    if filter_value ? 'values' then
      list_length := jsonb_array_length(filter_value -> 'values');
      if list_length > 100 then
        raise exception 'Table View filter value list is too large'
          using errcode = '22023';
      end if;
    end if;
  end loop;

  for sort_value in
    select value
    from jsonb_array_elements(config -> 'sorts')
  loop
    if not private.experience_json_has_only_keys(
      sort_value,
      array['property', 'direction']
    )
      or not private.experience_table_property_key_is_valid(
        sort_value ->> 'property'
      )
      or sort_value ->> 'direction' not in ('ascending', 'descending')
    then
      raise exception 'Invalid Table View sort'
        using errcode = '22023';
    end if;
  end loop;
end;
$$;

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
          'schema_version',
          'role',
          'columns',
          'fields',
          'title_field',
          'column_widths',
          'create_form_key',
          'edit_form_key',
          'include_archived',
          'filters',
          'filter_match',
          'sorts',
          'group'
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
        select value
        from jsonb_array_elements(config -> 'columns')
      loop
        if column_value ->> 'kind' = 'field' then
          if not private.experience_json_has_only_keys(
            column_value,
            array['kind', 'field_key']
          )
            or not private.experience_key_is_valid(column_value ->> 'field_key')
          then
            raise exception 'Invalid canonical Table field column'
              using errcode = '22023';
          end if;
          column_key := 'field:' || (column_value ->> 'field_key');
          field_keys := field_keys || jsonb_build_array(column_value ->> 'field_key');
        elsif column_value ->> 'kind' = 'connection' then
          if not private.experience_json_has_only_keys(
            column_value,
            array['kind', 'relationship_key', 'direction', 'label']
          )
            or not private.experience_key_is_valid(column_value ->> 'relationship_key')
            or column_value ->> 'direction' not in ('source', 'target')
            or (
              column_value ? 'label'
              and (
                jsonb_typeof(column_value -> 'label') <> 'string'
                or not private.experience_string_is_valid(column_value ->> 'label', 120)
              )
            )
          then
            raise exception 'Invalid canonical Table connection column'
              using errcode = '22023';
          end if;
          column_key := 'connection:' || (column_value ->> 'relationship_key') || ':' ||
            (column_value ->> 'direction');
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
          'fields',
          'title_field',
          'column_widths',
          'create_form_key',
          'edit_form_key',
          'include_archived'
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
        select key, value
        from jsonb_each(config -> 'column_widths')
      loop
        if not exists (
          select 1
          from jsonb_array_elements_text(
            case
              when config ? 'fields' then config -> 'fields'
              else field_keys
            end
          ) as visible_field
          where visible_field = width_key
        ) then
          raise exception 'Table column_widths may only target visible fields'
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
      array[
        'primary_field',
        'secondary_fields',
        'create_form_key',
        'edit_form_key',
        'include_archived'
      ]
    ) or not private.experience_key_is_valid(config ->> 'primary_field')
      or not private.experience_string_array_is_valid(config -> 'secondary_fields', true)
    then
      raise exception 'Invalid List View configuration'
        using errcode = '22023';
    end if;
  elsif requested_view_type = 'cards' then
    if not private.experience_json_has_only_keys(
      config,
      array[
        'title_field',
        'subtitle_field',
        'image_field',
        'supporting_fields',
        'create_form_key',
        'edit_form_key',
        'include_archived'
      ]
    ) or not private.experience_key_is_valid(config ->> 'title_field')
      or not private.experience_string_array_is_valid(config -> 'supporting_fields', true)
    then
      raise exception 'Invalid Cards View configuration'
        using errcode = '22023';
    end if;
  elsif requested_view_type = 'detail' then
    if not private.experience_json_has_only_keys(
      config,
      array['fields', 'title_field', 'edit_form_key', 'include_archived']
    ) or not private.experience_string_array_is_valid(config -> 'fields', false)
    then
      raise exception 'Invalid Detail View configuration'
        using errcode = '22023';
    end if;
  else
    raise exception 'Unsupported View type'
      using errcode = '22023';
  end if;

  if config ? 'title_field'
    and (
      jsonb_typeof(config -> 'title_field') <> 'string'
      or not private.experience_key_is_valid(config ->> 'title_field')
    ) then
    raise exception 'Invalid View title field'
      using errcode = '22023';
  end if;
  if config ? 'subtitle_field'
    and (
      jsonb_typeof(config -> 'subtitle_field') <> 'string'
      or not private.experience_key_is_valid(config ->> 'subtitle_field')
    ) then
    raise exception 'Invalid View subtitle field'
      using errcode = '22023';
  end if;
  if config ? 'image_field'
    and (
      jsonb_typeof(config -> 'image_field') <> 'string'
      or not private.experience_key_is_valid(config ->> 'image_field')
    ) then
    raise exception 'Invalid View image field'
      using errcode = '22023';
  end if;
  if config ? 'create_form_key'
    and (
      jsonb_typeof(config -> 'create_form_key') <> 'string'
      or not private.experience_key_is_valid(config ->> 'create_form_key')
    ) then
    raise exception 'Invalid create Form reference'
      using errcode = '22023';
  end if;
  if config ? 'edit_form_key'
    and (
      jsonb_typeof(config -> 'edit_form_key') <> 'string'
      or not private.experience_key_is_valid(config ->> 'edit_form_key')
    ) then
    raise exception 'Invalid edit Form reference'
      using errcode = '22023';
  end if;
  if config ? 'include_archived'
    and jsonb_typeof(config -> 'include_archived') <> 'boolean'
  then
    raise exception 'View include_archived must be a boolean'
      using errcode = '22023';
  end if;
end;
$$;

create or replace function private.direct_table_columns_preserve_order_with_insert_v2(
  base_columns jsonb,
  candidate_columns jsonb,
  inserted_key text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_array_length(candidate_columns) =
      jsonb_array_length(base_columns) + 1
    and (
      select count(*)
      from jsonb_array_elements(candidate_columns) as item
      where item ->> 'kind' = 'field'
        and item ->> 'field_key' = inserted_key
    ) = 1
    and (
      select jsonb_agg(item order by ordinal)
      from jsonb_array_elements(candidate_columns)
        with ordinality as next_columns(item, ordinal)
      where not (
        item ->> 'kind' = 'field'
        and item ->> 'field_key' = inserted_key
      )
    ) = base_columns;
$$;

create or replace function private.assert_direct_table_action_shape_v1(
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
  object_operation jsonb;
  field_operation jsonb;
  view_operation jsonb;
  base_object jsonb;
  candidate_object jsonb;
  base_field jsonb;
  candidate_field jsonb;
  base_view jsonb;
  candidate_view jsonb;
  operation_config jsonb;
  base_config jsonb;
  candidate_config jsonb;
  target_key text;
  base_column jsonb;
  candidate_column jsonb;
  column_index integer;
begin
  if action_kind not in (
    'create_table',
    'rename_table',
    'add_column',
    'rename_column',
    'update_column_options',
    'reorder_columns',
    'resize_column'
  ) then
    raise exception 'direct_table_action_shape_invalid'
      using errcode = '22023';
  end if;

  perform private.assert_configuration_operations_v1(operations);

  if action_kind = 'create_table' then
    if jsonb_array_length(operations) <> 3
      or not exists (
        select 1 from jsonb_array_elements(operations) as item
        where item ->> 'op' = 'set_object'
      )
      or not exists (
        select 1 from jsonb_array_elements(operations) as item
        where item ->> 'op' = 'set_field'
      )
      or not exists (
        select 1 from jsonb_array_elements(operations) as item
        where item ->> 'op' = 'set_view'
      )
      or not private.direct_table_snapshot_collections_unchanged_v1(
        base_snapshot,
        candidate_snapshot
      )
    then
      raise exception 'direct_table_action_shape_invalid'
        using errcode = '22023';
    end if;

    select value into operation
    from jsonb_array_elements(operations)
    where value ->> 'op' = 'set_object';
    select value into field_operation
    from jsonb_array_elements(operations)
    where value ->> 'op' = 'set_field';
    select value into view_operation
    from jsonb_array_elements(operations)
    where value ->> 'op' = 'set_view';

    if operation ->> 'key' is null
      or field_operation ->> 'object_key' <> operation ->> 'key'
      or view_operation ->> 'object_key' <> operation ->> 'key'
      or view_operation ->> 'view_type' <> 'table'
      or view_operation ->> 'audience' <> 'internal'
      or not (view_operation ->> 'is_active')::boolean
      or not (operation ->> 'is_active')::boolean
      or not (field_operation ->> 'is_active')::boolean
      or operation ->> 'description' <>
        ('A Table of '::text || (operation ->> 'singular_label') || '.'::text)
      or operation -> 'icon' is distinct from 'null'::jsonb
      or field_operation -> 'default_value' <> 'null'::jsonb
      or field_operation ->> 'position' <> '0'
      or field_operation -> 'settings_json' <> '{}'::jsonb
    then
      raise exception 'direct_table_action_shape_invalid'
        using errcode = '22023';
    end if;

    select value into candidate_object
    from jsonb_array_elements(candidate_snapshot -> 'object_definitions') as value
    where value ->> 'key' = operation ->> 'key';
    select value into candidate_field
    from jsonb_array_elements(candidate_snapshot -> 'field_definitions') as value
    where value ->> 'object_key' = operation ->> 'key'
      and value ->> 'key' = field_operation ->> 'key';
    select value into candidate_view
    from jsonb_array_elements(candidate_snapshot -> 'views') as value
    where value ->> 'key' = view_operation ->> 'key';

    if candidate_object is null or candidate_field is null or candidate_view is null
      or candidate_object ->> 'singular_label' <> operation ->> 'singular_label'
      or candidate_object ->> 'plural_label' <> operation ->> 'plural_label'
      or candidate_field ->> 'label' <> field_operation ->> 'label'
      or candidate_field ->> 'field_type' <> 'short_text'
      or not (candidate_field ->> 'required')::boolean
      or candidate_field ->> 'position' <> '0'
      or candidate_field -> 'default_value' <> 'null'::jsonb
      or candidate_field -> 'settings_json' <> '{}'::jsonb
      or candidate_view -> 'config_json' <> view_operation -> 'config_json'
      or (candidate_view -> 'config_json' -> 'fields') <>
        jsonb_build_array(field_operation ->> 'key')
      or candidate_view -> 'config_json' ->> 'title_field' is distinct from field_operation ->> 'key'
      or candidate_view -> 'config_json' ->> 'include_archived' is distinct from 'false'
      or (candidate_view -> 'config_json') ? 'create_form_key'
      or (candidate_view -> 'config_json') ? 'edit_form_key'
    then
      raise exception 'direct_table_action_shape_invalid'
        using errcode = '22023';
    end if;
    return;
  end if;

  if jsonb_array_length(operations) not in (1, 2) then
    raise exception 'direct_table_action_shape_invalid'
      using errcode = '22023';
  end if;

  select value into view_operation
  from jsonb_array_elements(operations) as value
  where value ->> 'op' = 'set_view';
  select value into field_operation
  from jsonb_array_elements(operations) as value
  where value ->> 'op' = 'set_field';
  select value into object_operation
  from jsonb_array_elements(operations) as value
  where value ->> 'op' = 'set_object';

  if action_kind in ('rename_table', 'reorder_columns', 'resize_column')
    and view_operation is null
  then
    raise exception 'direct_table_action_shape_invalid'
      using errcode = '22023';
  end if;
  if action_kind in ('rename_column', 'update_column_options')
    and field_operation is null
  then
    raise exception 'direct_table_action_shape_invalid'
      using errcode = '22023';
  end if;
  if action_kind = 'add_column'
    and (field_operation is null or view_operation is null)
  then
    raise exception 'direct_table_action_shape_invalid'
      using errcode = '22023';
  end if;

  if action_kind = 'rename_table' and object_operation is null then
    raise exception 'direct_table_action_shape_invalid'
      using errcode = '22023';
  end if;
  if action_kind <> 'rename_table' and object_operation is not null then
    raise exception 'direct_table_action_shape_invalid'
      using errcode = '22023';
  end if;

  if view_operation is not null then
    target_key := view_operation ->> 'key';
    select value into base_view
    from jsonb_array_elements(base_snapshot -> 'views') as value
    where value ->> 'key' = target_key;
    select value into candidate_view
    from jsonb_array_elements(candidate_snapshot -> 'views') as value
    where value ->> 'key' = target_key;
    if base_view is null or candidate_view is null
      or base_view ->> 'view_type' <> 'table'
      or base_view ->> 'audience' <> 'internal'
      or not (base_view ->> 'is_active')::boolean
      or candidate_view ->> 'object_key' <> base_view ->> 'object_key'
      or candidate_view ->> 'view_type' <> 'table'
      or candidate_view ->> 'audience' <> 'internal'
      or not (candidate_view ->> 'is_active')::boolean
    then
      raise exception 'direct_table_action_shape_invalid'
        using errcode = '22023';
    end if;
    base_config := base_view -> 'config_json';
    candidate_config := candidate_view -> 'config_json';
    operation_config := view_operation -> 'config_json';
    if candidate_config <> operation_config then
      raise exception 'direct_table_action_shape_invalid'
        using errcode = '22023';
    end if;
  end if;

  if object_operation is not null then
    select value into base_object
    from jsonb_array_elements(base_snapshot -> 'object_definitions') as value
    where value ->> 'key' = object_operation ->> 'key';
    select value into candidate_object
    from jsonb_array_elements(candidate_snapshot -> 'object_definitions') as value
    where value ->> 'key' = object_operation ->> 'key';
  end if;

  if field_operation is not null then
    target_key := (field_operation ->> 'object_key') || chr(31) ||
      (field_operation ->> 'key');
    select value into base_field
    from jsonb_array_elements(base_snapshot -> 'field_definitions') as value
    where (value ->> 'object_key') || chr(31) || (value ->> 'key') = target_key;
    select value into candidate_field
    from jsonb_array_elements(candidate_snapshot -> 'field_definitions') as value
    where (value ->> 'object_key') || chr(31) || (value ->> 'key') = target_key;

    if action_kind in ('rename_column', 'update_column_options')
      and not exists (
        select 1
        from jsonb_array_elements(base_snapshot -> 'views') as table_view
        where table_view ->> 'view_type' = 'table'
          and table_view ->> 'audience' = 'internal'
          and (table_view ->> 'is_active')::boolean
          and table_view ->> 'object_key' = field_operation ->> 'object_key'
          and exists (
            select 1
            from jsonb_array_elements_text(table_view -> 'config_json' -> 'fields') as visible_field
            where visible_field = field_operation ->> 'key'
          )
      )
    then
      raise exception 'direct_table_action_shape_invalid'
        using errcode = '22023';
    end if;

    if action_kind = 'add_column'
      and field_operation ->> 'object_key' <> view_operation ->> 'object_key'
    then
      raise exception 'direct_table_action_shape_invalid'
        using errcode = '22023';
    end if;
  end if;

  if base_config ->> 'schema_version' = '2' then
    if candidate_config ->> 'schema_version' <> '2'
      or operation_config ->> 'schema_version' <> '2'
      or candidate_config <> operation_config
    then
      raise exception 'direct_table_action_shape_invalid'
        using errcode = '22023';
    end if;

    if action_kind = 'rename_table' then
      if jsonb_array_length(operations) <> 2
        or object_operation ->> 'key' <> view_operation ->> 'object_key'
        or base_object is null
        or candidate_object is null
        or not (base_object ->> 'is_active')::boolean
        or not (candidate_object ->> 'is_active')::boolean
        or candidate_object ->> 'singular_label' <>
          object_operation ->> 'singular_label'
        or candidate_object ->> 'plural_label' <>
          object_operation ->> 'plural_label'
        or (candidate_object - 'singular_label'::text - 'plural_label'::text) <>
          (base_object - 'singular_label'::text - 'plural_label'::text)
        or candidate_view ->> 'name' <> view_operation ->> 'name'
        or (candidate_view - 'name'::text) <> (base_view - 'name'::text)
        or candidate_config <> base_config
        or not private.direct_table_snapshot_collections_unchanged_v1(
          base_snapshot,
          candidate_snapshot
        )
        or base_snapshot -> 'object_definitions' =
          candidate_snapshot -> 'object_definitions'
        or base_snapshot -> 'field_definitions' <>
          candidate_snapshot -> 'field_definitions'
        or base_snapshot -> 'views' = candidate_snapshot -> 'views'
      then
        raise exception 'direct_table_action_shape_invalid'
          using errcode = '22023';
      end if;
    elsif action_kind = 'add_column' then
      if jsonb_array_length(operations) <> 2
        or base_field is not null
        or candidate_field is null
        or candidate_field ->> 'label' <> field_operation ->> 'label'
        or candidate_field ->> 'object_key' <> field_operation ->> 'object_key'
        or candidate_field ->> 'field_type' <> field_operation ->> 'field_type'
        or field_operation ->> 'required' <> 'false'
        or field_operation -> 'default_value' <> 'null'::jsonb
        or not (field_operation ->> 'is_active')::boolean
        or candidate_field ->> 'position' <> field_operation ->> 'position'
        or candidate_field -> 'default_value' <> 'null'::jsonb
        or candidate_field ->> 'required' <> 'false'
        or candidate_field -> 'settings_json' <> field_operation -> 'settings_json'
        or (
          field_operation ->> 'field_type' not in ('select', 'status')
          and field_operation -> 'settings_json' <> '{}'::jsonb
        )
        or (
          field_operation ->> 'field_type' in ('select', 'status')
          and not private.direct_table_options_are_valid_v1(
            field_operation -> 'settings_json'
          )
        )
        or candidate_config - 'columns'::text - 'fields'::text <>
          base_config - 'columns'::text - 'fields'::text
        or candidate_config -> 'fields' <> (
          base_config -> 'fields' || jsonb_build_array(field_operation ->> 'key')
        )
        or candidate_config -> 'columns' <> (
          base_config -> 'columns' || jsonb_build_array(
            jsonb_build_object('kind', 'field', 'field_key', field_operation ->> 'key')
          )
        )
        or not private.direct_table_snapshot_collections_unchanged_v1(
          base_snapshot,
          candidate_snapshot
        )
        or base_snapshot -> 'object_definitions' <>
          candidate_snapshot -> 'object_definitions'
      then
        raise exception 'direct_table_action_shape_invalid'
          using errcode = '22023';
      end if;
    elsif action_kind = 'reorder_columns' then
      if jsonb_array_length(operations) <> 1
        or candidate_config - 'fields'::text - 'columns'::text <>
          base_config - 'fields'::text - 'columns'::text
        or candidate_config -> 'fields' <> operation_config -> 'fields'
        or jsonb_array_length(candidate_config -> 'fields') < 1
        or jsonb_array_length(candidate_config -> 'columns') < 1
        or jsonb_array_length(candidate_config -> 'columns') <>
          jsonb_array_length(base_config -> 'columns')
        or exists (
          select 1
          from jsonb_array_elements(candidate_config -> 'fields') as item
          group by item
          having count(*) > 1
        )
      then
        raise exception 'direct_table_action_shape_invalid'
          using errcode = '22023';
      end if;

      for candidate_column, column_index in
        select value, ordinality::integer
        from jsonb_array_elements(candidate_config -> 'columns')
          with ordinality as column_value(value, ordinality)
      loop
        base_column := (base_config -> 'columns') -> (column_index - 1);
        if candidate_column ->> 'kind' <> 'field'
          and candidate_column <> base_column
        then
          raise exception 'direct_table_action_shape_invalid'
            using errcode = '22023';
        end if;
        if candidate_column ->> 'kind' = 'field'
          and not exists (
            select 1
            from jsonb_array_elements_text(candidate_config -> 'fields') as field_key
            where field_key = candidate_column ->> 'field_key'
          )
        then
          raise exception 'direct_table_action_shape_invalid'
            using errcode = '22023';
        end if;
      end loop;
      if base_snapshot -> 'object_definitions' <>
          candidate_snapshot -> 'object_definitions'
        or base_snapshot -> 'field_definitions' <>
          candidate_snapshot -> 'field_definitions'
        or not private.direct_table_snapshot_collections_unchanged_v1(
          base_snapshot,
          candidate_snapshot
        )
        or base_snapshot -> 'views' = candidate_snapshot -> 'views'
      then
        raise exception 'direct_table_action_shape_invalid'
          using errcode = '22023';
      end if;
    elsif action_kind = 'resize_column' then
      if jsonb_array_length(operations) <> 1
        or not exists (
          select 1
          from jsonb_each(operation_config -> 'column_widths') as width
          where (base_config -> 'column_widths' -> width.key) is distinct from
            width.value
        )
        or exists (
          select 1
          from jsonb_object_keys(base_config -> 'column_widths') as old_width
          where not (operation_config -> 'column_widths') ? old_width
        )
        or (
          select count(*)
          from jsonb_each(operation_config -> 'column_widths') as width
          where (base_config -> 'column_widths' -> width.key) is distinct from
            width.value
        ) <> 1
        or candidate_config - 'column_widths'::text <>
          base_config - 'column_widths'::text
        or candidate_config -> 'column_widths' <> operation_config -> 'column_widths'
        or base_snapshot -> 'object_definitions' <>
          candidate_snapshot -> 'object_definitions'
        or base_snapshot -> 'field_definitions' <>
          candidate_snapshot -> 'field_definitions'
        or not private.direct_table_snapshot_collections_unchanged_v1(
          base_snapshot,
          candidate_snapshot
        )
        or base_snapshot -> 'views' = candidate_snapshot -> 'views'
      then
        raise exception 'direct_table_action_shape_invalid'
          using errcode = '22023';
      end if;
    elsif action_kind in ('rename_column', 'change_column_type', 'update_column_options') then
      if jsonb_array_length(operations) <> 1
        or candidate_config <> base_config
        or base_snapshot -> 'object_definitions' <>
          candidate_snapshot -> 'object_definitions'
      then
        raise exception 'direct_table_action_shape_invalid'
          using errcode = '22023';
      end if;
    end if;
    return;
  end if;

  if action_kind = 'rename_table' then
    if jsonb_array_length(operations) <> 2
      or object_operation ->> 'key' <> view_operation ->> 'object_key'
      or base_object is null
      or candidate_object is null
      or not (base_object ->> 'is_active')::boolean
      or not (candidate_object ->> 'is_active')::boolean
      or candidate_object ->> 'singular_label' <> object_operation ->> 'singular_label'
      or candidate_object ->> 'plural_label' <> object_operation ->> 'plural_label'
      or (candidate_object - 'singular_label'::text - 'plural_label'::text) <>
        (base_object - 'singular_label'::text - 'plural_label'::text)
      or candidate_view ->> 'name' <> view_operation ->> 'name'
      or (candidate_view - 'name'::text) <> (base_view - 'name'::text)
      or not private.direct_table_snapshot_collections_unchanged_v1(
        base_snapshot,
        candidate_snapshot
      )
      or base_snapshot -> 'object_definitions' =
        candidate_snapshot -> 'object_definitions'
      or base_snapshot -> 'field_definitions' <>
        candidate_snapshot -> 'field_definitions'
      or base_snapshot -> 'views' = candidate_snapshot -> 'views'
    then
      raise exception 'direct_table_action_shape_invalid'
        using errcode = '22023';
    end if;
  elsif action_kind = 'add_column' then
    if jsonb_array_length(operations) <> 2
      or base_field is not null
      or candidate_field is null
      or candidate_field ->> 'label' <> field_operation ->> 'label'
      or candidate_field ->> 'object_key' <> field_operation ->> 'object_key'
      or candidate_field ->> 'field_type' <> field_operation ->> 'field_type'
      or field_operation ->> 'field_type' not in (
        'short_text',
        'long_text',
        'number',
        'boolean',
        'date',
        'email',
        'phone',
        'url',
        'select',
        'status'
      )
      or (field_operation ->> 'required')::boolean
      or field_operation -> 'default_value' <> 'null'::jsonb
      or not (field_operation ->> 'is_active')::boolean
      or candidate_field ->> 'position' <> field_operation ->> 'position'
      or candidate_field -> 'default_value' <> 'null'::jsonb
      or candidate_field ->> 'required' <> 'false'
      or candidate_field -> 'settings_json' <> field_operation -> 'settings_json'
      or (
        field_operation ->> 'field_type' not in ('select', 'status')
        and field_operation -> 'settings_json' <> '{}'::jsonb
      )
      or (
        field_operation ->> 'field_type' in ('select', 'status')
        and not private.direct_table_options_are_valid_v1(
          field_operation -> 'settings_json'
        )
      )
      or candidate_config - 'fields'::text <> base_config - 'fields'::text
      or candidate_config -> 'fields' <>
        (base_config -> 'fields') ||
        jsonb_build_array(field_operation ->> 'key')
      or not private.direct_table_snapshot_collections_unchanged_v1(
        base_snapshot,
        candidate_snapshot
      )
      or base_snapshot -> 'object_definitions' <>
        candidate_snapshot -> 'object_definitions'
    then
      raise exception 'direct_table_action_shape_invalid'
        using errcode = '22023';
    end if;
  elsif action_kind = 'rename_column' then
    if jsonb_array_length(operations) <> 1
      or base_field is null
      or candidate_field is null
      or candidate_field ->> 'label' <> field_operation ->> 'label'
      or (candidate_field - 'label'::text) <> (base_field - 'label'::text)
      or base_snapshot -> 'field_definitions' =
        candidate_snapshot -> 'field_definitions'
      or base_snapshot -> 'object_definitions' <>
        candidate_snapshot -> 'object_definitions'
      or not private.direct_table_snapshot_collections_unchanged_v1(
        base_snapshot,
        candidate_snapshot
      )
    then
      raise exception 'direct_table_action_shape_invalid'
        using errcode = '22023';
    end if;
  elsif action_kind = 'update_column_options' then
    if jsonb_array_length(operations) <> 1
      or base_field is null
      or candidate_field is null
      or base_field ->> 'field_type' not in ('select', 'status')
      or candidate_field ->> 'field_type' <> base_field ->> 'field_type'
      or candidate_field -> 'settings_json' -> 'options' <>
        field_operation -> 'settings_json' -> 'options'
      or (candidate_field - 'settings_json'::text) <>
        (base_field - 'settings_json'::text)
      or ((candidate_field -> 'settings_json') - 'options'::text) <>
        ((base_field -> 'settings_json') - 'options'::text)
      or base_snapshot -> 'field_definitions' =
        candidate_snapshot -> 'field_definitions'
      or base_snapshot -> 'object_definitions' <>
        candidate_snapshot -> 'object_definitions'
      or not private.direct_table_snapshot_collections_unchanged_v1(
        base_snapshot,
        candidate_snapshot
      )
    then
      raise exception 'direct_table_action_shape_invalid'
        using errcode = '22023';
    end if;
  elsif action_kind = 'reorder_columns' then
    if jsonb_array_length(operations) <> 1
      or candidate_config - 'fields'::text <> base_config - 'fields'::text
      or candidate_config -> 'fields' <> operation_config -> 'fields'
      or jsonb_array_length(candidate_config -> 'fields') < 1
      or exists (
        select 1
        from jsonb_array_elements_text(candidate_config -> 'fields') as item
        where not exists (
          select 1
          from jsonb_array_elements_text(base_config -> 'fields') as original
          where original = item
        )
      )
      or exists (
        select 1
        from jsonb_array_elements_text(candidate_config -> 'fields') as item
        group by item
        having count(*) > 1
      )
      or jsonb_array_length(base_config -> 'fields') <>
        jsonb_array_length(candidate_config -> 'fields')
      or base_snapshot -> 'object_definitions' <>
        candidate_snapshot -> 'object_definitions'
      or base_snapshot -> 'field_definitions' <>
        candidate_snapshot -> 'field_definitions'
      or not private.direct_table_snapshot_collections_unchanged_v1(
        base_snapshot,
        candidate_snapshot
      )
      or base_snapshot -> 'views' = candidate_snapshot -> 'views'
    then
      raise exception 'direct_table_action_shape_invalid'
        using errcode = '22023';
    end if;
  elsif action_kind = 'resize_column' then
    if jsonb_array_length(operations) <> 1
      or not exists (
        select 1
        from jsonb_each(operation_config -> 'column_widths') as width
        where (base_config -> 'column_widths' -> width.key) is distinct from
          width.value
      )
      or exists (
        select 1
        from jsonb_object_keys(base_config -> 'column_widths') as old_width
        where not (operation_config -> 'column_widths') ? old_width
      )
      or (
        select count(*)
        from jsonb_each(operation_config -> 'column_widths') as width
        where (base_config -> 'column_widths' -> width.key) is distinct from
          width.value
      ) <> 1
      or exists (
        select 1
        from jsonb_object_keys(operation_config -> 'column_widths') as width
        where not exists (
          select 1
          from jsonb_array_elements_text(base_config -> 'fields') as field_key
          where field_key = width
        )
      )
      or candidate_config - 'column_widths'::text <>
        base_config - 'column_widths'::text
      or candidate_config -> 'column_widths' <> operation_config -> 'column_widths'
      or base_snapshot -> 'object_definitions' <>
        candidate_snapshot -> 'object_definitions'
      or base_snapshot -> 'field_definitions' <>
        candidate_snapshot -> 'field_definitions'
      or not private.direct_table_snapshot_collections_unchanged_v1(
        base_snapshot,
        candidate_snapshot
      )
      or base_snapshot -> 'views' = candidate_snapshot -> 'views'
    then
      raise exception 'direct_table_action_shape_invalid'
        using errcode = '22023';
    end if;
  end if;
end;
$$;

create or replace function private.assert_lenni_direct_table_action_shape_v1(
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
  field_operation jsonb;
  view_operation jsonb;
  base_field jsonb;
  candidate_field jsonb;
  base_view jsonb;
  candidate_view jsonb;
  base_fields jsonb;
  candidate_fields jsonb;
  target_key text;
begin
  if action_kind not in ('insert_column', 'change_column_type') then
    raise exception 'direct_table_action_shape_invalid'
      using errcode = '22023';
  end if;

  perform private.assert_configuration_operations_v1(operations);

  select value into field_operation
  from jsonb_array_elements(operations) as value
  where value ->> 'op' = 'set_field';

  select value into view_operation
  from jsonb_array_elements(operations) as value
  where value ->> 'op' = 'set_view';

  if field_operation is null then
    raise exception 'direct_table_action_shape_invalid'
      using errcode = '22023';
  end if;

  target_key := (field_operation ->> 'object_key') || chr(31) ||
    (field_operation ->> 'key');
  select value into base_field
  from jsonb_array_elements(base_snapshot -> 'field_definitions') as value
  where (value ->> 'object_key') || chr(31) || (value ->> 'key') = target_key;
  select value into candidate_field
  from jsonb_array_elements(candidate_snapshot -> 'field_definitions') as value
  where (value ->> 'object_key') || chr(31) || (value ->> 'key') = target_key;

  if action_kind = 'insert_column' then
    if jsonb_array_length(operations) <> 2
      or view_operation is null
      or base_field is not null
      or candidate_field is null
      or (candidate_snapshot -> 'object_definitions') <>
        (base_snapshot -> 'object_definitions')
      or (candidate_snapshot -> 'views') = (base_snapshot -> 'views')
      or (candidate_snapshot -> 'field_definitions') =
        (base_snapshot -> 'field_definitions')
      or field_operation ->> 'object_key' <> view_operation ->> 'object_key'
      or field_operation ->> 'label' is null
      or not (field_operation ->> 'is_active')::boolean
      or (field_operation ->> 'required')::boolean
      or field_operation -> 'default_value' <> 'null'::jsonb
      or not private.direct_table_type_is_supported_v2(
        field_operation ->> 'field_type'
      )
      or not private.direct_table_settings_are_valid_v2(
        field_operation ->> 'field_type',
        field_operation -> 'settings_json'
      )
      or candidate_field ->> 'object_key' <> field_operation ->> 'object_key'
      or candidate_field ->> 'key' <> field_operation ->> 'key'
      or candidate_field ->> 'label' <> field_operation ->> 'label'
      or candidate_field ->> 'field_type' <> field_operation ->> 'field_type'
      or candidate_field ->> 'required' <> 'false'
      or candidate_field -> 'default_value' <> 'null'::jsonb
      or candidate_field -> 'settings_json' <>
        field_operation -> 'settings_json'
      or candidate_field ->> 'position' <> field_operation ->> 'position'
      or jsonb_array_length(candidate_snapshot -> 'field_definitions') <>
        jsonb_array_length(base_snapshot -> 'field_definitions') + 1
    then
      raise exception 'direct_table_action_shape_invalid'
        using errcode = '22023';
    end if;

    select value into base_view
    from jsonb_array_elements(base_snapshot -> 'views') as value
    where value ->> 'key' = view_operation ->> 'key';
    select value into candidate_view
    from jsonb_array_elements(candidate_snapshot -> 'views') as value
    where value ->> 'key' = view_operation ->> 'key';
    if base_view is null or candidate_view is null
      or base_view ->> 'view_type' <> 'table'
      or base_view ->> 'audience' <> 'internal'
      or not (base_view ->> 'is_active')::boolean
      or candidate_view - 'config_json'::text <>
        base_view - 'config_json'::text
      or candidate_view -> 'config_json' <>
        view_operation -> 'config_json'
      or (
        base_view -> 'config_json' ->> 'schema_version' <> '2'
        and (candidate_view -> 'config_json') - 'fields'::text <>
          (base_view -> 'config_json') - 'fields'::text
      )
    then
      raise exception 'direct_table_action_shape_invalid'
        using errcode = '22023';
    end if;

    if base_view -> 'config_json' ->> 'schema_version' = '2' then
      if candidate_view - 'config_json'::text <>
          base_view - 'config_json'::text
        or candidate_view -> 'config_json' <>
          view_operation -> 'config_json'
        or (candidate_view -> 'config_json') - 'fields'::text - 'columns'::text <>
          (base_view -> 'config_json') - 'fields'::text - 'columns'::text
        or not private.direct_table_fields_preserve_order_with_insert_v2(
          base_view -> 'config_json' -> 'fields',
          candidate_view -> 'config_json' -> 'fields',
          field_operation ->> 'key'
        )
        or not private.direct_table_columns_preserve_order_with_insert_v2(
          base_view -> 'config_json' -> 'columns',
          candidate_view -> 'config_json' -> 'columns',
          field_operation ->> 'key'
        )
      then
        raise exception 'direct_table_action_shape_invalid'
          using errcode = '22023';
      end if;
      return;
    end if;

    base_fields := base_view -> 'config_json' -> 'fields';
    candidate_fields := candidate_view -> 'config_json' -> 'fields';
    if jsonb_array_length(candidate_fields) <> jsonb_array_length(base_fields) + 1
      or not exists (
        select 1
        from jsonb_array_elements_text(candidate_fields) as item
        where item = field_operation ->> 'key'
      )
      or exists (
        select 1
        from jsonb_array_elements_text(base_fields) as item
        where not exists (
          select 1
          from jsonb_array_elements_text(candidate_fields) as next_item
          where next_item = item
        )
      )
      or exists (
        select 1
        from jsonb_array_elements(base_snapshot -> 'field_definitions') as old_field
        where not exists (
          select 1
          from jsonb_array_elements(candidate_snapshot -> 'field_definitions') as next_field
          where next_field = old_field
        )
      )
      or not private.direct_table_fields_preserve_order_with_insert_v2(
        base_fields,
        candidate_fields,
        field_operation ->> 'key'
      )
    then
      raise exception 'direct_table_action_shape_invalid'
        using errcode = '22023';
    end if;
    return;
  end if;

  if jsonb_array_length(operations) <> 1
    or view_operation is not null
    or base_field is null
    or candidate_field is null
    or not private.direct_table_type_is_supported_v2(
      field_operation ->> 'field_type'
    )
    or candidate_field -> 'field_type' <>
      field_operation -> 'field_type'
    or (candidate_field - 'field_type'::text - 'settings_json'::text) <>
      (base_field - 'field_type'::text - 'settings_json'::text)
    or not exists (
      select 1
      from jsonb_array_elements(base_snapshot -> 'views') as table_view
      where table_view ->> 'view_type' = 'table'
        and table_view ->> 'audience' = 'internal'
        and (table_view ->> 'is_active')::boolean
        and table_view ->> 'object_key' = field_operation ->> 'object_key'
        and (table_view -> 'config_json' -> 'fields') @>
          jsonb_build_array(field_operation ->> 'key')
    )
  then
    raise exception 'direct_table_action_shape_invalid'
      using errcode = '22023';
  end if;

  if not private.direct_table_settings_are_valid_v2(
    field_operation ->> 'field_type',
    field_operation -> 'settings_json'
  )
    or candidate_field -> 'settings_json' <>
      field_operation -> 'settings_json'
  then
    raise exception 'direct_table_action_shape_invalid'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(base_snapshot -> 'views') as table_view
    where table_view ->> 'view_type' = 'table'
      and table_view ->> 'audience' = 'internal'
      and (table_view ->> 'is_active')::boolean
      and table_view ->> 'object_key' = field_operation ->> 'object_key'
      and table_view -> 'config_json' ->> 'title_field' = field_operation ->> 'key'
      and field_operation ->> 'field_type' not in ('short_text', 'long_text')
  ) then
    raise exception 'direct_table_action_shape_invalid'
      using errcode = '22023';
  end if;

  if (candidate_snapshot -> 'object_definitions') <>
       (base_snapshot -> 'object_definitions')
    or (candidate_snapshot -> 'views') <>
       (base_snapshot -> 'views')
    or (candidate_snapshot -> 'field_definitions') =
      (base_snapshot -> 'field_definitions')
    or exists (
      select 1
      from jsonb_array_elements(base_snapshot -> 'field_definitions') as old_field
      where not (
        old_field ->> 'key' = field_operation ->> 'key'
        and old_field ->> 'object_key' = field_operation ->> 'object_key'
      )
        and not exists (
          select 1
          from jsonb_array_elements(candidate_snapshot -> 'field_definitions') as next_field
          where next_field = old_field
        )
    )
  then
    raise exception 'direct_table_action_shape_invalid'
      using errcode = '22023';
  end if;
end;
$$;

create or replace function private.experience_view_field_keys(
  requested_view_type public.experience_view_type,
  config jsonb
)
returns setof text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if requested_view_type = 'table' and config ->> 'schema_version' = '2' then
    return query
      select column_value ->> 'field_key'
      from jsonb_array_elements(config -> 'columns') as column_value
      where column_value ->> 'kind' = 'field';
  elsif requested_view_type in ('table', 'detail') then
    return query
      select value
      from jsonb_array_elements_text(config -> 'fields') as value;
  elsif requested_view_type = 'list' then
    return next config ->> 'primary_field';
    return query
      select value
      from jsonb_array_elements_text(config -> 'secondary_fields') as value;
  elsif requested_view_type = 'cards' then
    return next config ->> 'title_field';
    return query
      select value
      from jsonb_array_elements_text(config -> 'supporting_fields') as value;
  end if;
  if config ? 'title_field' then
    return next config ->> 'title_field';
  end if;
  if config ? 'subtitle_field' then
    return next config ->> 'subtitle_field';
  end if;
  if config ? 'image_field' then
    return next config ->> 'image_field';
  end if;
end;
$$;

create or replace function private.assert_internal_workspace_snapshot_v1(
  candidate jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  view_definition jsonb;
  configured_view jsonb;
  column_value jsonb;
  filter_value jsonb;
  sort_value jsonb;
  relationship_definition jsonb;
  property_key text;
  property_kind text;
  direction text;
  primary_count integer;
  legacy_count integer;
  object_definition_id text;
  field_type text;
  operator text;
  has_value boolean;
  has_values boolean;
  operand jsonb;
begin
  for object_definition_id in
    select value ->> 'object_definition_id'
    from jsonb_array_elements(candidate -> 'views') as value
    where value ->> 'view_type' = 'table'
      and value ->> 'audience' = 'internal'
      and (value ->> 'is_active')::boolean
    group by value ->> 'object_definition_id'
  loop
    select count(*) into primary_count
    from jsonb_array_elements(candidate -> 'views') as candidate_view
    where candidate_view ->> 'view_type' = 'table'
      and candidate_view ->> 'audience' = 'internal'
      and (candidate_view ->> 'is_active')::boolean
      and candidate_view -> 'config_json' ->> 'schema_version' = '2'
      and candidate_view -> 'config_json' ->> 'role' = 'primary'
      and candidate_view ->> 'object_definition_id' = object_definition_id;
    select count(*) into legacy_count
    from jsonb_array_elements(candidate -> 'views') as candidate_view
    where candidate_view ->> 'view_type' = 'table'
      and candidate_view ->> 'audience' = 'internal'
      and (candidate_view ->> 'is_active')::boolean
      and not (candidate_view -> 'config_json' ? 'schema_version')
      and candidate_view ->> 'object_definition_id' = object_definition_id;
    if primary_count > 1 then
      raise exception 'internal_workspace_primary_view_duplicate'
        using errcode = '23514';
    end if;
    if primary_count = 0 and legacy_count = 0 then
      raise exception 'internal_workspace_primary_view_missing'
        using errcode = '23514';
    end if;
  end loop;

  for view_definition in
    select value
    from jsonb_array_elements(candidate -> 'views') as value
    where value ->> 'view_type' = 'table'
      and value ->> 'audience' = 'internal'
      and (value ->> 'is_active')::boolean
  loop
    configured_view := view_definition -> 'config_json';
    if configured_view ->> 'schema_version' <> '2' then
      continue;
    end if;

    for column_value in
      select value
      from jsonb_array_elements(configured_view -> 'columns') as value
    loop
      if column_value ->> 'kind' <> 'connection' then
        continue;
      end if;
      select value into relationship_definition
      from jsonb_array_elements(candidate -> 'relationship_definitions') as value
      where value ->> 'key' = column_value ->> 'relationship_key'
        and (value ->> 'is_active')::boolean;
      if relationship_definition is null then
        raise exception 'internal_workspace_connection_reference_invalid'
          using errcode = '23514';
      end if;
      direction := column_value ->> 'direction';
      if direction = 'source'
        and relationship_definition ->> 'source_object_key' <>
          view_definition ->> 'object_key'
      then
        raise exception 'internal_workspace_connection_direction_invalid'
          using errcode = '23514';
      end if;
      if direction = 'target'
        and relationship_definition ->> 'target_object_key' <>
          view_definition ->> 'object_key'
      then
        raise exception 'internal_workspace_connection_direction_invalid'
          using errcode = '23514';
      end if;
    end loop;

    for filter_value in
      select value
      from jsonb_array_elements(configured_view -> 'filters') as value
    loop
      property_kind := split_part(filter_value ->> 'property', ':', 1);
      property_key := split_part(filter_value ->> 'property', ':', 2);
      direction := split_part(filter_value ->> 'property', ':', 3);
      operator := filter_value ->> 'operator';
      has_value := filter_value ? 'value';
      has_values := filter_value ? 'values';
      field_type := null;
      relationship_definition := null;
      column_value := null;
      if not private.experience_table_property_key_is_valid(
        filter_value ->> 'property'
      ) then
        raise exception 'internal_workspace_filter_property_invalid'
          using errcode = '23514';
      elsif property_kind = 'connection' then
        select value into column_value
        from jsonb_array_elements(configured_view -> 'columns') as value
        where value ->> 'kind' = 'connection'
          and value ->> 'relationship_key' = property_key
          and value ->> 'direction' = direction;
        select value into relationship_definition
        from jsonb_array_elements(candidate -> 'relationship_definitions') as value
        where value ->> 'key' = property_key
          and (value ->> 'is_active')::boolean;
        if column_value is null or relationship_definition is null then
          raise exception 'internal_workspace_filter_property_invalid'
            using errcode = '23514';
        end if;
      elsif property_kind = 'field' and not exists (
        select 1
        from jsonb_array_elements(candidate -> 'field_definitions') as field_definition
        where field_definition ->> 'object_key' = view_definition ->> 'object_key'
          and field_definition ->> 'key' = property_key
          and (field_definition ->> 'is_active')::boolean
      ) then
        raise exception 'internal_workspace_filter_property_invalid'
          using errcode = '23514';
      elsif property_kind <> 'field' then
        raise exception 'internal_workspace_filter_property_invalid'
          using errcode = '23514';
      end if;

      if property_kind = 'field' then
        select field_definition ->> 'field_type'
        into field_type
        from jsonb_array_elements(candidate -> 'field_definitions') as field_definition
        where field_definition ->> 'object_key' = view_definition ->> 'object_key'
          and field_definition ->> 'key' = property_key
          and (field_definition ->> 'is_active')::boolean;
      end if;

      if field_type is not null then
        if property_kind = 'connection'
          or (
            field_type in ('short_text', 'long_text', 'email', 'phone', 'url')
            and operator not in (
              'is', 'is_not', 'contains', 'does_not_contain',
              'is_empty', 'is_not_empty'
            )
          )
          or (
            field_type in ('number', 'currency')
            and operator not in (
              'is', 'is_not', 'greater_than', 'greater_than_or_equal',
              'less_than', 'less_than_or_equal', 'is_empty', 'is_not_empty'
            )
          )
          or (
            field_type in ('date', 'datetime')
            and operator not in (
              'is', 'is_not', 'on_or_before', 'on_or_after', 'between',
              'is_empty', 'is_not_empty'
            )
          )
          or (
            field_type = 'boolean'
            and operator not in ('is_yes', 'is_no', 'is_empty', 'is_not_empty')
          )
          or (
            field_type in ('select', 'status')
            and operator not in (
              'is', 'is_not', 'is_any_of', 'is_empty', 'is_not_empty'
            )
          )
          or (
            field_type = 'multi_select'
            and operator not in (
              'contains_any', 'contains_all', 'is_empty', 'is_not_empty'
            )
          )
          or (
            field_type = 'file'
            and operator not in ('is_empty', 'is_not_empty')
          )
        then
          raise exception 'internal_workspace_filter_operator_invalid'
            using errcode = '23514';
        end if;
      elsif property_kind = 'field' then
        raise exception 'internal_workspace_filter_property_invalid'
          using errcode = '23514';
      elsif operator not in (
        'is', 'is_not', 'contains', 'does_not_contain', 'is_any_of',
        'contains_any', 'is_empty', 'is_not_empty'
      ) then
        raise exception 'internal_workspace_filter_operator_invalid'
          using errcode = '23514';
      end if;

      if operator in ('is_empty', 'is_not_empty', 'is_yes', 'is_no') then
        if has_value or has_values then
          raise exception 'internal_workspace_filter_value_invalid'
            using errcode = '23514';
        end if;
      elsif operator in ('is_any_of', 'contains_any', 'contains_all', 'between') then
        if has_value or not has_values
          or jsonb_typeof(filter_value -> 'values') <> 'array'
          or (
            operator = 'between'
            and jsonb_array_length(filter_value -> 'values') <> 2
          )
        then
          raise exception 'internal_workspace_filter_value_invalid'
            using errcode = '23514';
        end if;
      elsif not has_value or has_values then
        raise exception 'internal_workspace_filter_value_invalid'
          using errcode = '23514';
      end if;

      if field_type in ('date', 'datetime')
        and operator in ('is', 'is_not', 'on_or_before', 'on_or_after', 'between')
      then
        for operand in
          select value
          from jsonb_array_elements(
            case
              when has_values then filter_value -> 'values'
              else jsonb_build_array(filter_value -> 'value')
            end
          ) as value
        loop
          if jsonb_typeof(operand) = 'object' then
            if not private.experience_json_has_only_keys(
              operand,
              array['unit', 'amount']
            )
              or operand ->> 'unit' is null
              or operand ->> 'unit' not in ('day', 'week', 'month')
              or jsonb_typeof(operand -> 'amount') is distinct from 'number'
              or (operand ->> 'amount') is null
              or (operand ->> 'amount') !~ '^-?[0-9]+$'
              or (operand ->> 'amount')::integer not between -3650 and 3650
            then
              raise exception 'internal_workspace_filter_date_invalid'
                using errcode = '23514';
            end if;
          elsif jsonb_typeof(operand) <> 'string'
            or (
              field_type = 'date'
              and (operand #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            )
            or (
              field_type = 'datetime'
              and (operand #>> '{}') !~
                '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}'
            )
          then
            raise exception 'internal_workspace_filter_date_invalid'
              using errcode = '23514';
          end if;
        end loop;
      end if;
    end loop;

    for sort_value in
      select value
      from jsonb_array_elements(configured_view -> 'sorts') as value
    loop
      property_kind := split_part(sort_value ->> 'property', ':', 1);
      property_key := split_part(sort_value ->> 'property', ':', 2);
      direction := split_part(sort_value ->> 'property', ':', 3);
      if not private.experience_table_property_key_is_valid(
        sort_value ->> 'property'
      ) then
        raise exception 'internal_workspace_sort_property_invalid'
          using errcode = '23514';
      elsif property_kind = 'field' then
        select field_definition ->> 'field_type'
        into field_type
        from jsonb_array_elements(candidate -> 'field_definitions') as field_definition
        where field_definition ->> 'object_key' = view_definition ->> 'object_key'
          and field_definition ->> 'key' = property_key
          and (field_definition ->> 'is_active')::boolean;
        if field_type is null then
          raise exception 'internal_workspace_sort_property_invalid'
            using errcode = '23514';
        end if;
        if field_type in ('multi_select', 'file') then
          raise exception 'internal_workspace_sort_property_invalid'
            using errcode = '23514';
        end if;
      elsif property_kind = 'connection' then
        select value into column_value
        from jsonb_array_elements(configured_view -> 'columns') as value
        where value ->> 'kind' = 'connection'
          and value ->> 'relationship_key' = property_key
          and value ->> 'direction' = direction;
        select value into relationship_definition
        from jsonb_array_elements(candidate -> 'relationship_definitions') as value
        where value ->> 'key' = property_key
          and (value ->> 'is_active')::boolean;
        if column_value is null
          or relationship_definition is null
          or relationship_definition ->> 'cardinality' = 'many_to_many'
          or (
            relationship_definition ->> 'cardinality' = 'one_to_many'
            and column_value ->> 'direction' = 'target'
          )
        then
          raise exception 'internal_workspace_sort_property_invalid'
            using errcode = '23514';
        end if;
      else
        raise exception 'internal_workspace_sort_property_invalid'
          using errcode = '23514';
      end if;
    end loop;

    if configured_view -> 'group' <> 'null'::jsonb then
      property_kind := split_part(configured_view ->> 'group', ':', 1);
      property_key := split_part(configured_view ->> 'group', ':', 2);
      direction := split_part(configured_view ->> 'group', ':', 3);
      if not private.experience_table_property_key_is_valid(
        configured_view ->> 'group'
      ) then
        raise exception 'internal_workspace_group_property_invalid'
          using errcode = '23514';
      elsif property_kind = 'field' then
        select field_definition ->> 'field_type'
        into field_type
        from jsonb_array_elements(candidate -> 'field_definitions') as field_definition
        where field_definition ->> 'object_key' = view_definition ->> 'object_key'
          and field_definition ->> 'key' = property_key
          and (field_definition ->> 'is_active')::boolean;
        if field_type is null then
          raise exception 'internal_workspace_group_property_invalid'
            using errcode = '23514';
        end if;
        if field_type not in ('select', 'status', 'boolean', 'date', 'datetime') then
          raise exception 'internal_workspace_group_property_invalid'
            using errcode = '23514';
        end if;
      elsif property_kind = 'connection' then
        select value into column_value
        from jsonb_array_elements(configured_view -> 'columns') as value
        where value ->> 'kind' = 'connection'
          and value ->> 'relationship_key' = property_key
          and value ->> 'direction' = direction;
        select value into relationship_definition
        from jsonb_array_elements(candidate -> 'relationship_definitions') as value
        where value ->> 'key' = property_key
          and (value ->> 'is_active')::boolean;
        if column_value is null
          or relationship_definition is null
          or relationship_definition ->> 'cardinality' = 'many_to_many'
          or (
            relationship_definition ->> 'cardinality' = 'one_to_many'
            and column_value ->> 'direction' = 'target'
          )
        then
          raise exception 'internal_workspace_group_property_invalid'
            using errcode = '23514';
        end if;
      else
        raise exception 'internal_workspace_group_property_invalid'
          using errcode = '23514';
      end if;
    end if;
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
  end if;
  return new;
end;
$$;

drop trigger if exists configuration_change_sets_internal_workspace_validate
  on public.configuration_change_sets;
create trigger configuration_change_sets_internal_workspace_validate
before insert on public.configuration_change_sets
for each row execute function private.validate_internal_workspace_change_set();

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
    'archive_saved_view'
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
  elsif action_kind in ('create_saved_view', 'duplicate_saved_view') then
    if operation_count <> 1
      or view_count <> 1
      or view_operation -> 'config_json' ->> 'schema_version' <> '2'
      or view_operation -> 'config_json' ->> 'role' <> 'saved'
    then
      raise exception 'internal_workspace_action_invalid'
        using errcode = '22023';
    end if;
  elsif action_kind in ('rename_saved_view', 'update_view_query') then
    if operation_count <> 1
      or view_count <> 1
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

create or replace function public.apply_internal_workspace_configuration_change(
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

  proposed := public.propose_configuration_change(
    expected_business_id,
    expected_actor_id,
    expected_base_version_id,
    expected_head_revision,
    left('Table Workspace: ' || requested_action_kind, 120),
    'direct_table_workspace:' || requested_action_kind,
    requested_operations
  );

  if not exists (
    select 1
    from public.configuration_versions as version
    where version.business_id = expected_business_id
      and version.id = proposed.base_version_id
  ) then
    raise exception 'internal_workspace_action_invalid'
      using errcode = '22023';
  end if;

  perform private.assert_internal_workspace_action_shape_v1(
    requested_action_kind,
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

revoke all on function public.apply_internal_workspace_configuration_change(
  uuid,
  uuid,
  uuid,
  bigint,
  text,
  jsonb
) from public, anon;
grant execute on function public.apply_internal_workspace_configuration_change(
  uuid,
  uuid,
  uuid,
  bigint,
  text,
  jsonb
) to authenticated;

create or replace function private.workspace_record_label(
  target_business_id uuid,
  target_record public.records
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  selected_config jsonb;
  title_key text;
  selected_label text;
begin
  select view_definition.config_json
  into selected_config
  from public.views as view_definition
  where view_definition.business_id = target_business_id
    and view_definition.object_definition_id = target_record.object_definition_id
    and view_definition.view_type = 'table'
    and view_definition.audience = 'internal'
    and view_definition.is_active
  order by
    case
      when view_definition.config_json ->> 'schema_version' = '2'
        and view_definition.config_json ->> 'role' = 'primary'
        then 0
      else 1
    end,
    view_definition.key collate "C"
  limit 1;

  title_key := coalesce(
    selected_config ->> 'title_field',
    selected_config -> 'fields' ->> 0,
    (
      select column_value ->> 'field_key'
      from jsonb_array_elements(selected_config -> 'columns') as column_value
      where column_value ->> 'kind' = 'field'
      limit 1
    )
  );
  if title_key is null then
    select field_definition.key
    into title_key
    from public.field_definitions as field_definition
    where field_definition.business_id = target_business_id
      and field_definition.object_definition_id = target_record.object_definition_id
      and field_definition.is_active
    order by field_definition.position, field_definition.key collate "C"
    limit 1;
  end if;
  selected_label := target_record.data_json ->> title_key;
  return coalesce(nullif(btrim(selected_label), ''), left(target_record.id::text, 8));
end;
$$;

create or replace function private.workspace_record_property_value(
  target_business_id uuid,
  target_record public.records,
  config jsonb,
  requested_property text
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  relationship_column jsonb;
  relationship_definition public.relationship_definitions;
  relationship_values jsonb;
  property_kind text := split_part(requested_property, ':', 1);
  property_key text := split_part(requested_property, ':', 2);
  direction text := split_part(requested_property, ':', 3);
begin
  if property_kind = 'field' then
    if not exists (
      select 1
      from public.field_definitions as field_definition
      where field_definition.business_id = target_business_id
        and field_definition.object_definition_id = target_record.object_definition_id
        and field_definition.key = property_key
        and field_definition.is_active
    ) then
      return null;
    end if;
    return target_record.data_json -> property_key;
  end if;

  if property_kind <> 'connection'
    or direction not in ('source', 'target')
  then
    return null;
  end if;

  select value into relationship_column
  from jsonb_array_elements(config -> 'columns') as value
  where value ->> 'kind' = 'connection'
    and value ->> 'relationship_key' = property_key
    and value ->> 'direction' = direction;
  if relationship_column is null then
    return null;
  end if;
  select definition.* into relationship_definition
  from public.relationship_definitions as definition
  where definition.business_id = target_business_id
    and definition.key = property_key
    and definition.is_active;
  if not found then
    return null;
  end if;

  if direction = 'source' then
    select coalesce(
      jsonb_agg(to_jsonb(edge.target_record_id) order by edge.target_record_id),
      '[]'::jsonb
    )
    into relationship_values
    from public.record_relationships as edge
    where edge.business_id = target_business_id
      and edge.relationship_definition_id = relationship_definition.id
      and edge.source_record_id = target_record.id;
  else
    select coalesce(
      jsonb_agg(to_jsonb(edge.source_record_id) order by edge.source_record_id),
      '[]'::jsonb
    )
    into relationship_values
    from public.record_relationships as edge
    where edge.business_id = target_business_id
      and edge.relationship_definition_id = relationship_definition.id
      and edge.target_record_id = target_record.id;
  end if;
  return relationship_values;
end;
$$;

create or replace function private.workspace_filter_operand_text(
  operand jsonb,
  target_timezone text
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  unit text;
  amount integer;
  today_date date := (now() at time zone target_timezone)::date;
begin
  if operand is null or operand = 'null'::jsonb then
    return null;
  end if;
  if jsonb_typeof(operand) = 'object'
    and operand ? 'unit'
    and operand ? 'amount'
    and operand - array['unit', 'amount'] = '{}'::jsonb
  then
    unit := operand ->> 'unit';
    amount := (operand ->> 'amount')::integer;
    if unit = 'day' then
      return (today_date + amount)::text;
    elsif unit = 'week' then
      return (today_date + (amount * 7))::text;
    elsif unit = 'month' then
      return ((today_date + (amount || ' months')::interval)::date)::text;
    end if;
    return null;
  end if;
  return operand #>> '{}';
end;
$$;

create or replace function private.workspace_filter_matches(
  raw_value jsonb,
  filter_value jsonb,
  target_timezone text
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  operator text := filter_value ->> 'operator';
  operand text := private.workspace_filter_operand_text(
    filter_value -> 'value',
    target_timezone
  );
  raw_text text := raw_value #>> '{}';
begin
  if operator = 'is_empty' then
    return raw_value is null
      or raw_value = 'null'::jsonb
      or (jsonb_typeof(raw_value) = 'string' and btrim(raw_text) = '')
      or (jsonb_typeof(raw_value) = 'array' and jsonb_array_length(raw_value) = 0);
  end if;
  if operator = 'is_not_empty' then
    return not private.workspace_filter_matches(
      raw_value,
      jsonb_build_object('operator', 'is_empty'),
      target_timezone
    );
  end if;
  if operator = 'is_yes' then
    return raw_value = 'true'::jsonb;
  end if;
  if operator = 'is_no' then
    return raw_value = 'false'::jsonb;
  end if;
  if raw_value is null or raw_value = 'null'::jsonb then
    return false;
  end if;

  if jsonb_typeof(raw_value) = 'array'
    and operator in ('is', 'is_not', 'contains', 'does_not_contain')
  then
    if operator in ('is_not', 'does_not_contain') then
      return not raw_value @> jsonb_build_array(filter_value -> 'value');
    end if;
    return raw_value @> jsonb_build_array(filter_value -> 'value');
  end if;

  if operator in ('is_any_of', 'contains_any', 'contains_all') then
    if jsonb_typeof(raw_value) = 'array' then
      if operator = 'contains_all' then
        return not exists (
          select 1
          from jsonb_array_elements(filter_value -> 'values') as expected
          where not exists (
            select 1
            from jsonb_array_elements(raw_value) as actual
            where actual = expected
              or actual #>> '{}' = expected #>> '{}'
          )
        );
      end if;
      return exists (
        select 1
        from jsonb_array_elements(filter_value -> 'values') as expected
        where exists (
          select 1
          from jsonb_array_elements(raw_value) as actual
          where actual = expected
            or actual #>> '{}' = expected #>> '{}'
        )
      );
    end if;
    return exists (
      select 1
      from jsonb_array_elements(filter_value -> 'values') as expected
      where raw_value = expected
        or raw_text = expected #>> '{}'
    );
  end if;

  if operator = 'contains' then
    return raw_text ilike '%' || coalesce(operand, '') || '%';
  elsif operator = 'does_not_contain' then
    return raw_text not ilike '%' || coalesce(operand, '') || '%';
  elsif operator = 'is' then
    return raw_value = filter_value -> 'value'
      or raw_text = operand;
  elsif operator = 'is_not' then
    return not (
      raw_value = filter_value -> 'value'
      or raw_text = operand
    );
  elsif operator = 'greater_than' then
    return case
      when raw_text ~ '^-?[0-9]+(?:\.[0-9]+)?$'
        and coalesce(operand, '') ~ '^-?[0-9]+(?:\.[0-9]+)?$'
        then raw_text::numeric > operand::numeric
      else raw_text > operand
    end;
  elsif operator = 'greater_than_or_equal' then
    return case
      when raw_text ~ '^-?[0-9]+(?:\.[0-9]+)?$'
        and coalesce(operand, '') ~ '^-?[0-9]+(?:\.[0-9]+)?$'
        then raw_text::numeric >= operand::numeric
      else raw_text >= operand
    end;
  elsif operator = 'less_than' then
    return case
      when raw_text ~ '^-?[0-9]+(?:\.[0-9]+)?$'
        and coalesce(operand, '') ~ '^-?[0-9]+(?:\.[0-9]+)?$'
        then raw_text::numeric < operand::numeric
      else raw_text < operand
    end;
  elsif operator = 'less_than_or_equal' then
    return case
      when raw_text ~ '^-?[0-9]+(?:\.[0-9]+)?$'
        and coalesce(operand, '') ~ '^-?[0-9]+(?:\.[0-9]+)?$'
        then raw_text::numeric <= operand::numeric
      else raw_text <= operand
    end;
  elsif operator = 'on_or_before' then
    return raw_text <= operand;
  elsif operator = 'on_or_after' then
    return raw_text >= operand;
  elsif operator = 'between' then
    return raw_text >= private.workspace_filter_operand_text(
        (filter_value -> 'values') -> 0,
        target_timezone
      )
      and raw_text <= private.workspace_filter_operand_text(
        (filter_value -> 'values') -> 1,
        target_timezone
      );
  end if;
  return false;
end;
$$;

create or replace function private.workspace_record_matches(
  target_business_id uuid,
  target_record public.records,
  config jsonb,
  target_timezone text
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  filter_value jsonb;
  filter_result boolean;
  has_filter boolean := false;
  matches_any boolean := false;
  match_all boolean := coalesce(config ->> 'filter_match', 'all') = 'all';
  raw_value jsonb;
begin
  for filter_value in
    select value
    from jsonb_array_elements(coalesce(config -> 'filters', '[]'::jsonb)) as value
  loop
    has_filter := true;
    raw_value := private.workspace_record_property_value(
      target_business_id,
      target_record,
      config,
      filter_value ->> 'property'
    );
    filter_result := private.workspace_filter_matches(
      raw_value,
      filter_value,
      target_timezone
    );
    if match_all and not filter_result then
      return false;
    end if;
    if not match_all and filter_result then
      matches_any := true;
    end if;
  end loop;
  return not has_filter or match_all or matches_any;
end;
$$;

create or replace function private.workspace_connection_values(
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
  relationship_definition public.relationship_definitions;
  target_object_id uuid;
  target_ids jsonb;
  connection_key text;
  values_json jsonb;
  result jsonb := '{}'::jsonb;
begin
  for column_value in
    select value
    from jsonb_array_elements(config -> 'columns') as value
    where value ->> 'kind' = 'connection'
  loop
    select definition.* into relationship_definition
    from public.relationship_definitions as definition
    where definition.business_id = target_business_id
      and definition.key = column_value ->> 'relationship_key'
      and definition.is_active;
    if not found then
      continue;
    end if;
    if column_value ->> 'direction' = 'source' then
      target_object_id := relationship_definition.target_object_definition_id;
      select coalesce(
        jsonb_agg(to_jsonb(edge.target_record_id) order by edge.target_record_id),
        '[]'::jsonb
      ) into target_ids
      from public.record_relationships as edge
      where edge.business_id = target_business_id
        and edge.relationship_definition_id = relationship_definition.id
        and edge.source_record_id = current_record.id;
    else
      target_object_id := relationship_definition.source_object_definition_id;
      select coalesce(
        jsonb_agg(to_jsonb(edge.source_record_id) order by edge.source_record_id),
        '[]'::jsonb
      ) into target_ids
      from public.record_relationships as edge
      where edge.business_id = target_business_id
        and edge.relationship_definition_id = relationship_definition.id
        and edge.target_record_id = current_record.id;
    end if;
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', target_record.id,
          'label', private.workspace_record_label(target_business_id, target_record)
        )
        order by private.workspace_record_label(target_business_id, target_record),
          target_record.id
      ),
      '[]'::jsonb
    ) into values_json
    from public.records as target_record
    where target_record.business_id = target_business_id
      and target_record.object_definition_id = target_object_id
      and target_record.record_status = 'active'
      and target_record.id in (
        select (value #>> '{}')::uuid
        from jsonb_array_elements(target_ids) as value
      );
    connection_key := 'connection:' ||
      (column_value ->> 'relationship_key') || ':' ||
      (column_value ->> 'direction');
    result := result || jsonb_build_object(connection_key, values_json);
  end loop;
  return result;
end;
$$;

create or replace function private.workspace_record_connection_sort_value(
  target_business_id uuid,
  current_record public.records,
  requested_relationship_key text,
  requested_direction text
)
returns text
language sql
stable
set search_path = ''
as $$
  select min(
    private.workspace_record_label(target_business_id, target_record)
  )
  from public.record_relationships as edge
  join public.records as target_record
    on target_record.business_id = target_business_id
   and target_record.record_status = 'active'
   and (
     (
       requested_direction = 'source'
       and target_record.id = edge.target_record_id
     )
     or (
       requested_direction = 'target'
       and target_record.id = edge.source_record_id
     )
   )
  join public.relationship_definitions as relationship_definition
    on relationship_definition.business_id = target_business_id
   and relationship_definition.id = edge.relationship_definition_id
   and relationship_definition.key = requested_relationship_key
   and relationship_definition.is_active
  where edge.business_id = target_business_id
    and (
      (
        requested_direction = 'source'
        and edge.source_record_id = current_record.id
      )
      or (
        requested_direction = 'target'
        and edge.target_record_id = current_record.id
      )
    );
$$;

create or replace function public.query_view_records(
  expected_business_id uuid,
  requested_view_key text,
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
  if not private.is_business_member(expected_business_id) then
    raise exception 'workspace_query_membership_required'
      using errcode = '42501';
  end if;
  if requested_limit is null or requested_limit not between 1 and 250
    or requested_offset is null or requested_offset not between 0 and 1000000
  then
    raise exception 'workspace_query_paging_invalid'
      using errcode = '22023';
  end if;

  select view_definition.* into target_view
  from public.views as view_definition
  where view_definition.business_id = expected_business_id
    and view_definition.key = requested_view_key
    and view_definition.view_type = 'table'
    and view_definition.audience = 'internal'
    and view_definition.is_active;
  if not found then
    raise exception 'workspace_query_view_not_found'
      using errcode = 'P0002';
  end if;
  config := target_view.config_json;
  object_id := target_view.object_definition_id;
  perform private.assert_valid_view_config_shape('table', config);

  select business.timezone into target_timezone
  from public.businesses as business
  where business.id = expected_business_id;
  target_timezone := coalesce(target_timezone, 'UTC');

  for sort_value in
    select value
    from jsonb_array_elements(coalesce(config -> 'sorts', '[]'::jsonb)) as value
  loop
    property_kind := split_part(sort_value ->> 'property', ':', 1);
    property_key := split_part(sort_value ->> 'property', ':', 2);
    if property_kind = 'field' then
      select definition.field_type into field_type
      from public.field_definitions as definition
      where definition.business_id = expected_business_id
        and definition.object_definition_id = object_id
        and definition.key = property_key
        and definition.is_active;
      is_field_sort := found;
      if not is_field_sort then
        raise exception 'workspace_query_sort_invalid'
          using errcode = '22023';
      end if;
    elsif property_kind = 'connection' then
      is_field_sort := false;
      connection_direction := null;
      connection_cardinality := null;
      select column_value ->> 'direction'
      into connection_direction
      from jsonb_array_elements(config -> 'columns') as column_value
      where column_value ->> 'kind' = 'connection'
        and column_value ->> 'relationship_key' = property_key
        and column_value ->> 'direction' = split_part(sort_value ->> 'property', ':', 3);
      select relationship_definition.cardinality::text
      into connection_cardinality
      from public.relationship_definitions as relationship_definition
      where relationship_definition.business_id = expected_business_id
        and relationship_definition.key = property_key
        and relationship_definition.is_active;
      if connection_direction is null
        or connection_cardinality is null
        or connection_cardinality = 'many_to_many'
        or (
          connection_cardinality = 'one_to_many'
          and connection_direction = 'target'
        )
      then
        raise exception 'workspace_query_sort_invalid'
          using errcode = '22023';
      end if;
    else
      raise exception 'workspace_query_sort_invalid'
        using errcode = '22023';
    end if;
    direction_sql := case
      when sort_value ->> 'direction' = 'descending' then 'desc'
      else 'asc'
    end;
    if is_field_sort and field_type in ('number', 'currency') then
      sort_sql := sort_sql || case when sort_sql = '' then '' else ', ' end ||
        format(
          'nullif(r.data_json ->> %L, '''')::numeric %s nulls last',
          property_key,
          direction_sql
        );
    elsif is_field_sort then
      sort_sql := sort_sql || case when sort_sql = '' then '' else ', ' end ||
        format(
          'r.data_json ->> %L %s nulls last',
          property_key,
          direction_sql
        );
    else
      sort_sql := sort_sql || case when sort_sql = '' then '' else ', ' end ||
        format(
          'private.workspace_record_connection_sort_value($1, r, %L, %L) %s nulls last',
          property_key,
          connection_direction,
          direction_sql
        );
    end if;
  end loop;

  if config -> 'group' <> 'null'::jsonb then
    property_kind := split_part(config ->> 'group', ':', 1);
    property_key := split_part(config ->> 'group', ':', 2);
    if property_kind = 'field' then
      if not exists (
        select 1
        from public.field_definitions as definition
        where definition.business_id = expected_business_id
          and definition.object_definition_id = object_id
          and definition.key = property_key
          and definition.is_active
          and definition.field_type in (
            'select',
            'status',
            'boolean',
            'date',
            'datetime'
          )
      ) then
        raise exception 'workspace_query_group_invalid'
          using errcode = '22023';
      end if;
      group_expression_sql := format(
        'selected_record.data_json -> %L',
        property_key
      );
      group_record_expression_sql := format(
        'r.data_json -> %L',
        property_key
      );
    elsif property_kind = 'connection' then
      connection_direction := split_part(config ->> 'group', ':', 3);
      if not exists (
        select 1
        from jsonb_array_elements(config -> 'columns') as column_value
        where column_value ->> 'kind' = 'connection'
          and column_value ->> 'relationship_key' = property_key
          and column_value ->> 'direction' = connection_direction
      ) or not exists (
        select 1
        from public.relationship_definitions as definition
        where definition.business_id = expected_business_id
          and definition.key = property_key
          and definition.is_active
          and (
            definition.cardinality = 'one_to_one'
            or (
              definition.cardinality = 'one_to_many'
              and connection_direction = 'source'
            )
          )
      ) then
        raise exception 'workspace_query_group_invalid'
          using errcode = '22023';
      end if;
      group_expression_sql := format(
        'to_jsonb(private.workspace_record_connection_sort_value($1, selected_record, %L, %L))',
        property_key,
        connection_direction
      );
      group_record_expression_sql := format(
        'to_jsonb(private.workspace_record_connection_sort_value($1, r, %L, %L))',
        property_key,
        connection_direction
      );
    else
      raise exception 'workspace_query_group_invalid'
        using errcode = '22023';
    end if;
  end if;
  if sort_sql = '' then
    sort_sql := 'r.created_at desc, r.id';
  else
    sort_sql := sort_sql || ', r.created_at desc, r.id';
  end if;
  aggregate_sort_sql := replace(
    replace(sort_sql, 'r.', 'selected_record.'),
    ', r,',
    ', selected_record,'
  );

  select count(*) into total_count
  from public.records as record_value
  where record_value.business_id = expected_business_id
    and record_value.object_definition_id = object_id
    and (
      coalesce(config ->> 'include_archived', 'false')::boolean
      or record_value.record_status = 'active'
    )
    and private.workspace_record_matches(
      expected_business_id,
      record_value,
      config,
      target_timezone
    );

  execute format(
    'select coalesce(
       jsonb_agg(
         jsonb_build_object(
           ''record'', to_jsonb(selected_record),
           ''connections'', private.workspace_connection_values($1, selected_record, $3),
           ''group_value'', case
             when ($3 ->> ''group'') is null then null
             else %s
           end
         )
         order by %s
       ),
       ''[]''::jsonb
     )
     from (
       select r.*
       from public.records as r
       where r.business_id = $1
         and r.object_definition_id = $2
         and (
           coalesce($3 ->> ''include_archived'', ''false'')::boolean
           or r.record_status = ''active''
         )
         and private.workspace_record_matches($1, r, $3, $4)
       order by %s
       limit $5 offset $6
     ) as selected_record',
    group_expression_sql,
    aggregate_sort_sql,
    sort_sql
  ) into records_json
  using
    expected_business_id,
    object_id,
    config,
    target_timezone,
    requested_limit,
    requested_offset;

  if config -> 'group' <> 'null'::jsonb then
    execute format(
      'select coalesce(
         jsonb_agg(
           jsonb_build_object(''value'', grouped.value, ''count'', grouped.count)
           order by grouped.value::text
         ),
         ''[]''::jsonb
       )
       from (
         select %s as value, count(*)
         from public.records as r
         where r.business_id = $1
           and r.object_definition_id = $2
           and (
             coalesce($3 ->> ''include_archived'', ''false'')::boolean
             or r.record_status = ''active''
           )
           and private.workspace_record_matches($1, r, $3, $4)
         group by %s
       ) as grouped',
      group_record_expression_sql,
      group_record_expression_sql
    )
      into groups_json
      using expected_business_id, object_id, config, target_timezone;
  end if;

  return jsonb_build_object(
    'view_key', requested_view_key,
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

create or replace function public.search_view_connection_targets(
  expected_business_id uuid,
  requested_view_key text,
  requested_relationship_key text,
  requested_direction text,
  requested_search text default '',
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
  relationship_definition public.relationship_definitions;
  current_object_id uuid;
  target_object_id uuid;
  targets jsonb;
  search_text text := left(btrim(coalesce(requested_search, '')), 200);
begin
  if not private.is_business_member(expected_business_id) then
    raise exception 'workspace_connection_search_membership_required'
      using errcode = '42501';
  end if;
  if requested_limit is null or requested_limit not between 1 and 50
    or requested_offset is null or requested_offset not between 0 and 1000000
    or requested_direction not in ('source', 'target')
  then
    raise exception 'workspace_connection_search_invalid'
      using errcode = '22023';
  end if;

  select view_definition.* into target_view
  from public.views as view_definition
  where view_definition.business_id = expected_business_id
    and view_definition.key = requested_view_key
    and view_definition.view_type = 'table'
    and view_definition.audience = 'internal'
    and view_definition.is_active;
  if not found then
    raise exception 'workspace_query_view_not_found'
      using errcode = 'P0002';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(target_view.config_json -> 'columns') as column_value
    where column_value ->> 'kind' = 'connection'
      and column_value ->> 'relationship_key' = requested_relationship_key
      and column_value ->> 'direction' = requested_direction
  ) then
    raise exception 'workspace_connection_column_not_found'
      using errcode = 'P0002';
  end if;

  select definition.* into relationship_definition
  from public.relationship_definitions as definition
  where definition.business_id = expected_business_id
    and definition.key = requested_relationship_key
    and definition.is_active;
  if not found then
    raise exception 'workspace_connection_not_found'
      using errcode = 'P0002';
  end if;
  current_object_id := target_view.object_definition_id;
  if requested_direction = 'source' then
    if relationship_definition.source_object_definition_id <> current_object_id then
      raise exception 'workspace_connection_direction_invalid'
        using errcode = '22023';
    end if;
    target_object_id := relationship_definition.target_object_definition_id;
  else
    if relationship_definition.target_object_definition_id <> current_object_id then
      raise exception 'workspace_connection_direction_invalid'
        using errcode = '22023';
    end if;
    target_object_id := relationship_definition.source_object_definition_id;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object('id', candidate.id, 'label', candidate.label)
    order by candidate.label collate "C", candidate.id
  ), '[]'::jsonb)
  into targets
  from (
    select record_value.id,
      private.workspace_record_label(expected_business_id, record_value) as label
    from public.records as record_value
    where record_value.business_id = expected_business_id
      and record_value.object_definition_id = target_object_id
      and record_value.record_status = 'active'
      and (
        search_text = ''
        or private.workspace_record_label(expected_business_id, record_value)
          ilike '%' || search_text || '%'
      )
    order by private.workspace_record_label(expected_business_id, record_value)
      collate "C",
      record_value.id
    limit requested_limit offset requested_offset
  ) as candidate;
  return jsonb_build_object(
    'targets', targets,
    'limit', requested_limit,
    'offset', requested_offset
  );
end;
$$;

create or replace function public.set_record_connection_values(
  expected_business_id uuid,
  requested_view_key text,
  requested_record_id uuid,
  requested_relationship_key text,
  requested_direction text,
  requested_target_record_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_view public.views;
  relationship_definition public.relationship_definitions;
  current_record public.records;
  target_object_id uuid;
  target_count integer;
  target_id uuid;
  source_id uuid;
  target_id_for_insert uuid;
begin
  if not private.is_business_member(expected_business_id) then
    raise exception 'workspace_connection_write_membership_required'
      using errcode = '42501';
  end if;
  if requested_direction not in ('source', 'target')
    or coalesce(array_length(requested_target_record_ids, 1), 0) > 100
    or (
      select count(*) from unnest(coalesce(requested_target_record_ids, '{}'::uuid[]))
    ) <> (
      select count(distinct value)
      from unnest(coalesce(requested_target_record_ids, '{}'::uuid[])) as value
    )
  then
    raise exception 'workspace_connection_write_invalid'
      using errcode = '22023';
  end if;

  select view_definition.* into target_view
  from public.views as view_definition
  where view_definition.business_id = expected_business_id
    and view_definition.key = requested_view_key
    and view_definition.view_type = 'table'
    and view_definition.audience = 'internal'
    and view_definition.is_active;
  if not found then
    raise exception 'workspace_query_view_not_found'
      using errcode = 'P0002';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(target_view.config_json -> 'columns') as column_value
    where column_value ->> 'kind' = 'connection'
      and column_value ->> 'relationship_key' = requested_relationship_key
      and column_value ->> 'direction' = requested_direction
  ) then
    raise exception 'workspace_connection_column_not_found'
      using errcode = 'P0002';
  end if;

  select record_value.* into current_record
  from public.records as record_value
  where record_value.business_id = expected_business_id
    and record_value.id = requested_record_id
    and record_value.object_definition_id = target_view.object_definition_id
    and record_value.record_status = 'active';
  if not found then
    raise exception 'workspace_connection_record_not_found'
      using errcode = 'P0002';
  end if;

  select definition.* into relationship_definition
  from public.relationship_definitions as definition
  where definition.business_id = expected_business_id
    and definition.key = requested_relationship_key
    and definition.is_active;
  if not found then
    raise exception 'workspace_connection_not_found'
      using errcode = 'P0002';
  end if;
  if requested_direction = 'source' then
    if relationship_definition.source_object_definition_id <> current_record.object_definition_id then
      raise exception 'workspace_connection_direction_invalid'
        using errcode = '22023';
    end if;
    target_object_id := relationship_definition.target_object_definition_id;
  else
    if relationship_definition.target_object_definition_id <> current_record.object_definition_id then
      raise exception 'workspace_connection_direction_invalid'
        using errcode = '22023';
    end if;
    target_object_id := relationship_definition.source_object_definition_id;
  end if;
  target_count := coalesce(array_length(requested_target_record_ids, 1), 0);
  if relationship_definition.cardinality = 'one_to_one'
    and target_count > 1
  then
    raise exception 'workspace_connection_cardinality_invalid'
      using errcode = '22023';
  end if;
  if relationship_definition.cardinality = 'one_to_many'
    and requested_direction = 'source'
    and target_count > 1
  then
    raise exception 'workspace_connection_cardinality_invalid'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(coalesce(requested_target_record_ids, '{}'::uuid[])) as requested_id
    where not exists (
      select 1
      from public.records as record_value
      where record_value.business_id = expected_business_id
        and record_value.id = requested_id
        and record_value.object_definition_id = target_object_id
        and record_value.record_status = 'active'
    )
  ) then
    raise exception 'workspace_connection_target_invalid'
      using errcode = '22023';
  end if;

  if requested_direction = 'source' then
    delete from public.record_relationships as edge
    where edge.business_id = expected_business_id
      and edge.relationship_definition_id = relationship_definition.id
      and edge.source_record_id = current_record.id;
  else
    delete from public.record_relationships as edge
    where edge.business_id = expected_business_id
      and edge.relationship_definition_id = relationship_definition.id
      and edge.target_record_id = current_record.id;
  end if;

  foreach target_id in array coalesce(requested_target_record_ids, '{}'::uuid[])
  loop
    if requested_direction = 'source' then
      source_id := current_record.id;
      target_id_for_insert := target_id;
    else
      source_id := target_id;
      target_id_for_insert := current_record.id;
    end if;
    insert into public.record_relationships (
      business_id,
      relationship_definition_id,
      source_record_id,
      target_record_id
    ) values (
      expected_business_id,
      relationship_definition.id,
      source_id,
      target_id_for_insert
    );
  end loop;

  return jsonb_build_object(
    'record_id', current_record.id,
    'relationship_key', requested_relationship_key,
    'direction', requested_direction,
    'target_record_ids', to_jsonb(coalesce(requested_target_record_ids, '{}'::uuid[]))
  );
end;
$$;

revoke all on function public.query_view_records(uuid, text, integer, integer)
  from public, anon;
revoke all on function public.search_view_connection_targets(
  uuid, text, text, text, text, integer, integer
) from public, anon;
revoke all on function public.set_record_connection_values(
  uuid, text, uuid, text, text, uuid[]
) from public, anon;
grant execute on function public.query_view_records(uuid, text, integer, integer)
  to authenticated;
grant execute on function public.search_view_connection_targets(
  uuid, text, text, text, text, integer, integer
) to authenticated;
grant execute on function public.set_record_connection_values(
  uuid, text, uuid, text, text, uuid[]
) to authenticated;

comment on function public.query_view_records(uuid, text, integer, integer) is
  'Bounded, server-validated Table View query. The browser supplies only a trusted View key and paging.';
comment on function public.set_record_connection_values(
  uuid, text, uuid, text, text, uuid[]
) is
  'Atomic operational Connection replacement for one side of a configured Table property. It never changes configuration versions.';
