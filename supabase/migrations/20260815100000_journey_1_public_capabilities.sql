-- Journey 1 public capabilities.
--
-- Public Form and Booking are deliberately narrow trusted boundaries. They
-- resolve the Business, Page, capability and graph definitions on the server;
-- the anonymous caller supplies no tenant, Object or Relationship identity.

create table public.public_form_submissions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  page_id uuid not null,
  form_id uuid not null,
  idempotency_token uuid not null,
  record_id uuid not null,
  public_reference text not null default (
    'PF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ) check (public_reference ~ '^PF-[A-F0-9]{8}$'),
  created_at timestamptz not null default now(),
  unique (business_id, page_id, form_id, idempotency_token),
  unique (business_id, public_reference),
  constraint public_form_submissions_tenant_page_fkey
    foreign key (business_id, page_id)
    references public.pages(business_id, id)
    on delete cascade,
  constraint public_form_submissions_tenant_form_fkey
    foreign key (business_id, form_id)
    references public.forms(business_id, id)
    on delete cascade,
  constraint public_form_submissions_tenant_record_fkey
    foreign key (business_id, record_id)
    references public.records(business_id, id)
    on delete cascade
);

create table public.public_form_rate_limits (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  form_id uuid not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  attempt_count integer not null default 1 check (attempt_count > 0),
  updated_at timestamptz not null default now(),
  unique (business_id, form_id, request_hash, window_started_at),
  constraint public_form_rate_limits_tenant_form_fkey
    foreign key (business_id, form_id)
    references public.forms(business_id, id)
    on delete cascade
);

create table public.booking_slot_counters (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  page_id uuid not null,
  booking_key text not null check (
    booking_key ~ '^[a-z][a-z0-9_]*$'
    and char_length(booking_key) between 1 and 80
  ),
  starts_at timestamptz not null,
  reservation_count integer not null default 0 check (reservation_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, page_id, booking_key, starts_at),
  constraint booking_slot_counters_tenant_page_fkey
    foreign key (business_id, page_id)
    references public.pages(business_id, id)
    on delete cascade
);

create table public.booking_submissions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  page_id uuid not null,
  booking_key text not null check (
    booking_key ~ '^[a-z][a-z0-9_]*$'
    and char_length(booking_key) between 1 and 80
  ),
  idempotency_token uuid not null,
  booking_record_id uuid not null,
  public_reference text not null default (
    'BK-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ) check (public_reference ~ '^BK-[A-F0-9]{8}$'),
  confirmation_json jsonb not null check (jsonb_typeof(confirmation_json) = 'object'),
  created_at timestamptz not null default now(),
  unique (business_id, page_id, booking_key, idempotency_token),
  unique (business_id, public_reference),
  constraint booking_submissions_tenant_page_fkey
    foreign key (business_id, page_id)
    references public.pages(business_id, id)
    on delete cascade,
  constraint booking_submissions_tenant_record_fkey
    foreign key (business_id, booking_record_id)
    references public.records(business_id, id)
    on delete cascade
);

create table public.booking_rate_limits (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  page_id uuid not null,
  booking_key text not null check (
    booking_key ~ '^[a-z][a-z0-9_]*$'
    and char_length(booking_key) between 1 and 80
  ),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  attempt_count integer not null default 1 check (attempt_count > 0),
  updated_at timestamptz not null default now(),
  unique (business_id, page_id, booking_key, request_hash, window_started_at),
  constraint booking_rate_limits_tenant_page_fkey
    foreign key (business_id, page_id)
    references public.pages(business_id, id)
    on delete cascade
);

create index public_form_submissions_record_idx
  on public.public_form_submissions(business_id, record_id);

create index booking_submissions_record_idx
  on public.booking_submissions(business_id, booking_record_id);

create trigger booking_slot_counters_set_updated_at
before update on public.booking_slot_counters
for each row execute function private.set_updated_at();

create trigger public_form_rate_limits_set_updated_at
before update on public.public_form_rate_limits
for each row execute function private.set_updated_at();

create trigger booking_rate_limits_set_updated_at
before update on public.booking_rate_limits
for each row execute function private.set_updated_at();

alter table public.public_form_submissions enable row level security;
alter table public.public_form_rate_limits enable row level security;
alter table public.booking_slot_counters enable row level security;
alter table public.booking_submissions enable row level security;
alter table public.booking_rate_limits enable row level security;

revoke all on table public.public_form_submissions from anon, authenticated;
revoke all on table public.public_form_rate_limits from anon, authenticated;
revoke all on table public.booking_slot_counters from anon, authenticated;
revoke all on table public.booking_submissions from anon, authenticated;
revoke all on table public.booking_rate_limits from anon, authenticated;

grant all on table public.public_form_submissions to service_role;
grant all on table public.public_form_rate_limits to service_role;
grant all on table public.booking_slot_counters to service_role;
grant all on table public.booking_submissions to service_role;
grant all on table public.booking_rate_limits to service_role;

-- The old internal Form block remains intentionally unavailable on a
-- published public Page. Journey 1 uses an explicit public_form block.
create or replace function private.assert_valid_page_config_shape(layout jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  block jsonb;
  block_type text;
  block_id text;
  seen_ids text[] := array[]::text[];
begin
  if not private.experience_json_has_only_keys(layout, array['blocks'])
    or jsonb_typeof(layout -> 'blocks') <> 'array'
    or jsonb_array_length(layout -> 'blocks') not between 0 and 100 then
    raise exception 'Invalid Page layout'
      using errcode = '22023';
  end if;

  for block in
    select value
    from jsonb_array_elements(layout -> 'blocks')
  loop
    block_type := block ->> 'type';

    if block ? 'id' then
      block_id := block ->> 'id';
      if jsonb_typeof(block -> 'id') <> 'string'
        or not private.configuration_uuid_is_valid(block_id)
        or block_id = any(seen_ids)
      then
        raise exception 'Page block IDs must be unique UUIDs'
          using errcode = '22023';
      end if;
      seen_ids := array_append(seen_ids, block_id);
    end if;

    if block_type = 'heading' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'text', 'level', 'id']
      ) or not private.experience_string_is_valid(block ->> 'text', 200)
        or (
          block ? 'level'
          and (
            jsonb_typeof(block -> 'level') <> 'number'
            or (block ->> 'level') !~ '^[123]$'
          )
        ) then
        raise exception 'Invalid heading Page block'
          using errcode = '22023';
      end if;
    elsif block_type = 'text' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'text', 'id']
      ) or not private.experience_string_is_valid(block ->> 'text', 5000) then
        raise exception 'Invalid text Page block'
          using errcode = '22023';
      end if;
    elsif block_type = 'image' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'src', 'alt', 'caption', 'id']
      ) or not private.experience_string_is_valid(block ->> 'src', 2048)
        or (block ->> 'src') !~* '^https?://[^[:space:]]+$'
        or not private.experience_string_is_valid(block ->> 'alt', 300)
        or (
          block ? 'caption'
          and not private.experience_string_is_valid(block ->> 'caption', 500)
        ) then
        raise exception 'Invalid image Page block'
          using errcode = '22023';
      end if;
    elsif block_type = 'button' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'label', 'href', 'style', 'id']
      ) or not private.experience_string_is_valid(block ->> 'label', 120)
        or not private.experience_string_is_valid(block ->> 'href', 2048)
        or (block ->> 'href') !~* '^(https?://|/|mailto:|tel:)[^[:space:]]+$'
        or (
          block ? 'style'
          and block ->> 'style' not in ('primary', 'secondary')
        ) then
        raise exception 'Invalid button Page block'
          using errcode = '22023';
      end if;
    elsif block_type = 'view' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'view_key', 'read_only', 'id']
      ) or not private.experience_key_is_valid(block ->> 'view_key')
        or (
          block ? 'read_only'
          and jsonb_typeof(block -> 'read_only') <> 'boolean'
        ) then
        raise exception 'Invalid View Page block'
          using errcode = '22023';
      end if;
    elsif block_type = 'form' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'form_key', 'id']
      ) or not private.experience_key_is_valid(block ->> 'form_key') then
        raise exception 'Invalid Form Page block'
          using errcode = '22023';
      end if;
    elsif block_type = 'public_form' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'form_key', 'id']
      ) or not private.experience_key_is_valid(block ->> 'form_key') then
        raise exception 'Invalid public Form Page block'
          using errcode = '22023';
      end if;
    elsif block_type = 'booking' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'booking_key', 'config', 'id']
      )
        or not private.experience_key_is_valid(block ->> 'booking_key')
        or jsonb_typeof(block -> 'config') <> 'object' then
        raise exception 'Invalid Booking Page block'
          using errcode = '22023';
      end if;
    elsif block_type = 'preorder' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'preorder_key', 'id']
      ) or not private.experience_key_is_valid(block ->> 'preorder_key') then
        raise exception 'Invalid preorder Page block'
          using errcode = '22023';
      end if;
    elsif block_type = 'divider' then
      if not private.experience_json_has_only_keys(block, array['type', 'id']) then
        raise exception 'Invalid divider Page block'
          using errcode = '22023';
      end if;
    elsif block_type = 'callout' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'text', 'tone', 'id']
      ) or not private.experience_string_is_valid(block ->> 'text', 1000)
        or (
          block ? 'tone'
          and block ->> 'tone' not in ('neutral', 'info', 'success', 'warning')
        ) then
        raise exception 'Invalid Callout Page block'
          using errcode = '22023';
      end if;
    else
      raise exception 'Unsupported Page block type'
        using errcode = '22023';
    end if;
  end loop;
exception
  when invalid_text_representation then
    raise exception 'Invalid Page block value' using errcode = '22023';
end;
$$;

create or replace function private.assert_valid_experience_page(
  target_business_id uuid,
  requested_audience public.experience_audience,
  layout jsonb,
  requested_status public.experience_page_status
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  block jsonb;
begin
  perform private.assert_valid_page_config_shape(layout);

  if requested_audience = 'public'
    and requested_status = 'published'
    and exists (
      select 1 from jsonb_array_elements(layout -> 'blocks') as configured_block
      where configured_block ->> 'type' in ('view', 'form')
    ) then
    raise exception 'Published public Pages cannot expose internal Records or Forms'
      using errcode = '23514';
  end if;

  for block in select value from jsonb_array_elements(layout -> 'blocks')
  loop
    if block ->> 'type' = 'view' then
      perform 1 from public.views as view_definition
      where view_definition.business_id = target_business_id
        and view_definition.key = block ->> 'view_key'
        and view_definition.audience = requested_audience
        and view_definition.is_active
      for share;
      if not found then
        raise exception 'Page View reference is invalid' using errcode = '23514';
      end if;
    elsif block ->> 'type' = 'form' then
      perform 1 from public.forms as form_definition
      where form_definition.business_id = target_business_id
        and form_definition.key = block ->> 'form_key'
        and form_definition.audience = requested_audience
        and form_definition.mode = 'create'
        and form_definition.is_active
      for share;
      if not found then
        raise exception 'Page Form reference is invalid' using errcode = '23514';
      end if;
    elsif block ->> 'type' = 'public_form' then
      if requested_audience <> 'public' then
        raise exception 'Public Forms require a public Page' using errcode = '23514';
      end if;
      perform 1 from public.forms as form_definition
      where form_definition.business_id = target_business_id
        and form_definition.key = block ->> 'form_key'
        and form_definition.audience = 'public'
        and form_definition.mode = 'create'
        and form_definition.is_active
      for share;
      if not found then
        raise exception 'Public Form reference is invalid' using errcode = '23514';
      end if;
    elsif block ->> 'type' = 'booking' then
      if requested_audience <> 'public' then
        raise exception 'Booking requires a public Page' using errcode = '23514';
      end if;
    elsif block ->> 'type' = 'preorder' then
      if requested_audience <> 'public' then
        raise exception 'Preorder blocks may only appear on public Pages'
          using errcode = '23514';
      end if;
      perform 1
      from public.preorder_experiences as experience
      where experience.business_id = target_business_id
        and experience.key = block ->> 'preorder_key'
        and experience.is_active
      for share;
      if not found then
        raise exception 'Page preorder reference is invalid'
          using errcode = '23514';
      end if;
    end if;
  end loop;
end;
$$;

create or replace function private.journey1_booking_edge(
  target_business_id uuid,
  relationship_key text,
  left_object_id uuid,
  left_record_id uuid,
  right_object_id uuid,
  right_record_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  relationship public.relationship_definitions;
begin
  select definition.* into relationship
  from public.relationship_definitions as definition
  where definition.business_id = target_business_id
    and definition.key = relationship_key
    and definition.is_active
  for update;
  if not found then
    raise exception 'Booking relationship is unavailable' using errcode = '23514';
  end if;

  if relationship.source_object_definition_id = left_object_id
    and relationship.target_object_definition_id = right_object_id then
    insert into public.record_relationships (
      business_id, relationship_definition_id, source_record_id, target_record_id
    ) values (
      target_business_id, relationship.id, left_record_id, right_record_id
    );
  elsif relationship.source_object_definition_id = right_object_id
    and relationship.target_object_definition_id = left_object_id then
    insert into public.record_relationships (
      business_id, relationship_definition_id, source_record_id, target_record_id
    ) values (
      target_business_id, relationship.id, right_record_id, left_record_id
    );
  else
    raise exception 'Booking relationship endpoints are invalid' using errcode = '23514';
  end if;
end;
$$;

create or replace function public.submit_public_create_form(
  requested_business_slug text,
  requested_page_slug text,
  requested_form_key text,
  requested_idempotency_token uuid,
  requested_data jsonb,
  requested_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  business_id_value uuid;
  page_id_value uuid;
  form_id_value uuid;
  object_id_value uuid;
  form_config jsonb;
  existing_submission public.public_form_submissions;
  created_record public.records;
  created_submission public.public_form_submissions;
  window_start timestamptz := date_trunc('minute', statement_timestamp());
  rate_attempt integer;
begin
  if requested_data is null
    or jsonb_typeof(requested_data) <> 'object'
    or octet_length(requested_data::text) > 65536
    or requested_request_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_submission');
  end if;

  select business.id, page.id, form.id, form.object_definition_id, form.config_json
  into business_id_value, page_id_value, form_id_value, object_id_value, form_config
  from public.businesses as business
  join public.pages as page on page.business_id = business.id
  join public.forms as form on form.business_id = business.id
  where business.slug = requested_business_slug
    and page.slug = requested_page_slug
    and page.audience = 'public'
    and page.status = 'published'
    and page.is_active
    and form.key = requested_form_key
    and form.audience = 'public'
    and form.mode = 'create'
    and form.is_active
    and exists (
      select 1 from jsonb_array_elements(page.layout_json -> 'blocks') as block
      where block ->> 'type' = 'public_form'
        and block ->> 'form_key' = requested_form_key
    )
  limit 1;

  if business_id_value is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select * into existing_submission
  from public.public_form_submissions
  where business_id = business_id_value
    and page_id = page_id_value
    and form_id = form_id_value
    and idempotency_token = requested_idempotency_token;
  if found then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'confirmation', jsonb_build_object('public_reference', existing_submission.public_reference)
    );
  end if;

  insert into public.public_form_rate_limits (
    business_id, form_id, request_hash, window_started_at
  ) values (
    business_id_value, form_id_value, requested_request_hash, window_start
  ) on conflict (business_id, form_id, request_hash, window_started_at)
  do update set attempt_count = public.public_form_rate_limits.attempt_count + 1,
    updated_at = statement_timestamp()
  returning attempt_count into rate_attempt;
  if rate_attempt > 10 then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;

  if exists (
    select 1 from jsonb_object_keys(requested_data) as supplied(key)
    where not exists (
      select 1 from jsonb_array_elements(form_config -> 'fields') as configured
      where configured ->> 'field' = supplied.key
        and coalesce(configured ->> 'hidden', 'false') <> 'true'
    )
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_submission');
  end if;

  begin
    perform private.assert_valid_graph_record_data(
      business_id_value, object_id_value, requested_data
    );
    insert into public.records (business_id, object_definition_id, data_json)
    values (business_id_value, object_id_value, requested_data)
    returning * into created_record;

    insert into public.public_form_submissions (
      business_id, page_id, form_id, idempotency_token, record_id
    ) values (
      business_id_value, page_id_value, form_id_value,
      requested_idempotency_token, created_record.id
    ) returning * into created_submission;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'invalid_submission');
  end;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'confirmation', jsonb_build_object('public_reference', created_submission.public_reference)
  );
end;
$$;

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
      'timezone', timezone_value,
      'schedule', schedule,
      'slots', slots,
      'services', services,
      'public_fields', block_config -> 'public_fields'
    )
  );
end;
$$;

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
begin
  if requested_submission is null
    or jsonb_typeof(requested_submission) <> 'object'
    or octet_length(requested_submission::text) > 65536
    or requested_request_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_submission');
  end if;

  select business.id, page.id, business.timezone, block -> 'config'
  into business_id_value, page_id_value, business_timezone, block_config
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

  insert into public.records (business_id, object_definition_id, data_json)
  values (business_id_value, customer_object_id, customer_data)
  returning * into customer_record;
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
    confirmation_json
  ) values (
    business_id_value, page_id_value, requested_booking_key,
    requested_idempotency_token, booking_record.id,
    jsonb_build_object(
      'public_reference', 'BK-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
      'start_at', start_at,
      'timezone', timezone_value
    )
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

revoke all on function public.submit_public_create_form(text, text, text, uuid, jsonb, text) from public;
revoke all on function public.resolve_public_booking(text, text, text) from public;
revoke all on function public.submit_public_booking(text, text, text, uuid, jsonb, text) from public;
grant execute on function public.submit_public_create_form(text, text, text, uuid, jsonb, text) to anon, authenticated, service_role;
grant execute on function public.resolve_public_booking(text, text, text) to anon, authenticated, service_role;
grant execute on function public.submit_public_booking(text, text, text, uuid, jsonb, text) to anon, authenticated, service_role;

comment on table public.public_form_submissions is
  'Idempotency and audit boundary for the narrow Journey 1 anonymous public create Form capability.';
comment on table public.booking_submissions is
  'Idempotency and confirmation boundary for the generic Journey 1 Booking capability.';
comment on function public.submit_public_booking(text, text, text, uuid, jsonb, text) is
  'Tenant-bound anonymous slot booking. It creates only configured generic graph Records and Relationships, atomically, without payment or configuration writes.';
