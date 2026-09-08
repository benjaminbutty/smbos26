-- Some historical SQL functions format the Page block expression across
-- multiple lines. Replace those forms as well so proposal validation and
-- preorder/preview resolution cannot skip contained blocks.
do $do$
declare
  function_definition text;
  function_oid oid;
begin
  for function_oid in
    select procedure.oid
    from pg_proc as procedure
    join pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where procedure.prokind = 'f'
      and (
        (
          namespace.nspname = 'private'
          and procedure.proname in (
            'assert_configuration_candidate_v1',
            'resolve_preorder_catalogue_at_m4',
            'submit_public_preorder_m4'
          )
        )
        or (
          namespace.nspname = 'public'
          and procedure.proname = 'resolve_configuration_preview_preorder'
        )
      )
  loop
    select pg_get_functiondef(function_oid) into function_definition;

    function_definition := regexp_replace(
      function_definition,
      E'jsonb_array_elements\\(\\s*page_definition -> ''layout_json'' -> ''blocks''\\s*\\)',
      'private.page_blocks_v2(page_definition -> ''layout_json'')',
      'g'
    );
    function_definition := regexp_replace(
      function_definition,
      E'jsonb_array_elements\\(\\s*configured_page\\.layout_json -> ''blocks''\\s*\\)',
      'private.page_blocks_v2(configured_page.layout_json)',
      'g'
    );
    function_definition := regexp_replace(
      function_definition,
      E'jsonb_array_elements\\(\\s*candidate\.value -> ''layout_json'' -> ''blocks''\\s*\\)',
      'private.page_blocks_v2(candidate.value -> ''layout_json'')',
      'g'
    );

    execute function_definition;
  end loop;
end;
$do$;
