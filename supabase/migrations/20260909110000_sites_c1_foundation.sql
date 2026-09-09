-- Lenni Sites C1: durable, revisioned Site drafts and private release
-- coordination. This is deliberately additive: it neither changes the current
-- public Page reader nor adopts a legacy public Page. C2 will activate a
-- release reader only after compatibility rehearsal.

alter table public.media_assets
  add column if not exists cleanup_claim_token uuid,
  add column if not exists cleanup_claimed_at timestamptz;

create table public.site_states (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  draft_schema_version smallint not null default 1 check (draft_schema_version = 1),
  draft_json jsonb not null,
  draft_revision bigint not null default 1 check (draft_revision > 0),
  draft_base_version_id uuid not null,
  draft_base_head_revision bigint not null check (draft_base_head_revision > 0),
  active_release_id uuid,
  active_release_revision bigint not null default 0 check (active_release_revision >= 0),
  migration_state text not null default 'new' check (migration_state in ('new', 'legacy_pending')),
  created_by uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (business_id),
  unique (business_id, id)
);

create table public.site_page_bindings (
  business_id uuid not null,
  site_id uuid not null,
  draft_page_id uuid not null,
  canonical_page_key text not null,
  canonical_page_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (business_id, site_id, draft_page_id),
  unique (business_id, canonical_page_key),
  unique (business_id, site_id, canonical_page_id),
  foreign key (business_id, site_id)
    references public.site_states(business_id, id) on delete cascade
);

create table public.site_releases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  site_id uuid not null,
  status text not null check (status in ('prepared', 'published', 'invalidated', 'expired')),
  source_draft_revision bigint not null check (source_draft_revision > 0),
  source_base_version_id uuid not null,
  source_head_revision bigint not null check (source_head_revision > 0),
  expected_active_release_revision bigint not null check (expected_active_release_revision >= 0),
  configuration_change_set_id uuid,
  applied_version_id uuid,
  projection_schema_version smallint not null default 1 check (projection_schema_version = 1),
  projection_json jsonb not null,
  review_json jsonb not null,
  projection_checksum text not null check (projection_checksum ~ '^[0-9a-f]{64}$'),
  prepared_by uuid not null,
  prepared_at timestamptz not null default timezone('utc', now()),
  published_by uuid,
  published_at timestamptz,
  unique (business_id, id),
  foreign key (business_id, site_id)
    references public.site_states(business_id, id) on delete cascade
);

alter table public.site_states
  add constraint site_states_active_release_fkey
  foreign key (business_id, active_release_id)
  references public.site_releases(business_id, id)
  deferrable initially immediate;

create table public.site_draft_asset_references (
  business_id uuid not null,
  site_id uuid not null,
  asset_id uuid not null,
  draft_revision bigint not null check (draft_revision > 0),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (business_id, site_id, asset_id),
  foreign key (business_id, site_id)
    references public.site_states(business_id, id) on delete cascade,
  foreign key (business_id, asset_id)
    references public.media_assets(business_id, id) on delete restrict
);

create table public.site_release_asset_references (
  business_id uuid not null,
  release_id uuid not null,
  asset_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (business_id, release_id, asset_id),
  foreign key (business_id, release_id)
    references public.site_releases(business_id, id) on delete cascade,
  foreign key (business_id, asset_id)
    references public.media_assets(business_id, id) on delete restrict
);

create index site_releases_active_lookup_idx
  on public.site_releases (business_id, site_id, status, prepared_at desc);

create index site_draft_asset_references_asset_idx
  on public.site_draft_asset_references (business_id, asset_id);

create index site_release_asset_references_asset_idx
  on public.site_release_asset_references (business_id, asset_id);

create or replace function private.site_json_has_only_keys_v1(
  value jsonb,
  allowed_keys text[]
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(value) = 'object'
    and not exists (
      select 1 from jsonb_object_keys(value) as key_value
      where key_value <> all(allowed_keys)
    ),
    false
  );
$$;

create or replace function private.site_valid_string_v1(value jsonb, maximum_length integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(value) = 'string'
    and char_length(btrim(value #>> '{}')) between 1 and maximum_length,
    false
  );
$$;

create or replace function private.site_valid_uuid_v1(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(value) = 'string'
    and private.configuration_uuid_is_valid(value #>> '{}'),
    false
  );
$$;

create or replace function private.site_valid_key_v1(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(value) = 'string'
    and private.experience_key_is_valid(value #>> '{}'),
    false
  );
$$;

create or replace function private.site_json_string_in_v1(value jsonb, allowed_values text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(value) = 'string'
    and (value #>> '{}') = any(allowed_values),
    false
  );
$$;

create or replace function private.site_page_key_v1(target_site_id uuid, target_draft_page_id uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select 's' || replace(target_site_id::text, '-', '') || '_p' || replace(target_draft_page_id::text, '-', '');
$$;

create or replace function private.site_page_slug_v1(target_site_id uuid, target_draft_page_id uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'site-' || replace(target_site_id::text, '-', '') || '-p-' || replace(target_draft_page_id::text, '-', '');
$$;

-- The legacy Page validator intentionally preserves its historical coercion
-- behavior. Site drafts are a new strict JSON boundary, so validate JSON
-- scalar types before reusing those canonical atoms. In particular, `->>`
-- would otherwise turn `42` into a valid-looking heading/text string.
create or replace function private.site_assert_rich_text_content_types_v1(content jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  span jsonb;
  mark jsonb;
begin
  if jsonb_typeof(content) is distinct from 'array' then
    raise exception 'site_draft_invalid' using errcode = '22023';
  end if;
  for span in select value from jsonb_array_elements(content) loop
    if jsonb_typeof(span) is distinct from 'object'
      or jsonb_typeof(span -> 'type') is distinct from 'string'
      or jsonb_typeof(span -> 'text') is distinct from 'string'
      or (span ? 'marks' and jsonb_typeof(span -> 'marks') is distinct from 'array')
    then
      raise exception 'site_draft_invalid' using errcode = '22023';
    end if;
    if span ? 'marks' then
      for mark in select value from jsonb_array_elements(span -> 'marks') loop
        if jsonb_typeof(mark) is distinct from 'object'
          or jsonb_typeof(mark -> 'type') is distinct from 'string'
          or (mark ->> 'type' = 'link' and jsonb_typeof(mark -> 'href') is distinct from 'string')
        then
          raise exception 'site_draft_invalid' using errcode = '22023';
        end if;
      end loop;
    end if;
  end loop;
end;
$$;

create or replace function private.site_assert_rich_text_types_v1(node jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
begin
  if jsonb_typeof(node) is distinct from 'object'
    or jsonb_typeof(node -> 'type') is distinct from 'string'
  then
    raise exception 'site_draft_invalid' using errcode = '22023';
  end if;
  if node ->> 'type' in ('paragraph', 'heading') then
    if node ->> 'type' = 'heading'
      and jsonb_typeof(node -> 'level') is distinct from 'number'
    then
      raise exception 'site_draft_invalid' using errcode = '22023';
    end if;
    perform private.site_assert_rich_text_content_types_v1(node -> 'content');
    return;
  end if;
  if node ->> 'type' in ('bullet_list', 'numbered_list') then
    if jsonb_typeof(node -> 'items') is distinct from 'array' then
      raise exception 'site_draft_invalid' using errcode = '22023';
    end if;
    for item in select value from jsonb_array_elements(node -> 'items') loop
      if jsonb_typeof(item) is distinct from 'object' then
        raise exception 'site_draft_invalid' using errcode = '22023';
      end if;
      perform private.site_assert_rich_text_content_types_v1(item -> 'content');
    end loop;
  end if;
end;
$$;

create or replace function private.site_assert_legacy_block_types_v1(block jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if jsonb_typeof(block -> 'type') is distinct from 'string' then
    raise exception 'site_draft_invalid' using errcode = '22023';
  end if;
  if block ->> 'type' = 'heading' then
    if jsonb_typeof(block -> 'text') is distinct from 'string'
      or (block ? 'level' and jsonb_typeof(block -> 'level') is distinct from 'number')
    then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
  elsif block ->> 'type' = 'text' then
    if jsonb_typeof(block -> 'text') is distinct from 'string'
    then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
  elsif block ->> 'type' = 'rich_text' then
    perform private.site_assert_rich_text_types_v1(block -> 'node');
  elsif block ->> 'type' = 'image' then
    if (block ? 'src' and jsonb_typeof(block -> 'src') is distinct from 'string')
      or (block ? 'asset_id' and jsonb_typeof(block -> 'asset_id') is distinct from 'string')
      or (block ? 'alt' and jsonb_typeof(block -> 'alt') is distinct from 'string')
      or (block ? 'caption' and jsonb_typeof(block -> 'caption') is distinct from 'string')
      or (block ? 'presentation' and jsonb_typeof(block -> 'presentation') is distinct from 'string')
    then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
  elsif block ->> 'type' = 'button' then
    if jsonb_typeof(block -> 'label') is distinct from 'string'
      or jsonb_typeof(block -> 'href') is distinct from 'string'
      or (block ? 'style' and jsonb_typeof(block -> 'style') is distinct from 'string')
    then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
  elsif block ->> 'type' = 'public_form' then
    if jsonb_typeof(block -> 'form_key') is distinct from 'string'
    then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
  elsif block ->> 'type' = 'preorder' then
    if jsonb_typeof(block -> 'preorder_key') is distinct from 'string'
    then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
  elsif block ->> 'type' = 'booking' then
    if jsonb_typeof(block -> 'booking_key') is distinct from 'string'
      or jsonb_typeof(block -> 'config') is distinct from 'object'
    then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
  elsif block ->> 'type' = 'callout' then
    if jsonb_typeof(block -> 'text') is distinct from 'string'
      or (block ? 'tone' and jsonb_typeof(block -> 'tone') is distinct from 'string')
    then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
  end if;
end;
$$;

create or replace function private.site_assert_block_v1(block jsonb, nesting integer default 0)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  child jsonb;
  column_value jsonb;
  image_value jsonb;
  field_value jsonb;
begin
  if coalesce((
    jsonb_typeof(block) is distinct from 'object'
    or not private.site_valid_uuid_v1(block -> 'id')
  ), true)
  then
    raise exception 'site_draft_invalid' using errcode = '22023';
  end if;

  if block ->> 'type' in ('heading', 'text', 'rich_text', 'image', 'button', 'public_form', 'booking', 'preorder', 'divider', 'callout') then
    perform private.site_assert_legacy_block_types_v1(block);
    perform private.assert_valid_page_block_v2(block, false);
    if block ->> 'type' = 'image' and block ? 'src' then
      raise exception 'site_draft_invalid' using errcode = '22023';
    end if;
    return;
  end if;

  if block ->> 'type' = 'collapsible' then
    if coalesce((nesting > 1
      or not (block ?& array['type', 'summary', 'blocks', 'id'])
      or not private.site_json_has_only_keys_v1(block, array['type', 'summary', 'blocks', 'open', 'id'])
      or not private.site_valid_string_v1(block -> 'summary', 200)
      or jsonb_typeof(block -> 'blocks') <> 'array'
      or jsonb_array_length(block -> 'blocks') > 50
      or (block ? 'open' and jsonb_typeof(block -> 'open') is distinct from 'boolean')
    ), true) then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
    for child in select value from jsonb_array_elements(block -> 'blocks') loop
      perform private.site_assert_block_v1(child, nesting + 1);
    end loop;
    return;
  end if;

  if block ->> 'type' = 'gallery' then
    if coalesce((not (block ?& array['type', 'images', 'id'])
      or not private.site_json_has_only_keys_v1(block, array['type', 'images', 'presentation', 'id'])
      or jsonb_typeof(block -> 'images') <> 'array'
      or jsonb_array_length(block -> 'images') not between 1 and 12
      or (block ? 'presentation' and not private.site_json_string_in_v1(block -> 'presentation', array['grid', 'carousel']))
    ), true) then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
    for image_value in select value from jsonb_array_elements(block -> 'images') loop
      if coalesce((not (image_value ?& array['asset_id', 'alt'])
        or not private.site_json_has_only_keys_v1(image_value, array['asset_id', 'alt', 'caption'])
        or not private.site_valid_uuid_v1(image_value -> 'asset_id')
        or not private.site_valid_string_v1(image_value -> 'alt', 300)
        or (image_value ? 'caption' and not private.site_valid_string_v1(image_value -> 'caption', 500))
      ), true) then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
    end loop;
    if exists (
      select 1
      from jsonb_array_elements(block -> 'images') as gallery_image(value)
      group by gallery_image.value ->> 'asset_id'
      having count(*) > 1
    ) then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
    return;
  end if;

  if block ->> 'type' in ('collection', 'record_detail') then
    if block ->> 'type' = 'collection' then
      if coalesce((not (block ?& array['type', 'object_key', 'selection', 'public_field_keys', 'presentation', 'id'])
        or not private.site_json_has_only_keys_v1(block, array['type', 'object_key', 'selection', 'public_field_keys', 'presentation', 'detail_page_id', 'id'])
        or not private.site_valid_key_v1(block -> 'object_key')
        or jsonb_typeof(block -> 'selection') is distinct from 'object'
        or not (block -> 'selection' ?& array['schema_version', 'record_ids'])
        or not private.site_json_has_only_keys_v1(block -> 'selection', array['schema_version', 'record_ids'])
        or jsonb_typeof(block -> 'selection' -> 'schema_version') is distinct from 'number'
        or (block -> 'selection' ->> 'schema_version') is distinct from '1'
        or jsonb_typeof(block -> 'selection' -> 'record_ids') is distinct from 'array'
        or jsonb_array_length(block -> 'selection' -> 'record_ids') > 500
        or jsonb_typeof(block -> 'public_field_keys') is distinct from 'array'
        or jsonb_array_length(block -> 'public_field_keys') not between 1 and 50
        or not private.site_json_string_in_v1(block -> 'presentation', array['cards', 'list', 'table'])
        or (block ? 'detail_page_id' and not private.site_valid_uuid_v1(block -> 'detail_page_id'))
      ), true) then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
      for field_value in select value from jsonb_array_elements(block -> 'selection' -> 'record_ids') loop
        if not private.site_valid_uuid_v1(field_value) then
          raise exception 'site_draft_invalid' using errcode = '22023';
        end if;
      end loop;
      if (select count(*) from jsonb_array_elements(block -> 'selection' -> 'record_ids') group by value having count(*) > 1) > 0 then
        raise exception 'site_draft_invalid' using errcode = '22023';
      end if;
    else
      if coalesce((not (block ?& array['type', 'collection_block_id', 'public_field_keys', 'id'])
        or not private.site_json_has_only_keys_v1(block, array['type', 'collection_block_id', 'public_field_keys', 'id'])
        or not private.site_valid_uuid_v1(block -> 'collection_block_id')
        or jsonb_typeof(block -> 'public_field_keys') is distinct from 'array'
        or jsonb_array_length(block -> 'public_field_keys') not between 1 and 50
      ), true) then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
    end if;
    for field_value in select value from jsonb_array_elements(block -> 'public_field_keys') loop
      if not private.site_valid_key_v1(field_value) then
        raise exception 'site_draft_invalid' using errcode = '22023';
      end if;
    end loop;
    if (select count(*) from jsonb_array_elements(block -> 'public_field_keys') group by value having count(*) > 1) > 0
    then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
    return;
  end if;

  if block ->> 'type' = 'section' then
    if coalesce((nesting > 0
      or not (block ?& array['type', 'columns', 'id'])
      or not private.site_json_has_only_keys_v1(block, array['type', 'width', 'columns', 'id'])
      or (block ? 'width' and not private.site_json_string_in_v1(block -> 'width', array['content', 'wide']))
      or jsonb_typeof(block -> 'columns') is distinct from 'array'
      or jsonb_array_length(block -> 'columns') not between 1 and 3
    ), true) then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
    for column_value in select value from jsonb_array_elements(block -> 'columns') loop
      if coalesce((not (column_value ? 'blocks')
        or not private.site_json_has_only_keys_v1(column_value, array['blocks'])
        or jsonb_typeof(column_value -> 'blocks') is distinct from 'array'
        or jsonb_array_length(column_value -> 'blocks') > 100
      ), true) then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
      for child in select value from jsonb_array_elements(column_value -> 'blocks') loop
        perform private.site_assert_block_v1(child, nesting + 1);
      end loop;
    end loop;
    return;
  end if;

  raise exception 'site_draft_invalid' using errcode = '22023';
end;
$$;

create or replace function private.site_block_count_v1(block jsonb)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  child jsonb;
  total integer := 1;
begin
  if block ->> 'type' = 'collapsible' then
    for child in select value from jsonb_array_elements(block -> 'blocks') loop
      total := total + private.site_block_count_v1(child);
    end loop;
  elsif block ->> 'type' = 'section' then
    for child in select block_value.value from jsonb_array_elements(block -> 'columns') as column_value,
      lateral jsonb_array_elements(column_value.value -> 'blocks') as block_value(value) loop
      total := total + private.site_block_count_v1(child);
    end loop;
  end if;
  return total;
end;
$$;

create or replace function private.site_block_ids_v1(block jsonb)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  child jsonb;
  result text[] := array[block ->> 'id'];
begin
  if block ->> 'type' = 'collapsible' then
    for child in select value from jsonb_array_elements(block -> 'blocks') loop
      result := result || private.site_block_ids_v1(child);
    end loop;
  elsif block ->> 'type' = 'section' then
    for child in select block_value.value from jsonb_array_elements(block -> 'columns') as column_value,
      lateral jsonb_array_elements(column_value.value -> 'blocks') as block_value(value) loop
      result := result || private.site_block_ids_v1(child);
    end loop;
  end if;
  return result;
end;
$$;

create or replace function private.assert_site_draft_v1(draft jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  page_value jsonb;
  block jsonb;
  page_ids text[] := array[]::text[];
  page_slugs text[] := array[]::text[];
  block_ids text[] := array[]::text[];
  home_count integer := 0;
  total_blocks integer;
begin
  if coalesce((jsonb_typeof(draft) is distinct from 'object'
    or not (draft ?& array['schema_version', 'branding', 'pages'])
    or not private.site_json_has_only_keys_v1(draft, array['schema_version', 'branding', 'pages'])
    or jsonb_typeof(draft -> 'schema_version') is distinct from 'number'
    or (draft ->> 'schema_version') is distinct from '1'
    or jsonb_typeof(draft -> 'branding') is distinct from 'object'
    or not (draft -> 'branding' ?& array['name', 'accent'])
    or not private.site_json_has_only_keys_v1(draft -> 'branding', array['name', 'accent', 'logo_asset_id'])
    or not private.site_valid_string_v1(draft -> 'branding' -> 'name', 120)
    or not private.site_json_string_in_v1(draft -> 'branding' -> 'accent', array['coral', 'clay', 'forest', 'ocean', 'plum'])
    or (draft -> 'branding' ? 'logo_asset_id' and not private.site_valid_uuid_v1(draft -> 'branding' -> 'logo_asset_id'))
    or jsonb_typeof(draft -> 'pages') is distinct from 'array'
    or jsonb_array_length(draft -> 'pages') not between 1 and 20
  ), true) then raise exception 'site_draft_invalid' using errcode = '22023'; end if;

  for page_value in select value from jsonb_array_elements(draft -> 'pages') loop
    if coalesce((not (page_value ?& array['id', 'title', 'slug', 'navigation_label', 'is_home', 'is_in_navigation', 'is_included', 'layout'])
      or not private.site_json_has_only_keys_v1(page_value, array['id', 'title', 'slug', 'navigation_label', 'is_home', 'is_in_navigation', 'is_included', 'layout'])
      or not private.site_valid_uuid_v1(page_value -> 'id')
      or not private.site_valid_string_v1(page_value -> 'title', 120)
      or not private.site_valid_string_v1(page_value -> 'navigation_label', 80)
      or not private.site_valid_string_v1(page_value -> 'slug', 80)
      or coalesce((page_value ->> 'slug') !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$', true)
      or char_length(page_value ->> 'slug') > 80
      or jsonb_typeof(page_value -> 'is_home') is distinct from 'boolean'
      or jsonb_typeof(page_value -> 'is_in_navigation') is distinct from 'boolean'
      or jsonb_typeof(page_value -> 'is_included') is distinct from 'boolean'
      or jsonb_typeof(page_value -> 'layout') is distinct from 'object'
      or not private.site_json_has_only_keys_v1(page_value -> 'layout', array['blocks'])
      or jsonb_typeof(page_value -> 'layout' -> 'blocks') is distinct from 'array'
      or jsonb_array_length(page_value -> 'layout' -> 'blocks') > 100
    ), true) then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
    if (page_value ->> 'is_home')::boolean then home_count := home_count + 1; end if;
    if (page_value ->> 'is_home')::boolean and not (page_value ->> 'is_included')::boolean then
      raise exception 'site_draft_invalid' using errcode = '22023';
    end if;
    if (page_value ->> 'is_in_navigation')::boolean and not (page_value ->> 'is_included')::boolean then
      raise exception 'site_draft_invalid' using errcode = '22023';
    end if;
    page_ids := array_append(page_ids, page_value ->> 'id');
    page_slugs := array_append(page_slugs, page_value ->> 'slug');
    total_blocks := 0;
    for block in select value from jsonb_array_elements(page_value -> 'layout' -> 'blocks') loop
      perform private.site_assert_block_v1(block);
      total_blocks := total_blocks + private.site_block_count_v1(block);
      block_ids := block_ids || private.site_block_ids_v1(block);
    end loop;
    if total_blocks > 100 then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
  end loop;
  if home_count <> 1
    or cardinality(page_ids) <> cardinality(array(select distinct value from unnest(page_ids) as value))
    or cardinality(page_slugs) <> cardinality(array(select distinct value from unnest(page_slugs) as value))
    or cardinality(block_ids) <> cardinality(array(select distinct value from unnest(block_ids) as value))
  then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
  if octet_length(convert_to(draft::text, 'UTF8')) > 262144 then
    raise exception 'site_draft_too_large' using errcode = '22023';
  end if;
  perform private.site_assert_detail_bindings_v1(draft);
end;
$$;

create or replace function private.site_draft_blocks_v1(draft jsonb)
returns table (page_id uuid, block jsonb)
language sql
immutable
set search_path = ''
as $$
  with recursive nodes(page_id, block) as (
    select (page_value.value ->> 'id')::uuid, block_value.value
    from jsonb_array_elements(draft -> 'pages') as page_value(value)
    cross join lateral jsonb_array_elements(page_value.value -> 'layout' -> 'blocks') as block_value(value)
    union all
    select nodes.page_id, child.value
    from nodes
    cross join lateral (
      select value from jsonb_array_elements(nodes.block -> 'blocks')
      where nodes.block ->> 'type' = 'collapsible'
      union all
      select child_value.value
      from jsonb_array_elements(nodes.block -> 'columns') as column_value(value)
      cross join lateral jsonb_array_elements(column_value.value -> 'blocks') as child_value(value)
      where nodes.block ->> 'type' = 'section'
    ) as child(value)
  )
  select page_id, block from nodes;
$$;

create or replace function private.site_assert_detail_bindings_v1(draft jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  detail_value record;
  collection_value jsonb;
  collection_page_id uuid;
  field_value text;
  selected_ids text[] := array[]::text[];
begin
  for detail_value in
    select page_id, block from private.site_draft_blocks_v1(draft)
    where block ->> 'type' = 'record_detail'
  loop
    select page_id, block into collection_page_id, collection_value
    from private.site_draft_blocks_v1(draft)
    where block ->> 'type' = 'collection'
      and block ->> 'id' = detail_value.block ->> 'collection_block_id';
    if collection_value is null
      or (collection_value ? 'detail_page_id' and (collection_value ->> 'detail_page_id')::uuid <> detail_value.page_id)
      or not (collection_value ? 'detail_page_id')
    then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
    for field_value in select value #>> '{}' from jsonb_array_elements(detail_value.block -> 'public_field_keys') loop
      if not exists (
        select 1 from jsonb_array_elements(collection_value -> 'public_field_keys') as collection_field(value)
        where collection_field.value #>> '{}' = field_value
      ) then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
    end loop;
  end loop;
  if exists (
    select 1
    from private.site_draft_blocks_v1(draft) as collection_block
    where collection_block.block ->> 'type' = 'collection'
      and collection_block.block ? 'detail_page_id'
      and 1 <> (
        select count(*)
        from private.site_draft_blocks_v1(draft) as detail_block
        where detail_block.block ->> 'type' = 'record_detail'
          and detail_block.block ->> 'collection_block_id' = collection_block.block ->> 'id'
          and detail_block.page_id = (collection_block.block ->> 'detail_page_id')::uuid
      )
  ) then
    raise exception 'site_draft_invalid' using errcode = '22023';
  end if;
  select coalesce(array_agg(record_value #>> '{}'), array[]::text[])
    into selected_ids
  from private.site_draft_blocks_v1(draft) as site_block
  cross join lateral jsonb_array_elements(site_block.block -> 'selection' -> 'record_ids') as record_value
  where site_block.block ->> 'type' = 'collection';
  if cardinality(array(select distinct value from unnest(selected_ids) as value)) > 500 then
    raise exception 'site_draft_invalid' using errcode = '22023';
  end if;
end;
$$;

create or replace function private.site_block_asset_ids_v1(block jsonb)
returns setof uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  child jsonb;
  image_value jsonb;
begin
  if block ->> 'type' = 'image' and block ? 'asset_id' then
    return next (block ->> 'asset_id')::uuid;
  elsif block ->> 'type' = 'gallery' then
    for image_value in select value from jsonb_array_elements(block -> 'images') loop
      return next (image_value ->> 'asset_id')::uuid;
    end loop;
  elsif block ->> 'type' = 'collapsible' then
    for child in select value from jsonb_array_elements(block -> 'blocks') loop
      return query select * from private.site_block_asset_ids_v1(child);
    end loop;
  elsif block ->> 'type' = 'section' then
    for child in select block_value.value from jsonb_array_elements(block -> 'columns') as column_value,
      lateral jsonb_array_elements(column_value.value -> 'blocks') as block_value(value) loop
      return query select * from private.site_block_asset_ids_v1(child);
    end loop;
  end if;
end;
$$;

create or replace function private.site_draft_asset_ids_v1(draft jsonb)
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
  for page_value in select value from jsonb_array_elements(draft -> 'pages') loop
    for block in select value from jsonb_array_elements(page_value -> 'layout' -> 'blocks') loop
      return query select * from private.site_block_asset_ids_v1(block);
    end loop;
  end loop;
end;
$$;

create or replace function private.site_assert_assets_available_v1(
  target_business_id uuid,
  draft jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  asset_value uuid;
begin
  for asset_value in
    select distinct id_value from private.site_draft_asset_ids_v1(draft) as id_value order by id_value
  loop
    perform 1 from public.media_assets
    where business_id = target_business_id and id = asset_value and cleanup_claim_token is null
    for share;
    if not found then raise exception 'site_asset_unavailable' using errcode = '23514'; end if;
  end loop;
end;
$$;

-- Lock every explicit selection in a deterministic order before any block is
-- projected. Later per-collection reads therefore see one stable set of
-- selected Record values: a concurrent Record update either wins before this
-- lock phase or waits until the candidate has frozen all values.
create or replace function private.site_lock_selected_records_v1(
  target_business_id uuid,
  draft jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform 1
  from public.records as record_value
  where record_value.business_id = target_business_id
    and record_value.id in (
      select distinct (record_id.value #>> '{}')::uuid
      from private.site_draft_blocks_v1(draft) as site_block
      cross join lateral jsonb_array_elements(site_block.block -> 'selection' -> 'record_ids') as record_id(value)
      where site_block.block ->> 'type' = 'collection'
    )
  order by record_value.id
  for share;
end;
$$;

create or replace function private.site_assert_collection_references_v1(
  target_business_id uuid,
  block jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  object_id uuid;
  selected_ids uuid[];
  field_keys text[];
  selected_count integer;
  field_count integer;
  records_projection jsonb;
begin
  if block ->> 'type' <> 'collection' then return block; end if;
  select id into object_id from public.object_definitions
  where business_id = target_business_id and key = block ->> 'object_key' and is_active;
  if not found then raise exception 'site_collection_invalid' using errcode = '23514'; end if;
  select coalesce(array_agg((value #>> '{}')::uuid order by ordinality), array[]::uuid[])
  into selected_ids
  from jsonb_array_elements(block -> 'selection' -> 'record_ids') with ordinality;
  select array_agg(value #>> '{}' order by ordinality)
  into field_keys
  from jsonb_array_elements(block -> 'public_field_keys') with ordinality;
  select count(*) into field_count from public.field_definitions
  where business_id = target_business_id and object_definition_id = object_id
    and is_active and key = any(field_keys);
  if field_count <> cardinality(field_keys) then
    raise exception 'site_collection_invalid' using errcode = '23514';
  end if;
  select count(*) into selected_count from public.records
  where business_id = target_business_id and object_definition_id = object_id
    and record_status = 'active' and id = any(selected_ids);
  if selected_count <> cardinality(selected_ids) then
    raise exception 'site_collection_invalid' using errcode = '23514';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', record_value.id,
    'values', coalesce((select jsonb_object_agg(field_key, record_value.data_json -> field_key)
      from unnest(field_keys) as field_key), '{}'::jsonb)
  ) order by selected.position), '[]'::jsonb)
  into records_projection
  from unnest(selected_ids) with ordinality as selected(id, position)
  join public.records as record_value
    on record_value.business_id = target_business_id and record_value.id = selected.id
    and record_value.object_definition_id = object_id and record_value.record_status = 'active';
  return block || jsonb_build_object('records', records_projection);
end;
$$;

create or replace function private.site_project_block_v1(target_business_id uuid, block jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  projected_children jsonb;
  projected_columns jsonb;
begin
  if block ->> 'type' = 'collection' then
    return private.site_assert_collection_references_v1(target_business_id, block);
  elsif block ->> 'type' = 'collapsible' then
    select coalesce(jsonb_agg(private.site_project_block_v1(target_business_id, value) order by ordinality), '[]'::jsonb)
      into projected_children from jsonb_array_elements(block -> 'blocks') with ordinality;
    return (block - 'blocks') || jsonb_build_object('blocks', projected_children);
  elsif block ->> 'type' = 'section' then
    select coalesce(jsonb_agg(
      jsonb_build_object('blocks', (
        select coalesce(jsonb_agg(private.site_project_block_v1(target_business_id, child.value) order by child.ordinality), '[]'::jsonb)
        from jsonb_array_elements(column_value.value -> 'blocks') with ordinality as child(value, ordinality)
      )) order by column_value.ordinality), '[]'::jsonb)
    into projected_columns
    from jsonb_array_elements(block -> 'columns') with ordinality as column_value(value, ordinality);
    return (block - 'columns') || jsonb_build_object('columns', projected_columns);
  end if;
  return block;
end;
$$;

create or replace function private.build_site_projection_v1(target_business_id uuid, draft jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  page_value jsonb;
  projected_pages jsonb := '[]'::jsonb;
  projected_blocks jsonb;
begin
  for page_value in select value from jsonb_array_elements(draft -> 'pages') loop
    if not (page_value ->> 'is_included')::boolean then
      continue;
    end if;
    select coalesce(jsonb_agg(private.site_project_block_v1(target_business_id, value) order by ordinality), '[]'::jsonb)
      into projected_blocks from jsonb_array_elements(page_value -> 'layout' -> 'blocks') with ordinality;
    projected_pages := projected_pages || jsonb_build_array(
      (page_value - 'layout') || jsonb_build_object('layout', jsonb_build_object('blocks', projected_blocks))
    );
  end loop;
  return jsonb_build_object(
    'schema_version', 1,
    'branding', draft -> 'branding',
    'pages', projected_pages
  );
end;
$$;

create or replace function private.build_site_review_metadata_v1(draft jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'included_page_ids', coalesce((
      select jsonb_agg(value ->> 'id' order by ordinality)
      from jsonb_array_elements(draft -> 'pages') with ordinality
      where (value ->> 'is_included')::boolean
    ), '[]'::jsonb),
    'excluded_page_ids', coalesce((
      select jsonb_agg(value ->> 'id' order by ordinality)
      from jsonb_array_elements(draft -> 'pages') with ordinality
      where not (value ->> 'is_included')::boolean
    ), '[]'::jsonb)
  );
$$;

create or replace function private.site_derived_page_operations_v1(
  target_business_id uuid,
  target_site_id uuid,
  draft jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  page_value jsonb;
  target_key text;
  target_slug text;
  existing_page public.pages;
  binding public.site_page_bindings;
  existing_page_found boolean;
  binding_found boolean;
  result jsonb := '[]'::jsonb;
begin
  for page_value in select value from jsonb_array_elements(draft -> 'pages') loop
    target_key := private.site_page_key_v1(target_site_id, (page_value ->> 'id')::uuid);
    target_slug := private.site_page_slug_v1(target_site_id, (page_value ->> 'id')::uuid);
    select * into existing_page from public.pages
    where business_id = target_business_id and key = target_key for share;
    existing_page_found := found;
    select * into binding from public.site_page_bindings
    where business_id = target_business_id and site_id = target_site_id
      and draft_page_id = (page_value ->> 'id')::uuid;
    binding_found := found;
    if binding_found and (binding.canonical_page_key <> target_key
      or (binding.canonical_page_id is not null and binding.canonical_page_id <> existing_page.id)) then
      raise exception 'site_page_binding_invalid' using errcode = '23514';
    end if;
    if existing_page_found and (not binding_found
      or existing_page.audience <> 'public' or existing_page.status = 'published') then
      raise exception 'site_legacy_page_conflict' using errcode = '23514';
    end if;
    if not existing_page_found
      or existing_page.title <> page_value ->> 'title'
      or existing_page.slug <> target_slug
      or existing_page.audience <> 'public'
      or existing_page.status <> 'draft'
      or not existing_page.is_active
      or existing_page.layout_json <> page_value -> 'layout'
    then
      result := result || jsonb_build_array(jsonb_build_object(
        'op', 'set_page',
        'key', target_key,
        'title', page_value ->> 'title',
        'slug', target_slug,
        'audience', 'public',
        'layout_json', page_value -> 'layout',
        'status', 'draft',
        'is_active', true
      ));
    end if;
  end loop;
  return result;
end;
$$;

create or replace function private.site_sync_draft_asset_references_v1(
  target_business_id uuid,
  target_site_id uuid,
  target_revision bigint,
  draft jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  -- Keep both the prior and replacement claim sets share-locked across the
  -- delete/insert transition. A cleanup claim takes FOR UPDATE, so it cannot
  -- observe this Site temporarily detached from an asset and delete it before
  -- the replacement reference is committed.
  perform 1
  from public.media_assets
  where business_id = target_business_id
    and id in (
      select asset_id
      from public.site_draft_asset_references
      where business_id = target_business_id and site_id = target_site_id
      union
      select id_value
      from private.site_draft_asset_ids_v1(draft) as id_value
    )
  order by id
  for share;
  perform private.site_assert_assets_available_v1(target_business_id, draft);
  delete from public.site_draft_asset_references
  where business_id = target_business_id and site_id = target_site_id;
  insert into public.site_draft_asset_references (business_id, site_id, asset_id, draft_revision)
  select target_business_id, target_site_id, asset_id, target_revision
  from (select distinct id_value as asset_id from private.site_draft_asset_ids_v1(draft) as id_value) as assets;
end;
$$;

create or replace function private.site_assert_actor_v1(target_business_id uuid, expected_actor_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'configuration_authentication_required' using errcode = '42501'; end if;
  if auth.uid() is distinct from expected_actor_id then raise exception 'configuration_actor_context_mismatch' using errcode = '42501'; end if;
  if not private.can_manage_tenant(target_business_id) then raise exception 'configuration_owner_or_admin_required' using errcode = '42501'; end if;
end;
$$;

create or replace function public.create_site_draft(
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
  active_version public.configuration_versions;
  created_state public.site_states;
begin
  if expected_business_id is null or expected_actor_id is null then
    raise exception 'site_request_invalid' using errcode = '22023';
  end if;
  perform private.site_assert_actor_v1(expected_business_id, expected_actor_id);
  perform private.assert_site_draft_v1(requested_draft);
  select * into current_head from public.business_configuration_heads
  where business_id = expected_business_id for update;
  if not found then raise exception 'configuration_head_not_found' using errcode = 'P0002'; end if;
  insert into public.site_states (
    business_id, draft_json, draft_base_version_id, draft_base_head_revision, created_by
  ) values (
    expected_business_id, requested_draft, current_head.active_version_id, current_head.head_revision, expected_actor_id
  ) returning * into created_state;
  perform private.site_sync_draft_asset_references_v1(expected_business_id, created_state.id, 1, requested_draft);
  return created_state;
end;
$$;

create or replace function public.save_site_draft(
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
  active_version public.configuration_versions;
  selected_state public.site_states;
begin
  if expected_business_id is null or expected_actor_id is null
    or requested_site_id is null or expected_draft_revision is null
    or expected_draft_revision <= 0
  then raise exception 'site_request_invalid' using errcode = '22023'; end if;
  perform private.site_assert_actor_v1(expected_business_id, expected_actor_id);
  perform private.assert_site_draft_v1(requested_draft);
  select * into current_head from public.business_configuration_heads
  where business_id = expected_business_id for update;
  if not found then raise exception 'configuration_head_not_found' using errcode = 'P0002'; end if;
  select * into selected_state from public.site_states
  where business_id = expected_business_id and id = requested_site_id for update;
  if not found then raise exception 'site_not_found' using errcode = 'P0002'; end if;
  if selected_state.draft_revision <> expected_draft_revision then
    raise exception 'site_draft_stale' using errcode = '40001';
  end if;
  if selected_state.draft_base_version_id <> current_head.active_version_id
    or selected_state.draft_base_head_revision <> current_head.head_revision
  then
    raise exception 'site_configuration_rebase_required' using errcode = '40001';
  end if;
  update public.site_states set
    draft_json = requested_draft,
    draft_revision = selected_state.draft_revision + 1,
    draft_base_version_id = current_head.active_version_id,
    draft_base_head_revision = current_head.head_revision,
    updated_at = timezone('utc', now())
  where business_id = expected_business_id and id = requested_site_id
  returning * into selected_state;
  perform private.site_sync_draft_asset_references_v1(expected_business_id, requested_site_id, selected_state.draft_revision, requested_draft);
  return selected_state;
end;
$$;

create or replace function public.prepare_site_release(
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
  prepared_release public.site_releases;
  derived_operations jsonb;
  proposed_change public.configuration_change_sets;
  validated_change public.configuration_change_sets;
  projection jsonb;
  review_metadata jsonb;
  checksum text;
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
  if current_head.active_version_id <> expected_base_version_id or current_head.head_revision <> expected_head_revision then
    raise exception 'site_configuration_stale' using errcode = '40001';
  end if;
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
    raise exception 'site_draft_stale' using errcode = '40001';
  end if;
  if selected_state.draft_base_version_id <> current_head.active_version_id
    or selected_state.draft_base_head_revision <> current_head.head_revision
  then
    raise exception 'site_configuration_rebase_required' using errcode = '40001';
  end if;
  perform private.assert_site_draft_v1(selected_state.draft_json);
  perform private.site_assert_assets_available_v1(expected_business_id, selected_state.draft_json);
  perform private.site_lock_selected_records_v1(expected_business_id, selected_state.draft_json);
  derived_operations := private.site_derived_page_operations_v1(expected_business_id, requested_site_id, selected_state.draft_json);
  projection := private.build_site_projection_v1(expected_business_id, selected_state.draft_json);
  review_metadata := private.build_site_review_metadata_v1(selected_state.draft_json);
  if octet_length(convert_to(projection::text, 'UTF8')) > 524288 then
    raise exception 'site_projection_too_large' using errcode = '22023';
  end if;
  checksum := encode(extensions.digest(convert_to(projection::text, 'UTF8'), 'sha256'), 'hex');
  select * into existing_release from public.site_releases
  where business_id = expected_business_id and site_id = requested_site_id
    and status = 'prepared' and source_draft_revision = selected_state.draft_revision
    and source_base_version_id = current_head.active_version_id
    and source_head_revision = current_head.head_revision
    and expected_active_release_revision = selected_state.active_release_revision
    and projection_checksum = checksum
  order by prepared_at desc limit 1 for share;
  if found then return existing_release; end if;
  if jsonb_array_length(derived_operations) > 0 then
    proposed_change := public.propose_configuration_change(
      expected_business_id, expected_actor_id, current_head.active_version_id, current_head.head_revision,
      'Prepare Site pages', 'Server-derived private Site Page definitions.', derived_operations
    );
    validated_change := public.validate_configuration_change(expected_business_id, expected_actor_id, proposed_change.id);
    if validated_change.status <> 'validated' or validated_change.validation_result_json ->> 'outcome' <> 'valid' then
      raise exception 'site_configuration_incompatible' using errcode = '23514';
    end if;
  end if;
  insert into public.site_releases (
    business_id, site_id, status, source_draft_revision, source_base_version_id, source_head_revision,
    expected_active_release_revision, configuration_change_set_id, projection_json, review_json, projection_checksum, prepared_by
  ) values (
    expected_business_id, requested_site_id, 'prepared', selected_state.draft_revision,
    current_head.active_version_id, current_head.head_revision, selected_state.active_release_revision,
    validated_change.id, projection, review_metadata, checksum, expected_actor_id
  ) returning * into prepared_release;
  insert into public.site_release_asset_references (business_id, release_id, asset_id)
  select expected_business_id, prepared_release.id, asset_id
  from public.site_draft_asset_references
  where business_id = expected_business_id and site_id = requested_site_id;
  return prepared_release;
end;
$$;

create or replace function private.site_bind_canonical_pages_v1(
  target_business_id uuid,
  target_site_id uuid,
  draft jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  page_value jsonb;
  page_id uuid;
  target_key text;
  canonical_id uuid;
begin
  for page_value in select value from jsonb_array_elements(draft -> 'pages') loop
    page_id := (page_value ->> 'id')::uuid;
    target_key := private.site_page_key_v1(target_site_id, page_id);
    select id into canonical_id from public.pages
    where business_id = target_business_id and key = target_key
      and slug = private.site_page_slug_v1(target_site_id, page_id)
      and audience = 'public' and status = 'draft' and is_active
    for share;
    if not found then raise exception 'site_page_binding_invalid' using errcode = '23514'; end if;
    insert into public.site_page_bindings (business_id, site_id, draft_page_id, canonical_page_key, canonical_page_id)
    values (target_business_id, target_site_id, page_id, target_key, canonical_id)
    on conflict (business_id, site_id, draft_page_id) do update set
      canonical_page_key = excluded.canonical_page_key,
      canonical_page_id = excluded.canonical_page_id,
      updated_at = timezone('utc', now());
  end loop;
end;
$$;

create or replace function public.publish_site_release(
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
  active_version public.configuration_versions;
  selected_change public.configuration_change_sets;
  selected_state public.site_states;
  selected_release public.site_releases;
  applied_change public.configuration_change_sets;
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
  where business_id = expected_business_id and site_id = requested_site_id and id = requested_candidate_id for update;
  if not found then raise exception 'site_release_not_found' using errcode = 'P0002'; end if;
  -- A lost response is replayed before any stale comparison. It reports this
  -- release's original success but never moves a newer active pointer back.
  if selected_release.status = 'published' then return selected_release; end if;
  if selected_release.status <> 'prepared' then raise exception 'site_release_not_publishable' using errcode = '55000'; end if;
  if selected_release.configuration_change_set_id is not null then
    select * into selected_change from public.configuration_change_sets
    where business_id = expected_business_id and id = selected_release.configuration_change_set_id for update;
    if not found or selected_change.status <> 'validated'
      or selected_change.base_version_id <> selected_release.source_base_version_id
      or selected_change.base_head_revision <> selected_release.source_head_revision
    then raise exception 'site_configuration_incompatible' using errcode = '23514'; end if;
  end if;
  select * into selected_state from public.site_states
  where business_id = expected_business_id and id = requested_site_id for update;
  if not found then raise exception 'site_not_found' using errcode = 'P0002'; end if;
  if selected_state.draft_revision <> expected_draft_revision
    or selected_release.source_draft_revision <> expected_draft_revision
  then raise exception 'site_draft_stale' using errcode = '40001'; end if;
  if current_head.active_version_id <> expected_base_version_id
    or current_head.head_revision <> expected_head_revision
    or selected_release.source_base_version_id <> expected_base_version_id
    or selected_release.source_head_revision <> expected_head_revision
  then raise exception 'site_configuration_stale' using errcode = '40001'; end if;
  select * into active_version from public.configuration_versions
  where business_id = expected_business_id and id = current_head.active_version_id;
  if not found then raise exception 'configuration_active_version_not_found' using errcode = 'P0002'; end if;
  perform private.assert_configuration_projection_matches_v1(
    expected_business_id, active_version.snapshot_json, active_version.snapshot_checksum
  );
  if selected_state.active_release_revision <> selected_release.expected_active_release_revision then
    raise exception 'site_release_stale' using errcode = '40001'; end if;
  if selected_release.configuration_change_set_id is not null then
    applied_change := public.apply_configuration_change(expected_business_id, expected_actor_id, selected_release.configuration_change_set_id);
    if applied_change.status <> 'applied' then raise exception 'site_configuration_incompatible' using errcode = '23514'; end if;
    selected_release.applied_version_id := applied_change.applied_version_id;
    select * into current_head from public.business_configuration_heads
    where business_id = expected_business_id;
  end if;
  perform private.site_bind_canonical_pages_v1(expected_business_id, requested_site_id, selected_state.draft_json);
  update public.site_releases set status = 'published', applied_version_id = selected_release.applied_version_id,
    published_by = expected_actor_id, published_at = timezone('utc', now())
  where business_id = expected_business_id and id = requested_candidate_id
  returning * into selected_release;
  update public.site_states set active_release_id = selected_release.id,
    active_release_revision = active_release_revision + 1,
    draft_base_version_id = current_head.active_version_id,
    draft_base_head_revision = current_head.head_revision,
    updated_at = timezone('utc', now())
  where business_id = expected_business_id and id = requested_site_id;
  return selected_release;
end;
$$;

create or replace function private.enforce_site_release_immutability_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.business_id <> old.business_id or new.site_id <> old.site_id
    or new.source_draft_revision <> old.source_draft_revision
    or new.source_base_version_id <> old.source_base_version_id
    or new.source_head_revision <> old.source_head_revision
    or new.expected_active_release_revision <> old.expected_active_release_revision
    or new.configuration_change_set_id is distinct from old.configuration_change_set_id
    or new.projection_schema_version <> old.projection_schema_version
    or new.projection_json <> old.projection_json
    or new.review_json <> old.review_json
    or new.projection_checksum <> old.projection_checksum
    or new.prepared_by <> old.prepared_by or new.prepared_at <> old.prepared_at
  then raise exception 'Site release content is immutable' using errcode = '55000'; end if;
  if old.status = 'prepared' and new.status = 'published' then return new; end if;
  if old.status = 'prepared' and new.status in ('invalidated', 'expired') then return new; end if;
  raise exception 'Site release transition is invalid' using errcode = '55000';
end;
$$;

create trigger site_releases_immutable
before update on public.site_releases
for each row execute function private.enforce_site_release_immutability_v1();

alter table public.site_states enable row level security;
alter table public.site_page_bindings enable row level security;
alter table public.site_releases enable row level security;
alter table public.site_draft_asset_references enable row level security;
alter table public.site_release_asset_references enable row level security;

create policy "Members can read Site state" on public.site_states for select to authenticated
using (private.is_business_member(business_id));
create policy "Members can read Site page bindings" on public.site_page_bindings for select to authenticated
using (private.is_business_member(business_id));
create policy "Owners can read private Site releases" on public.site_releases for select to authenticated
using (private.can_manage_tenant(business_id));
create policy "Owners can read Site draft media references" on public.site_draft_asset_references for select to authenticated
using (private.can_manage_tenant(business_id));
create policy "Owners can read Site release media references" on public.site_release_asset_references for select to authenticated
using (private.can_manage_tenant(business_id));

revoke all on table public.site_states, public.site_page_bindings, public.site_releases,
  public.site_draft_asset_references, public.site_release_asset_references from public, anon, authenticated;
grant select on public.site_states, public.site_page_bindings, public.site_releases,
  public.site_draft_asset_references, public.site_release_asset_references to authenticated;
revoke all on function public.create_site_draft(uuid, uuid, jsonb),
  public.save_site_draft(uuid, uuid, uuid, bigint, jsonb),
  public.prepare_site_release(uuid, uuid, uuid, bigint, uuid, bigint),
  public.publish_site_release(uuid, uuid, uuid, uuid, bigint, uuid, bigint)
  from public, anon, service_role;
grant execute on function public.create_site_draft(uuid, uuid, jsonb),
  public.save_site_draft(uuid, uuid, uuid, bigint, jsonb),
  public.prepare_site_release(uuid, uuid, uuid, bigint, uuid, bigint),
  public.publish_site_release(uuid, uuid, uuid, uuid, bigint, uuid, bigint)
  to authenticated;

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
  if auth.role() <> 'service_role' then raise exception 'site_cleanup_service_required' using errcode = '42501'; end if;
  select * into selected_asset from public.media_assets
  where business_id = expected_business_id and id = requested_asset_id for update;
  if not found then return null; end if;
  if exists (select 1 from public.site_draft_asset_references where business_id = expected_business_id and asset_id = requested_asset_id)
    or exists (select 1 from public.site_release_asset_references where business_id = expected_business_id and asset_id = requested_asset_id)
    or exists (
      select 1
      from public.configuration_versions as version_value
      cross join lateral jsonb_array_elements(version_value.snapshot_json -> 'pages') as page_value(value)
      cross join lateral private.page_blocks_v2(page_value.value -> 'layout_json') as block_value(value)
      where version_value.business_id = expected_business_id
        and (
          (block_value.value ->> 'type' = 'image' and block_value.value ->> 'asset_id' = requested_asset_id::text)
          or (block_value.value ->> 'type' = 'gallery' and exists (
            select 1 from jsonb_array_elements(block_value.value -> 'images') as image_value(value)
            where image_value.value ->> 'asset_id' = requested_asset_id::text
          ))
        )
    )
  then return null; end if;
  -- Storage deletion is an external side effect. Claims are exclusive: only
  -- the worker that received this token may retry remove/finalize. A later
  -- worker gets null and cannot race the same storage key. The claim is never
  -- expired automatically because a timeout can happen after byte removal.
  if selected_asset.cleanup_claim_token is not null then
    return null;
  end if;
  update public.media_assets set cleanup_claim_token = claim_token, cleanup_claimed_at = timezone('utc', now())
  where business_id = expected_business_id and id = requested_asset_id;
  return claim_token;
end;
$$;

create or replace function public.release_site_media_cleanup_claim(
  expected_business_id uuid,
  requested_asset_id uuid,
  requested_claim_token uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'site_cleanup_service_required' using errcode = '42501'; end if;
  update public.media_assets set cleanup_claim_token = null, cleanup_claimed_at = null
  where business_id = expected_business_id and id = requested_asset_id and cleanup_claim_token = requested_claim_token;
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
  if auth.role() <> 'service_role' then raise exception 'site_cleanup_service_required' using errcode = '42501'; end if;
  select * into selected_asset from public.media_assets
  where business_id = expected_business_id and id = requested_asset_id
    and cleanup_claim_token = requested_claim_token
  for update;
  if not found then return false; end if;
  -- This recheck runs after the asset lock. A Page or Site save either won
  -- before the lock and is visible here, or waits and then sees the claim.
  if exists (select 1 from public.site_draft_asset_references where business_id = expected_business_id and asset_id = requested_asset_id)
    or exists (select 1 from public.site_release_asset_references where business_id = expected_business_id and asset_id = requested_asset_id)
    or exists (
      select 1
      from public.configuration_versions as version_value
      cross join lateral jsonb_array_elements(version_value.snapshot_json -> 'pages') as page_value(value)
      cross join lateral private.page_blocks_v2(page_value.value -> 'layout_json') as block_value(value)
      where version_value.business_id = expected_business_id
        and (
          (block_value.value ->> 'type' = 'image' and block_value.value ->> 'asset_id' = requested_asset_id::text)
          or (block_value.value ->> 'type' = 'gallery' and exists (
            select 1 from jsonb_array_elements(block_value.value -> 'images') as image_value(value)
            where image_value.value ->> 'asset_id' = requested_asset_id::text
          ))
        )
    )
  then return false; end if;
  delete from public.media_assets
  where business_id = expected_business_id and id = requested_asset_id
    and cleanup_claim_token = requested_claim_token;
  return found;
end;
$$;

revoke all on function public.claim_site_media_asset_for_cleanup(uuid, uuid),
  public.release_site_media_cleanup_claim(uuid, uuid, uuid),
  public.finalize_site_media_cleanup(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_site_media_asset_for_cleanup(uuid, uuid),
  public.release_site_media_cleanup_claim(uuid, uuid, uuid),
  public.finalize_site_media_cleanup(uuid, uuid, uuid)
  to service_role;

-- Canonical configuration readers remain backward compatible: ordinary Page
-- atoms still validate exactly as before, while the bounded Site atoms are
-- allowed only for public draft Pages. No public published Page may contain a
-- Site atom until C2 supplies the release reader.
create or replace function private.assert_valid_page_config_shape(layout jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  block jsonb;
  block_id text;
  seen_ids text[] := array[]::text[];
  total_blocks integer := 0;
begin
  if not private.experience_json_has_only_keys(layout, array['blocks'])
    or jsonb_typeof(layout -> 'blocks') <> 'array'
    or jsonb_array_length(layout -> 'blocks') > 100
  then raise exception 'Invalid Page layout' using errcode = '22023'; end if;
  for block in select value from jsonb_array_elements(layout -> 'blocks') loop
    total_blocks := total_blocks + private.site_block_count_v1(block);
    if total_blocks > 100 then raise exception 'Page contains too many blocks' using errcode = '22023'; end if;
    if block ->> 'type' in ('gallery', 'section', 'collection', 'record_detail') then
      perform private.site_assert_block_v1(block);
    else
      perform private.assert_valid_page_block_v2(block, true);
    end if;
  end loop;
  -- Keep the historical duplicate-ID guard across every nested legacy and
  -- Site block. The Site-specific root validation additionally requires IDs
  -- where C1 uses them for collection/detail bindings.
  for block in select configured_block from private.page_blocks_v2(layout) as configured_block loop
    if block ? 'id' then
      block_id := block ->> 'id';
      if jsonb_typeof(block -> 'id') is distinct from 'string'
        or not private.site_valid_uuid_v1(block -> 'id')
        or block_id = any(seen_ids)
      then raise exception 'Page block IDs must be unique UUIDs' using errcode = '22023'; end if;
      seen_ids := array_append(seen_ids, block_id);
    end if;
  end loop;
exception when invalid_text_representation then
  raise exception 'Invalid Page block value' using errcode = '22023';
end;
$$;

create or replace function private.page_blocks_v2(layout jsonb)
returns setof jsonb
language sql
immutable
set search_path = ''
as $$
  with recursive blocks(block) as (
    select value from jsonb_array_elements(layout -> 'blocks')
    union all
    select child.value
    from blocks
    cross join lateral (
      select value from jsonb_array_elements(blocks.block -> 'blocks')
      where blocks.block ->> 'type' = 'collapsible'
      union all
      select child_value.value
      from jsonb_array_elements(blocks.block -> 'columns') as column_value(value)
      cross join lateral jsonb_array_elements(column_value.value -> 'blocks') as child_value(value)
      where blocks.block ->> 'type' = 'section'
    ) as child(value)
  ) select block from blocks;
$$;

create or replace function private.assert_valid_experience_page(
  target_business_id uuid,
  requested_audience public.experience_audience,
  layout jsonb,
  requested_status public.experience_page_status
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  block jsonb;
  configured_view public.views;
  configured_form public.forms;
  gallery_image jsonb;
begin
  perform private.assert_valid_page_config_shape(layout);
  if requested_audience = 'internal' and exists (
    select 1 from private.page_blocks_v2(layout) as configured_block
    where configured_block ->> 'type' in ('gallery', 'section', 'collection', 'record_detail')
  ) then raise exception 'Internal Pages cannot use Site layout atoms' using errcode = '23514'; end if;
  if requested_status = 'published' and exists (
    select 1 from private.page_blocks_v2(layout) as configured_block
    where configured_block ->> 'type' in ('gallery', 'section', 'collection', 'record_detail')
  ) then raise exception 'site_release_reader_not_active' using errcode = '23514'; end if;
  if requested_audience = 'public' and requested_status = 'published' and exists (
    select 1 from private.page_blocks_v2(layout) as configured_block
    where configured_block ->> 'type' in ('view', 'form')
  ) then raise exception 'Published public Pages cannot expose generic Records or Forms' using errcode = '23514'; end if;
  for block in select configured_block from private.page_blocks_v2(layout) as configured_block loop
    if block ->> 'type' = 'image' and block ? 'asset_id' then
      perform 1 from public.media_assets
      where business_id = target_business_id and id = (block ->> 'asset_id')::uuid
        and cleanup_claim_token is null for share;
      if not found then raise exception 'Page media reference is invalid' using errcode = '23514'; end if;
      if requested_audience = 'public' and requested_status = 'published' then
        raise exception 'Private Page media requires an internal Page' using errcode = '23514';
      end if;
    elsif block ->> 'type' = 'gallery' then
      for gallery_image in select value from jsonb_array_elements(block -> 'images') loop
        perform 1 from public.media_assets
        where business_id = target_business_id and id = (gallery_image ->> 'asset_id')::uuid
          and cleanup_claim_token is null for share;
        if not found then raise exception 'Page media reference is invalid' using errcode = '23514'; end if;
      end loop;
    elsif block ->> 'type' = 'view' then
      select * into configured_view from public.views
      where business_id = target_business_id and key = block ->> 'view_key'
        and audience = requested_audience and is_active for share;
      if not found then raise exception 'Page View reference is invalid' using errcode = '23514'; end if;
      if block ? 'checklist' and (configured_view.view_type <> 'table' or configured_view.audience <> 'internal' or requested_audience <> 'internal') then
        raise exception 'Checklist Views are internal Table Views only' using errcode = '23514';
      end if;
    elsif block ->> 'type' = 'form' then
      select * into configured_form from public.forms
      where business_id = target_business_id and key = block ->> 'form_key'
        and audience = requested_audience and mode = 'create' and is_active for share;
      if not found then raise exception 'Page Form reference is invalid' using errcode = '23514'; end if;
    elsif block ->> 'type' = 'public_form' then
      if requested_audience <> 'public' then raise exception 'Public Forms require a public Page' using errcode = '23514'; end if;
      select * into configured_form from public.forms
      where business_id = target_business_id and key = block ->> 'form_key'
        and audience = 'public' and mode = 'create' and is_active for share;
      if not found then raise exception 'Public Form reference is invalid' using errcode = '23514'; end if;
    elsif block ->> 'type' = 'booking' then
      if requested_audience <> 'public' then raise exception 'Booking requires a public Page' using errcode = '23514'; end if;
    elsif block ->> 'type' = 'preorder' then
      if requested_audience <> 'public' then raise exception 'Preorder blocks may only appear on public Pages' using errcode = '23514'; end if;
      perform 1 from public.preorder_experiences
      where business_id = target_business_id and key = block ->> 'preorder_key' and is_active for share;
      if not found then raise exception 'Page preorder reference is invalid' using errcode = '23514'; end if;
    end if;
  end loop;
end;
$$;

comment on table public.site_states is
  'C1 private durable Site draft coordination. It is not a public release reader or a new business domain primitive.';
comment on table public.site_releases is
  'Immutable private Site projection candidates and releases. C1 does not expose them to anonymous readers.';
