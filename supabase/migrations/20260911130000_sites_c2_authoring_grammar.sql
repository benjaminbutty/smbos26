-- Sites C2 authoring grammar compatibility.
--
-- This additive migration closes the reviewed C2 SQL projection gap while
-- preserving the C1/C2 persistence and authority boundaries:
-- * Section presentation metadata remains optional and strictly bounded.
-- * Existing canonical rich_text remains lossless when valid and fail-closed
--   when invalid during legacy adoption.
-- * Public record detail projections expose only an ordered public display
--   field allow-list; private source keys remain stripped.
--
-- Historical release bytes are immutable. Existing callers and old defaults
-- remain compatible because omitted Section presentation fields stay omitted.

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

  -- Site-only incomplete atomic states preserve a cleared editable value
  -- during autosave. They remain structurally finite and preparation rejects
  -- them on included Pages; historical Direct Page atoms keep their validator.
  if block ? 'draft_state' and block ->> 'type' in ('heading', 'text', 'button', 'callout') then
    if coalesce((
      block ->> 'draft_state' is distinct from 'incomplete'
      or (
        block ->> 'type' = 'heading' and (
          not private.site_json_has_only_keys_v1(block, array['type', 'text', 'level', 'id', 'draft_state'])
          or not private.site_valid_optional_string_v1(block -> 'text', 200)
          or (block ? 'level' and not (jsonb_typeof(block -> 'level') = 'number' and (block ->> 'level') in ('1', '2', '3')))
        )
      )
      or (
        block ->> 'type' = 'text' and (
          not private.site_json_has_only_keys_v1(block, array['type', 'text', 'id', 'draft_state'])
          or not private.site_valid_optional_string_v1(block -> 'text', 5000)
        )
      )
      or (
        block ->> 'type' = 'button' and (
          not private.site_json_has_only_keys_v1(block, array['type', 'label', 'href', 'style', 'id', 'draft_state'])
          or not private.site_valid_optional_string_v1(block -> 'label', 120)
          or not private.site_valid_optional_string_v1(block -> 'href', 2048)
          or (block ? 'style' and not private.site_json_string_in_v1(block -> 'style', array['primary', 'secondary']))
        )
      )
      or (
        block ->> 'type' = 'callout' and (
          not private.site_json_has_only_keys_v1(block, array['type', 'text', 'tone', 'id', 'draft_state'])
          or not private.site_valid_optional_string_v1(block -> 'text', 1000)
          or (block ? 'tone' and not private.site_json_string_in_v1(block -> 'tone', array['neutral', 'info', 'success', 'warning']))
        )
      )
    ), true) then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
    return;
  end if;

  if block ->> 'type' = 'image' then
    if coalesce((
      not (block ?& array['type', 'id'])
      or not private.site_json_has_only_keys_v1(block, array['type', 'asset_id', 'alt', 'caption', 'presentation', 'id', 'draft_state'])
      or (block ? 'draft_state' and not private.site_json_string_in_v1(block -> 'draft_state', array['complete', 'incomplete']))
      or (block ? 'asset_id' and not private.site_valid_uuid_v1(block -> 'asset_id'))
      or (block ? 'alt' and not private.site_valid_optional_string_v1(block -> 'alt', 300))
      or (block ? 'caption' and not private.site_valid_string_v1(block -> 'caption', 500))
      or (block ? 'presentation' and not private.site_json_string_in_v1(block -> 'presentation', array['content', 'wide']))
      or (coalesce(block ->> 'draft_state', 'complete') = 'complete'
        and (not (block ? 'asset_id') or not private.site_valid_string_v1(block -> 'alt', 300)))
    ), true) then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
    return;
  end if;

  if block ->> 'type' in ('heading', 'text', 'rich_text', 'button', 'public_form', 'booking', 'preorder', 'divider', 'callout') then
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
      or not private.site_json_has_only_keys_v1(block, array['type', 'summary', 'blocks', 'open', 'id', 'draft_state'])
      or not private.site_valid_optional_string_v1(block -> 'summary', 200)
      or jsonb_typeof(block -> 'blocks') <> 'array'
      or jsonb_array_length(block -> 'blocks') > 50
      or (block ? 'open' and jsonb_typeof(block -> 'open') is distinct from 'boolean')
      or (block ? 'draft_state' and not private.site_json_string_in_v1(block -> 'draft_state', array['complete', 'incomplete']))
      or (coalesce(block ->> 'draft_state', 'complete') = 'complete'
        and not private.site_valid_string_v1(block -> 'summary', 200))
    ), true) then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
    for child in select value from jsonb_array_elements(block -> 'blocks') loop
      perform private.site_assert_block_v1(child, nesting + 1);
    end loop;
    return;
  end if;

  if block ->> 'type' = 'gallery' then
    if coalesce((not (block ?& array['type', 'images', 'id'])
      or not private.site_json_has_only_keys_v1(block, array['type', 'images', 'presentation', 'id', 'draft_state'])
      or jsonb_typeof(block -> 'images') <> 'array'
      or jsonb_array_length(block -> 'images') > 12
      or (block ? 'presentation' and not private.site_json_string_in_v1(block -> 'presentation', array['grid', 'carousel']))
      or (block ? 'draft_state' and not private.site_json_string_in_v1(block -> 'draft_state', array['complete', 'incomplete']))
      or (coalesce(block ->> 'draft_state', 'complete') = 'complete' and jsonb_array_length(block -> 'images') = 0)
      or (coalesce(block ->> 'draft_state', 'complete') = 'complete' and exists (
        select 1 from jsonb_array_elements(block -> 'images') as gallery_image(value)
        where coalesce(gallery_image.value ->> 'draft_state', 'complete') = 'incomplete'
      ))
    ), true) then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
    for image_value in select value from jsonb_array_elements(block -> 'images') loop
      if coalesce((not private.site_json_has_only_keys_v1(image_value, array['asset_id', 'alt', 'caption', 'draft_state'])
        or (image_value ? 'asset_id' and not private.site_valid_uuid_v1(image_value -> 'asset_id'))
        or (image_value ? 'alt' and not private.site_valid_optional_string_v1(image_value -> 'alt', 300))
        or (image_value ? 'caption' and not private.site_valid_string_v1(image_value -> 'caption', 500))
        or (image_value ? 'draft_state' and not private.site_json_string_in_v1(image_value -> 'draft_state', array['complete', 'incomplete']))
        or (coalesce(image_value ->> 'draft_state', 'complete') = 'complete'
          and (not (image_value ? 'asset_id') or not private.site_valid_string_v1(image_value -> 'alt', 300)))
      ), true) then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
    end loop;
    if exists (
      select 1
      from jsonb_array_elements(block -> 'images') as gallery_image(value)
      where gallery_image.value ? 'asset_id'
      group by gallery_image.value ->> 'asset_id'
      having count(*) > 1
    ) then raise exception 'site_draft_invalid' using errcode = '22023'; end if;
    return;
  end if;

  if block ->> 'type' in ('collection', 'record_detail') then
    if block ->> 'type' = 'collection' then
      if coalesce((not (block ?& array['type', 'selection', 'public_field_keys', 'id'])
        or not private.site_json_has_only_keys_v1(block, array['type', 'object_key', 'selection', 'public_field_keys', 'presentation', 'detail_page_id', 'id', 'draft_state'])
        or (block ? 'object_key' and not private.site_valid_key_v1(block -> 'object_key'))
        or jsonb_typeof(block -> 'selection') is distinct from 'object'
        or not (block -> 'selection' ?& array['schema_version', 'record_ids'])
        or not private.site_json_has_only_keys_v1(block -> 'selection', array['schema_version', 'record_ids'])
        or jsonb_typeof(block -> 'selection' -> 'schema_version') is distinct from 'number'
        or (block -> 'selection' ->> 'schema_version') is distinct from '1'
        or jsonb_typeof(block -> 'selection' -> 'record_ids') is distinct from 'array'
        or jsonb_array_length(block -> 'selection' -> 'record_ids') > 500
        or jsonb_typeof(block -> 'public_field_keys') is distinct from 'array'
        or jsonb_array_length(block -> 'public_field_keys') > 50
        or (block ? 'presentation' and not private.site_json_string_in_v1(block -> 'presentation', array['cards', 'list', 'table']))
        or (block ? 'detail_page_id' and not private.site_valid_uuid_v1(block -> 'detail_page_id'))
        or (block ? 'draft_state' and not private.site_json_string_in_v1(block -> 'draft_state', array['complete', 'incomplete']))
        or (coalesce(block ->> 'draft_state', 'complete') = 'complete'
          and (not (block ? 'object_key') or jsonb_array_length(block -> 'public_field_keys') = 0))
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
      or not private.site_json_has_only_keys_v1(block, array['type', 'width', 'spacing', 'alignment', 'background', 'columns', 'id'])
      or (block ? 'width' and not private.site_json_string_in_v1(block -> 'width', array['content', 'wide']))
      or (block ? 'spacing' and not private.site_json_string_in_v1(block -> 'spacing', array['compact', 'comfortable', 'spacious']))
      or (block ? 'alignment' and not private.site_json_string_in_v1(block -> 'alignment', array['start', 'center', 'end']))
      or (block ? 'background' and not private.site_json_string_in_v1(block -> 'background', array['plain', 'tint']))
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
      'form', 'public_form', 'booking', 'preorder', 'view'
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
  rich_text_value jsonb;
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
    rich_text_value := (block_value - 'id') || jsonb_build_object('id', block_id);
    begin
      perform private.assert_valid_page_block_v2(rich_text_value, false);
      perform private.site_assert_legacy_block_types_v1(rich_text_value);
      return rich_text_value;
    exception when others then
      return jsonb_build_object(
        'type', 'callout', 'id', block_id,
        'text', 'This legacy rich text needs review before it can be published.',
        'tone', 'warning', 'draft_state', 'incomplete'
      );
    end;
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
        ),
        'display_field_keys', block -> 'public_field_keys'
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

