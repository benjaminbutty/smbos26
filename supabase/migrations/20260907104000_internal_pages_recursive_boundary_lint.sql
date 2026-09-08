-- Keep the recursive page-block helper's set-returning column explicit when it
-- is used from legacy candidate validation.  PostgreSQL exposes the helper's
-- result as `block`, rather than the `value` alias used by
-- jsonb_array_elements.
do $$
declare
  function_oid oid;
  function_sql text;
begin
  select p.oid
  into function_oid
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'assert_configuration_candidate_v1'
    and pg_get_function_identity_arguments(p.oid) = 'target_business_id uuid, candidate jsonb';

  if function_oid is null then
    raise exception 'private.assert_configuration_candidate_v1 not found';
  end if;

  function_sql := pg_get_functiondef(function_oid);
  function_sql := replace(
    function_sql,
    E'select value\n        from private.page_blocks_v2(',
    E'select block\n        from private.page_blocks_v2('
  );
  execute function_sql;
end;
$$;
