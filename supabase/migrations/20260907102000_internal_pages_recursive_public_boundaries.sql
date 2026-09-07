-- Extend the existing public, preview and preorder SQL boundaries to the
-- contained-block grammar. The public endpoints must inspect every block even
-- when a private View/Form/asset sits inside a collapsible section.

create or replace function private.direct_page_normalize_block_v2(block jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case block ->> 'type'
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
    when 'image' then
      block || jsonb_build_object(
        'alt', coalesce(block -> 'alt', '""'::jsonb),
        'presentation', coalesce(block -> 'presentation', '"content"'::jsonb)
      )
    when 'callout' then
      block || jsonb_build_object(
        'tone', coalesce(block -> 'tone', '"info"'::jsonb)
      )
    when 'collapsible' then
      block || jsonb_build_object(
        'open', coalesce(block -> 'open', 'true'::jsonb),
        'blocks', coalesce(
          (
            select jsonb_agg(
              private.direct_page_normalize_block_v2(value)
              order by ordinal
            )
            from jsonb_array_elements(block -> 'blocks')
              with ordinality as child(value, ordinal)
          ),
          '[]'::jsonb
        )
      )
    else block
  end;
$$;

create or replace function private.direct_page_normalize_layout_v1(layout jsonb)
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
          private.direct_page_normalize_block_v2(value)
          order by ordinal
        )
        from jsonb_array_elements(layout -> 'blocks')
          with ordinality as item(value, ordinal)
      ),
      '[]'::jsonb
    )
  );
$$;

do $do$
declare
  function_definition text;
  function_oid oid;
begin
  -- These are the public and preview entry points that resolve a Page block
  -- before accepting a public submission or rendering a candidate. Keep the
  -- replacement at the function-definition boundary so each existing
  -- function retains its established permissions and transaction semantics.
  for function_oid in
    select procedure.oid
    from pg_proc as procedure
    join pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where procedure.prokind = 'f'
      and (
        (
          namespace.nspname = 'public'
          and procedure.proname in (
            'resolve_configuration_preview_preorder',
            'resolve_public_booking',
            'resolve_public_form',
            'submit_public_booking',
            'submit_public_booking_legacy',
            'submit_public_create_form',
            'submit_public_preorder'
          )
        )
        or (
          namespace.nspname = 'private'
          and procedure.proname in (
            'assert_configuration_candidate_v1',
            'assert_direct_page_action_shape_pre_j3_i4_v1',
            'claim_preorder_confirmation_email',
            'resolve_preorder_catalogue_at',
            'resolve_preorder_catalogue_at_m4',
            'submit_public_preorder_m4'
          )
        )
      )
  loop
    select pg_get_functiondef(function_oid) into function_definition;

    function_definition := replace(
      function_definition,
      'jsonb_array_elements(page.layout_json -> ''blocks'')',
      'private.page_blocks_v2(page.layout_json)'
    );
    function_definition := replace(
      function_definition,
      'jsonb_array_elements(configured_page.layout_json -> ''blocks'')',
      'private.page_blocks_v2(configured_page.layout_json)'
    );
    function_definition := replace(
      function_definition,
      'jsonb_array_elements(page_definition -> ''layout_json'' -> ''blocks'')',
      'private.page_blocks_v2(page_definition -> ''layout_json'')'
    );
    function_definition := replace(
      function_definition,
      'jsonb_array_elements(candidate.value -> ''layout_json'' -> ''blocks'')',
      'private.page_blocks_v2(candidate.value -> ''layout_json'')'
    );
    function_definition := replace(
      function_definition,
      'jsonb_array_elements(layout -> ''blocks'')',
      'private.page_blocks_v2(layout)'
    );
    function_definition := replace(
      function_definition,
      'jsonb_array_elements(page.layout_json -> ''blocks'')',
      'private.page_blocks_v2(page.layout_json)'
    );

    execute function_definition;
  end loop;
end;
$do$;
