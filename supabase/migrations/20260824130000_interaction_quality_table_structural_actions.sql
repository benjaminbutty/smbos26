-- The Table Workspace composes ordinary configuration operations, but only a
-- deliberately small subset may be applied directly.  Keep currency-aware
-- add, insert and reorder actions on the existing Lenni boundary and validate the exact
-- candidate shape, including the Table's own create/edit Forms.

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
  form_operation jsonb;
  base_field jsonb;
  candidate_field jsonb;
  base_view jsonb;
  candidate_view jsonb;
  base_form jsonb;
  candidate_form jsonb;
  base_fields jsonb;
  candidate_fields jsonb;
  target_key text;
begin
  if action_kind not in (
    'add_column',
    'insert_column',
    'change_column_type',
    'reorder_columns'
  ) then
    raise exception 'direct_table_action_shape_invalid'
      using errcode = '22023';
  end if;

  perform private.assert_configuration_operations_v1(operations);

  if action_kind = 'reorder_columns' then
    select value into view_operation
    from jsonb_array_elements(operations) as value
    where value ->> 'op' = 'set_view';

    if jsonb_array_length(operations) <> 1
      or view_operation is null
      or view_operation ->> 'op' <> 'set_view'
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
      or candidate_view -> 'config_json' <> view_operation -> 'config_json'
      or jsonb_array_length(candidate_snapshot -> 'views') <>
        jsonb_array_length(base_snapshot -> 'views')
      or exists (
        select 1
        from jsonb_array_elements(base_snapshot -> 'views') as old_view
        where old_view ->> 'key' <> view_operation ->> 'key'
          and not exists (
            select 1
            from jsonb_array_elements(candidate_snapshot -> 'views') as next_view
            where next_view = old_view
          )
      )
      or exists (
        select 1
        from jsonb_array_elements(candidate_snapshot -> 'views') as next_view
        where next_view ->> 'key' <> view_operation ->> 'key'
          and not exists (
            select 1
            from jsonb_array_elements(base_snapshot -> 'views') as old_view
            where old_view = next_view
          )
      )
      or (base_snapshot -> 'object_definitions') <>
        (candidate_snapshot -> 'object_definitions')
      or (base_snapshot -> 'field_definitions') <>
        (candidate_snapshot -> 'field_definitions')
      or not private.direct_table_snapshot_collections_unchanged_v1(
        base_snapshot,
        candidate_snapshot
      )
    then
      raise exception 'direct_table_action_shape_invalid'
        using errcode = '22023';
    end if;

    if base_view -> 'config_json' ->> 'schema_version' = '2' then
      if candidate_view -> 'config_json' ->> 'schema_version' <> '2'
        or (candidate_view -> 'config_json') - 'fields'::text - 'columns'::text <>
          (base_view -> 'config_json') - 'fields'::text - 'columns'::text
        or jsonb_array_length(candidate_view -> 'config_json' -> 'columns') <>
          jsonb_array_length(base_view -> 'config_json' -> 'columns')
        or exists (
          select 1
          from jsonb_array_elements(candidate_view -> 'config_json' -> 'columns')
            as next_column
          where not exists (
            select 1
            from jsonb_array_elements(base_view -> 'config_json' -> 'columns')
              as old_column
            where old_column = next_column
          )
        )
        or exists (
          select 1
          from jsonb_array_elements(base_view -> 'config_json' -> 'columns')
            as old_column
          where not exists (
            select 1
            from jsonb_array_elements(candidate_view -> 'config_json' -> 'columns')
              as next_column
            where next_column = old_column
          )
        )
        or candidate_view -> 'config_json' -> 'fields' <> (
          select coalesce(
            jsonb_agg(column_value -> 'field_key' order by ordinality),
            '[]'::jsonb
          )
          from jsonb_array_elements(candidate_view -> 'config_json' -> 'columns')
            with ordinality as columns(column_value, ordinality)
          where column_value ->> 'kind' = 'field'
        )
      then
        raise exception 'direct_table_action_shape_invalid'
          using errcode = '22023';
      end if;
    elsif (candidate_view -> 'config_json') - 'fields'::text <>
        (base_view -> 'config_json') - 'fields'::text
      or jsonb_array_length(candidate_view -> 'config_json' -> 'fields') <>
        jsonb_array_length(base_view -> 'config_json' -> 'fields')
      or exists (
        select 1
        from jsonb_array_elements_text(candidate_view -> 'config_json' -> 'fields')
          as next_field
        where not exists (
          select 1
          from jsonb_array_elements_text(base_view -> 'config_json' -> 'fields')
            as old_field
          where old_field = next_field
        )
      )
      or exists (
        select 1
        from jsonb_array_elements_text(candidate_view -> 'config_json' -> 'fields')
          as next_field
        group by next_field
        having count(*) > 1
      )
    then
      raise exception 'direct_table_action_shape_invalid'
        using errcode = '22023';
    end if;
    return;
  end if;

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

  if action_kind in ('add_column', 'insert_column') then
    if jsonb_array_length(operations) not between 2 and 4
      or (select count(*) from jsonb_array_elements(operations) as item
          where item ->> 'op' = 'set_field') <> 1
      or (select count(*) from jsonb_array_elements(operations) as item
          where item ->> 'op' = 'set_view') <> 1
      or exists (
        select 1
        from jsonb_array_elements(operations) as item
        where item ->> 'op' not in ('set_field', 'set_form', 'set_view')
      )
      or view_operation is null
      or base_field is not null
      or candidate_field is null
      or (candidate_snapshot -> 'object_definitions') <>
        (base_snapshot -> 'object_definitions')
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
      or exists (
        select 1
        from jsonb_array_elements(base_snapshot -> 'field_definitions') as old_field
        where not exists (
          select 1
          from jsonb_array_elements(candidate_snapshot -> 'field_definitions') as next_field
          where next_field = old_field
        )
      )
      or exists (
        select 1
        from jsonb_array_elements(candidate_snapshot -> 'field_definitions') as next_field
        where next_field <> candidate_field
          and not exists (
            select 1
            from jsonb_array_elements(base_snapshot -> 'field_definitions') as old_field
            where old_field = next_field
          )
      )
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
      or candidate_view -> 'config_json' <> view_operation -> 'config_json'
      or jsonb_array_length(candidate_snapshot -> 'views') <>
        jsonb_array_length(base_snapshot -> 'views')
      or exists (
        select 1
        from jsonb_array_elements(base_snapshot -> 'views') as old_view
        where old_view ->> 'key' <> view_operation ->> 'key'
          and not exists (
            select 1
            from jsonb_array_elements(candidate_snapshot -> 'views') as next_view
            where next_view = old_view
          )
      )
      or exists (
        select 1
        from jsonb_array_elements(candidate_snapshot -> 'views') as next_view
        where next_view ->> 'key' <> view_operation ->> 'key'
          and not exists (
            select 1
            from jsonb_array_elements(base_snapshot -> 'views') as old_view
            where old_view = next_view
          )
      )
    then
      raise exception 'direct_table_action_shape_invalid'
        using errcode = '22023';
    end if;

    if base_view -> 'config_json' ->> 'schema_version' = '2' then
      if (candidate_view -> 'config_json') - 'fields'::text - 'columns'::text <>
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
    else
      base_fields := base_view -> 'config_json' -> 'fields';
      candidate_fields := candidate_view -> 'config_json' -> 'fields';
      if (candidate_view -> 'config_json') - 'fields'::text <>
          (base_view -> 'config_json') - 'fields'::text
        or not private.direct_table_fields_preserve_order_with_insert_v2(
          base_fields,
          candidate_fields,
          field_operation ->> 'key'
        )
      then
        raise exception 'direct_table_action_shape_invalid'
          using errcode = '22023';
      end if;
    end if;

    -- Only the Table's configured internal create/edit Forms may receive the
    -- new property, and they can only append the standard visible field.
    for form_operation in
      select value
      from jsonb_array_elements(operations) as value
      where value ->> 'op' = 'set_form'
    loop
      select value into base_form
      from jsonb_array_elements(base_snapshot -> 'forms') as value
      where value ->> 'key' = form_operation ->> 'key';
      select value into candidate_form
      from jsonb_array_elements(candidate_snapshot -> 'forms') as value
      where value ->> 'key' = form_operation ->> 'key';

      if base_form is null or candidate_form is null
        or form_operation ->> 'name' <> base_form ->> 'name'
        or form_operation ->> 'object_key' <> field_operation ->> 'object_key'
        or form_operation ->> 'mode' <> base_form ->> 'mode'
        or form_operation ->> 'audience' <> 'internal'
        or not (form_operation ->> 'is_active')::boolean
        or base_form ->> 'object_key' <> field_operation ->> 'object_key'
        or base_form ->> 'audience' <> 'internal'
        or not (base_form ->> 'is_active')::boolean
        or not (
          (base_view -> 'config_json' ->> 'create_form_key' =
            form_operation ->> 'key'
            and form_operation ->> 'mode' = 'create')
          or
          (base_view -> 'config_json' ->> 'edit_form_key' =
            form_operation ->> 'key'
            and form_operation ->> 'mode' = 'edit')
        )
        or candidate_form - 'config_json'::text <>
          base_form - 'config_json'::text
        or candidate_form -> 'config_json' <>
          form_operation -> 'config_json'
        or (candidate_form -> 'config_json') - 'fields'::text <>
          (base_form -> 'config_json') - 'fields'::text
        or candidate_form -> 'config_json' -> 'fields' <>
          (base_form -> 'config_json' -> 'fields') || jsonb_build_array(
            jsonb_build_object(
              'field', field_operation ->> 'key',
              'hidden', false
            )
          )
      then
        raise exception 'direct_table_action_shape_invalid'
          using errcode = '22023';
      end if;
    end loop;

    if jsonb_array_length(candidate_snapshot -> 'forms') <>
        jsonb_array_length(base_snapshot -> 'forms')
      or exists (
        select 1
        from jsonb_array_elements(base_snapshot -> 'forms') as old_form
        where not exists (
          select 1
          from jsonb_array_elements(candidate_snapshot -> 'forms') as next_form
          where next_form ->> 'key' = old_form ->> 'key'
            and (
              exists (
                select 1
                from jsonb_array_elements(operations) as item
                where item ->> 'op' = 'set_form'
                  and item ->> 'key' = old_form ->> 'key'
              )
              or next_form = old_form
            )
        )
      )
      or exists (
        select 1
        from jsonb_array_elements(candidate_snapshot -> 'forms') as next_form
        where not exists (
          select 1
          from jsonb_array_elements(base_snapshot -> 'forms') as old_form
          where old_form ->> 'key' = next_form ->> 'key'
        )
      )
      or (base_snapshot -> 'relationship_definitions') <>
        (candidate_snapshot -> 'relationship_definitions')
      or (base_snapshot -> 'pages') <> (candidate_snapshot -> 'pages')
      or (base_snapshot -> 'preorder_experiences') <>
        (candidate_snapshot -> 'preorder_experiences')
      or (base_snapshot -> 'preorder_experience_locations') <>
        (candidate_snapshot -> 'preorder_experience_locations')
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
    or (candidate_snapshot -> 'views') <> (base_snapshot -> 'views')
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

create or replace function public.apply_lenni_direct_configuration_change(
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
    'add_column',
    'insert_column',
    'change_column_type',
    'reorder_columns'
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

  perform private.assert_lenni_direct_table_action_shape_v1(
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

  if action_kind in (
    'add_column',
    'insert_column',
    'change_column_type',
    'reorder_columns'
  ) then
    perform private.assert_lenni_direct_table_action_shape_v1(
      action_kind,
      parent_version.snapshot_json,
      source_version.snapshot_json,
      source_change.operations_json
    );
  else
    perform private.assert_direct_table_action_shape_v1(
      action_kind,
      parent_version.snapshot_json,
      source_version.snapshot_json,
      source_change.operations_json
    );
  end if;

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
  elsif action_kind in ('add_column', 'insert_column') then
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

revoke all on function public.apply_lenni_direct_configuration_change(
  uuid, uuid, uuid, bigint, text, jsonb
) from public, anon, service_role;
grant execute on function public.apply_lenni_direct_configuration_change(
  uuid, uuid, uuid, bigint, text, jsonb
) to authenticated;
