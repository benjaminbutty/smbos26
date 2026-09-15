-- The public media resolver is a read boundary over the active published
-- release. Projection versions 3 and 4 retain the same immutable asset
-- references as version 2, so the resolver must accept them as well.
create or replace function public.resolve_public_site_media(
  requested_business_slug text,
  requested_media_token text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'storage_key', asset.storage_key,
    'mime_type', asset.mime_type,
    'byte_size', asset.byte_size
  )
  from public.businesses as business
  join public.site_states as state on state.business_id = business.id
    and state.migration_state = 'adopted'
    and state.active_release_id is not null
  join public.site_releases as release on release.business_id = state.business_id
    and release.site_id = state.id
    and release.id = state.active_release_id
    and release.status = 'published'
    and release.projection_schema_version in (2, 3, 4)
  join public.site_public_media_tokens as token on token.business_id = state.business_id
    and token.site_id = state.id
    and token.token = requested_media_token
  join public.media_assets as asset on asset.business_id = token.business_id
    and asset.id = token.asset_id
    and asset.cleanup_claim_token is null
  where business.slug = requested_business_slug
    and requested_media_token ~ '^m_[0-9a-f]{64}$'
    and exists (
      select 1 from public.site_release_asset_references as reference
      where reference.business_id = state.business_id
        and reference.release_id = release.id
        and reference.asset_id = asset.id
    )
    and not exists (
      select 1 from public.site_public_media_availability as availability
      where availability.business_id = state.business_id
        and availability.site_id = state.id
        and availability.asset_id = asset.id
        and (
          availability.status <> 'available'
          or availability.available_from_release_revision > state.active_release_revision
        )
    )
    and private.site_public_media_available_v2(
      state.business_id,
      state.id,
      state.active_release_revision,
      requested_media_token
    )
  limit 1;
$$;

revoke all on function public.resolve_public_site_media(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_public_site_media(text, text)
  to service_role;
