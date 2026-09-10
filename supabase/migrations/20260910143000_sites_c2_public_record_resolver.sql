-- Keep the public detail resolver able to walk object-valued projections.
-- jsonb_each returns a key/value record; assigning that composite directly to
-- jsonb makes published collection detail resolution fail at runtime.
create or replace function private.site_find_public_record_v2(
  value jsonb,
  requested_token text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  child jsonb;
  found_value jsonb;
begin
  if jsonb_typeof(value) = 'object'
    and value ? 'values'
    and value ->> 'public_id' = requested_token
  then
    return value;
  end if;
  if jsonb_typeof(value) = 'object' then
    for child in
      select item.value
      from jsonb_each(value) as item(key, value)
    loop
      found_value := private.site_find_public_record_v2(child, requested_token);
      if found_value is not null then return found_value; end if;
    end loop;
  elsif jsonb_typeof(value) = 'array' then
    for child in select item from jsonb_array_elements(value) as item loop
      found_value := private.site_find_public_record_v2(child, requested_token);
      if found_value is not null then return found_value; end if;
    end loop;
  end if;
  return null;
end;
$$;
