-- Interaction Quality Reset: bounded canonical rich text for internal Pages.
--
-- This extends the existing Page JSON grammar and its database validation. It
-- adds no storage, grants, runtime, renderer or configuration lifecycle.

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
    raise exception 'Invalid Page rich text content'
      using errcode = '22023';
  end if;

  for span in select value from jsonb_array_elements(content)
  loop
    if not private.experience_json_has_only_keys(
      span,
      array['type', 'text', 'marks']
    )
      or span ->> 'type' <> 'text'
      or jsonb_typeof(span -> 'text') <> 'string'
      or char_length(span ->> 'text') not between 1 and 5000
    then
      raise exception 'Invalid Page rich text span'
        using errcode = '22023';
    end if;

    total_length := total_length + char_length(span ->> 'text');
    if total_length > maximum_length then
      raise exception 'Page rich text is too long'
        using errcode = '22023';
    end if;

    if span ? 'marks' then
      if jsonb_typeof(span -> 'marks') <> 'array'
        or jsonb_array_length(span -> 'marks') not between 0 and 3
      then
        raise exception 'Invalid Page rich text marks'
          using errcode = '22023';
      end if;

      seen_mark_types := array[]::text[];
      for mark in select value from jsonb_array_elements(span -> 'marks')
      loop
        mark_type := mark ->> 'type';
        if mark_type = any(seen_mark_types) then
          raise exception 'Repeated Page rich text mark'
            using errcode = '22023';
        end if;
        seen_mark_types := array_append(seen_mark_types, mark_type);

        if mark_type in ('bold', 'italic') then
          if not private.experience_json_has_only_keys(mark, array['type']) then
            raise exception 'Invalid Page rich text mark'
              using errcode = '22023';
          end if;
        elsif mark_type = 'link' then
          if not private.experience_json_has_only_keys(
            mark,
            array['type', 'href']
          )
            or jsonb_typeof(mark -> 'href') <> 'string'
            or char_length(mark ->> 'href') not between 1 and 2048
            or (mark ->> 'href') !~* '^(https?://|/|mailto:|tel:)[^[:space:]]+$'
          then
            raise exception 'Invalid Page rich text link'
              using errcode = '22023';
          end if;
        else
          raise exception 'Unsupported Page rich text mark'
            using errcode = '22023';
        end if;
      end loop;
    end if;
  end loop;
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
  block_type text;
  block_id text;
  node jsonb;
  item jsonb;
  seen_ids text[] := array[]::text[];
begin
  if not private.experience_json_has_only_keys(layout, array['blocks'])
    or jsonb_typeof(layout -> 'blocks') <> 'array'
    or jsonb_array_length(layout -> 'blocks') not between 0 and 100 then
    raise exception 'Invalid Page layout'
      using errcode = '22023';
  end if;

  for block in select value from jsonb_array_elements(layout -> 'blocks')
  loop
    block_type := block ->> 'type';

    if block ? 'id' then
      block_id := block ->> 'id';
      if jsonb_typeof(block -> 'id') <> 'string'
        or not private.configuration_uuid_is_valid(block_id)
        or block_id = any(seen_ids)
      then
        raise exception 'Page block IDs must be unique UUIDs'
          using errcode = '22023';
      end if;
      seen_ids := array_append(seen_ids, block_id);
    end if;

    if block_type = 'heading' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'text', 'level', 'id']
      ) or not private.experience_string_is_valid(block ->> 'text', 200)
        or (
          block ? 'level'
          and (
            jsonb_typeof(block -> 'level') <> 'number'
            or (block ->> 'level') !~ '^[123]$'
          )
        ) then
        raise exception 'Invalid heading Page block' using errcode = '22023';
      end if;
    elsif block_type = 'text' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'text', 'id']
      ) or not private.experience_string_is_valid(block ->> 'text', 5000) then
        raise exception 'Invalid text Page block' using errcode = '22023';
      end if;
    elsif block_type = 'rich_text' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'node', 'id']
      ) or jsonb_typeof(block -> 'node') <> 'object' then
        raise exception 'Invalid rich text Page block' using errcode = '22023';
      end if;
      node := block -> 'node';
      if node ->> 'type' = 'paragraph' then
        if not private.experience_json_has_only_keys(
          node,
          array['type', 'content']
        ) then
          raise exception 'Invalid Page paragraph' using errcode = '22023';
        end if;
        perform private.assert_valid_page_rich_text_content_v1(
          node -> 'content',
          5000
        );
      elsif node ->> 'type' = 'heading' then
        if not private.experience_json_has_only_keys(
          node,
          array['type', 'level', 'content']
        )
          or jsonb_typeof(node -> 'level') <> 'number'
          or (node ->> 'level') !~ '^[123]$'
        then
          raise exception 'Invalid rich text Page heading'
            using errcode = '22023';
        end if;
        perform private.assert_valid_page_rich_text_content_v1(
          node -> 'content',
          200
        );
      elsif node ->> 'type' in ('bullet_list', 'numbered_list') then
        if not private.experience_json_has_only_keys(
          node,
          array['type', 'items']
        )
          or jsonb_typeof(node -> 'items') <> 'array'
          or jsonb_array_length(node -> 'items') not between 1 and 50
        then
          raise exception 'Invalid Page list' using errcode = '22023';
        end if;
        for item in select value from jsonb_array_elements(node -> 'items')
        loop
          if not private.experience_json_has_only_keys(item, array['content'])
          then
            raise exception 'Invalid Page list item' using errcode = '22023';
          end if;
          perform private.assert_valid_page_rich_text_content_v1(
            item -> 'content',
            5000
          );
        end loop;
      else
        raise exception 'Unsupported Page rich text node'
          using errcode = '22023';
      end if;
    elsif block_type = 'image' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'src', 'alt', 'caption', 'id']
      ) or not private.experience_string_is_valid(block ->> 'src', 2048)
        or (block ->> 'src') !~* '^https?://[^[:space:]]+$'
        or not private.experience_string_is_valid(block ->> 'alt', 300)
        or (
          block ? 'caption'
          and not private.experience_string_is_valid(block ->> 'caption', 500)
        ) then
        raise exception 'Invalid image Page block' using errcode = '22023';
      end if;
    elsif block_type = 'button' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'label', 'href', 'style', 'id']
      ) or not private.experience_string_is_valid(block ->> 'label', 120)
        or not private.experience_string_is_valid(block ->> 'href', 2048)
        or (block ->> 'href') !~* '^(https?://|/|mailto:|tel:)[^[:space:]]+$'
        or (
          block ? 'style'
          and block ->> 'style' not in ('primary', 'secondary')
        ) then
        raise exception 'Invalid button Page block' using errcode = '22023';
      end if;
    elsif block_type = 'view' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'view_key', 'read_only', 'id']
      ) or not private.experience_key_is_valid(block ->> 'view_key')
        or (
          block ? 'read_only'
          and jsonb_typeof(block -> 'read_only') <> 'boolean'
        ) then
        raise exception 'Invalid View Page block' using errcode = '22023';
      end if;
    elsif block_type in ('form', 'public_form') then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'form_key', 'id']
      ) or not private.experience_key_is_valid(block ->> 'form_key') then
        raise exception 'Invalid Form Page block' using errcode = '22023';
      end if;
    elsif block_type = 'booking' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'booking_key', 'config', 'id']
      ) or not private.experience_key_is_valid(block ->> 'booking_key')
        or jsonb_typeof(block -> 'config') <> 'object' then
        raise exception 'Invalid Booking Page block' using errcode = '22023';
      end if;
    elsif block_type = 'preorder' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'preorder_key', 'id']
      ) or not private.experience_key_is_valid(block ->> 'preorder_key') then
        raise exception 'Invalid preorder Page block' using errcode = '22023';
      end if;
    elsif block_type = 'divider' then
      if not private.experience_json_has_only_keys(block, array['type', 'id'])
      then
        raise exception 'Invalid divider Page block' using errcode = '22023';
      end if;
    elsif block_type = 'callout' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'text', 'tone', 'id']
      ) or not private.experience_string_is_valid(block ->> 'text', 1000)
        or (
          block ? 'tone'
          and block ->> 'tone' not in ('neutral', 'info', 'success', 'warning')
        ) then
        raise exception 'Invalid Callout Page block' using errcode = '22023';
      end if;
    else
      raise exception 'Unsupported Page block type' using errcode = '22023';
    end if;
  end loop;
exception
  when invalid_text_representation then
    raise exception 'Invalid Page block value' using errcode = '22023';
end;
$$;

