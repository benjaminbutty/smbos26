-- Workspace foundation: bounded Page grammar and direct Page Workspace actions.
--
-- Pages remain configuration over the existing M5 engine. This migration adds
-- only the reusable Page grammar needed by the manual workspace and a narrow
-- atomic facade for create, rename, and layout-save actions.

-- The local Postgres image does not expose jsonb_object_length. Keep the
-- existing direct Table helper behavior while using the portable key set.
create or replace function private.direct_table_value_is_meaningful_v1(
  candidate_value jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if candidate_value is null
    or jsonb_typeof(candidate_value) = 'null'
  then
    return false;
  end if;

  if jsonb_typeof(candidate_value) = 'string' then
    return btrim(candidate_value #>> '{}') <> '';
  end if;

  if jsonb_typeof(candidate_value) = 'array' then
    return jsonb_array_length(candidate_value) > 0;
  end if;

  if jsonb_typeof(candidate_value) = 'object' then
    return exists (
      select 1
      from jsonb_object_keys(candidate_value)
    );
  end if;

  return true;
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
  seen_ids text[] := array[]::text[];
begin
  if not private.experience_json_has_only_keys(layout, array['blocks'])
    or jsonb_typeof(layout -> 'blocks') <> 'array'
    or jsonb_array_length(layout -> 'blocks') not between 0 and 100 then
    raise exception 'Invalid Page layout'
      using errcode = '22023';
  end if;

  for block in
    select value
    from jsonb_array_elements(layout -> 'blocks')
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
        raise exception 'Invalid heading Page block'
          using errcode = '22023';
      end if;
    elsif block_type = 'text' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'text', 'id']
      ) or not private.experience_string_is_valid(block ->> 'text', 5000) then
        raise exception 'Invalid text Page block'
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
        raise exception 'Invalid image Page block'
          using errcode = '22023';
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
        raise exception 'Invalid button Page block'
          using errcode = '22023';
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
        raise exception 'Invalid View Page block'
          using errcode = '22023';
      end if;
    elsif block_type = 'form' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'form_key', 'id']
      ) or not private.experience_key_is_valid(block ->> 'form_key') then
        raise exception 'Invalid Form Page block'
          using errcode = '22023';
      end if;
    elsif block_type = 'preorder' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'preorder_key', 'id']
      ) or not private.experience_key_is_valid(block ->> 'preorder_key') then
        raise exception 'Invalid preorder Page block'
          using errcode = '22023';
      end if;
    elsif block_type = 'divider' then
      if not private.experience_json_has_only_keys(block, array['type', 'id']) then
        raise exception 'Invalid divider Page block'
          using errcode = '22023';
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
        raise exception 'Invalid Callout Page block'
          using errcode = '22023';
      end if;
    else
      raise exception 'Unsupported Page block type'
        using errcode = '22023';
    end if;
  end loop;
exception
  when invalid_text_representation then
    raise exception 'Invalid Page block value'
      using errcode = '22023';
end;
$$;

create or replace function private.direct_page_normalize_layout_v1(
  layout jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'blocks',
    coalesce(
      (
        select jsonb_agg(
          case block ->> 'type'
            when 'heading' then
              block || jsonb_build_object(
                'level', coalesce(block -> 'level', '2'::jsonb)
              )
            when 'button' then
              block || jsonb_build_object(
                'style', coalesce(block -> 'style', '"primary"'::jsonb)
              )
            when 'view' then
              block || jsonb_build_object(
                'read_only', coalesce(block -> 'read_only', 'false'::jsonb)
              )
            when 'callout' then
              block || jsonb_build_object(
                'tone', coalesce(block -> 'tone', '"info"'::jsonb)
              )
            else block
          end
          order by ordinal
        )
        from jsonb_array_elements(layout -> 'blocks')
          with ordinality as item(block, ordinal)
      ),
      '[]'::jsonb
    )
  );
$$;

create or replace function private.direct_page_layouts_equal_v1(
  first_layout jsonb,
  second_layout jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select private.direct_page_normalize_layout_v1(first_layout) =
    private.direct_page_normalize_layout_v1(second_layout);
$$;

create or replace function private.direct_page_snapshot_collections_unchanged_v1(
  base_snapshot jsonb,
  candidate_snapshot jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (base_snapshot - 'pages') = (candidate_snapshot - 'pages');
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
begin
  if action_kind not in ('create_page', 'rename_page', 'save_page_layout')
    or jsonb_typeof(operations) <> 'array'
    or jsonb_array_length(operations) <> 1
  then
    raise exception 'direct_page_action_shape_invalid'
      using errcode = '22023';
  end if;

  perform private.assert_configuration_operations_v1(operations);

  select value into operation
  from jsonb_array_elements(operations) as value
  where value ->> 'op' = 'set_page';
  if operation is null then
    raise exception 'direct_page_action_shape_invalid'
      using errcode = '22023';
  end if;

  target_key := operation ->> 'key';
  select value into base_page
  from jsonb_array_elements(base_snapshot -> 'pages') as value
  where value ->> 'key' = target_key;
  select value into candidate_page
  from jsonb_array_elements(candidate_snapshot -> 'pages') as value
  where value ->> 'key' = target_key;

  if not private.direct_page_snapshot_collections_unchanged_v1(
    base_snapshot,
    candidate_snapshot
  ) then
    raise exception 'direct_page_action_shape_invalid'
      using errcode = '22023';
  end if;

  if action_kind = 'create_page' then
    if base_page is not null
      or candidate_page is null
      or jsonb_array_length(candidate_snapshot -> 'pages') <>
        jsonb_array_length(base_snapshot -> 'pages') + 1
      or not (base_snapshot -> 'pages') <@ (candidate_snapshot -> 'pages')
      or candidate_page - 'id' <> operation - 'op'
      or operation ->> 'audience' <> 'internal'
      or operation ->> 'status' <> 'draft'
      or not (operation ->> 'is_active')::boolean
      or exists (
        select 1
        from jsonb_array_elements(base_snapshot -> 'pages') as existing_page
        where existing_page ->> 'id' = candidate_page ->> 'id'
      )
      or (candidate_page -> 'layout_json') <> '{"blocks": []}'::jsonb
    then
      raise exception 'direct_page_action_shape_invalid'
        using errcode = '22023';
    end if;
    return;
  end if;

  if base_page is null
    or candidate_page is null
    or not (base_page ->> 'is_active')::boolean
    or base_page ->> 'audience' <> 'internal'
    or candidate_page ->> 'id' <> base_page ->> 'id'
    or candidate_page ->> 'key' <> base_page ->> 'key'
    or candidate_page ->> 'slug' <> base_page ->> 'slug'
    or candidate_page ->> 'audience' <> base_page ->> 'audience'
    or candidate_page ->> 'status' <> base_page ->> 'status'
    or candidate_page ->> 'is_active' <> base_page ->> 'is_active'
    or operation ->> 'slug' <> base_page ->> 'slug'
    or operation ->> 'audience' <> base_page ->> 'audience'
    or operation ->> 'status' <> base_page ->> 'status'
    or operation ->> 'is_active' <> base_page ->> 'is_active'
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
    raise exception 'direct_page_action_shape_invalid'
      using errcode = '22023';
  end if;

  if action_kind = 'rename_page' then
    if candidate_page ->> 'title' <> operation ->> 'title'
      or candidate_page -> 'layout_json' <> operation -> 'layout_json'
      or not private.direct_page_layouts_equal_v1(
        base_page -> 'layout_json',
        operation -> 'layout_json'
      )
      or (candidate_page - 'title' - 'layout_json') <>
        (base_page - 'title' - 'layout_json')
      or candidate_page ->> 'title' = base_page ->> 'title'
    then
      raise exception 'direct_page_action_shape_invalid'
        using errcode = '22023';
    end if;
  elsif action_kind = 'save_page_layout' then
    if candidate_page ->> 'title' <> operation ->> 'title'
      or candidate_page -> 'layout_json' <> operation -> 'layout_json'
      or (candidate_page - 'layout_json') <>
        (base_page - 'layout_json')
      or private.direct_page_layouts_equal_v1(
        base_page -> 'layout_json',
        operation -> 'layout_json'
      )
    then
      raise exception 'direct_page_action_shape_invalid'
        using errcode = '22023';
    end if;
  else
    raise exception 'direct_page_action_shape_invalid'
      using errcode = '22023';
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
  if current_actor_id is null then
    raise exception 'configuration_authentication_required'
      using errcode = '42501';
  end if;
  if current_actor_id is distinct from expected_actor_id then
    raise exception 'configuration_actor_context_mismatch'
      using errcode = '42501';
  end if;
  if not private.can_manage_tenant(expected_business_id) then
    raise exception 'configuration_owner_or_admin_required'
      using errcode = '42501';
  end if;
  if requested_action_kind not in (
    'create_page',
    'rename_page',
    'save_page_layout'
  ) then
    raise exception 'direct_page_action_shape_invalid'
      using errcode = '22023';
  end if;

  proposed := public.propose_configuration_change(
    expected_business_id,
    expected_actor_id,
    expected_base_version_id,
    expected_head_revision,
    left('Page Workspace: ' || requested_action_kind, 120),
    'direct_page_workspace:' || requested_action_kind,
    requested_operations
  );

  select version.* into base_version
  from public.configuration_versions as version
  where version.business_id = expected_business_id
    and version.id = proposed.base_version_id;
  if not found then
    raise exception 'direct_page_action_shape_invalid'
      using errcode = '22023';
  end if;

  perform private.assert_direct_page_action_shape_v1(
    requested_action_kind,
    base_version.snapshot_json,
    proposed.candidate_snapshot_json,
    proposed.operations_json
  );

  validated := public.validate_configuration_change(
    expected_business_id,
    expected_actor_id,
    proposed.id
  );
  if validated.status <> 'validated'
    or validated.validation_result_json ->> 'outcome' <> 'valid'
  then
    raise exception 'direct_configuration_change_incompatible'
      using errcode = 'P0001';
  end if;

  applied := public.apply_configuration_change(
    expected_business_id,
    expected_actor_id,
    proposed.id
  );
  if applied.status <> 'applied' then
    raise exception 'direct_configuration_change_incompatible'
      using errcode = 'P0001';
  end if;
  return applied;
end;
$$;

revoke all on function public.apply_direct_page_configuration_change(
  uuid, uuid, uuid, bigint, text, jsonb
) from public, anon, service_role;
grant execute on function public.apply_direct_page_configuration_change(
  uuid, uuid, uuid, bigint, text, jsonb
) to authenticated;

comment on function public.apply_direct_page_configuration_change(
  uuid, uuid, uuid, bigint, text, jsonb
) is
  'Atomic owner-facing Page Workspace action over the M5 configuration engine.';
