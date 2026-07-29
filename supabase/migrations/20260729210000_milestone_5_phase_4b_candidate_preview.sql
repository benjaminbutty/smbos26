-- Milestone 5 Phase 4B
-- Authenticated, replay-verified, read-only candidate preview.

create function private.assert_configuration_preview_v1(
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
  current_actor_id uuid := auth.uid();
  current_head public.business_configuration_heads;
  selected_change_set public.configuration_change_sets;
  base_version public.configuration_versions;
  replayed jsonb;
begin
  if current_actor_id is null then
    raise exception 'configuration_authentication_required'
      using errcode = '42501';
  end if;
  if current_actor_id <> expected_actor_id then
    raise exception 'configuration_actor_context_mismatch'
      using errcode = '42501';
  end if;
  if not private.can_manage_tenant(expected_business_id) then
    raise exception 'configuration_owner_or_admin_required'
      using errcode = '42501';
  end if;

  select change_set.*
  into selected_change_set
  from public.configuration_change_sets as change_set
  where change_set.business_id = expected_business_id
    and change_set.id = requested_change_set_id;
  if not found then
    raise exception 'configuration_preview_not_found'
      using errcode = 'P0002';
  end if;

  if selected_change_set.status not in ('proposed', 'validated') then
    raise exception 'configuration_preview_unavailable'
      using errcode = '22023';
  end if;

  select head.*
  into current_head
  from public.business_configuration_heads as head
  where head.business_id = expected_business_id;
  if not found then
    raise exception 'configuration_head_not_found'
      using errcode = 'P0002';
  end if;

  if selected_change_set.base_version_id <> current_head.active_version_id
    or selected_change_set.base_head_revision <> current_head.head_revision
  then
    raise exception 'configuration_preview_stale'
      using errcode = '55000';
  end if;

  select version.*
  into base_version
  from public.configuration_versions as version
  where version.business_id = expected_business_id
    and version.id = selected_change_set.base_version_id;
  if not found then
    raise exception 'configuration_active_version_not_found'
      using errcode = 'P0002';
  end if;

  replayed := private.replay_configuration_change_set_v1(
    selected_change_set,
    base_version
  );

  if replayed -> 'candidate_snapshot'
      <> selected_change_set.candidate_snapshot_json
    or replayed ->> 'candidate_checksum'
      <> selected_change_set.candidate_checksum
    or replayed -> 'id_allocations'
      <> selected_change_set.id_allocations_json
    or replayed -> 'semantic_diff'
      <> selected_change_set.semantic_diff_json
  then
    raise exception 'configuration_candidate_replay_mismatch'
      using errcode = 'P0001';
  end if;

  return selected_change_set;
end;
$$;

create function public.load_configuration_preview(
  expected_business_id uuid,
  expected_actor_id uuid,
  requested_change_set_id uuid
)
returns public.configuration_change_sets
language sql
volatile
security definer
set search_path = ''
as $$
  select private.assert_configuration_preview_v1(
    expected_business_id,
    expected_actor_id,
    requested_change_set_id
  );
$$;

-- Shared authoritative preorder assembler. Both the anonymous live resolver
-- and authenticated candidate resolver load their own trusted configuration,
-- then enter this one operational read path.
create function private.assemble_preorder_catalogue_v1(
  target_business_id uuid,
  page_definition jsonb,
  experience_definition jsonb,
  configuration_snapshot jsonb,
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
  location_value public.locations;
  product_value public.records;
  config jsonb := experience_definition -> 'config_json';
  schedule jsonb;
  locations_json jsonb := '[]'::jsonb;
  products_json jsonb := '[]'::jsonb;
  public_fields_json jsonb := '[]'::jsonb;
  location_slots jsonb;
  product_locations jsonb;
  product_image jsonb;
  public_field jsonb;
  field_definition jsonb;
  price_field jsonb;
  price_value numeric;
  active_status text;
  product_name_key text;
  product_description_key text;
  product_price_key text;
  product_image_key text;
  product_status_key text;
  experience_id_value uuid :=
    (experience_definition ->> 'id')::uuid;
  product_object_id uuid :=
    (experience_definition ->> 'product_object_definition_id')::uuid;
begin
  select business.*
  into business_value
  from public.businesses as business
  where business.id = target_business_id;
  if not found then
    return null;
  end if;

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

  select candidate_field.value
  into price_field
  from jsonb_array_elements(
    configuration_snapshot -> 'field_definitions'
  ) as candidate_field(value)
  where candidate_field.value ->> 'object_definition_id' =
      product_object_id::text
    and candidate_field.value ->> 'key' = product_price_key
    and (candidate_field.value ->> 'is_active')::boolean
  limit 1;

  for location_value in
    select location.*
    from public.locations as location
    where location.business_id = target_business_id
      and location.is_active
      and exists (
        select 1
        from jsonb_array_elements(
          configuration_snapshot -> 'preorder_experience_locations'
        ) as allowed(value)
        where allowed.value ->> 'preorder_experience_id' =
            experience_id_value::text
          and allowed.value ->> 'location_id' = location.id::text
          and (allowed.value ->> 'is_active')::boolean
      )
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
      on counter.business_id = target_business_id
      and counter.preorder_experience_id = experience_id_value
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
    where record_value.business_id = target_business_id
      and record_value.object_definition_id = product_object_id
      and record_value.record_status = 'active'
      and record_value.data_json ->> product_status_key = active_status
      and exists (
        select 1
        from public.record_location_links as availability
        join public.locations as active_location
          on active_location.business_id = availability.business_id
          and active_location.id = availability.location_id
          and active_location.is_active
        where availability.business_id = target_business_id
          and availability.record_id = record_value.id
          and exists (
            select 1
            from jsonb_array_elements(
              configuration_snapshot -> 'preorder_experience_locations'
            ) as allowed(value)
            where allowed.value ->> 'preorder_experience_id' =
                experience_id_value::text
              and allowed.value ->> 'location_id' =
                availability.location_id::text
              and (allowed.value ->> 'is_active')::boolean
          )
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

    select coalesce(
      jsonb_agg(availability.location_id order by availability.location_id),
      '[]'::jsonb
    )
    into product_locations
    from public.record_location_links as availability
    join public.locations as active_location
      on active_location.business_id = availability.business_id
      and active_location.id = availability.location_id
      and active_location.is_active
    where availability.business_id = target_business_id
      and availability.record_id = product_value.id
      and exists (
        select 1
        from jsonb_array_elements(
          configuration_snapshot -> 'preorder_experience_locations'
        ) as allowed(value)
        where allowed.value ->> 'preorder_experience_id' =
            experience_id_value::text
          and allowed.value ->> 'location_id' =
            availability.location_id::text
          and (allowed.value ->> 'is_active')::boolean
      );

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
    select candidate_field.value
    into field_definition
    from jsonb_array_elements(
      configuration_snapshot -> 'field_definitions'
    ) as candidate_field(value)
    where candidate_field.value ->> 'object_definition_id' = case
        when public_field ->> 'target' = 'customer'
          then experience_definition ->> 'customer_object_definition_id'
        else experience_definition ->> 'order_object_definition_id'
      end
      and candidate_field.value ->> 'key' = public_field ->> 'field'
      and (candidate_field.value ->> 'is_active')::boolean
    limit 1;

    if found then
      public_fields_json := public_fields_json || jsonb_build_array(
        jsonb_strip_nulls(
          jsonb_build_object(
            'target',
            public_field ->> 'target',
            'field',
            field_definition ->> 'key',
            'label',
            public_field ->> 'label',
            'required',
            (public_field ->> 'required')::boolean,
            'help_text',
            public_field -> 'help_text',
            'autocomplete',
            public_field -> 'autocomplete',
            'field_type',
            field_definition ->> 'field_type',
            'options',
            case
              when field_definition ->> 'field_type'
                in ('select', 'multi_select')
                then field_definition -> 'settings_json' -> 'options'
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
      page_definition ->> 'title',
      'slug',
      page_definition ->> 'slug'
    ),
    'preorder',
    jsonb_build_object(
      'key',
      experience_definition ->> 'key',
      'currency',
      coalesce(
        price_field -> 'settings_json' ->> 'currency',
        'GBP'
      ),
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

create or replace function private.resolve_preorder_catalogue_at(
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
  business_id_value uuid;
  page_id_value uuid;
  experience_id_value uuid;
  active_snapshot jsonb;
  page_definition jsonb;
  experience_definition jsonb;
begin
  select business.id, page.id, experience.id
  into business_id_value, page_id_value, experience_id_value
  from public.businesses as business
  join public.pages as page
    on page.business_id = business.id
  join public.preorder_experiences as experience
    on experience.business_id = business.id
    and experience.key = requested_preorder_key
    and experience.is_active
  where business.slug = requested_business_slug
    and page.slug = requested_page_slug
    and page.audience = 'public'
    and page.status = 'published'
    and page.is_active
    and exists (
      select 1
      from jsonb_array_elements(page.layout_json -> 'blocks') as block
      where block ->> 'type' = 'preorder'
        and block ->> 'preorder_key' = requested_preorder_key
    );
  if not found then
    return null;
  end if;

  active_snapshot := private.configuration_snapshot_v1(business_id_value);

  select candidate.value
  into page_definition
  from jsonb_array_elements(active_snapshot -> 'pages') as candidate(value)
  where candidate.value ->> 'id' = page_id_value::text
    and (candidate.value ->> 'is_active')::boolean;

  select candidate.value
  into experience_definition
  from jsonb_array_elements(
    active_snapshot -> 'preorder_experiences'
  ) as candidate(value)
  where candidate.value ->> 'id' = experience_id_value::text
    and (candidate.value ->> 'is_active')::boolean;

  if page_definition is null or experience_definition is null then
    return null;
  end if;

  return private.assemble_preorder_catalogue_v1(
    business_id_value,
    page_definition,
    experience_definition,
    active_snapshot,
    reference_now
  );
end;
$$;

create function public.resolve_configuration_preview_preorder(
  expected_business_id uuid,
  expected_actor_id uuid,
  requested_change_set_id uuid,
  requested_page_key text,
  requested_preorder_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_change_set public.configuration_change_sets;
  page_definition jsonb;
  experience_definition jsonb;
begin
  selected_change_set := private.assert_configuration_preview_v1(
    expected_business_id,
    expected_actor_id,
    requested_change_set_id
  );

  select candidate.value
  into page_definition
  from jsonb_array_elements(
    selected_change_set.candidate_snapshot_json -> 'pages'
  ) as candidate(value)
  where candidate.value ->> 'key' = requested_page_key
    and candidate.value ->> 'audience' = 'public'
    and (candidate.value ->> 'is_active')::boolean
    and exists (
      select 1
      from jsonb_array_elements(
        candidate.value -> 'layout_json' -> 'blocks'
      ) as block
      where block ->> 'type' = 'preorder'
        and block ->> 'preorder_key' = requested_preorder_key
    )
  limit 1;
  if not found then
    return null;
  end if;

  select candidate.value
  into experience_definition
  from jsonb_array_elements(
    selected_change_set.candidate_snapshot_json
      -> 'preorder_experiences'
  ) as candidate(value)
  where candidate.value ->> 'key' = requested_preorder_key
    and (candidate.value ->> 'is_active')::boolean
  limit 1;
  if not found then
    return null;
  end if;

  return private.assemble_preorder_catalogue_v1(
    expected_business_id,
    page_definition,
    experience_definition,
    selected_change_set.candidate_snapshot_json,
    statement_timestamp()
  );
end;
$$;

revoke all on function private.assert_configuration_preview_v1(
  uuid,
  uuid,
  uuid
) from public, anon, authenticated, service_role;
revoke all on function private.assemble_preorder_catalogue_v1(
  uuid,
  jsonb,
  jsonb,
  jsonb,
  timestamptz
) from public, anon, authenticated, service_role;
revoke all on function private.resolve_preorder_catalogue_at(
  text,
  text,
  text,
  timestamptz
) from public, anon, authenticated, service_role;

revoke all on function public.load_configuration_preview(
  uuid,
  uuid,
  uuid
) from public, anon, service_role;
grant execute on function public.load_configuration_preview(
  uuid,
  uuid,
  uuid
) to authenticated;

revoke all on function public.resolve_configuration_preview_preorder(
  uuid,
  uuid,
  uuid,
  text,
  text
) from public, anon, service_role;
grant execute on function public.resolve_configuration_preview_preorder(
  uuid,
  uuid,
  uuid,
  text,
  text
) to authenticated;

comment on function public.load_configuration_preview(
  uuid,
  uuid,
  uuid
) is
  'Read-only Owner/Admin Phase 4B boundary that accepts only trusted identifiers, rejects stale or closed proposals, replays the immutable proposal and returns its stored candidate context without lifecycle mutation.';
comment on function public.resolve_configuration_preview_preorder(
  uuid,
  uuid,
  uuid,
  text,
  text
) is
  'Authenticated Phase 4B candidate preorder resolver. It re-verifies the stored proposal and uses the shared authoritative operational catalogue assembler without accepting caller-supplied configuration.';
comment on function private.assemble_preorder_catalogue_v1(
  uuid,
  jsonb,
  jsonb,
  jsonb,
  timestamptz
) is
  'Shared read-only preorder catalogue assembler used by both the live anonymous resolver and authenticated immutable-candidate preview.';
