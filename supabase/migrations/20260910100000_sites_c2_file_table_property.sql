-- Keep the direct Table Workspace allow-list aligned with the supported managed
-- File property.  File settings remain the empty object validated by the
-- existing strict configuration boundary.

create or replace function private.direct_table_type_is_supported_v2(
  requested_type text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    requested_type in (
      'short_text',
      'long_text',
      'number',
      'currency',
      'boolean',
      'date',
      'email',
      'phone',
      'url',
      'file',
      'select',
      'status'
    ),
    false
  );
$$;
