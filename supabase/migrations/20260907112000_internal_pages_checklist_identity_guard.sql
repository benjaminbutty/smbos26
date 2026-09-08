-- Tighten the nested checklist grammar without rewriting any historical
-- migration. Existing block content must remain in place; a legacy block
-- without an ID may receive its first stable ID during this composite action,
-- while an established ID can never be replaced.

create or replace function private.direct_page_checklist_block_identity_v1(
  base_block jsonb,
  candidate_block jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
begin
  if private.page_block_signature_v2(base_block) <>
    private.page_block_signature_v2(candidate_block)
    or (
      base_block ? 'id'
      and candidate_block ->> 'id' <> base_block ->> 'id'
    )
  then
    return false;
  end if;

  if base_block ->> 'type' = 'collapsible' then
    if jsonb_array_length(base_block -> 'blocks') <>
      jsonb_array_length(candidate_block -> 'blocks')
    then
      return false;
    end if;
    for block_index in 0..jsonb_array_length(base_block -> 'blocks') - 1 loop
      if not private.direct_page_checklist_block_identity_v1(
        base_block -> 'blocks' -> block_index,
        candidate_block -> 'blocks' -> block_index
      ) then
        return false;
      end if;
    end loop;
  end if;
  return true;
end;
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
      or not private.direct_page_checklist_block_identity_v1(
        base_blocks -> base_index,
        candidate_block
      )
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
    if private.direct_page_checklist_block_identity_v1(
      base_block,
      candidate_block
    ) then
      continue;
    end if;

    -- The bounded Page grammar permits one contained level. A changed
    -- collapsible therefore means precisely one new checklist child; its
    -- summary/open state and established identity remain unchanged.
    if base_block ->> 'type' <> 'collapsible'
      or candidate_block ->> 'type' <> 'collapsible'
      or (
        base_block ? 'id'
        and candidate_block ->> 'id' <> base_block ->> 'id'
      )
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
