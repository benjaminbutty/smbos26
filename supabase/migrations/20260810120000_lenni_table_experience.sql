-- Lenni Table Experience: bounded structural actions and one operational
-- batch boundary. Existing M5 configuration tables remain authoritative.

create or replace function private.validate_field_definition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.business_id is distinct from old.business_id
      or new.object_definition_id is distinct from old.object_definition_id
      or new.key is distinct from old.key then
      raise exception 'Field definition business, object and key are immutable'
        using errcode = '22023';
    end if;

    perform 1
    from public.object_definitions as object_definition
    where object_definition.business_id = new.business_id
      and object_definition.id = new.object_definition_id
    for update;
  end if;

  if new.field_type in ('select', 'multi_select', 'status')
    and not private.graph_options_are_valid(new.settings_json) then
    raise exception 'Select, multi-select and status fields require valid options'
      using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    perform 1
    from public.object_definitions as object_definition
    where object_definition.business_id = new.business_id
      and object_definition.id = new.object_definition_id
    for update;
  end if;

  if new.default_value is not null
    and not private.graph_field_value_is_valid(
      new.default_value,
      new.field_type,
      new.settings_json
    ) then
    raise exception 'Field default value is invalid'
      using errcode = '22023';
  end if;

  if new.required
    and new.default_value is not null
    and not private.graph_value_is_present(new.default_value) then
    raise exception 'Required Field default value must be present'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function private.direct_table_type_is_supported_v2(
  requested_type text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    requested_type in (
      'short_text',
      'long_text',
      'number',
      'currency',
      'boolean',
      'date',
      'email',
      'phone',
      'url',
      'select',
      'status'
    ),
    false
  );
$$;

create or replace function private.direct_table_settings_are_valid_v2(
  requested_type text,
  requested_settings jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    case
      when requested_type in ('select', 'status')
        then private.direct_table_options_are_valid_v1(requested_settings)
      when requested_type = 'currency'
        then jsonb_typeof(requested_settings) = 'object'
          and requested_settings ? 'currency'
          and requested_settings ->> 'currency' ~ '^[A-Z]{3}$'
      else requested_settings = '{}'::jsonb
    end,
    false
  );
$$;

create or replace function private.direct_table_fields_preserve_order_with_insert_v2(
  base_fields jsonb,
  candidate_fields jsonb,
  inserted_key text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_array_length(candidate_fields) =
      jsonb_array_length(base_fields) + 1
    and (
      select count(*)
      from jsonb_array_elements_text(candidate_fields) as item
      where item = inserted_key
    ) = 1
    and (
      select jsonb_agg(to_jsonb(item) order by ordinal)
      from jsonb_array_elements_text(candidate_fields)
        with ordinality as next_fields(item, ordinal)
      where item <> inserted_key
    ) = base_fields;
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
  if requested_action_kind not in ('insert_column', 'change_column_type') then
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

  if action_kind in ('insert_column', 'change_column_type') then
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

create or replace function public.apply_direct_table_record_batch(
  expected_business_id uuid,
  requested_view_key text,
  requested_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_view public.views;
  target_record public.records;
  row_input jsonb;
  values_input jsonb;
  proposed_data jsonb;
  record_id uuid;
  primary_key text;
  row_index integer := 0;
  field_key text;
  field_value jsonb;
  failure_message text;
  record_ids jsonb := '[]'::jsonb;
  failures jsonb := '[]'::jsonb;
begin
  if not private.is_business_member(expected_business_id) then
    raise exception 'record_batch_membership_required'
      using errcode = '42501';
  end if;
  if coalesce(jsonb_typeof(requested_rows), '') <> 'array'
    or jsonb_array_length(requested_rows) < 1
    or jsonb_array_length(requested_rows) > 100
  then
    raise exception 'record_batch_size_invalid'
      using errcode = '22023';
  end if;
  if (
    select count(*)
    from jsonb_array_elements(requested_rows) as row_value
    cross join lateral jsonb_each(
      case
        when jsonb_typeof(row_value.value -> 'values') = 'object'
          then row_value.value -> 'values'
        else '{}'::jsonb
      end
    ) as entry
  ) > 500 then
    raise exception 'record_batch_cell_count_invalid'
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
    raise exception 'record_batch_view_not_found'
      using errcode = 'P0002';
  end if;

  primary_key := coalesce(
    target_view.config_json ->> 'title_field',
    target_view.config_json -> 'fields' ->> 0
  );

  for row_input in
    select value
    from jsonb_array_elements(requested_rows) as value
  loop
    begin
      if jsonb_typeof(row_input) <> 'object'
        or jsonb_typeof(row_input -> 'values') <> 'object'
      then
        raise exception 'Each pasted row must contain values.'
          using errcode = '22023';
      end if;

      values_input := row_input -> 'values';
      proposed_data := '{}'::jsonb;
      for field_key, field_value in
        select entry.key, entry.value
        from jsonb_each(values_input) as entry
      loop
        if not exists (
          select 1
          from jsonb_array_elements_text(target_view.config_json -> 'fields')
            as visible_field
          where visible_field = field_key
        ) then
          raise exception 'That pasted property is not part of this Table.'
            using errcode = '22023';
        end if;

        perform 1
        from public.field_definitions as field_definition
        where field_definition.business_id = expected_business_id
          and field_definition.object_definition_id =
            target_view.object_definition_id
          and field_definition.key = field_key
          and field_definition.is_active
          and field_definition.field_type in (
            'short_text', 'long_text', 'number', 'currency', 'boolean',
            'date', 'email', 'phone', 'url', 'select', 'status'
          )
          and (
            not (target_view.config_json ? 'edit_form_key')
            or exists (
              select 1
              from public.forms as form_definition
              cross join lateral jsonb_array_elements(
                form_definition.config_json -> 'fields'
              ) as form_field
              where form_definition.business_id = expected_business_id
                and form_definition.key =
                  target_view.config_json ->> 'edit_form_key'
                and form_definition.object_definition_id =
                  target_view.object_definition_id
                and form_definition.mode = 'edit'
                and form_definition.audience = 'internal'
                and form_definition.is_active
                and form_field ->> 'field' = field_key
                and coalesce((form_field ->> 'hidden')::boolean, false) = false
            )
          );
        if not found then
          raise exception 'That property cannot be edited in this Table.'
            using errcode = '22023';
        end if;
        proposed_data := proposed_data || jsonb_build_object(field_key, field_value);
      end loop;

      if row_input ? 'recordId' and row_input ->> 'recordId' is not null then
        record_id := (row_input ->> 'recordId')::uuid;
        select record_value.* into target_record
        from public.records as record_value
        where record_value.business_id = expected_business_id
          and record_value.object_definition_id = target_view.object_definition_id
          and record_value.id = record_id
        for update;
        if not found then
          raise exception 'That Record is no longer available.'
            using errcode = 'P0002';
        end if;
        proposed_data := target_record.data_json || proposed_data;
        perform private.assert_valid_graph_record_data(
          expected_business_id,
          target_view.object_definition_id,
          proposed_data
        );
        update public.records
        set data_json = proposed_data
        where business_id = expected_business_id
          and id = record_id;
      else
        if not proposed_data ? primary_key
          or not private.graph_value_is_present(proposed_data -> primary_key)
        then
          raise exception 'A new Record needs a primary value.'
            using errcode = '23514';
        end if;
        perform private.assert_valid_graph_record_data(
          expected_business_id,
          target_view.object_definition_id,
          proposed_data
        );
        insert into public.records (
          business_id,
          object_definition_id,
          data_json,
          record_status
        )
        values (
          expected_business_id,
          target_view.object_definition_id,
          proposed_data,
          'active'
        )
        returning id into record_id;
      end if;

      record_ids := record_ids || jsonb_build_array(record_id);
    exception
      when others then
        get stacked diagnostics failure_message = message_text;
        failures := failures || jsonb_build_array(
          jsonb_build_object(
            'rowIndex', row_index,
            'message', left(coalesce(failure_message, 'This row could not be saved.'), 500)
          )
        );
    end;
    row_index := row_index + 1;
  end loop;

  return jsonb_build_object('recordIds', record_ids, 'failures', failures);
end;
$$;

revoke all on function public.apply_lenni_direct_configuration_change(
  uuid, uuid, uuid, bigint, text, jsonb
) from public, anon, service_role;
grant execute on function public.apply_lenni_direct_configuration_change(
  uuid, uuid, uuid, bigint, text, jsonb
) to authenticated;

revoke all on function public.apply_direct_table_record_batch(
  uuid, text, jsonb
) from public, anon, service_role;
grant execute on function public.apply_direct_table_record_batch(
  uuid, text, jsonb
) to authenticated;

comment on function public.apply_lenni_direct_configuration_change(
  uuid, uuid, uuid, bigint, text, jsonb
) is
  'Bounded Lenni Table structural action over the M5 configuration engine.';

comment on function public.apply_direct_table_record_batch(uuid, text, jsonb) is
  'Bounded per-record atomic Table paste and clear operation.';
