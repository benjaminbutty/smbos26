-- Keep the checklist composite's collection guard aligned with the four
-- collections it is allowed to create. Pages are checked separately so the
-- target Page may change while every other snapshot collection stays exact.
do $do$
declare
  function_definition text;
  old_fragment constant text := $fragment$
      or not private.direct_page_snapshot_collections_unchanged_v1(
        base_snapshot,
        candidate_snapshot
      )
      or jsonb_array_length(candidate_snapshot -> 'pages') <>
        jsonb_array_length(base_snapshot -> 'pages')
      or exists ($fragment$;
  new_fragment constant text := $fragment$
      or (candidate_snapshot - 'object_definitions' - 'field_definitions' - 'views' - 'pages') <>
        (base_snapshot - 'object_definitions' - 'field_definitions' - 'views' - 'pages')
      or jsonb_array_length(candidate_snapshot -> 'pages') <>
        jsonb_array_length(base_snapshot -> 'pages')
      or exists ($fragment$;
begin
  select pg_get_functiondef(
    'private.assert_direct_page_action_shape_v1(text,jsonb,jsonb,jsonb)'::regprocedure
  )
  into function_definition;
  if position(old_fragment in function_definition) = 0 then
    raise exception 'Expected checklist collection guard was not found';
  end if;
  execute replace(function_definition, old_fragment, new_fragment);
end;
$do$;
