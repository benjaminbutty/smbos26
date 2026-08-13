-- Allow the trusted Table boundary to carry the Table-owned internal Forms
-- that PR #36 composes alongside a new scalar Field and Table View.
--
-- The existing shape assertions remain the source of truth for the Field and
-- View mutation.  This migration only removes those bounded Form operations
-- before delegating to the legacy assertions, then validates that the Forms
-- are exactly the active internal create/edit Forms referenced by the Table.

alter function private.assert_direct_table_action_shape_v1(
  text,
  jsonb,
  jsonb,
  jsonb
) rename to assert_direct_table_action_shape_legacy_v1;

alter function private.assert_lenni_direct_table_action_shape_v1(
  text,
  jsonb,
  jsonb,
  jsonb
) rename to assert_lenni_direct_table_action_shape_legacy_v1;

create or replace function private.assert_direct_table_owned_form_operations_v1(
  base_snapshot jsonb,
  candidate_snapshot jsonb,
  operations jsonb,
  view_operation jsonb,
  field_operation jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  base_view jsonb;
  candidate_view jsonb;
  object_definition jsonb;
  base_form jsonb;
  candidate_form jsonb;
  form_operation jsonb;
  base_form_value jsonb;
  candidate_form_value jsonb;
  form_key text;
  form_mode text;
  target_field_key text;
  expected_form_count integer := 0;
  actual_form_count integer := 0;
  expected_form_keys text[] := array[]::text[];
begin
  if view_operation is null or field_operation is null then
    raise exception 'direct_table_action_shape_invalid'
      using errcode = '22023';
  end if;

  target_field_key := field_operation ->> 'key';

  select value into base_view
  from jsonb_array_elements(base_snapshot -> 'views') as value
  where value ->> 'key' = view_operation ->> 'key';

  select value into candidate_view
  from jsonb_array_elements(candidate_snapshot -> 'views') as value
  where value ->> 'key' = view_operation ->> 'key';

  select value into object_definition
  from jsonb_array_elements(base_snapshot -> 'object_definitions') as value
  where value ->> 'key' = field_operation ->> 'object_key';

  if base_view is null
    or candidate_view is null
    or object_definition is null
    or base_view ->> 'object_key' <> field_operation ->> 'object_key'
    or candidate_view ->> 'object_key' <> field_operation ->> 'object_key'
  then
    raise exception 'direct_table_action_shape_invalid'
      using errcode = '22023';
  end if;

  select count(*) into actual_form_count
  from jsonb_array_elements(operations) as value
  where value ->> 'op' = 'set_form';

  if actual_form_count > 2
    or exists (
      select 1
      from jsonb_array_elements(operations) as value
      where value ->> 'op' = 'set_form'
      group by value ->> 'key'
      having count(*) <> 1
    )
  then
    raise exception 'direct_table_action_shape_invalid'
      using errcode = '22023';
  end if;

  for form_key, form_mode in
    select form_refs.form_key, form_refs.form_mode
    from (
      values
        (base_view -> 'config_json' ->> 'create_form_key', 'create'::text),
        (base_view -> 'config_json' ->> 'edit_form_key', 'edit'::text)
    ) as form_refs(form_key, form_mode)
    where form_refs.form_key is not null
  loop
    if form_key = any(expected_form_keys) then
      continue;
    end if;

    expected_form_keys := array_append(expected_form_keys, form_key);
    expected_form_count := expected_form_count + 1;

    select value into form_operation
    from jsonb_array_elements(operations) as value
    where value ->> 'op' = 'set_form'
      and value ->> 'key' = form_key;

    select value into base_form
    from jsonb_array_elements(base_snapshot -> 'forms') as value
    where value ->> 'key' = form_key;

    select value into candidate_form
    from jsonb_array_elements(candidate_snapshot -> 'forms') as value
    where value ->> 'key' = form_key;

    if form_operation is null
      or base_form is null
      or candidate_form is null
      or base_form ->> 'object_definition_id' <> object_definition ->> 'id'
      or base_form ->> 'object_key' <> field_operation ->> 'object_key'
      or base_form ->> 'mode' <> form_mode
      or base_form ->> 'audience' <> 'internal'
      or not (base_form ->> 'is_active')::boolean
      or candidate_form ->> 'object_definition_id' <> object_definition ->> 'id'
      or candidate_form ->> 'mode' <> form_mode
      or candidate_form ->> 'audience' <> 'internal'
      or not (candidate_form ->> 'is_active')::boolean
      or candidate_form - 'id'::text - 'object_definition_id'::text <>
        form_operation - 'op'::text
      or (candidate_form -> 'config_json' -> 'fields') <>
        (
          (base_form -> 'config_json' -> 'fields') ||
          jsonb_build_array(
            jsonb_build_object('field', target_field_key, 'hidden', false)
          )
        )
    then
      raise exception 'direct_table_action_shape_invalid'
        using errcode = '22023';
    end if;
  end loop;

  if actual_form_count <> expected_form_count
    or exists (
      select 1
      from jsonb_array_elements(operations) as value
      where value ->> 'op' = 'set_form'
        and not (value ->> 'key' = any(expected_form_keys))
    )
  then
    raise exception 'direct_table_action_shape_invalid'
      using errcode = '22023';
  end if;

  for base_form_value in
    select value
    from jsonb_array_elements(base_snapshot -> 'forms') as value
    where not (value ->> 'key' = any(expected_form_keys))
  loop
    if not exists (
      select 1
      from jsonb_array_elements(candidate_snapshot -> 'forms') as value
      where value = base_form_value
    ) then
      raise exception 'direct_table_action_shape_invalid'
        using errcode = '22023';
    end if;
  end loop;

  for candidate_form_value in
    select value
    from jsonb_array_elements(candidate_snapshot -> 'forms') as value
    where not (value ->> 'key' = any(expected_form_keys))
  loop
    if not exists (
      select 1
      from jsonb_array_elements(base_snapshot -> 'forms') as value
      where value = candidate_form_value
    ) then
      raise exception 'direct_table_action_shape_invalid'
        using errcode = '22023';
    end if;
  end loop;
end;
$$;

create or replace function private.assert_direct_table_action_shape_v2(
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
  candidate_without_forms jsonb;
  stripped_operations jsonb;
  form_count integer := 0;
  field_count integer := 0;
  view_count integer := 0;
begin
  if action_kind not in ('add_column', 'insert_column', 'change_column_type') then
    raise exception 'direct_table_action_shape_invalid'
      using errcode = '22023';
  end if;

  perform private.assert_configuration_operations_v1(operations);

  select count(*) into form_count
  from jsonb_array_elements(operations) as value
  where value ->> 'op' = 'set_form';
  select count(*) into field_count
  from jsonb_array_elements(operations) as value
  where value ->> 'op' = 'set_field';
  select count(*) into view_count
  from jsonb_array_elements(operations) as value
  where value ->> 'op' = 'set_view';

  if form_count > 0 and action_kind = 'change_column_type' then
    raise exception 'direct_table_action_shape_invalid'
      using errcode = '22023';
  end if;

  if form_count = 0
    and candidate_snapshot -> 'forms' <> base_snapshot -> 'forms'
  then
    raise exception 'direct_table_action_shape_invalid'
      using errcode = '22023';
  end if;

  if action_kind in ('add_column', 'insert_column')
    and (field_count <> 1 or view_count <> 1)
  then
    raise exception 'direct_table_action_shape_invalid'
      using errcode = '22023';
  end if;

  if action_kind = 'change_column_type'
    and (field_count <> 1 or view_count <> 0 or form_count <> 0)
  then
    raise exception 'direct_table_action_shape_invalid'
      using errcode = '22023';
  end if;

  select value into field_operation
  from jsonb_array_elements(operations) as value
  where value ->> 'op' = 'set_field';

  select value into view_operation
  from jsonb_array_elements(operations) as value
  where value ->> 'op' = 'set_view';

  select coalesce(
    jsonb_agg(value order by ordinal)
      filter (where value ->> 'op' <> 'set_form'),
    '[]'::jsonb
  ) into stripped_operations
  from jsonb_array_elements(operations)
    with ordinality as operation(value, ordinal);

  candidate_without_forms := jsonb_set(
    candidate_snapshot,
    '{forms}',
    base_snapshot -> 'forms',
    true
  );

  if action_kind = 'add_column' then
    perform private.assert_direct_table_action_shape_legacy_v1(
      action_kind,
      base_snapshot,
      candidate_without_forms,
      stripped_operations
    );
  else
    perform private.assert_lenni_direct_table_action_shape_legacy_v1(
      action_kind,
      base_snapshot,
      candidate_without_forms,
      stripped_operations
    );
  end if;

  if form_count > 0 then
    perform private.assert_direct_table_owned_form_operations_v1(
      base_snapshot,
      candidate_snapshot,
      operations,
      view_operation,
      field_operation
    );
  end if;
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
begin
  if action_kind = 'add_column' then
    perform private.assert_direct_table_action_shape_v2(
      action_kind,
      base_snapshot,
      candidate_snapshot,
      operations
    );
  else
    perform private.assert_direct_table_action_shape_legacy_v1(
      action_kind,
      base_snapshot,
      candidate_snapshot,
      operations
    );
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
begin
  perform private.assert_direct_table_action_shape_v2(
    action_kind,
    base_snapshot,
    candidate_snapshot,
    operations
  );
end;
$$;
