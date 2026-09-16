-- Allow a published v4 Site Booking to use its immutable canonical
-- source while that source Page remains a draft. Legacy direct Page Booking
-- publication guards remain unchanged.

create or replace function private.submit_public_booking_core_v4(
  requested_business_slug text,
  requested_page_slug text,
  requested_booking_key text,
  requested_idempotency_token uuid,
  requested_submission jsonb,
  requested_request_hash text,
  requested_frozen_action jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  business_id_value uuid;
  page_id_value uuid;
  business_timezone text;
  block_config jsonb;
  schedule jsonb;
  timezone_value text;
  booking_object_id uuid;
  customer_object_id uuid;
  subject_object_id uuid;
  service_object_id uuid;
  customer_record public.records;
  subject_record public.records;
  booking_record public.records;
  service_record public.records;
  existing_submission public.booking_submissions;
  created_submission public.booking_submissions;
  customer_data jsonb;
  subject_data jsonb;
  booking_data jsonb;
  start_at timestamptz;
  local_start timestamp;
  local_date date;
  local_time time;
  first_time time;
  last_time time;
  minutes_from_open numeric;
  now_at timestamptz := statement_timestamp();
  counter_value integer;
  rate_attempt integer;
  window_start timestamptz := date_trunc('minute', statement_timestamp());
  service_record_id uuid;
  submitted_key text;
  configured_field jsonb;
  customer_result jsonb;
  customer_email_key text;
  customer_relationship_ids uuid[];
begin
  if requested_frozen_action is null
    or jsonb_typeof(requested_frozen_action) is distinct from 'object'
    or requested_frozen_action ->> 'kind' <> 'booking'
    or requested_frozen_action ->> 'booking_key' <> requested_booking_key
    or not private.site_valid_uuid_v1(
      requested_frozen_action -> 'source_page_id'
    )
    or requested_submission is null
    or jsonb_typeof(requested_submission) <> 'object'
    or octet_length(requested_submission::text) > 65536
    or requested_request_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_submission');
  end if;

  select business.id, page.id, business.timezone
  into business_id_value, page_id_value, business_timezone
  from public.businesses as business
  join public.pages as page on page.business_id = business.id
  -- submit_public_site_booking_v4 has already locked and revalidated the
  -- exact current published v4 action and its immutable frozen payload. The
  -- canonical source may remain draft; tenant, public, and active checks stay.
  where business.slug = requested_business_slug
    and page.id = (requested_frozen_action ->> 'source_page_id')::uuid
    and page.audience = 'public'
    and page.is_active;
  block_config := requested_frozen_action -> 'config';
  if business_id_value is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select * into existing_submission
  from public.booking_submissions
  where business_id = business_id_value
    and page_id = page_id_value
    and booking_key = requested_booking_key
    and idempotency_token = requested_idempotency_token;
  if found then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'confirmation', existing_submission.confirmation_json
    );
  end if;

  insert into public.booking_rate_limits (
    business_id, page_id, booking_key, request_hash, window_started_at
  ) values (
    business_id_value, page_id_value, requested_booking_key,
    requested_request_hash, window_start
  ) on conflict (
    business_id, page_id, booking_key, request_hash, window_started_at
  ) do update set attempt_count = public.booking_rate_limits.attempt_count + 1,
    updated_at = statement_timestamp()
  returning attempt_count into rate_attempt;
  if rate_attempt > 10 then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
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
  if timezone_value is null or not exists (
    select 1 from pg_catalog.pg_timezone_names where name = timezone_value
  ) then
    return jsonb_build_object('ok', false, 'code', 'rejected');
  end if;

  begin
    start_at := (requested_submission ->> 'start_at')::timestamptz;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'invalid_slot');
  end;
  local_start := start_at at time zone timezone_value;
  local_date := local_start::date;
  local_time := local_start::time;
  first_time := (schedule ->> 'first_time')::time;
  last_time := (schedule ->> 'last_time')::time;
  minutes_from_open := extract(epoch from (local_time - first_time)) / 60;
  if not exists (
    select 1 from jsonb_array_elements_text(schedule -> 'days_of_week') as allowed_day
    where allowed_day::integer = extract(isodow from local_date)::integer
  )
    or local_time < first_time
    or local_time >= last_time
    or mod(minutes_from_open, (schedule ->> 'slot_interval_minutes')::numeric) <> 0
    or start_at < now_at + make_interval(mins => (schedule ->> 'minimum_notice_minutes')::integer)
    or local_date > (now_at at time zone timezone_value)::date
      + (schedule ->> 'booking_horizon_days')::integer - 1 then
    return jsonb_build_object('ok', false, 'code', 'invalid_slot');
  end if;

  select object_definition.id into booking_object_id
  from public.object_definitions as object_definition
  where object_definition.business_id = business_id_value
    and object_definition.key = block_config ->> 'booking_object_key'
    and object_definition.is_active;
  select object_definition.id into customer_object_id
  from public.object_definitions as object_definition
  where object_definition.business_id = business_id_value
    and object_definition.key = block_config ->> 'customer_object_key'
    and object_definition.is_active;
  if booking_object_id is null or customer_object_id is null then
    return jsonb_build_object('ok', false, 'code', 'rejected');
  end if;

  if block_config ->> 'subject_object_key' is not null then
    select object_definition.id into subject_object_id
    from public.object_definitions as object_definition
    where object_definition.business_id = business_id_value
      and object_definition.key = block_config ->> 'subject_object_key'
      and object_definition.is_active;
    if subject_object_id is null then
      return jsonb_build_object('ok', false, 'code', 'rejected');
    end if;
  end if;
  if block_config ->> 'service_object_key' is not null then
    select object_definition.id into service_object_id
    from public.object_definitions as object_definition
    where object_definition.business_id = business_id_value
      and object_definition.key = block_config ->> 'service_object_key'
      and object_definition.is_active;
    if service_object_id is null then
      return jsonb_build_object('ok', false, 'code', 'rejected');
    end if;
  end if;

  service_record_id := nullif(requested_submission ->> 'service_record_id', '')::uuid;
  if service_record_id is not null then
    if service_object_id is null then
      return jsonb_build_object('ok', false, 'code', 'invalid_service');
    end if;
    select * into service_record
    from public.records as record_value
    where record_value.business_id = business_id_value
      and record_value.id = service_record_id
      and record_value.object_definition_id = service_object_id
      and record_value.record_status = 'active';
    if not found then
      return jsonb_build_object('ok', false, 'code', 'invalid_service');
    end if;
  end if;

  customer_data := coalesce(requested_submission -> 'customer', '{}'::jsonb);
  subject_data := coalesce(requested_submission -> 'subject', '{}'::jsonb);
  booking_data := coalesce(requested_submission -> 'booking', '{}'::jsonb)
    || jsonb_build_object(
      block_config -> 'field_mappings' -> 'booking' ->> 'start_at', start_at,
      block_config -> 'field_mappings' -> 'booking' ->> 'status',
      block_config -> 'field_mappings' -> 'booking' ->> 'default_status'
    );

  for submitted_key in select key from jsonb_object_keys(customer_data) as item(key)
  loop
    if not exists (
      select 1
      from jsonb_array_elements(block_config -> 'public_fields') as configured
      where configured ->> 'target' = 'customer'
        and configured ->> 'field' = submitted_key
    ) then
      return jsonb_build_object('ok', false, 'code', 'invalid_field');
    end if;
  end loop;

  if subject_object_id is not null then
    for submitted_key in select key from jsonb_object_keys(subject_data) as item(key)
    loop
      if not exists (
        select 1
        from jsonb_array_elements(block_config -> 'public_fields') as configured
        where configured ->> 'target' = 'subject'
          and configured ->> 'field' = submitted_key
      ) then
        return jsonb_build_object('ok', false, 'code', 'invalid_field');
      end if;
    end loop;
  end if;

  for submitted_key in select key from jsonb_object_keys(booking_data) as item(key)
  loop
    if submitted_key not in (
      block_config -> 'field_mappings' -> 'booking' ->> 'start_at',
      block_config -> 'field_mappings' -> 'booking' ->> 'status'
    ) and not exists (
      select 1
      from jsonb_array_elements(block_config -> 'public_fields') as configured
      where configured ->> 'target' = 'booking'
        and configured ->> 'field' = submitted_key
    ) then
      return jsonb_build_object('ok', false, 'code', 'invalid_field');
    end if;
  end loop;

  for configured_field in
    select value
    from jsonb_array_elements(block_config -> 'public_fields') as item(value)
    where value ->> 'required' = 'true'
  loop
    if not private.graph_value_is_present(
      case configured_field ->> 'target'
        when 'customer' then customer_data -> (configured_field ->> 'field')
        when 'subject' then subject_data -> (configured_field ->> 'field')
        when 'booking' then booking_data -> (configured_field ->> 'field')
      end
    ) then
      return jsonb_build_object('ok', false, 'code', 'required_field');
    end if;
  end loop;

  perform private.assert_valid_graph_record_data(business_id_value, customer_object_id, customer_data);
  if subject_object_id is not null then
    perform private.assert_valid_graph_record_data(business_id_value, subject_object_id, subject_data);
  end if;
  perform private.assert_valid_graph_record_data(business_id_value, booking_object_id, booking_data);

  select coalesce(array_agg(relationship.id order by relationship.id), '{}'::uuid[])
  into customer_relationship_ids
  from public.relationship_definitions as relationship
  where relationship.business_id = business_id_value
    and relationship.key in (
      select value
      from jsonb_each_text(coalesce(block_config -> 'relationships', '{}'::jsonb))
      where value is not null and btrim(value) <> ''
    )
    and relationship.is_active;
  perform private.lock_relationship_definitions_v1(
    business_id_value, customer_relationship_ids
  );

  customer_email_key := block_config -> 'field_mappings' -> 'customer' ->> 'email';
  if customer_email_key is not null
    and customer_data ->> customer_email_key is not null
  then
    customer_result := private.resolve_site_customer_v1(
      business_id_value, customer_object_id, customer_email_key,
      customer_data ->> customer_email_key, customer_data
    );
    select * into customer_record
    from public.records as record_value
    where record_value.business_id = business_id_value
      and record_value.id = (customer_result ->> 'record_id')::uuid
    for update;
  else
    insert into public.records (business_id, object_definition_id, data_json)
    values (business_id_value, customer_object_id, customer_data)
    returning * into customer_record;
  end if;

  insert into public.booking_slot_counters (
    business_id, page_id, booking_key, starts_at
  ) values (
    business_id_value, page_id_value, requested_booking_key, start_at
  ) on conflict (business_id, page_id, booking_key, starts_at) do nothing;
  select reservation_count into counter_value
  from public.booking_slot_counters
  where business_id = business_id_value
    and page_id = page_id_value
    and booking_key = requested_booking_key
    and starts_at = start_at
  for update;
  if counter_value >= (schedule ->> 'capacity_per_slot')::integer then
    return jsonb_build_object('ok', false, 'code', 'capacity_unavailable');
  end if;
  update public.booking_slot_counters
  set reservation_count = reservation_count + 1,
      updated_at = statement_timestamp()
  where business_id = business_id_value
    and page_id = page_id_value
    and booking_key = requested_booking_key
    and starts_at = start_at;

  if subject_object_id is not null then
    insert into public.records (business_id, object_definition_id, data_json)
    values (business_id_value, subject_object_id, subject_data)
    returning * into subject_record;
  end if;
  insert into public.records (business_id, object_definition_id, data_json)
  values (business_id_value, booking_object_id, booking_data)
  returning * into booking_record;

  perform private.journey1_booking_edge(
    business_id_value,
    block_config -> 'relationships' ->> 'customer_booking',
    customer_object_id, customer_record.id, booking_object_id, booking_record.id
  );
  if subject_record.id is not null then
    perform private.journey1_booking_edge(
      business_id_value,
      block_config -> 'relationships' ->> 'customer_subject',
      customer_object_id, customer_record.id, subject_object_id, subject_record.id
    );
    perform private.journey1_booking_edge(
      business_id_value,
      block_config -> 'relationships' ->> 'subject_booking',
      subject_object_id, subject_record.id, booking_object_id, booking_record.id
    );
  end if;
  if service_record.id is not null then
    perform private.journey1_booking_edge(
      business_id_value,
      block_config -> 'relationships' ->> 'service_booking',
      service_object_id, service_record.id, booking_object_id, booking_record.id
    );
  end if;

  insert into public.booking_submissions (
    business_id, page_id, booking_key, idempotency_token, booking_record_id,
    confirmation_json, customer_match_identity, customer_match_count,
    customer_candidate_ids, original_customer_record_id, customer_record_id,
    customer_resolution_state
  ) values (
    business_id_value, page_id_value, requested_booking_key,
    requested_idempotency_token, booking_record.id,
    jsonb_build_object(
      'public_reference', 'BK-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
      'start_at', start_at,
      'timezone', timezone_value
    ),
    customer_result ->> 'normalized_email',
    nullif(customer_result ->> 'match_count', '')::integer,
    case when customer_result ? 'candidate_ids' then array(
      select value::text::uuid from jsonb_array_elements_text(
        customer_result -> 'candidate_ids'
      ) as candidate(value)
    ) else null end,
    case when customer_result is null then null
      else (customer_result ->> 'record_id')::uuid end,
    case when customer_result is null then customer_record.id
      else (customer_result ->> 'record_id')::uuid end,
    case when customer_result is null then null
      when coalesce((customer_result ->> 'created')::boolean, false)
        then 'matched_or_created' else 'matched' end
  ) returning * into created_submission;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'confirmation', created_submission.confirmation_json ||
      jsonb_build_object('public_reference', created_submission.public_reference)
  );
exception
  when unique_violation then
    select * into existing_submission
    from public.booking_submissions
    where business_id = business_id_value
      and page_id = page_id_value
      and booking_key = requested_booking_key
      and idempotency_token = requested_idempotency_token;
    if found then
      return jsonb_build_object(
        'ok', true, 'idempotent', true,
        'confirmation', existing_submission.confirmation_json
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'rejected');
  when others then
    return jsonb_build_object('ok', false, 'code', 'rejected');
end;
$$;


revoke all on function private.submit_public_booking_core_v4(
  text, text, text, uuid, jsonb, text, jsonb
) from public, anon, authenticated, service_role;

create or replace function private.resolve_site_public_operational_action_v4(
  requested_business_slug text,
  requested_page_slug text,
  requested_action_key text,
  requested_release_token text,
  for_write boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  business_id_value uuid;
  site_id_value uuid;
  release_id_value uuid;
  business_name_value text;
  page_value jsonb;
  release_row public.site_releases;
  state_row public.site_states;
  head_row public.business_configuration_heads;
  action_row public.site_release_actions_v4;
  source_page public.pages;
begin
  if requested_business_slug is null
    or requested_page_slug is null
    or requested_action_key is null
    or requested_action_key !~ '^o_[a-f0-9]{64}$'
    or requested_release_token is null
    or requested_release_token !~ '^s_[a-f0-9]{64}$'
  then
    if for_write then raise exception 'site_operational_action_unavailable' using errcode = 'P0002'; end if;
    return null;
  end if;
  select business.id, business.name into business_id_value, business_name_value
  from public.businesses as business
  where business.slug = requested_business_slug;
  if business_id_value is null then
    if for_write then raise exception 'site_operational_action_unavailable' using errcode = 'P0002'; end if;
    return null;
  end if;
  if for_write then
    select * into head_row
    from public.business_configuration_heads
    where business_id = business_id_value for share;
    if head_row.business_id is null then
      raise exception 'site_operational_action_unavailable' using errcode = 'P0002';
    end if;
    perform 1 from public.businesses where id = business_id_value for update;
  end if;
  select * into state_row
  from public.site_states
  where business_id = business_id_value and migration_state = 'adopted';
  if state_row.id is null or state_row.active_release_id is null then
    if for_write then raise exception 'site_operational_action_unavailable' using errcode = 'P0002'; end if;
    return null;
  end if;
  site_id_value := state_row.id;
  release_id_value := state_row.active_release_id;
  if for_write then
    select * into state_row
    from public.site_states
    where business_id = business_id_value and id = site_id_value for update;
  end if;
  select * into release_row
  from public.site_releases
  where business_id = business_id_value
    and site_id = site_id_value
    and id = release_id_value
    and status = 'published'
    and projection_schema_version = 4
    and release_token = requested_release_token;
  if for_write then
    if release_row.id is null then
      raise exception 'site_operational_action_unavailable' using errcode = 'P0002';
    end if;
    select * into release_row
    from public.site_releases
    where business_id = business_id_value and id = release_id_value for update;
  end if;
  if release_row.id is null
    or release_row.status <> 'published'
    or release_row.projection_schema_version <> 4
    or release_row.release_token is distinct from requested_release_token
  then
    if for_write then raise exception 'site_operational_action_unavailable' using errcode = 'P0002'; end if;
    return null;
  end if;
  select value into page_value
  from jsonb_array_elements(release_row.projection_json -> 'pages') as item(value)
  where value ->> 'slug' = requested_page_slug
    and private.site_projection_contains_action_v3(value, requested_action_key)
  limit 1;
  if page_value is null then
    if for_write then raise exception 'site_operational_action_unavailable' using errcode = 'P0002'; end if;
    return null;
  end if;
  select * into action_row
  from public.site_release_actions_v4
  where business_id = business_id_value
    and release_id = release_id_value
    and action_key = requested_action_key
    and release_token = requested_release_token;
  if action_row.action_key is null then
    if for_write then raise exception 'site_operational_action_unavailable' using errcode = 'P0002'; end if;
    return null;
  end if;
  if action_row.action_kind = 'booking' then
    select * into source_page
    from public.pages
    -- The current published v4 action freezes this exact source Page. A
    -- Site release remains public authority while its canonical Page is draft;
    -- tenant, public audience, and active source eligibility still withdraw it.
    where business_id = business_id_value and id = action_row.source_page_id
      and audience = 'public'
      and is_active;
    if source_page.id is null then
      if for_write then raise exception 'site_operational_action_withdrawn' using errcode = 'P0002'; end if;
      return null;
    end if;
  else
    if not exists (
      select 1 from public.preorder_experiences as experience
      where experience.business_id = business_id_value
        and experience.id = action_row.preorder_experience_id
        and experience.is_active
    ) then
      if for_write then raise exception 'site_operational_action_withdrawn' using errcode = 'P0002'; end if;
      return null;
    end if;
  end if;
  return jsonb_build_object(
    'business_id', business_id_value,
    'business_name', business_name_value,
    'site_id', site_id_value,
    'release_id', release_id_value,
    'page_id', action_row.source_page_id,
    'action_key', action_row.action_key,
    'release_token', action_row.release_token,
    'action_kind', action_row.action_kind,
    'booking_key', action_row.booking_key,
    'preorder_experience_id', action_row.preorder_experience_id,
    'source_page_slug', source_page.slug,
    'preorder_key', action_row.action_json ->> 'preorder_key',
    'action', action_row.action_json,
    'relationship_ids', action_row.relationship_ids_json,
    'customer_binding', action_row.customer_binding_json,
    'offer', action_row.offer_json
  );
end;
$$;

revoke all on function private.resolve_site_public_operational_action_v4(
  text, text, text, text, boolean
) from public, anon, authenticated, service_role;

create or replace function private.resolve_site_booking_catalogue_v4(
  requested_business_slug text,
  requested_source_page_id uuid,
  requested_booking_key text,
  requested_frozen_action jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  business_value public.businesses;
  page_value public.pages;
  config jsonb;
  schedule jsonb;
  timezone_value text;
  slots jsonb := '[]'::jsonb;
  services jsonb := '[]'::jsonb;
  local_date date;
  local_time time;
  slot_at timestamptz;
  now_at timestamptz := statement_timestamp();
  slot_counter integer;
  service_object_id uuid;
  service_name_field text;
begin
  if requested_frozen_action is null
    or jsonb_typeof(requested_frozen_action) is distinct from 'object'
    or requested_frozen_action ->> 'kind' <> 'booking'
    or requested_frozen_action ->> 'booking_key' <> requested_booking_key
    or not private.site_valid_uuid_v1(
      requested_frozen_action -> 'source_page_id'
    )
    or (requested_frozen_action ->> 'source_page_id')::uuid
      <> requested_source_page_id
  then
    return null;
  end if;
  select business.*
  into business_value
  from public.businesses as business
  where business.slug = requested_business_slug;
  select page.*
  into page_value
  from public.pages as page
  -- The caller has already resolved the exact current published v4
  -- action. Its canonical source Page may remain draft, while tenant,
  -- public-audience, and active checks retain withdrawal behavior.
  where page.business_id = business_value.id
    and page.id = requested_source_page_id
    and page.audience = 'public'
    and page.is_active;
  if business_value.id is null or page_value.id is null then
    return null;
  end if;
  config := requested_frozen_action -> 'config';
  schedule := config -> 'schedule';
  if schedule ->> 'timezone_source' = 'location' then
    select location.timezone
    into timezone_value
    from public.locations as location
    where location.business_id = business_value.id
      and location.id = (schedule ->> 'location_id')::uuid
      and location.is_active;
  else
    timezone_value := business_value.timezone;
  end if;
  if timezone_value is null or not exists (
    select 1 from pg_catalog.pg_timezone_names as timezone_name
    where timezone_name.name = timezone_value
  ) then
    return null;
  end if;
  for day_index in 0..((schedule ->> 'booking_horizon_days')::integer - 1)
  loop
    local_date := (now_at at time zone timezone_value)::date + day_index;
    if exists (
      select 1
      from jsonb_array_elements_text(schedule -> 'days_of_week') as allowed_day
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
        if slot_at >= now_at + make_interval(
          mins => (schedule ->> 'minimum_notice_minutes')::integer
        ) then
          select counter.reservation_count
          into slot_counter
          from public.booking_slot_counters as counter
          where counter.business_id = business_value.id
            and counter.page_id = requested_source_page_id
            and counter.booking_key = requested_booking_key
            and counter.starts_at = slot_at;
          slots := slots || jsonb_build_array(jsonb_build_object(
            'start_at', slot_at,
            'local_date', to_char(
              slot_at at time zone timezone_value, 'YYYY-MM-DD'
            ),
            'local_time', to_char(
              slot_at at time zone timezone_value, 'HH24:MI'
            ),
            'remaining', greatest(
              0,
              (schedule ->> 'capacity_per_slot')::integer
                - coalesce(slot_counter, 0)
            )
          ));
        end if;
        local_time := local_time + make_interval(
          mins => (schedule ->> 'slot_interval_minutes')::integer
        );
      end loop;
    end if;
  end loop;
  service_name_field := config -> 'field_mappings' -> 'service' ->> 'name';
  if config ->> 'service_object_key' is not null
    and service_name_field is not null
  then
    select object_definition.id
    into service_object_id
    from public.object_definitions as object_definition
    where object_definition.business_id = business_value.id
      and object_definition.key = config ->> 'service_object_key'
      and object_definition.is_active;
    if service_object_id is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', record_value.id,
        'name', record_value.data_json ->> service_name_field
      ) order by record_value.created_at), '[]'::jsonb)
      into services
      from public.records as record_value
      where record_value.business_id = business_value.id
        and record_value.object_definition_id = service_object_id
        and record_value.record_status = 'active'
        and record_value.data_json ->> service_name_field is not null;
    end if;
  end if;
  return jsonb_build_object(
    'business', jsonb_build_object(
      'name', business_value.name,
      'slug', business_value.slug
    ),
    'page', jsonb_build_object(
      'title', page_value.title,
      'slug', page_value.slug
    ),
    'booking', jsonb_build_object(
      'key', requested_booking_key,
      'timezone', timezone_value,
      'schedule', schedule,
      'slots', slots,
      'services', services,
      'public_fields', config -> 'public_fields'
    )
  );
end;
$$;

revoke all on function private.resolve_site_booking_catalogue_v4(
  text, uuid, text, jsonb
) from public, anon, authenticated, service_role;
