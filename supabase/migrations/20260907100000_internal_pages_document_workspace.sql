-- Internal Pages document workspace: recursive bounded grammar and private media.
-- This migration is additive. Existing Page shapes, configuration history and
-- public Site behaviour remain valid.

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  storage_key text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer not null check (byte_size between 1 and 3145728),
  width integer not null check (width between 1 and 20000),
  height integer not null check (height between 1 and 20000),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (business_id, storage_key),
  unique (business_id, id)
);

create index if not exists media_assets_business_created_idx
  on public.media_assets (business_id, created_at desc);

alter table public.media_assets enable row level security;

drop policy if exists "Members can read private media metadata" on public.media_assets;
create policy "Members can read private media metadata"
on public.media_assets
for select
to authenticated
using (private.is_business_member(business_id));

drop policy if exists "Owners and admins can register private media" on public.media_assets;
create policy "Owners and admins can register private media"
on public.media_assets
for insert
to authenticated
with check (private.can_manage_tenant(business_id));

comment on table public.media_assets is
  'Tenant-owned private media registry for internal Page assets. Historical configuration references are retained.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'page-assets',
  'page-assets',
  false,
  3145728,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = 3145728,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Members can read private Page assets" on storage.objects;
create policy "Members can read private Page assets"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'page-assets'
  and private.configuration_uuid_is_valid((storage.foldername(name))[1])
  and private.is_business_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "Owners and admins can upload private Page assets" on storage.objects;
create policy "Owners and admins can upload private Page assets"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'page-assets'
  and private.configuration_uuid_is_valid((storage.foldername(name))[1])
  and private.can_manage_tenant(((storage.foldername(name))[1])::uuid)
);

create or replace function private.page_block_count_v2(block jsonb)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  child jsonb;
  total integer := 1;
begin
  if block ->> 'type' = 'collapsible'
    and jsonb_typeof(block -> 'blocks') = 'array'
  then
    for child in select value from jsonb_array_elements(block -> 'blocks')
    loop
      total := total + private.page_block_count_v2(child);
    end loop;
  end if;
  return total;
end;
$$;

create or replace function private.assert_valid_page_rich_text_content_v1(
  content jsonb,
  maximum_length integer
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  span jsonb;
  mark jsonb;
  mark_type text;
  seen_mark_types text[];
  total_length integer := 0;
begin
  if jsonb_typeof(content) <> 'array'
    or jsonb_array_length(content) not between 0 and 200
  then
    raise exception 'Invalid Page rich text content' using errcode = '22023';
  end if;

  for span in select value from jsonb_array_elements(content)
  loop
    if not private.experience_json_has_only_keys(span, array['type', 'text', 'marks'])
      or span ->> 'type' <> 'text'
      or jsonb_typeof(span -> 'text') <> 'string'
      or char_length(span ->> 'text') not between 1 and 5000
    then
      raise exception 'Invalid Page rich text span' using errcode = '22023';
    end if;

    total_length := total_length + char_length(span ->> 'text');
    if total_length > maximum_length then
      raise exception 'Page rich text is too long' using errcode = '22023';
    end if;

    if span ? 'marks' then
      if jsonb_typeof(span -> 'marks') <> 'array'
        or jsonb_array_length(span -> 'marks') not between 0 and 3
      then
        raise exception 'Invalid Page rich text marks' using errcode = '22023';
      end if;
      seen_mark_types := array[]::text[];
      for mark in select value from jsonb_array_elements(span -> 'marks')
      loop
        mark_type := mark ->> 'type';
        if mark_type = any(seen_mark_types) then
          raise exception 'Repeated Page rich text mark' using errcode = '22023';
        end if;
        seen_mark_types := array_append(seen_mark_types, mark_type);
        if mark_type in ('bold', 'italic') then
          if not private.experience_json_has_only_keys(mark, array['type']) then
            raise exception 'Invalid Page rich text mark' using errcode = '22023';
          end if;
        elsif mark_type = 'link' then
          if not private.experience_json_has_only_keys(mark, array['type', 'href'])
            or jsonb_typeof(mark -> 'href') <> 'string'
            or char_length(mark ->> 'href') not between 1 and 2048
            or (mark ->> 'href') !~* '^(https?://|/|mailto:|tel:)[^[:space:]]+$'
          then
            raise exception 'Invalid Page rich text link' using errcode = '22023';
          end if;
        else
          raise exception 'Unsupported Page rich text mark' using errcode = '22023';
        end if;
      end loop;
    end if;
  end loop;
end;
$$;

create or replace function private.assert_valid_page_block_v2(
  block jsonb,
  allow_collapsible boolean default true
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  block_type text := block ->> 'type';
  node jsonb;
  item jsonb;
  child jsonb;
begin
  if jsonb_typeof(block) <> 'object' then
    raise exception 'Invalid Page block' using errcode = '22023';
  end if;

  if block_type = 'heading' then
    if not private.experience_json_has_only_keys(block, array['type', 'text', 'level', 'id'])
      or not private.experience_string_is_valid(block ->> 'text', 200)
      or (block ? 'level' and (jsonb_typeof(block -> 'level') <> 'number' or (block ->> 'level') !~ '^[123]$'))
    then raise exception 'Invalid heading Page block' using errcode = '22023'; end if;
  elsif block_type = 'text' then
    if not private.experience_json_has_only_keys(block, array['type', 'text', 'id'])
      or not private.experience_string_is_valid(block ->> 'text', 5000)
    then raise exception 'Invalid text Page block' using errcode = '22023'; end if;
  elsif block_type = 'rich_text' then
    if not private.experience_json_has_only_keys(block, array['type', 'node', 'id'])
      or jsonb_typeof(block -> 'node') <> 'object'
    then raise exception 'Invalid rich text Page block' using errcode = '22023'; end if;
    node := block -> 'node';
    if node ->> 'type' = 'paragraph' then
      if not private.experience_json_has_only_keys(node, array['type', 'content']) then
        raise exception 'Invalid Page paragraph' using errcode = '22023';
      end if;
      perform private.assert_valid_page_rich_text_content_v1(node -> 'content', 5000);
    elsif node ->> 'type' = 'heading' then
      if not private.experience_json_has_only_keys(node, array['type', 'level', 'content'])
        or jsonb_typeof(node -> 'level') <> 'number'
        or (node ->> 'level') !~ '^[123]$'
      then raise exception 'Invalid rich text Page heading' using errcode = '22023'; end if;
      perform private.assert_valid_page_rich_text_content_v1(node -> 'content', 200);
    elsif node ->> 'type' in ('bullet_list', 'numbered_list') then
      if not private.experience_json_has_only_keys(node, array['type', 'items'])
        or jsonb_typeof(node -> 'items') <> 'array'
        or jsonb_array_length(node -> 'items') not between 1 and 50
      then raise exception 'Invalid Page list' using errcode = '22023'; end if;
      for item in select value from jsonb_array_elements(node -> 'items') loop
        if not private.experience_json_has_only_keys(item, array['content']) then
          raise exception 'Invalid Page list item' using errcode = '22023';
        end if;
        perform private.assert_valid_page_rich_text_content_v1(item -> 'content', 5000);
      end loop;
    else
      raise exception 'Unsupported Page rich text node' using errcode = '22023';
    end if;
  elsif block_type = 'image' then
    if not private.experience_json_has_only_keys(
      block, array['type', 'src', 'asset_id', 'alt', 'caption', 'presentation', 'id']
    )
      or (not (block ? 'src') and not (block ? 'asset_id'))
      or ((block ? 'src') and (block ? 'asset_id'))
      or ((block ? 'src') and ((block ->> 'src') !~* '^https?://[^[:space:]]+$'))
      or ((block ? 'asset_id') and not private.configuration_uuid_is_valid(block ->> 'asset_id'))
      or (block ? 'alt' and (jsonb_typeof(block -> 'alt') <> 'string' or char_length(block ->> 'alt') > 300))
      or ((block ? 'src') and not private.experience_string_is_valid(block ->> 'alt', 300))
      or (block ? 'caption' and not private.experience_string_is_valid(block ->> 'caption', 500))
      or (block ? 'presentation' and block ->> 'presentation' not in ('content', 'wide'))
    then raise exception 'Invalid image Page block' using errcode = '22023'; end if;
  elsif block_type = 'button' then
    if not private.experience_json_has_only_keys(block, array['type', 'label', 'href', 'style', 'id'])
      or not private.experience_string_is_valid(block ->> 'label', 120)
      or not private.experience_string_is_valid(block ->> 'href', 2048)
      or (block ->> 'href') !~* '^(https?://|/|mailto:|tel:)[^[:space:]]+$'
      or (block ? 'style' and block ->> 'style' not in ('primary', 'secondary'))
    then raise exception 'Invalid button Page block' using errcode = '22023'; end if;
  elsif block_type = 'view' then
    if not private.experience_json_has_only_keys(block, array['type', 'view_key', 'read_only', 'checklist', 'id'])
      or not private.experience_key_is_valid(block ->> 'view_key')
      or (block ? 'read_only' and jsonb_typeof(block -> 'read_only') <> 'boolean')
    then raise exception 'Invalid View Page block' using errcode = '22023'; end if;
    if block ? 'checklist' then
      node := block -> 'checklist';
      if not private.experience_json_has_only_keys(node, array['label_field', 'completed_field'])
        or not private.experience_key_is_valid(node ->> 'label_field')
        or not private.experience_key_is_valid(node ->> 'completed_field')
      then raise exception 'Invalid checklist Page block' using errcode = '22023'; end if;
    end if;
  elsif block_type in ('form', 'public_form') then
    if not private.experience_json_has_only_keys(block, array['type', 'form_key', 'id'])
      or not private.experience_key_is_valid(block ->> 'form_key')
    then raise exception 'Invalid Form Page block' using errcode = '22023'; end if;
  elsif block_type = 'booking' then
    if not private.experience_json_has_only_keys(block, array['type', 'booking_key', 'config', 'id'])
      or not private.experience_key_is_valid(block ->> 'booking_key')
      or jsonb_typeof(block -> 'config') <> 'object'
    then raise exception 'Invalid Booking Page block' using errcode = '22023'; end if;
  elsif block_type = 'preorder' then
    if not private.experience_json_has_only_keys(block, array['type', 'preorder_key', 'id'])
      or not private.experience_key_is_valid(block ->> 'preorder_key')
    then raise exception 'Invalid preorder Page block' using errcode = '22023'; end if;
  elsif block_type = 'divider' then
    if not private.experience_json_has_only_keys(block, array['type', 'id']) then
      raise exception 'Invalid divider Page block' using errcode = '22023';
    end if;
  elsif block_type = 'callout' then
    if not private.experience_json_has_only_keys(block, array['type', 'text', 'tone', 'id'])
      or not private.experience_string_is_valid(block ->> 'text', 1000)
      or (block ? 'tone' and block ->> 'tone' not in ('neutral', 'info', 'success', 'warning'))
    then raise exception 'Invalid Callout Page block' using errcode = '22023'; end if;
  elsif block_type = 'collapsible' and allow_collapsible then
    if not private.experience_json_has_only_keys(block, array['type', 'summary', 'blocks', 'open', 'id'])
      or not private.experience_string_is_valid(block ->> 'summary', 200)
      or jsonb_typeof(block -> 'blocks') <> 'array'
      or jsonb_array_length(block -> 'blocks') > 50
      or (block ? 'open' and jsonb_typeof(block -> 'open') <> 'boolean')
    then raise exception 'Invalid collapsible Page block' using errcode = '22023'; end if;
    for child in select value from jsonb_array_elements(block -> 'blocks') loop
      perform private.assert_valid_page_block_v2(child, false);
    end loop;
  else
    raise exception 'Unsupported Page block type' using errcode = '22023';
  end if;
end;
$$;

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
    total_blocks := total_blocks + private.page_block_count_v2(block);
    if total_blocks > 100 then
      raise exception 'Page contains too many blocks' using errcode = '22023';
    end if;
    perform private.assert_valid_page_block_v2(block, true);
    if block ? 'id' then
      block_id := block ->> 'id';
      if jsonb_typeof(block -> 'id') <> 'string'
        or not private.configuration_uuid_is_valid(block_id)
        or block_id = any(seen_ids)
      then raise exception 'Page block IDs must be unique UUIDs' using errcode = '22023'; end if;
      seen_ids := array_append(seen_ids, block_id);
    end if;
    if block ->> 'type' = 'collapsible' then
      for block in select value from jsonb_array_elements(block -> 'blocks') loop
        if block ? 'id' then
          block_id := block ->> 'id';
          if jsonb_typeof(block -> 'id') <> 'string'
            or not private.configuration_uuid_is_valid(block_id)
            or block_id = any(seen_ids)
          then raise exception 'Page block IDs must be unique UUIDs' using errcode = '22023'; end if;
          seen_ids := array_append(seen_ids, block_id);
        end if;
      end loop;
    end if;
  end loop;
exception
  when invalid_text_representation then
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
    select value
    from jsonb_array_elements(layout -> 'blocks')
    union all
    select child.value
    from blocks
    cross join lateral jsonb_array_elements(blocks.block -> 'blocks') as child(value)
    where blocks.block ->> 'type' = 'collapsible'
  )
  select block from blocks;
$$;

create or replace function private.page_block_signature_v2(block jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when block ->> 'type' = 'collapsible' then
      (block - 'id') || jsonb_build_object(
        'blocks', coalesce(
          (
            select jsonb_agg(
              private.page_block_signature_v2(value)
              order by ordinal
            )
            from jsonb_array_elements(block -> 'blocks')
              with ordinality as child(value, ordinal)
          ),
          '[]'::jsonb
        )
      )
    else block - 'id'
  end;
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
begin
  perform private.assert_valid_page_config_shape(layout);

  if requested_audience = 'public' and requested_status = 'published'
    and exists (
      select 1
      from private.page_blocks_v2(layout) as configured_block
      where configured_block ->> 'type' in ('view', 'form')
    )
  then
    raise exception 'Published public Pages cannot expose generic Records or Forms'
      using errcode = '23514';
  end if;

  for block in select configured_block from private.page_blocks_v2(layout) as configured_block
  loop
    if block ->> 'type' = 'image' and block ? 'asset_id'
      and requested_audience = 'public'
    then
      raise exception 'Private Page media requires an internal Page'
        using errcode = '23514';
    elsif block ->> 'type' = 'view' then
      select * into configured_view
      from public.views
      where business_id = target_business_id
        and key = block ->> 'view_key'
        and audience = requested_audience
        and is_active
      for share;
      if not found then
        raise exception 'Page View reference is invalid' using errcode = '23514';
      end if;
      if block ? 'checklist' and (
        configured_view.view_type <> 'table'
        or configured_view.audience <> 'internal'
        or requested_audience <> 'internal'
      ) then
        raise exception 'Checklist Views are internal Table Views only'
          using errcode = '23514';
      end if;
    elsif block ->> 'type' = 'form' then
      select * into configured_form
      from public.forms
      where business_id = target_business_id
        and key = block ->> 'form_key'
        and audience = requested_audience
        and mode = 'create'
        and is_active
      for share;
      if not found then
        raise exception 'Page Form reference is invalid' using errcode = '23514';
      end if;
    elsif block ->> 'type' = 'public_form' then
      if requested_audience <> 'public' then
        raise exception 'Public Forms require a public Page' using errcode = '23514';
      end if;
      select * into configured_form
      from public.forms
      where business_id = target_business_id
        and key = block ->> 'form_key'
        and audience = 'public'
        and mode = 'create'
        and is_active
      for share;
      if not found then
        raise exception 'Public Form reference is invalid' using errcode = '23514';
      end if;
    elsif block ->> 'type' = 'booking' then
      if requested_audience <> 'public' then
        raise exception 'Booking requires a public Page' using errcode = '23514';
      end if;
    elsif block ->> 'type' = 'preorder' then
      if requested_audience <> 'public' then
        raise exception 'Preorder blocks may only appear on public Pages' using errcode = '23514';
      end if;
      perform 1 from public.preorder_experiences
      where business_id = target_business_id
        and key = block ->> 'preorder_key'
        and is_active
      for share;
      if not found then
        raise exception 'Page preorder reference is invalid' using errcode = '23514';
      end if;
    end if;
  end loop;
end;
$$;

create or replace function private.ensure_experience_change_preserves_dependents()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  view_definition public.views;
  page_definition public.pages;
begin
  if tg_table_name = 'forms' then
    for view_definition in
      select configured_view.*
      from public.views as configured_view
      where configured_view.business_id = new.business_id
        and configured_view.is_active
        and (
          configured_view.config_json ->> 'create_form_key' = new.key
          or configured_view.config_json ->> 'edit_form_key' = new.key
        )
    loop
      perform private.assert_valid_experience_view(
        view_definition.business_id,
        view_definition.object_definition_id,
        view_definition.view_type,
        view_definition.config_json,
        view_definition.audience,
        view_definition.is_active
      );
    end loop;
  end if;

  for page_definition in
    select configured_page.*
    from public.pages as configured_page
    where configured_page.business_id = new.business_id
      and configured_page.is_active
      and exists (
        select 1
        from private.page_blocks_v2(configured_page.layout_json) as block
        where (
          tg_table_name = 'views'
          and block ->> 'type' = 'view'
          and block ->> 'view_key' = new.key
        ) or (
          tg_table_name = 'forms'
          and block ->> 'type' in ('form', 'public_form')
          and block ->> 'form_key' = new.key
        )
      )
  loop
    perform private.assert_valid_experience_page(
      page_definition.business_id,
      page_definition.audience,
      page_definition.layout_json,
      page_definition.status
    );
  end loop;
  return null;
end;
$$;

create or replace function private.ensure_preorder_change_preserves_pages()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  page_definition public.pages;
begin
  for page_definition in
    select configured_page.*
    from public.pages as configured_page
    where configured_page.business_id = new.business_id
      and configured_page.is_active
      and exists (
        select 1
        from private.page_blocks_v2(configured_page.layout_json) as block
        where block ->> 'type' = 'preorder'
          and block ->> 'preorder_key' = new.key
      )
  loop
    perform private.assert_valid_experience_page(
      page_definition.business_id,
      page_definition.audience,
      page_definition.layout_json,
      page_definition.status
    );
  end loop;
  return null;
end;
$$;

create or replace function private.assert_direct_page_action_shape_v1(
  action_kind text,
  base_snapshot jsonb,
  candidate_snapshot jsonb,
  operations jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  operation jsonb;
  base_page jsonb;
  candidate_page jsonb;
  target_key text;
  object_key text;
  view_key text;
begin
  if action_kind not in (
    'create_page', 'rename_page', 'save_page_layout',
    'publish_page_changes', 'duplicate_page', 'archive_page', 'restore_page',
    'create_checklist'
  ) or jsonb_typeof(operations) <> 'array' then
    raise exception 'direct_page_action_shape_invalid' using errcode = '22023';
  end if;

  perform private.assert_configuration_operations_v1(operations);

  -- Published Sites retain their existing bounded publication contract. Keep
  -- this branch ahead of the internal Page lifecycle grammar so the additive
  -- document workspace migration cannot regress the public Site editor.
  if action_kind = 'publish_page_changes' then
    if jsonb_array_length(operations) <> 1 then
      raise exception 'direct_page_action_shape_invalid' using errcode = '22023';
    end if;
    operation := operations -> 0;
    if operation ->> 'op' <> 'set_page' then
      raise exception 'direct_page_action_shape_invalid' using errcode = '22023';
    end if;
    target_key := operation ->> 'key';
    select value into base_page
    from jsonb_array_elements(base_snapshot -> 'pages') as value
    where value ->> 'key' = target_key;
    select value into candidate_page
    from jsonb_array_elements(candidate_snapshot -> 'pages') as value
    where value ->> 'key' = target_key;
    if base_page is null
      or candidate_page is null
      or not (base_page ->> 'is_active')::boolean
      or base_page ->> 'audience' <> 'public'
      or base_page ->> 'status' <> 'published'
      or candidate_page ->> 'id' <> base_page ->> 'id'
      or candidate_page ->> 'key' <> base_page ->> 'key'
      or candidate_page ->> 'slug' <> base_page ->> 'slug'
      or candidate_page ->> 'audience' <> 'public'
      or candidate_page ->> 'status' <> 'published'
      or candidate_page ->> 'is_active' <> base_page ->> 'is_active'
      or operation ->> 'slug' <> base_page ->> 'slug'
      or operation ->> 'audience' <> 'public'
      or operation ->> 'status' <> 'published'
      or operation ->> 'is_active' <> base_page ->> 'is_active'
      or candidate_page ->> 'title' <> operation ->> 'title'
      or candidate_page -> 'layout_json' <> operation -> 'layout_json'
      or (candidate_page - 'title' - 'layout_json') <>
        (base_page - 'title' - 'layout_json')
      or (
        candidate_page ->> 'title' = base_page ->> 'title'
        and private.direct_page_layouts_equal_v1(
          base_page -> 'layout_json', candidate_page -> 'layout_json'
        )
      )
      or not private.direct_page_snapshot_collections_unchanged_v1(
        base_snapshot, candidate_snapshot
      )
      or exists (
        select 1
        from jsonb_array_elements(base_snapshot -> 'pages') as existing_page
        where existing_page ->> 'key' <> target_key
          and not exists (
            select 1
            from jsonb_array_elements(candidate_snapshot -> 'pages') as next_page
            where next_page = existing_page
          )
      )
      or exists (
        select 1
        from jsonb_array_elements(candidate_snapshot -> 'pages') as next_page
        where next_page ->> 'key' <> target_key
          and not exists (
            select 1
            from jsonb_array_elements(base_snapshot -> 'pages') as existing_page
            where existing_page = next_page
          )
      )
    then
      raise exception 'direct_page_action_shape_invalid' using errcode = '22023';
    end if;

    -- Stable capability atoms retain their exact identity and configuration.
    if exists (
      select 1
      from private.page_blocks_v2(base_page -> 'layout_json') as block
      where block ->> 'type' not in ('heading', 'text', 'divider', 'rich_text')
        and block ? 'id'
        and not exists (
          select 1
          from private.page_blocks_v2(candidate_page -> 'layout_json') as candidate_block
          where candidate_block = block
        )
    ) then
      raise exception 'direct_page_action_shape_invalid' using errcode = '22023';
    end if;

    -- Locked atoms retain the same multiset after ignoring generated IDs.
    if exists (
      select 1
      from (
        select block - 'id' as signature, count(*) as amount
        from private.page_blocks_v2(base_page -> 'layout_json') as block
        where block ->> 'type' not in ('heading', 'text', 'divider', 'rich_text')
        group by block - 'id'
      ) as base_locked
      full join (
        select block - 'id' as signature, count(*) as amount
        from private.page_blocks_v2(candidate_page -> 'layout_json') as block
        where block ->> 'type' not in ('heading', 'text', 'divider', 'rich_text')
        group by block - 'id'
      ) as candidate_locked using (signature)
      where base_locked.amount is distinct from candidate_locked.amount
    ) then
      raise exception 'direct_page_action_shape_invalid' using errcode = '22023';
    end if;
    return;
  end if;

  if action_kind = 'create_checklist' then
    object_key := operations -> 0 ->> 'key';
    view_key := operations -> 3 ->> 'key';
    if jsonb_array_length(operations) <> 5
      or (operations -> 0) ->> 'op' <> 'set_object'
      or (operations -> 1) ->> 'op' <> 'set_field'
      or (operations -> 2) ->> 'op' <> 'set_field'
      or (operations -> 3) ->> 'op' <> 'set_view'
      or (operations -> 4) ->> 'op' <> 'set_page'
      or (operations -> 1) ->> 'key' <> 'name'
      or (operations -> 2) ->> 'key' <> 'completed'
      or (operations -> 0) ->> 'singular_label' <> (operations -> 0) ->> 'plural_label'
      or (operations -> 0) ->> 'is_active' <> 'true'
      or (operations -> 1) ->> 'object_key' <> object_key
      or (operations -> 2) ->> 'object_key' <> object_key
      or (operations -> 3) ->> 'audience' <> 'internal'
      or (operations -> 3) ->> 'view_type' <> 'table'
      or (operations -> 3) ->> 'name' <> (operations -> 0) ->> 'plural_label'
      or (operations -> 1) ->> 'field_type' <> 'short_text'
      or (operations -> 2) ->> 'field_type' <> 'boolean'
      or (operations -> 1) ->> 'label' <> 'Name'
      or (operations -> 2) ->> 'label' <> 'Completed'
      or (operations -> 1) ->> 'required' <> 'true'
      or (operations -> 2) ->> 'required' <> 'false'
      or (operations -> 1) ->> 'position' <> '0'
      or (operations -> 2) ->> 'position' <> '1'
      or (operations -> 2) -> 'default_value' <> 'false'::jsonb
    then
      raise exception 'direct_page_action_shape_invalid' using errcode = '22023';
    end if;
    if object_key is null or view_key is distinct from object_key
      or operations -> 3 ->> 'object_key' is distinct from object_key
      or (operations -> 4) ->> 'audience' <> 'internal'
      or not ((operations -> 4) ->> 'is_active')::boolean
    then
      raise exception 'direct_page_action_shape_invalid' using errcode = '22023';
    end if;

    target_key := operations -> 4 ->> 'key';
    select value into base_page
    from jsonb_array_elements(base_snapshot -> 'pages') as value
    where value ->> 'key' = target_key;
    select value into candidate_page
    from jsonb_array_elements(candidate_snapshot -> 'pages') as value
    where value ->> 'key' = target_key;
    if base_page is null or candidate_page is null
      or jsonb_array_length(candidate_snapshot -> 'object_definitions') <>
        jsonb_array_length(base_snapshot -> 'object_definitions') + 1
      or jsonb_array_length(candidate_snapshot -> 'field_definitions') <>
        jsonb_array_length(base_snapshot -> 'field_definitions') + 2
      or jsonb_array_length(candidate_snapshot -> 'views') <>
        jsonb_array_length(base_snapshot -> 'views') + 1
      or (operations -> 4) ->> 'status' <> (base_page ->> 'status')
      or (candidate_page -> 'layout_json') = (base_page -> 'layout_json')
      or jsonb_array_length(candidate_page -> 'layout_json' -> 'blocks') <>
        jsonb_array_length(base_page -> 'layout_json' -> 'blocks') + 1
      or exists (
        select 1
        from jsonb_array_elements(base_page -> 'layout_json' -> 'blocks') as base_block
        where not exists (
          select 1
          from jsonb_array_elements(candidate_page -> 'layout_json' -> 'blocks') as candidate_block
          where private.page_block_signature_v2(candidate_block) =
            private.page_block_signature_v2(base_block)
        )
      )
      or candidate_page - 'layout_json' <> base_page - 'layout_json'
      or (operations -> 4) - 'op' - 'layout_json' <> base_page - 'layout_json'
      or (operations -> 4) ->> 'key' <> base_page ->> 'key'
      or (operations -> 4) ->> 'slug' <> base_page ->> 'slug'
      or (operations -> 4) ->> 'title' <> base_page ->> 'title'
      or (operations -> 4) ->> 'audience' <> base_page ->> 'audience'
      or (operations -> 4) ->> 'is_active' <> base_page ->> 'is_active'
      or (select count(*) from private.page_blocks_v2(candidate_page -> 'layout_json') as block
          where block ->> 'type' = 'view'
            and block ->> 'view_key' = view_key
            and block -> 'checklist' ->> 'label_field' = 'name'
            and block -> 'checklist' ->> 'completed_field' = 'completed') <> 1
      or (operations -> 3 -> 'config_json') <> jsonb_build_object(
        'schema_version', 2,
        'role', 'primary',
        'columns', jsonb_build_array(
          jsonb_build_object('kind', 'field', 'field_key', 'name'),
          jsonb_build_object('kind', 'field', 'field_key', 'completed')
        ),
        'fields', jsonb_build_array('name', 'completed'),
        'title_field', 'name',
        'include_archived', false,
        'filters', jsonb_build_array(),
        'filter_match', 'all',
        'sorts', jsonb_build_array(),
        'group', null
      )
      or exists (
        select 1
        from jsonb_array_elements(base_snapshot -> 'object_definitions') as existing
        where not exists (
          select 1 from jsonb_array_elements(candidate_snapshot -> 'object_definitions') as candidate
          where candidate = existing
        )
      )
      or exists (
        select 1
        from jsonb_array_elements(base_snapshot -> 'field_definitions') as existing
        where not exists (
          select 1 from jsonb_array_elements(candidate_snapshot -> 'field_definitions') as candidate
          where candidate = existing
        )
      )
      or exists (
        select 1
        from jsonb_array_elements(base_snapshot -> 'views') as existing
        where not exists (
          select 1 from jsonb_array_elements(candidate_snapshot -> 'views') as candidate
          where candidate = existing
        )
      )
      or not exists (
        select 1 from private.page_blocks_v2(candidate_page -> 'layout_json') as block
        where block ->> 'type' = 'view'
          and block ->> 'view_key' = view_key
          and block -> 'checklist' ->> 'label_field' = 'name'
          and block -> 'checklist' ->> 'completed_field' = 'completed'
      )
      or (candidate_snapshot - 'object_definitions' - 'field_definitions' - 'views' - 'pages') <>
         (base_snapshot - 'object_definitions' - 'field_definitions' - 'views' - 'pages')
    then
      raise exception 'direct_page_action_shape_invalid' using errcode = '22023';
    end if;
    return;
  end if;

  if jsonb_array_length(operations) <> 1 then
    raise exception 'direct_page_action_shape_invalid' using errcode = '22023';
  end if;
  select value into operation
  from jsonb_array_elements(operations) as value
  where value ->> 'op' = 'set_page';
  if operation is null then
    raise exception 'direct_page_action_shape_invalid' using errcode = '22023';
  end if;

  target_key := operation ->> 'key';
  select value into base_page
  from jsonb_array_elements(base_snapshot -> 'pages') as value
  where value ->> 'key' = target_key;
  select value into candidate_page
  from jsonb_array_elements(candidate_snapshot -> 'pages') as value
  where value ->> 'key' = target_key;

  if not private.direct_page_snapshot_collections_unchanged_v1(base_snapshot, candidate_snapshot) then
    raise exception 'direct_page_action_shape_invalid' using errcode = '22023';
  end if;

  if action_kind in ('create_page', 'duplicate_page') then
    if base_page is not null
      or candidate_page is null
      or jsonb_array_length(candidate_snapshot -> 'pages') <> jsonb_array_length(base_snapshot -> 'pages') + 1
      or not (base_snapshot -> 'pages') <@ (candidate_snapshot -> 'pages')
      or candidate_page - 'id' <> operation - 'op'
      or operation ->> 'audience' <> 'internal'
      or operation ->> 'status' <> 'draft'
      or not (operation ->> 'is_active')::boolean
      or exists (
        select 1 from jsonb_array_elements(base_snapshot -> 'pages') as existing_page
        where existing_page ->> 'id' = candidate_page ->> 'id'
      )
    then
      raise exception 'direct_page_action_shape_invalid' using errcode = '22023';
    end if;
    if action_kind = 'create_page' and (candidate_page -> 'layout_json') <> '{"blocks": []}'::jsonb then
      raise exception 'direct_page_action_shape_invalid' using errcode = '22023';
    end if;
    return;
  end if;

  if base_page is null or candidate_page is null
    or candidate_page ->> 'id' <> base_page ->> 'id'
    or candidate_page ->> 'key' <> base_page ->> 'key'
    or candidate_page ->> 'slug' <> base_page ->> 'slug'
    or candidate_page ->> 'audience' <> base_page ->> 'audience'
    or operation ->> 'slug' <> base_page ->> 'slug'
    or operation ->> 'audience' <> base_page ->> 'audience'
    or exists (
      select 1 from jsonb_array_elements(base_snapshot -> 'pages') as existing_page
      where existing_page ->> 'key' <> target_key
        and not exists (
          select 1 from jsonb_array_elements(candidate_snapshot -> 'pages') as next_page
          where next_page = existing_page
        )
    )
    or exists (
      select 1 from jsonb_array_elements(candidate_snapshot -> 'pages') as next_page
      where next_page ->> 'key' <> target_key
        and not exists (
          select 1 from jsonb_array_elements(base_snapshot -> 'pages') as existing_page
          where existing_page = next_page
        )
    )
  then
    raise exception 'direct_page_action_shape_invalid' using errcode = '22023';
  end if;

  if action_kind = 'rename_page' then
    if candidate_page ->> 'title' <> operation ->> 'title'
      or candidate_page -> 'layout_json' <> operation -> 'layout_json'
      or not private.direct_page_layouts_equal_v1(base_page -> 'layout_json', operation -> 'layout_json')
      or (candidate_page - 'title' - 'layout_json') <> (base_page - 'title' - 'layout_json')
      or candidate_page ->> 'title' = base_page ->> 'title'
    then raise exception 'direct_page_action_shape_invalid' using errcode = '22023'; end if;
  elsif action_kind = 'save_page_layout' then
    if candidate_page ->> 'title' <> operation ->> 'title'
      or candidate_page -> 'layout_json' <> operation -> 'layout_json'
      or (candidate_page - 'layout_json') <> (base_page - 'layout_json')
      or private.direct_page_layouts_equal_v1(base_page -> 'layout_json', operation -> 'layout_json')
    then raise exception 'direct_page_action_shape_invalid' using errcode = '22023'; end if;
  elsif action_kind in ('archive_page', 'restore_page') then
    if base_page ->> 'audience' <> 'internal'
      or candidate_page ->> 'title' <> base_page ->> 'title'
      or candidate_page -> 'layout_json' <> base_page -> 'layout_json'
      or candidate_page ->> 'status' <> base_page ->> 'status'
      or candidate_page ->> 'is_active' = base_page ->> 'is_active'
      or operation -> 'layout_json' <> base_page -> 'layout_json'
      or (action_kind = 'archive_page' and (candidate_page ->> 'is_active')::boolean)
      or (action_kind = 'restore_page' and not (candidate_page ->> 'is_active')::boolean)
    then raise exception 'direct_page_action_shape_invalid' using errcode = '22023'; end if;
  else
    raise exception 'direct_page_action_shape_invalid' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.apply_direct_page_configuration_change(
  expected_business_id uuid,
  expected_actor_id uuid,
  expected_base_version_id uuid,
  expected_head_revision bigint,
  requested_action_kind text,
  requested_operations jsonb
)
returns public.configuration_change_sets
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  proposed public.configuration_change_sets;
  validated public.configuration_change_sets;
  applied public.configuration_change_sets;
  base_version public.configuration_versions;
begin
  if current_actor_id is null then raise exception 'configuration_authentication_required' using errcode = '42501'; end if;
  if current_actor_id is distinct from expected_actor_id then raise exception 'configuration_actor_context_mismatch' using errcode = '42501'; end if;
  if not private.can_manage_tenant(expected_business_id) then raise exception 'configuration_owner_or_admin_required' using errcode = '42501'; end if;
  if requested_action_kind not in ('create_page', 'rename_page', 'save_page_layout', 'publish_page_changes', 'duplicate_page', 'archive_page', 'restore_page', 'create_checklist') then
    raise exception 'direct_page_action_shape_invalid' using errcode = '22023';
  end if;

  proposed := public.propose_configuration_change(
    expected_business_id, expected_actor_id, expected_base_version_id,
    expected_head_revision, left('Page Workspace: ' || requested_action_kind, 120),
    'direct_page_workspace:' || requested_action_kind, requested_operations
  );
  select version.* into base_version
  from public.configuration_versions as version
  where version.business_id = expected_business_id and version.id = proposed.base_version_id;
  if not found then raise exception 'direct_page_action_shape_invalid' using errcode = '22023'; end if;

  perform private.assert_direct_page_action_shape_v1(
    requested_action_kind, base_version.snapshot_json,
    proposed.candidate_snapshot_json, proposed.operations_json
  );
  validated := public.validate_configuration_change(expected_business_id, expected_actor_id, proposed.id);
  if validated.status <> 'validated' or validated.validation_result_json ->> 'outcome' <> 'valid' then
    raise exception 'direct_configuration_change_incompatible' using errcode = 'P0001';
  end if;
  applied := public.apply_configuration_change(expected_business_id, expected_actor_id, proposed.id);
  if applied.status <> 'applied' then raise exception 'direct_configuration_change_incompatible' using errcode = 'P0001'; end if;
  return applied;
end;
$$;

revoke all on function public.apply_direct_page_configuration_change(uuid, uuid, uuid, bigint, text, jsonb) from public, anon, service_role;
grant execute on function public.apply_direct_page_configuration_change(uuid, uuid, uuid, bigint, text, jsonb) to authenticated;
