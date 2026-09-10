-- Lenni Sites C2: permanent release authority, legacy adoption and public-safe
-- delivery. C1 rows remain private and immutable; C2 adds only typed metadata
-- around that foundation and uses a separate public projection version.

alter table public.site_states
  drop constraint if exists site_states_migration_state_check;
alter table public.site_states
  add constraint site_states_migration_state_check
  check (migration_state in ('new', 'legacy_pending', 'adopted'));

alter table public.site_states
  add column if not exists legacy_source_checksum text,
  add column if not exists legacy_source_page_count integer;

alter table public.site_page_bindings
  add column if not exists legacy_source_page_id uuid,
  add column if not exists legacy_source_checksum text;

alter table public.site_releases
  drop constraint if exists site_releases_projection_schema_version_check;
alter table public.site_releases
  add constraint site_releases_projection_schema_version_check
  check (projection_schema_version in (1, 2));

create unique index if not exists site_page_bindings_legacy_source_idx
  on public.site_page_bindings (business_id, site_id, legacy_source_page_id)
  where legacy_source_page_id is not null;

alter table public.records
  add column if not exists record_revision bigint not null default 1;

create table if not exists public.site_public_record_availability (
  business_id uuid not null,
  site_id uuid not null,
  record_id uuid not null,
  status text not null default 'available'
    check (status in ('available', 'withdrawn')),
  availability_revision bigint not null default 1
    check (availability_revision > 0),
  changed_by uuid not null,
  changed_at timestamptz not null default timezone('utc', now()),
  primary key (business_id, site_id, record_id),
  foreign key (business_id, site_id)
    references public.site_states(business_id, id) on delete cascade,
  foreign key (business_id, record_id)
    references public.records(business_id, id) on delete cascade
);

create table if not exists public.site_public_media_availability (
  business_id uuid not null,
  site_id uuid not null,
  asset_id uuid not null,
  status text not null default 'available'
    check (status in ('available', 'withdrawn')),
  availability_revision bigint not null default 1
    check (availability_revision > 0),
  changed_by uuid not null,
  changed_at timestamptz not null default timezone('utc', now()),
  primary key (business_id, site_id, asset_id),
  foreign key (business_id, site_id)
    references public.site_states(business_id, id) on delete cascade,
  foreign key (business_id, asset_id)
    references public.media_assets(business_id, id) on delete cascade
);

create table if not exists public.site_record_media_attachments (
  business_id uuid not null,
  site_id uuid not null,
  record_id uuid not null,
  object_definition_id uuid not null,
  field_definition_id uuid not null,
  asset_id uuid not null,
  record_revision bigint not null check (record_revision > 0),
  attachment_revision bigint not null default 1
    check (attachment_revision > 0),
  created_by uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (business_id, site_id, record_id, field_definition_id),
  unique (business_id, site_id, record_id, asset_id),
  foreign key (business_id, site_id)
    references public.site_states(business_id, id) on delete cascade,
  foreign key (business_id, record_id)
    references public.records(business_id, id) on delete cascade,
  foreign key (business_id, object_definition_id)
    references public.object_definitions(business_id, id) on delete cascade,
  foreign key (business_id, field_definition_id)
    references public.field_definitions(business_id, id) on delete cascade,
  foreign key (business_id, asset_id)
    references public.media_assets(business_id, id) on delete no action
);

create index if not exists site_record_media_attachments_asset_idx
  on public.site_record_media_attachments (business_id, asset_id);
create index if not exists site_public_record_availability_lookup_idx
  on public.site_public_record_availability (business_id, site_id, status);
create index if not exists site_public_media_availability_lookup_idx
  on public.site_public_media_availability (business_id, site_id, status);

alter table public.site_public_record_availability
  add column if not exists available_from_release_revision bigint not null default 0
    check (available_from_release_revision >= 0);
alter table public.site_public_media_availability
  add column if not exists available_from_release_revision bigint not null default 0
    check (available_from_release_revision >= 0);

create table if not exists public.site_public_record_tokens (
  business_id uuid not null,
  site_id uuid not null,
  token text not null,
  collection_block_id uuid not null,
  record_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (business_id, site_id, token),
  unique (business_id, site_id, collection_block_id, record_id),
  foreign key (business_id, site_id)
    references public.site_states(business_id, id) on delete cascade,
  foreign key (business_id, record_id)
    references public.records(business_id, id) on delete cascade
);

create table if not exists public.site_public_media_tokens (
  business_id uuid not null,
  site_id uuid not null,
  token text not null,
  asset_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (business_id, site_id, token),
  unique (business_id, site_id, asset_id),
  foreign key (business_id, site_id)
    references public.site_states(business_id, id) on delete cascade,
  foreign key (business_id, asset_id)
    references public.media_assets(business_id, id) on delete cascade
);

create table if not exists public.site_release_record_references (
  business_id uuid not null,
  release_id uuid not null,
  record_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (business_id, release_id, record_id),
  foreign key (business_id, release_id)
    references public.site_releases(business_id, id) on delete cascade,
  foreign key (business_id, record_id)
    references public.records(business_id, id) on delete no action
);

create index if not exists site_release_record_references_record_idx
  on public.site_release_record_references (business_id, record_id);

alter table public.site_public_record_availability enable row level security;
alter table public.site_public_media_availability enable row level security;
alter table public.site_record_media_attachments enable row level security;
alter table public.site_public_record_tokens enable row level security;
alter table public.site_public_media_tokens enable row level security;
alter table public.site_release_record_references enable row level security;

create policy "Owners can read Site record availability"
  on public.site_public_record_availability for select to authenticated
  using (private.can_manage_tenant(business_id));
create policy "Owners can read Site media availability"
  on public.site_public_media_availability for select to authenticated
  using (private.can_manage_tenant(business_id));
create policy "Owners can read Site Record media attachments"
  on public.site_record_media_attachments for select to authenticated
  using (private.can_manage_tenant(business_id));
create policy "Owners can read Site public tokens"
  on public.site_public_record_tokens for select to authenticated
  using (private.can_manage_tenant(business_id));
create policy "Owners can read Site media tokens"
  on public.site_public_media_tokens for select to authenticated
  using (private.can_manage_tenant(business_id));
create policy "Owners can read Site release Record references"
  on public.site_release_record_references for select to authenticated
  using (private.can_manage_tenant(business_id));

revoke all on table public.site_public_record_availability,
  public.site_public_media_availability,
  public.site_record_media_attachments,
  public.site_public_record_tokens,
  public.site_public_media_tokens,
  public.site_release_record_references from public, anon, authenticated;
grant select on table public.site_public_record_availability,
  public.site_public_media_availability,
  public.site_record_media_attachments,
  public.site_public_record_tokens,
  public.site_public_media_tokens,
  public.site_release_record_references to authenticated;
grant select, insert, update, delete on table public.site_public_record_availability,
  public.site_public_media_availability,
  public.site_record_media_attachments,
  public.site_public_record_tokens,
  public.site_public_media_tokens,
  public.site_release_record_references to service_role;

create or replace function private.site_public_record_token_v2(
  target_site_id uuid,
  target_collection_block_id uuid,
  target_record_id uuid
)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'r_' || encode(extensions.digest(
    convert_to(target_site_id::text || ':' || target_collection_block_id::text || ':' || target_record_id::text, 'UTF8'),
    'sha256'
  ), 'hex');
$$;

create or replace function private.site_legacy_public_allowed_v2(
  requested_business_slug text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.businesses as business
    join public.site_states as state on state.business_id = business.id
    where business.slug = requested_business_slug
      and state.migration_state = 'adopted'
  );
$$;

-- Legacy resolution and submission share the configuration-head then Site
-- state lock order with adoption and publication. The lock is held for the
-- whole RPC transaction, so adoption cannot pass its authority check between
-- a legacy check and the legacy write.
create or replace function private.site_lock_legacy_authority_v2(
  requested_business_slug text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  requested_business_id uuid;
  selected_state public.site_states;
begin
  select business.id into requested_business_id
  from public.businesses as business
  where business.slug = requested_business_slug;
  if not found then return true; end if;

  perform 1 from public.business_configuration_heads as head
  where head.business_id = requested_business_id
  for update;

  select * into selected_state
  from public.site_states as state
  where state.business_id = requested_business_id
  for update;

  return selected_state.id is null
    or selected_state.migration_state <> 'adopted';
end;
$$;

create or replace function private.site_public_record_available_v2(
  target_business_id uuid,
  target_site_id uuid,
  target_release_revision bigint,
  target_record_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.records as record_value
    where record_value.business_id = target_business_id
      and record_value.id = target_record_id
      and record_value.record_status = 'active'
  )
  and not exists (
    select 1 from public.site_public_record_availability as availability
    where availability.business_id = target_business_id
      and availability.site_id = target_site_id
      and availability.record_id = target_record_id
      and (
        availability.status <> 'available'
        or availability.available_from_release_revision > target_release_revision
      )
  );
$$;

create or replace function private.site_public_delivery_page_v2(
  target_business_id uuid,
  target_site_id uuid,
  target_release_id uuid,
  target_release_revision bigint,
  page_value jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  block jsonb;
  projected jsonb;
  blocks_value jsonb := '[]'::jsonb;
begin
  for block in select value from jsonb_array_elements(page_value -> 'layout' -> 'blocks') loop
    projected := private.site_public_delivery_block_v2(
      target_business_id, target_site_id, target_release_id,
      target_release_revision, block
    );
    if projected is not null then blocks_value := blocks_value || jsonb_build_array(projected); end if;
  end loop;
  return page_value || jsonb_build_object('layout', jsonb_build_object('blocks', blocks_value));
end;
$$;

create or replace function public.resolve_public_site_page(
  requested_business_slug text,
  requested_page_slug text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  business_value public.businesses;
  state_value public.site_states;
  release_value public.site_releases;
  page_value jsonb;
  delivered_page jsonb;
  navigation_value jsonb := '[]'::jsonb;
  nav_page jsonb;
  branding_value jsonb;
begin
  select business.* into business_value
  from public.businesses as business
  where business.slug = requested_business_slug;
  if not found then return null; end if;
  select * into state_value from public.site_states
  where business_id = business_value.id and migration_state = 'adopted';
  if not found or state_value.active_release_id is null then return null; end if;
  select * into release_value from public.site_releases
  where business_id = business_value.id and site_id = state_value.id
    and id = state_value.active_release_id and status = 'published'
    and projection_schema_version = 2;
  if not found then return null; end if;
  select value into page_value
  from jsonb_array_elements(release_value.projection_json -> 'pages') as page_item(value)
  where page_item.value ->> 'slug' = requested_page_slug
    and coalesce((page_item.value ->> 'is_included')::boolean, true)
  limit 1;
  if page_value is null then return null; end if;
  delivered_page := private.site_public_delivery_page_v2(
    business_value.id, state_value.id, release_value.id,
    state_value.active_release_revision, page_value
  );
  branding_value := release_value.projection_json -> 'branding';
  if branding_value ? 'logo_media_token'
    and not private.site_public_media_available_v2(
      business_value.id,
      state_value.id,
      state_value.active_release_revision,
      branding_value ->> 'logo_media_token'
    )
  then
    branding_value := branding_value - 'logo_media_token';
  end if;
  for nav_page in select value from jsonb_array_elements(release_value.projection_json -> 'pages') loop
    if coalesce((nav_page ->> 'is_in_navigation')::boolean, false) then
      navigation_value := navigation_value || jsonb_build_array(jsonb_build_object(
        'key', nav_page ->> 'public_key',
        'title', nav_page ->> 'title',
        'slug', nav_page ->> 'slug',
        'label', nav_page ->> 'navigation_label'
      ));
    end if;
  end loop;
  return jsonb_build_object(
    'business', jsonb_build_object('name', business_value.name, 'slug', business_value.slug),
    'site', jsonb_build_object(
      'schema_version', 2,
      'branding', branding_value,
      'navigation', navigation_value
    ),
    'page', jsonb_build_object(
      'key', delivered_page ->> 'public_key',
      'title', delivered_page -> 'title',
      'slug', delivered_page -> 'slug',
      'navigation_label', delivered_page -> 'navigation_label',
      'is_home', delivered_page -> 'is_home',
      'is_in_navigation', delivered_page -> 'is_in_navigation',
      'layout', delivered_page -> 'layout'
    )
  );
end;
$$;

create or replace function private.site_find_public_record_v2(
  value jsonb,
  requested_token text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  child jsonb;
  found_value jsonb;
begin
  if jsonb_typeof(value) = 'object'
    and value ? 'values'
    and value ->> 'public_id' = requested_token
  then
    return value;
  end if;
  if jsonb_typeof(value) = 'object' then
    for child in select item from jsonb_each(value) as item(key, value) loop
      found_value := private.site_find_public_record_v2(child, requested_token);
      if found_value is not null then return found_value; end if;
    end loop;
  elsif jsonb_typeof(value) = 'array' then
    for child in select item from jsonb_array_elements(value) as item loop
      found_value := private.site_find_public_record_v2(child, requested_token);
      if found_value is not null then return found_value; end if;
    end loop;
  end if;
  return null;
end;
$$;


alter function public.resolve_public_page(text, text)
  rename to resolve_public_page_legacy_v1;
create function public.resolve_public_page(
  requested_business_slug text,
  requested_page_slug text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not private.site_lock_legacy_authority_v2(requested_business_slug)
    then public.resolve_public_site_page(requested_business_slug, requested_page_slug)
    else public.resolve_public_page_legacy_v1(requested_business_slug, requested_page_slug)
  end;
$$;


-- C2's public projection is deliberately a different shape from the private
-- C1 projection. It replaces every draft Page, block, Record and asset
-- identity with an opaque token and removes action/source metadata before the
-- row is persisted in a release.


create or replace function private.site_lock_selected_records_c2(
  target_business_id uuid,
  draft jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  site_block record;
  selected_record record;
  selected_count integer := 0;
begin
  for site_block in select * from private.site_draft_blocks_v1(draft)
    where block ->> 'type' = 'collection'
  loop
    perform private.site_assert_collection_references_v1(
      target_business_id, site_block.block
    );
    perform private.site_assert_collection_filter_v2(target_business_id, site_block.block);
    for selected_record in select * from private.site_collection_record_ids_v2(
      target_business_id, site_block.block
    ) loop
      selected_count := selected_count + 1;
      perform 1 from public.records as record_value
      where record_value.business_id = target_business_id
        and record_value.id = selected_record.record_id
        and record_value.record_status = 'active'
      for share;
      if not found then raise exception 'site_collection_invalid' using errcode = '23514'; end if;
    end loop;
  end loop;
  if selected_count > 500 then
    raise exception 'site_collection_too_large' using errcode = '22023';
  end if;
end;
$$;


create table if not exists public.site_release_collection_references (
  business_id uuid not null,
  release_id uuid not null,
  collection_block_id uuid not null,
  object_definition_id uuid not null,
  field_definition_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (business_id, release_id, collection_block_id, field_definition_id),
  foreign key (business_id, release_id)
    references public.site_releases(business_id, id) on delete cascade
);

create index if not exists site_release_collection_refs_object_idx
  on public.site_release_collection_references
    (business_id, object_definition_id, field_definition_id);

alter table public.site_release_collection_references enable row level security;
create policy "Owners can read Site release collection references"
  on public.site_release_collection_references for select to authenticated
  using (private.can_manage_tenant(business_id));
revoke all on table public.site_release_collection_references
  from public, anon, authenticated;
grant select on table public.site_release_collection_references to authenticated;
grant select, insert, update, delete on table public.site_release_collection_references
  to service_role;

create or replace function private.site_strip_filter_block_v2(block jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  child jsonb;
  column_value jsonb;
  child_blocks jsonb;
  columns_value jsonb := '[]'::jsonb;
begin
  if block ->> 'type' = 'collection' then
    return block - 'filter';
  end if;
  if block ->> 'type' = 'collapsible' then
    child_blocks := '[]'::jsonb;
    for child in select value from jsonb_array_elements(block -> 'blocks') loop
      child_blocks := child_blocks || jsonb_build_array(
        private.site_strip_filter_block_v2(child)
      );
    end loop;
    return (block - 'blocks') || jsonb_build_object('blocks', child_blocks);
  end if;
  if block ->> 'type' = 'section' then
    for column_value in select value from jsonb_array_elements(block -> 'columns') loop
      child_blocks := '[]'::jsonb;
      for child in select value from jsonb_array_elements(column_value -> 'blocks') loop
        child_blocks := child_blocks || jsonb_build_array(
          private.site_strip_filter_block_v2(child)
        );
      end loop;
      columns_value := columns_value || jsonb_build_array(
        column_value || jsonb_build_object('blocks', child_blocks)
      );
    end loop;
    return (block - 'columns') || jsonb_build_object('columns', columns_value);
  end if;
  return block;
end;
$$;

create or replace function private.site_strip_filter_draft_v2(draft jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  page_value jsonb;
  pages_value jsonb := '[]'::jsonb;
  blocks_value jsonb;
  block jsonb;
begin
  for page_value in select value from jsonb_array_elements(draft -> 'pages') loop
    blocks_value := '[]'::jsonb;
    for block in select value from jsonb_array_elements(page_value -> 'layout' -> 'blocks') loop
      blocks_value := blocks_value || jsonb_build_array(
        private.site_strip_filter_block_v2(block)
      );
    end loop;
    pages_value := pages_value || jsonb_build_array(
      (page_value - 'layout') || jsonb_build_object(
        'layout', jsonb_build_object('blocks', blocks_value)
      )
    );
  end loop;
  return (draft - 'pages') || jsonb_build_object('pages', pages_value);
end;
$$;

create or replace function private.site_assert_collection_filter_v2(
  target_business_id uuid,
  block jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  filter_value jsonb;
  item jsonb;
  field_key text;
  object_id uuid;
  operator text;
  direction text;
  selected_field_type text;
  seen_fields text[] := array[]::text[];
begin
  if not (block ? 'filter') then return; end if;
  filter_value := block -> 'filter';
  if jsonb_typeof(filter_value) is distinct from 'object'
    or not private.site_json_has_only_keys_v1(
      filter_value, array['schema_version', 'filters', 'filter_match', 'sorts']
    )
    or not (filter_value ?& array['schema_version', 'filters', 'filter_match', 'sorts'])
    or filter_value ->> 'schema_version' is distinct from '1'
    or jsonb_typeof(filter_value -> 'filters') is distinct from 'array'
    or jsonb_array_length(filter_value -> 'filters') > 10
    or filter_value ->> 'filter_match' not in ('all', 'any')
    or jsonb_typeof(filter_value -> 'sorts') is distinct from 'array'
    or jsonb_array_length(filter_value -> 'sorts') > 3
  then
    raise exception 'site_collection_filter_invalid' using errcode = '22023';
  end if;
  select definition.id into object_id
  from public.object_definitions as definition
  where definition.business_id = target_business_id
    and definition.key = block ->> 'object_key'
    and definition.is_active;
  if object_id is null then
    raise exception 'site_collection_invalid' using errcode = '23514';
  end if;
  for item in select value from jsonb_array_elements(filter_value -> 'filters') loop
    if jsonb_typeof(item) is distinct from 'object'
      or not private.site_json_has_only_keys_v1(item, array['field_key', 'operator', 'value', 'values'])
      or not private.site_valid_key_v1(item -> 'field_key')
      or item ->> 'operator' not in (
        'is', 'is_not', 'contains', 'does_not_contain', 'greater_than',
        'greater_than_or_equal', 'less_than', 'less_than_or_equal',
        'is_any_of', 'is_empty', 'is_not_empty'
      )
    then
      raise exception 'site_collection_filter_invalid' using errcode = '22023';
    end if;
    field_key := item ->> 'field_key';
    if field_key = any(seen_fields) then
      raise exception 'site_collection_filter_invalid' using errcode = '22023';
    end if;
    seen_fields := array_append(seen_fields, field_key);
    select field_value.field_type into selected_field_type
    from public.field_definitions as field_value
    where field_value.business_id = target_business_id
      and field_value.object_definition_id = object_id
      and field_value.key = field_key
      and field_value.is_active;
    if selected_field_type is null then
      raise exception 'site_collection_filter_invalid' using errcode = '23514';
    end if;
    operator := item ->> 'operator';
    if operator in (
      'greater_than', 'greater_than_or_equal', 'less_than',
      'less_than_or_equal'
    ) and selected_field_type in ('number', 'currency')
      and jsonb_typeof(item -> 'value') is distinct from 'number'
    then
      raise exception 'site_collection_filter_invalid' using errcode = '22023';
    end if;
    if operator in ('is_empty', 'is_not_empty') then
      if item ? 'value' or item ? 'values' then
        raise exception 'site_collection_filter_invalid' using errcode = '22023';
      end if;
    elsif operator = 'is_any_of' then
      if jsonb_typeof(item -> 'values') is distinct from 'array'
        or jsonb_array_length(item -> 'values') not between 1 and 20
        or item ? 'value'
      then
        raise exception 'site_collection_filter_invalid' using errcode = '22023';
      end if;
    elsif not (item ? 'value')
      or jsonb_typeof(item -> 'value') not in ('string', 'number', 'boolean', 'null')
      or item ? 'values'
    then
      raise exception 'site_collection_filter_invalid' using errcode = '22023';
    end if;
  end loop;
  for item in select value from jsonb_array_elements(filter_value -> 'sorts') loop
    if jsonb_typeof(item) is distinct from 'object'
      or not private.site_json_has_only_keys_v1(item, array['field_key', 'direction'])
      or not private.site_valid_key_v1(item -> 'field_key')
      or item ->> 'direction' not in ('ascending', 'descending')
    then
      raise exception 'site_collection_filter_invalid' using errcode = '22023';
    end if;
    field_key := item ->> 'field_key';
    direction := item ->> 'direction';
    if not exists (
      select 1 from public.field_definitions as field_value
      where field_value.business_id = target_business_id
        and field_value.object_definition_id = object_id
        and field_value.key = field_key
        and field_value.is_active
        and field_value.field_type in (
          'short_text', 'long_text', 'number', 'currency', 'boolean',
          'date', 'datetime', 'select', 'status'
        )
    ) then
      raise exception 'site_collection_filter_invalid' using errcode = '23514';
    end if;
  end loop;
end;
$$;

create or replace function private.site_assert_site_draft_c2(
  target_business_id uuid,
  draft jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  site_block record;
begin
  -- The C1 grammar remains the canonical structural validator. C2's one
  -- additive query object is validated here and removed only for that check.
  perform private.assert_site_draft_v1(private.site_strip_filter_draft_v2(draft));
  for site_block in select * from private.site_draft_blocks_v1(draft) loop
    if site_block.block ->> 'type' = 'collection' then
      perform private.site_assert_collection_filter_v2(
        target_business_id,
        site_block.block
      );
    end if;
  end loop;
exception when invalid_text_representation then
  raise exception 'site_draft_invalid' using errcode = '22023';
end;
$$;

-- C2 persistence keeps unsupported C3 atoms durable so an owner can recover
-- or replace them. Publication has a stricter boundary: every public action
-- and rich-text atom must fail closed until its supported C2 representation
-- exists. Legacy adoption maps these atoms to incomplete warning callouts, so
-- this check leaves the source Page untouched while blocking activation.
create or replace function private.site_assert_publication_draft_c2(
  target_business_id uuid,
  draft jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  site_block record;
begin
  perform private.site_assert_site_draft_c2(target_business_id, draft);
  for site_block in
    select block_value.*
    from private.site_draft_blocks_v1(draft) as block_value
    join jsonb_array_elements(draft -> 'pages') as page_value(value)
      on (page_value.value ->> 'id')::uuid = block_value.page_id
    where coalesce((page_value.value ->> 'is_included')::boolean, false)
  loop
    if site_block.block ->> 'type' in (
      'form', 'public_form', 'booking', 'preorder', 'view', 'rich_text'
    ) then
      raise exception 'site_unsupported_content' using
        errcode = '23514',
        detail = format(
          'The %s block needs a supported C2 representation before publication.',
          site_block.block ->> 'type'
        );
    end if;
  end loop;
end;
$$;

create or replace function private.site_collection_record_ids_v2(
  target_business_id uuid,
  block jsonb
)
returns table (record_id uuid, sort_position integer)
language plpgsql
stable
set search_path = ''
as $$
declare
  object_id uuid;
  record_value public.records;
  selected_id uuid;
  selected_ids uuid[] := array[]::uuid[];
  filter_value jsonb := block -> 'filter';
  item jsonb;
  raw_value jsonb;
  filter_match boolean;
  one_match boolean;
  matched_count integer;
  filter_count integer;
  next_position integer := 0;
  sort_key text;
  sort_direction text;
  sort_field_type text;
begin
  select definition.id into object_id
  from public.object_definitions as definition
  where definition.business_id = target_business_id
    and definition.key = block ->> 'object_key'
    and definition.is_active;
  if object_id is null then return; end if;

  for selected_id in
    select (value #>> '{}')::uuid
    from jsonb_array_elements(block -> 'selection' -> 'record_ids') as value
  loop
    selected_ids := array_append(selected_ids, selected_id);
  end loop;

  if filter_value is null or jsonb_typeof(filter_value) = 'null' then
    for selected_id in
      select value #>> '{}'
      from jsonb_array_elements(block -> 'selection' -> 'record_ids') as value
    loop
      select * into record_value
      from public.records
      where business_id = target_business_id
        and id = selected_id::uuid
        and object_definition_id = object_id
        and record_status = 'active';
      if found then
        next_position := next_position + 1;
        record_id := record_value.id;
        sort_position := next_position;
        return next;
      end if;
    end loop;
    return;
  end if;

  sort_key := filter_value -> 'sorts' -> 0 ->> 'field_key';
  sort_direction := filter_value -> 'sorts' -> 0 ->> 'direction';
  select definition.field_type into sort_field_type
  from public.field_definitions as definition
  where definition.business_id = target_business_id
    and definition.object_definition_id = object_id
    and definition.key = sort_key
    and definition.is_active;
  for record_value in
    select record_candidate.*
    from public.records as record_candidate
    where record_candidate.business_id = target_business_id
      and record_candidate.object_definition_id = object_id
      and record_candidate.record_status = 'active'
      and (
        cardinality(selected_ids) = 0 or record_candidate.id = any(selected_ids)
      )
    order by
      case
        when sort_direction = 'ascending'
          and sort_field_type in ('number', 'currency')
          and jsonb_typeof(record_candidate.data_json -> sort_key) = 'number'
        then ((record_candidate.data_json -> sort_key) #>> '{}')::numeric
      end asc nulls last,
      case
        when sort_direction = 'descending'
          and sort_field_type in ('number', 'currency')
          and jsonb_typeof(record_candidate.data_json -> sort_key) = 'number'
        then ((record_candidate.data_json -> sort_key) #>> '{}')::numeric
      end desc nulls last,
      case
        when sort_direction = 'ascending'
          and sort_field_type not in ('number', 'currency')
        then record_candidate.data_json ->> sort_key
      end asc nulls last,
      case
        when sort_direction = 'descending'
          and sort_field_type not in ('number', 'currency')
        then record_candidate.data_json ->> sort_key
      end desc nulls last,
      record_candidate.created_at, record_candidate.id
  loop
    filter_count := jsonb_array_length(filter_value -> 'filters');
    matched_count := 0;
    for item in select value from jsonb_array_elements(filter_value -> 'filters') loop
      raw_value := record_value.data_json -> (item ->> 'field_key');
      one_match := case item ->> 'operator'
        when 'is' then raw_value = item -> 'value'
        when 'is_not' then raw_value is distinct from item -> 'value'
        when 'contains' then coalesce(record_value.data_json ->> (item ->> 'field_key'), '') ilike '%' || (item ->> 'value') || '%'
        when 'does_not_contain' then not (coalesce(record_value.data_json ->> (item ->> 'field_key'), '') ilike '%' || (item ->> 'value') || '%')
        when 'is_any_of' then (item -> 'values') @> jsonb_build_array(raw_value)
        when 'is_empty' then raw_value is null or raw_value = 'null'::jsonb or raw_value = '""'::jsonb
        when 'is_not_empty' then raw_value is not null and raw_value <> 'null'::jsonb and raw_value <> '""'::jsonb
        when 'greater_than' then case
          when jsonb_typeof(raw_value) = 'number'
            and jsonb_typeof(item -> 'value') = 'number'
            then (raw_value #>> '{}')::numeric > (item -> 'value' #>> '{}')::numeric
          when jsonb_typeof(raw_value) = 'string'
            and jsonb_typeof(item -> 'value') = 'string'
            then (raw_value #>> '{}') > (item ->> 'value')
          else false
        end
        when 'greater_than_or_equal' then case
          when jsonb_typeof(raw_value) = 'number'
            and jsonb_typeof(item -> 'value') = 'number'
            then (raw_value #>> '{}')::numeric >= (item -> 'value' #>> '{}')::numeric
          when jsonb_typeof(raw_value) = 'string'
            and jsonb_typeof(item -> 'value') = 'string'
            then (raw_value #>> '{}') >= (item ->> 'value')
          else false
        end
        when 'less_than' then case
          when jsonb_typeof(raw_value) = 'number'
            and jsonb_typeof(item -> 'value') = 'number'
            then (raw_value #>> '{}')::numeric < (item -> 'value' #>> '{}')::numeric
          when jsonb_typeof(raw_value) = 'string'
            and jsonb_typeof(item -> 'value') = 'string'
            then (raw_value #>> '{}') < (item ->> 'value')
          else false
        end
        when 'less_than_or_equal' then case
          when jsonb_typeof(raw_value) = 'number'
            and jsonb_typeof(item -> 'value') = 'number'
            then (raw_value #>> '{}')::numeric <= (item -> 'value' #>> '{}')::numeric
          when jsonb_typeof(raw_value) = 'string'
            and jsonb_typeof(item -> 'value') = 'string'
            then (raw_value #>> '{}') <= (item ->> 'value')
          else false
        end
        else false
      end;
      if one_match then matched_count := matched_count + 1; end if;
    end loop;
    filter_match := case when filter_value ->> 'filter_match' = 'any'
      then filter_count = 0 or matched_count > 0
      else matched_count = filter_count
    end;
    if filter_match then
      next_position := next_position + 1;
      record_id := record_value.id;
      sort_position := next_position;
      return next;
    end if;
  end loop;
end;
$$;

create or replace function public.create_site_draft_v2(
  expected_business_id uuid,
  expected_actor_id uuid,
  requested_draft jsonb
)
returns public.site_states
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_head public.business_configuration_heads;
  created_state public.site_states;
begin
  if expected_business_id is null or expected_actor_id is null then
    raise exception 'site_request_invalid' using errcode = '22023';
  end if;
  perform private.site_assert_actor_v1(expected_business_id, expected_actor_id);
  perform private.site_assert_site_draft_c2(expected_business_id, requested_draft);
  select * into current_head from public.business_configuration_heads
  where business_id = expected_business_id for update;
  if not found then raise exception 'configuration_head_not_found' using errcode = 'P0002'; end if;
  insert into public.site_states (
    business_id, draft_json, draft_base_version_id,
    draft_base_head_revision, created_by
  ) values (
    expected_business_id, requested_draft, current_head.active_version_id,
    current_head.head_revision, expected_actor_id
  ) returning * into created_state;
  perform private.site_sync_draft_asset_references_v1(
    expected_business_id, created_state.id, created_state.draft_revision, requested_draft
  );
  return created_state;
end;
$$;

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
    expected_business_id, requested_site_id, selected_state.draft_revision, requested_draft
  );
  return selected_state;
end;
$$;

revoke all on function public.create_site_draft_v2(uuid, uuid, jsonb),
  public.save_site_draft_v2(uuid, uuid, uuid, bigint, jsonb)
  from public, anon, service_role;
grant execute on function public.create_site_draft_v2(uuid, uuid, jsonb),
  public.save_site_draft_v2(uuid, uuid, uuid, bigint, jsonb)
  to authenticated;

create or replace function private.site_public_media_token_v2(
  target_site_id uuid,
  target_asset_id uuid
)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'm_' || encode(extensions.digest(
    convert_to(target_site_id::text || ':' || target_asset_id::text, 'UTF8'),
    'sha256'
  ), 'hex');
$$;

create or replace function private.site_public_block_key_v2(
  target_site_id uuid,
  target_block_id uuid
)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'b_' || encode(extensions.digest(
    convert_to(target_site_id::text || ':' || target_block_id::text, 'UTF8'),
    'sha256'
  ), 'hex');
$$;

create or replace function private.site_legacy_source_fingerprint_v2(
  target_business_id uuid
)
returns text
language sql
stable
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(coalesce((
    select jsonb_agg(to_jsonb(page_value) order by page_value.id)::text
    from public.pages as page_value
    where page_value.business_id = target_business_id
      and page_value.audience = 'public'
      and page_value.status = 'published'
      and page_value.is_active
  ), '[]'), 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function private.site_legacy_source_is_unchanged_v2(
  target_business_id uuid,
  target_site_id uuid,
  expected_checksum text
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select expected_checksum is not null
    and private.site_legacy_source_fingerprint_v2(target_business_id) = expected_checksum
    and not exists (
      select 1
      from public.pages as page_value
      where page_value.business_id = target_business_id
        and page_value.audience = 'public'
        and page_value.status = 'published'
        and page_value.is_active
        and not exists (
          select 1
          from public.site_page_bindings as binding
          where binding.business_id = target_business_id
            and binding.site_id = target_site_id
            and binding.legacy_source_page_id = page_value.id
            and binding.legacy_source_checksum = encode(extensions.digest(convert_to(to_jsonb(page_value)::text, 'UTF8'), 'sha256'), 'hex')
        )
    )
    and not exists (
      select 1
      from public.site_page_bindings as binding
      where binding.business_id = target_business_id
        and binding.site_id = target_site_id
        and binding.legacy_source_page_id is not null
        and not exists (
          select 1
          from public.pages as page_value
          where page_value.business_id = target_business_id
            and page_value.id = binding.legacy_source_page_id
            and page_value.audience = 'public'
            and page_value.status = 'published'
            and page_value.is_active
        )
    );
$$;

create or replace function private.site_assert_adoption_source_v2(
  target_business_id uuid,
  target_site_id uuid,
  expected_checksum text
)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.site_legacy_source_is_unchanged_v2(
    target_business_id, target_site_id, expected_checksum
  ) then
    raise exception 'site_adoption_stale' using errcode = 'P0001';
  end if;
end;
$$;

-- A Site created while no legacy Page is public can still race a legacy
-- publication before its first release. Mark that source as pending while the
-- caller holds the configuration-head and Site-state locks, so the next
-- owner action stages the same whole-Business adoption flow instead of
-- allowing the new Site to publish over it.
create or replace function private.site_mark_legacy_pending_v2(
  target_business_id uuid,
  target_site_id uuid
)
returns boolean
language plpgsql
volatile
set search_path = ''
as $$
declare
  selected_state public.site_states;
  source_count integer;
  source_fingerprint text;
begin
  select * into selected_state
  from public.site_states
  where business_id = target_business_id and id = target_site_id
  for update;
  if not found or selected_state.migration_state <> 'new' then
    return false;
  end if;
  select count(*) into source_count
  from public.pages as page_value
  where page_value.business_id = target_business_id
    and page_value.audience = 'public'
    and page_value.status = 'published'
    and page_value.is_active;
  if source_count = 0 then return false; end if;
  source_fingerprint := private.site_legacy_source_fingerprint_v2(
    target_business_id
  );
  update public.site_states set
    migration_state = 'legacy_pending',
    legacy_source_checksum = source_fingerprint,
    legacy_source_page_count = source_count,
    updated_at = timezone('utc', now())
  where business_id = target_business_id
    and id = target_site_id
    and migration_state = 'new';
  return true;
end;
$$;


-- Keep the existing C1 application algorithm intact behind a small authority
-- gate. The lock is acquired before the gate and in the same order as C1's
-- canonical configuration application, so an old tab cannot race adoption.
alter function public.apply_configuration_change(uuid, uuid, uuid)
  rename to apply_configuration_change_c1_v1;

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
  return public.apply_configuration_change_c1_v1(
    expected_business_id, expected_actor_id, requested_change_set_id
  );
end;
$$;

revoke all on function public.apply_configuration_change(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.apply_configuration_change(uuid, uuid, uuid)
  to authenticated, service_role;

create or replace function private.site_safe_public_value_v2(value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  child jsonb;
  result jsonb := '[]'::jsonb;
begin
  if value is null or jsonb_typeof(value) in ('null', 'string', 'number', 'boolean') then
    return value;
  end if;
  if jsonb_typeof(value) <> 'array' then
    return null;
  end if;
  for child in select item from jsonb_array_elements(value) as item loop
    if private.site_safe_public_value_v2(child) is null
      and jsonb_typeof(child) <> 'null'
    then
      return null;
    end if;
    result := result || jsonb_build_array(private.site_safe_public_value_v2(child));
  end loop;
  return result;
end;
$$;

create or replace function private.site_public_record_values_v2(
  target_business_id uuid,
  target_site_id uuid,
  target_record_id uuid,
  target_object_id uuid,
  requested_field_keys text[]
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  record_value public.records;
  field_value public.field_definitions;
  raw_value jsonb;
  safe_value jsonb;
  attachment_tokens jsonb;
  result jsonb := '{}'::jsonb;
begin
  select * into record_value
  from public.records
  where business_id = target_business_id
    and id = target_record_id
    and object_definition_id = target_object_id
    and record_status = 'active';
  if not found then return result; end if;

  for field_value in
    select definition.*
    from public.field_definitions as definition
    where definition.business_id = target_business_id
      and definition.object_definition_id = target_object_id
      and definition.key = any(requested_field_keys)
      and definition.is_active
    order by definition.position, definition.key
  loop
    raw_value := record_value.data_json -> field_value.key;
    if field_value.field_type = 'file' then
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'token', private.site_public_media_token_v2(target_site_id, attachment.asset_id)
        ) order by attachment.updated_at, attachment.asset_id
      ), '[]'::jsonb)
      into attachment_tokens
      from public.site_record_media_attachments as attachment
      join public.media_assets as asset
        on asset.business_id = attachment.business_id
        and asset.id = attachment.asset_id
        and asset.cleanup_claim_token is null
      where attachment.business_id = target_business_id
        and attachment.site_id = target_site_id
        and attachment.record_id = target_record_id
        and attachment.field_definition_id = field_value.id;
      if jsonb_array_length(attachment_tokens) = 1 then
        result := result || jsonb_build_object(
          field_value.key, attachment_tokens -> 0 -> 'token'
        );
      elsif jsonb_array_length(attachment_tokens) > 1 then
        result := result || jsonb_build_object(field_value.key, attachment_tokens);
      end if;
    else
      safe_value := private.site_safe_public_value_v2(raw_value);
      if safe_value is not null or jsonb_typeof(raw_value) = 'null' then
        result := result || jsonb_build_object(field_value.key, safe_value);
      end if;
    end if;
  end loop;
  return result;
end;
$$;



create or replace function private.site_import_legacy_block_v2(
  block_value jsonb,
  nesting integer default 0
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  block_id uuid;
  block_type text;
  text_value text;
  label_value text;
  href_value text;
  summary_value text;
  child jsonb;
  mapped jsonb;
  children jsonb := '[]'::jsonb;
  columns_value jsonb := '[]'::jsonb;
  column_value jsonb;
  column_blocks jsonb := '[]'::jsonb;
  image_value jsonb;
  images_value jsonb := '[]'::jsonb;
  image_id uuid;
  image_alt text;
  image_state text;
begin
  block_id := case
    when private.site_valid_uuid_v1(block_value -> 'id')
      then (block_value ->> 'id')::uuid
    else gen_random_uuid()
  end;
  block_type := coalesce(block_value ->> 'type', 'unknown');
  text_value := btrim(coalesce(block_value ->> 'text', ''));

  if block_type = 'heading' then
    return jsonb_build_object(
      'type', 'heading', 'id', block_id,
      'text', left(text_value, 120),
      'level', case when (block_value ->> 'level') in ('1', '2', '3')
        then (block_value ->> 'level')::integer else 2 end
    ) || case when text_value = ''
      then jsonb_build_object('draft_state', 'incomplete') else '{}'::jsonb end;
  elsif block_type = 'text' then
    return jsonb_build_object(
      'type', 'text', 'id', block_id,
      'text', left(text_value, 5000)
    ) || case when text_value = ''
      then jsonb_build_object('draft_state', 'incomplete') else '{}'::jsonb end;
  elsif block_type = 'callout' then
    text_value := left(text_value, 1000);
    return jsonb_build_object(
      'type', 'callout', 'id', block_id,
      'text', text_value,
      'tone', case when (block_value ->> 'tone') in ('neutral', 'info', 'success', 'warning')
        then block_value ->> 'tone' else 'info' end
    ) || case when text_value = ''
      then jsonb_build_object('draft_state', 'incomplete') else '{}'::jsonb end;
  elsif block_type = 'divider' then
    return jsonb_build_object('type', 'divider', 'id', block_id);
  elsif block_type = 'button' then
    label_value := left(btrim(coalesce(block_value ->> 'label', '')), 120);
    href_value := left(btrim(coalesce(block_value ->> 'href', '')), 2048);
    if label_value <> '' and href_value ~ '^(https?://|/|mailto:)' then
      return jsonb_build_object(
        'type', 'button', 'id', block_id, 'label', label_value,
        'href', href_value,
        'style', case when (block_value ->> 'style') in ('primary', 'secondary')
          then block_value ->> 'style' else 'primary' end
      );
    end if;
    return jsonb_build_object(
      'type', 'callout', 'id', block_id,
      'text', 'This legacy button needs review before it can be published.',
      'tone', 'warning', 'draft_state', 'incomplete'
    );
  elsif block_type = 'image' then
    image_alt := left(btrim(coalesce(block_value ->> 'alt', '')), 300);
    if private.site_valid_uuid_v1(block_value -> 'asset_id') and image_alt <> '' then
      return jsonb_build_object(
        'type', 'image', 'id', block_id,
        'asset_id', (block_value ->> 'asset_id')::uuid,
        'alt', image_alt,
        'draft_state', 'complete'
      );
    end if;
    return jsonb_build_object(
      'type', 'image', 'id', block_id, 'alt', image_alt,
      'draft_state', 'incomplete'
    );
  elsif block_type = 'gallery' then
    if nesting > 0 or jsonb_typeof(block_value -> 'images') <> 'array' then
      return jsonb_build_object(
        'type', 'callout', 'id', block_id,
        'text', 'This legacy gallery needs review before it can be published.',
        'tone', 'warning', 'draft_state', 'incomplete'
      );
    end if;
    for image_value in select value from jsonb_array_elements(block_value -> 'images') loop
      image_id := case
        when private.site_valid_uuid_v1(image_value -> 'asset_id')
          then (image_value ->> 'asset_id')::uuid else null end;
      image_alt := left(btrim(coalesce(image_value ->> 'alt', '')), 300);
      image_state := case when image_id is not null and image_alt <> ''
        then 'complete' else 'incomplete' end;
      images_value := images_value || jsonb_build_array(
        jsonb_build_object('asset_id', image_id, 'alt', image_alt, 'draft_state', image_state)
        - case when image_id is null then 'asset_id' else '' end
      );
    end loop;
    return jsonb_build_object(
      'type', 'gallery', 'id', block_id, 'images', images_value,
      'presentation', case when (block_value ->> 'presentation') in ('grid', 'carousel')
        then block_value ->> 'presentation' else 'grid' end,
      'draft_state', case when jsonb_array_length(images_value) > 0 and not exists (
        select 1 from jsonb_array_elements(images_value) as item(value)
        where item.value ->> 'draft_state' <> 'complete'
      ) then 'complete' else 'incomplete' end
    );
  elsif block_type = 'collapsible' then
    if nesting > 0 or jsonb_typeof(block_value -> 'blocks') <> 'array' then
      return jsonb_build_object(
        'type', 'callout', 'id', block_id,
        'text', 'This legacy section needs review before it can be published.',
        'tone', 'warning', 'draft_state', 'incomplete'
      );
    end if;
    for child in select value from jsonb_array_elements(block_value -> 'blocks') loop
      mapped := private.site_import_legacy_block_v2(child, nesting + 1);
      children := children || jsonb_build_array(mapped);
    end loop;
    summary_value := left(btrim(coalesce(block_value ->> 'summary', '')), 200);
    return jsonb_build_object(
      'type', 'collapsible', 'id', block_id,
      'summary', summary_value, 'blocks', children,
      'open', coalesce((block_value ->> 'open')::boolean, true),
      'draft_state', case when summary_value = '' then 'incomplete' else 'complete' end
    );
  elsif block_type = 'section' then
    if nesting > 0 or jsonb_typeof(block_value -> 'columns') <> 'array' then
      return jsonb_build_object(
        'type', 'callout', 'id', block_id,
        'text', 'This legacy section needs review before it can be published.',
        'tone', 'warning', 'draft_state', 'incomplete'
      );
    end if;
    if jsonb_array_length(block_value -> 'columns') not between 1 and 3 then
      return jsonb_build_object(
        'type', 'callout', 'id', block_id,
        'text', 'This legacy section needs review before it can be published.',
        'tone', 'warning', 'draft_state', 'incomplete'
      );
    end if;
    for column_value in select value from jsonb_array_elements(block_value -> 'columns') loop
      column_blocks := '[]'::jsonb;
      if jsonb_typeof(column_value -> 'blocks') = 'array' then
        for child in select value from jsonb_array_elements(column_value -> 'blocks') loop
          mapped := private.site_import_legacy_block_v2(child, nesting + 1);
          column_blocks := column_blocks || jsonb_build_array(mapped);
        end loop;
      end if;
      columns_value := columns_value || jsonb_build_array(jsonb_build_object('blocks', column_blocks));
    end loop;
    return jsonb_build_object(
      'type', 'section', 'id', block_id, 'columns', columns_value,
      'width', case when (block_value ->> 'width') in ('content', 'wide')
        then block_value ->> 'width' else 'content' end
    );
  elsif block_type = 'rich_text' then
    return jsonb_build_object(
      'type', 'callout', 'id', block_id,
      'text', 'This legacy rich text needs review before it can be published.',
      'tone', 'warning', 'draft_state', 'incomplete'
    );
  elsif block_type in ('form', 'public_form', 'booking', 'preorder', 'view') then
    return jsonb_build_object(
      'type', 'callout', 'id', block_id,
      'text', format('Legacy %s content needs review before it can be published.', block_type),
      'tone', 'warning', 'draft_state', 'incomplete'
    );
  end if;

  return jsonb_build_object(
    'type', 'callout', 'id', block_id,
    'text', 'This legacy content needs review before it can be published.',
    'tone', 'warning', 'draft_state', 'incomplete'
  );
end;
$$;


create or replace function private.site_import_legacy_draft_v2(
  target_business_id uuid
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  business_name text;
  page_value public.pages;
  source_block jsonb;
  mapped_block jsonb;
  pages_value jsonb := '[]'::jsonb;
  blocks_value jsonb;
  safe_slug text;
  fallback_slug text;
  source_index integer := 0;
  used_slugs text[] := array[]::text[];
  has_home_source boolean := false;
begin
  select business.name into business_name
  from public.businesses as business
  where business.id = target_business_id;
  select exists (
    select 1
    from public.pages as home_page
    where home_page.business_id = target_business_id
      and home_page.audience = 'public'
      and home_page.status = 'published'
      and home_page.is_active
      and lower(btrim(home_page.slug)) = 'home'
  ) into has_home_source;
  for page_value in
    select page_item.*
    from public.pages as page_item
    where page_item.business_id = target_business_id
      and page_item.audience = 'public'
      and page_item.status = 'published'
      and page_item.is_active
    order by page_item.slug, page_item.id
  loop
    source_index := source_index + 1;
    safe_slug := lower(regexp_replace(btrim(coalesce(page_value.slug, '')), '[^a-z0-9]+', '-', 'g'));
    safe_slug := left(trim(both '-' from safe_slug), 80);
    if safe_slug = '' or safe_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
      safe_slug := 'legacy-' || replace(page_value.id::text, '-', '');
    end if;
    if safe_slug = any(used_slugs) then
      fallback_slug := 'legacy-' || replace(page_value.id::text, '-', '');
      safe_slug := left(fallback_slug, 80);
      if safe_slug = any(used_slugs) then
        safe_slug := left(fallback_slug, 72) || '-' || source_index::text;
      end if;
    end if;
    used_slugs := array_append(used_slugs, safe_slug);
    blocks_value := '[]'::jsonb;
    if jsonb_typeof(page_value.layout_json -> 'blocks') = 'array' then
      for source_block in select value from jsonb_array_elements(page_value.layout_json -> 'blocks') loop
        mapped_block := private.site_import_legacy_block_v2(source_block);
        blocks_value := blocks_value || jsonb_build_array(mapped_block);
      end loop;
    else
      blocks_value := jsonb_build_array(jsonb_build_object(
        'type', 'callout', 'id', gen_random_uuid(),
        'text', 'This legacy Page has no usable layout and needs review before it can be published.',
        'tone', 'warning', 'draft_state', 'incomplete'
      ));
    end if;
    pages_value := pages_value || jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(),
      'title', coalesce(nullif(left(btrim(coalesce(page_value.title, '')), 120), ''), 'Untitled Page'),
      'slug', safe_slug,
      'navigation_label', coalesce(nullif(left(btrim(coalesce(page_value.title, '')), 80), ''), 'Untitled Page'),
      'is_home', case when has_home_source then safe_slug = 'home' else source_index = 1 end,
      'is_in_navigation', true,
      'is_included', true,
      'layout', jsonb_build_object('blocks', blocks_value)
    ));
  end loop;
  return jsonb_build_object(
    'schema_version', 1,
    'branding', jsonb_build_object(
      'name', coalesce(nullif(left(btrim(business_name), 120), ''), 'Site'),
      'accent', 'forest'
    ),
    'pages', pages_value
  );
end;
$$;



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
  perform private.site_assert_actor_v1(expected_business_id, expected_actor_id);
  select * into current_head from public.business_configuration_heads
  where business_id = expected_business_id for update;
  if not found then raise exception 'configuration_head_not_found' using errcode = 'P0002'; end if;
  if current_head.active_version_id <> expected_base_version_id
    or current_head.head_revision <> expected_head_revision
  then raise exception 'site_configuration_stale' using errcode = 'P0001'; end if;
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
  perform private.site_assert_site_draft_c2(
    expected_business_id, imported_draft
  );
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
    from jsonb_array_elements(imported_draft -> 'pages') with ordinality as item(value, ordinal)
    where item.ordinal = source_index;
    if page_value is null then raise exception 'site_adoption_stale' using errcode = 'P0001'; end if;
    draft_page_id := (page_value ->> 'id')::uuid;
    source_checksum := encode(extensions.digest(convert_to(to_jsonb(source_page)::text, 'UTF8'), 'sha256'), 'hex');
    insert into public.site_page_bindings (
      business_id, site_id, draft_page_id, canonical_page_key,
      legacy_source_page_id, legacy_source_checksum
    ) values (
      expected_business_id, requested_site_id, draft_page_id,
      private.site_page_key_v1(requested_site_id, draft_page_id),
      source_page.id, source_checksum
    );
  end loop;
  if private.site_legacy_source_fingerprint_v2(expected_business_id) <> source_fingerprint then
    raise exception 'site_adoption_stale' using errcode = 'P0001';
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




-- The definitions above retain the C1 implementation as an audit-compatible
-- baseline. These final C2 definitions are the public-safe implementations
-- used by the v2 RPCs; keeping them at the end makes the migration order
-- explicit when this file is replayed on a clean database.
alter table public.site_release_collection_references
  add column if not exists public_key text;
create unique index if not exists site_release_collection_refs_public_key_idx
  on public.site_release_collection_references
    (business_id, release_id, public_key, field_definition_id);

create or replace function private.site_public_project_block_v2(
  target_business_id uuid,
  target_site_id uuid,
  block jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  child jsonb;
  projected jsonb;
  projected_children jsonb := '[]'::jsonb;
  projected_columns jsonb := '[]'::jsonb;
  image_value jsonb;
  projected_images jsonb := '[]'::jsonb;
  selected_record record;
  field_keys text[] := array[]::text[];
  records_projection jsonb := '[]'::jsonb;
  block_id uuid;
  object_id uuid;
  detail_page_slug text;
begin
  if block ->> 'type' in ('form', 'public_form', 'booking', 'preorder', 'view') then
    return null;
  end if;
  block_id := (block ->> 'id')::uuid;
  if block ->> 'type' = 'image' then
    if not (block ? 'asset_id') then return null; end if;
      return (block - 'id' - 'asset_id' - 'src' - 'draft_state') || jsonb_build_object(
      'public_key', private.site_public_block_key_v2(target_site_id, block_id),
      'media_token', private.site_public_media_token_v2(
        target_site_id, (block ->> 'asset_id')::uuid
      )
    );
  elsif block ->> 'type' = 'gallery' then
    for image_value in select value from jsonb_array_elements(block -> 'images') loop
      if image_value ? 'asset_id' then
        projected_images := projected_images || jsonb_build_array(
          (image_value - 'asset_id' - 'draft_state') || jsonb_build_object(
            'media_token', private.site_public_media_token_v2(
              target_site_id, (image_value ->> 'asset_id')::uuid
            )
          )
        );
      end if;
    end loop;
    if jsonb_array_length(projected_images) = 0 then return null; end if;
    return (block - 'id' - 'images' - 'draft_state') || jsonb_build_object(
      'public_key', private.site_public_block_key_v2(target_site_id, block_id),
      'images', projected_images
    );
  elsif block ->> 'type' = 'collection' then
    select definition.id into object_id
    from public.object_definitions as definition
    where definition.business_id = target_business_id
      and definition.key = block ->> 'object_key'
      and definition.is_active;
    if object_id is null then return null; end if;
    select coalesce(array_agg(value #>> '{}' order by ordinality), array[]::text[])
      into field_keys
    from jsonb_array_elements(block -> 'public_field_keys') with ordinality;
    for selected_record in select * from private.site_collection_record_ids_v2(
      target_business_id, block
    ) order by sort_position loop
      records_projection := records_projection || jsonb_build_array(
        jsonb_build_object(
          'public_id', private.site_public_record_token_v2(
            target_site_id, block_id, selected_record.record_id
          ),
          'values', private.site_public_record_values_v2(
            target_business_id, target_site_id, selected_record.record_id,
            object_id, field_keys
          )
        )
      );
    end loop;
    if block ? 'detail_page_id' then
      select page_item.page_value ->> 'slug' into detail_page_slug
      from public.site_states as state_value
      cross join lateral jsonb_array_elements(state_value.draft_json -> 'pages') as page_item(page_value)
      where state_value.business_id = target_business_id
        and state_value.id = target_site_id
        and page_item.page_value ->> 'id' = block ->> 'detail_page_id'
      limit 1;
    end if;
    return (block - 'id' - 'object_key' - 'selection' - 'public_field_keys'
      - 'detail_page_id' - 'filter' - 'draft_state') || jsonb_build_object(
        'public_key', private.site_public_block_key_v2(target_site_id, block_id),
        'records', records_projection,
        'detail_page_slug', detail_page_slug
      );
  elsif block ->> 'type' = 'record_detail' then
    return (block - 'id' - 'collection_block_id' - 'public_field_keys' - 'draft_state')
      || jsonb_build_object(
        'public_key', private.site_public_block_key_v2(target_site_id, block_id),
        'collection_public_key', private.site_public_block_key_v2(
          target_site_id, (block ->> 'collection_block_id')::uuid
        )
      );
  elsif block ->> 'type' = 'collapsible' then
    for child in select value from jsonb_array_elements(block -> 'blocks') loop
      projected := private.site_public_project_block_v2(
        target_business_id, target_site_id, child
      );
      if projected is not null then
        projected_children := projected_children || jsonb_build_array(projected);
      end if;
    end loop;
    return (block - 'id' - 'blocks' - 'draft_state') || jsonb_build_object(
      'public_key', private.site_public_block_key_v2(target_site_id, block_id),
      'blocks', projected_children
    );
  elsif block ->> 'type' = 'section' then
    for child in select value from jsonb_array_elements(block -> 'columns') loop
      projected_children := '[]'::jsonb;
      for projected in select value from jsonb_array_elements(child -> 'blocks') loop
        projected := private.site_public_project_block_v2(
          target_business_id, target_site_id, projected
        );
        if projected is not null then
          projected_children := projected_children || jsonb_build_array(projected);
        end if;
      end loop;
      projected_columns := projected_columns || jsonb_build_array(
        jsonb_build_object('blocks', projected_children)
      );
    end loop;
    return (block - 'id' - 'columns' - 'draft_state') || jsonb_build_object(
      'public_key', private.site_public_block_key_v2(target_site_id, block_id),
      'columns', projected_columns
    );
  end if;
  return (block - 'id' - 'draft_state') || jsonb_build_object(
    'public_key', private.site_public_block_key_v2(target_site_id, block_id)
  );
end;
$$;

create or replace function private.build_site_projection_v2(
  target_business_id uuid,
  target_site_id uuid,
  draft jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  page_value jsonb;
  block jsonb;
  projected jsonb;
  pages_projection jsonb := '[]'::jsonb;
  blocks_projection jsonb;
  branding jsonb;
  page_id uuid;
begin
  branding := jsonb_build_object(
    'name', draft -> 'branding' -> 'name',
    'accent', draft -> 'branding' -> 'accent'
  );
  if draft -> 'branding' ? 'logo_asset_id' then
    branding := branding || jsonb_build_object(
      'logo_media_token', private.site_public_media_token_v2(
        target_site_id, (draft -> 'branding' ->> 'logo_asset_id')::uuid
      )
    );
  end if;
  for page_value in select value from jsonb_array_elements(draft -> 'pages') loop
    if not coalesce((page_value ->> 'is_included')::boolean, false) then continue; end if;
    page_id := (page_value ->> 'id')::uuid;
    blocks_projection := '[]'::jsonb;
    for block in select value from jsonb_array_elements(page_value -> 'layout' -> 'blocks') loop
      projected := private.site_public_project_block_v2(
        target_business_id, target_site_id, block
      );
      if projected is not null then
        blocks_projection := blocks_projection || jsonb_build_array(projected);
      end if;
    end loop;
    pages_projection := pages_projection || jsonb_build_array(jsonb_build_object(
      'public_key', private.site_public_block_key_v2(target_site_id, page_id),
      'title', page_value -> 'title',
      'slug', page_value -> 'slug',
      'navigation_label', page_value -> 'navigation_label',
      'is_home', page_value -> 'is_home',
      'is_in_navigation', page_value -> 'is_in_navigation',
      'layout', jsonb_build_object('blocks', blocks_projection)
    ));
  end loop;
  return jsonb_build_object(
    'schema_version', 2,
    'branding', branding,
    'pages', pages_projection
  );
end;
$$;

-- Release references and public tokens follow the exact included-page
-- projection. Draft retention still tracks every Page, while anonymous
-- delivery must not gain a token for an excluded Page's media.
create or replace function private.site_included_draft_asset_ids_v2(draft jsonb)
returns setof uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  page_value jsonb;
  block jsonb;
begin
  if draft -> 'branding' ? 'logo_asset_id' then
    return next (draft -> 'branding' ->> 'logo_asset_id')::uuid;
  end if;
  for page_value in
    select value from jsonb_array_elements(coalesce(draft -> 'pages', '[]'::jsonb))
  loop
    if not coalesce((page_value ->> 'is_included')::boolean, false) then
      continue;
    end if;
    for block in select value from jsonb_array_elements(
      coalesce(page_value -> 'layout' -> 'blocks', '[]'::jsonb)
    ) loop
      return query select * from private.site_block_asset_ids_v1(block);
    end loop;
  end loop;
end;
$$;

create or replace function private.site_sync_public_tokens_v2(
  target_business_id uuid,
  target_site_id uuid,
  target_release_id uuid,
  draft jsonb
)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  site_block record;
  selected_record record;
  object_id uuid;
  field_value record;
  asset_value uuid;
begin
  for site_block in
    select draft_block.*
    from private.site_draft_blocks_v1(draft) as draft_block
    join jsonb_array_elements(draft -> 'pages') as page_value(value)
      on (page_value.value ->> 'id')::uuid = draft_block.page_id
    where coalesce((page_value.value ->> 'is_included')::boolean, false)
      and draft_block.block ->> 'type' = 'collection'
  loop
    select definition.id into object_id from public.object_definitions as definition
    where definition.business_id = target_business_id
      and definition.key = site_block.block ->> 'object_key'
      and definition.is_active;
    if object_id is null then raise exception 'site_collection_invalid' using errcode = '23514'; end if;
    for field_value in
      select definition.id, definition.key
      from public.field_definitions as definition
      where definition.business_id = target_business_id
        and definition.object_definition_id = object_id
        and definition.key = any(select value #>> '{}'
          from jsonb_array_elements(site_block.block -> 'public_field_keys'))
        and definition.is_active
    loop
      insert into public.site_release_collection_references (
        business_id, release_id, collection_block_id, object_definition_id,
        field_definition_id, public_key
      ) values (
        target_business_id, target_release_id, (site_block.block ->> 'id')::uuid,
        object_id, field_value.id,
        private.site_public_block_key_v2(target_site_id, (site_block.block ->> 'id')::uuid)
      ) on conflict do nothing;
    end loop;
    for selected_record in select * from private.site_collection_record_ids_v2(
      target_business_id, site_block.block
    ) loop
      insert into public.site_public_record_tokens (
        business_id, site_id, token, collection_block_id, record_id
      ) values (
        target_business_id, target_site_id,
        private.site_public_record_token_v2(
          target_site_id, (site_block.block ->> 'id')::uuid,
          selected_record.record_id
        ), (site_block.block ->> 'id')::uuid, selected_record.record_id
      ) on conflict (business_id, site_id, token) do update set
        collection_block_id = excluded.collection_block_id,
        record_id = excluded.record_id;
      insert into public.site_release_record_references (business_id, release_id, record_id)
      values (target_business_id, target_release_id, selected_record.record_id)
      on conflict do nothing;
      insert into public.site_public_media_tokens (business_id, site_id, token, asset_id)
      select target_business_id, target_site_id,
        private.site_public_media_token_v2(target_site_id, attachment.asset_id),
        attachment.asset_id
      from public.site_record_media_attachments as attachment
      join public.media_assets as asset on asset.business_id = attachment.business_id
        and asset.id = attachment.asset_id and asset.cleanup_claim_token is null
      where attachment.business_id = target_business_id
        and attachment.site_id = target_site_id
        and attachment.record_id = selected_record.record_id
        and attachment.field_definition_id in (
          select definition.id
          from public.field_definitions as definition
          where definition.business_id = target_business_id
            and definition.object_definition_id = object_id
            and definition.key = any(select value #>> '{}'
              from jsonb_array_elements(site_block.block -> 'public_field_keys'))
            and definition.is_active
        )
      on conflict (business_id, site_id, token) do update set asset_id = excluded.asset_id;
      insert into public.site_release_asset_references (business_id, release_id, asset_id)
      select target_business_id, target_release_id, attachment.asset_id
      from public.site_record_media_attachments as attachment
      join public.media_assets as asset on asset.business_id = attachment.business_id
        and asset.id = attachment.asset_id and asset.cleanup_claim_token is null
      where attachment.business_id = target_business_id
        and attachment.site_id = target_site_id
        and attachment.record_id = selected_record.record_id
        and attachment.field_definition_id in (
          select definition.id
          from public.field_definitions as definition
          where definition.business_id = target_business_id
            and definition.object_definition_id = object_id
            and definition.key = any(select value #>> '{}'
              from jsonb_array_elements(site_block.block -> 'public_field_keys'))
            and definition.is_active
        )
      on conflict do nothing;
    end loop;
  end loop;
  insert into public.site_public_media_tokens (business_id, site_id, token, asset_id)
  select target_business_id, target_site_id,
    private.site_public_media_token_v2(target_site_id, asset_value), asset_value
  from private.site_included_draft_asset_ids_v2(draft) as asset_value
  on conflict (business_id, site_id, token) do update set asset_id = excluded.asset_id;
  insert into public.site_release_asset_references (business_id, release_id, asset_id)
  select target_business_id, target_release_id, asset_value
  from private.site_included_draft_asset_ids_v2(draft) as asset_value
  on conflict do nothing;
end;
$$;

create or replace function public.prepare_site_release_v2(
  expected_business_id uuid,
  expected_actor_id uuid,
  requested_site_id uuid,
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
  active_version public.configuration_versions;
  selected_state public.site_states;
  existing_release public.site_releases;
  existing_change public.configuration_change_sets;
  prepared_release public.site_releases;
  proposed_change public.configuration_change_sets;
  validated_change public.configuration_change_sets;
  derived_operations jsonb;
  projection jsonb;
  review_metadata jsonb;
  checksum text;
  canonical_draft jsonb;
begin
  if expected_business_id is null or expected_actor_id is null
    or requested_site_id is null or expected_draft_revision is null
    or expected_draft_revision <= 0 or expected_base_version_id is null
    or expected_head_revision is null or expected_head_revision <= 0
  then raise exception 'site_request_invalid' using errcode = '22023'; end if;
  perform private.site_assert_actor_v1(expected_business_id, expected_actor_id);
  select * into current_head from public.business_configuration_heads
  where business_id = expected_business_id for update;
  if not found then raise exception 'configuration_head_not_found' using errcode = 'P0002'; end if;
  if current_head.active_version_id <> expected_base_version_id
    or current_head.head_revision <> expected_head_revision
  then raise exception 'site_configuration_stale' using errcode = 'P0001'; end if;
  select * into active_version from public.configuration_versions
  where business_id = expected_business_id and id = current_head.active_version_id;
  if not found then raise exception 'configuration_active_version_not_found' using errcode = 'P0002'; end if;
  perform private.assert_configuration_projection_matches_v1(
    expected_business_id, active_version.snapshot_json, active_version.snapshot_checksum
  );
  select * into selected_state from public.site_states
  where business_id = expected_business_id and id = requested_site_id for update;
  if not found then raise exception 'site_not_found' using errcode = 'P0002'; end if;
  if selected_state.draft_revision <> expected_draft_revision then
    raise exception 'site_draft_stale' using errcode = 'P0001';
  end if;
  if selected_state.draft_base_version_id <> current_head.active_version_id
    or selected_state.draft_base_head_revision <> current_head.head_revision
  then raise exception 'site_configuration_rebase_required' using errcode = 'P0001'; end if;
  perform private.site_assert_publication_draft_c2(
    expected_business_id, selected_state.draft_json
  );
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
  perform private.site_assert_publication_ready_v1(
    private.site_strip_filter_draft_v2(selected_state.draft_json)
  );
  perform private.site_assert_assets_available_v1(
    expected_business_id, selected_state.draft_json
  );
  perform private.site_lock_selected_records_c2(
    expected_business_id, selected_state.draft_json
  );
  canonical_draft := private.site_strip_filter_draft_v2(selected_state.draft_json);
  derived_operations := private.site_derived_page_operations_v1(
    expected_business_id, requested_site_id, canonical_draft
  );
  projection := private.build_site_projection_v2(
    expected_business_id, requested_site_id, selected_state.draft_json
  );
  review_metadata := private.build_site_review_metadata_v1(selected_state.draft_json)
    || jsonb_build_object('schema_version', 2,
      'legacy_source_checksum', selected_state.legacy_source_checksum);
  if octet_length(convert_to(projection::text, 'UTF8')) > 524288 then
    raise exception 'site_projection_too_large' using errcode = '22023';
  end if;
  checksum := encode(extensions.digest(convert_to(projection::text, 'UTF8'), 'sha256'), 'hex');
  perform private.site_expire_prepared_releases_v1(expected_business_id, requested_site_id);
  select * into existing_release from public.site_releases
  where business_id = expected_business_id and site_id = requested_site_id
    and status = 'prepared' and projection_schema_version = 2
    and source_draft_revision = selected_state.draft_revision
    and source_base_version_id = current_head.active_version_id
    and source_head_revision = current_head.head_revision
    and expected_active_release_revision = selected_state.active_release_revision
    and projection_checksum = checksum
  order by prepared_at desc limit 1 for share;
  if found then
    if existing_release.configuration_change_set_id is null then return existing_release; end if;
    select * into existing_change from public.configuration_change_sets
    where business_id = expected_business_id and id = existing_release.configuration_change_set_id
    for share;
    if found and existing_change.status = 'validated' then return existing_release; end if;
    update public.site_releases set status = 'invalidated'
    where business_id = expected_business_id and id = existing_release.id;
  end if;
  if jsonb_array_length(derived_operations) > 0 then
    proposed_change := public.propose_configuration_change(
      expected_business_id, expected_actor_id, current_head.active_version_id,
      current_head.head_revision, 'Prepare Site release',
      'Server-derived canonical Site Page definitions.', derived_operations
    );
    validated_change := public.validate_configuration_change(
      expected_business_id, expected_actor_id, proposed_change.id
    );
    if validated_change.status <> 'validated'
      or validated_change.validation_result_json ->> 'outcome' <> 'valid'
    then raise exception 'site_configuration_incompatible' using errcode = '23514'; end if;
  end if;
  insert into public.site_releases (
    business_id, site_id, status, source_draft_revision,
    source_base_version_id, source_head_revision,
    expected_active_release_revision, configuration_change_set_id,
    projection_schema_version, projection_json, review_json,
    projection_checksum, prepared_by, expires_at
  ) values (
    expected_business_id, requested_site_id, 'prepared', selected_state.draft_revision,
    current_head.active_version_id, current_head.head_revision,
    selected_state.active_release_revision, validated_change.id, 2,
    projection, review_metadata, checksum, expected_actor_id,
    timezone('utc', now()) + interval '24 hours'
  ) returning * into prepared_release;
  perform private.site_sync_public_tokens_v2(
    expected_business_id, requested_site_id, prepared_release.id,
    selected_state.draft_json
  );
  return prepared_release;
end;
$$;

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

-- Adopted Businesses retain Site authority over public Page writes. The
-- transaction-local marker is set only by the trusted release publisher after
-- it has acquired the configuration-head lock.
create or replace function private.site_assert_public_page_mutation_authority_v2(
  target_business_id uuid,
  target_operations jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  adopted boolean;
  operation jsonb;
begin
  select exists (
    select 1 from public.site_states
    where business_id = target_business_id and migration_state = 'adopted'
  ) into adopted;
  if not adopted then return; end if;
  for operation in select value from jsonb_array_elements(target_operations) loop
    if operation ->> 'op' = 'set_page'
      and operation ->> 'audience' = 'public'
    then
      raise exception 'legacy_public_actions_retired' using errcode = '55000';
    end if;
  end loop;
end;
$$;

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
  then
    raise exception 'legacy_public_actions_retired' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists adopted_public_page_mutation_guard_v2 on public.pages;
create trigger adopted_public_page_mutation_guard_v2
before insert or update or delete on public.pages
for each row execute function private.guard_adopted_public_page_mutation_v2();

create or replace function private.bump_record_revision_v2()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.record_revision := old.record_revision + 1;
  return new;
end;
$$;

drop trigger if exists records_bump_site_revision_v2 on public.records;
create trigger records_bump_site_revision_v2
before update on public.records
for each row execute function private.bump_record_revision_v2();

-- A managed Record image is part of the canonical Record value as well as the
-- Site attachment index. Legacy URL/object file values remain valid, while a
-- new managed value must be written by the narrow Site media boundary and must
-- point at a tenant-owned, unclaimed media asset. This keeps direct table
-- writes and generic AI Record updates from creating an untracked asset link.
create or replace function private.validate_site_managed_record_file_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  field_value public.field_definitions;
  proposed_value jsonb;
  previous_value jsonb;
  managed_asset_id uuid;
  site_file_write boolean :=
    coalesce(pg_catalog.current_setting('smbos.site_record_file_write', true), '') = 'on';
begin
  if tg_op = 'UPDATE' and new.data_json is not distinct from old.data_json then
    return new;
  end if;

  for field_value in
    select definition.*
    from public.field_definitions as definition
    where definition.business_id = new.business_id
      and definition.object_definition_id = new.object_definition_id
      and definition.field_type = 'file'
  loop
    proposed_value := new.data_json -> field_value.key;
    previous_value := case when tg_op = 'UPDATE'
      then old.data_json -> field_value.key else null end;
    if proposed_value is not distinct from previous_value then
      continue;
    end if;

    if jsonb_typeof(proposed_value) = 'object'
      and proposed_value ? 'asset_id'
    then
      if not private.site_json_has_only_keys_v1(proposed_value, array['asset_id'])
        or jsonb_typeof(proposed_value -> 'asset_id') <> 'string'
        or not (proposed_value ->> 'asset_id') ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then
        raise exception 'site_record_file_invalid' using errcode = '23514';
      end if;
      if not site_file_write then
        raise exception 'site_record_file_write_boundary_required'
          using errcode = '55000';
      end if;
      managed_asset_id := (proposed_value ->> 'asset_id')::uuid;
      if not exists (
        select 1 from public.media_assets as asset
        where asset.business_id = new.business_id
          and asset.id = managed_asset_id
          and asset.cleanup_claim_token is null
      ) then
        raise exception 'site_record_file_asset_unavailable' using errcode = '23514';
      end if;
    end if;

    if tg_op = 'UPDATE' and jsonb_typeof(previous_value) = 'object'
      and previous_value ? 'asset_id'
      and not site_file_write
      and exists (
        select 1 from public.site_record_media_attachments as attachment
        where attachment.business_id = old.business_id
      and attachment.record_id = old.id
      and attachment.field_definition_id = field_value.id
          and (previous_value ->> 'asset_id') ~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and attachment.asset_id = (previous_value ->> 'asset_id')::uuid
      )
    then
      raise exception 'site_record_file_write_boundary_required'
        using errcode = '55000';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists records_validate_site_managed_file_v2 on public.records;
create trigger records_validate_site_managed_file_v2
before insert or update on public.records
for each row execute function private.validate_site_managed_record_file_v2();

create or replace function private.site_assert_record_source_v2(
  target_business_id uuid,
  target_site_id uuid,
  target_record_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.site_states as state
    where state.business_id = target_business_id
      and state.id = target_site_id
      and (
        exists (
          select 1
          from private.site_draft_blocks_v1(state.draft_json) as block_value
          where block_value.block ->> 'type' = 'collection'
            and exists (
              select 1 from private.site_collection_record_ids_v2(
                target_business_id, block_value.block
              ) as selected_record
              where selected_record.record_id = target_record_id
            )
        )
        or exists (
          select 1 from public.site_release_record_references as reference
          where reference.business_id = target_business_id
            and reference.release_id = state.active_release_id
            and reference.record_id = target_record_id
        )
      )
  ) then
    raise exception 'site_record_not_referenced' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function private.site_assert_asset_source_v2(
  target_business_id uuid,
  target_site_id uuid,
  target_asset_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.site_states as state
    where state.business_id = target_business_id and state.id = target_site_id
      and (
        exists (
          select 1 from public.site_draft_asset_references as reference
          where reference.business_id = target_business_id
            and reference.site_id = target_site_id and reference.asset_id = target_asset_id
        )
        or exists (
          select 1 from public.site_release_asset_references as reference
          where reference.business_id = target_business_id
            and reference.release_id = state.active_release_id and reference.asset_id = target_asset_id
        )
        or exists (
          select 1 from public.site_record_media_attachments as attachment
          where attachment.business_id = target_business_id
            and attachment.site_id = target_site_id and attachment.asset_id = target_asset_id
        )
      )
  ) then
    raise exception 'site_asset_not_referenced' using errcode = 'P0002';
  end if;
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
  perform private.site_assert_actor_v1(expected_business_id, expected_actor_id);
  if expected_record_revision is null or expected_record_revision <= 0
    or expected_attachment_revision is null or expected_attachment_revision < 0
  then raise exception 'site_request_invalid' using errcode = '22023'; end if;
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

create or replace function private.site_change_record_availability_v2(
  expected_business_id uuid,
  expected_actor_id uuid,
  requested_site_id uuid,
  requested_record_id uuid,
  requested_status text,
  expected_active_release_revision bigint,
  expected_availability_revision bigint
)
returns public.site_public_record_availability
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_head public.business_configuration_heads;
  state_value public.site_states;
  current_value public.site_public_record_availability;
  result public.site_public_record_availability;
begin
  perform private.site_assert_actor_v1(expected_business_id, expected_actor_id);
  if requested_status not in ('available', 'withdrawn')
    or expected_active_release_revision is null
    or expected_availability_revision is null
    or expected_availability_revision < 0
  then raise exception 'site_request_invalid' using errcode = '22023'; end if;
  select * into current_head from public.business_configuration_heads
  where business_id = expected_business_id for update;
  if not found then raise exception 'configuration_head_not_found' using errcode = 'P0002'; end if;
  select * into state_value from public.site_states
  where business_id = expected_business_id and id = requested_site_id for update;
  if not found then raise exception 'site_not_found' using errcode = 'P0002'; end if;
  if state_value.active_release_revision <> expected_active_release_revision then
    raise exception 'site_release_stale' using errcode = 'P0001';
  end if;
  perform private.site_assert_record_source_v2(
    expected_business_id, requested_site_id, requested_record_id
  );
  select * into current_value from public.site_public_record_availability
  where business_id = expected_business_id and site_id = requested_site_id
    and record_id = requested_record_id for update;
  if found and current_value.availability_revision <> expected_availability_revision then
    raise exception 'site_availability_stale' using errcode = 'P0001';
  end if;
  if found and current_value.status = requested_status then return current_value; end if;
  if not found and expected_availability_revision <> 0 then
    raise exception 'site_availability_stale' using errcode = 'P0001';
  end if;
  if found then
    update public.site_public_record_availability set
      status = requested_status,
      availability_revision = current_value.availability_revision + 1,
      available_from_release_revision = case when requested_status = 'available'
        then state_value.active_release_revision + 1 else 0 end,
      changed_by = expected_actor_id,
      changed_at = timezone('utc', now())
    where business_id = expected_business_id and site_id = requested_site_id
      and record_id = requested_record_id
    returning * into result;
  else
    insert into public.site_public_record_availability (
      business_id, site_id, record_id, status,
      available_from_release_revision, changed_by
    ) values (
      expected_business_id, requested_site_id, requested_record_id,
      requested_status,
      case when requested_status = 'available' then state_value.active_release_revision + 1 else 0 end,
      expected_actor_id
    ) returning * into result;
  end if;
  return result;
end;
$$;

create or replace function private.site_change_media_availability_v2(
  expected_business_id uuid,
  expected_actor_id uuid,
  requested_site_id uuid,
  requested_asset_id uuid,
  requested_status text,
  expected_active_release_revision bigint,
  expected_availability_revision bigint
)
returns public.site_public_media_availability
language plpgsql
security definer
set search_path = ''
 as $$
declare
  current_head public.business_configuration_heads;
  state_value public.site_states;
  current_value public.site_public_media_availability;
  result public.site_public_media_availability;
begin
  perform private.site_assert_actor_v1(expected_business_id, expected_actor_id);
  if requested_status not in ('available', 'withdrawn')
    or expected_active_release_revision is null
    or expected_availability_revision is null
    or expected_availability_revision < 0
  then raise exception 'site_request_invalid' using errcode = '22023'; end if;
  select * into current_head from public.business_configuration_heads
  where business_id = expected_business_id for update;
  if not found then raise exception 'configuration_head_not_found' using errcode = 'P0002'; end if;
  select * into state_value from public.site_states
  where business_id = expected_business_id and id = requested_site_id for update;
  if not found then raise exception 'site_not_found' using errcode = 'P0002'; end if;
  if state_value.active_release_revision <> expected_active_release_revision then
    raise exception 'site_release_stale' using errcode = 'P0001';
  end if;
  perform private.site_assert_asset_source_v2(
    expected_business_id, requested_site_id, requested_asset_id
  );
  select * into current_value from public.site_public_media_availability
  where business_id = expected_business_id and site_id = requested_site_id
    and asset_id = requested_asset_id for update;
  if found and current_value.availability_revision <> expected_availability_revision then
    raise exception 'site_availability_stale' using errcode = 'P0001';
  end if;
  if found and current_value.status = requested_status then return current_value; end if;
  if not found and expected_availability_revision <> 0 then
    raise exception 'site_availability_stale' using errcode = 'P0001';
  end if;
  if found then
    update public.site_public_media_availability set
      status = requested_status,
      availability_revision = current_value.availability_revision + 1,
      available_from_release_revision = case when requested_status = 'available'
        then state_value.active_release_revision + 1 else 0 end,
      changed_by = expected_actor_id,
      changed_at = timezone('utc', now())
    where business_id = expected_business_id and site_id = requested_site_id
      and asset_id = requested_asset_id
    returning * into result;
  else
    insert into public.site_public_media_availability (
      business_id, site_id, asset_id, status,
      available_from_release_revision, changed_by
    ) values (
      expected_business_id, requested_site_id, requested_asset_id,
      requested_status,
      case when requested_status = 'available' then state_value.active_release_revision + 1 else 0 end,
      expected_actor_id
    ) returning * into result;
  end if;
  return result;
end;
$$;

create or replace function public.withdraw_site_record(
  expected_business_id uuid, expected_actor_id uuid, requested_site_id uuid,
  requested_record_id uuid, expected_active_release_revision bigint,
  expected_availability_revision bigint
)
returns public.site_public_record_availability
language sql security definer set search_path = ''
as $$
  select private.site_change_record_availability_v2(
    expected_business_id, expected_actor_id, requested_site_id,
    requested_record_id, 'withdrawn', expected_active_release_revision,
    expected_availability_revision
  );
$$;

create or replace function public.reenable_site_record(
  expected_business_id uuid, expected_actor_id uuid, requested_site_id uuid,
  requested_record_id uuid, expected_active_release_revision bigint,
  expected_availability_revision bigint
)
returns public.site_public_record_availability
language sql security definer set search_path = ''
as $$
  select private.site_change_record_availability_v2(
    expected_business_id, expected_actor_id, requested_site_id,
    requested_record_id, 'available', expected_active_release_revision,
    expected_availability_revision
  );
$$;

create or replace function public.withdraw_site_media(
  expected_business_id uuid, expected_actor_id uuid, requested_site_id uuid,
  requested_asset_id uuid, expected_active_release_revision bigint,
  expected_availability_revision bigint
)
returns public.site_public_media_availability
language sql security definer set search_path = ''
as $$
  select private.site_change_media_availability_v2(
    expected_business_id, expected_actor_id, requested_site_id,
    requested_asset_id, 'withdrawn', expected_active_release_revision,
    expected_availability_revision
  );
$$;

create or replace function public.reenable_site_media(
  expected_business_id uuid, expected_actor_id uuid, requested_site_id uuid,
  requested_asset_id uuid, expected_active_release_revision bigint,
  expected_availability_revision bigint
)
returns public.site_public_media_availability
language sql security definer set search_path = ''
as $$
  select private.site_change_media_availability_v2(
    expected_business_id, expected_actor_id, requested_site_id,
    requested_asset_id, 'available', expected_active_release_revision,
    expected_availability_revision
  );
$$;

revoke all on function public.attach_site_record_media(uuid, uuid, uuid, uuid, uuid, uuid, uuid, bigint, bigint),
  public.remove_site_record_media(uuid, uuid, uuid, uuid, uuid, bigint, bigint),
  public.withdraw_site_record(uuid, uuid, uuid, uuid, bigint, bigint),
  public.reenable_site_record(uuid, uuid, uuid, uuid, bigint, bigint),
  public.withdraw_site_media(uuid, uuid, uuid, uuid, bigint, bigint),
  public.reenable_site_media(uuid, uuid, uuid, uuid, bigint, bigint)
  from public, anon, service_role;
grant execute on function public.attach_site_record_media(uuid, uuid, uuid, uuid, uuid, uuid, uuid, bigint, bigint),
  public.remove_site_record_media(uuid, uuid, uuid, uuid, uuid, bigint, bigint),
  public.withdraw_site_record(uuid, uuid, uuid, uuid, bigint, bigint),
  public.reenable_site_record(uuid, uuid, uuid, uuid, bigint, bigint),
  public.withdraw_site_media(uuid, uuid, uuid, uuid, bigint, bigint),
  public.reenable_site_media(uuid, uuid, uuid, uuid, bigint, bigint)
  to authenticated;

-- Object and Field withdrawal use existing graph authority with separate,
-- typed rows. They are intentionally narrower than a generic source registry:
-- a withdrawn object hides its collections, while a withdrawn Field is removed
-- from the frozen values delivered by those collections. Re-enabling either
-- source is eligible only from the next Site release revision.
create table if not exists public.site_public_object_availability (
  business_id uuid not null,
  site_id uuid not null,
  object_definition_id uuid not null,
  status text not null default 'available'
    check (status in ('available', 'withdrawn')),
  availability_revision bigint not null default 1
    check (availability_revision > 0),
  available_from_release_revision bigint not null default 0
    check (available_from_release_revision >= 0),
  changed_by uuid not null,
  changed_at timestamptz not null default timezone('utc', now()),
  primary key (business_id, site_id, object_definition_id),
  foreign key (business_id, site_id)
    references public.site_states(business_id, id) on delete cascade,
  foreign key (business_id, object_definition_id)
    references public.object_definitions(business_id, id) on delete cascade
);

create table if not exists public.site_public_field_availability (
  business_id uuid not null,
  site_id uuid not null,
  field_definition_id uuid not null,
  status text not null default 'available'
    check (status in ('available', 'withdrawn')),
  availability_revision bigint not null default 1
    check (availability_revision > 0),
  available_from_release_revision bigint not null default 0
    check (available_from_release_revision >= 0),
  changed_by uuid not null,
  changed_at timestamptz not null default timezone('utc', now()),
  primary key (business_id, site_id, field_definition_id),
  foreign key (business_id, site_id)
    references public.site_states(business_id, id) on delete cascade,
  foreign key (business_id, field_definition_id)
    references public.field_definitions(business_id, id) on delete cascade
);

create index if not exists site_public_object_availability_lookup_idx
  on public.site_public_object_availability (business_id, site_id, status);
create index if not exists site_public_field_availability_lookup_idx
  on public.site_public_field_availability (business_id, site_id, status);

alter table public.site_public_object_availability enable row level security;
alter table public.site_public_field_availability enable row level security;

drop policy if exists "Owners can read Site object availability"
  on public.site_public_object_availability;
create policy "Owners can read Site object availability"
  on public.site_public_object_availability for select to authenticated
  using (private.can_manage_tenant(business_id));
drop policy if exists "Owners can read Site field availability"
  on public.site_public_field_availability;
create policy "Owners can read Site field availability"
  on public.site_public_field_availability for select to authenticated
  using (private.can_manage_tenant(business_id));

revoke all on table public.site_public_object_availability,
  public.site_public_field_availability from public, anon, authenticated;
grant select on table public.site_public_object_availability,
  public.site_public_field_availability to authenticated;
grant select, insert, update, delete on table public.site_public_object_availability,
  public.site_public_field_availability to service_role;

create or replace function private.site_public_object_available_v2(
  target_business_id uuid,
  target_site_id uuid,
  target_release_revision bigint,
  target_object_definition_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.object_definitions as object_value
    where object_value.business_id = target_business_id
      and object_value.id = target_object_definition_id
      and object_value.is_active
  ) and not exists (
    select 1 from public.site_public_object_availability as availability
    where availability.business_id = target_business_id
      and availability.site_id = target_site_id
      and availability.object_definition_id = target_object_definition_id
      and (
        availability.status <> 'available'
        or availability.available_from_release_revision > target_release_revision
      )
  );
$$;

create or replace function private.site_public_field_available_v2(
  target_business_id uuid,
  target_site_id uuid,
  target_release_revision bigint,
  target_field_definition_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.field_definitions as field_value
    where field_value.business_id = target_business_id
      and field_value.id = target_field_definition_id
      and field_value.is_active
  ) and not exists (
    select 1 from public.site_public_field_availability as availability
    where availability.business_id = target_business_id
      and availability.site_id = target_site_id
      and availability.field_definition_id = target_field_definition_id
      and (
        availability.status <> 'available'
        or availability.available_from_release_revision > target_release_revision
      )
  );
$$;

create or replace function private.site_assert_object_source_v2(
  target_business_id uuid,
  target_site_id uuid,
  target_object_definition_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.site_states as state
    where state.business_id = target_business_id and state.id = target_site_id
      and (
        exists (
          select 1
          from private.site_draft_blocks_v1(state.draft_json) as block_value
          where block_value.block ->> 'type' = 'collection'
            and block_value.block ->> 'object_key' = (
              select object_value.key from public.object_definitions as object_value
              where object_value.business_id = target_business_id
                and object_value.id = target_object_definition_id
            )
        )
        or exists (
          select 1 from public.site_release_collection_references as reference
          where reference.business_id = target_business_id
            and reference.release_id = state.active_release_id
            and reference.object_definition_id = target_object_definition_id
        )
      )
  ) then
    raise exception 'site_object_not_referenced' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function private.site_assert_field_source_v2(
  target_business_id uuid,
  target_site_id uuid,
  target_field_definition_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.site_states as state
    where state.business_id = target_business_id and state.id = target_site_id
      and (
        exists (
          select 1
          from private.site_draft_blocks_v1(state.draft_json) as block_value
          where block_value.block ->> 'type' = 'collection'
            and exists (
              select 1 from jsonb_array_elements(block_value.block -> 'public_field_keys') as field_key
              where field_key #>> '{}' = (
                select field_value.key from public.field_definitions as field_value
                where field_value.business_id = target_business_id
                  and field_value.id = target_field_definition_id
              )
            )
        )
        or exists (
          select 1 from public.site_release_collection_references as reference
          where reference.business_id = target_business_id
            and reference.release_id = state.active_release_id
            and reference.field_definition_id = target_field_definition_id
        )
      )
  ) then
    raise exception 'site_field_not_referenced' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function private.site_change_object_availability_v2(
  expected_business_id uuid,
  expected_actor_id uuid,
  requested_site_id uuid,
  requested_object_definition_id uuid,
  requested_status text,
  expected_active_release_revision bigint,
  expected_availability_revision bigint
)
returns public.site_public_object_availability
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_head public.business_configuration_heads;
  state_value public.site_states;
  current_value public.site_public_object_availability;
  result public.site_public_object_availability;
begin
  perform private.site_assert_actor_v1(expected_business_id, expected_actor_id);
  if requested_status not in ('available', 'withdrawn')
    or expected_active_release_revision is null
    or expected_availability_revision is null
    or expected_availability_revision < 0
  then raise exception 'site_request_invalid' using errcode = '22023'; end if;
  select * into current_head from public.business_configuration_heads
  where business_id = expected_business_id for update;
  if not found then raise exception 'configuration_head_not_found' using errcode = 'P0002'; end if;
  select * into state_value from public.site_states
  where business_id = expected_business_id and id = requested_site_id for update;
  if not found then raise exception 'site_not_found' using errcode = 'P0002'; end if;
  if state_value.active_release_revision <> expected_active_release_revision then
    raise exception 'site_release_stale' using errcode = 'P0001';
  end if;
  perform private.site_assert_object_source_v2(
    expected_business_id, requested_site_id, requested_object_definition_id
  );
  select * into current_value from public.site_public_object_availability
  where business_id = expected_business_id and site_id = requested_site_id
    and object_definition_id = requested_object_definition_id for update;
  if found and current_value.availability_revision <> expected_availability_revision then
    raise exception 'site_availability_stale' using errcode = 'P0001';
  end if;
  if found and current_value.status = requested_status then return current_value; end if;
  if not found and expected_availability_revision <> 0 then
    raise exception 'site_availability_stale' using errcode = 'P0001';
  end if;
  if found then
    update public.site_public_object_availability set
      status = requested_status,
      availability_revision = current_value.availability_revision + 1,
      available_from_release_revision = case when requested_status = 'available'
        then state_value.active_release_revision + 1 else 0 end,
      changed_by = expected_actor_id,
      changed_at = timezone('utc', now())
    where business_id = expected_business_id and site_id = requested_site_id
      and object_definition_id = requested_object_definition_id
    returning * into result;
  else
    insert into public.site_public_object_availability (
      business_id, site_id, object_definition_id, status,
      available_from_release_revision, changed_by
    ) values (
      expected_business_id, requested_site_id, requested_object_definition_id,
      requested_status,
      case when requested_status = 'available' then state_value.active_release_revision + 1 else 0 end,
      expected_actor_id
    ) returning * into result;
  end if;
  return result;
end;
$$;

create or replace function private.site_change_field_availability_v2(
  expected_business_id uuid,
  expected_actor_id uuid,
  requested_site_id uuid,
  requested_field_definition_id uuid,
  requested_status text,
  expected_active_release_revision bigint,
  expected_availability_revision bigint
)
returns public.site_public_field_availability
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_head public.business_configuration_heads;
  state_value public.site_states;
  current_value public.site_public_field_availability;
  result public.site_public_field_availability;
begin
  perform private.site_assert_actor_v1(expected_business_id, expected_actor_id);
  if requested_status not in ('available', 'withdrawn')
    or expected_active_release_revision is null
    or expected_availability_revision is null
    or expected_availability_revision < 0
  then raise exception 'site_request_invalid' using errcode = '22023'; end if;
  select * into current_head from public.business_configuration_heads
  where business_id = expected_business_id for update;
  if not found then raise exception 'configuration_head_not_found' using errcode = 'P0002'; end if;
  select * into state_value from public.site_states
  where business_id = expected_business_id and id = requested_site_id for update;
  if not found then raise exception 'site_not_found' using errcode = 'P0002'; end if;
  if state_value.active_release_revision <> expected_active_release_revision then
    raise exception 'site_release_stale' using errcode = 'P0001';
  end if;
  perform private.site_assert_field_source_v2(
    expected_business_id, requested_site_id, requested_field_definition_id
  );
  select * into current_value from public.site_public_field_availability
  where business_id = expected_business_id and site_id = requested_site_id
    and field_definition_id = requested_field_definition_id for update;
  if found and current_value.availability_revision <> expected_availability_revision then
    raise exception 'site_availability_stale' using errcode = 'P0001';
  end if;
  if found and current_value.status = requested_status then return current_value; end if;
  if not found and expected_availability_revision <> 0 then
    raise exception 'site_availability_stale' using errcode = 'P0001';
  end if;
  if found then
    update public.site_public_field_availability set
      status = requested_status,
      availability_revision = current_value.availability_revision + 1,
      available_from_release_revision = case when requested_status = 'available'
        then state_value.active_release_revision + 1 else 0 end,
      changed_by = expected_actor_id,
      changed_at = timezone('utc', now())
    where business_id = expected_business_id and site_id = requested_site_id
      and field_definition_id = requested_field_definition_id
    returning * into result;
  else
    insert into public.site_public_field_availability (
      business_id, site_id, field_definition_id, status,
      available_from_release_revision, changed_by
    ) values (
      expected_business_id, requested_site_id, requested_field_definition_id,
      requested_status,
      case when requested_status = 'available' then state_value.active_release_revision + 1 else 0 end,
      expected_actor_id
    ) returning * into result;
  end if;
  return result;
end;
$$;

create or replace function public.withdraw_site_object(
  expected_business_id uuid, expected_actor_id uuid, requested_site_id uuid,
  requested_object_definition_id uuid, expected_active_release_revision bigint,
  expected_availability_revision bigint
)
returns public.site_public_object_availability
language sql security definer set search_path = ''
as $$
  select private.site_change_object_availability_v2(
    expected_business_id, expected_actor_id, requested_site_id,
    requested_object_definition_id, 'withdrawn', expected_active_release_revision,
    expected_availability_revision
  );
$$;

create or replace function public.reenable_site_object(
  expected_business_id uuid, expected_actor_id uuid, requested_site_id uuid,
  requested_object_definition_id uuid, expected_active_release_revision bigint,
  expected_availability_revision bigint
)
returns public.site_public_object_availability
language sql security definer set search_path = ''
as $$
  select private.site_change_object_availability_v2(
    expected_business_id, expected_actor_id, requested_site_id,
    requested_object_definition_id, 'available', expected_active_release_revision,
    expected_availability_revision
  );
$$;

create or replace function public.withdraw_site_field(
  expected_business_id uuid, expected_actor_id uuid, requested_site_id uuid,
  requested_field_definition_id uuid, expected_active_release_revision bigint,
  expected_availability_revision bigint
)
returns public.site_public_field_availability
language sql security definer set search_path = ''
as $$
  select private.site_change_field_availability_v2(
    expected_business_id, expected_actor_id, requested_site_id,
    requested_field_definition_id, 'withdrawn', expected_active_release_revision,
    expected_availability_revision
  );
$$;

create or replace function public.reenable_site_field(
  expected_business_id uuid, expected_actor_id uuid, requested_site_id uuid,
  requested_field_definition_id uuid, expected_active_release_revision bigint,
  expected_availability_revision bigint
)
returns public.site_public_field_availability
language sql security definer set search_path = ''
as $$
  select private.site_change_field_availability_v2(
    expected_business_id, expected_actor_id, requested_site_id,
    requested_field_definition_id, 'available', expected_active_release_revision,
    expected_availability_revision
  );
$$;

revoke all on function public.withdraw_site_object(uuid, uuid, uuid, uuid, bigint, bigint),
  public.reenable_site_object(uuid, uuid, uuid, uuid, bigint, bigint),
  public.withdraw_site_field(uuid, uuid, uuid, uuid, bigint, bigint),
  public.reenable_site_field(uuid, uuid, uuid, uuid, bigint, bigint)
  from public, anon, service_role;
grant execute on function public.withdraw_site_object(uuid, uuid, uuid, uuid, bigint, bigint),
  public.reenable_site_object(uuid, uuid, uuid, uuid, bigint, bigint),
  public.withdraw_site_field(uuid, uuid, uuid, uuid, bigint, bigint),
  public.reenable_site_field(uuid, uuid, uuid, uuid, bigint, bigint)
  to authenticated;

-- Operational Record/Object/Field deactivation is a separate source authority
-- from the explicit Site withdrawal RPCs. A source transition withdraws every
-- referenced Site immediately. Re-activation preserves withdrawal and moves
-- the availability epoch beyond the current release, so an old release can
-- never become visible again without an explicit reviewed Site re-enable and a
-- fresh publication.
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
  site_value record;
  actor_id uuid;
begin
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

  for site_value in
    select state.id, state.active_release_revision, state.created_by,
      state.draft_json
    from public.site_states as state
    where state.business_id = target_business_id
      and (
        (source_kind = 'record' and (
          exists (
            select 1 from public.site_release_record_references as reference
            where reference.business_id = target_business_id
              and reference.record_id = source_id
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
                where selected_record.record_id = source_id
              )
          )
          or exists (
            select 1 from public.site_record_media_attachments as attachment
            where attachment.business_id = target_business_id
              and attachment.site_id = state.id
              and attachment.record_id = source_id
          )
        ))
        or (source_kind = 'object' and (
          exists (
            select 1 from public.site_release_collection_references as reference
            where reference.business_id = target_business_id
              and reference.object_definition_id = source_id
          )
          or exists (
            select 1
            from private.site_draft_blocks_v1(state.draft_json) as block_value
            where block_value.block ->> 'type' = 'collection'
              and block_value.block ->> 'object_key' = (
                select definition.key
                from public.object_definitions as definition
                where definition.business_id = target_business_id
                  and definition.id = source_id
              )
          )
        ))
        or (source_kind = 'field' and (
          exists (
            select 1 from public.site_release_collection_references as reference
            where reference.business_id = target_business_id
              and reference.field_definition_id = source_id
          )
          or exists (
            select 1
            from private.site_draft_blocks_v1(state.draft_json) as block_value
            where block_value.block ->> 'type' = 'collection'
              and exists (
                select 1
                from jsonb_array_elements(block_value.block -> 'public_field_keys') as field_key
                where field_key #>> '{}' = (
                  select definition.key
                  from public.field_definitions as definition
                  where definition.business_id = target_business_id
                    and definition.id = source_id
                )
              )
          )
        ))
      )
  loop
    actor_id := coalesce(auth.uid(), site_value.created_by);
    if source_kind = 'record' then
      insert into public.site_public_record_availability (
        business_id, site_id, record_id, status,
        available_from_release_revision, changed_by
      ) values (
        target_business_id, site_value.id, source_id,
        case when is_active then 'available' else 'withdrawn' end,
        case when is_active then site_value.active_release_revision + 1 else 0 end,
        actor_id
      ) on conflict (business_id, site_id, record_id) do update set
        status = case when not is_active then 'withdrawn'
          else site_public_record_availability.status end,
        availability_revision = site_public_record_availability.availability_revision + 1,
        available_from_release_revision = case when is_active
          then greatest(
            site_public_record_availability.available_from_release_revision,
            excluded.available_from_release_revision
          ) else 0 end,
        changed_by = excluded.changed_by,
        changed_at = timezone('utc', now());
    elsif source_kind = 'object' then
      insert into public.site_public_object_availability (
        business_id, site_id, object_definition_id, status,
        available_from_release_revision, changed_by
      ) values (
        target_business_id, site_value.id, source_id,
        case when is_active then 'available' else 'withdrawn' end,
        case when is_active then site_value.active_release_revision + 1 else 0 end,
        actor_id
      ) on conflict (business_id, site_id, object_definition_id) do update set
        status = case when not is_active then 'withdrawn'
          else site_public_object_availability.status end,
        availability_revision = site_public_object_availability.availability_revision + 1,
        available_from_release_revision = case when is_active
          then greatest(
            site_public_object_availability.available_from_release_revision,
            excluded.available_from_release_revision
          ) else 0 end,
        changed_by = excluded.changed_by,
        changed_at = timezone('utc', now());
    else
      insert into public.site_public_field_availability (
        business_id, site_id, field_definition_id, status,
        available_from_release_revision, changed_by
      ) values (
        target_business_id, site_value.id, source_id,
        case when is_active then 'available' else 'withdrawn' end,
        case when is_active then site_value.active_release_revision + 1 else 0 end,
        actor_id
      ) on conflict (business_id, site_id, field_definition_id) do update set
        status = case when not is_active then 'withdrawn'
          else site_public_field_availability.status end,
        availability_revision = site_public_field_availability.availability_revision + 1,
        available_from_release_revision = case when is_active
          then greatest(
            site_public_field_availability.available_from_release_revision,
            excluded.available_from_release_revision
          ) else 0 end,
        changed_by = excluded.changed_by,
        changed_at = timezone('utc', now());
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists records_site_source_transition_v2 on public.records;
create trigger records_site_source_transition_v2
after update of record_status on public.records
for each row execute function private.site_mark_source_transition_v2();
drop trigger if exists objects_site_source_transition_v2 on public.object_definitions;
create trigger objects_site_source_transition_v2
after update of is_active on public.object_definitions
for each row execute function private.site_mark_source_transition_v2();
drop trigger if exists fields_site_source_transition_v2 on public.field_definitions;
create trigger fields_site_source_transition_v2
after update of is_active on public.field_definitions
for each row execute function private.site_mark_source_transition_v2();

create or replace function private.site_public_media_available_v2(
  target_business_id uuid,
  target_site_id uuid,
  target_release_revision bigint,
  target_token text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_token ~ '^m_[0-9a-f]{64}$'
  and exists (
    select 1
    from public.site_public_media_tokens as token
    join public.media_assets as asset
      on asset.business_id = token.business_id and asset.id = token.asset_id
      and asset.cleanup_claim_token is null
    where token.business_id = target_business_id
      and token.site_id = target_site_id
      and token.token = target_token
  )
  and not exists (
    select 1
    from public.site_public_media_tokens as token
    join public.site_public_media_availability as availability
      on availability.business_id = token.business_id
      and availability.site_id = token.site_id
      and availability.asset_id = token.asset_id
    where token.business_id = target_business_id
      and token.site_id = target_site_id
      and token.token = target_token
      and (
        availability.status <> 'available'
        or availability.available_from_release_revision > target_release_revision
      )
  )
  and not exists (
    select 1
    from public.site_record_media_attachments as attachment
    where attachment.business_id = target_business_id
      and attachment.site_id = target_site_id
      and attachment.asset_id = (
        select token.asset_id
        from public.site_public_media_tokens as token
        where token.business_id = target_business_id
          and token.site_id = target_site_id
          and token.token = target_token
      )
      and (
        not private.site_public_record_available_v2(
          target_business_id, target_site_id, target_release_revision,
          attachment.record_id
        )
        or not private.site_public_object_available_v2(
          target_business_id, target_site_id, target_release_revision,
          attachment.object_definition_id
        )
        or not private.site_public_field_available_v2(
          target_business_id, target_site_id, target_release_revision,
          attachment.field_definition_id
        )
      )
  );
$$;

-- Public delivery resolves the immutable v2 projection only through current
-- source authority. The release row remains untouched when an Owner withdraws
-- a Record/Object/Field/asset; the epoch checks below hide it immediately and
-- only a fresh release can make a re-enabled source visible again.
create or replace function private.site_public_filter_media_value_v2(
  target_business_id uuid,
  target_site_id uuid,
  target_release_revision bigint,
  value jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  child jsonb;
  filtered jsonb;
  result jsonb := '[]'::jsonb;
  key_value text;
begin
  if value is null or jsonb_typeof(value) in ('null', 'number', 'boolean') then
    return value;
  end if;
  if jsonb_typeof(value) = 'string' then
    if value #>> '{}' ~ '^m_[0-9a-f]{64}$'
      and not private.site_public_media_available_v2(
        target_business_id, target_site_id, target_release_revision, value #>> '{}'
      ) then
      return null;
    end if;
    return value;
  end if;
  if jsonb_typeof(value) = 'object' then
    if value ? 'token' and value ->> 'token' ~ '^m_[0-9a-f]{64}$' then
      if not private.site_public_media_available_v2(
        target_business_id, target_site_id, target_release_revision, value ->> 'token'
      ) then
        return null;
      end if;
      return value;
    end if;
    -- C2 values are scalar or token arrays. Preserve no arbitrary object
    -- supplied by a Record, even if one is added to the graph later.
    return null;
  end if;
  for child in select value from jsonb_array_elements(value) loop
    filtered := private.site_public_filter_media_value_v2(
      target_business_id, target_site_id, target_release_revision, child
    );
    if filtered is not null or jsonb_typeof(child) = 'null' then
      result := result || jsonb_build_array(filtered);
    end if;
  end loop;
  return result;
end;
$$;

create or replace function private.site_public_filter_record_values_v2(
  target_business_id uuid,
  target_site_id uuid,
  target_release_id uuid,
  target_release_revision bigint,
  target_public_key text,
  values_value jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  item record;
  field_id uuid;
  filtered jsonb;
  result jsonb := '{}'::jsonb;
begin
  for item in select key, value from jsonb_each(values_value) loop
    select reference.field_definition_id into field_id
    from public.site_release_collection_references as reference
    join public.field_definitions as field_value
      on field_value.business_id = reference.business_id
      and field_value.id = reference.field_definition_id
      and field_value.key = item.key
    where reference.business_id = target_business_id
      and reference.release_id = target_release_id
      and reference.public_key = target_public_key
    order by reference.field_definition_id
    limit 1;
    if field_id is null or not private.site_public_field_available_v2(
      target_business_id, target_site_id, target_release_revision, field_id
    ) then
      continue;
    end if;
    filtered := private.site_public_filter_media_value_v2(
      target_business_id, target_site_id, target_release_revision, item.value
    );
    if filtered is not null or jsonb_typeof(item.value) = 'null' then
      result := result || jsonb_build_object(item.key, filtered);
    end if;
  end loop;
  return result;
end;
$$;

create or replace function private.site_public_delivery_block_v2(
  target_business_id uuid,
  target_site_id uuid,
  target_release_id uuid,
  target_release_revision bigint,
  block jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  child jsonb;
  projected jsonb;
  projected_children jsonb := '[]'::jsonb;
  projected_columns jsonb := '[]'::jsonb;
  record_value jsonb;
  public_records jsonb := '[]'::jsonb;
  record_id_value uuid;
  object_id_value uuid;
  record_values jsonb;
  public_key_value text;
begin
  if block ->> 'type' = 'image' then
    if not private.site_public_media_available_v2(
      target_business_id, target_site_id, target_release_revision,
      block ->> 'media_token'
    ) then return null; end if;
    return block;
  elsif block ->> 'type' = 'gallery' then
    for record_value in select value from jsonb_array_elements(block -> 'images') loop
      if private.site_public_media_available_v2(
        target_business_id, target_site_id, target_release_revision,
        record_value ->> 'media_token'
      ) then
        projected_children := projected_children || jsonb_build_array(record_value);
      end if;
    end loop;
    if jsonb_array_length(projected_children) = 0 then return null; end if;
    return (block - 'images') || jsonb_build_object('images', projected_children);
  elsif block ->> 'type' = 'collection' then
    public_key_value := block ->> 'public_key';
    select reference.object_definition_id into object_id_value
    from public.site_release_collection_references as reference
    where reference.business_id = target_business_id
      and reference.release_id = target_release_id
      and reference.public_key = public_key_value
    order by reference.object_definition_id
    limit 1;
    if object_id_value is null or not private.site_public_object_available_v2(
      target_business_id, target_site_id, target_release_revision, object_id_value
    ) then
      return null;
    end if;
    for record_value in select value from jsonb_array_elements(block -> 'records') loop
      select token.record_id into record_id_value
      from public.site_public_record_tokens as token
      where token.business_id = target_business_id
        and token.site_id = target_site_id
        and token.token = record_value ->> 'public_id';
      if record_id_value is not null and private.site_public_record_available_v2(
        target_business_id, target_site_id, target_release_revision, record_id_value
      ) then
        record_values := private.site_public_filter_record_values_v2(
          target_business_id, target_site_id, target_release_id,
          target_release_revision, public_key_value, record_value -> 'values'
        );
        public_records := public_records || jsonb_build_array(
          record_value - 'values' || jsonb_build_object('values', record_values)
        );
      end if;
    end loop;
    return (block - 'records') || jsonb_build_object('records', public_records);
  elsif block ->> 'type' = 'collapsible' then
    for child in select value from jsonb_array_elements(block -> 'blocks') loop
      projected := private.site_public_delivery_block_v2(
        target_business_id, target_site_id, target_release_id,
        target_release_revision, child
      );
      if projected is not null then
        projected_children := projected_children || jsonb_build_array(projected);
      end if;
    end loop;
    return (block - 'blocks') || jsonb_build_object('blocks', projected_children);
  elsif block ->> 'type' = 'section' then
    for child in select value from jsonb_array_elements(block -> 'columns') loop
      projected_children := '[]'::jsonb;
      for record_value in select value from jsonb_array_elements(child -> 'blocks') loop
        projected := private.site_public_delivery_block_v2(
          target_business_id, target_site_id, target_release_id,
          target_release_revision, record_value
        );
        if projected is not null then
          projected_children := projected_children || jsonb_build_array(projected);
        end if;
      end loop;
      projected_columns := projected_columns || jsonb_build_array(
        jsonb_build_object('blocks', projected_children)
      );
    end loop;
    return (block - 'columns') || jsonb_build_object('columns', projected_columns);
  end if;
  return block;
end;
$$;

create or replace function private.site_layout_has_collection_public_key_v2(
  layout_value jsonb,
  requested_collection_public_key text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  node jsonb;
  column_value jsonb;
begin
  if jsonb_typeof(layout_value) <> 'object' then return false; end if;
  for node in select value from jsonb_array_elements(coalesce(layout_value -> 'blocks', '[]'::jsonb)) loop
    if node ->> 'type' = 'record_detail'
      and node ->> 'collection_public_key' = requested_collection_public_key
    then return true; end if;
    if private.site_layout_has_collection_public_key_v2(node, requested_collection_public_key)
    then return true; end if;
  end loop;
  for column_value in select value from jsonb_array_elements(coalesce(layout_value -> 'columns', '[]'::jsonb)) loop
    if private.site_layout_has_collection_public_key_v2(column_value, requested_collection_public_key)
    then return true; end if;
  end loop;
  return false;
end;
$$;

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
    and release.status = 'published' and release.projection_schema_version = 2
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

revoke all on function public.resolve_public_site_page(text, text),
  public.resolve_public_site_record(text, text, text),
  public.resolve_public_page(text, text)
  from public;
grant execute on function public.resolve_public_site_page(text, text),
  public.resolve_public_site_record(text, text, text),
  public.resolve_public_page(text, text)
  to anon, authenticated;

-- Legacy public actions stay available for unadopted Businesses and fail
-- closed at both resolver and submit RPC boundaries once Site owns authority.
alter function public.resolve_public_form(text, text, text)
  rename to resolve_public_form_legacy_v1;
create function public.resolve_public_form(
  requested_business_slug text,
  requested_page_slug text,
  requested_form_key text
)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when not private.site_lock_legacy_authority_v2(requested_business_slug)
    then null::jsonb
    else public.resolve_public_form_legacy_v1(
      requested_business_slug, requested_page_slug, requested_form_key
    )
  end;
$$;

alter function public.submit_public_create_form(text, text, text, uuid, jsonb, text)
  rename to submit_public_create_form_legacy_v1;
create function public.submit_public_create_form(
  requested_business_slug text,
  requested_page_slug text,
  requested_form_key text,
  requested_idempotency_token uuid,
  requested_data jsonb,
  requested_request_hash text
)
returns jsonb
language sql volatile security definer set search_path = ''
as $$
  select case when not private.site_lock_legacy_authority_v2(requested_business_slug)
    then jsonb_build_object('ok', false, 'code', 'legacy_public_actions_retired')
    else public.submit_public_create_form_legacy_v1(
      requested_business_slug, requested_page_slug, requested_form_key,
      requested_idempotency_token, requested_data, requested_request_hash
    )
  end;
$$;

alter function public.resolve_public_booking(text, text, text)
  rename to resolve_public_booking_legacy_v1;
create function public.resolve_public_booking(
  requested_business_slug text,
  requested_page_slug text,
  requested_booking_key text
)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when not private.site_lock_legacy_authority_v2(requested_business_slug)
    then null::jsonb
    else public.resolve_public_booking_legacy_v1(
      requested_business_slug, requested_page_slug, requested_booking_key
    )
  end;
$$;

alter function public.submit_public_booking(text, text, text, uuid, jsonb, text)
  rename to submit_public_booking_legacy_v1;
create function public.submit_public_booking(
  requested_business_slug text,
  requested_page_slug text,
  requested_booking_key text,
  requested_idempotency_token uuid,
  requested_submission jsonb,
  requested_request_hash text
)
returns jsonb
language sql volatile security definer set search_path = ''
as $$
  select case when not private.site_lock_legacy_authority_v2(requested_business_slug)
    then jsonb_build_object('ok', false, 'code', 'legacy_public_actions_retired')
    else public.submit_public_booking_legacy_v1(
      requested_business_slug, requested_page_slug, requested_booking_key,
      requested_idempotency_token, requested_submission, requested_request_hash
    )
  end;
$$;

alter function public.resolve_public_preorder(text, text, text)
  rename to resolve_public_preorder_legacy_v1;
create function public.resolve_public_preorder(
  requested_business_slug text,
  requested_page_slug text,
  requested_preorder_key text
)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when not private.site_lock_legacy_authority_v2(requested_business_slug)
    then null::jsonb
    else public.resolve_public_preorder_legacy_v1(
      requested_business_slug, requested_page_slug, requested_preorder_key
    )
  end;
$$;

alter function public.submit_public_preorder(text, text, text, jsonb, text)
  rename to submit_public_preorder_legacy_v1;
create function public.submit_public_preorder(
  requested_business_slug text,
  requested_page_slug text,
  requested_preorder_key text,
  submission jsonb,
  requested_request_hash text
)
returns jsonb
language sql volatile security definer set search_path = ''
as $$
  select case when not private.site_lock_legacy_authority_v2(requested_business_slug)
    then jsonb_build_object('ok', false, 'code', 'legacy_public_actions_retired')
    else public.submit_public_preorder_legacy_v1(
      requested_business_slug, requested_page_slug, requested_preorder_key,
      submission, requested_request_hash
    )
  end;
$$;

revoke all on function public.resolve_public_form(text, text, text),
  public.submit_public_create_form(text, text, text, uuid, jsonb, text),
  public.resolve_public_booking(text, text, text),
  public.submit_public_booking(text, text, text, uuid, jsonb, text),
  public.resolve_public_preorder(text, text, text),
  public.submit_public_preorder(text, text, text, jsonb, text)
  from public;
grant execute on function public.resolve_public_form(text, text, text),
  public.submit_public_create_form(text, text, text, uuid, jsonb, text),
  public.resolve_public_booking(text, text, text),
  public.submit_public_booking(text, text, text, uuid, jsonb, text),
  public.resolve_public_preorder(text, text, text),
  public.submit_public_preorder(text, text, text, jsonb, text)
  to anon, authenticated, service_role;

-- Keep the C1 RPC names available for pre-adoption compatibility, while an
-- adopted Site cannot be changed through an old release or direct Page alias.
-- The trusted v2 publisher sets the transaction-local marker only after its
-- head/state locks and currentness checks.
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
    if legacy_count > 0 then new.migration_state := 'legacy_pending'; end if;
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
      if old.migration_state = 'legacy_pending' then
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

drop trigger if exists site_states_authority_transition_v2 on public.site_states;
create trigger site_states_authority_transition_v2
before insert or update on public.site_states
for each row execute function private.site_guard_authority_transition_v2();

-- Legacy publication can happen after a C1 Site row was created. Capture that
-- transition at the Page authority boundary while the Site is still new. The
-- state trigger above covers the inverse ordering (Site creation after a
-- legacy Page already exists); this trigger closes the other ordering without
-- relying on a later release attempt to mutate state and then roll it back.
create or replace function private.site_mark_legacy_page_public_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_site_id uuid;
begin
  if new.audience = 'public'
    and new.status = 'published'
    and new.is_active
  then
    select state.id into selected_site_id
    from public.site_states as state
    where state.business_id = new.business_id
      and state.migration_state = 'new'
    for update;
    if selected_site_id is not null then
      perform private.site_mark_legacy_pending_v2(
        new.business_id, selected_site_id
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists site_mark_legacy_page_public_v2 on public.pages;
create trigger site_mark_legacy_page_public_v2
after insert or update on public.pages
for each row execute function private.site_mark_legacy_page_public_v2();

-- Backfill the same state for a C1 Site that already had a legacy Page before
-- this migration installed the Page trigger. This is the only deployment-time
-- state repair and records the exact source fingerprint used by adoption.
update public.site_states as state
set migration_state = 'legacy_pending',
  legacy_source_checksum = private.site_legacy_source_fingerprint_v2(state.business_id),
  legacy_source_page_count = (
    select count(*)
    from public.pages as page_value
    where page_value.business_id = state.business_id
      and page_value.audience = 'public'
      and page_value.status = 'published'
      and page_value.is_active
  ),
  updated_at = timezone('utc', now())
where state.migration_state = 'new'
  and exists (
    select 1
    from public.pages as page_value
    where page_value.business_id = state.business_id
      and page_value.audience = 'public'
      and page_value.status = 'published'
      and page_value.is_active
  );

revoke all on function public.apply_configuration_change_c1_v1(uuid, uuid, uuid),
  public.resolve_public_page_legacy_v1(text, text),
  public.resolve_public_form_legacy_v1(text, text, text),
  public.submit_public_create_form_legacy_v1(text, text, text, uuid, jsonb, text),
  public.resolve_public_booking_legacy_v1(text, text, text),
  public.submit_public_booking_legacy_v1(text, text, text, uuid, jsonb, text),
  public.resolve_public_preorder_legacy_v1(text, text, text),
  public.submit_public_preorder_legacy_v1(text, text, text, jsonb, text)
  from public, anon, authenticated, service_role;

grant execute on function public.stage_site_adoption(uuid, uuid, uuid, bigint, uuid, bigint),
  public.prepare_site_release_v2(uuid, uuid, uuid, bigint, uuid, bigint),
  public.publish_site_release_v2(uuid, uuid, uuid, uuid, bigint, uuid, bigint)
  to authenticated;
revoke all on function public.stage_site_adoption(uuid, uuid, uuid, bigint, uuid, bigint),
  public.prepare_site_release_v2(uuid, uuid, uuid, bigint, uuid, bigint),
  public.publish_site_release_v2(uuid, uuid, uuid, uuid, bigint, uuid, bigint)
  from public, anon, service_role;

do $$
begin
  if to_regprocedure('public.unpublish_site(uuid,uuid,uuid,bigint)') is not null then
    execute 'revoke all on function public.unpublish_site(uuid, uuid, uuid, bigint) from public, anon, service_role';
  end if;
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

revoke all on function public.unpublish_site(uuid, uuid, uuid, bigint)
  from public, anon, service_role;
grant execute on function public.unpublish_site(uuid, uuid, uuid, bigint)
  to authenticated;

-- Record attachments are retained source references. Extend both cleanup
-- claim/recheck paths so a managed asset cannot be deleted while a Record
-- attachment still points at it.
create or replace function public.claim_site_media_asset_for_cleanup(
  expected_business_id uuid,
  requested_asset_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claim_token uuid := gen_random_uuid();
  selected_asset public.media_assets;
begin
  if auth.role() <> 'service_role' then
    raise exception 'site_cleanup_service_required' using errcode = '42501';
  end if;
  select * into selected_asset from public.media_assets
  where business_id = expected_business_id and id = requested_asset_id for update;
  if not found then return null; end if;
  if selected_asset.cleanup_claim_token is not null then return null; end if;
  if exists (
    select 1 from public.site_draft_asset_references
    where business_id = expected_business_id and asset_id = requested_asset_id
  ) or exists (
    select 1 from public.site_release_asset_references
    where business_id = expected_business_id and asset_id = requested_asset_id
  ) or exists (
    select 1 from public.site_record_media_attachments
    where business_id = expected_business_id and asset_id = requested_asset_id
  ) or exists (
    select 1
    from public.records as record_value
    join public.field_definitions as field_value
      on field_value.business_id = record_value.business_id
      and field_value.object_definition_id = record_value.object_definition_id
      and field_value.field_type = 'file'
    where record_value.business_id = expected_business_id
      and jsonb_typeof(record_value.data_json -> field_value.key) = 'object'
      and (record_value.data_json -> field_value.key) ? 'asset_id'
      and (record_value.data_json -> field_value.key ->> 'asset_id') = requested_asset_id::text
  ) or exists (
    select 1
    from public.configuration_versions as version_value
    cross join lateral jsonb_array_elements(version_value.snapshot_json -> 'pages') as page_value(value)
    cross join lateral private.page_blocks_v2(page_value.value -> 'layout_json') as block_value(value)
    where version_value.business_id = expected_business_id
      and (
        (block_value.value ->> 'type' = 'image'
          and block_value.value ->> 'asset_id' = requested_asset_id::text)
        or (block_value.value ->> 'type' = 'gallery' and exists (
          select 1 from jsonb_array_elements(block_value.value -> 'images') as image_value(value)
          where image_value.value ->> 'asset_id' = requested_asset_id::text
        ))
      )
  ) then return null; end if;
  update public.media_assets set
    cleanup_claim_token = claim_token,
    cleanup_claimed_at = timezone('utc', now())
  where business_id = expected_business_id and id = requested_asset_id;
  return claim_token;
end;
$$;

create or replace function public.finalize_site_media_cleanup(
  expected_business_id uuid,
  requested_asset_id uuid,
  requested_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_asset public.media_assets;
begin
  if auth.role() <> 'service_role' then
    raise exception 'site_cleanup_service_required' using errcode = '42501';
  end if;
  select * into selected_asset from public.media_assets
  where business_id = expected_business_id and id = requested_asset_id
    and cleanup_claim_token = requested_claim_token for update;
  if not found then return false; end if;
  if exists (
    select 1 from public.site_draft_asset_references
    where business_id = expected_business_id and asset_id = requested_asset_id
  ) or exists (
    select 1 from public.site_release_asset_references
    where business_id = expected_business_id and asset_id = requested_asset_id
  ) or exists (
    select 1 from public.site_record_media_attachments
    where business_id = expected_business_id and asset_id = requested_asset_id
  ) or exists (
    select 1
    from public.records as record_value
    join public.field_definitions as field_value
      on field_value.business_id = record_value.business_id
      and field_value.object_definition_id = record_value.object_definition_id
      and field_value.field_type = 'file'
    where record_value.business_id = expected_business_id
      and jsonb_typeof(record_value.data_json -> field_value.key) = 'object'
      and (record_value.data_json -> field_value.key) ? 'asset_id'
      and (record_value.data_json -> field_value.key ->> 'asset_id') = requested_asset_id::text
  ) or exists (
    select 1
    from public.configuration_versions as version_value
    cross join lateral jsonb_array_elements(version_value.snapshot_json -> 'pages') as page_value(value)
    cross join lateral private.page_blocks_v2(page_value.value -> 'layout_json') as block_value(value)
    where version_value.business_id = expected_business_id
      and (
        (block_value.value ->> 'type' = 'image'
          and block_value.value ->> 'asset_id' = requested_asset_id::text)
        or (block_value.value ->> 'type' = 'gallery' and exists (
          select 1 from jsonb_array_elements(block_value.value -> 'images') as image_value(value)
          where image_value.value ->> 'asset_id' = requested_asset_id::text
        ))
      )
  ) then return false; end if;
  delete from public.media_assets
  where business_id = expected_business_id and id = requested_asset_id
    and cleanup_claim_token = requested_claim_token;
  return found;
end;
$$;

revoke all on function public.claim_site_media_asset_for_cleanup(uuid, uuid),
  public.finalize_site_media_cleanup(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_site_media_asset_for_cleanup(uuid, uuid),
  public.finalize_site_media_cleanup(uuid, uuid, uuid) to service_role;

-- The public media route receives only an opaque token. This resolver is kept
-- service-role-only because its result contains the private storage key; the
-- anonymous Site projection never carries that metadata.
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
    and release.projection_schema_version = 2
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
