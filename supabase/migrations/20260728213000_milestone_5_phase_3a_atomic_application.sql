alter table public.configuration_change_sets
  drop constraint configuration_change_sets_validation_shape,
  drop constraint configuration_change_sets_rejected_actor_shape;

alter table public.configuration_change_sets
  add constraint configuration_change_sets_validation_shape
  check (
    (
      status in ('validated', 'applied')
      and validation_result_json is not null
      and private.configuration_validation_result_v1_is_valid(
        validation_result_json
      )
      and validation_result_json ->> 'outcome' = 'valid'
      and (validation_result_json ->> 'base_version_id')::uuid =
        base_version_id
      and (validation_result_json ->> 'base_head_revision')::bigint =
        base_head_revision
      and validation_result_json ->> 'candidate_checksum' =
        candidate_checksum
      and validated_by is not null
      and validated_at is not null
    )
    or (
      status = 'rejected'
      and validation_result_json is not null
      and private.configuration_validation_result_v1_is_valid(
        validation_result_json
      )
      and validation_result_json ->> 'outcome' = 'invalid'
      and (validation_result_json ->> 'base_version_id')::uuid =
        base_version_id
      and (validation_result_json ->> 'base_head_revision')::bigint =
        base_head_revision
      and validation_result_json ->> 'candidate_checksum' =
        candidate_checksum
      and validated_by is not null
      and validated_at is not null
    )
    or (
      status = 'conflicted'
      and (
        (
          validation_result_json is null
          and validated_by is null
          and validated_at is null
        )
        or (
          validation_result_json is not null
          and private.configuration_validation_result_v1_is_valid(
            validation_result_json
          )
          and validation_result_json ->> 'outcome' = 'valid'
          and (validation_result_json ->> 'base_version_id')::uuid =
            base_version_id
          and (validation_result_json ->> 'base_head_revision')::bigint =
            base_head_revision
          and validation_result_json ->> 'candidate_checksum' =
            candidate_checksum
          and validated_by is not null
          and validated_at is not null
        )
      )
    )
    or (
      status in ('proposed', 'abandoned')
      and validation_result_json is null
      and validated_by is null
      and validated_at is null
    )
  ),
  add constraint configuration_change_sets_rejected_actor_shape
  check (
    status <> 'rejected'
    or (
      closed_by = validated_by
      and closed_at = validated_at
    )
  );

drop trigger configuration_change_sets_protect
on public.configuration_change_sets;

create or replace function private.protect_configuration_change_set()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  immutable_payload_unchanged boolean;
begin
  immutable_payload_unchanged :=
    new.business_id = old.business_id
    and new.kind = old.kind
    and new.title = old.title
    and new.description is not distinct from old.description
    and new.base_version_id = old.base_version_id
    and new.base_head_revision = old.base_head_revision
    and new.rollback_target_version_id is not distinct from
      old.rollback_target_version_id
    and new.requested_by = old.requested_by
    and new.operations_schema_version = old.operations_schema_version
    and new.operations_json = old.operations_json
    and new.id_allocations_json = old.id_allocations_json
    and new.display_context_json = old.display_context_json
    and new.candidate_snapshot_json = old.candidate_snapshot_json
    and new.candidate_checksum = old.candidate_checksum
    and new.semantic_diff_json = old.semantic_diff_json
    and new.created_at = old.created_at;

  if old.status = 'proposed'
    and immutable_payload_unchanged
    and new.applied_version_id is null
    and new.applied_by is null
    and new.applied_at is null
    and (
      (
        new.status in ('abandoned', 'conflicted')
        and new.validation_result_json is null
        and new.validated_by is null
        and new.validated_at is null
        and new.closed_by is not null
        and new.closed_at is not null
      )
      or (
        new.status = 'validated'
        and private.configuration_validation_result_v1_is_valid(
          new.validation_result_json
        )
        and new.validation_result_json ->> 'outcome' = 'valid'
        and new.validated_by is not null
        and new.validated_at is not null
        and new.closed_by is null
        and new.closed_at is null
      )
      or (
        new.status = 'rejected'
        and private.configuration_validation_result_v1_is_valid(
          new.validation_result_json
        )
        and new.validation_result_json ->> 'outcome' = 'invalid'
        and new.validated_by is not null
        and new.validated_at is not null
        and new.closed_by = new.validated_by
        and new.closed_at = new.validated_at
      )
    )
  then
    return new;
  end if;

  if old.status = 'validated'
    and immutable_payload_unchanged
    and (
      (
        new.status = 'applied'
        and new.validation_result_json = old.validation_result_json
        and new.validated_by = old.validated_by
        and new.validated_at = old.validated_at
        and new.applied_version_id is not null
        and new.applied_by is not null
        and new.applied_at is not null
        and new.closed_by is null
        and new.closed_at is null
      )
      or (
        new.status = 'conflicted'
        and new.validation_result_json = old.validation_result_json
        and new.validated_by = old.validated_by
        and new.validated_at = old.validated_at
        and new.applied_version_id is null
        and new.applied_by is null
        and new.applied_at is null
        and new.closed_by is not null
        and new.closed_at is not null
      )
      or (
        new.status = 'rejected'
        and private.configuration_validation_result_v1_is_valid(
          new.validation_result_json
        )
        and new.validation_result_json ->> 'outcome' = 'invalid'
        and new.validated_by is not null
        and new.validated_at is not null
        and new.applied_version_id is null
        and new.applied_by is null
        and new.applied_at is null
        and new.closed_by = new.validated_by
        and new.closed_at = new.validated_at
      )
    )
  then
    return new;
  end if;

  raise exception 'configuration_change_set_immutable'
    using errcode = '55000';
end;
$$;

create trigger configuration_change_sets_protect
before update on public.configuration_change_sets
for each row execute function private.protect_configuration_change_set();

create or replace function private.protect_business_configuration_head()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_version public.configuration_versions;
begin
  if new.business_id is distinct from old.business_id then
    raise exception 'configuration_head_business_immutable'
      using errcode = '22023';
  end if;

  if new.head_revision <> old.head_revision + 1
    or new.active_version_id = old.active_version_id
  then
    raise exception 'configuration_head_advance_invalid'
      using errcode = '23514';
  end if;

  select version.*
  into target_version
  from public.configuration_versions as version
  where version.business_id = old.business_id
    and version.id = new.active_version_id;

  if not found
    or target_version.version_number <> new.head_revision
    or target_version.parent_version_id <> old.active_version_id
  then
    raise exception 'configuration_head_target_invalid'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create function private.assert_configuration_projection_matches_v1(
  target_business_id uuid,
  expected_snapshot jsonb,
  expected_checksum text
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  live_snapshot jsonb;
begin
  live_snapshot := private.configuration_snapshot_v1(target_business_id);
  if live_snapshot <> expected_snapshot
    or private.configuration_snapshot_checksum_v1(live_snapshot) <>
      expected_checksum
  then
    raise exception 'configuration_projection_out_of_sync'
      using errcode = 'P0001';
  end if;
end;
$$;

create function private.assert_configuration_application_state_v1(
  target_business_id uuid,
  target_change_set_id uuid,
  target_version_id uuid
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  applied_change_set public.configuration_change_sets;
  applied_version public.configuration_versions;
  active_head public.business_configuration_heads;
begin
  select change_set.*
  into applied_change_set
  from public.configuration_change_sets as change_set
  where change_set.business_id = target_business_id
    and change_set.id = target_change_set_id;

  select version.*
  into applied_version
  from public.configuration_versions as version
  where version.business_id = target_business_id
    and version.id = target_version_id;

  select head.*
  into active_head
  from public.business_configuration_heads as head
  where head.business_id = target_business_id;

  if applied_change_set.id is null
    or applied_version.id is null
    or active_head.business_id is null
    or applied_change_set.status <> 'applied'
    or applied_change_set.applied_version_id <> applied_version.id
    or applied_version.source_change_set_id <> applied_change_set.id
    or active_head.active_version_id <> applied_version.id
    or active_head.head_revision <> applied_version.version_number
    or applied_version.snapshot_json <>
      applied_change_set.candidate_snapshot_json
    or applied_version.snapshot_checksum <>
      applied_change_set.candidate_checksum
  then
    raise exception 'configuration_application_state_mismatch'
      using errcode = 'P0001';
  end if;

  perform private.assert_configuration_projection_matches_v1(
    target_business_id,
    applied_version.snapshot_json,
    applied_version.snapshot_checksum
  );
end;
$$;

create function public.apply_configuration_change(
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
    replayed := private.configuration_materialize_candidate_v1(
      expected_business_id,
      base_version.snapshot_json,
      selected_change_set.operations_json,
      selected_change_set.id_allocations_json,
      selected_change_set.display_context_json
    );
  exception
    when others then
      raise exception 'configuration_candidate_replay_failed'
        using errcode = 'P0001';
  end;

  perform private.assert_configuration_display_context_v1(
    selected_change_set.display_context_json,
    base_version.snapshot_json,
    selected_change_set.candidate_snapshot_json
  );

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
    'change',
    base_version.id,
    null,
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

revoke all on function private.assert_configuration_projection_matches_v1(
  uuid,
  jsonb,
  text
) from public, anon, authenticated, service_role;
revoke all on function private.assert_configuration_application_state_v1(
  uuid,
  uuid,
  uuid
) from public, anon, authenticated, service_role;

revoke all on function public.apply_configuration_change(
  uuid,
  uuid,
  uuid
) from public, anon, service_role;
grant execute on function public.apply_configuration_change(
  uuid,
  uuid,
  uuid
) to authenticated;

comment on function public.apply_configuration_change(uuid, uuid, uuid) is
  'Owner/Admin Phase 3A atomic application boundary. It locks head then validated proposal, replays immutable inputs, applies the static projector, creates one immutable version, advances the head once and marks the proposal applied.';

comment on function private.assert_configuration_application_state_v1(
  uuid,
  uuid,
  uuid
) is
  'Final Phase 3A assertion that live projection, applied proposal, immutable version and active Business head are identical.';
