do $body$
declare
  function_sql text;
  old_fragment constant text :=
    $fragment$or (operations -> 4) - 'op' - 'layout_json' <> base_page - 'layout_json'$fragment$;
  new_fragment constant text :=
    $fragment$or (operations -> 4) - 'op' - 'layout_json' <> base_page - 'id' - 'layout_json'$fragment$;
begin
  select pg_get_functiondef('private.assert_direct_page_action_shape_v1(text,jsonb,jsonb,jsonb)'::regprocedure)
  into function_sql;
  if position(new_fragment in function_sql) = 0 then
    if position(old_fragment in function_sql) = 0 then
      raise exception 'Expected checklist operation identity guard was not found';
    end if;
    function_sql := replace(function_sql, old_fragment, new_fragment);
    execute function_sql;
  end if;
end;
$body$;
