-- Keep the additive Pages rollout green under PostgreSQL schema lint. The
-- archive function is historical application code; replace only the
-- ambiguous JSONB subtraction expression rather than editing its immutable
-- migration in place.
do $do$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.apply_lenni_table_property_archive(uuid,uuid,uuid,bigint,text,jsonb)'::regprocedure
  ) into function_definition;

  function_definition := replace(
    function_definition,
    'candidate_form -> ''config_json'' - ''fields''::text <> base_form -> ''config_json'' - ''fields''::text',
    '(candidate_form -> ''config_json'') - ''fields''::text <> (base_form -> ''config_json'') - ''fields''::text'
  );

  if function_definition not like '%(candidate_form -> ''config_json'') - ''fields''::text%' then
    raise exception 'table_archive_lint_shape_unexpected' using errcode = '22023';
  end if;

  execute function_definition;
end;
$do$;

-- The recursive page validator only needs existence checks for forms. Avoid
-- retaining an unread composite row variable in the function body.
do $do$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'private.assert_valid_experience_page(uuid,experience_audience,jsonb,experience_page_status)'::regprocedure
  ) into function_definition;

  function_definition := replace(
    function_definition,
    E'  configured_form public.forms;' || chr(10),
    ''
  );
  function_definition := replace(function_definition, 'select * into configured_form', 'perform 1');

  if function_definition like '%configured_form public.forms%' then
    raise exception 'page_validator_lint_shape_unexpected' using errcode = '22023';
  end if;

  execute function_definition;
end;
$do$;
