-- Milestone 10 Phase 10A
-- Establish the authoritative operational Location boundary used by both
-- manual Location management and the bounded Builder confirmation path.

create function private.is_valid_iana_timezone(value text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    value is not null
      and value = btrim(value)
      and trim(value) <> ''
      and exists (
        select 1
        from pg_catalog.pg_timezone_names as timezone_name
        where timezone_name.name = trim(value)
      ),
    false
  );
$$;

revoke all on function private.is_valid_iana_timezone(text)
  from public, anon, authenticated, service_role;

-- PostgreSQL 17.6 supports Unicode normalization with the NFKC form. The
-- explicit und-x-icu collation keeps case normalization locale-neutral rather
-- than inheriting the database default collation. Application comparisons use
-- the same NFKC -> trim -> lower(und-x-icu) rule, while PostgreSQL remains the
-- identity authority through this function and the unique index below.
create function private.normalize_location_name(value text)
returns text
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select lower(
    btrim(normalize(value, NFKC)) collate "und-x-icu"
  );
$$;

revoke all on function private.normalize_location_name(text)
  from public, anon, authenticated, service_role;

-- PostgreSQL evaluates the function as part of the Locations unique index
-- during authenticated/service-role writes. Keep direct public/anonymous
-- access closed while granting the writer roles the execution privilege
-- required for index maintenance.
grant execute on function private.normalize_location_name(text)
  to authenticated, service_role;

do $$
begin
  if exists (
    select 1
    from public.businesses as business
    where not private.is_valid_iana_timezone(business.timezone)
  ) then
    raise exception
      'Milestone 10 Phase 10A cannot continue: an existing Business has an invalid IANA timezone.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.locations as location
    where not private.is_valid_iana_timezone(location.timezone)
  ) then
    raise exception
      'Milestone 10 Phase 10A cannot continue: an existing Location has an invalid IANA timezone.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.locations as location
    group by location.business_id, private.normalize_location_name(location.name)
    having count(*) > 1
  ) then
    raise exception
      'Milestone 10 Phase 10A cannot continue: existing Locations conflict under private.normalize_location_name(name) within a Business.'
      using errcode = '23505';
  end if;
end;
$$;

create unique index locations_business_normalized_name_uidx
  on public.locations (business_id, private.normalize_location_name(name));

create function private.validate_timezone_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_valid_iana_timezone(new.timezone) then
    if tg_table_name = 'businesses' then
      raise exception 'business_timezone_invalid'
        using errcode = '22023';
    end if;

    raise exception 'location_timezone_invalid'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger businesses_validate_timezone
before insert or update of timezone on public.businesses
for each row execute function private.validate_timezone_value();

create trigger locations_validate_timezone
before insert or update of timezone on public.locations
for each row execute function private.validate_timezone_value();

create function private.lock_location_parent_business()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.business_id is distinct from old.business_id
  then
    raise exception 'A location cannot be moved between businesses'
      using errcode = '22023';
  end if;

  perform 1
  from public.businesses as business
  where business.id = new.business_id
  for update;

  if not found then
    raise exception 'location_creation_failed'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger locations_lock_parent_business
before insert or update on public.locations
for each row execute function private.lock_location_parent_business();

create function private.location_creation_state_v1(target_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'business_timezone', business.timezone,
    'locations', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', location.id,
            'name', location.name,
            'normalized_name', private.normalize_location_name(location.name),
            'slug', location.slug,
            'address_json', location.address_json,
            'opening_hours_json', location.opening_hours_json,
            'timezone', location.timezone,
            'settings_json', location.settings_json,
            'is_active', location.is_active,
            'created_at', location.created_at,
            'updated_at', location.updated_at
          )
          order by location.id
        )
        from public.locations as location
        where location.business_id = business.id
      ),
      '[]'::jsonb
    )
  )
  from public.businesses as business
  where business.id = target_business_id;
$$;

create function private.location_creation_state_checksum_v1(
  target_business_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when state.document is null then null
    else encode(
      extensions.digest(
        convert_to(state.document::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    )
  end
  from (
    select private.location_creation_state_v1(target_business_id) as document
  ) as state;
$$;

revoke all on function private.location_creation_state_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.location_creation_state_checksum_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.get_location_creation_state(
  expected_business_id uuid,
  expected_actor_id uuid
)
returns table (
  schema_version integer,
  business_id uuid,
  actor_id uuid,
  business_timezone text,
  location_state_digest text,
  locations jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  current_business public.businesses;
  location_summaries jsonb;
begin
  if current_actor_id is null then
    raise exception 'location_authentication_required'
      using errcode = '42501';
  end if;

  if current_actor_id is distinct from expected_actor_id then
    raise exception 'location_actor_context_mismatch'
      using errcode = '42501';
  end if;

  if not private.can_manage_tenant(expected_business_id) then
    raise exception 'location_owner_or_admin_required'
      using errcode = '42501';
  end if;

  select business.*
  into current_business
  from public.businesses as business
  where business.id = expected_business_id;

  if not found then
    raise exception 'location_business_not_found'
      using errcode = 'P0002';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', location.id,
        'name', location.name,
        'normalized_name', private.normalize_location_name(location.name),
        'slug', location.slug,
        'timezone', location.timezone,
        'is_active', location.is_active
      )
      order by location.id
    ),
    '[]'::jsonb
  )
  into location_summaries
  from public.locations as location
  where location.business_id = expected_business_id;

  return query
  select
    1,
    current_business.id,
    current_actor_id,
    current_business.timezone,
    private.location_creation_state_checksum_v1(current_business.id),
    location_summaries;
end;
$$;

revoke all on function public.get_location_creation_state(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.get_location_creation_state(uuid, uuid)
  to authenticated;

revoke all on function public.create_location(uuid, text, text)
  from public, anon, authenticated, service_role;
drop function public.create_location(uuid, text, text);

create function public.create_location(
  expected_business_id uuid,
  expected_actor_id uuid,
  expected_business_timezone text,
  expected_location_state_digest text,
  location_name text,
  requested_timezone text
)
returns public.locations
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  current_business public.businesses;
  existing_location public.locations;
  base_slug text;
  candidate_slug text;
  created_location public.locations;
  normalized_name text := private.normalize_location_name(location_name);
  normalized_requested_timezone text := btrim(requested_timezone);
begin
  if current_actor_id is null then
    raise exception 'location_authentication_required'
      using errcode = '42501';
  end if;

  if current_actor_id is distinct from expected_actor_id then
    raise exception 'location_actor_context_mismatch'
      using errcode = '42501';
  end if;

  if not private.can_manage_tenant(expected_business_id) then
    raise exception 'location_owner_or_admin_required'
      using errcode = '42501';
  end if;

  select business.*
  into current_business
  from public.businesses as business
  where business.id = expected_business_id
  for update;

  if not found then
    raise exception 'location_creation_failed'
      using errcode = 'P0001';
  end if;

  if current_business.timezone is distinct from btrim(expected_business_timezone)
    or expected_location_state_digest is null
    or expected_location_state_digest !~ '^[a-f0-9]{64}$'
    or private.location_creation_state_checksum_v1(expected_business_id)
      is distinct from expected_location_state_digest
  then
    -- A concurrent identical confirmation has already reserved this name.
    -- Report the bounded duplicate result instead of hiding it as a generic
    -- stale-state response; unrelated intervening changes remain stale.
    select location.*
    into existing_location
    from public.locations as location
    where location.business_id = expected_business_id
      and private.normalize_location_name(location.name) = normalized_name
    order by location.is_active desc, location.id
    limit 1;

    if found then
      if existing_location.is_active then
        raise exception 'location_active_duplicate'
          using errcode = 'P0001';
      end if;

      raise exception 'location_inactive_duplicate'
        using errcode = 'P0001';
    end if;

    raise exception 'location_creation_state_changed'
      using errcode = 'P0001';
  end if;

  if char_length(coalesce(normalized_name, '')) not between 1 and 120 then
    raise exception 'location_name_invalid'
      using errcode = '22023';
  end if;

  select location.*
  into existing_location
  from public.locations as location
  where location.business_id = expected_business_id
    and private.normalize_location_name(location.name) = normalized_name
  order by location.is_active desc, location.id
  limit 1;

  if found then
    if existing_location.is_active then
      raise exception 'location_active_duplicate'
        using errcode = 'P0001';
    end if;

    raise exception 'location_inactive_duplicate'
      using errcode = 'P0001';
  end if;

  if not private.is_valid_iana_timezone(normalized_requested_timezone) then
    raise exception 'location_timezone_invalid'
      using errcode = '22023';
  end if;

  base_slug := left(private.slugify(btrim(location_name)), 56);
  if base_slug = '' then
    base_slug := 'location';
  end if;

  for attempt in 0..10 loop
    candidate_slug := case
      when attempt = 0 then base_slug
      else base_slug || '-' || left(replace(gen_random_uuid()::text, '-', ''), 8)
    end;

    begin
      insert into public.locations (business_id, name, slug, timezone)
      values (
        expected_business_id,
        btrim(location_name),
        candidate_slug,
        normalized_requested_timezone
      )
      returning * into created_location;

      return created_location;
    exception
      when unique_violation then
        select location.*
        into existing_location
        from public.locations as location
        where location.business_id = expected_business_id
          and private.normalize_location_name(location.name) = normalized_name
        order by location.is_active desc, location.id
        limit 1;

        if found then
          if existing_location.is_active then
            raise exception 'location_active_duplicate'
              using errcode = 'P0001';
          end if;

          raise exception 'location_inactive_duplicate'
            using errcode = 'P0001';
        end if;

        if attempt = 10 then
          raise exception 'location_creation_failed'
            using errcode = 'P0001';
        end if;
    end;
  end loop;

  raise exception 'location_creation_failed'
    using errcode = 'P0001';
end;
$$;

revoke all on function public.create_location(
  uuid, uuid, text, text, text, text
) from public, anon, service_role;
grant execute on function public.create_location(
  uuid, uuid, text, text, text, text
) to authenticated;

revoke insert on table public.locations from authenticated, service_role;
drop policy if exists "Owners and admins can create locations"
  on public.locations;

comment on function public.get_location_creation_state(uuid, uuid) is
  'Authenticated Owner/Admin read of the bounded Location creation currentness state.';

comment on function public.create_location(
  uuid, uuid, text, text, text, text
) is
  'Authenticated Owner/Admin Location creation boundary. It serializes on the parent Business, checks expected operational currentness, enforces normalized-name uniqueness, validates timezone and derives the slug.';
