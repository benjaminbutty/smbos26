-- Apply the recursive identity check to local databases that already have the
-- initial checklist guard. Every established ID in a retained block, including
-- contained blocks, must remain unchanged while legacy blocks may receive an
-- initial ID.

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
