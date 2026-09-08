-- The Page editor persists a title and body through one atomic
-- `save_page_layout` action. A title-only edit is a valid change even when
-- its layout is byte-for-byte identical to the base snapshot. This additive
-- patch is deliberately tolerant of PostgreSQL's formatter and of the
-- preceding document-workspace migration already carrying the canonical
-- guard. A database upgraded from the earlier Page implementation still
-- receives the same semantic rewrite.
do $do$
declare
  function_definition text;
  rewritten_definition text;
begin
  select pg_get_functiondef(
    'private.assert_direct_page_action_shape_v1(text,jsonb,jsonb,jsonb)'::regprocedure
  )
  into function_definition;

  if function_definition is null then
    raise exception 'internal_pages_atomic_title_save_patch_not_applied';
  end if;

  -- The document-workspace migration and this patch may both be present in a
  -- clean install. Treat the canonical save branch as already applied even
  -- when pg_get_functiondef has inserted line breaks or indentation.
  if function_definition ~ $pattern$elsif\s+action_kind\s*=\s*'save_page_layout'[\s\S]*?candidate_page\s*->>\s*'title'\s*=\s*base_page\s*->>\s*'title'[\s\S]*?direct_page_layouts_equal_v1\s*\($pattern$ then
    return;
  end if;

  rewritten_definition := regexp_replace(
    function_definition,
    $pattern$or\s*\(candidate_page\s*-\s*'layout_json'\)\s*<>\s*\(base_page\s*-\s*'layout_json'\)$pattern$,
    $replacement$or (candidate_page - 'title' - 'layout_json') <> (base_page - 'title' - 'layout_json')$replacement$,
    1,
    1,
    'n'
  );
  rewritten_definition := regexp_replace(
    rewritten_definition,
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
    raise exception 'internal_pages_atomic_title_save_patch_not_applied';
  end if;
  execute rewritten_definition;
end;
$do$;
