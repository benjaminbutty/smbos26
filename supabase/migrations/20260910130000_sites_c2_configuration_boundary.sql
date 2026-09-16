-- C2 configuration compatibility for adopted Sites.
--
-- The existing configuration engine materializes a candidate by parking and
-- rebuilding Page rows inside a rollback-only subtransaction.  An adopted
-- Site must still reject direct public Page writes, but these trusted
-- configuration paths need a transaction-local marker for their internal
-- projection writes.  The marker is set only inside security-definer
-- functions below; it is never accepted from a browser argument.

create or replace function private.guard_adopted_public_page_mutation_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_business_id uuid := coalesce(new.business_id, old.business_id);
  state_migration_state text;
  release_write boolean :=
    coalesce(pg_catalog.current_setting('smbos.site_release_write', true), '') = 'on';
  configuration_write boolean :=
    coalesce(pg_catalog.current_setting('smbos.site_configuration_write', true), '') = 'on';
begin
  select state.migration_state into state_migration_state
  from public.site_states as state
  where state.business_id = target_business_id
  for update;
  if state_migration_state = 'adopted'
    and (
      coalesce(new.audience, old.audience)::text = 'public'
      or old.audience::text = 'public'
    )
    and not release_write
    and not configuration_write
  then
    raise exception 'legacy_public_actions_retired' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
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
  selected_change public.configuration_change_sets;
  current_actor_id uuid := auth.uid();
begin
  if current_actor_id is null then
    raise exception 'configuration_authentication_required' using errcode = '42501';
  end if;
  if current_actor_id is distinct from expected_actor_id then
    raise exception 'configuration_actor_context_mismatch' using errcode = '42501';
  end if;
  if not private.can_manage_tenant(expected_business_id) then
    raise exception 'configuration_owner_or_admin_required' using errcode = '42501';
  end if;
  perform 1 from public.business_configuration_heads
  where business_id = expected_business_id for update;
  select * into selected_change
  from public.configuration_change_sets
  where business_id = expected_business_id and id = requested_change_set_id
  for share;
  if not found then
    raise exception 'configuration_change_set_not_found' using errcode = 'P0002';
  end if;
  perform private.site_assert_public_page_mutation_authority_v2(
    expected_business_id, selected_change.operations_json
  );
  perform pg_catalog.set_config('smbos.site_configuration_write', 'on', true);
  begin
    selected_change := public.apply_configuration_change_c1_v1(
      expected_business_id, expected_actor_id, requested_change_set_id
    );
    perform pg_catalog.set_config('smbos.site_configuration_write', 'off', true);
    return selected_change;
  exception when others then
    perform pg_catalog.set_config('smbos.site_configuration_write', 'off', true);
    raise;
  end;
end;
$$;

-- Preserve the existing rollback-only validator contract while allowing the
-- adopted Page trigger to distinguish candidate materialization from a
-- caller's direct public Page mutation.
create or replace function private.validate_configuration_candidate_in_sandbox_v1(
  target_business_id uuid,
  target_base_version_id uuid,
  target_base_head_revision bigint,
  target_candidate_checksum text,
  candidate jsonb
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  captured_state text;
  captured_message text;
  captured_constraint text;
  owner_issue jsonb;
begin
  begin
    perform pg_catalog.set_config('smbos.site_configuration_write', 'on', true);
    perform private.project_configuration_candidate_v1(
      target_business_id,
      candidate
    );
    perform pg_catalog.set_config('smbos.site_configuration_write', 'off', true);

    raise exception 'configuration_validation_sandbox_success'
      using errcode = 'ZB001';
  exception
    when sqlstate 'ZB001' then
      perform pg_catalog.set_config('smbos.site_configuration_write', 'off', true);
      set constraints all deferred;
      return jsonb_build_object(
        'schema_version', 1,
        'outcome', 'valid',
        'base_version_id', target_base_version_id,
        'base_head_revision', target_base_head_revision,
        'candidate_checksum', target_candidate_checksum,
        'errors', jsonb_build_array(),
        'warnings', jsonb_build_array()
      );
    when others then
      perform pg_catalog.set_config('smbos.site_configuration_write', 'off', true);
      get stacked diagnostics
        captured_state = returned_sqlstate,
        captured_message = message_text,
        captured_constraint = constraint_name;
      set constraints all deferred;

      owner_issue := private.configuration_validation_issue_v1(
        captured_state,
        captured_message,
        captured_constraint
      );
      if owner_issue is null then
        raise exception 'configuration_validation_engine_failure'
          using errcode = 'P0001';
      end if;

      return jsonb_build_object(
        'schema_version', 1,
        'outcome', 'invalid',
        'base_version_id', target_base_version_id,
        'base_head_revision', target_base_head_revision,
        'candidate_checksum', target_candidate_checksum,
        'errors', jsonb_build_array(owner_issue),
        'warnings', jsonb_build_array()
      );
  end;
end;
$$;

-- The C1 projector parks every active Object and Field before rebuilding a
-- candidate. Those transient toggles are implementation details of the
-- configuration transaction, not an operational withdrawal. The source
-- transition trigger is suppressed while that projector runs; the trusted
-- application wrapper below compares the immutable base and candidate
-- snapshots and records only real active-state changes.
create or replace function private.site_reconcile_record_transition_v2(
  target_business_id uuid,
  target_record_id uuid,
  target_is_active boolean,
  target_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  site_value record;
  current_value public.site_public_record_availability;
begin
  for site_value in
    select state.id, state.active_release_revision, state.created_by,
      state.draft_json
    from public.site_states as state
    where state.business_id = target_business_id
      and (
        exists (
          select 1
          from public.site_release_record_references as reference
          where reference.business_id = target_business_id
            and reference.record_id = target_record_id
        )
        or exists (
          select 1
          from private.site_draft_blocks_v1(state.draft_json) as block_value
          where block_value.block ->> 'type' = 'collection'
            and exists (
              select 1
              from private.site_collection_record_ids_v2(
                target_business_id, block_value.block
              ) as selected_record
              where selected_record.record_id = target_record_id
            )
        )
        or exists (
          select 1
          from public.site_record_media_attachments as attachment
          where attachment.business_id = target_business_id
            and attachment.site_id = state.id
            and attachment.record_id = target_record_id
        )
      )
    order by state.id
    for update
  loop
    select * into current_value
    from public.site_public_record_availability
    where business_id = target_business_id
      and site_id = site_value.id
      and record_id = target_record_id
    for update;
    if target_is_active then
      if found then
        update public.site_public_record_availability
        set status = case when current_value.status = 'withdrawn'
            then 'withdrawn' else 'available' end,
          availability_revision = current_value.availability_revision + 1,
          available_from_release_revision = greatest(
            current_value.available_from_release_revision,
            site_value.active_release_revision + 1
          ),
          changed_by = coalesce(target_actor_id, site_value.created_by),
          changed_at = timezone('utc', now())
        where business_id = target_business_id
          and site_id = site_value.id
          and record_id = target_record_id;
      else
        insert into public.site_public_record_availability (
          business_id, site_id, record_id, status,
          available_from_release_revision, changed_by
        ) values (
          target_business_id, site_value.id, target_record_id, 'available',
          site_value.active_release_revision + 1,
          coalesce(target_actor_id, site_value.created_by)
        );
      end if;
    else
      if found then
        update public.site_public_record_availability
        set status = 'withdrawn',
          availability_revision = current_value.availability_revision + 1,
          available_from_release_revision = 0,
          changed_by = coalesce(target_actor_id, site_value.created_by),
          changed_at = timezone('utc', now())
        where business_id = target_business_id
          and site_id = site_value.id
          and record_id = target_record_id;
      else
        insert into public.site_public_record_availability (
          business_id, site_id, record_id, status,
          available_from_release_revision, changed_by
        ) values (
          target_business_id, site_value.id, target_record_id, 'withdrawn', 0,
          coalesce(target_actor_id, site_value.created_by)
        );
      end if;
    end if;
  end loop;
end;
$$;

create or replace function private.site_reconcile_object_transition_v2(
  target_business_id uuid,
  target_object_definition_id uuid,
  target_is_active boolean,
  target_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  object_key text;
  site_value record;
  current_value public.site_public_object_availability;
begin
  select definition.key into object_key
  from public.object_definitions as definition
  where definition.business_id = target_business_id
    and definition.id = target_object_definition_id;
  if object_key is null then return; end if;
  for site_value in
    select state.id, state.active_release_revision, state.created_by,
      state.draft_json
    from public.site_states as state
    where state.business_id = target_business_id
      and (
        exists (
          select 1
          from public.site_release_collection_references as reference
          where reference.business_id = target_business_id
            and reference.object_definition_id = target_object_definition_id
        )
        or exists (
          select 1
          from private.site_draft_blocks_v1(state.draft_json) as block_value
          where block_value.block ->> 'type' = 'collection'
            and block_value.block ->> 'object_key' = object_key
        )
      )
    order by state.id
    for update
  loop
    select * into current_value
    from public.site_public_object_availability
    where business_id = target_business_id
      and site_id = site_value.id
      and object_definition_id = target_object_definition_id
    for update;
    if target_is_active then
      if found then
        update public.site_public_object_availability
        set status = case when current_value.status = 'withdrawn'
            then 'withdrawn' else 'available' end,
          availability_revision = current_value.availability_revision + 1,
          available_from_release_revision = greatest(
            current_value.available_from_release_revision,
            site_value.active_release_revision + 1
          ),
          changed_by = coalesce(target_actor_id, site_value.created_by),
          changed_at = timezone('utc', now())
        where business_id = target_business_id
          and site_id = site_value.id
          and object_definition_id = target_object_definition_id;
      else
        insert into public.site_public_object_availability (
          business_id, site_id, object_definition_id, status,
          available_from_release_revision, changed_by
        ) values (
          target_business_id, site_value.id, target_object_definition_id,
          'available', site_value.active_release_revision + 1,
          coalesce(target_actor_id, site_value.created_by)
        );
      end if;
    else
      if found then
        update public.site_public_object_availability
        set status = 'withdrawn',
          availability_revision = current_value.availability_revision + 1,
          available_from_release_revision = 0,
          changed_by = coalesce(target_actor_id, site_value.created_by),
          changed_at = timezone('utc', now())
        where business_id = target_business_id
          and site_id = site_value.id
          and object_definition_id = target_object_definition_id;
      else
        insert into public.site_public_object_availability (
          business_id, site_id, object_definition_id, status,
          available_from_release_revision, changed_by
        ) values (
          target_business_id, site_value.id, target_object_definition_id,
          'withdrawn', 0, coalesce(target_actor_id, site_value.created_by)
        );
      end if;
    end if;
  end loop;
end;
$$;

create or replace function private.site_reconcile_field_transition_v2(
  target_business_id uuid,
  target_field_definition_id uuid,
  target_is_active boolean,
  target_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  field_key text;
  site_value record;
  current_value public.site_public_field_availability;
begin
  select definition.key into field_key
  from public.field_definitions as definition
  where definition.business_id = target_business_id
    and definition.id = target_field_definition_id;
  if field_key is null then return; end if;
  for site_value in
    select state.id, state.active_release_revision, state.created_by,
      state.draft_json
    from public.site_states as state
    where state.business_id = target_business_id
      and (
        exists (
          select 1
          from public.site_release_collection_references as reference
          where reference.business_id = target_business_id
            and reference.field_definition_id = target_field_definition_id
        )
        or exists (
          select 1
          from private.site_draft_blocks_v1(state.draft_json) as block_value
          where block_value.block ->> 'type' = 'collection'
            and exists (
              select 1
              from jsonb_array_elements(
                block_value.block -> 'public_field_keys'
              ) as field_value(value)
              where field_value.value #>> '{}' = field_key
            )
        )
      )
    order by state.id
    for update
  loop
    select * into current_value
    from public.site_public_field_availability
    where business_id = target_business_id
      and site_id = site_value.id
      and field_definition_id = target_field_definition_id
    for update;
    if target_is_active then
      if found then
        update public.site_public_field_availability
        set status = case when current_value.status = 'withdrawn'
            then 'withdrawn' else 'available' end,
          availability_revision = current_value.availability_revision + 1,
          available_from_release_revision = greatest(
            current_value.available_from_release_revision,
            site_value.active_release_revision + 1
          ),
          changed_by = coalesce(target_actor_id, site_value.created_by),
          changed_at = timezone('utc', now())
        where business_id = target_business_id
          and site_id = site_value.id
          and field_definition_id = target_field_definition_id;
      else
        insert into public.site_public_field_availability (
          business_id, site_id, field_definition_id, status,
          available_from_release_revision, changed_by
        ) values (
          target_business_id, site_value.id, target_field_definition_id,
          'available', site_value.active_release_revision + 1,
          coalesce(target_actor_id, site_value.created_by)
        );
      end if;
    else
      if found then
        update public.site_public_field_availability
        set status = 'withdrawn',
          availability_revision = current_value.availability_revision + 1,
          available_from_release_revision = 0,
          changed_by = coalesce(target_actor_id, site_value.created_by),
          changed_at = timezone('utc', now())
        where business_id = target_business_id
          and site_id = site_value.id
          and field_definition_id = target_field_definition_id;
      else
        insert into public.site_public_field_availability (
          business_id, site_id, field_definition_id, status,
          available_from_release_revision, changed_by
        ) values (
          target_business_id, site_value.id, target_field_definition_id,
          'withdrawn', 0, coalesce(target_actor_id, site_value.created_by)
        );
      end if;
    end if;
  end loop;
end;
$$;

create or replace function private.site_reconcile_configuration_source_transitions_v2(
  target_business_id uuid,
  base_snapshot jsonb,
  candidate_snapshot jsonb,
  target_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_value jsonb;
  candidate_value jsonb;
  old_active boolean;
  new_active boolean;
  source_id uuid;
begin
  for base_value in
    select value
    from jsonb_array_elements(
      coalesce(base_snapshot -> 'object_definitions', '[]'::jsonb)
    )
  loop
    source_id := (base_value ->> 'id')::uuid;
    select value into candidate_value
    from jsonb_array_elements(
      coalesce(candidate_snapshot -> 'object_definitions', '[]'::jsonb)
    )
    where value ->> 'id' = base_value ->> 'id'
    limit 1;
    old_active := coalesce((base_value ->> 'is_active')::boolean, false);
    new_active := coalesce((candidate_value ->> 'is_active')::boolean, false);
    if old_active is distinct from new_active then
      perform private.site_reconcile_object_transition_v2(
        target_business_id, source_id, new_active, target_actor_id
      );
    end if;
  end loop;

  for base_value in
    select value
    from jsonb_array_elements(
      coalesce(base_snapshot -> 'field_definitions', '[]'::jsonb)
    )
  loop
    source_id := (base_value ->> 'id')::uuid;
    select value into candidate_value
    from jsonb_array_elements(
      coalesce(candidate_snapshot -> 'field_definitions', '[]'::jsonb)
    )
    where value ->> 'id' = base_value ->> 'id'
    limit 1;
    old_active := coalesce((base_value ->> 'is_active')::boolean, false);
    new_active := coalesce((candidate_value ->> 'is_active')::boolean, false);
    if old_active is distinct from new_active then
      perform private.site_reconcile_field_transition_v2(
        target_business_id, source_id, new_active, target_actor_id
      );
    end if;
  end loop;
end;
$$;

-- Suppress only projector parking. Ordinary direct source updates continue to
-- use this trigger, while configuration application reconciles real snapshot
-- transitions through the typed helpers above.
create or replace function private.site_mark_source_transition_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_kind text;
  target_business_id uuid;
  source_id uuid;
  was_active boolean;
  is_active boolean;
begin
  if coalesce(
    pg_catalog.current_setting('smbos.site_projection_write', true), ''
  ) = 'on'
    or coalesce(
      pg_catalog.current_setting('smbos.site_configuration_write', true), ''
    ) = 'on'
  then
    return new;
  end if;
  if tg_op <> 'UPDATE' then return new; end if;
  source_kind := case tg_table_name
    when 'records' then 'record'
    when 'object_definitions' then 'object'
    when 'field_definitions' then 'field'
    else null
  end;
  if source_kind is null then return new; end if;
  target_business_id := coalesce(new.business_id, old.business_id);
  source_id := coalesce(new.id, old.id);
  if source_kind = 'record' then
    was_active := old.record_status = 'active';
    is_active := new.record_status = 'active';
  else
    was_active := old.is_active;
    is_active := new.is_active;
  end if;
  if was_active = is_active then return new; end if;
  if source_kind = 'record' then
    perform private.site_reconcile_record_transition_v2(
      target_business_id, source_id, is_active, auth.uid()
    );
  elsif source_kind = 'object' then
    perform private.site_reconcile_object_transition_v2(
      target_business_id, source_id, is_active, auth.uid()
    );
  else
    perform private.site_reconcile_field_transition_v2(
      target_business_id, source_id, is_active, auth.uid()
    );
  end if;
  return new;
end;
$$;

-- Keep the C1 algorithm unchanged and put the projector marker/reconciliation
-- around it. This wrapper is used by both the owner Changes path and the
-- trusted Site release publisher.
alter function public.apply_configuration_change_c1_v1(uuid, uuid, uuid)
  rename to apply_configuration_change_c1_raw_v2;

create function public.apply_configuration_change_c1_v1(
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
  previous_status text;
  base_snapshot jsonb;
  applied_change public.configuration_change_sets;
begin
  select change_set.status into previous_status
  from public.configuration_change_sets as change_set
  where change_set.business_id = expected_business_id
    and change_set.id = requested_change_set_id;
  select version.snapshot_json into base_snapshot
  from public.configuration_versions as version
  join public.configuration_change_sets as change_set
    on change_set.business_id = version.business_id
    and change_set.base_version_id = version.id
  where change_set.business_id = expected_business_id
    and change_set.id = requested_change_set_id;

  perform pg_catalog.set_config('smbos.site_projection_write', 'on', true);
  begin
    applied_change := public.apply_configuration_change_c1_raw_v2(
      expected_business_id, expected_actor_id, requested_change_set_id
    );
    perform pg_catalog.set_config('smbos.site_projection_write', 'off', true);
  exception when others then
    perform pg_catalog.set_config('smbos.site_projection_write', 'off', true);
    raise;
  end;

  if previous_status is distinct from 'applied'
    and applied_change.status = 'applied'
    and base_snapshot is not null
  then
    perform private.site_reconcile_configuration_source_transitions_v2(
      expected_business_id,
      base_snapshot,
      applied_change.candidate_snapshot_json,
      expected_actor_id
    );
  end if;
  return applied_change;
end;
$$;

revoke all on function public.apply_configuration_change_c1_raw_v2(
  uuid, uuid, uuid
), public.apply_configuration_change_c1_v1(uuid, uuid, uuid)
from public, anon, authenticated, service_role;

revoke all on function
  private.site_reconcile_record_transition_v2(uuid, uuid, boolean, uuid),
  private.site_reconcile_object_transition_v2(uuid, uuid, boolean, uuid),
  private.site_reconcile_field_transition_v2(uuid, uuid, boolean, uuid),
  private.site_reconcile_configuration_source_transitions_v2(
    uuid, jsonb, jsonb, uuid
  )
from public, anon, authenticated, service_role;

-- Keep adoption's source CAS observable while the compatibility boundary is
-- exercised. The two messages identify whether a source page failed to map to
-- the imported draft or the final source fingerprint changed; both remain
-- fail-closed adoption errors.
create or replace function public.stage_site_adoption(
  expected_business_id uuid,
  expected_actor_id uuid,
  requested_site_id uuid,
  expected_draft_revision bigint,
  expected_base_version_id uuid,
  expected_head_revision bigint
)
returns public.site_states
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_head public.business_configuration_heads;
  selected_state public.site_states;
  imported_draft jsonb;
  page_value jsonb;
  draft_page_id uuid;
  source_page public.pages;
  source_checksum text;
  source_fingerprint text;
  source_count integer;
  source_index integer := 0;
begin
  if expected_business_id is null or expected_actor_id is null
    or requested_site_id is null or expected_draft_revision is null
    or expected_draft_revision <= 0 or expected_base_version_id is null
    or expected_head_revision is null or expected_head_revision <= 0
  then
    raise exception 'site_request_invalid' using errcode = '22023';
  end if;
  perform private.site_assert_actor_v1(expected_business_id, expected_actor_id);
  select * into current_head from public.business_configuration_heads
  where business_id = expected_business_id for update;
  if not found then
    raise exception 'configuration_head_not_found' using errcode = 'P0002';
  end if;
  if current_head.active_version_id <> expected_base_version_id
    or current_head.head_revision <> expected_head_revision
  then
    raise exception 'site_configuration_stale' using errcode = 'P0001';
  end if;
  select * into selected_state from public.site_states
  where business_id = expected_business_id and id = requested_site_id for update;
  if not found then raise exception 'site_not_found' using errcode = 'P0002'; end if;
  if selected_state.draft_revision <> expected_draft_revision then
    raise exception 'site_draft_stale' using errcode = 'P0001';
  end if;
  if selected_state.migration_state = 'adopted' then
    raise exception 'site_already_adopted' using errcode = '55000';
  end if;
  select count(*) into source_count
  from public.pages as page_value
  where page_value.business_id = expected_business_id
    and page_value.audience = 'public'
    and page_value.status = 'published'
    and page_value.is_active;
  if source_count = 0 then
    raise exception 'site_adoption_source_not_found' using errcode = 'P0002';
  end if;
  source_fingerprint := private.site_legacy_source_fingerprint_v2(expected_business_id);
  imported_draft := private.site_import_legacy_draft_v2(expected_business_id);
  perform private.site_assert_site_draft_c2(expected_business_id, imported_draft);
  delete from public.site_page_bindings
  where business_id = expected_business_id and site_id = requested_site_id
    and legacy_source_page_id is not null;
  for source_page in
    select page_item.*
    from public.pages as page_item
    where page_item.business_id = expected_business_id
      and page_item.audience = 'public'
      and page_item.status = 'published'
      and page_item.is_active
    order by page_item.slug, page_item.id
  loop
    source_index := source_index + 1;
    select item.value into page_value
    from jsonb_array_elements(imported_draft -> 'pages')
      with ordinality as item(value, ordinal)
    where item.ordinal = source_index;
    if page_value is null then
      raise exception 'site_adoption_stale_import' using errcode = 'P0001';
    end if;
    draft_page_id := (page_value ->> 'id')::uuid;
    source_checksum := encode(
      extensions.digest(
        convert_to(to_jsonb(source_page)::text, 'UTF8'), 'sha256'
      ),
      'hex'
    );
    insert into public.site_page_bindings (
      business_id, site_id, draft_page_id, canonical_page_key,
      legacy_source_page_id, legacy_source_checksum
    ) values (
      expected_business_id, requested_site_id, draft_page_id,
      private.site_page_key_v1(requested_site_id, draft_page_id),
      source_page.id, source_checksum
    );
  end loop;
  if private.site_legacy_source_fingerprint_v2(expected_business_id)
    <> source_fingerprint
  then
    raise exception 'site_adoption_stale_fingerprint' using errcode = 'P0001';
  end if;
  update public.site_states set
    draft_json = imported_draft,
    draft_revision = selected_state.draft_revision + 1,
    migration_state = 'legacy_pending',
    legacy_source_checksum = source_fingerprint,
    legacy_source_page_count = source_count,
    draft_base_version_id = current_head.active_version_id,
    draft_base_head_revision = current_head.head_revision,
    updated_at = timezone('utc', now())
  where business_id = expected_business_id and id = requested_site_id
  returning * into selected_state;
  perform private.site_sync_draft_asset_references_v1(
    expected_business_id, requested_site_id, selected_state.draft_revision,
    imported_draft
  );
  return selected_state;
end;
$$;
