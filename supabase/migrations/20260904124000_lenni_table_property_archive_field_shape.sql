-- The archive operation deliberately carries only mutable Field attributes;
-- immutable database identifiers remain in the persisted snapshot.
do $$
declare
  function_definition text;
  old_check text := $check$
    or (base_field - 'is_active') <> (field_operation - 'is_active')
    or (base_field - 'is_active') <> (candidate_field - 'is_active')$check$;
  new_check text := $check$
    or field_operation ->> 'object_key' is distinct from base_field ->> 'object_key'
    or field_operation ->> 'key' is distinct from base_field ->> 'key'
    or field_operation ->> 'label' is distinct from base_field ->> 'label'
    or field_operation ->> 'field_type' is distinct from base_field ->> 'field_type'
    or field_operation -> 'required' is distinct from base_field -> 'required'
    or field_operation -> 'default_value' is distinct from base_field -> 'default_value'
    or field_operation -> 'settings_json' is distinct from base_field -> 'settings_json'
    or field_operation -> 'position' is distinct from base_field -> 'position'
    or (base_field - 'is_active') <> (candidate_field - 'is_active')$check$;
begin
  select pg_get_functiondef(
    'public.apply_lenni_table_property_archive(uuid,uuid,uuid,bigint,text,jsonb)'::regprocedure
  ) into function_definition;
  if position(old_check in function_definition) = 0 then
    raise exception 'direct_table_archive_function_shape_unexpected' using errcode = '22023';
  end if;
  execute replace(function_definition, old_check, new_check);
end;
$$;
