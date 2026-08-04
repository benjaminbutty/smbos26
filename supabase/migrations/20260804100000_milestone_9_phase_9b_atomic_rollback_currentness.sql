-- Milestone 9 Phase 9B
-- Rollback preparation must compare the contextual active source and head
-- revision while holding the existing Business-head lock. The old overload is
-- removed so callers cannot bypass that comparison.

revoke all on function public.prepare_configuration_rollback(
  uuid,
  uuid,
  uuid,
  text,
  text
) from public, anon, authenticated, service_role;

drop function public.prepare_configuration_rollback(
  uuid,
  uuid,
  uuid,
  text,
  text
);

create function public.prepare_configuration_rollback(
  expected_business_id uuid,
  expected_actor_id uuid,
  expected_active_source_version_id uuid,
  expected_head_revision bigint,
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
  if current_actor_id is distinct from expected_actor_id then
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

  if current_head.active_version_id is distinct from
      expected_active_source_version_id
    or current_head.head_revision is distinct from expected_head_revision
  then
    raise exception 'configuration_proposal_stale'
      using errcode = 'P0001';
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

revoke all on function public.prepare_configuration_rollback(
  uuid,
  uuid,
  uuid,
  bigint,
  uuid,
  text,
  text
) from public, anon, service_role;

grant execute on function public.prepare_configuration_rollback(
  uuid,
  uuid,
  uuid,
  bigint,
  uuid,
  text,
  text
) to authenticated;

comment on function public.prepare_configuration_rollback(
  uuid,
  uuid,
  uuid,
  bigint,
  uuid,
  text,
  text
) is
  'Owner/Admin rollback proposal boundary. It locks the Business head, compares the expected active source version and head revision, and derives one forward rollback proposal from a server-validated earlier version.';
