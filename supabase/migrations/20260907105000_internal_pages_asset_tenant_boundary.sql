-- Managed image references are tenant-owned.  Keep the shared Page trigger
-- authoritative so a forged asset UUID cannot enter a historical Version.
do $$
declare
  function_oid oid;
  function_sql text;
  old_fragment text := E'    if block ->> ''type'' = ''image'' and block ? ''asset_id''\n      and requested_audience = ''public''\n    then\n      raise exception ''Private Page media requires an internal Page''\n        using errcode = ''23514'';\n    elsif block ->> ''type'' = ''view'' then';
  new_fragment text := E'    if block ->> ''type'' = ''image'' and block ? ''asset_id'' then\n      if requested_audience = ''public'' then\n        raise exception ''Private Page media requires an internal Page''\n          using errcode = ''23514'';\n      end if;\n      perform 1\n      from public.media_assets\n      where business_id = target_business_id\n        and id = (block ->> ''asset_id'')::uuid\n      for share;\n      if not found then\n        raise exception ''Page media reference is invalid'' using errcode = ''23514'';\n      end if;\n    elsif block ->> ''type'' = ''view'' then';
begin
  select p.oid
  into function_oid
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'assert_valid_experience_page'
    and pg_get_function_identity_arguments(p.oid) =
      'target_business_id uuid, requested_audience experience_audience, layout jsonb, requested_status experience_page_status';

  if function_oid is null then
    raise exception 'private.assert_valid_experience_page not found';
  end if;

  function_sql := pg_get_functiondef(function_oid);
  if position(old_fragment in function_sql) = 0 then
    raise exception 'Managed asset validation insertion point not found';
  end if;
  execute replace(function_sql, old_fragment, new_fragment);
end;
$$;
