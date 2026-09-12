-- Availability epochs change on an authority transition. Attaching a managed
-- Record image prepares private data for a future release; it is not itself a
-- public withdrawal or re-enable operation.
alter function public.attach_site_record_media(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, bigint, bigint
) rename to attach_site_record_media_with_availability_v2;

create function public.attach_site_record_media(
  expected_business_id uuid,
  expected_actor_id uuid,
  requested_site_id uuid,
  requested_record_id uuid,
  requested_object_definition_id uuid,
  requested_field_definition_id uuid,
  requested_asset_id uuid,
  expected_record_revision bigint,
  expected_attachment_revision bigint
)
returns public.site_record_media_attachments
language plpgsql
security definer
set search_path = ''
as $$
declare
  had_media_availability boolean;
  result public.site_record_media_attachments;
begin
  select exists (
    select 1
    from public.site_public_media_availability as availability
    where availability.business_id = expected_business_id
      and availability.site_id = requested_site_id
      and availability.asset_id = requested_asset_id
  ) into had_media_availability;

  result := public.attach_site_record_media_with_availability_v2(
    expected_business_id,
    expected_actor_id,
    requested_site_id,
    requested_record_id,
    requested_object_definition_id,
    requested_field_definition_id,
    requested_asset_id,
    expected_record_revision,
    expected_attachment_revision
  );

  if not had_media_availability then
    delete from public.site_public_media_availability
    where business_id = expected_business_id
      and site_id = requested_site_id
      and asset_id = requested_asset_id
      and status = 'available'
      and availability_revision = 1;
  end if;
  return result;
end;
$$;

-- The C1 projector wrapper owns the configuration transition boundary. Set
-- both trusted markers here so callers that enter through the release path
-- receive the same source-trigger suppression as the owner Changes path.
alter function public.apply_configuration_change_c1_v1(uuid, uuid, uuid)
  rename to apply_configuration_change_c1_projection_v2;

create function public.apply_configuration_change_c1_v1(
  expected_business_id uuid,
  expected_actor_id uuid,
  requested_change_set_id uuid
)
returns public.configuration_change_sets
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  applied_change public.configuration_change_sets;
begin
  perform pg_catalog.set_config('smbos.site_configuration_write', 'on', true);
  begin
    applied_change := public.apply_configuration_change_c1_projection_v2(
      expected_business_id,
      expected_actor_id,
      requested_change_set_id
    );
    perform pg_catalog.set_config('smbos.site_configuration_write', 'off', true);
  exception when others then
    perform pg_catalog.set_config('smbos.site_configuration_write', 'off', true);
    raise;
  end;
  return applied_change;
end;
$$;

revoke all on function public.attach_site_record_media_with_availability_v2(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, bigint, bigint
), public.attach_site_record_media(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, bigint, bigint
), public.apply_configuration_change_c1_projection_v2(uuid, uuid, uuid),
public.apply_configuration_change_c1_v1(uuid, uuid, uuid)
from public, anon, authenticated, service_role;

grant execute on function public.attach_site_record_media(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, bigint, bigint
) to authenticated;
