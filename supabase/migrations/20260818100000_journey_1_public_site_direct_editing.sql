-- Journey 1 closeout: allow the existing bounded Page Workspace mutation
-- actions to edit public Pages while preserving their lifecycle and identity.

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

comment on function private.assert_direct_page_action_shape_v1(
  text, jsonb, jsonb, jsonb
) is
  'Validates one bounded direct Page action. Existing internal and public Pages may be renamed or have layout saved only when identity, audience, lifecycle and unrelated configuration are preserved; direct creation remains internal draft-only.';
