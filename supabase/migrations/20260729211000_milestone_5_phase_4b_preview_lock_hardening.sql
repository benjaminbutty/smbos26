-- Milestone 5 Phase 4B.2
-- Serialize candidate preview with validation/application using the shared
-- head-first lock order while preserving a strictly read-only lifecycle.

create or replace function private.assert_configuration_preview_v1(
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
  live_snapshot jsonb;
  replayed jsonb;
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
  for share;
  if not found then
    raise exception 'configuration_head_not_found'
      using errcode = 'P0002';
  end if;

  select change_set.*
  into selected_change_set
  from public.configuration_change_sets as change_set
  where change_set.business_id = expected_business_id
    and change_set.id = requested_change_set_id
  for share;
  if not found then
    raise exception 'configuration_preview_not_found'
      using errcode = 'P0002';
  end if;

  if selected_change_set.status not in ('proposed', 'validated') then
    raise exception 'configuration_preview_unavailable'
      using errcode = '22023';
  end if;

  if selected_change_set.base_version_id <> current_head.active_version_id
    or selected_change_set.base_head_revision <> current_head.head_revision
  then
    raise exception 'configuration_preview_stale'
      using errcode = '55000';
  end if;

  select version.*
  into base_version
  from public.configuration_versions as version
  where version.business_id = expected_business_id
    and version.id = selected_change_set.base_version_id
  for share;
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

  replayed := private.replay_configuration_change_set_v1(
    selected_change_set,
    base_version
  );

  if replayed -> 'candidate_snapshot'
      <> selected_change_set.candidate_snapshot_json
    or replayed ->> 'candidate_checksum'
      <> selected_change_set.candidate_checksum
    or replayed -> 'id_allocations'
      <> selected_change_set.id_allocations_json
    or replayed -> 'semantic_diff'
      <> selected_change_set.semantic_diff_json
  then
    raise exception 'configuration_candidate_replay_mismatch'
      using errcode = 'P0001';
  end if;

  return selected_change_set;
end;
$$;

revoke all on function private.assert_configuration_preview_v1(
  uuid,
  uuid,
  uuid
) from public, anon, authenticated, service_role;

comment on function private.assert_configuration_preview_v1(
  uuid,
  uuid,
  uuid
) is
  'Read-only candidate assertion using head, change-set and base-version shared locks in lifecycle order; verifies the active projection and exact replay outputs without lifecycle mutation.';
