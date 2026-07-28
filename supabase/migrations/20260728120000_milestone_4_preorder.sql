alter table public.locations
  add constraint locations_business_id_id_key unique (business_id, id);

create type public.preorder_email_status as enum (
  'pending',
  'sending',
  'delivered',
  'failed'
);

create table public.record_location_links (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  record_id uuid not null,
  location_id uuid not null,
  created_at timestamptz not null default now(),
  unique (business_id, record_id, location_id),
  constraint record_location_links_tenant_record_fkey
    foreign key (business_id, record_id)
    references public.records(business_id, id)
    on delete cascade,
  constraint record_location_links_tenant_location_fkey
    foreign key (business_id, location_id)
    references public.locations(business_id, id)
    on delete cascade
);

create index record_location_links_record_idx
  on public.record_location_links(business_id, record_id);

create index record_location_links_location_idx
  on public.record_location_links(business_id, location_id);

create table public.preorder_experiences (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  key text not null check (
    key ~ '^[a-z][a-z0-9_]*$'
    and char_length(key) between 1 and 80
  ),
  product_object_definition_id uuid not null,
  customer_object_definition_id uuid not null,
  order_object_definition_id uuid not null,
  order_item_object_definition_id uuid not null,
  customer_places_order_relationship_definition_id uuid not null,
  order_contains_item_relationship_definition_id uuid not null,
  product_appears_in_item_relationship_definition_id uuid not null,
  config_json jsonb not null check (jsonb_typeof(config_json) = 'object'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, key),
  unique (business_id, id),
  constraint preorder_experiences_tenant_product_object_fkey
    foreign key (business_id, product_object_definition_id)
    references public.object_definitions(business_id, id),
  constraint preorder_experiences_tenant_customer_object_fkey
    foreign key (business_id, customer_object_definition_id)
    references public.object_definitions(business_id, id),
  constraint preorder_experiences_tenant_order_object_fkey
    foreign key (business_id, order_object_definition_id)
    references public.object_definitions(business_id, id),
  constraint preorder_experiences_tenant_order_item_object_fkey
    foreign key (business_id, order_item_object_definition_id)
    references public.object_definitions(business_id, id),
  constraint preorder_experiences_tenant_customer_order_relationship_fkey
    foreign key (
      business_id,
      customer_places_order_relationship_definition_id
    )
    references public.relationship_definitions(business_id, id),
  constraint preorder_experiences_tenant_order_item_relationship_fkey
    foreign key (
      business_id,
      order_contains_item_relationship_definition_id
    )
    references public.relationship_definitions(business_id, id),
  constraint preorder_experiences_tenant_product_item_relationship_fkey
    foreign key (
      business_id,
      product_appears_in_item_relationship_definition_id
    )
    references public.relationship_definitions(business_id, id)
);

create table public.preorder_experience_locations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  preorder_experience_id uuid not null,
  location_id uuid not null,
  created_at timestamptz not null default now(),
  unique (business_id, preorder_experience_id, location_id),
  constraint preorder_experience_locations_tenant_experience_fkey
    foreign key (business_id, preorder_experience_id)
    references public.preorder_experiences(business_id, id)
    on delete cascade,
  constraint preorder_experience_locations_tenant_location_fkey
    foreign key (business_id, location_id)
    references public.locations(business_id, id)
    on delete cascade
);

create table public.preorder_slot_counters (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  preorder_experience_id uuid not null,
  location_id uuid not null,
  collection_at timestamptz not null,
  reservation_count integer not null default 0 check (reservation_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (
    business_id,
    preorder_experience_id,
    location_id,
    collection_at
  ),
  constraint preorder_slot_counters_tenant_experience_fkey
    foreign key (business_id, preorder_experience_id)
    references public.preorder_experiences(business_id, id)
    on delete cascade,
  constraint preorder_slot_counters_tenant_location_fkey
    foreign key (business_id, location_id)
    references public.locations(business_id, id)
);

create table public.preorder_submissions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  preorder_experience_id uuid not null,
  idempotency_token uuid not null,
  public_reference text not null default (
    'PO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ) check (public_reference ~ '^PO-[A-F0-9]{8}$'),
  order_record_id uuid null,
  confirmation_json jsonb null check (
    confirmation_json is null or jsonb_typeof(confirmation_json) = 'object'
  ),
  email_status public.preorder_email_status not null default 'pending',
  email_error text null check (
    email_error is null or char_length(email_error) <= 500
  ),
  email_attempted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, preorder_experience_id, idempotency_token),
  unique (business_id, public_reference),
  constraint preorder_submissions_tenant_experience_fkey
    foreign key (business_id, preorder_experience_id)
    references public.preorder_experiences(business_id, id),
  constraint preorder_submissions_tenant_order_record_fkey
    foreign key (business_id, order_record_id)
    references public.records(business_id, id)
);

create table public.preorder_rate_limits (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  preorder_experience_id uuid not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  attempt_count integer not null default 1 check (attempt_count > 0),
  updated_at timestamptz not null default now(),
  unique (
    business_id,
    preorder_experience_id,
    request_hash,
    window_started_at
  ),
  constraint preorder_rate_limits_tenant_experience_fkey
    foreign key (business_id, preorder_experience_id)
    references public.preorder_experiences(business_id, id)
    on delete cascade
);

create trigger preorder_experiences_set_updated_at
before update on public.preorder_experiences
for each row execute function private.set_updated_at();

create trigger preorder_slot_counters_set_updated_at
before update on public.preorder_slot_counters
for each row execute function private.set_updated_at();

create trigger preorder_submissions_set_updated_at
before update on public.preorder_submissions
for each row execute function private.set_updated_at();

create trigger preorder_rate_limits_set_updated_at
before update on public.preorder_rate_limits
for each row execute function private.set_updated_at();

create function private.preorder_json_has_only_keys(
  value jsonb,
  allowed_keys text[]
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(value) = 'object'
      and value - allowed_keys = '{}'::jsonb,
    false
  );
$$;

create function private.preorder_mapping_key(
  config jsonb,
  section_name text,
  field_name text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select config -> 'field_mappings' -> section_name ->> field_name;
$$;

create function private.assert_preorder_field(
  target_business_id uuid,
  target_object_definition_id uuid,
  field_key text,
  allowed_types public.graph_field_type[]
)
returns public.field_definitions
language plpgsql
stable
set search_path = ''
as $$
declare
  field_definition public.field_definitions;
begin
  select configured_field.*
  into field_definition
  from public.field_definitions as configured_field
  where configured_field.business_id = target_business_id
    and configured_field.object_definition_id = target_object_definition_id
    and configured_field.key = field_key
    and configured_field.is_active;

  if not found or not (field_definition.field_type = any(allowed_types)) then
    raise exception 'Preorder Field mapping is invalid: %', field_key
      using errcode = '23514';
  end if;

  return field_definition;
end;
$$;

create function private.assert_valid_preorder_config_shape(config jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  public_field jsonb;
  schedule jsonb := config -> 'schedule';
  mappings jsonb := config -> 'field_mappings';
  product_mapping jsonb := mappings -> 'product';
  customer_mapping jsonb := mappings -> 'customer';
  order_mapping jsonb := mappings -> 'order';
  item_mapping jsonb := mappings -> 'order_item';
begin
  if not private.preorder_json_has_only_keys(
    config,
    array['schedule', 'field_mappings', 'public_fields']
  ) or jsonb_typeof(schedule) <> 'object'
    or jsonb_typeof(mappings) <> 'object'
    or jsonb_typeof(config -> 'public_fields') <> 'array'
    or jsonb_array_length(config -> 'public_fields') not between 2 and 20 then
    raise exception 'Invalid preorder configuration'
      using errcode = '22023';
  end if;

  if not private.preorder_json_has_only_keys(
    schedule,
    array[
      'days_of_week',
      'start_time',
      'end_time',
      'slot_interval_minutes',
      'slot_capacity',
      'cutoff_hours',
      'booking_horizon_days'
    ]
  ) or jsonb_typeof(schedule -> 'days_of_week') <> 'array'
    or jsonb_array_length(schedule -> 'days_of_week') not between 1 and 7
    or exists (
      select 1
      from jsonb_array_elements(schedule -> 'days_of_week') as configured_day
      where jsonb_typeof(configured_day) <> 'number'
        or (configured_day #>> '{}') !~ '^[1-7]$'
    )
    or (
      select count(*)
      from jsonb_array_elements(schedule -> 'days_of_week')
    ) <> (
      select count(distinct configured_day)
      from jsonb_array_elements(schedule -> 'days_of_week') as configured_day
    )
    or (schedule ->> 'start_time') !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
    or (schedule ->> 'end_time') !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
    or (schedule ->> 'start_time')::time > (schedule ->> 'end_time')::time
    or jsonb_typeof(schedule -> 'slot_interval_minutes') <> 'number'
    or (schedule ->> 'slot_interval_minutes') !~ '^[0-9]+$'
    or (schedule ->> 'slot_interval_minutes')::integer not between 5 and 240
    or jsonb_typeof(schedule -> 'slot_capacity') <> 'number'
    or (schedule ->> 'slot_capacity') !~ '^[0-9]+$'
    or (schedule ->> 'slot_capacity')::integer not between 1 and 1000
    or jsonb_typeof(schedule -> 'cutoff_hours') <> 'number'
    or (schedule ->> 'cutoff_hours') !~ '^[0-9]+$'
    or (schedule ->> 'cutoff_hours')::integer not between 0 and 8760
    or jsonb_typeof(schedule -> 'booking_horizon_days') <> 'number'
    or (schedule ->> 'booking_horizon_days') !~ '^[0-9]+$'
    or (schedule ->> 'booking_horizon_days')::integer not between 1 and 365 then
    raise exception 'Invalid preorder schedule'
      using errcode = '22023';
  end if;

  if not private.preorder_json_has_only_keys(
    mappings,
    array['product', 'customer', 'order', 'order_item']
  ) or not private.preorder_json_has_only_keys(
    product_mapping,
    array[
      'name',
      'description',
      'price',
      'image',
      'status',
      'active_status_value'
    ]
  ) or not private.preorder_json_has_only_keys(
    customer_mapping,
    array['name', 'email', 'phone']
  ) or not private.preorder_json_has_only_keys(
    order_mapping,
    array[
      'public_reference',
      'status',
      'new_status_value',
      'collection_at',
      'collection_local_display',
      'collection_timezone',
      'collection_location_name',
      'customer_name',
      'customer_email',
      'customer_phone',
      'item_summary',
      'total'
    ]
  ) or not private.preorder_json_has_only_keys(
    item_mapping,
    array['product_name', 'quantity', 'unit_price', 'line_total']
  ) then
    raise exception 'Invalid preorder Field mappings'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_each(mappings) as section_entry
    cross join lateral jsonb_each(section_entry.value) as mapping_entry
    where mapping_entry.key not in (
      'active_status_value',
      'new_status_value',
      'image',
      'phone',
      'customer_phone'
    )
      and (
        jsonb_typeof(mapping_entry.value) <> 'string'
        or not private.experience_key_is_valid(mapping_entry.value #>> '{}')
      )
  ) or (
    product_mapping ? 'image'
    and product_mapping -> 'image' <> 'null'::jsonb
    and (
      jsonb_typeof(product_mapping -> 'image') <> 'string'
      or not private.experience_key_is_valid(product_mapping ->> 'image')
    )
  ) or (
    customer_mapping ? 'phone'
    and customer_mapping -> 'phone' <> 'null'::jsonb
    and (
      jsonb_typeof(customer_mapping -> 'phone') <> 'string'
      or not private.experience_key_is_valid(customer_mapping ->> 'phone')
    )
  ) or (
    order_mapping ? 'customer_phone'
    and order_mapping -> 'customer_phone' <> 'null'::jsonb
    and (
      jsonb_typeof(order_mapping -> 'customer_phone') <> 'string'
      or not private.experience_key_is_valid(
        order_mapping ->> 'customer_phone'
      )
    )
  ) or not private.experience_string_is_valid(
    product_mapping ->> 'active_status_value',
    120
  ) or not private.experience_string_is_valid(
    order_mapping ->> 'new_status_value',
    120
  ) then
    raise exception 'Invalid preorder Field mapping value'
      using errcode = '22023';
  end if;

  for public_field in
    select value
    from jsonb_array_elements(config -> 'public_fields')
  loop
    if not private.preorder_json_has_only_keys(
      public_field,
      array[
        'target',
        'field',
        'label',
        'required',
        'help_text',
        'autocomplete'
      ]
    ) or public_field ->> 'target' not in ('customer', 'order')
      or not private.experience_key_is_valid(public_field ->> 'field')
      or not private.experience_string_is_valid(
        public_field ->> 'label',
        120
      )
      or jsonb_typeof(public_field -> 'required') <> 'boolean'
      or (
        public_field ? 'help_text'
        and not private.experience_string_is_valid(
          public_field ->> 'help_text',
          500
        )
      )
      or (
        public_field ? 'autocomplete'
        and public_field ->> 'autocomplete'
          not in ('name', 'email', 'tel', 'organization', 'off')
      ) then
      raise exception 'Invalid public preorder Field'
        using errcode = '22023';
    end if;
  end loop;

  if (
    select count(*)
    from jsonb_array_elements(config -> 'public_fields')
  ) <> (
    select count(distinct (
      configured_field ->> 'target',
      configured_field ->> 'field'
    ))
    from jsonb_array_elements(config -> 'public_fields') as configured_field
  ) then
    raise exception 'Public preorder Fields must be unique'
      using errcode = '22023';
  end if;

  if (
    select count(*)
    from jsonb_each(product_mapping) as mapped_field
    where mapped_field.key <> 'active_status_value'
      and mapped_field.value <> 'null'::jsonb
  ) <> (
    select count(distinct mapped_field.value #>> '{}')
    from jsonb_each(product_mapping) as mapped_field
    where mapped_field.key <> 'active_status_value'
      and mapped_field.value <> 'null'::jsonb
  ) or (
    select count(*)
    from jsonb_each(customer_mapping) as mapped_field
    where mapped_field.value <> 'null'::jsonb
  ) <> (
    select count(distinct mapped_field.value #>> '{}')
    from jsonb_each(customer_mapping) as mapped_field
    where mapped_field.value <> 'null'::jsonb
  ) or (
    select count(*)
    from jsonb_each(order_mapping) as mapped_field
    where mapped_field.key <> 'new_status_value'
      and mapped_field.value <> 'null'::jsonb
  ) <> (
    select count(distinct mapped_field.value #>> '{}')
    from jsonb_each(order_mapping) as mapped_field
    where mapped_field.key <> 'new_status_value'
      and mapped_field.value <> 'null'::jsonb
  ) or (
    select count(*)
    from jsonb_each(item_mapping) as mapped_field
  ) <> (
    select count(distinct mapped_field.value #>> '{}')
    from jsonb_each(item_mapping) as mapped_field
  ) then
    raise exception 'Each mapped Field must have one preorder responsibility'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(config -> 'public_fields')
      as configured_public_input
    where configured_public_input ->> 'field' in (
      'business_id',
      'created_at',
      'created_by',
      'id',
      'object_definition_id',
      'record_status',
      'updated_at'
    ) or (
      configured_public_input ->> 'target' = 'order'
      and configured_public_input ->> 'field' in (
        select mapped_field.value
        from jsonb_each_text(order_mapping) as mapped_field
        where mapped_field.key <> 'new_status_value'
          and mapped_field.value is not null
      )
    )
  ) then
    raise exception 'Public preorder Fields cannot write runtime-owned values'
      using errcode = '22023';
  end if;
exception
  when invalid_text_representation or datetime_field_overflow then
    raise exception 'Invalid preorder configuration value'
      using errcode = '22023';
end;
$$;

create function private.assert_valid_preorder_experience(
  target_business_id uuid,
  product_object_id uuid,
  customer_object_id uuid,
  order_object_id uuid,
  order_item_object_id uuid,
  customer_order_relationship_id uuid,
  order_item_relationship_id uuid,
  product_item_relationship_id uuid,
  config jsonb,
  requested_is_active boolean
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  object_count integer;
  relationship_definition public.relationship_definitions;
  configured_public_field jsonb;
  configured_field public.field_definitions;
  mapped_field public.field_definitions;
  customer_phone_key text;
  order_phone_key text;
  runtime_order_field_keys text[];
  runtime_item_field_keys text[];
begin
  perform private.assert_valid_preorder_config_shape(config);

  if not requested_is_active then
    return;
  end if;

  select count(*)
  into object_count
  from public.object_definitions as object_definition
  where object_definition.business_id = target_business_id
    and object_definition.id in (
      product_object_id,
      customer_object_id,
      order_object_id,
      order_item_object_id
    )
    and object_definition.is_active;

  if object_count <> 4 then
    raise exception 'Active preorder configuration requires four active Objects'
      using errcode = '23514';
  end if;

  select *
  into relationship_definition
  from public.relationship_definitions
  where business_id = target_business_id
    and id = customer_order_relationship_id
    and is_active;
  if not found
    or relationship_definition.source_object_definition_id
      <> customer_object_id
    or relationship_definition.target_object_definition_id <> order_object_id
    or relationship_definition.cardinality <> 'one_to_many' then
    raise exception 'Customer places Order Relationship is invalid'
      using errcode = '23514';
  end if;

  select *
  into relationship_definition
  from public.relationship_definitions
  where business_id = target_business_id
    and id = order_item_relationship_id
    and is_active;
  if not found
    or relationship_definition.source_object_definition_id <> order_object_id
    or relationship_definition.target_object_definition_id
      <> order_item_object_id
    or relationship_definition.cardinality <> 'one_to_many' then
    raise exception 'Order contains Order Item Relationship is invalid'
      using errcode = '23514';
  end if;

  select *
  into relationship_definition
  from public.relationship_definitions
  where business_id = target_business_id
    and id = product_item_relationship_id
    and is_active;
  if not found
    or relationship_definition.source_object_definition_id <> product_object_id
    or relationship_definition.target_object_definition_id
      <> order_item_object_id
    or relationship_definition.cardinality <> 'one_to_many' then
    raise exception 'Product appears in Order Item Relationship is invalid'
      using errcode = '23514';
  end if;

  perform private.assert_preorder_field(
    target_business_id,
    product_object_id,
    private.preorder_mapping_key(config, 'product', 'name'),
    array['short_text']::public.graph_field_type[]
  );
  perform private.assert_preorder_field(
    target_business_id,
    product_object_id,
    private.preorder_mapping_key(config, 'product', 'description'),
    array['short_text', 'long_text']::public.graph_field_type[]
  );
  perform private.assert_preorder_field(
    target_business_id,
    product_object_id,
    private.preorder_mapping_key(config, 'product', 'price'),
    array['currency']::public.graph_field_type[]
  );
  perform private.assert_preorder_field(
    target_business_id,
    product_object_id,
    private.preorder_mapping_key(config, 'product', 'status'),
    array['select', 'status']::public.graph_field_type[]
  );
  if private.preorder_mapping_key(config, 'product', 'image') is not null then
    perform private.assert_preorder_field(
      target_business_id,
      product_object_id,
      private.preorder_mapping_key(config, 'product', 'image'),
      array['file']::public.graph_field_type[]
    );
  end if;

  select *
  into mapped_field
  from private.assert_preorder_field(
    target_business_id,
    product_object_id,
    private.preorder_mapping_key(config, 'product', 'status'),
    array['select', 'status']::public.graph_field_type[]
  );
  if not (
    mapped_field.settings_json -> 'options'
      @> jsonb_build_array(
        config -> 'field_mappings' -> 'product' -> 'active_status_value'
      )
  ) then
    raise exception 'Configured active Product status is not allowed'
      using errcode = '23514';
  end if;

  perform private.assert_preorder_field(
    target_business_id,
    customer_object_id,
    private.preorder_mapping_key(config, 'customer', 'name'),
    array['short_text']::public.graph_field_type[]
  );
  perform private.assert_preorder_field(
    target_business_id,
    customer_object_id,
    private.preorder_mapping_key(config, 'customer', 'email'),
    array['email']::public.graph_field_type[]
  );
  customer_phone_key :=
    private.preorder_mapping_key(config, 'customer', 'phone');
  if customer_phone_key is not null then
    perform private.assert_preorder_field(
      target_business_id,
      customer_object_id,
      customer_phone_key,
      array['phone']::public.graph_field_type[]
    );
  end if;

  perform private.assert_preorder_field(
    target_business_id,
    order_object_id,
    private.preorder_mapping_key(config, 'order', 'public_reference'),
    array['short_text']::public.graph_field_type[]
  );
  select *
  into mapped_field
  from private.assert_preorder_field(
    target_business_id,
    order_object_id,
    private.preorder_mapping_key(config, 'order', 'status'),
    array['select', 'status']::public.graph_field_type[]
  );
  if not (
    mapped_field.settings_json -> 'options'
      @> jsonb_build_array(
        config -> 'field_mappings' -> 'order' -> 'new_status_value'
      )
  ) then
    raise exception 'Configured new Order status is not allowed'
      using errcode = '23514';
  end if;
  perform private.assert_preorder_field(
    target_business_id,
    order_object_id,
    private.preorder_mapping_key(config, 'order', 'collection_at'),
    array['datetime']::public.graph_field_type[]
  );
  perform private.assert_preorder_field(
    target_business_id,
    order_object_id,
    private.preorder_mapping_key(config, 'order', 'collection_local_display'),
    array['short_text']::public.graph_field_type[]
  );
  perform private.assert_preorder_field(
    target_business_id,
    order_object_id,
    private.preorder_mapping_key(config, 'order', 'collection_timezone'),
    array['short_text']::public.graph_field_type[]
  );
  perform private.assert_preorder_field(
    target_business_id,
    order_object_id,
    private.preorder_mapping_key(config, 'order', 'collection_location_name'),
    array['short_text']::public.graph_field_type[]
  );
  perform private.assert_preorder_field(
    target_business_id,
    order_object_id,
    private.preorder_mapping_key(config, 'order', 'customer_name'),
    array['short_text']::public.graph_field_type[]
  );
  perform private.assert_preorder_field(
    target_business_id,
    order_object_id,
    private.preorder_mapping_key(config, 'order', 'customer_email'),
    array['email']::public.graph_field_type[]
  );
  order_phone_key :=
    private.preorder_mapping_key(config, 'order', 'customer_phone');
  if order_phone_key is not null then
    perform private.assert_preorder_field(
      target_business_id,
      order_object_id,
      order_phone_key,
      array['phone']::public.graph_field_type[]
    );
  end if;
  if (customer_phone_key is null) <> (order_phone_key is null) then
    raise exception 'Customer phone and Order phone snapshot mappings must agree'
      using errcode = '23514';
  end if;
  perform private.assert_preorder_field(
    target_business_id,
    order_object_id,
    private.preorder_mapping_key(config, 'order', 'item_summary'),
    array['short_text', 'long_text']::public.graph_field_type[]
  );
  perform private.assert_preorder_field(
    target_business_id,
    order_object_id,
    private.preorder_mapping_key(config, 'order', 'total'),
    array['currency']::public.graph_field_type[]
  );

  perform private.assert_preorder_field(
    target_business_id,
    order_item_object_id,
    private.preorder_mapping_key(config, 'order_item', 'product_name'),
    array['short_text']::public.graph_field_type[]
  );
  perform private.assert_preorder_field(
    target_business_id,
    order_item_object_id,
    private.preorder_mapping_key(config, 'order_item', 'quantity'),
    array['number']::public.graph_field_type[]
  );
  perform private.assert_preorder_field(
    target_business_id,
    order_item_object_id,
    private.preorder_mapping_key(config, 'order_item', 'unit_price'),
    array['currency']::public.graph_field_type[]
  );
  perform private.assert_preorder_field(
    target_business_id,
    order_item_object_id,
    private.preorder_mapping_key(config, 'order_item', 'line_total'),
    array['currency']::public.graph_field_type[]
  );

  for configured_public_field in
    select value
    from jsonb_array_elements(config -> 'public_fields')
  loop
    select *
    into configured_field
    from private.assert_preorder_field(
      target_business_id,
      case configured_public_field ->> 'target'
        when 'customer' then customer_object_id
        else order_object_id
      end,
      configured_public_field ->> 'field',
      array[
        'short_text',
        'long_text',
        'number',
        'boolean',
        'date',
        'email',
        'phone',
        'select',
        'multi_select'
      ]::public.graph_field_type[]
    );

    if configured_field.required
      and not (configured_public_field ->> 'required')::boolean then
      raise exception 'Required graph Fields must remain required publicly'
        using errcode = '23514';
    end if;
  end loop;

  if not exists (
    select 1
    from jsonb_array_elements(config -> 'public_fields') as public_field
    where public_field ->> 'target' = 'customer'
      and public_field ->> 'field'
        = private.preorder_mapping_key(config, 'customer', 'name')
      and (public_field ->> 'required')::boolean
  ) or not exists (
    select 1
    from jsonb_array_elements(config -> 'public_fields') as public_field
    where public_field ->> 'target' = 'customer'
      and public_field ->> 'field'
        = private.preorder_mapping_key(config, 'customer', 'email')
      and (public_field ->> 'required')::boolean
  ) then
    raise exception 'Customer name and email must be collected publicly'
      using errcode = '23514';
  end if;

  runtime_order_field_keys := array[
    private.preorder_mapping_key(config, 'order', 'public_reference'),
    private.preorder_mapping_key(config, 'order', 'status'),
    private.preorder_mapping_key(config, 'order', 'collection_at'),
    private.preorder_mapping_key(config, 'order', 'collection_local_display'),
    private.preorder_mapping_key(config, 'order', 'collection_timezone'),
    private.preorder_mapping_key(config, 'order', 'collection_location_name'),
    private.preorder_mapping_key(config, 'order', 'customer_name'),
    private.preorder_mapping_key(config, 'order', 'customer_email'),
    private.preorder_mapping_key(config, 'order', 'item_summary'),
    private.preorder_mapping_key(config, 'order', 'total')
  ];
  runtime_item_field_keys := array[
    private.preorder_mapping_key(config, 'order_item', 'product_name'),
    private.preorder_mapping_key(config, 'order_item', 'quantity'),
    private.preorder_mapping_key(config, 'order_item', 'unit_price'),
    private.preorder_mapping_key(config, 'order_item', 'line_total')
  ];

  for configured_field in
    select field_definition.*
    from public.field_definitions as field_definition
    where field_definition.business_id = target_business_id
      and field_definition.object_definition_id in (
        customer_object_id,
        order_object_id,
        order_item_object_id
      )
      and field_definition.is_active
      and field_definition.required
    order by field_definition.object_definition_id, field_definition.position
  loop
    if private.graph_value_is_present(
      configured_field.default_value
    ) then
      continue;
    end if;

    if configured_field.object_definition_id = customer_object_id
      and exists (
        select 1
        from jsonb_array_elements(config -> 'public_fields') as public_field
        where public_field ->> 'target' = 'customer'
          and public_field ->> 'field' = configured_field.key
          and (public_field ->> 'required')::boolean
      ) then
      continue;
    end if;

    if configured_field.object_definition_id = order_object_id
      and configured_field.key = any(runtime_order_field_keys) then
      continue;
    end if;

    if configured_field.object_definition_id = order_object_id
      and configured_field.key = order_phone_key
      and (
        exists (
          select 1
          from jsonb_array_elements(config -> 'public_fields') as public_field
          where public_field ->> 'target' = 'customer'
            and public_field ->> 'field' = customer_phone_key
            and (public_field ->> 'required')::boolean
        )
        or exists (
          select 1
          from public.field_definitions as customer_phone_field
          where customer_phone_field.business_id = target_business_id
            and customer_phone_field.object_definition_id = customer_object_id
            and customer_phone_field.key = customer_phone_key
            and customer_phone_field.is_active
            and private.graph_value_is_present(
              customer_phone_field.default_value
            )
        )
      ) then
      continue;
    end if;

    if configured_field.object_definition_id = order_object_id
      and exists (
        select 1
        from jsonb_array_elements(config -> 'public_fields') as public_field
        where public_field ->> 'target' = 'order'
          and public_field ->> 'field' = configured_field.key
          and (public_field ->> 'required')::boolean
      ) then
      continue;
    end if;

    if configured_field.object_definition_id = order_item_object_id
      and configured_field.key = any(runtime_item_field_keys) then
      continue;
    end if;

    raise exception
      'Active preorder cannot construct required Field: %',
      configured_field.key
      using errcode = '23514';
  end loop;
end;
$$;

create function private.validate_preorder_experience()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    new.business_id is distinct from old.business_id
    or new.key is distinct from old.key
    or new.product_object_definition_id
      is distinct from old.product_object_definition_id
    or new.customer_object_definition_id
      is distinct from old.customer_object_definition_id
    or new.order_object_definition_id
      is distinct from old.order_object_definition_id
    or new.order_item_object_definition_id
      is distinct from old.order_item_object_definition_id
    or new.customer_places_order_relationship_definition_id
      is distinct from old.customer_places_order_relationship_definition_id
    or new.order_contains_item_relationship_definition_id
      is distinct from old.order_contains_item_relationship_definition_id
    or new.product_appears_in_item_relationship_definition_id
      is distinct from old.product_appears_in_item_relationship_definition_id
  ) then
    raise exception 'Preorder identity and graph references are immutable'
      using errcode = '22023';
  end if;

  perform private.assert_valid_preorder_experience(
    new.business_id,
    new.product_object_definition_id,
    new.customer_object_definition_id,
    new.order_object_definition_id,
    new.order_item_object_definition_id,
    new.customer_places_order_relationship_definition_id,
    new.order_contains_item_relationship_definition_id,
    new.product_appears_in_item_relationship_definition_id,
    new.config_json,
    new.is_active
  );

  return new;
end;
$$;

create trigger preorder_experiences_validate
before insert or update on public.preorder_experiences
for each row execute function private.validate_preorder_experience();

create function private.validate_record_location_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1
  from public.records as record_value
  where record_value.business_id = new.business_id
    and record_value.id = new.record_id
    and record_value.record_status = 'active';
  if not found then
    raise exception 'Location links require an active same-tenant Record'
      using errcode = '23514';
  end if;

  perform 1
  from public.locations as location
  where location.business_id = new.business_id
    and location.id = new.location_id
    and location.is_active;
  if not found then
    raise exception 'Location links require an active same-tenant Location'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger record_location_links_validate
before insert on public.record_location_links
for each row execute function private.validate_record_location_link();

create function private.validate_preorder_experience_location()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1
  from public.preorder_experiences as experience
  where experience.business_id = new.business_id
    and experience.id = new.preorder_experience_id;
  if not found then
    raise exception 'Allowed Locations require a same-tenant preorder configuration'
      using errcode = '23514';
  end if;

  perform 1
  from public.locations as location
  where location.business_id = new.business_id
    and location.id = new.location_id
    and location.is_active;
  if not found then
    raise exception 'Allowed preorder Locations must be active'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger preorder_experience_locations_validate
before insert on public.preorder_experience_locations
for each row execute function private.validate_preorder_experience_location();

create function private.ensure_active_preorder_has_location()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_experience_id uuid;
  target_business_id uuid;
begin
  if tg_table_name = 'preorder_experiences' then
    if tg_op = 'DELETE' then
      target_experience_id := old.id;
      target_business_id := old.business_id;
    else
      target_experience_id := new.id;
      target_business_id := new.business_id;
    end if;
  else
    if tg_op = 'DELETE' then
      target_experience_id := old.preorder_experience_id;
      target_business_id := old.business_id;
    else
      target_experience_id := new.preorder_experience_id;
      target_business_id := new.business_id;
    end if;
  end if;

  if exists (
    select 1
    from public.preorder_experiences as experience
    where experience.business_id = target_business_id
      and experience.id = target_experience_id
      and experience.is_active
  ) and not exists (
    select 1
    from public.preorder_experience_locations as allowed
    where allowed.business_id = target_business_id
      and allowed.preorder_experience_id = target_experience_id
  ) then
    raise exception 'Active preorder configuration requires a Location'
      using errcode = '23514';
  end if;

  return null;
end;
$$;

create constraint trigger preorder_experiences_require_location
after insert or update on public.preorder_experiences
deferrable initially deferred
for each row execute function private.ensure_active_preorder_has_location();

create constraint trigger preorder_experience_locations_require_one
after insert or update or delete on public.preorder_experience_locations
deferrable initially deferred
for each row execute function private.ensure_active_preorder_has_location();

create or replace function private.assert_valid_page_config_shape(layout jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  block jsonb;
  block_type text;
begin
  if not private.experience_json_has_only_keys(layout, array['blocks'])
    or jsonb_typeof(layout -> 'blocks') <> 'array'
    or jsonb_array_length(layout -> 'blocks') not between 1 and 100 then
    raise exception 'Invalid Page layout'
      using errcode = '22023';
  end if;

  for block in
    select value
    from jsonb_array_elements(layout -> 'blocks')
  loop
    block_type := block ->> 'type';

    if block_type = 'heading' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'text', 'level']
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
        array['type', 'text']
      ) or not private.experience_string_is_valid(block ->> 'text', 5000)
        then
        raise exception 'Invalid text Page block'
          using errcode = '22023';
      end if;
    elsif block_type = 'image' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'src', 'alt', 'caption']
      ) or not private.experience_string_is_valid(block ->> 'src', 2048)
        or (block ->> 'src') !~* '^https?://[^[:space:]]+$'
        or not private.experience_string_is_valid(block ->> 'alt', 300)
        or (
          block ? 'caption'
          and not private.experience_string_is_valid(
            block ->> 'caption',
            500
          )
        ) then
        raise exception 'Invalid image Page block'
          using errcode = '22023';
      end if;
    elsif block_type = 'button' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'label', 'href', 'style']
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
        array['type', 'view_key']
      ) or not private.experience_key_is_valid(block ->> 'view_key') then
        raise exception 'Invalid View Page block'
          using errcode = '22023';
      end if;
    elsif block_type = 'form' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'form_key']
      ) or not private.experience_key_is_valid(block ->> 'form_key') then
        raise exception 'Invalid Form Page block'
          using errcode = '22023';
      end if;
    elsif block_type = 'preorder' then
      if not private.experience_json_has_only_keys(
        block,
        array['type', 'preorder_key']
      ) or not private.experience_key_is_valid(block ->> 'preorder_key') then
        raise exception 'Invalid preorder Page block'
          using errcode = '22023';
      end if;
    elsif block_type = 'divider' then
      if not private.experience_json_has_only_keys(block, array['type']) then
        raise exception 'Invalid divider Page block'
          using errcode = '22023';
      end if;
    else
      raise exception 'Unsupported Page block type'
        using errcode = '22023';
    end if;
  end loop;
exception
  when invalid_text_representation then
    raise exception 'Invalid Page block value'
      using errcode = '22023';
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
      select 1
      from jsonb_array_elements(layout -> 'blocks') as configured_block
      where configured_block ->> 'type' in ('view', 'form')
    ) then
    raise exception 'Published public Pages cannot expose generic Records or Forms'
      using errcode = '23514';
  end if;

  for block in
    select value
    from jsonb_array_elements(layout -> 'blocks')
  loop
    if block ->> 'type' = 'view' then
      perform 1
      from public.views as view_definition
      where view_definition.business_id = target_business_id
        and view_definition.key = block ->> 'view_key'
        and view_definition.audience = requested_audience
        and view_definition.is_active
      for share;
      if not found then
        raise exception 'Page View reference is invalid'
          using errcode = '23514';
      end if;
    elsif block ->> 'type' = 'form' then
      perform 1
      from public.forms as form_definition
      where form_definition.business_id = target_business_id
        and form_definition.key = block ->> 'form_key'
        and form_definition.audience = requested_audience
        and form_definition.mode = 'create'
        and form_definition.is_active
      for share;
      if not found then
        raise exception 'Page Form reference is invalid'
          using errcode = '23514';
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

create function private.ensure_preorder_change_preserves_pages()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  page_definition public.pages;
begin
  for page_definition in
    select configured_page.*
    from public.pages as configured_page
    where configured_page.business_id = new.business_id
      and exists (
        select 1
        from jsonb_array_elements(
          configured_page.layout_json -> 'blocks'
        ) as block
        where block ->> 'type' = 'preorder'
          and block ->> 'preorder_key' = new.key
      )
  loop
    perform private.assert_valid_experience_page(
      page_definition.business_id,
      page_definition.audience,
      page_definition.layout_json,
      page_definition.status
    );
  end loop;

  return null;
end;
$$;

create trigger preorder_experiences_preserve_page_validity
after update on public.preorder_experiences
for each row execute function private.ensure_preorder_change_preserves_pages();

create function public.create_record_location_link(
  expected_business_id uuid,
  target_record_id uuid,
  target_location_id uuid
)
returns public.record_location_links
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_link public.record_location_links;
begin
  insert into public.record_location_links (
    business_id,
    record_id,
    location_id
  )
  values (
    expected_business_id,
    target_record_id,
    target_location_id
  )
  returning * into created_link;

  return created_link;
end;
$$;

create function public.create_preorder_experience(
  expected_business_id uuid,
  requested_key text,
  requested_product_object_definition_id uuid,
  requested_customer_object_definition_id uuid,
  requested_order_object_definition_id uuid,
  requested_order_item_object_definition_id uuid,
  requested_customer_places_order_relationship_definition_id uuid,
  requested_order_contains_item_relationship_definition_id uuid,
  requested_product_appears_in_item_relationship_definition_id uuid,
  requested_config jsonb,
  requested_location_ids uuid[],
  requested_is_active boolean default true
)
returns public.preorder_experiences
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_experience public.preorder_experiences;
  requested_location_id uuid;
begin
  if coalesce(array_length(requested_location_ids, 1), 0) not between 1 and 50
    or (
      select count(distinct configured_location_id)
      from unnest(requested_location_ids) as configured_location_id
    ) <> array_length(requested_location_ids, 1) then
    raise exception 'Preorder requires unique allowed Locations'
      using errcode = '22023';
  end if;

  insert into public.preorder_experiences (
    business_id,
    key,
    product_object_definition_id,
    customer_object_definition_id,
    order_object_definition_id,
    order_item_object_definition_id,
    customer_places_order_relationship_definition_id,
    order_contains_item_relationship_definition_id,
    product_appears_in_item_relationship_definition_id,
    config_json,
    is_active
  )
  values (
    expected_business_id,
    requested_key,
    requested_product_object_definition_id,
    requested_customer_object_definition_id,
    requested_order_object_definition_id,
    requested_order_item_object_definition_id,
    requested_customer_places_order_relationship_definition_id,
    requested_order_contains_item_relationship_definition_id,
    requested_product_appears_in_item_relationship_definition_id,
    requested_config,
    requested_is_active
  )
  returning * into created_experience;

  foreach requested_location_id in array requested_location_ids
  loop
    insert into public.preorder_experience_locations (
      business_id,
      preorder_experience_id,
      location_id
    )
    values (
      expected_business_id,
      created_experience.id,
      requested_location_id
    );
  end loop;

  return created_experience;
end;
$$;

create function public.set_preorder_experience_locations(
  expected_business_id uuid,
  target_preorder_experience_id uuid,
  requested_location_ids uuid[]
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  requested_location_id uuid;
begin
  if coalesce(array_length(requested_location_ids, 1), 0) not between 1 and 50
    or (
      select count(distinct configured_location_id)
      from unnest(requested_location_ids) as configured_location_id
    ) <> array_length(requested_location_ids, 1) then
    raise exception 'Preorder requires unique allowed Locations'
      using errcode = '22023';
  end if;

  perform 1
  from public.preorder_experiences
  where business_id = expected_business_id
    and id = target_preorder_experience_id
    and is_active
  for update;
  if not found then
    raise exception 'Preorder configuration not found'
      using errcode = 'P0002';
  end if;

  delete from public.preorder_experience_locations
  where business_id = expected_business_id
    and preorder_experience_id = target_preorder_experience_id;

  foreach requested_location_id in array requested_location_ids
  loop
    insert into public.preorder_experience_locations (
      business_id,
      preorder_experience_id,
      location_id
    )
    values (
      expected_business_id,
      target_preorder_experience_id,
      requested_location_id
    );
  end loop;

  return array_length(requested_location_ids, 1);
end;
$$;

create function public.remove_record_location_link(
  expected_business_id uuid,
  target_record_location_link_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  removed_count integer;
begin
  delete from public.record_location_links
  where business_id = expected_business_id
    and id = target_record_location_link_id;

  get diagnostics removed_count = row_count;
  return removed_count = 1;
end;
$$;

create function private.preorder_collection_at(
  collection_date date,
  collection_time time,
  location_timezone text
)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (collection_date + collection_time) at time zone location_timezone;
$$;

create function private.preorder_slot_is_configured(
  schedule jsonb,
  location_timezone text,
  collection_at timestamptz,
  reference_now timestamptz
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  local_collection timestamp :=
    collection_at at time zone location_timezone;
  local_now timestamp := reference_now at time zone location_timezone;
  start_time time := (schedule ->> 'start_time')::time;
  end_time time := (schedule ->> 'end_time')::time;
  interval_minutes integer :=
    (schedule ->> 'slot_interval_minutes')::integer;
  local_minutes integer;
begin
  local_minutes :=
    extract(hour from local_collection)::integer * 60
      + extract(minute from local_collection)::integer;

  return extract(isodow from local_collection)::integer in (
      select (configured_day #>> '{}')::integer
      from jsonb_array_elements(schedule -> 'days_of_week') as configured_day
    )
    and local_collection::time between start_time and end_time
    and mod(
      local_minutes - (
        extract(hour from start_time)::integer * 60
          + extract(minute from start_time)::integer
      ),
      interval_minutes
    ) = 0
    and private.preorder_collection_at(
      local_collection::date,
      local_collection::time,
      location_timezone
    ) = collection_at
    and collection_at >= reference_now
      + make_interval(hours => (schedule ->> 'cutoff_hours')::integer)
    and local_collection::date
      <= local_now::date
        + (schedule ->> 'booking_horizon_days')::integer;
exception
  when invalid_parameter_value
    or invalid_text_representation
    or datetime_field_overflow then
    return false;
end;
$$;

create function private.resolve_preorder_catalogue_at(
  requested_business_slug text,
  requested_page_slug text,
  requested_preorder_key text,
  reference_now timestamptz
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
  experience public.preorder_experiences;
  location_value public.locations;
  product_value public.records;
  config jsonb;
  schedule jsonb;
  locations_json jsonb := '[]'::jsonb;
  products_json jsonb := '[]'::jsonb;
  public_fields_json jsonb := '[]'::jsonb;
  location_slots jsonb;
  product_locations jsonb;
  product_image jsonb;
  field_definition public.field_definitions;
  public_field jsonb;
  price_field public.field_definitions;
  price_value numeric;
  active_status text;
  product_name_key text;
  product_description_key text;
  product_price_key text;
  product_image_key text;
  product_status_key text;
begin
  select business.*
  into business_value
  from public.businesses as business
  where business.slug = requested_business_slug;
  if not found then
    return null;
  end if;

  select configured_page.*
  into page_value
  from public.pages as configured_page
  where configured_page.business_id = business_value.id
    and configured_page.slug = requested_page_slug
    and configured_page.audience = 'public'
    and configured_page.status = 'published'
    and exists (
      select 1
      from jsonb_array_elements(
        configured_page.layout_json -> 'blocks'
      ) as block
      where block ->> 'type' = 'preorder'
        and block ->> 'preorder_key' = requested_preorder_key
    );
  if not found then
    return null;
  end if;

  select configured_experience.*
  into experience
  from public.preorder_experiences as configured_experience
  where configured_experience.business_id = business_value.id
    and configured_experience.key = requested_preorder_key
    and configured_experience.is_active;
  if not found then
    return null;
  end if;

  config := experience.config_json;
  schedule := config -> 'schedule';
  product_name_key :=
    private.preorder_mapping_key(config, 'product', 'name');
  product_description_key :=
    private.preorder_mapping_key(config, 'product', 'description');
  product_price_key :=
    private.preorder_mapping_key(config, 'product', 'price');
  product_image_key :=
    private.preorder_mapping_key(config, 'product', 'image');
  product_status_key :=
    private.preorder_mapping_key(config, 'product', 'status');
  active_status :=
    config -> 'field_mappings' -> 'product' ->> 'active_status_value';

  select *
  into price_field
  from public.field_definitions
  where business_id = business_value.id
    and object_definition_id = experience.product_object_definition_id
    and key = product_price_key
    and is_active;

  for location_value in
    select location.*
    from public.preorder_experience_locations as allowed
    join public.locations as location
      on location.business_id = allowed.business_id
      and location.id = allowed.location_id
    where allowed.business_id = business_value.id
      and allowed.preorder_experience_id = experience.id
      and location.is_active
    order by location.name
  loop
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'date',
          to_char(candidate.local_date, 'YYYY-MM-DD'),
          'time',
          to_char(candidate.local_time, 'HH24:MI'),
          'collection_at',
          candidate.collection_at,
          'available',
          coalesce(counter.reservation_count, 0)
            < (schedule ->> 'slot_capacity')::integer,
          'remaining',
          greatest(
            (schedule ->> 'slot_capacity')::integer
              - coalesce(counter.reservation_count, 0),
            0
          )
        )
        order by candidate.collection_at
      ),
      '[]'::jsonb
    )
    into location_slots
    from (
      select
        generated_day.local_date,
        (
          (schedule ->> 'start_time')::time
            + make_interval(
              mins => slot_number
                * (schedule ->> 'slot_interval_minutes')::integer
            )
        )::time as local_time,
        private.preorder_collection_at(
          generated_day.local_date,
          (
            (schedule ->> 'start_time')::time
              + make_interval(
                mins => slot_number
                  * (schedule ->> 'slot_interval_minutes')::integer
              )
          )::time,
          location_value.timezone
        ) as collection_at
      from (
        select (
          (reference_now at time zone location_value.timezone)::date
            + day_offset
        )::date as local_date
        from generate_series(
          0,
          (schedule ->> 'booking_horizon_days')::integer
        ) as day_offset
      ) as generated_day
      cross join lateral generate_series(
        0,
        floor(
          (
            extract(
              epoch from (
                (schedule ->> 'end_time')::time
                  - (schedule ->> 'start_time')::time
              )
            ) / 60
          ) / (schedule ->> 'slot_interval_minutes')::integer
        )::integer
      ) as slot_number
      where extract(isodow from generated_day.local_date)::integer in (
        select (configured_day #>> '{}')::integer
        from jsonb_array_elements(
          schedule -> 'days_of_week'
        ) as configured_day
      )
    ) as candidate
    left join public.preorder_slot_counters as counter
      on counter.business_id = business_value.id
      and counter.preorder_experience_id = experience.id
      and counter.location_id = location_value.id
      and counter.collection_at = candidate.collection_at
    where private.preorder_slot_is_configured(
      schedule,
      location_value.timezone,
      candidate.collection_at,
      reference_now
    );

    locations_json := locations_json || jsonb_build_array(
      jsonb_build_object(
        'id',
        location_value.id,
        'name',
        location_value.name,
        'timezone',
        location_value.timezone,
        'slots',
        location_slots
      )
    );
  end loop;

  for product_value in
    select record_value.*
    from public.records as record_value
    where record_value.business_id = business_value.id
      and record_value.object_definition_id
        = experience.product_object_definition_id
      and record_value.record_status = 'active'
      and record_value.data_json ->> product_status_key = active_status
      and exists (
        select 1
        from public.record_location_links as availability
        join public.preorder_experience_locations as allowed
          on allowed.business_id = availability.business_id
          and allowed.location_id = availability.location_id
          and allowed.preorder_experience_id = experience.id
        join public.locations as active_location
          on active_location.business_id = availability.business_id
          and active_location.id = availability.location_id
          and active_location.is_active
        where availability.business_id = business_value.id
          and availability.record_id = record_value.id
      )
    order by product_value.data_json ->> product_name_key
  loop
    begin
      price_value := (product_value.data_json ->> product_price_key)::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        continue;
    end;
    if price_value <= 0
      or price_value > 999999.99
      or round(price_value, 2) <> price_value then
      continue;
    end if;

    select coalesce(jsonb_agg(availability.location_id), '[]'::jsonb)
    into product_locations
    from public.record_location_links as availability
    join public.preorder_experience_locations as allowed
      on allowed.business_id = availability.business_id
      and allowed.location_id = availability.location_id
      and allowed.preorder_experience_id = experience.id
    join public.locations as active_location
      on active_location.business_id = availability.business_id
      and active_location.id = availability.location_id
      and active_location.is_active
    where availability.business_id = business_value.id
      and availability.record_id = product_value.id;

    product_image := null;
    if product_image_key is not null then
      if jsonb_typeof(product_value.data_json -> product_image_key) = 'string'
        and product_value.data_json ->> product_image_key
          ~* '^https?://[^[:space:]]+$' then
        product_image := product_value.data_json -> product_image_key;
      elsif jsonb_typeof(
        product_value.data_json -> product_image_key
      ) = 'object'
        and product_value.data_json -> product_image_key ->> 'url'
          ~* '^https?://[^[:space:]]+$' then
        product_image :=
          product_value.data_json -> product_image_key -> 'url';
      end if;
    end if;

    products_json := products_json || jsonb_build_array(
      jsonb_strip_nulls(
        jsonb_build_object(
          'id',
          product_value.id,
          'name',
          product_value.data_json ->> product_name_key,
          'description',
          product_value.data_json ->> product_description_key,
          'price',
          price_value,
          'image_url',
          product_image,
          'location_ids',
          product_locations
        )
      )
    );
  end loop;

  for public_field in
    select value
    from jsonb_array_elements(config -> 'public_fields')
  loop
    select configured_field.*
    into field_definition
    from public.field_definitions as configured_field
    where configured_field.business_id = business_value.id
      and configured_field.object_definition_id = case
        when public_field ->> 'target' = 'customer'
          then experience.customer_object_definition_id
        else experience.order_object_definition_id
      end
      and configured_field.key = public_field ->> 'field'
      and configured_field.is_active;

    if found then
      public_fields_json := public_fields_json || jsonb_build_array(
        jsonb_strip_nulls(
          jsonb_build_object(
            'target',
            public_field ->> 'target',
            'field',
            field_definition.key,
            'label',
            public_field ->> 'label',
            'required',
            (public_field ->> 'required')::boolean,
            'help_text',
            public_field -> 'help_text',
            'autocomplete',
            public_field -> 'autocomplete',
            'field_type',
            field_definition.field_type,
            'options',
            case
              when field_definition.field_type in ('select', 'multi_select')
                then field_definition.settings_json -> 'options'
              else null
            end
          )
        )
      );
    end if;
  end loop;

  return jsonb_build_object(
    'business',
    jsonb_build_object(
      'name',
      business_value.name,
      'slug',
      business_value.slug
    ),
    'page',
    jsonb_build_object(
      'title',
      page_value.title,
      'slug',
      page_value.slug
    ),
    'preorder',
    jsonb_build_object(
      'key',
      experience.key,
      'currency',
      coalesce(price_field.settings_json ->> 'currency', 'GBP'),
      'schedule',
      jsonb_build_object(
        'days_of_week',
        schedule -> 'days_of_week',
        'start_time',
        schedule -> 'start_time',
        'end_time',
        schedule -> 'end_time',
        'slot_interval_minutes',
        schedule -> 'slot_interval_minutes',
        'slot_capacity',
        schedule -> 'slot_capacity',
        'cutoff_hours',
        schedule -> 'cutoff_hours',
        'booking_horizon_days',
        schedule -> 'booking_horizon_days'
      ),
      'locations',
      locations_json,
      'products',
      products_json,
      'public_fields',
      public_fields_json
    ),
    'generated_at',
    reference_now
  );
end;
$$;

create function public.resolve_public_preorder(
  requested_business_slug text,
  requested_page_slug text,
  requested_preorder_key text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.resolve_preorder_catalogue_at(
    requested_business_slug,
    requested_page_slug,
    requested_preorder_key,
    statement_timestamp()
  );
$$;

create function public.submit_public_preorder(
  requested_business_slug text,
  requested_page_slug text,
  requested_preorder_key text,
  submission jsonb,
  requested_request_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  business_value public.businesses;
  experience public.preorder_experiences;
  location_value public.locations;
  submission_row public.preorder_submissions;
  existing_submission public.preorder_submissions;
  customer_record public.records;
  order_record public.records;
  order_item_record public.records;
  product_record public.records;
  field_definition public.field_definitions;
  config jsonb;
  schedule jsonb;
  public_field jsonb;
  supplied_field record;
  item jsonb;
  resolved_item jsonb;
  resolved_items jsonb := '[]'::jsonb;
  confirmation_items jsonb := '[]'::jsonb;
  customer_data jsonb := '{}'::jsonb;
  order_public_data jsonb := '{}'::jsonb;
  order_data jsonb;
  item_data jsonb;
  target_values jsonb;
  supplied_value jsonb;
  v_idempotency_token uuid;
  v_location_id uuid;
  collection_timestamp timestamptz;
  product_id uuid;
  quantity integer;
  total_quantity integer := 0;
  unit_price numeric;
  line_total numeric;
  order_total numeric := 0;
  item_summary text := '';
  product_name text;
  capacity_count integer;
  attempt_count integer;
  rate_window timestamptz;
  customer_name text;
  customer_email text;
  customer_phone text;
  customer_phone_key text;
  order_phone_key text;
  confirmation jsonb;
  error_message text;
begin
  select business.*
  into business_value
  from public.businesses as business
  where business.slug = requested_business_slug;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  perform 1
  from public.pages as configured_page
  where configured_page.business_id = business_value.id
    and configured_page.slug = requested_page_slug
    and configured_page.audience = 'public'
    and configured_page.status = 'published'
    and exists (
      select 1
      from jsonb_array_elements(
        configured_page.layout_json -> 'blocks'
      ) as block
      where block ->> 'type' = 'preorder'
        and block ->> 'preorder_key' = requested_preorder_key
    );
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select configured_experience.*
  into experience
  from public.preorder_experiences as configured_experience
  where configured_experience.business_id = business_value.id
    and configured_experience.key = requested_preorder_key
    and configured_experience.is_active
  for share;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if jsonb_typeof(submission) <> 'object'
    or octet_length(submission::text) > 50000
    or not private.preorder_json_has_only_keys(
      submission,
      array[
        'idempotency_token',
        'location_id',
        'collection_at',
        'items',
        'fields',
        'website'
      ]
    ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_submission');
  end if;

  begin
    v_idempotency_token := (submission ->> 'idempotency_token')::uuid;
  exception
    when invalid_text_representation then
      return jsonb_build_object('ok', false, 'code', 'invalid_submission');
  end;

  select *
  into existing_submission
  from public.preorder_submissions
  where business_id = business_value.id
    and preorder_experience_id = experience.id
    and preorder_submissions.idempotency_token = v_idempotency_token;
  if found and existing_submission.confirmation_json is not null then
    return jsonb_build_object(
      'ok',
      true,
      'idempotent',
      true,
      'email_status',
      existing_submission.email_status,
      'confirmation',
      existing_submission.confirmation_json
    );
  end if;

  if requested_request_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_submission');
  end if;

  rate_window :=
    date_trunc('hour', clock_timestamp())
      + floor(extract(minute from clock_timestamp()) / 15)
        * interval '15 minutes';

  insert into public.preorder_rate_limits (
    business_id,
    preorder_experience_id,
    request_hash,
    window_started_at,
    attempt_count
  )
  values (
    business_value.id,
    experience.id,
    requested_request_hash,
    rate_window,
    1
  )
  on conflict (
    business_id,
    preorder_experience_id,
    request_hash,
    window_started_at
  ) do update
  set
    attempt_count = public.preorder_rate_limits.attempt_count + 1,
    updated_at = now()
  where public.preorder_rate_limits.attempt_count < 20
  returning preorder_rate_limits.attempt_count into attempt_count;

  if attempt_count is null then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;

  begin
    if coalesce(submission ->> 'website', '') <> '' then
      raise exception 'bot_rejected' using errcode = 'P0001';
    end if;

    if jsonb_typeof(submission -> 'items') <> 'array'
      or jsonb_array_length(submission -> 'items') not between 1 and 20
      or jsonb_typeof(submission -> 'fields') <> 'object'
      or not private.preorder_json_has_only_keys(
        submission -> 'fields',
        array['customer', 'order']
      )
      or jsonb_typeof(submission -> 'fields' -> 'customer') <> 'object'
      or jsonb_typeof(submission -> 'fields' -> 'order') <> 'object' then
      raise exception 'invalid_submission' using errcode = 'P0001';
    end if;

    begin
      v_location_id := (submission ->> 'location_id')::uuid;
      collection_timestamp := (submission ->> 'collection_at')::timestamptz;
    exception
      when invalid_text_representation
        or invalid_datetime_format
        or datetime_field_overflow then
        raise exception 'invalid_slot' using errcode = 'P0001';
    end;

    select location.*
    into location_value
    from public.preorder_experience_locations as allowed
    join public.locations as location
      on location.business_id = allowed.business_id
      and location.id = allowed.location_id
    where allowed.business_id = business_value.id
      and allowed.preorder_experience_id = experience.id
      and allowed.location_id = v_location_id
      and location.is_active
    for share of location;
    if not found then
      raise exception 'invalid_location' using errcode = 'P0001';
    end if;

    config := experience.config_json;
    schedule := config -> 'schedule';
    if not private.preorder_slot_is_configured(
      schedule,
      location_value.timezone,
      collection_timestamp,
      statement_timestamp()
    ) then
      raise exception 'invalid_slot' using errcode = 'P0001';
    end if;

    insert into public.preorder_submissions (
      business_id,
      preorder_experience_id,
      idempotency_token
    )
    values (
      business_value.id,
      experience.id,
      v_idempotency_token
    )
    on conflict (
      business_id,
      preorder_experience_id,
      idempotency_token
    ) do nothing
    returning * into submission_row;

    if submission_row.id is null then
      select *
      into existing_submission
      from public.preorder_submissions
      where business_id = business_value.id
        and preorder_experience_id = experience.id
        and preorder_submissions.idempotency_token = v_idempotency_token;

      if existing_submission.confirmation_json is not null then
        return jsonb_build_object(
          'ok',
          true,
          'idempotent',
          true,
          'email_status',
          existing_submission.email_status,
          'confirmation',
          existing_submission.confirmation_json
        );
      end if;
      raise exception 'submission_in_progress' using errcode = 'P0001';
    end if;

    for supplied_field in
      select 'customer'::text as target, entry.key
      from jsonb_each(submission -> 'fields' -> 'customer') as entry
      union all
      select 'order'::text as target, entry.key
      from jsonb_each(submission -> 'fields' -> 'order') as entry
    loop
      if not exists (
        select 1
        from jsonb_array_elements(config -> 'public_fields') as allowed_field
        where allowed_field ->> 'target' = supplied_field.target
          and allowed_field ->> 'field' = supplied_field.key
      ) then
        raise exception 'unsupported_field' using errcode = 'P0001';
      end if;
    end loop;

    for public_field in
      select value
      from jsonb_array_elements(config -> 'public_fields')
    loop
      target_values :=
        submission -> 'fields' -> (public_field ->> 'target');
      supplied_value := target_values -> (public_field ->> 'field');

      select configured_field.*
      into field_definition
      from public.field_definitions as configured_field
      where configured_field.business_id = business_value.id
        and configured_field.object_definition_id = case
          when public_field ->> 'target' = 'customer'
            then experience.customer_object_definition_id
          else experience.order_object_definition_id
        end
        and configured_field.key = public_field ->> 'field'
        and configured_field.is_active;
      if not found then
        raise exception 'unsupported_field' using errcode = 'P0001';
      end if;

      if (public_field ->> 'required')::boolean
        and (
          not (target_values ? (public_field ->> 'field'))
          or not private.graph_value_is_present(supplied_value)
        ) then
        raise exception 'required_field' using errcode = 'P0001';
      end if;

      if target_values ? (public_field ->> 'field') then
        if not private.graph_field_value_is_valid(
          supplied_value,
          field_definition.field_type,
          field_definition.settings_json
        ) or (
          jsonb_typeof(supplied_value) = 'string'
          and char_length(supplied_value #>> '{}') > case
            when field_definition.field_type = 'long_text' then 2000
            when field_definition.field_type = 'email' then 320
            when field_definition.field_type = 'phone' then 60
            else 200
          end
        ) then
          raise exception 'invalid_field' using errcode = 'P0001';
        end if;

        if public_field ->> 'target' = 'customer' then
          customer_data := customer_data || jsonb_build_object(
            public_field ->> 'field',
            supplied_value
          );
        else
          order_public_data := order_public_data || jsonb_build_object(
            public_field ->> 'field',
            supplied_value
          );
        end if;
      end if;
    end loop;

    if exists (
      select 1
      from (
        select configured_item ->> 'product_id' as product_id
        from jsonb_array_elements(submission -> 'items') as configured_item
      ) as configured_products
      group by configured_products.product_id
      having count(*) > 1
    ) then
      raise exception 'duplicate_product' using errcode = 'P0001';
    end if;

    for item in
      select value
      from jsonb_array_elements(submission -> 'items')
    loop
      if not private.preorder_json_has_only_keys(
        item,
        array['product_id', 'quantity']
      ) or jsonb_typeof(item -> 'product_id') <> 'string'
        or jsonb_typeof(item -> 'quantity') <> 'number'
        or (item ->> 'quantity') !~ '^[0-9]+$' then
        raise exception 'invalid_quantity' using errcode = 'P0001';
      end if;

      begin
        product_id := (item ->> 'product_id')::uuid;
        quantity := (item ->> 'quantity')::integer;
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          raise exception 'invalid_quantity' using errcode = 'P0001';
      end;
      if quantity not between 1 and 20 then
        raise exception 'invalid_quantity' using errcode = 'P0001';
      end if;
      total_quantity := total_quantity + quantity;
      if total_quantity > 100 then
        raise exception 'invalid_quantity' using errcode = 'P0001';
      end if;

      select record_value.*
      into product_record
      from public.records as record_value
      where record_value.business_id = business_value.id
        and record_value.id = product_id
        and record_value.object_definition_id
          = experience.product_object_definition_id
        and record_value.record_status = 'active'
        and record_value.data_json ->> private.preorder_mapping_key(
          config,
          'product',
          'status'
        ) = config -> 'field_mappings' -> 'product' ->> 'active_status_value'
      for share;
      if not found or not exists (
        select 1
        from public.record_location_links as availability
        where availability.business_id = business_value.id
          and availability.record_id = product_id
          and availability.location_id = v_location_id
      ) then
        raise exception 'unavailable_product' using errcode = 'P0001';
      end if;

      begin
        unit_price := (
          product_record.data_json ->> private.preorder_mapping_key(
            config,
            'product',
            'price'
          )
        )::numeric;
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          raise exception 'unavailable_product' using errcode = 'P0001';
      end;
      if unit_price <= 0
        or unit_price > 999999.99
        or round(unit_price, 2) <> unit_price then
        raise exception 'unavailable_product' using errcode = 'P0001';
      end if;

      product_name := product_record.data_json ->> private.preorder_mapping_key(
        config,
        'product',
        'name'
      );
      line_total := unit_price * quantity;
      order_total := order_total + line_total;
      item_summary := concat_ws(
        '; ',
        nullif(item_summary, ''),
        quantity::text || ' × ' || product_name
      );
      resolved_items := resolved_items || jsonb_build_array(
        jsonb_build_object(
          'product_id',
          product_id,
          'product_name',
          product_name,
          'quantity',
          quantity,
          'unit_price',
          unit_price,
          'line_total',
          line_total
        )
      );
      confirmation_items := confirmation_items || jsonb_build_array(
        jsonb_build_object(
          'name',
          product_name,
          'quantity',
          quantity,
          'unit_price',
          unit_price,
          'line_total',
          line_total
        )
      );
    end loop;

    insert into public.preorder_slot_counters (
      business_id,
      preorder_experience_id,
      location_id,
      collection_at,
      reservation_count
    )
    values (
      business_value.id,
      experience.id,
      v_location_id,
      collection_timestamp,
      1
    )
    on conflict (
      business_id,
      preorder_experience_id,
      location_id,
      collection_at
    ) do update
    set reservation_count =
      public.preorder_slot_counters.reservation_count + 1
    where public.preorder_slot_counters.reservation_count
      < (schedule ->> 'slot_capacity')::integer
    returning reservation_count into capacity_count;
    if capacity_count is null then
      raise exception 'sold_out' using errcode = 'P0001';
    end if;

    customer_name := customer_data ->> private.preorder_mapping_key(
      config,
      'customer',
      'name'
    );
    customer_email := customer_data ->> private.preorder_mapping_key(
      config,
      'customer',
      'email'
    );
    customer_phone_key :=
      private.preorder_mapping_key(config, 'customer', 'phone');
    order_phone_key :=
      private.preorder_mapping_key(config, 'order', 'customer_phone');

    insert into public.records (
      business_id,
      object_definition_id,
      data_json
    )
    values (
      business_value.id,
      experience.customer_object_definition_id,
      customer_data
    )
    returning * into customer_record;

    if customer_phone_key is not null then
      customer_phone := customer_record.data_json ->> customer_phone_key;
    end if;

    order_data := order_public_data || jsonb_build_object(
      private.preorder_mapping_key(config, 'order', 'public_reference'),
      submission_row.public_reference,
      private.preorder_mapping_key(config, 'order', 'status'),
      config -> 'field_mappings' -> 'order' -> 'new_status_value',
      private.preorder_mapping_key(config, 'order', 'collection_at'),
      to_jsonb(collection_timestamp),
      private.preorder_mapping_key(config, 'order', 'collection_local_display'),
      to_char(
        collection_timestamp at time zone location_value.timezone,
        'YYYY-MM-DD HH24:MI'
      ),
      private.preorder_mapping_key(config, 'order', 'collection_timezone'),
      location_value.timezone,
      private.preorder_mapping_key(
        config,
        'order',
        'collection_location_name'
      ),
      location_value.name,
      private.preorder_mapping_key(config, 'order', 'customer_name'),
      customer_name,
      private.preorder_mapping_key(config, 'order', 'customer_email'),
      customer_email,
      private.preorder_mapping_key(config, 'order', 'item_summary'),
      item_summary,
      private.preorder_mapping_key(config, 'order', 'total'),
      order_total
    );
    if order_phone_key is not null and customer_phone is not null then
      order_data := order_data || jsonb_build_object(
        order_phone_key,
        customer_phone
      );
    end if;

    insert into public.records (
      business_id,
      object_definition_id,
      data_json
    )
    values (
      business_value.id,
      experience.order_object_definition_id,
      order_data
    )
    returning * into order_record;

    insert into public.record_relationships (
      business_id,
      relationship_definition_id,
      source_record_id,
      target_record_id
    )
    values (
      business_value.id,
      experience.customer_places_order_relationship_definition_id,
      customer_record.id,
      order_record.id
    );

    insert into public.record_location_links (
      business_id,
      record_id,
      location_id
    )
    values (business_value.id, order_record.id, v_location_id);

    for resolved_item in
      select value from jsonb_array_elements(resolved_items)
    loop
      item_data := jsonb_build_object(
        private.preorder_mapping_key(config, 'order_item', 'product_name'),
        resolved_item -> 'product_name',
        private.preorder_mapping_key(config, 'order_item', 'quantity'),
        resolved_item -> 'quantity',
        private.preorder_mapping_key(config, 'order_item', 'unit_price'),
        resolved_item -> 'unit_price',
        private.preorder_mapping_key(config, 'order_item', 'line_total'),
        resolved_item -> 'line_total'
      );

      insert into public.records (
        business_id,
        object_definition_id,
        data_json
      )
      values (
        business_value.id,
        experience.order_item_object_definition_id,
        item_data
      )
      returning * into order_item_record;

      insert into public.record_relationships (
        business_id,
        relationship_definition_id,
        source_record_id,
        target_record_id
      )
      values (
        business_value.id,
        experience.order_contains_item_relationship_definition_id,
        order_record.id,
        order_item_record.id
      );

      insert into public.record_relationships (
        business_id,
        relationship_definition_id,
        source_record_id,
        target_record_id
      )
      values (
        business_value.id,
        experience.product_appears_in_item_relationship_definition_id,
        (resolved_item ->> 'product_id')::uuid,
        order_item_record.id
      );
    end loop;

    confirmation := jsonb_build_object(
      'public_reference',
      submission_row.public_reference,
      'collection_location',
      location_value.name,
      'collection_at',
      collection_timestamp,
      'timezone',
      location_value.timezone,
      'items',
      confirmation_items,
      'item_summary',
      item_summary,
      'total',
      order_total,
      'confirmation_email',
      customer_email
    );

    update public.preorder_submissions
    set
      order_record_id = order_record.id,
      confirmation_json = confirmation
    where id = submission_row.id;

    return jsonb_build_object(
      'ok',
      true,
      'idempotent',
      false,
      'email_status',
      'pending',
      'confirmation',
      confirmation
    );
  exception
    when others then
      get stacked diagnostics error_message = message_text;
      return jsonb_build_object(
        'ok',
        false,
        'code',
        case error_message
          when 'sold_out' then 'sold_out'
          when 'invalid_slot' then 'invalid_slot'
          when 'invalid_location' then 'invalid_location'
          when 'unavailable_product' then 'unavailable_product'
          when 'invalid_quantity' then 'invalid_quantity'
          when 'required_field' then 'required_field'
          when 'invalid_field' then 'invalid_field'
          when 'unsupported_field' then 'unsupported_field'
          when 'duplicate_product' then 'invalid_quantity'
          when 'submission_in_progress' then 'retry'
          when 'bot_rejected' then 'rejected'
          else 'invalid_submission'
        end
      );
  end;
end;
$$;

create function public.claim_preorder_confirmation_email(
  requested_business_slug text,
  requested_page_slug text,
  requested_preorder_key text,
  requested_idempotency_token uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  claimed_confirmation jsonb;
begin
  update public.preorder_submissions as submission
  set
    email_status = 'sending',
    email_error = null,
    email_attempted_at = now()
  from public.businesses as business
  join public.pages as page
    on page.business_id = business.id
  join public.preorder_experiences as experience
    on experience.business_id = business.id
  where business.slug = requested_business_slug
    and page.slug = requested_page_slug
    and page.audience = 'public'
    and page.status = 'published'
    and experience.key = requested_preorder_key
    and experience.is_active
    and exists (
      select 1
      from jsonb_array_elements(page.layout_json -> 'blocks') as block
      where block ->> 'type' = 'preorder'
        and block ->> 'preorder_key' = experience.key
    )
    and submission.business_id = business.id
    and submission.preorder_experience_id = experience.id
    and submission.idempotency_token = requested_idempotency_token
    and submission.confirmation_json is not null
    and submission.email_status = 'pending'
  returning submission.confirmation_json into claimed_confirmation;

  return claimed_confirmation;
end;
$$;

create function public.complete_preorder_confirmation_email(
  requested_business_slug text,
  requested_preorder_key text,
  requested_idempotency_token uuid,
  delivery_succeeded boolean,
  delivery_error text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  updated_count integer;
begin
  update public.preorder_submissions as submission
  set
    email_status = case
      when delivery_succeeded then 'delivered'::public.preorder_email_status
      else 'failed'::public.preorder_email_status
    end,
    email_error = case
      when delivery_succeeded then null
      else left(coalesce(delivery_error, 'Email delivery failed.'), 500)
    end
  from public.businesses as business
  join public.preorder_experiences as experience
    on experience.business_id = business.id
  where business.slug = requested_business_slug
    and experience.key = requested_preorder_key
    and submission.business_id = business.id
    and submission.preorder_experience_id = experience.id
    and submission.idempotency_token = requested_idempotency_token
    and submission.email_status = 'sending';

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

create function private.ensure_graph_change_preserves_preorders()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  experience public.preorder_experiences;
begin
  for experience in
    select configured_experience.*
    from public.preorder_experiences as configured_experience
    where configured_experience.business_id = new.business_id
      and configured_experience.is_active
      and (
        (
          tg_table_name = 'field_definitions'
          and (to_jsonb(new) ->> 'object_definition_id')::uuid in (
            configured_experience.product_object_definition_id,
            configured_experience.customer_object_definition_id,
            configured_experience.order_object_definition_id,
            configured_experience.order_item_object_definition_id
          )
        ) or (
          tg_table_name = 'relationship_definitions'
          and new.id in (
            configured_experience
              .customer_places_order_relationship_definition_id,
            configured_experience
              .order_contains_item_relationship_definition_id,
            configured_experience
              .product_appears_in_item_relationship_definition_id
          )
        )
      )
  loop
    perform private.assert_valid_preorder_experience(
      experience.business_id,
      experience.product_object_definition_id,
      experience.customer_object_definition_id,
      experience.order_object_definition_id,
      experience.order_item_object_definition_id,
      experience.customer_places_order_relationship_definition_id,
      experience.order_contains_item_relationship_definition_id,
      experience.product_appears_in_item_relationship_definition_id,
      experience.config_json,
      experience.is_active
    );
  end loop;

  return null;
end;
$$;

create trigger field_definitions_preserve_preorder_validity
after insert or update on public.field_definitions
for each row execute function private.ensure_graph_change_preserves_preorders();

create trigger relationship_definitions_preserve_preorder_validity
after update on public.relationship_definitions
for each row execute function private.ensure_graph_change_preserves_preorders();

alter table public.record_location_links enable row level security;
alter table public.preorder_experiences enable row level security;
alter table public.preorder_experience_locations enable row level security;
alter table public.preorder_slot_counters enable row level security;
alter table public.preorder_submissions enable row level security;
alter table public.preorder_rate_limits enable row level security;

create policy "Members can read Record Location links"
on public.record_location_links
for select
to authenticated
using (private.is_business_member(business_id));

create policy "Owners and admins can create Record Location links"
on public.record_location_links
for insert
to authenticated
with check (private.can_manage_tenant(business_id));

create policy "Owners and admins can remove Record Location links"
on public.record_location_links
for delete
to authenticated
using (private.can_manage_tenant(business_id));

create policy "Members can read preorder configuration"
on public.preorder_experiences
for select
to authenticated
using (private.is_business_member(business_id));

create policy "Owners and admins can create preorder configuration"
on public.preorder_experiences
for insert
to authenticated
with check (private.can_manage_tenant(business_id));

create policy "Owners and admins can update preorder configuration"
on public.preorder_experiences
for update
to authenticated
using (private.can_manage_tenant(business_id))
with check (private.can_manage_tenant(business_id));

create policy "Members can read preorder allowed Locations"
on public.preorder_experience_locations
for select
to authenticated
using (private.is_business_member(business_id));

create policy "Owners and admins can add preorder allowed Locations"
on public.preorder_experience_locations
for insert
to authenticated
with check (private.can_manage_tenant(business_id));

create policy "Owners and admins can remove preorder allowed Locations"
on public.preorder_experience_locations
for delete
to authenticated
using (private.can_manage_tenant(business_id));

create policy "Members can read preorder slot counters"
on public.preorder_slot_counters
for select
to authenticated
using (private.is_business_member(business_id));

create policy "Members can read preorder submissions"
on public.preorder_submissions
for select
to authenticated
using (private.is_business_member(business_id));

revoke all on table public.record_location_links from anon;
revoke all on table public.preorder_experiences from anon;
revoke all on table public.preorder_experience_locations from anon;
revoke all on table public.preorder_slot_counters from anon;
revoke all on table public.preorder_submissions from anon;
revoke all on table public.preorder_rate_limits from anon;

grant select, insert, delete on table public.record_location_links
  to authenticated;
grant select, insert, update on table public.preorder_experiences
  to authenticated;
grant select, insert, delete on table public.preorder_experience_locations
  to authenticated;
grant select on table public.preorder_slot_counters to authenticated;
grant select on table public.preorder_submissions to authenticated;

grant all on table public.record_location_links to service_role;
grant all on table public.preorder_experiences to service_role;
grant all on table public.preorder_experience_locations to service_role;
grant all on table public.preorder_slot_counters to service_role;
grant all on table public.preorder_submissions to service_role;
grant all on table public.preorder_rate_limits to service_role;

grant usage on type public.preorder_email_status
  to authenticated, service_role;

revoke all on function public.create_record_location_link(
  uuid,
  uuid,
  uuid
) from public;
revoke all on function public.remove_record_location_link(uuid, uuid)
  from public;
revoke all on function public.create_preorder_experience(
  uuid,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  jsonb,
  uuid[],
  boolean
) from public;
revoke all on function public.set_preorder_experience_locations(
  uuid,
  uuid,
  uuid[]
) from public;
revoke all on function private.resolve_preorder_catalogue_at(
  text,
  text,
  text,
  timestamptz
) from public;
revoke all on function public.resolve_public_preorder(
  text,
  text,
  text
) from public;
revoke all on function public.submit_public_preorder(
  text,
  text,
  text,
  jsonb,
  text
) from public;
revoke all on function public.claim_preorder_confirmation_email(
  text,
  text,
  text,
  uuid
) from public;
revoke all on function public.complete_preorder_confirmation_email(
  text,
  text,
  uuid,
  boolean,
  text
) from public;

grant execute on function public.create_record_location_link(
  uuid,
  uuid,
  uuid
) to authenticated;
grant execute on function public.remove_record_location_link(uuid, uuid)
  to authenticated;
grant execute on function public.create_preorder_experience(
  uuid,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  jsonb,
  uuid[],
  boolean
) to authenticated;
grant execute on function public.set_preorder_experience_locations(
  uuid,
  uuid,
  uuid[]
) to authenticated;
grant execute on function public.resolve_public_preorder(
  text,
  text,
  text
) to anon, authenticated;
grant execute on function public.submit_public_preorder(
  text,
  text,
  text,
  jsonb,
  text
) to service_role;
grant execute on function public.claim_preorder_confirmation_email(
  text,
  text,
  text,
  uuid
) to service_role;
grant execute on function public.complete_preorder_confirmation_email(
  text,
  text,
  uuid,
  boolean,
  text
) to service_role;

comment on table public.record_location_links is
  'Reusable tenant-safe links from generic graph Records to first-class Locations.';

comment on table public.preorder_experiences is
  'Strict trusted-capability configuration over existing graph and experience primitives.';

comment on table public.preorder_slot_counters is
  'Durable per-experience, per-Location, per-slot Order counters updated atomically with graph creation.';

comment on table public.preorder_submissions is
  'Idempotency, safe confirmation reference and post-commit email delivery state; Order data remains in graph Records.';

comment on function private.resolve_preorder_catalogue_at(
  text,
  text,
  text,
  timestamptz
) is
  'Private deterministic preorder catalogue helper; callers cannot reach it through the anonymous API.';

comment on function public.resolve_public_preorder(
  text,
  text,
  text
) is
  'Narrow allow-listed catalogue for a published public preorder Page using authoritative server time.';

comment on function public.submit_public_preorder(
  text,
  text,
  text,
  jsonb,
  text
) is
  'Atomic public boundary that reserves capacity and creates validated graph Records, Relationships and a Location link without accepting tenant identity or prices.';
