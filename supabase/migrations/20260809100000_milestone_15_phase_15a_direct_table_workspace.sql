-- Milestone 15 Phase 15A: direct Table Workspace configuration actions.
--
-- The direct lane is intentionally a narrow owner-facing facade over the
-- existing M5 propose -> validate -> apply transaction. It does not create a
-- second configuration projector or permit arbitrary operations.

create or replace function private.assert_valid_view_config_shape(
  requested_view_type public.experience_view_type,
  config jsonb
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  width_key text;
  width_value jsonb;
begin
  if jsonb_typeof(config) <> 'object' then
    raise exception 'View configuration must be a JSON object'
      using errcode = '22023';
  end if;

  if requested_view_type = 'table' then
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
    ) or not private.experience_string_array_is_valid(
      config -> 'fields',
      false
    ) then
      raise exception 'Invalid Table View configuration'
        using errcode = '22023';
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
          from jsonb_array_elements_text(config -> 'fields') as visible_field
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
      or not private.experience_string_array_is_valid(
        config -> 'secondary_fields',
        true
      ) then
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
      or not private.experience_string_array_is_valid(
        config -> 'supporting_fields',
        true
      ) then
      raise exception 'Invalid Cards View configuration'
        using errcode = '22023';
    end if;
  elsif requested_view_type = 'detail' then
    if not private.experience_json_has_only_keys(
      config,
      array[
        'fields',
        'title_field',
        'edit_form_key',
        'include_archived'
      ]
    ) or not private.experience_string_array_is_valid(
      config -> 'fields',
      false
    ) then
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
    and jsonb_typeof(config -> 'include_archived') <> 'boolean' then
    raise exception 'View include_archived must be a boolean'
      using errcode = '22023';
  end if;
end;
$$;

create or replace function private.direct_table_snapshot_collections_unchanged_v1(
  base_snapshot jsonb,
  candidate_snapshot jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select base_snapshot -> 'relationship_definitions' =
      candidate_snapshot -> 'relationship_definitions'
    and base_snapshot -> 'forms' = candidate_snapshot -> 'forms'
    and base_snapshot -> 'pages' = candidate_snapshot -> 'pages'
    and base_snapshot -> 'preorder_experiences' =
      candidate_snapshot -> 'preorder_experiences'
    and base_snapshot -> 'preorder_experience_locations' =
      candidate_snapshot -> 'preorder_experience_locations';
$$;

create or replace function private.direct_table_options_are_valid_v1(
  settings jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(settings -> 'options') = 'array'
    and coalesce(jsonb_array_length(settings -> 'options'), 0) between 2 and 100
    and not exists (
      select 1
      from jsonb_array_elements(settings -> 'options') as option_value
      where jsonb_typeof(option_value) <> 'string'
        or btrim(option_value #>> '{}') = ''
    )
    and not exists (
      select 1
      from jsonb_array_elements_text(settings -> 'options') as option_value
      group by lower(btrim(option_value))
      having count(*) > 1
    );
$$;

create or replace function private.direct_table_value_is_meaningful_v1(
  candidate_value jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if candidate_value is null
    or jsonb_typeof(candidate_value) = 'null'
  then
    return false;
  end if;

  if jsonb_typeof(candidate_value) = 'string' then
    return btrim(candidate_value #>> '{}') <> '';
  end if;

  if jsonb_typeof(candidate_value) = 'array' then
    return jsonb_array_length(candidate_value) > 0;
  end if;

  if jsonb_typeof(candidate_value) = 'object' then
    return jsonb_object_length(candidate_value) > 0;
  end if;

  -- false and numeric zero are meaningful operational values.
  return true;
end;
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

create or replace function public.apply_direct_configuration_change(
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

  proposed := public.propose_configuration_change(
    expected_business_id,
    expected_actor_id,
    expected_base_version_id,
    expected_head_revision,
    left('Table Workspace: ' || requested_action_kind, 120),
    'direct_table_workspace:' || requested_action_kind,
    requested_operations
  );

  select version.* into base_version
  from public.configuration_versions as version
  where version.business_id = expected_business_id
    and version.id = proposed.base_version_id;
  if not found then
    raise exception 'direct_table_action_shape_invalid'
      using errcode = '22023';
  end if;

  perform private.assert_direct_table_action_shape_v1(
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

create or replace function public.undo_direct_configuration_change(
  expected_business_id uuid,
  expected_actor_id uuid,
  expected_active_source_version_id uuid,
  expected_head_revision bigint
)
returns public.configuration_change_sets
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  current_head public.business_configuration_heads;
  source_version public.configuration_versions;
  parent_version public.configuration_versions;
  source_change public.configuration_change_sets;
  rollback public.configuration_change_sets;
  validated public.configuration_change_sets;
  applied public.configuration_change_sets;
  action_kind text;
  target_object_definition_id uuid;
  target_field_key text;
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

  select head.* into current_head
  from public.business_configuration_heads as head
  where head.business_id = expected_business_id
  for update;
  if not found
    or current_head.active_version_id is distinct from
      expected_active_source_version_id
    or current_head.head_revision is distinct from expected_head_revision
  then
    raise exception 'direct_configuration_stale'
      using errcode = 'P0001';
  end if;

  select version.* into source_version
  from public.configuration_versions as version
  where version.business_id = expected_business_id
    and version.id = current_head.active_version_id;
  if not found or source_version.kind <> 'change'
    or source_version.parent_version_id is null
    or source_version.source_change_set_id is null
  then
    raise exception 'direct_table_undo_not_available'
      using errcode = '22023';
  end if;

  select change_set.* into source_change
  from public.configuration_change_sets as change_set
  where change_set.business_id = expected_business_id
    and change_set.id = source_version.source_change_set_id
    and change_set.status = 'applied'
    and change_set.applied_version_id = source_version.id;
  if not found or source_change.description is null
    or left(source_change.description, 23) <> 'direct_table_workspace:'
  then
    raise exception 'direct_table_undo_not_available'
      using errcode = '22023';
  end if;

  action_kind := substring(source_change.description from 24);
  select version.* into parent_version
  from public.configuration_versions as version
  where version.business_id = expected_business_id
    and version.id = source_version.parent_version_id;
  if not found then
    raise exception 'direct_table_undo_not_available'
      using errcode = '22023';
  end if;

  perform private.assert_direct_table_action_shape_v1(
    action_kind,
    parent_version.snapshot_json,
    source_version.snapshot_json,
    source_change.operations_json
  );

  if action_kind = 'create_table' then
    select (object_definition ->> 'id')::uuid
      into target_object_definition_id
    from jsonb_array_elements(source_version.snapshot_json -> 'object_definitions')
      as object_definition
    where object_definition ->> 'key' = (
      select operation ->> 'key'
      from jsonb_array_elements(source_change.operations_json) as operation
      where operation ->> 'op' = 'set_object'
      limit 1
    );

    if target_object_definition_id is null
      or exists (
        select 1
        from public.records as record_value
        where record_value.business_id = expected_business_id
          and record_value.object_definition_id = target_object_definition_id
      )
    then
      raise exception 'direct_table_undo_not_available'
        using errcode = '22023';
    end if;
  elsif action_kind = 'add_column' then
    select operation ->> 'key'
      into target_field_key
    from jsonb_array_elements(source_change.operations_json) as operation
    where operation ->> 'op' = 'set_field'
    limit 1;

    if target_field_key is null
      or exists (
        select 1
        from jsonb_array_elements(source_version.snapshot_json -> 'field_definitions')
          as field_definition
        join public.records as record_value
          on record_value.business_id = expected_business_id
         and record_value.object_definition_id =
           (field_definition ->> 'object_definition_id')::uuid
        where field_definition ->> 'key' = target_field_key
          and private.direct_table_value_is_meaningful_v1(
            record_value.data_json -> target_field_key
          )
      )
    then
      raise exception 'direct_table_undo_not_available'
        using errcode = '22023';
    end if;
  end if;

  rollback := public.prepare_configuration_rollback(
    expected_business_id,
    expected_actor_id,
    expected_active_source_version_id,
    expected_head_revision,
    parent_version.id,
    'Undo Table Workspace change',
    'direct_table_workspace_undo'
  );
  validated := public.validate_configuration_change(
    expected_business_id,
    expected_actor_id,
    rollback.id
  );
  if validated.status <> 'validated'
    or validated.validation_result_json ->> 'outcome' <> 'valid'
  then
    raise exception 'direct_configuration_undo_incompatible'
      using errcode = 'P0001';
  end if;
  applied := public.apply_configuration_change(
    expected_business_id,
    expected_actor_id,
    rollback.id
  );
  if applied.status <> 'applied' then
    raise exception 'direct_configuration_undo_incompatible'
      using errcode = 'P0001';
  end if;
  return applied;
end;
$$;

revoke all on function public.apply_direct_configuration_change(
  uuid, uuid, uuid, bigint, text, jsonb
) from public, anon, service_role;
grant execute on function public.apply_direct_configuration_change(
  uuid, uuid, uuid, bigint, text, jsonb
) to authenticated;

revoke all on function public.undo_direct_configuration_change(
  uuid, uuid, uuid, bigint
) from public, anon, service_role;
grant execute on function public.undo_direct_configuration_change(
  uuid, uuid, uuid, bigint
) to authenticated;

comment on function public.apply_direct_configuration_change(
  uuid, uuid, uuid, bigint, text, jsonb
) is
  'Atomic owner-facing Table Workspace action over the M5 configuration engine.';

comment on function public.undo_direct_configuration_change(
  uuid, uuid, uuid, bigint
) is
  'Atomic undo of the immediately active direct Table Workspace change.';
