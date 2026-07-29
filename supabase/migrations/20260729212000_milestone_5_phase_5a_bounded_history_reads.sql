create or replace function public.list_configuration_change_sets(
  expected_business_id uuid
)
returns setof public.configuration_change_sets
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'configuration_authentication_required'
      using errcode = '42501';
  end if;
  if not private.can_manage_tenant(expected_business_id) then
    raise exception 'configuration_owner_or_admin_required'
      using errcode = '42501';
  end if;

  return query
  select change_set.*
  from public.configuration_change_sets as change_set
  where change_set.business_id = expected_business_id
  order by change_set.created_at desc, change_set.id desc
  limit 50;
end;
$$;

create or replace function public.list_configuration_versions(
  expected_business_id uuid
)
returns setof public.configuration_versions
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'configuration_authentication_required'
      using errcode = '42501';
  end if;
  if not private.can_manage_tenant(expected_business_id) then
    raise exception 'configuration_owner_or_admin_required'
      using errcode = '42501';
  end if;

  return query
  select version.*
  from public.configuration_versions as version
  where version.business_id = expected_business_id
  order by version.version_number desc, version.id desc
  limit 50;
end;
$$;

comment on function public.list_configuration_change_sets(uuid) is
  'Returns the latest 50 Owner/Admin configuration proposals in stable newest-first order.';

comment on function public.list_configuration_versions(uuid) is
  'Returns the latest 50 immutable configuration versions in stable newest-first order.';
