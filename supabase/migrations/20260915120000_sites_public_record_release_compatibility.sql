-- The public Record resolver reads the active release projection selected by
-- the Page resolver. C3/C4 releases retain the same immutable record tokens
-- and release references as C2, so this read boundary accepts all supported
-- public projection versions.
create or replace function public.resolve_public_site_record(
  requested_business_slug text,
  requested_page_slug text,
  requested_record_token text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  resolved jsonb;
  business_id_value uuid;
  site_id_value uuid;
  release_id_value uuid;
  release_revision_value bigint;
  record_id_value uuid;
  collection_block_id_value uuid;
  object_id_value uuid;
  release_projection jsonb;
  collection_public_key text;
  record_projection jsonb;
begin
  resolved := public.resolve_public_site_page(requested_business_slug, requested_page_slug);
  if resolved is null then return null; end if;
  select business.id, state.id, release.id, state.active_release_revision,
    token.record_id, token.collection_block_id, release.projection_json
  into business_id_value, site_id_value, release_id_value, release_revision_value,
    record_id_value, collection_block_id_value, release_projection
  from public.businesses as business
  join public.site_states as state on state.business_id = business.id
    and state.migration_state = 'adopted'
  join public.site_releases as release on release.business_id = state.business_id
    and release.site_id = state.id and release.id = state.active_release_id
    and release.status = 'published'
    and release.projection_schema_version in (2, 3, 4)
  join public.site_public_record_tokens as token on token.business_id = business.id
    and token.site_id = state.id and token.token = requested_record_token
  where business.slug = requested_business_slug
    and exists (
      select 1 from public.site_release_record_references as reference
      where reference.business_id = business.id and reference.release_id = release.id
        and reference.record_id = token.record_id
    );
  if business_id_value is null or not private.site_public_record_available_v2(
    business_id_value, site_id_value, release_revision_value, record_id_value
  ) then return null; end if;
  collection_public_key := private.site_public_block_key_v2(
    site_id_value, collection_block_id_value
  );
  -- Search only this Page's already-delivered projection. A token copied from
  -- another collection or Page therefore cannot be turned into a detail URL.
  record_projection := private.site_find_public_record_v2(
    resolved -> 'page' -> 'layout', requested_record_token
  );
  if record_projection is null then
    if private.site_layout_has_collection_public_key_v2(
      resolved -> 'page' -> 'layout', collection_public_key
    ) then
      record_projection := private.site_find_public_record_v2(
        release_projection, requested_record_token
      );
    end if;
  end if;
  if record_projection is null then return null; end if;
  select reference.object_definition_id into object_id_value
  from public.site_release_collection_references as reference
  where reference.business_id = business_id_value
    and reference.release_id = release_id_value
    and reference.public_key = collection_public_key
  order by reference.object_definition_id
  limit 1;
  if object_id_value is null or not private.site_public_object_available_v2(
    business_id_value, site_id_value, release_revision_value, object_id_value
  ) then return null; end if;
  record_projection := record_projection || jsonb_build_object(
    'values', private.site_public_filter_record_values_v2(
      business_id_value, site_id_value, release_id_value,
      release_revision_value, collection_public_key,
      record_projection -> 'values'
    )
  );
  return resolved || jsonb_build_object('record', record_projection);
end;
$$;

revoke all on function public.resolve_public_site_record(text, text, text)
  from public;
grant execute on function public.resolve_public_site_record(text, text, text)
  to anon, authenticated;
