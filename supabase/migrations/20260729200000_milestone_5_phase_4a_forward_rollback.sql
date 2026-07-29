-- Milestone 5 Phase 4A: safe forward-moving configuration rollback.
--
-- A rollback is a trusted proposal that deterministically restores historical
-- configuration while retaining configuration introduced later as archived
-- rows. Validation and application share one replay dispatcher and the
-- existing static projector remains the sole normalized-table materializer.

create function private.build_configuration_rollback_display_context_v1(
  target_business_id uuid,
  current_snapshot jsonb,
  historical_snapshot jsonb
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with referenced_locations as (
    select allowed ->> 'location_id' as location_id
    from jsonb_array_elements(
      current_snapshot -> 'preorder_experience_locations'
    ) as allowed
    union
    select allowed ->> 'location_id'
    from jsonb_array_elements(
      historical_snapshot -> 'preorder_experience_locations'
    ) as allowed
  )
  select jsonb_build_object(
    'schema_version',
    1,
    'locations',
    coalesce(
      jsonb_object_agg(
        referenced.location_id,
        jsonb_build_object(
          'name',
          coalesce(
            location.name,
            'Location ' || left(referenced.location_id, 8)
          )
        )
        order by referenced.location_id collate "C"
      ) filter (where referenced.location_id is not null),
      '{}'::jsonb
    )
  )
  from referenced_locations as referenced
  left join public.locations as location
    on location.business_id = target_business_id
    and location.id::text = referenced.location_id;
$$;

create function private.configuration_rollback_candidate_v1(
  target_business_id uuid,
  current_snapshot jsonb,
  historical_snapshot jsonb,
  trusted_display_context jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  candidate jsonb;
  candidate_checksum text;
  semantic_diff jsonb;
begin
  perform private.assert_configuration_candidate_v1(
    target_business_id,
    current_snapshot
  );
  perform private.assert_configuration_candidate_v1(
    target_business_id,
    historical_snapshot
  );

  -- Historical semantic identities must still exist with the same stable IDs
  -- and immutable parents/endpoints. Rollback never allocates or substitutes
  -- identity.
  if exists (
    select 1
    from jsonb_array_elements(
      historical_snapshot -> 'object_definitions'
    ) as historical
    left join lateral (
      select current
      from jsonb_array_elements(
        current_snapshot -> 'object_definitions'
      ) as current
      where current ->> 'key' = historical ->> 'key'
    ) as matched on true
    where matched.current is null
      or matched.current ->> 'id' <> historical ->> 'id'
      or matched.current ->> 'kind' <> historical ->> 'kind'
      or matched.current -> 'semantic_type' is distinct from
        historical -> 'semantic_type'
  ) then
    raise exception 'configuration_rollback_object_identity_mismatch'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(
      historical_snapshot -> 'field_definitions'
    ) as historical
    left join lateral (
      select current
      from jsonb_array_elements(
        current_snapshot -> 'field_definitions'
      ) as current
      where current ->> 'object_key' = historical ->> 'object_key'
        and current ->> 'key' = historical ->> 'key'
    ) as matched on true
    where matched.current is null
      or matched.current ->> 'id' <> historical ->> 'id'
      or matched.current ->> 'object_definition_id' <>
        historical ->> 'object_definition_id'
  ) then
    raise exception 'configuration_rollback_field_identity_mismatch'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(
      historical_snapshot -> 'relationship_definitions'
    ) as historical
    left join lateral (
      select current
      from jsonb_array_elements(
        current_snapshot -> 'relationship_definitions'
      ) as current
      where current ->> 'key' = historical ->> 'key'
    ) as matched on true
    where matched.current is null
      or matched.current ->> 'id' <> historical ->> 'id'
      or matched.current ->> 'source_object_definition_id' <>
        historical ->> 'source_object_definition_id'
      or matched.current ->> 'target_object_definition_id' <>
        historical ->> 'target_object_definition_id'
      or matched.current ->> 'source_object_key' <>
        historical ->> 'source_object_key'
      or matched.current ->> 'target_object_key' <>
        historical ->> 'target_object_key'
  ) then
    raise exception 'configuration_rollback_relationship_identity_mismatch'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(historical_snapshot -> 'views') as historical
    left join lateral (
      select current
      from jsonb_array_elements(current_snapshot -> 'views') as current
      where current ->> 'key' = historical ->> 'key'
    ) as matched on true
    where matched.current is null
      or matched.current ->> 'id' <> historical ->> 'id'
      or matched.current ->> 'object_definition_id' <>
        historical ->> 'object_definition_id'
      or matched.current ->> 'object_key' <> historical ->> 'object_key'
  ) then
    raise exception 'configuration_rollback_view_identity_mismatch'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(historical_snapshot -> 'forms') as historical
    left join lateral (
      select current
      from jsonb_array_elements(current_snapshot -> 'forms') as current
      where current ->> 'key' = historical ->> 'key'
    ) as matched on true
    where matched.current is null
      or matched.current ->> 'id' <> historical ->> 'id'
      or matched.current ->> 'object_definition_id' <>
        historical ->> 'object_definition_id'
      or matched.current ->> 'object_key' <> historical ->> 'object_key'
      or matched.current ->> 'mode' <> historical ->> 'mode'
  ) then
    raise exception 'configuration_rollback_form_identity_mismatch'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(historical_snapshot -> 'pages') as historical
    left join lateral (
      select current
      from jsonb_array_elements(current_snapshot -> 'pages') as current
      where current ->> 'key' = historical ->> 'key'
    ) as matched on true
    where matched.current is null
      or matched.current ->> 'id' <> historical ->> 'id'
  ) then
    raise exception 'configuration_rollback_page_identity_mismatch'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(
      historical_snapshot -> 'preorder_experiences'
    ) as historical
    left join lateral (
      select current
      from jsonb_array_elements(
        current_snapshot -> 'preorder_experiences'
      ) as current
      where current ->> 'key' = historical ->> 'key'
    ) as matched on true
    where matched.current is null
      or matched.current ->> 'id' <> historical ->> 'id'
      or matched.current - array['config_json', 'is_active'] is distinct from
        historical - array['config_json', 'is_active']
  ) then
    raise exception 'configuration_rollback_preorder_identity_mismatch'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(
      historical_snapshot -> 'preorder_experience_locations'
    ) as historical
    left join lateral (
      select current
      from jsonb_array_elements(
        current_snapshot -> 'preorder_experience_locations'
      ) as current
      where current ->> 'preorder_key' = historical ->> 'preorder_key'
        and current ->> 'location_id' = historical ->> 'location_id'
    ) as matched on true
    where matched.current is null
      or matched.current ->> 'id' <> historical ->> 'id'
      or matched.current ->> 'preorder_experience_id' <>
        historical ->> 'preorder_experience_id'
  ) then
    raise exception 'configuration_rollback_location_identity_mismatch'
      using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'schema_version',
    1,
    'object_definitions',
    (
      select coalesce(
        jsonb_agg(entity order by entity ->> 'key' collate "C"),
        '[]'::jsonb
      )
      from (
        select historical as entity
        from jsonb_array_elements(
          historical_snapshot -> 'object_definitions'
        ) as historical
        union all
        select current || jsonb_build_object('is_active', false)
        from jsonb_array_elements(
          current_snapshot -> 'object_definitions'
        ) as current
        where not exists (
          select 1
          from jsonb_array_elements(
            historical_snapshot -> 'object_definitions'
          ) as historical
          where historical ->> 'key' = current ->> 'key'
        )
      ) as merged
    ),
    'field_definitions',
    (
      select coalesce(
        jsonb_agg(
          entity
          order by
            entity ->> 'object_key' collate "C",
            (entity ->> 'position')::integer,
            entity ->> 'key' collate "C"
        ),
        '[]'::jsonb
      )
      from (
        select historical as entity
        from jsonb_array_elements(
          historical_snapshot -> 'field_definitions'
        ) as historical
        union all
        select current || jsonb_build_object('is_active', false)
        from jsonb_array_elements(
          current_snapshot -> 'field_definitions'
        ) as current
        where not exists (
          select 1
          from jsonb_array_elements(
            historical_snapshot -> 'field_definitions'
          ) as historical
          where historical ->> 'object_key' = current ->> 'object_key'
            and historical ->> 'key' = current ->> 'key'
        )
      ) as merged
    ),
    'relationship_definitions',
    (
      select coalesce(
        jsonb_agg(entity order by entity ->> 'key' collate "C"),
        '[]'::jsonb
      )
      from (
        select historical as entity
        from jsonb_array_elements(
          historical_snapshot -> 'relationship_definitions'
        ) as historical
        union all
        select current || jsonb_build_object('is_active', false)
        from jsonb_array_elements(
          current_snapshot -> 'relationship_definitions'
        ) as current
        where not exists (
          select 1
          from jsonb_array_elements(
            historical_snapshot -> 'relationship_definitions'
          ) as historical
          where historical ->> 'key' = current ->> 'key'
        )
      ) as merged
    ),
    'views',
    (
      select coalesce(
        jsonb_agg(entity order by entity ->> 'key' collate "C"),
        '[]'::jsonb
      )
      from (
        select historical as entity
        from jsonb_array_elements(historical_snapshot -> 'views') as historical
        union all
        select current || jsonb_build_object('is_active', false)
        from jsonb_array_elements(current_snapshot -> 'views') as current
        where not exists (
          select 1
          from jsonb_array_elements(
            historical_snapshot -> 'views'
          ) as historical
          where historical ->> 'key' = current ->> 'key'
        )
      ) as merged
    ),
    'forms',
    (
      select coalesce(
        jsonb_agg(entity order by entity ->> 'key' collate "C"),
        '[]'::jsonb
      )
      from (
        select historical as entity
        from jsonb_array_elements(historical_snapshot -> 'forms') as historical
        union all
        select current || jsonb_build_object('is_active', false)
        from jsonb_array_elements(current_snapshot -> 'forms') as current
        where not exists (
          select 1
          from jsonb_array_elements(
            historical_snapshot -> 'forms'
          ) as historical
          where historical ->> 'key' = current ->> 'key'
        )
      ) as merged
    ),
    'pages',
    (
      select coalesce(
        jsonb_agg(entity order by entity ->> 'key' collate "C"),
        '[]'::jsonb
      )
      from (
        select historical as entity
        from jsonb_array_elements(historical_snapshot -> 'pages') as historical
        union all
        select current || jsonb_build_object('is_active', false)
        from jsonb_array_elements(current_snapshot -> 'pages') as current
        where not exists (
          select 1
          from jsonb_array_elements(
            historical_snapshot -> 'pages'
          ) as historical
          where historical ->> 'key' = current ->> 'key'
        )
      ) as merged
    ),
    'preorder_experiences',
    (
      select coalesce(
        jsonb_agg(entity order by entity ->> 'key' collate "C"),
        '[]'::jsonb
      )
      from (
        select historical as entity
        from jsonb_array_elements(
          historical_snapshot -> 'preorder_experiences'
        ) as historical
        union all
        select current || jsonb_build_object('is_active', false)
        from jsonb_array_elements(
          current_snapshot -> 'preorder_experiences'
        ) as current
        where not exists (
          select 1
          from jsonb_array_elements(
            historical_snapshot -> 'preorder_experiences'
          ) as historical
          where historical ->> 'key' = current ->> 'key'
        )
      ) as merged
    ),
    'preorder_experience_locations',
    (
      select coalesce(
        jsonb_agg(
          entity
          order by
            entity ->> 'preorder_key' collate "C",
            entity ->> 'location_id'
        ),
        '[]'::jsonb
      )
      from (
        select historical as entity
        from jsonb_array_elements(
          historical_snapshot -> 'preorder_experience_locations'
        ) as historical
        union all
        select current || jsonb_build_object('is_active', false)
        from jsonb_array_elements(
          current_snapshot -> 'preorder_experience_locations'
        ) as current
        where not exists (
          select 1
          from jsonb_array_elements(
            historical_snapshot -> 'preorder_experience_locations'
          ) as historical
          where historical ->> 'preorder_key' =
              current ->> 'preorder_key'
            and historical ->> 'location_id' = current ->> 'location_id'
        )
      ) as merged
    )
  )
  into candidate;

  perform private.assert_configuration_candidate_v1(
    target_business_id,
    candidate
  );
  perform private.assert_configuration_display_context_v1(
    trusted_display_context,
    current_snapshot,
    candidate
  );

  candidate_checksum :=
    private.configuration_snapshot_checksum_v1(candidate);
  semantic_diff := private.configuration_semantic_diff_v1(
    current_snapshot,
    candidate,
    trusted_display_context
  );

  return jsonb_build_object(
    'candidate_snapshot',
    candidate,
    'candidate_checksum',
    candidate_checksum,
    'id_allocations',
    '{}'::jsonb,
    'semantic_diff',
    semantic_diff
  );
end;
$$;

create function private.replay_configuration_change_set_v1(
  selected_change_set public.configuration_change_sets,
  base_version public.configuration_versions
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  target_version public.configuration_versions;
  replayed jsonb;
begin
  if selected_change_set.base_version_id <> base_version.id
    or selected_change_set.business_id <> base_version.business_id
  then
    raise exception 'configuration_replay_base_mismatch'
      using errcode = 'P0001';
  end if;

  if selected_change_set.kind = 'change' then
    if selected_change_set.rollback_target_version_id is not null then
      raise exception 'configuration_change_replay_shape_invalid'
        using errcode = 'P0001';
    end if;
    replayed := private.configuration_materialize_candidate_v1(
      selected_change_set.business_id,
      base_version.snapshot_json,
      selected_change_set.operations_json,
      selected_change_set.id_allocations_json,
      selected_change_set.display_context_json
    );
  elsif selected_change_set.kind = 'rollback' then
    if selected_change_set.operations_json <> jsonb_build_array(
        jsonb_build_object(
          'op',
          'restore_configuration_version',
          'schema_version',
          1
        )
      )
      or selected_change_set.id_allocations_json <> '{}'::jsonb
      or selected_change_set.rollback_target_version_id is null
    then
      raise exception 'configuration_rollback_descriptor_invalid'
        using errcode = 'P0001';
    end if;

    select version.*
    into target_version
    from public.configuration_versions as version
    where version.business_id = selected_change_set.business_id
      and version.id = selected_change_set.rollback_target_version_id;
    if not found or target_version.version_number >= base_version.version_number
    then
      raise exception 'configuration_rollback_target_invalid'
        using errcode = 'P0001';
    end if;

    replayed := private.configuration_rollback_candidate_v1(
      selected_change_set.business_id,
      base_version.snapshot_json,
      target_version.snapshot_json,
      selected_change_set.display_context_json
    );
  else
    raise exception 'configuration_change_kind_invalid'
      using errcode = 'P0001';
  end if;

  perform private.assert_configuration_display_context_v1(
    selected_change_set.display_context_json,
    base_version.snapshot_json,
    replayed -> 'candidate_snapshot'
  );

  return replayed;
end;
$$;

create function public.prepare_configuration_rollback(
  expected_business_id uuid,
  expected_actor_id uuid,
  requested_target_version_id uuid,
  requested_title text,
  requested_description text
)
returns public.configuration_change_sets
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  current_head public.business_configuration_heads;
  base_version public.configuration_versions;
  target_version public.configuration_versions;
  live_snapshot jsonb;
  display_context jsonb;
  materialized jsonb;
  created_change_set public.configuration_change_sets;
begin
  if current_actor_id is null then
    raise exception 'configuration_authentication_required'
      using errcode = '42501';
  end if;
  if current_actor_id <> expected_actor_id then
    raise exception 'configuration_actor_context_mismatch'
      using errcode = '42501';
  end if;
  if not private.can_manage_tenant(expected_business_id) then
    raise exception 'configuration_owner_or_admin_required'
      using errcode = '42501';
  end if;
  if char_length(trim(coalesce(requested_title, ''))) not between 1 and 120
    or (
      requested_description is not null
      and char_length(requested_description) > 5000
    )
  then
    raise exception 'configuration_proposal_metadata_invalid'
      using errcode = '22023';
  end if;

  select head.*
  into current_head
  from public.business_configuration_heads as head
  where head.business_id = expected_business_id
  for share;
  if not found then
    raise exception 'configuration_head_not_found'
      using errcode = 'P0002';
  end if;

  select version.*
  into base_version
  from public.configuration_versions as version
  where version.business_id = expected_business_id
    and version.id = current_head.active_version_id;
  if not found then
    raise exception 'configuration_active_version_not_found'
      using errcode = 'P0002';
  end if;
  if base_version.version_number <> current_head.head_revision then
    raise exception 'configuration_head_version_mismatch'
      using errcode = 'P0001';
  end if;

  live_snapshot := private.configuration_snapshot_v1(expected_business_id);
  if live_snapshot <> base_version.snapshot_json
    or private.configuration_snapshot_checksum_v1(live_snapshot) <>
      base_version.snapshot_checksum
  then
    raise exception 'configuration_projection_out_of_sync'
      using errcode = 'P0001';
  end if;

  select version.*
  into target_version
  from public.configuration_versions as version
  where version.business_id = expected_business_id
    and version.id = requested_target_version_id;
  if not found then
    raise exception 'configuration_rollback_target_not_found'
      using errcode = 'P0002';
  end if;
  if target_version.version_number >= base_version.version_number then
    raise exception 'configuration_rollback_target_invalid'
      using errcode = '22023';
  end if;

  display_context :=
    private.build_configuration_rollback_display_context_v1(
      expected_business_id,
      base_version.snapshot_json,
      target_version.snapshot_json
    );
  materialized := private.configuration_rollback_candidate_v1(
    expected_business_id,
    base_version.snapshot_json,
    target_version.snapshot_json,
    display_context
  );

  if materialized -> 'candidate_snapshot' = base_version.snapshot_json
    or materialized ->> 'candidate_checksum' =
      base_version.snapshot_checksum
    or jsonb_array_length(
      materialized -> 'semantic_diff' -> 'changes'
    ) = 0
  then
    raise exception 'configuration_proposal_no_changes'
      using errcode = '22023';
  end if;

  insert into public.configuration_change_sets (
    business_id,
    kind,
    status,
    title,
    description,
    base_version_id,
    base_head_revision,
    rollback_target_version_id,
    requested_by,
    operations_schema_version,
    operations_json,
    id_allocations_json,
    display_context_json,
    candidate_snapshot_json,
    candidate_checksum,
    semantic_diff_json
  )
  values (
    expected_business_id,
    'rollback',
    'proposed',
    trim(requested_title),
    requested_description,
    base_version.id,
    current_head.head_revision,
    target_version.id,
    current_actor_id,
    1,
    jsonb_build_array(
      jsonb_build_object(
        'op',
        'restore_configuration_version',
        'schema_version',
        1
      )
    ),
    '{}'::jsonb,
    display_context,
    materialized -> 'candidate_snapshot',
    materialized ->> 'candidate_checksum',
    materialized -> 'semantic_diff'
  )
  returning * into created_change_set;

  return created_change_set;
end;
$$;

create function public.list_configuration_versions(
  expected_business_id uuid
)
returns setof public.configuration_versions
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'configuration_authentication_required'
      using errcode = '42501';
  end if;
  if not private.can_manage_tenant(expected_business_id) then
    raise exception 'configuration_owner_or_admin_required'
      using errcode = '42501';
  end if;

  return query
  select version.*
  from public.configuration_versions as version
  where version.business_id = expected_business_id
  order by version.version_number desc;
end;
$$;

create function public.get_configuration_version(
  expected_business_id uuid,
  requested_version_id uuid
)
returns public.configuration_versions
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_version public.configuration_versions;
begin
  if auth.uid() is null then
    raise exception 'configuration_authentication_required'
      using errcode = '42501';
  end if;
  if not private.can_manage_tenant(expected_business_id) then
    raise exception 'configuration_owner_or_admin_required'
      using errcode = '42501';
  end if;

  select version.*
  into selected_version
  from public.configuration_versions as version
  where version.business_id = expected_business_id
    and version.id = requested_version_id;
  if not found then
    raise exception 'configuration_version_not_found'
      using errcode = 'P0002';
  end if;

  return selected_version;
end;
$$;

create or replace function public.validate_configuration_change(
  expected_business_id uuid,
  expected_actor_id uuid,
  requested_change_set_id uuid
)
returns public.configuration_change_sets
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  current_head public.business_configuration_heads;
  selected_change_set public.configuration_change_sets;
  base_version public.configuration_versions;
  replayed jsonb;
  validation_result jsonb;
  lifecycle_at timestamptz;
begin
  if current_actor_id is null then
    raise exception 'configuration_authentication_required'
      using errcode = '42501';
  end if;
  if current_actor_id <> expected_actor_id then
    raise exception 'configuration_actor_context_mismatch'
      using errcode = '42501';
  end if;
  if not private.can_manage_tenant(expected_business_id) then
    raise exception 'configuration_owner_or_admin_required'
      using errcode = '42501';
  end if;

  select head.*
  into current_head
  from public.business_configuration_heads as head
  where head.business_id = expected_business_id
  for update;
  if not found then
    raise exception 'configuration_head_not_found'
      using errcode = 'P0002';
  end if;

  select change_set.*
  into selected_change_set
  from public.configuration_change_sets as change_set
  where change_set.business_id = expected_business_id
    and change_set.id = requested_change_set_id
  for update;
  if not found then
    raise exception 'configuration_change_set_not_found'
      using errcode = 'P0002';
  end if;

  if selected_change_set.status = 'validated' then
    return selected_change_set;
  end if;
  if selected_change_set.status <> 'proposed' then
    raise exception 'configuration_change_set_not_validatable'
      using errcode = '55000';
  end if;

  if selected_change_set.base_version_id <>
      current_head.active_version_id
    or selected_change_set.base_head_revision <>
      current_head.head_revision
  then
    update public.configuration_change_sets as change_set
    set
      status = 'conflicted',
      closed_by = current_actor_id,
      closed_at = now(),
      updated_at = now()
    where change_set.business_id = expected_business_id
      and change_set.id = requested_change_set_id
    returning change_set.* into selected_change_set;
    return selected_change_set;
  end if;

  select version.*
  into base_version
  from public.configuration_versions as version
  where version.business_id = expected_business_id
    and version.id = selected_change_set.base_version_id;
  if not found then
    raise exception 'configuration_active_version_not_found'
      using errcode = 'P0002';
  end if;

  begin
    replayed := private.replay_configuration_change_set_v1(
      selected_change_set,
      base_version
    );
  exception
    when others then
      raise exception 'configuration_candidate_replay_failed'
        using errcode = 'P0001';
  end;

  if replayed -> 'candidate_snapshot' <>
      selected_change_set.candidate_snapshot_json
    or replayed ->> 'candidate_checksum' <>
      selected_change_set.candidate_checksum
    or replayed -> 'id_allocations' <>
      selected_change_set.id_allocations_json
    or replayed -> 'semantic_diff' <>
      selected_change_set.semantic_diff_json
  then
    raise exception 'configuration_candidate_replay_mismatch'
      using errcode = 'P0001';
  end if;

  perform private.assert_configuration_projection_matches_v1(
    expected_business_id,
    base_version.snapshot_json,
    base_version.snapshot_checksum
  );

  validation_result :=
    private.validate_configuration_candidate_in_sandbox_v1(
      expected_business_id,
      selected_change_set.base_version_id,
      selected_change_set.base_head_revision,
      selected_change_set.candidate_checksum,
      selected_change_set.candidate_snapshot_json
    );
  lifecycle_at := now();

  if validation_result ->> 'outcome' = 'valid' then
    update public.configuration_change_sets as change_set
    set
      status = 'validated',
      validation_result_json = validation_result,
      validated_by = current_actor_id,
      validated_at = lifecycle_at,
      updated_at = lifecycle_at
    where change_set.business_id = expected_business_id
      and change_set.id = requested_change_set_id
    returning change_set.* into selected_change_set;
  else
    update public.configuration_change_sets as change_set
    set
      status = 'rejected',
      validation_result_json = validation_result,
      validated_by = current_actor_id,
      validated_at = lifecycle_at,
      closed_by = current_actor_id,
      closed_at = lifecycle_at,
      updated_at = lifecycle_at
    where change_set.business_id = expected_business_id
      and change_set.id = requested_change_set_id
    returning change_set.* into selected_change_set;
  end if;

  return selected_change_set;
end;
$$;

create or replace function public.apply_configuration_change(
  expected_business_id uuid,
  expected_actor_id uuid,
  requested_change_set_id uuid
)
returns public.configuration_change_sets
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  current_head public.business_configuration_heads;
  selected_change_set public.configuration_change_sets;
  base_version public.configuration_versions;
  replayed jsonb;
  captured_state text;
  captured_message text;
  captured_constraint text;
  owner_issue jsonb;
  invalid_result jsonb;
  lifecycle_at timestamptz;
  new_version_id uuid;
begin
  if current_actor_id is null then
    raise exception 'configuration_authentication_required'
      using errcode = '42501';
  end if;
  if current_actor_id <> expected_actor_id then
    raise exception 'configuration_actor_context_mismatch'
      using errcode = '42501';
  end if;
  if not private.can_manage_tenant(expected_business_id) then
    raise exception 'configuration_owner_or_admin_required'
      using errcode = '42501';
  end if;

  select head.*
  into current_head
  from public.business_configuration_heads as head
  where head.business_id = expected_business_id
  for update;
  if not found then
    raise exception 'configuration_head_not_found'
      using errcode = 'P0002';
  end if;

  select change_set.*
  into selected_change_set
  from public.configuration_change_sets as change_set
  where change_set.business_id = expected_business_id
    and change_set.id = requested_change_set_id
  for update;
  if not found then
    raise exception 'configuration_change_set_not_found'
      using errcode = 'P0002';
  end if;

  if selected_change_set.status = 'applied' then
    return selected_change_set;
  end if;
  if selected_change_set.status <> 'validated' then
    raise exception 'configuration_change_set_not_applicable'
      using errcode = '55000';
  end if;

  if selected_change_set.base_version_id <>
      current_head.active_version_id
    or selected_change_set.base_head_revision <>
      current_head.head_revision
  then
    update public.configuration_change_sets as change_set
    set
      status = 'conflicted',
      closed_by = current_actor_id,
      closed_at = now(),
      updated_at = now()
    where change_set.business_id = expected_business_id
      and change_set.id = requested_change_set_id
    returning change_set.* into selected_change_set;
    return selected_change_set;
  end if;

  select version.*
  into base_version
  from public.configuration_versions as version
  where version.business_id = expected_business_id
    and version.id = selected_change_set.base_version_id;
  if not found then
    raise exception 'configuration_active_version_not_found'
      using errcode = 'P0002';
  end if;
  if base_version.version_number <> current_head.head_revision then
    raise exception 'configuration_head_version_mismatch'
      using errcode = 'P0001';
  end if;

  perform private.assert_configuration_projection_matches_v1(
    expected_business_id,
    base_version.snapshot_json,
    base_version.snapshot_checksum
  );

  begin
    replayed := private.replay_configuration_change_set_v1(
      selected_change_set,
      base_version
    );
  exception
    when others then
      raise exception 'configuration_candidate_replay_failed'
        using errcode = 'P0001';
  end;

  if replayed -> 'candidate_snapshot' <>
      selected_change_set.candidate_snapshot_json
    or replayed ->> 'candidate_checksum' <>
      selected_change_set.candidate_checksum
    or replayed -> 'id_allocations' <>
      selected_change_set.id_allocations_json
    or replayed -> 'semantic_diff' <>
      selected_change_set.semantic_diff_json
  then
    raise exception 'configuration_candidate_replay_mismatch'
      using errcode = 'P0001';
  end if;

  begin
    perform private.project_configuration_candidate_v1(
      expected_business_id,
      selected_change_set.candidate_snapshot_json
    );
  exception
    when others then
      get stacked diagnostics
        captured_state = returned_sqlstate,
        captured_message = message_text,
        captured_constraint = constraint_name;

      owner_issue := private.configuration_validation_issue_v1(
        captured_state,
        captured_message,
        captured_constraint
      );
      if owner_issue is null then
        raise;
      end if;

      lifecycle_at := now();
      invalid_result := jsonb_build_object(
        'schema_version',
        1,
        'outcome',
        'invalid',
        'base_version_id',
        selected_change_set.base_version_id,
        'base_head_revision',
        selected_change_set.base_head_revision,
        'candidate_checksum',
        selected_change_set.candidate_checksum,
        'errors',
        jsonb_build_array(owner_issue),
        'warnings',
        jsonb_build_array()
      );

      update public.configuration_change_sets as change_set
      set
        status = 'rejected',
        validation_result_json = invalid_result,
        validated_by = current_actor_id,
        validated_at = lifecycle_at,
        closed_by = current_actor_id,
        closed_at = lifecycle_at,
        updated_at = lifecycle_at
      where change_set.business_id = expected_business_id
        and change_set.id = requested_change_set_id
      returning change_set.* into selected_change_set;
      return selected_change_set;
  end;

  perform private.assert_configuration_projection_matches_v1(
    expected_business_id,
    selected_change_set.candidate_snapshot_json,
    selected_change_set.candidate_checksum
  );

  insert into public.configuration_versions (
    business_id,
    version_number,
    kind,
    parent_version_id,
    restored_from_version_id,
    source_change_set_id,
    snapshot_schema_version,
    snapshot_json,
    snapshot_checksum,
    created_by
  )
  values (
    expected_business_id,
    base_version.version_number + 1,
    case
      when selected_change_set.kind = 'rollback' then 'rollback'
      else 'change'
    end::public.configuration_version_kind,
    base_version.id,
    case
      when selected_change_set.kind = 'rollback'
        then selected_change_set.rollback_target_version_id
      else null
    end,
    selected_change_set.id,
    1,
    selected_change_set.candidate_snapshot_json,
    selected_change_set.candidate_checksum,
    current_actor_id
  )
  returning id into new_version_id;

  update public.business_configuration_heads as head
  set
    active_version_id = new_version_id,
    head_revision = current_head.head_revision + 1,
    updated_at = now()
  where head.business_id = expected_business_id;

  lifecycle_at := now();
  update public.configuration_change_sets as change_set
  set
    status = 'applied',
    applied_version_id = new_version_id,
    applied_by = current_actor_id,
    applied_at = lifecycle_at,
    updated_at = lifecycle_at
  where change_set.business_id = expected_business_id
    and change_set.id = requested_change_set_id
  returning change_set.* into selected_change_set;

  perform private.assert_configuration_application_state_v1(
    expected_business_id,
    selected_change_set.id,
    new_version_id
  );

  return selected_change_set;
end;
$$;

revoke all on function private.build_configuration_rollback_display_context_v1(
  uuid,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.configuration_rollback_candidate_v1(
  uuid,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.replay_configuration_change_set_v1(
  public.configuration_change_sets,
  public.configuration_versions
) from public, anon, authenticated, service_role;

revoke all on function public.prepare_configuration_rollback(
  uuid,
  uuid,
  uuid,
  text,
  text
) from public, anon, service_role;
grant execute on function public.prepare_configuration_rollback(
  uuid,
  uuid,
  uuid,
  text,
  text
) to authenticated;

revoke all on function public.list_configuration_versions(uuid)
from public, anon, service_role;
grant execute on function public.list_configuration_versions(uuid)
to authenticated;

revoke all on function public.get_configuration_version(uuid, uuid)
from public, anon, service_role;
grant execute on function public.get_configuration_version(uuid, uuid)
to authenticated;

comment on function public.prepare_configuration_rollback(
  uuid,
  uuid,
  uuid,
  text,
  text
) is
  'Owner/Admin Phase 4A boundary that prepares a forward-only rollback proposal from an earlier same-Business immutable version without changing projection, history head or operational data.';
comment on function private.configuration_rollback_candidate_v1(
  uuid,
  jsonb,
  jsonb,
  jsonb
) is
  'Deterministically restores historical configuration by stable identity and archives current-only entities without allocating IDs or materialising normalized tables.';
comment on function private.replay_configuration_change_set_v1(
  public.configuration_change_sets,
  public.configuration_versions
) is
  'Single Phase 4A replay dispatcher shared by validation and application for ordinary changes and trusted rollback proposals.';
