-- Keep the Page-aware checklist composite narrow when its block is inserted
-- inside a collapsible section. The action still creates exactly one object,
-- two fields, one View and one set_page operation; this helper only changes
-- the structural comparison for the Page layout.

create or replace function private.direct_page_checklist_block_v1(
  block jsonb,
  expected_view_key text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (block - 'id') = jsonb_build_object(
    'type', 'view',
    'view_key', expected_view_key,
    'checklist', jsonb_build_object(
      'label_field', 'name',
      'completed_field', 'completed'
    )
  );
$$;

create or replace function private.direct_page_checklist_children_add_one_v1(
  base_blocks jsonb,
  candidate_blocks jsonb,
  expected_view_key text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  base_count integer;
  candidate_count integer;
  base_index integer;
  candidate_index integer := 0;
  candidate_block jsonb;
  inserted boolean := false;
begin
  if jsonb_typeof(base_blocks) <> 'array'
    or jsonb_typeof(candidate_blocks) <> 'array'
  then
    return false;
  end if;

  base_count := jsonb_array_length(base_blocks);
  candidate_count := jsonb_array_length(candidate_blocks);
  if candidate_count <> base_count + 1 then
    return false;
  end if;

  for base_index in 0..base_count - 1 loop
    candidate_block := candidate_blocks -> candidate_index;
    if not inserted
      and private.direct_page_checklist_block_v1(
        candidate_block,
        expected_view_key
      )
    then
      inserted := true;
      candidate_index := candidate_index + 1;
      candidate_block := candidate_blocks -> candidate_index;
    end if;
    if candidate_block is null
      or private.page_block_signature_v2(candidate_block) <>
        private.page_block_signature_v2(base_blocks -> base_index)
    then
      return false;
    end if;
    candidate_index := candidate_index + 1;
  end loop;

  if not inserted
    and candidate_index < candidate_count
    and private.direct_page_checklist_block_v1(
      candidate_blocks -> candidate_index,
      expected_view_key
    )
  then
    inserted := true;
    candidate_index := candidate_index + 1;
  end if;

  return inserted and candidate_index = candidate_count;
end;
$$;

create or replace function private.direct_page_checklist_layout_changed_v1(
  base_layout jsonb,
  candidate_layout jsonb,
  expected_view_key text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  base_blocks jsonb := base_layout -> 'blocks';
  candidate_blocks jsonb := candidate_layout -> 'blocks';
  base_count integer;
  candidate_count integer;
  block_index integer;
  base_block jsonb;
  candidate_block jsonb;
  nested_inserted boolean := false;
begin
  if jsonb_typeof(base_blocks) <> 'array'
    or jsonb_typeof(candidate_blocks) <> 'array'
  then
    return false;
  end if;

  base_count := jsonb_array_length(base_blocks);
  candidate_count := jsonb_array_length(candidate_blocks);

  if candidate_count = base_count + 1 then
    return private.direct_page_checklist_children_add_one_v1(
      base_blocks,
      candidate_blocks,
      expected_view_key
    );
  end if;

  if candidate_count <> base_count then
    return false;
  end if;

  for block_index in 0..base_count - 1 loop
    base_block := base_blocks -> block_index;
    candidate_block := candidate_blocks -> block_index;
    if private.page_block_signature_v2(base_block) =
      private.page_block_signature_v2(candidate_block)
    then
      continue;
    end if;

    -- The bounded Page grammar permits one contained level. A changed
    -- collapsible therefore means precisely one new checklist child; its
    -- summary/open state and identity remain unchanged.
    if base_block ->> 'type' <> 'collapsible'
      or candidate_block ->> 'type' <> 'collapsible'
      or (base_block - 'id' - 'blocks') <>
        (candidate_block - 'id' - 'blocks')
      or nested_inserted
      or not private.direct_page_checklist_children_add_one_v1(
        base_block -> 'blocks',
        candidate_block -> 'blocks',
        expected_view_key
      )
    then
      return false;
    end if;
    nested_inserted := true;
  end loop;

  return nested_inserted;
end;
$$;

do $do$
declare
  function_definition text;
  old_fragment constant text := $fragment$
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
      )$fragment$;
  new_fragment constant text := $fragment$
      or not private.direct_page_checklist_layout_changed_v1(
        base_page -> 'layout_json',
        candidate_page -> 'layout_json',
        view_key
      )$fragment$;
begin
  select pg_get_functiondef(
    'private.assert_direct_page_action_shape_v1(text,jsonb,jsonb,jsonb)'::regprocedure
  )
  into function_definition;
  if position(old_fragment in function_definition) = 0 then
    raise exception 'Expected checklist Page layout guard was not found';
  end if;
  function_definition := replace(function_definition, old_fragment, new_fragment);
  -- Make the non-Page and non-target Page collection invariants explicit for
  -- the composite branch. The operation list length/op positions above remain
  -- the narrow allow-list, including exactly one set_page operation.
  function_definition := replace(
    function_definition,
    $fragment$      or (candidate_snapshot - 'object_definitions' - 'field_definitions' - 'views' - 'pages') <>
         (base_snapshot - 'object_definitions' - 'field_definitions' - 'views' - 'pages')$fragment$,
    $fragment$      or not private.direct_page_snapshot_collections_unchanged_v1(
        base_snapshot,
        candidate_snapshot
      )
      or jsonb_array_length(candidate_snapshot -> 'pages') <>
        jsonb_array_length(base_snapshot -> 'pages')
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
      )$fragment$
  );
  execute function_definition;
end;
$do$;

comment on function private.direct_page_checklist_layout_changed_v1(jsonb, jsonb, text) is
  'Accepts exactly one new bounded checklist View at one Page position, including one contained collapsible level, while preserving every existing block and Page collection.';
