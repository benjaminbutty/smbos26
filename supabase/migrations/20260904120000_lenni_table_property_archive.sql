-- A property removal is an archive: record data remains in history while the
-- field is removed from this Table and the Table-owned create/edit Forms.
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
  operation jsonb;
  field_operation jsonb;
  view_operation jsonb;
  base_field jsonb;
  candidate_field jsonb;
  base_view jsonb;
  candidate_view jsonb;
  base_config jsonb;
  candidate_config jsonb;
  removed_field_key text;
  changed_form jsonb;
  base_form jsonb;
  candidate_form jsonb;
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

  if jsonb_array_length(requested_operations) not between 2 and 4
    or exists (
      select 1 from jsonb_array_elements(requested_operations) as item
      where item ->> 'op' not in ('set_field', 'set_view', 'set_form')
    )
    or (select count(*) from jsonb_array_elements(requested_operations) as item where item ->> 'op' = 'set_field') <> 1
    or (select count(*) from jsonb_array_elements(requested_operations) as item where item ->> 'op' = 'set_view') <> 1
  then
    raise exception 'direct_table_action_shape_invalid' using errcode = '22023';
  end if;

  select item into field_operation from jsonb_array_elements(requested_operations) as item where item ->> 'op' = 'set_field';
  select item into view_operation from jsonb_array_elements(requested_operations) as item where item ->> 'op' = 'set_view';
  removed_field_key := field_operation ->> 'key';
  select item into base_field
  from jsonb_array_elements(base_version.snapshot_json -> 'field_definitions') as item
  where item ->> 'object_key' = field_operation ->> 'object_key'
    and item ->> 'key' = removed_field_key;
  select item into candidate_field
  from jsonb_array_elements(proposed.candidate_snapshot_json -> 'field_definitions') as item
  where item ->> 'object_key' = field_operation ->> 'object_key'
    and item ->> 'key' = removed_field_key;
  select item into base_view
  from jsonb_array_elements(base_version.snapshot_json -> 'views') as item
  where item ->> 'key' = view_operation ->> 'key';
  select item into candidate_view
  from jsonb_array_elements(proposed.candidate_snapshot_json -> 'views') as item
  where item ->> 'key' = view_operation ->> 'key';
  if base_field is null or candidate_field is null or base_view is null or candidate_view is null
    or not (base_field ->> 'is_active')::boolean
    or (field_operation ->> 'is_active')::boolean
    or (candidate_field ->> 'is_active')::boolean
    or (base_field - 'is_active') <> (field_operation - 'is_active')
    or (base_field - 'is_active') <> (candidate_field - 'is_active')
    or base_view ->> 'view_type' <> 'table'
    or base_view ->> 'audience' <> 'internal'
    or not (base_view ->> 'is_active')::boolean
    or base_view ->> 'object_key' <> field_operation ->> 'object_key'
    or base_view -> 'config_json' ->> 'title_field' = removed_field_key
    or candidate_view -> 'config_json' <> view_operation -> 'config_json'
  then
    raise exception 'direct_table_action_shape_invalid' using errcode = '22023';
  end if;

  base_config := base_view -> 'config_json';
  candidate_config := candidate_view -> 'config_json';
  if not (base_config -> 'fields' @> jsonb_build_array(removed_field_key))
    or candidate_config -> 'fields' @> jsonb_build_array(removed_field_key)
    or candidate_config - 'fields'::text - 'columns'::text - 'column_widths'::text
       <> base_config - 'fields'::text - 'columns'::text - 'column_widths'::text
  then
    raise exception 'direct_table_action_shape_invalid' using errcode = '22023';
  end if;

  for changed_form in
    select item from jsonb_array_elements(requested_operations) as item where item ->> 'op' = 'set_form'
  loop
    select item into base_form from jsonb_array_elements(base_version.snapshot_json -> 'forms') as item where item ->> 'key' = changed_form ->> 'key';
    select item into candidate_form from jsonb_array_elements(proposed.candidate_snapshot_json -> 'forms') as item where item ->> 'key' = changed_form ->> 'key';
    if base_form is null or candidate_form is null
      or candidate_form -> 'config_json' <> changed_form -> 'config_json'
      or candidate_form - 'config_json'::text <> base_form - 'config_json'::text
      or candidate_form -> 'config_json' -> 'fields' @> jsonb_build_array(jsonb_build_object('field', removed_field_key))
    then
      raise exception 'direct_table_action_shape_invalid' using errcode = '22023';
    end if;
  end loop;

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

revoke all on function public.apply_lenni_table_property_archive(uuid, uuid, uuid, bigint, text, jsonb) from public, anon, service_role;
grant execute on function public.apply_lenni_table_property_archive(uuid, uuid, uuid, bigint, text, jsonb) to authenticated;
