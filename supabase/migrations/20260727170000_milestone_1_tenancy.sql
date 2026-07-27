create schema if not exists private;

create type public.business_role as enum ('owner', 'admin', 'staff');

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  slug text not null unique check (
    slug = lower(slug)
    and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    and char_length(slug) between 1 and 80
  ),
  business_type text not null check (
    char_length(trim(business_type)) between 1 and 80
  ),
  timezone text not null default 'UTC' check (char_length(trim(timezone)) > 0),
  settings_json jsonb not null default '{}'::jsonb check (
    jsonb_typeof(settings_json) = 'object'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.business_memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.business_role not null,
  permissions_json jsonb not null default '{}'::jsonb check (
    jsonb_typeof(permissions_json) = 'object'
  ),
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);

comment on column public.business_memberships.permissions_json is
  'Reserved for a future milestone. Fixed role defaults are authoritative in v0.1.';

create index business_memberships_user_id_idx
  on public.business_memberships(user_id);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  slug text not null check (
    slug = lower(slug)
    and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    and char_length(slug) between 1 and 80
  ),
  address_json jsonb not null default '{}'::jsonb check (
    jsonb_typeof(address_json) = 'object'
  ),
  opening_hours_json jsonb not null default '{}'::jsonb check (
    jsonb_typeof(opening_hours_json) = 'object'
  ),
  timezone text not null default 'UTC' check (char_length(trim(timezone)) > 0),
  settings_json jsonb not null default '{}'::jsonb check (
    jsonb_typeof(settings_json) = 'object'
  ),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, slug)
);

create index locations_business_id_idx on public.locations(business_id);

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger businesses_set_updated_at
before update on public.businesses
for each row execute function private.set_updated_at();

create trigger locations_set_updated_at
before update on public.locations
for each row execute function private.set_updated_at();

create function private.protect_business_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug is distinct from old.slug then
    raise exception 'Business slugs are immutable'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger businesses_protect_identity
before update on public.businesses
for each row execute function private.protect_business_identity();

create function private.protect_membership_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.business_id is distinct from old.business_id
    or new.user_id is distinct from old.user_id then
    raise exception 'Membership identity cannot be changed'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger business_memberships_protect_identity
before update on public.business_memberships
for each row execute function private.protect_membership_identity();

create function private.ensure_business_has_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Serialize membership changes for one tenant before checking its Owners.
  perform 1
  from public.businesses
  where id = old.business_id
  for update;

  if not found then
    return null;
  end if;

  if not exists (
    select 1
    from public.business_memberships
    where business_id = old.business_id
      and role = 'owner'::public.business_role
  ) then
    raise exception 'A business must retain at least one Owner'
      using errcode = '23514';
  end if;

  return null;
end;
$$;

create constraint trigger business_memberships_retain_owner_after_update
after update on public.business_memberships
deferrable initially deferred
for each row execute function private.ensure_business_has_owner();

create constraint trigger business_memberships_retain_owner_after_delete
after delete on public.business_memberships
deferrable initially deferred
for each row execute function private.ensure_business_has_owner();

create function private.protect_location_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.business_id is distinct from old.business_id then
    raise exception 'A location cannot be moved between businesses'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger locations_protect_tenant
before update on public.locations
for each row execute function private.protect_location_tenant();

create function private.current_business_role(target_business_id uuid)
returns public.business_role
language sql
stable
security definer
set search_path = ''
as $$
  select membership.role
  from public.business_memberships as membership
  where membership.business_id = target_business_id
    and membership.user_id = (select auth.uid())
  limit 1;
$$;

create function private.is_business_member(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_business_role(target_business_id) is not null;
$$;

create function private.is_business_owner(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_business_role(target_business_id) = 'owner'::public.business_role;
$$;

create function private.can_manage_tenant(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.current_business_role(target_business_id)
      in ('owner'::public.business_role, 'admin'::public.business_role),
    false
  );
$$;

revoke all on schema private from public;
grant usage on schema private to authenticated;

revoke all on function private.current_business_role(uuid) from public;
revoke all on function private.is_business_member(uuid) from public;
revoke all on function private.is_business_owner(uuid) from public;
revoke all on function private.can_manage_tenant(uuid) from public;

grant execute on function private.current_business_role(uuid) to authenticated;
grant execute on function private.is_business_member(uuid) to authenticated;
grant execute on function private.is_business_owner(uuid) to authenticated;
grant execute on function private.can_manage_tenant(uuid) to authenticated;

alter table public.businesses enable row level security;
alter table public.business_memberships enable row level security;
alter table public.locations enable row level security;

create policy "Members can read their businesses"
on public.businesses
for select
to authenticated
using (private.is_business_member(id));

create policy "Owners and admins can update their businesses"
on public.businesses
for update
to authenticated
using (private.can_manage_tenant(id))
with check (private.can_manage_tenant(id));

create policy "Owners can delete their businesses"
on public.businesses
for delete
to authenticated
using (private.is_business_owner(id));

create policy "Members can read memberships in their businesses"
on public.business_memberships
for select
to authenticated
using (private.is_business_member(business_id));

create policy "Owners and admins can add memberships"
on public.business_memberships
for insert
to authenticated
with check (
  private.is_business_owner(business_id)
  or (
    private.current_business_role(business_id) = 'admin'::public.business_role
    and role <> 'owner'::public.business_role
  )
);

create policy "Owners and admins can update memberships"
on public.business_memberships
for update
to authenticated
using (
  private.is_business_owner(business_id)
  or (
    private.current_business_role(business_id) = 'admin'::public.business_role
    and role <> 'owner'::public.business_role
  )
)
with check (
  private.is_business_owner(business_id)
  or (
    private.current_business_role(business_id) = 'admin'::public.business_role
    and role <> 'owner'::public.business_role
  )
);

create policy "Owners and admins can delete memberships"
on public.business_memberships
for delete
to authenticated
using (
  private.is_business_owner(business_id)
  or (
    private.current_business_role(business_id) = 'admin'::public.business_role
    and role <> 'owner'::public.business_role
  )
);

create policy "Members can read their locations"
on public.locations
for select
to authenticated
using (private.is_business_member(business_id));

create policy "Owners and admins can create locations"
on public.locations
for insert
to authenticated
with check (private.can_manage_tenant(business_id));

create policy "Owners and admins can update locations"
on public.locations
for update
to authenticated
using (private.can_manage_tenant(business_id))
with check (private.can_manage_tenant(business_id));

create policy "Owners and admins can delete locations"
on public.locations
for delete
to authenticated
using (private.can_manage_tenant(business_id));

create function private.slugify(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(
    both '-' from regexp_replace(
      regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', '-', 'g'),
      '-+',
      '-',
      'g'
    )
  );
$$;

create function public.create_business(
  business_name text,
  requested_business_type text default 'other',
  requested_timezone text default 'UTC'
)
returns public.businesses
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  base_slug text;
  candidate_slug text;
  created_business public.businesses;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if char_length(trim(coalesce(business_name, ''))) not between 1 and 120 then
    raise exception 'Business name is required' using errcode = '22023';
  end if;

  base_slug := left(private.slugify(business_name), 56);
  if base_slug = '' then
    base_slug := 'business';
  end if;

  for attempt in 0..10 loop
    candidate_slug := case
      when attempt = 0 then base_slug
      else base_slug || '-' || left(replace(gen_random_uuid()::text, '-', ''), 8)
    end;

    begin
      insert into public.businesses (name, slug, business_type, timezone)
      values (
        trim(business_name),
        candidate_slug,
        trim(requested_business_type),
        trim(requested_timezone)
      )
      returning * into created_business;

      insert into public.business_memberships (business_id, user_id, role)
      values (created_business.id, current_user_id, 'owner');

      return created_business;
    exception
      when unique_violation then
        if attempt = 10 then
          raise;
        end if;
    end;
  end loop;

  raise exception 'Unable to create a unique business slug';
end;
$$;

create function public.create_location(
  target_business_id uuid,
  location_name text,
  requested_timezone text default 'UTC'
)
returns public.locations
language plpgsql
security invoker
set search_path = ''
as $$
declare
  base_slug text;
  candidate_slug text;
  created_location public.locations;
begin
  if char_length(trim(coalesce(location_name, ''))) not between 1 and 120 then
    raise exception 'Location name is required' using errcode = '22023';
  end if;

  base_slug := left(private.slugify(location_name), 56);
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
        target_business_id,
        trim(location_name),
        candidate_slug,
        trim(requested_timezone)
      )
      returning * into created_location;

      return created_location;
    exception
      when unique_violation then
        if attempt = 10 then
          raise;
        end if;
    end;
  end loop;

  raise exception 'Unable to create a unique location slug';
end;
$$;

revoke all on table public.businesses from anon;
revoke all on table public.business_memberships from anon;
revoke all on table public.locations from anon;

grant select, update, delete on table public.businesses to authenticated;
grant select, insert, update, delete on table public.business_memberships to authenticated;
grant select, insert, update, delete on table public.locations to authenticated;
grant usage on type public.business_role to authenticated;
grant all on table public.businesses to service_role;
grant all on table public.business_memberships to service_role;
grant all on table public.locations to service_role;
grant usage on type public.business_role to service_role;

revoke all on function public.create_business(text, text, text) from public;
revoke all on function public.create_location(uuid, text, text) from public;

grant execute on function public.create_business(text, text, text) to authenticated;
grant execute on function public.create_location(uuid, text, text) to authenticated;
