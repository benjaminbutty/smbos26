-- C2 mutating RPCs reject incomplete CAS and identity inputs before any lock or write.
-- Nullable comparisons in PL/pgSQL evaluate to NULL and do not enter an IF
-- branch, so each public boundary validates its complete request explicitly.

create or replace function public.publish_site_release_v2(
  expected_business_id uuid,
  expected_actor_id uuid,
  requested_site_id uuid,
  requested_candidate_id uuid,
  expected_draft_revision bigint,
  expected_base_version_id uuid,
  expected_head_revision bigint
)
returns public.site_releases
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_head public.business_configuration_heads;
  selected_change public.configuration_change_sets;
  selected_state public.site_states;
  selected_release public.site_releases;
  applied_change public.configuration_change_sets;
  configuration_already_applied boolean := false;
begin
  if expected_business_id is null or expected_actor_id is null
    or requested_site_id is null or requested_candidate_id is null
    or expected_draft_revision is null or expected_draft_revision <= 0
    or expected_base_version_id is null or expected_head_revision is null
    or expected_head_revision <= 0
  then raise exception 'site_request_invalid' using errcode = '22023'; end if;
  perform private.site_assert_actor_v1(expected_business_id, expected_actor_id);
  select * into current_head from public.business_configuration_heads
  where business_id = expected_business_id for update;
  if not found then raise exception 'configuration_head_not_found' using errcode = 'P0002'; end if;
  select * into selected_release from public.site_releases
  where business_id = expected_business_id and site_id = requested_site_id
    and id = requested_candidate_id for update;
  if not found then raise exception 'site_release_not_found' using errcode = 'P0002'; end if;
  if selected_release.projection_schema_version <> 2 then
    raise exception 'site_release_schema_unsupported' using errcode = '55000';
  end if;
  if selected_release.status in ('published', 'expired') then return selected_release; end if;
  if selected_release.status = 'prepared'
    and selected_release.expires_at <= timezone('utc', now())
  then
    update public.site_releases set status = 'expired'
    where business_id = expected_business_id and id = requested_candidate_id
    returning * into selected_release;
    return selected_release;
  end if;
  if selected_release.status <> 'prepared' then
    raise exception 'site_release_not_publishable' using errcode = '55000';
  end if;
  if selected_release.configuration_change_set_id is not null then
    select * into selected_change from public.configuration_change_sets
    where business_id = expected_business_id
      and id = selected_release.configuration_change_set_id for update;
    if not found or selected_change.status not in ('validated', 'applied')
      or selected_change.base_version_id <> selected_release.source_base_version_id
      or selected_change.base_head_revision <> selected_release.source_head_revision
    then raise exception 'site_configuration_incompatible' using errcode = '23514'; end if;
    if selected_change.status = 'applied' then
      if selected_change.applied_version_id is distinct from current_head.active_version_id
      then raise exception 'site_configuration_stale' using errcode = 'P0001'; end if;
      configuration_already_applied := true;
    end if;
  end if;
  select * into selected_state from public.site_states
  where business_id = expected_business_id and id = requested_site_id for update;
  if not found then raise exception 'site_not_found' using errcode = 'P0002'; end if;
  if selected_state.draft_revision <> expected_draft_revision
    or selected_release.source_draft_revision <> expected_draft_revision
  then raise exception 'site_draft_stale' using errcode = 'P0001'; end if;
  if selected_state.active_release_revision <> selected_release.expected_active_release_revision
  then raise exception 'site_release_stale' using errcode = 'P0001'; end if;
  if selected_state.draft_base_version_id <> selected_release.source_base_version_id
    or selected_state.draft_base_head_revision <> selected_release.source_head_revision
  then raise exception 'site_configuration_rebase_required' using errcode = 'P0001'; end if;
  if current_head.active_version_id <> expected_base_version_id
    or current_head.head_revision <> expected_head_revision
    or selected_release.source_base_version_id <> expected_base_version_id
    or selected_release.source_head_revision <> expected_head_revision
  then raise exception 'site_configuration_stale' using errcode = 'P0001'; end if;
  if selected_state.migration_state = 'new' and exists (
    select 1 from public.pages as page_value
    where page_value.business_id = expected_business_id
      and page_value.audience = 'public' and page_value.status = 'published'
      and page_value.is_active
  ) then raise exception 'site_adoption_required' using errcode = 'P0001'; end if;
  if selected_state.migration_state = 'legacy_pending' then
    perform private.site_assert_adoption_source_v2(
      expected_business_id, requested_site_id, selected_state.legacy_source_checksum
    );
  end if;
  if selected_release.configuration_change_set_id is not null
    and not configuration_already_applied
  then
    -- The trusted release path uses the original C1 application algorithm
    -- under a transaction-local marker. Direct Page/legacy callers cannot set
    -- this marker and are rejected by the adopted-page trigger below.
    perform pg_catalog.set_config('smbos.site_release_write', 'on', true);
    applied_change := public.apply_configuration_change_c1_v1(
      expected_business_id, expected_actor_id,
      selected_release.configuration_change_set_id
    );
    perform pg_catalog.set_config('smbos.site_release_write', 'off', true);
    if applied_change.status <> 'applied' then
      raise exception 'site_configuration_incompatible' using errcode = '23514';
    end if;
    selected_release.applied_version_id := applied_change.applied_version_id;
    select * into current_head from public.business_configuration_heads
    where business_id = expected_business_id;
  elsif configuration_already_applied then
    selected_release.applied_version_id := selected_change.applied_version_id;
  end if;
  perform private.site_bind_canonical_pages_v1(
    expected_business_id, requested_site_id, selected_state.draft_json
  );
  update public.site_releases set
    status = 'published', applied_version_id = selected_release.applied_version_id,
    published_by = expected_actor_id, published_at = timezone('utc', now())
  where business_id = expected_business_id and id = requested_candidate_id
  returning * into selected_release;
  perform pg_catalog.set_config('smbos.site_release_write', 'on', true);
  update public.site_states set
    active_release_id = selected_release.id,
    active_release_revision = active_release_revision + 1,
    migration_state = 'adopted',
    draft_base_version_id = coalesce(selected_release.applied_version_id, current_head.active_version_id),
    draft_base_head_revision = current_head.head_revision,
    updated_at = timezone('utc', now())
  where business_id = expected_business_id and id = requested_site_id;
  perform pg_catalog.set_config('smbos.site_release_write', 'off', true);
  return selected_release;
end;
$$;

create or replace function public.unpublish_site(
  expected_business_id uuid,
  expected_actor_id uuid,
  requested_site_id uuid,
  expected_active_release_revision bigint
)
returns public.site_states
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_head public.business_configuration_heads;
  selected_state public.site_states;
begin
  if expected_business_id is null or expected_actor_id is null
    or requested_site_id is null or expected_active_release_revision is null
    or expected_active_release_revision < 0
  then raise exception 'site_request_invalid' using errcode = '22023'; end if;
  perform private.site_assert_actor_v1(expected_business_id, expected_actor_id);
  select * into current_head from public.business_configuration_heads
  where business_id = expected_business_id for update;
  if not found then raise exception 'configuration_head_not_found' using errcode = 'P0002'; end if;
  select * into selected_state from public.site_states
  where business_id = expected_business_id and id = requested_site_id for update;
  if not found then raise exception 'site_not_found' using errcode = 'P0002'; end if;
  if selected_state.migration_state <> 'adopted'
    or selected_state.active_release_id is null
    or selected_state.active_release_revision <> expected_active_release_revision
  then raise exception 'site_release_stale' using errcode = 'P0001'; end if;
  perform pg_catalog.set_config('smbos.site_release_write', 'on', true);
  update public.site_states set
    active_release_id = null,
    active_release_revision = active_release_revision + 1,
    updated_at = timezone('utc', now())
  where business_id = expected_business_id and id = requested_site_id
  returning * into selected_state;
  perform pg_catalog.set_config('smbos.site_release_write', 'off', true);
  return selected_state;
end;
$$;

create or replace function public.attach_site_record_media(
  expected_business_id uuid,
  expected_actor_id uuid,
  requested_site_id uuid,
  requested_record_id uuid,
  requested_object_definition_id uuid,
  requested_field_definition_id uuid,
  requested_asset_id uuid,
  expected_record_revision bigint,
  expected_attachment_revision bigint
)
returns public.site_record_media_attachments
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_head public.business_configuration_heads;
  state_value public.site_states;
  record_value public.records;
  object_value public.object_definitions;
  field_value public.field_definitions;
  selected_asset public.media_assets;
  managed_file_value jsonb;
  existing_attachment public.site_record_media_attachments;
  existing_attachment_found boolean;
  result public.site_record_media_attachments;
begin
  if expected_business_id is null or expected_actor_id is null
    or requested_site_id is null or requested_record_id is null
    or requested_object_definition_id is null or requested_field_definition_id is null
    or requested_asset_id is null or expected_record_revision is null
    or expected_record_revision <= 0 or expected_attachment_revision is null
    or expected_attachment_revision < 0
  then raise exception 'site_request_invalid' using errcode = '22023'; end if;
  perform private.site_assert_actor_v1(expected_business_id, expected_actor_id);
  select * into current_head from public.business_configuration_heads
  where business_id = expected_business_id for update;
  if not found then raise exception 'configuration_head_not_found' using errcode = 'P0002'; end if;
  select * into state_value from public.site_states
  where business_id = expected_business_id and id = requested_site_id for update;
  if not found then raise exception 'site_not_found' using errcode = 'P0002'; end if;
  perform private.site_assert_record_source_v2(
    expected_business_id, requested_site_id, requested_record_id
  );
  select * into record_value from public.records
  where business_id = expected_business_id and id = requested_record_id for update;
  if not found then raise exception 'site_record_not_found' using errcode = 'P0002'; end if;
  if record_value.record_revision <> expected_record_revision then
    raise exception 'site_record_stale' using errcode = 'P0001';
  end if;
  select * into object_value from public.object_definitions
  where business_id = expected_business_id and id = requested_object_definition_id
    and is_active for share;
  if not found or object_value.id <> record_value.object_definition_id then
    raise exception 'site_object_invalid' using errcode = '23514';
  end if;
  select * into field_value from public.field_definitions
  where business_id = expected_business_id and id = requested_field_definition_id
    and object_definition_id = requested_object_definition_id
    and field_type = 'file' and is_active for share;
  if not found then raise exception 'site_file_field_invalid' using errcode = '23514'; end if;
  -- Cleanup claims and attachment creation serialize on the asset row. The
  -- claim worker therefore either sees this new reference or wins before it,
  -- and an asset cannot be claimed between this check and the attachment.
  select * into selected_asset
  from public.media_assets as asset
  where asset.business_id = expected_business_id and asset.id = requested_asset_id
  for update;
  if not found or selected_asset.cleanup_claim_token is not null then
    raise exception 'site_asset_unavailable' using errcode = '23514';
  end if;
  select * into existing_attachment from public.site_record_media_attachments
  where business_id = expected_business_id and site_id = requested_site_id
    and record_id = requested_record_id
    and field_definition_id = requested_field_definition_id for update;
  existing_attachment_found := found;
  if found then
    if existing_attachment.attachment_revision <> expected_attachment_revision then
      raise exception 'site_attachment_stale' using errcode = 'P0001';
    end if;
    if existing_attachment.asset_id = requested_asset_id
      and record_value.data_json -> field_value.key =
        jsonb_build_object('asset_id', requested_asset_id::text)
    then
      insert into public.site_public_media_availability (
        business_id, site_id, asset_id, status, changed_by
      ) values (expected_business_id, requested_site_id, requested_asset_id, 'available', expected_actor_id)
      on conflict (business_id, site_id, asset_id) do nothing;
      return existing_attachment;
    end if;
  end if;

  managed_file_value := jsonb_build_object('asset_id', requested_asset_id::text);
  if record_value.data_json -> field_value.key is distinct from managed_file_value then
    perform pg_catalog.set_config('smbos.site_record_file_write', 'on', true);
    update public.records set
      data_json = data_json || jsonb_build_object(field_value.key, managed_file_value)
    where business_id = expected_business_id and id = requested_record_id
    returning * into record_value;
    perform pg_catalog.set_config('smbos.site_record_file_write', 'off', true);
  end if;

  if existing_attachment_found then
    update public.site_record_media_attachments set
      asset_id = requested_asset_id,
      record_revision = record_value.record_revision,
      attachment_revision = existing_attachment.attachment_revision + 1,
      updated_at = timezone('utc', now())
    where business_id = expected_business_id and site_id = requested_site_id
      and record_id = requested_record_id
      and field_definition_id = requested_field_definition_id
    returning * into result;
  else
    if expected_attachment_revision <> 0 then
      raise exception 'site_attachment_stale' using errcode = 'P0001';
    end if;
    insert into public.site_record_media_attachments (
      business_id, site_id, record_id, object_definition_id,
      field_definition_id, asset_id, record_revision, created_by
    ) values (
      expected_business_id, requested_site_id, requested_record_id,
      requested_object_definition_id, requested_field_definition_id,
      requested_asset_id, record_value.record_revision, expected_actor_id
    ) returning * into result;
  end if;
  insert into public.site_public_media_availability (
    business_id, site_id, asset_id, status, changed_by
  ) values (expected_business_id, requested_site_id, requested_asset_id, 'available', expected_actor_id)
  on conflict (business_id, site_id, asset_id) do nothing;
  return result;
end;
$$;

create or replace function public.remove_site_record_media(
  expected_business_id uuid,
  expected_actor_id uuid,
  requested_site_id uuid,
  requested_record_id uuid,
  requested_field_definition_id uuid,
  expected_record_revision bigint,
  expected_attachment_revision bigint
)
returns public.site_record_media_attachments
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_head public.business_configuration_heads;
  state_value public.site_states;
  record_value public.records;
  field_value public.field_definitions;
  existing_attachment public.site_record_media_attachments;
  managed_file_value jsonb;
  result public.site_record_media_attachments;
begin
  if expected_business_id is null or expected_actor_id is null
    or requested_site_id is null or requested_record_id is null
    or requested_field_definition_id is null or expected_record_revision is null
    or expected_record_revision <= 0 or expected_attachment_revision is null
    or expected_attachment_revision < 0
  then raise exception 'site_request_invalid' using errcode = '22023'; end if;
  perform private.site_assert_actor_v1(expected_business_id, expected_actor_id);
  select * into current_head from public.business_configuration_heads
  where business_id = expected_business_id for update;
  if not found then raise exception 'configuration_head_not_found' using errcode = 'P0002'; end if;
  select * into state_value from public.site_states
  where business_id = expected_business_id and id = requested_site_id for update;
  if not found then raise exception 'site_not_found' using errcode = 'P0002'; end if;
  perform private.site_assert_record_source_v2(
    expected_business_id, requested_site_id, requested_record_id
  );
  select * into record_value from public.records
  where business_id = expected_business_id and id = requested_record_id for update;
  if not found then raise exception 'site_record_not_found' using errcode = 'P0002'; end if;
  if record_value.record_revision <> expected_record_revision then
    raise exception 'site_record_stale' using errcode = 'P0001';
  end if;
  select * into existing_attachment from public.site_record_media_attachments
  where business_id = expected_business_id and site_id = requested_site_id
    and record_id = requested_record_id and field_definition_id = requested_field_definition_id
  for update;
  if not found then return null; end if;
  if existing_attachment.attachment_revision <> expected_attachment_revision then
    raise exception 'site_attachment_stale' using errcode = 'P0001';
  end if;
  select * into field_value
  from public.field_definitions as definition
  where definition.business_id = expected_business_id
    and definition.id = requested_field_definition_id
    and definition.object_definition_id = record_value.object_definition_id
    and definition.field_type = 'file';
  if not found then raise exception 'site_file_field_invalid' using errcode = '23514'; end if;
  managed_file_value := jsonb_build_object('asset_id', existing_attachment.asset_id::text);
  if record_value.data_json -> field_value.key = managed_file_value then
    perform pg_catalog.set_config('smbos.site_record_file_write', 'on', true);
    update public.records set
      data_json = data_json - field_value.key
    where business_id = expected_business_id and id = requested_record_id
    returning * into record_value;
    perform pg_catalog.set_config('smbos.site_record_file_write', 'off', true);
  end if;
  delete from public.site_record_media_attachments
  where business_id = expected_business_id and site_id = requested_site_id
    and record_id = requested_record_id and field_definition_id = requested_field_definition_id
  returning * into result;
  return result;
end;
$$;
