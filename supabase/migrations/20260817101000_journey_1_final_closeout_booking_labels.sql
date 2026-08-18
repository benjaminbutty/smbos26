-- Journey 1 final closeout: expose only the configured Customer/Subject labels
-- needed to present repeated public booking fields clearly.

create or replace function public.resolve_public_booking(
  requested_business_slug text,
  requested_page_slug text,
  requested_booking_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  business_id_value uuid;
  page_id_value uuid;
  business_name_value text;
  page_title_value text;
  page_slug_value text;
  block_config jsonb;
  timezone_value text;
  schedule jsonb;
  slots jsonb := '[]'::jsonb;
  services jsonb := '[]'::jsonb;
  customer_object_key text;
  subject_object_key text;
  customer_label text;
  subject_label text;
  local_date date;
  local_time time;
  slot_at timestamptz;
  now_at timestamptz := statement_timestamp();
  slot_counter integer;
  days jsonb;
  service_object_id uuid;
  service_name_field text;
  service_object_key text;
begin
  select business.id, page.id, business.name, page.title, page.slug, block -> 'config'
  into business_id_value, page_id_value, business_name_value,
    page_title_value, page_slug_value, block_config
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
  if business_id_value is null then
    return null;
  end if;

  customer_object_key := block_config ->> 'customer_object_key';
  subject_object_key := block_config ->> 'subject_object_key';
  select coalesce(object_definition.singular_label, 'Customer')
  into customer_label
  from public.object_definitions as object_definition
  where object_definition.business_id = business_id_value
    and object_definition.key = customer_object_key
    and object_definition.is_active;
  customer_label := coalesce(customer_label, 'Customer');
  subject_label := null;
  if subject_object_key is not null then
    select object_definition.singular_label
    into subject_label
    from public.object_definitions as object_definition
    where object_definition.business_id = business_id_value
      and object_definition.key = subject_object_key
      and object_definition.is_active;
    subject_label := coalesce(subject_label, 'Subject');
  end if;

  schedule := block_config -> 'schedule';
  if schedule ->> 'timezone_source' = 'location' then
    select location.timezone into timezone_value
    from public.locations as location
    where location.business_id = business_id_value
      and location.id = (schedule ->> 'location_id')::uuid
      and location.is_active;
  else
    select business.timezone into timezone_value
    from public.businesses as business
    where business.id = business_id_value;
  end if;
  if timezone_value is null or not exists (
    select 1 from pg_catalog.pg_timezone_names as timezone_name
    where timezone_name.name = timezone_value
  ) then
    return null;
  end if;

  days := schedule -> 'days_of_week';
  for day_index in 0..((schedule ->> 'booking_horizon_days')::integer - 1)
  loop
    local_date := (now_at at time zone timezone_value)::date + day_index;
    if exists (
      select 1 from jsonb_array_elements_text(days) as allowed_day
      where allowed_day::integer = extract(isodow from local_date)::integer
    ) then
      local_time := (schedule ->> 'first_time')::time;
      while local_time < (schedule ->> 'last_time')::time loop
        slot_at := make_timestamptz(
          extract(year from local_date)::integer,
          extract(month from local_date)::integer,
          extract(day from local_date)::integer,
          extract(hour from local_time)::integer,
          extract(minute from local_time)::integer,
          0::double precision,
          timezone_value
        );
        if slot_at >= now_at + make_interval(mins => (schedule ->> 'minimum_notice_minutes')::integer) then
          select reservation_count into slot_counter
          from public.booking_slot_counters
          where business_id = business_id_value
            and page_id = page_id_value
            and booking_key = requested_booking_key
            and starts_at = slot_at;
          slots := slots || jsonb_build_array(jsonb_build_object(
            'start_at', slot_at,
            'local_date', to_char(slot_at at time zone timezone_value, 'YYYY-MM-DD'),
            'local_time', to_char(slot_at at time zone timezone_value, 'HH24:MI'),
            'remaining', greatest(
              0,
              (schedule ->> 'capacity_per_slot')::integer - coalesce(slot_counter, 0)
            )
          ));
        end if;
        local_time := local_time + make_interval(mins => (schedule ->> 'slot_interval_minutes')::integer);
      end loop;
    end if;
  end loop;

  service_object_key := block_config ->> 'service_object_key';
  service_name_field := block_config -> 'field_mappings' -> 'service' ->> 'name';
  if service_object_key is not null and service_name_field is not null then
    select object_definition.id into service_object_id
    from public.object_definitions as object_definition
    where object_definition.business_id = business_id_value
      and object_definition.key = service_object_key
      and object_definition.is_active;
    if service_object_id is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', record_value.id,
        'name', record_value.data_json ->> service_name_field
      ) order by record_value.created_at), '[]'::jsonb)
      into services
      from public.records as record_value
      where record_value.business_id = business_id_value
        and record_value.object_definition_id = service_object_id
        and record_value.record_status = 'active'
        and record_value.data_json ->> service_name_field is not null;
    end if;
  end if;

  return jsonb_build_object(
    'business', jsonb_build_object('name', business_name_value, 'slug', requested_business_slug),
    'page', jsonb_build_object('title', page_title_value, 'slug', page_slug_value),
    'booking', jsonb_build_object(
      'key', requested_booking_key,
      'customer_label', customer_label,
      'subject_label', subject_label,
      'timezone', timezone_value,
      'schedule', schedule,
      'slots', slots,
      'services', services,
      'public_fields', block_config -> 'public_fields'
    )
  );
end;
$$;
