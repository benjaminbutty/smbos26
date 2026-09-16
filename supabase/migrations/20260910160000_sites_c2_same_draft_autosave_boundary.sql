-- A queued composer autosave can arrive after the explicit Save action that
-- produced a reviewed candidate. Re-saving the identical draft is idempotent:
-- it must not create a new draft revision or invalidate that candidate.
create or replace function public.save_site_draft_v2(
  expected_business_id uuid,
  expected_actor_id uuid,
  requested_site_id uuid,
  expected_draft_revision bigint,
  requested_draft jsonb
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
    or requested_site_id is null or expected_draft_revision is null
    or expected_draft_revision <= 0
  then raise exception 'site_request_invalid' using errcode = '22023'; end if;
  perform private.site_assert_actor_v1(expected_business_id, expected_actor_id);
  perform private.site_assert_site_draft_c2(expected_business_id, requested_draft);
  select * into current_head from public.business_configuration_heads
  where business_id = expected_business_id for update;
  if not found then raise exception 'configuration_head_not_found' using errcode = 'P0002'; end if;
  select * into selected_state from public.site_states
  where business_id = expected_business_id and id = requested_site_id for update;
  if not found then raise exception 'site_not_found' using errcode = 'P0002'; end if;
  if selected_state.draft_revision <> expected_draft_revision then
    raise exception 'site_draft_stale' using errcode = 'P0001';
  end if;
  if selected_state.draft_base_version_id <> current_head.active_version_id
    or selected_state.draft_base_head_revision <> current_head.head_revision
  then raise exception 'site_configuration_rebase_required' using errcode = 'P0001'; end if;
  if selected_state.draft_json = requested_draft then
    return selected_state;
  end if;
  perform private.site_invalidate_prepared_releases_v1(
    expected_business_id, requested_site_id
  );
  update public.site_states set
    draft_json = requested_draft,
    draft_revision = selected_state.draft_revision + 1,
    draft_base_version_id = current_head.active_version_id,
    draft_base_head_revision = current_head.head_revision,
    updated_at = timezone('utc', now())
  where business_id = expected_business_id and id = requested_site_id
  returning * into selected_state;
  perform private.site_sync_draft_asset_references_v1(
    expected_business_id, requested_site_id, selected_state.draft_revision,
    requested_draft
  );
  return selected_state;
end;
$$;

revoke all on function public.save_site_draft_v2(
  uuid, uuid, uuid, bigint, jsonb
) from public, anon, service_role;
grant execute on function public.save_site_draft_v2(
  uuid, uuid, uuid, bigint, jsonb
) to authenticated;
