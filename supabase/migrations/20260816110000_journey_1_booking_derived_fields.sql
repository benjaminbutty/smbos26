-- Journey 1 Booking constructability hardening.
--
-- A configured Booking may use ordinary date/time Fields in addition to its
-- canonical start_at Field. Those values are derived from the revalidated
-- slot on the server. They are represented as derived public Fields so the
-- existing transaction remains allow-listed, while the browser never edits
-- or chooses them.

alter function public.submit_public_booking(text, text, text, uuid, jsonb, text)
  rename to submit_public_booking_legacy;

create or replace function public.submit_public_booking(
  requested_business_slug text,
  requested_page_slug text,
  requested_booking_key text,
  requested_idempotency_token uuid,
  requested_submission jsonb,
  requested_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  business_id_value uuid;
  business_timezone text;
  block_config jsonb;
  schedule jsonb;
  timezone_value text;
  start_at_value timestamptz;
  local_start timestamp;
  date_key text;
  time_key text;
  booking_data jsonb;
  enriched_submission jsonb;
begin
  select business.id, business.timezone, block -> 'config'
  into business_id_value, business_timezone, block_config
  from public.businesses as business
  join public.pages as page on page.business_id = business.id
  cross join lateral jsonb_array_elements(page.layout_json -> 'blocks') as block
  where business.slug = requested_business_slug
    and page.slug = requested_page_slug
    and page.audience = 'public'
    and page.status = 'published'
    and page.is_active
    and block ->> 'type' = 'booking'
    and block ->> 'booking_key' = requested_booking_key
  limit 1;

  if business_id_value is null
    or requested_submission is null
    or jsonb_typeof(requested_submission) <> 'object'
    or requested_submission ->> 'start_at' is null then
    return public.submit_public_booking_legacy(
      requested_business_slug,
      requested_page_slug,
      requested_booking_key,
      requested_idempotency_token,
      requested_submission,
      requested_request_hash
    );
  end if;

  date_key := block_config -> 'field_mappings' -> 'booking' ->> 'date';
  time_key := block_config -> 'field_mappings' -> 'booking' ->> 'time';
  if date_key is null and time_key is null then
    return public.submit_public_booking_legacy(
      requested_business_slug,
      requested_page_slug,
      requested_booking_key,
      requested_idempotency_token,
      requested_submission,
      requested_request_hash
    );
  end if;

  schedule := block_config -> 'schedule';
  if schedule ->> 'timezone_source' = 'location' then
    select location.timezone into timezone_value
    from public.locations as location
    where location.business_id = business_id_value
      and location.id = (schedule ->> 'location_id')::uuid
      and location.is_active;
  else
    timezone_value := business_timezone;
  end if;

  begin
    start_at_value := (requested_submission ->> 'start_at')::timestamptz;
  exception when others then
    return public.submit_public_booking_legacy(
      requested_business_slug,
      requested_page_slug,
      requested_booking_key,
      requested_idempotency_token,
      requested_submission,
      requested_request_hash
    );
  end;

  if timezone_value is null or not exists (
    select 1 from pg_catalog.pg_timezone_names where name = timezone_value
  ) then
    return public.submit_public_booking_legacy(
      requested_business_slug,
      requested_page_slug,
      requested_booking_key,
      requested_idempotency_token,
      requested_submission,
      requested_request_hash
    );
  end if;

  local_start := start_at_value at time zone timezone_value;
  booking_data := coalesce(requested_submission -> 'booking', '{}'::jsonb);
  if date_key is not null then
    booking_data := booking_data || jsonb_build_object(date_key, local_start::date);
  end if;
  if time_key is not null then
    booking_data := booking_data || jsonb_build_object(
      time_key,
      to_char(local_start::time, 'HH24:MI')
    );
  end if;
  enriched_submission := requested_submission || jsonb_build_object(
    'booking', booking_data
  );

  return public.submit_public_booking_legacy(
    requested_business_slug,
    requested_page_slug,
    requested_booking_key,
    requested_idempotency_token,
    enriched_submission,
    requested_request_hash
  );
exception when others then
  return public.submit_public_booking_legacy(
    requested_business_slug,
    requested_page_slug,
    requested_booking_key,
    requested_idempotency_token,
    requested_submission,
    requested_request_hash
  );
end;
$$;

revoke all on function public.submit_public_booking_legacy(text, text, text, uuid, jsonb, text) from public;
revoke all on function public.submit_public_booking_legacy(text, text, text, uuid, jsonb, text) from anon, authenticated;
grant execute on function public.submit_public_booking_legacy(text, text, text, uuid, jsonb, text) to service_role;

revoke all on function public.submit_public_booking(text, text, text, uuid, jsonb, text) from public;
grant execute on function public.submit_public_booking(text, text, text, uuid, jsonb, text) to anon, authenticated, service_role;

comment on function public.submit_public_booking(text, text, text, uuid, jsonb, text) is
  'Journey 1 trusted public Booking transaction; derives configured date/time Fields server-side from the revalidated slot.';
