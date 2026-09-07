-- Property removal is global to its Object: every active internal Table View
-- and Form that still exposes the Field must be updated in the same change.
create or replace function public.apply_lenni_table_property_archive(
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
  field_operation jsonb;
  view_operation jsonb;
  changed_form jsonb;
  base_field jsonb;
  candidate_field jsonb;
  base_view jsonb;
  candidate_view jsonb;
  base_form jsonb;
  candidate_form jsonb;
  base_config jsonb;
  candidate_config jsonb;
  removed_field_key text;
  expected_fields jsonb;
  expected_columns jsonb;
  expected_filters jsonb;
  expected_sorts jsonb;
  expected_group jsonb;
  expected_widths jsonb;
  expected_form_fields jsonb;
begin
  if current_actor_id is null then
    raise exception 'configuration_authentication_required' using errcode = '42501';
  end if;
  if current_actor_id is distinct from expected_actor_id
    or not private.can_manage_tenant(expected_business_id) then
    raise exception 'configuration_owner_or_admin_required' using errcode = '42501';
  end if;
  if requested_action_kind <> 'archive_column' then
    raise exception 'direct_table_action_shape_invalid' using errcode = '22023';
  end if;

  proposed := public.propose_configuration_change(
    expected_business_id, expected_actor_id, expected_base_version_id,
    expected_head_revision, 'Table Workspace: archive_column',
    'direct_table_workspace:archive_column', requested_operations
  );
  select version.* into base_version
  from public.configuration_versions as version
  where version.business_id = expected_business_id and version.id = proposed.base_version_id;
  if not found then
    raise exception 'direct_table_action_shape_invalid' using errcode = '22023';
  end if;

  if jsonb_array_length(requested_operations) not between 2 and 100
    or exists (
      select 1 from jsonb_array_elements(requested_operations) as item
      where item ->> 'op' not in ('set_field', 'set_view', 'set_form')
    )
    or (select count(*) from jsonb_array_elements(requested_operations) as item where item ->> 'op' = 'set_field') <> 1
    or (select count(*) from jsonb_array_elements(requested_operations) as item where item ->> 'op' = 'set_view') < 1
  then
    raise exception 'direct_table_action_shape_invalid' using errcode = '22023';
  end if;

  select item into field_operation
  from jsonb_array_elements(requested_operations) as item
  where item ->> 'op' = 'set_field';
  removed_field_key := field_operation ->> 'key';
  select item into base_field
  from jsonb_array_elements(base_version.snapshot_json -> 'field_definitions') as item
  where item ->> 'object_key' = field_operation ->> 'object_key'
    and item ->> 'key' = removed_field_key;
  select item into candidate_field
  from jsonb_array_elements(proposed.candidate_snapshot_json -> 'field_definitions') as item
  where item ->> 'object_key' = field_operation ->> 'object_key'
    and item ->> 'key' = removed_field_key;
  if base_field is null or candidate_field is null
    or not (base_field ->> 'is_active')::boolean
    or (field_operation ->> 'is_active')::boolean
    or (candidate_field ->> 'is_active')::boolean
    or (base_field - 'is_active') <> (field_operation - 'is_active')
    or (base_field - 'is_active') <> (candidate_field - 'is_active')
  then
    raise exception 'direct_table_action_shape_invalid' using errcode = '22023';
  end if;

  for view_operation in
    select item from jsonb_array_elements(requested_operations) as item where item ->> 'op' = 'set_view'
  loop
    select item into base_view
    from jsonb_array_elements(base_version.snapshot_json -> 'views') as item
    where item ->> 'key' = view_operation ->> 'key';
    select item into candidate_view
    from jsonb_array_elements(proposed.candidate_snapshot_json -> 'views') as item
    where item ->> 'key' = view_operation ->> 'key';
    if base_view is null or candidate_view is null
      or base_view ->> 'view_type' <> 'table'
      or base_view ->> 'audience' <> 'internal'
      or not (base_view ->> 'is_active')::boolean
      or base_view ->> 'object_key' <> field_operation ->> 'object_key'
      or candidate_view -> 'config_json' <> view_operation -> 'config_json'
      or candidate_view - 'config_json'::text <> base_view - 'config_json'::text
    then
      raise exception 'direct_table_action_shape_invalid' using errcode = '22023';
    end if;

    base_config := base_view -> 'config_json';
    candidate_config := candidate_view -> 'config_json';
    if not (base_config -> 'fields' @> jsonb_build_array(removed_field_key))
      or base_config -> 'title_field' = to_jsonb(removed_field_key)
    then
      raise exception 'direct_table_action_shape_invalid' using errcode = '22023';
    end if;

    select coalesce(jsonb_agg(item order by ordinality), '[]'::jsonb) into expected_fields
    from jsonb_array_elements(base_config -> 'fields') with ordinality as elements(item, ordinality)
    where item <> to_jsonb(removed_field_key);
    select coalesce(jsonb_agg(item order by ordinality), '[]'::jsonb) into expected_columns
    from jsonb_array_elements(base_config -> 'columns') with ordinality as elements(item, ordinality)
    where not (item ->> 'kind' = 'field' and item ->> 'field_key' = removed_field_key);
    select coalesce(jsonb_agg(item order by ordinality), '[]'::jsonb) into expected_filters
    from jsonb_array_elements(base_config -> 'filters') with ordinality as elements(item, ordinality)
    where item ->> 'property' <> 'field:' || removed_field_key;
    select coalesce(jsonb_agg(item order by ordinality), '[]'::jsonb) into expected_sorts
    from jsonb_array_elements(base_config -> 'sorts') with ordinality as elements(item, ordinality)
    where item ->> 'property' <> 'field:' || removed_field_key;
    expected_group := case
      when base_config ->> 'group' = 'field:' || removed_field_key then 'null'::jsonb
      else coalesce(base_config -> 'group', 'null'::jsonb)
    end;
    if base_config ? 'column_widths' then
      select jsonb_object_agg(key, value) into expected_widths
      from jsonb_each(base_config -> 'column_widths')
      where key <> removed_field_key;
    else
      expected_widths := null;
    end if;

    if candidate_config -> 'fields' <> expected_fields
      or candidate_config -> 'columns' <> expected_columns
      or candidate_config -> 'filters' <> expected_filters
      or candidate_config -> 'sorts' <> expected_sorts
      or candidate_config -> 'group' <> expected_group
      or candidate_config -> 'column_widths' is distinct from expected_widths
      or candidate_config - 'fields'::text - 'columns'::text - 'column_widths'::text - 'filters'::text - 'sorts'::text - 'group'::text
         <> base_config - 'fields'::text - 'columns'::text - 'column_widths'::text - 'filters'::text - 'sorts'::text - 'group'::text
    then
      raise exception 'direct_table_action_shape_invalid' using errcode = '22023';
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(base_version.snapshot_json -> 'views') as item
    where item ->> 'view_type' = 'table'
      and item ->> 'audience' = 'internal'
      and item ->> 'is_active' = 'true'
      and item ->> 'object_key' = field_operation ->> 'object_key'
      and item -> 'config_json' -> 'fields' @> jsonb_build_array(removed_field_key)
      and not exists (
        select 1 from jsonb_array_elements(requested_operations) as operation
        where operation ->> 'op' = 'set_view' and operation ->> 'key' = item ->> 'key'
      )
  ) then
    raise exception 'direct_table_action_shape_invalid' using errcode = '22023';
  end if;

  for changed_form in
    select item from jsonb_array_elements(requested_operations) as item where item ->> 'op' = 'set_form'
  loop
    select item into base_form
    from jsonb_array_elements(base_version.snapshot_json -> 'forms') as item
    where item ->> 'key' = changed_form ->> 'key';
    select item into candidate_form
    from jsonb_array_elements(proposed.candidate_snapshot_json -> 'forms') as item
    where item ->> 'key' = changed_form ->> 'key';
    if base_form is null or candidate_form is null
      or not (base_form ->> 'is_active')::boolean
      or base_form ->> 'object_key' <> field_operation ->> 'object_key'
      or candidate_form -> 'config_json' <> changed_form -> 'config_json'
      or candidate_form - 'config_json'::text <> base_form - 'config_json'::text
    then
      raise exception 'direct_table_action_shape_invalid' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(item order by ordinality), '[]'::jsonb) into expected_form_fields
    from jsonb_array_elements(base_form -> 'config_json' -> 'fields') with ordinality as elements(item, ordinality)
    where item ->> 'field' <> removed_field_key;
    if not (base_form -> 'config_json' -> 'fields' @> jsonb_build_array(jsonb_build_object('field', removed_field_key)))
      or candidate_form -> 'config_json' -> 'fields' <> expected_form_fields
      or candidate_form -> 'config_json' - 'fields'::text <> base_form -> 'config_json' - 'fields'::text
    then
      raise exception 'direct_table_action_shape_invalid' using errcode = '22023';
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(base_version.snapshot_json -> 'forms') as item
    where item ->> 'is_active' = 'true'
      and item ->> 'object_key' = field_operation ->> 'object_key'
      and item -> 'config_json' -> 'fields' @> jsonb_build_array(jsonb_build_object('field', removed_field_key))
      and not exists (
        select 1 from jsonb_array_elements(requested_operations) as operation
        where operation ->> 'op' = 'set_form' and operation ->> 'key' = item ->> 'key'
      )
  ) then
    raise exception 'direct_table_action_shape_invalid' using errcode = '22023';
  end if;

  if proposed.candidate_snapshot_json -> 'object_definitions' <> base_version.snapshot_json -> 'object_definitions'
    or proposed.candidate_snapshot_json -> 'relationship_definitions' <> base_version.snapshot_json -> 'relationship_definitions'
    or proposed.candidate_snapshot_json -> 'pages' <> base_version.snapshot_json -> 'pages'
    or proposed.candidate_snapshot_json -> 'preorder_experiences' <> base_version.snapshot_json -> 'preorder_experiences'
    or proposed.candidate_snapshot_json -> 'preorder_experience_locations' <> base_version.snapshot_json -> 'preorder_experience_locations'
  then
    raise exception 'direct_table_action_shape_invalid' using errcode = '22023';
  end if;

  validated := public.validate_configuration_change(expected_business_id, expected_actor_id, proposed.id);
  if validated.status <> 'validated' or validated.validation_result_json ->> 'outcome' <> 'valid' then
    raise exception 'direct_configuration_change_incompatible' using errcode = 'P0001';
  end if;
  applied := public.apply_configuration_change(expected_business_id, expected_actor_id, proposed.id);
  if applied.status <> 'applied' then
    raise exception 'direct_configuration_change_incompatible' using errcode = 'P0001';
  end if;
  return applied;
end;
$$;
