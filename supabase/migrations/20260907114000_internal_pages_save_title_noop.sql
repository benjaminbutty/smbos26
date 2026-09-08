-- A Page title-only edit is a meaningful atomic save. Reject only a true
-- semantic no-op where both the title and layout remain unchanged.
do $do$
declare
  function_definition text;
  rewritten_definition text;
begin
  select pg_get_functiondef(
    'private.assert_direct_page_action_shape_v1(text,jsonb,jsonb,jsonb)'::regprocedure
  )
  into function_definition;
  -- Migrations are applied to databases that may already contain an
  -- equivalent CREATE OR REPLACE from a local development run. Match the
  -- semantic guard while allowing harmless formatter/whitespace differences.
  if function_definition ~ $pattern$candidate_page\s*->>\s*'title'\s*=\s*base_page\s*->>\s*'title'[\s\S]*?direct_page_layouts_equal_v1\s*\(\s*base_page\s*->\s*'layout_json'\s*,\s*operation\s*->\s*'layout_json'\s*\)$pattern$ then
    return;
  end if;

  rewritten_definition := regexp_replace(
    function_definition,
    $pattern$or\s+private\.direct_page_layouts_equal_v1\s*\(\s*base_page\s*->\s*'layout_json'\s*,\s*operation\s*->\s*'layout_json'\s*\)$pattern$,
    $replacement$or (
      candidate_page ->> 'title' = base_page ->> 'title'
      and private.direct_page_layouts_equal_v1(
        base_page -> 'layout_json', operation -> 'layout_json'
      )
    )$replacement$,
    1,
    1,
    'n'
  );
  if rewritten_definition = function_definition then
    raise exception 'Expected Page save no-op guard was not found';
  end if;
  execute rewritten_definition;
end;
$do$;
