-- Row-locking the selected collection Records is part of the publication
-- transaction. PostgreSQL requires a function that executes FOR SHARE to be
-- volatile; the original C2 declaration was incorrectly marked STABLE.
create or replace function private.site_lock_selected_records_c2(
  target_business_id uuid,
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

-- C2 autosave accepts an intermediate detail selection while the owner is
-- still adding the shared detail block. Publication continues to use the
-- strict C1 detail grammar; this adapter only removes an incomplete relation
-- for that structural persistence check.
create or replace function private.site_strip_incomplete_detail_block_v2(
  block jsonb,
  detail_collection_ids uuid[]
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  child jsonb;
  child_blocks jsonb := '[]'::jsonb;
  column_value jsonb;
  columns_value jsonb := '[]'::jsonb;
begin
  if block ->> 'type' = 'collection'
    and block ? 'detail_page_id'
    and not ((block ->> 'id')::uuid = any(detail_collection_ids))
  then
    return block - 'detail_page_id';
  end if;
  if block ->> 'type' = 'collapsible' then
    for child in select value from jsonb_array_elements(block -> 'blocks') loop
      child_blocks := child_blocks || jsonb_build_array(
        private.site_strip_incomplete_detail_block_v2(child, detail_collection_ids)
      );
    end loop;
    return (block - 'blocks') || jsonb_build_object('blocks', child_blocks);
  end if;
  if block ->> 'type' = 'section' then
    for column_value in select value from jsonb_array_elements(block -> 'columns') loop
      child_blocks := '[]'::jsonb;
      for child in select value from jsonb_array_elements(column_value -> 'blocks') loop
        child_blocks := child_blocks || jsonb_build_array(
          private.site_strip_incomplete_detail_block_v2(child, detail_collection_ids)
        );
      end loop;
      columns_value := columns_value || jsonb_build_array(
        (column_value - 'blocks') || jsonb_build_object('blocks', child_blocks)
      );
    end loop;
    return (block - 'columns') || jsonb_build_object('columns', columns_value);
  end if;
  return block;
end;
$$;

create or replace function private.site_strip_incomplete_detail_bindings_v2(
  draft jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  detail_collection_ids uuid[] := coalesce((
    select array_agg((block_value.block ->> 'collection_block_id')::uuid)
    from private.site_draft_blocks_v1(draft) as block_value
    where block_value.block ->> 'type' = 'record_detail'
  ), array[]::uuid[]);
  page_value jsonb;
  block jsonb;
  blocks_value jsonb;
  pages_value jsonb := '[]'::jsonb;
begin
  for page_value in select value from jsonb_array_elements(draft -> 'pages') loop
    blocks_value := '[]'::jsonb;
    for block in select value from jsonb_array_elements(page_value -> 'layout' -> 'blocks') loop
      blocks_value := blocks_value || jsonb_build_array(
        private.site_strip_incomplete_detail_block_v2(block, detail_collection_ids)
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
  perform private.assert_site_draft_v1(
    private.site_strip_filter_draft_v2(
      private.site_strip_incomplete_detail_bindings_v2(draft)
    )
  );
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

-- The final token synchronizer must qualify the set-returning function's
-- column. The previous alias matched its local variable and raised 42702
-- during adoption/release preparation.
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
begin
  for site_block in
    select draft_block.*
    from private.site_draft_blocks_v1(draft) as draft_block
    join jsonb_array_elements(draft -> 'pages') as page_value(value)
      on (page_value.value ->> 'id')::uuid = draft_block.page_id
    where coalesce((page_value.value ->> 'is_included')::boolean, false)
      and draft_block.block ->> 'type' = 'collection'
  loop
    select definition.id into object_id
    from public.object_definitions as definition
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
    private.site_public_media_token_v2(target_site_id, included_asset.asset_id),
    included_asset.asset_id
  from private.site_included_draft_asset_ids_v2(draft) as included_asset(asset_id)
  on conflict (business_id, site_id, token) do update set asset_id = excluded.asset_id;
  insert into public.site_release_asset_references (business_id, release_id, asset_id)
  select target_business_id, target_release_id, included_asset.asset_id
  from private.site_included_draft_asset_ids_v2(draft) as included_asset(asset_id)
  on conflict do nothing;
end;
$$;
