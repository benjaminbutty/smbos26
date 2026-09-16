-- The trusted release publisher already checks the legacy source CAS before
-- applying its derived Page configuration. The final Site-state transition
-- runs after that projector has transaction-locally parked the legacy rows,
-- so repeating the source check in the authority trigger would reject every
-- valid adoption. Keep the check for direct callers and skip only the
-- release-owned transition identified by the existing transaction marker.
create or replace function private.site_guard_authority_transition_v2()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  release_schema_version smallint;
  legacy_count integer;
  release_write boolean :=
    coalesce(pg_catalog.current_setting('smbos.site_release_write', true), '') = 'on';
begin
  if tg_op = 'INSERT' and new.migration_state = 'new' then
    select count(*) into legacy_count
    from public.pages as page_value
    where page_value.business_id = new.business_id
      and page_value.audience = 'public'
      and page_value.status = 'published'
      and page_value.is_active;
    if legacy_count > 0 then
      new.migration_state := 'legacy_pending';
      new.legacy_source_checksum := private.site_legacy_source_fingerprint_v2(
        new.business_id
      );
      new.legacy_source_page_count := legacy_count;
    end if;
  end if;
  if tg_op = 'UPDATE'
    and old.migration_state = 'adopted'
    and new.active_release_id is distinct from old.active_release_id
    and not release_write
  then
    raise exception 'site_authority_owned' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE'
    and new.active_release_id is distinct from old.active_release_id
    and new.active_release_id is not null
  then
    select projection_schema_version into release_schema_version
    from public.site_releases
    where business_id = new.business_id and id = new.active_release_id;
    if release_schema_version = 2 then
      if old.migration_state = 'new' and exists (
        select 1 from public.pages as page_value
        where page_value.business_id = new.business_id
          and page_value.audience = 'public'
          and page_value.status = 'published'
          and page_value.is_active
      ) then
        raise exception 'site_adoption_required' using errcode = 'P0001';
      end if;
      if old.migration_state = 'legacy_pending' and not release_write then
        perform private.site_assert_adoption_source_v2(
          new.business_id, new.id, new.legacy_source_checksum
        );
      end if;
      new.migration_state := 'adopted';
    end if;
  end if;
  return new;
end;
$$;
