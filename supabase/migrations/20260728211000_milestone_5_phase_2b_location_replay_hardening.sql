-- Milestone 5 Phase 2B hardening:
-- keep immutable candidate replay independent of mutable Location state and
-- make Location archival the only authenticated per-Location lifecycle path.

create or replace function private.assert_configuration_candidate_preorder_v1(
  target_business_id uuid,
  candidate jsonb,
  experience jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  config jsonb := experience -> 'config_json';
  relationship_definition jsonb;
  configured_public_field jsonb;
  configured_field jsonb;
  mapped_field jsonb;
  customer_phone_key text;
  order_phone_key text;
  runtime_order_field_keys text[];
  runtime_item_field_keys text[];
begin
  if target_business_id is null then
    raise exception 'configuration_candidate_business_invalid'
      using errcode = '22023';
  end if;

  perform private.assert_valid_preorder_config_shape(config);

  if not (experience ->> 'is_active')::boolean then
    return;
  end if;

  if exists (
    select 1
    from unnest(array[
      experience ->> 'product_object_key',
      experience ->> 'customer_object_key',
      experience ->> 'order_object_key',
      experience ->> 'order_item_object_key'
    ]) as referenced_object_key
    where not exists (
      select 1
      from jsonb_array_elements(
        candidate -> 'object_definitions'
      ) as object_definition
      where object_definition ->> 'key' = referenced_object_key
        and (object_definition ->> 'is_active')::boolean
    )
  ) then
    raise exception 'configuration_preorder_object_reference_invalid'
      using errcode = '23514';
  end if;

  select configured_relationship
  into relationship_definition
  from jsonb_array_elements(
    candidate -> 'relationship_definitions'
  ) as configured_relationship
  where configured_relationship ->> 'key' =
    experience ->> 'customer_places_order_relationship_key';
  if relationship_definition is null
    or not (relationship_definition ->> 'is_active')::boolean
    or relationship_definition ->> 'source_object_key' <>
      experience ->> 'customer_object_key'
    or relationship_definition ->> 'target_object_key' <>
      experience ->> 'order_object_key'
    or relationship_definition ->> 'cardinality' <> 'one_to_many'
  then
    raise exception 'configuration_customer_order_relationship_invalid'
      using errcode = '23514';
  end if;

  select configured_relationship
  into relationship_definition
  from jsonb_array_elements(
    candidate -> 'relationship_definitions'
  ) as configured_relationship
  where configured_relationship ->> 'key' =
    experience ->> 'order_contains_item_relationship_key';
  if relationship_definition is null
    or not (relationship_definition ->> 'is_active')::boolean
    or relationship_definition ->> 'source_object_key' <>
      experience ->> 'order_object_key'
    or relationship_definition ->> 'target_object_key' <>
      experience ->> 'order_item_object_key'
    or relationship_definition ->> 'cardinality' <> 'one_to_many'
  then
    raise exception 'configuration_order_item_relationship_invalid'
      using errcode = '23514';
  end if;

  select configured_relationship
  into relationship_definition
  from jsonb_array_elements(
    candidate -> 'relationship_definitions'
  ) as configured_relationship
  where configured_relationship ->> 'key' =
    experience ->> 'product_appears_in_item_relationship_key';
  if relationship_definition is null
    or not (relationship_definition ->> 'is_active')::boolean
    or relationship_definition ->> 'source_object_key' <>
      experience ->> 'product_object_key'
    or relationship_definition ->> 'target_object_key' <>
      experience ->> 'order_item_object_key'
    or relationship_definition ->> 'cardinality' <> 'one_to_many'
  then
    raise exception 'configuration_product_item_relationship_invalid'
      using errcode = '23514';
  end if;

  perform private.assert_configuration_candidate_field_v1(
    candidate,
    experience ->> 'product_object_key',
    private.preorder_mapping_key(config, 'product', 'name'),
    array['short_text']
  );
  perform private.assert_configuration_candidate_field_v1(
    candidate,
    experience ->> 'product_object_key',
    private.preorder_mapping_key(config, 'product', 'description'),
    array['short_text', 'long_text']
  );
  perform private.assert_configuration_candidate_field_v1(
    candidate,
    experience ->> 'product_object_key',
    private.preorder_mapping_key(config, 'product', 'price'),
    array['currency']
  );
  mapped_field := private.assert_configuration_candidate_field_v1(
    candidate,
    experience ->> 'product_object_key',
    private.preorder_mapping_key(config, 'product', 'status'),
    array['select', 'status']
  );
  if not (
    mapped_field -> 'settings_json' -> 'options'
      @> jsonb_build_array(
        config -> 'field_mappings' -> 'product' -> 'active_status_value'
      )
  ) then
    raise exception 'configuration_product_status_value_invalid'
      using errcode = '23514';
  end if;
  if private.preorder_mapping_key(config, 'product', 'image') is not null then
    perform private.assert_configuration_candidate_field_v1(
      candidate,
      experience ->> 'product_object_key',
      private.preorder_mapping_key(config, 'product', 'image'),
      array['file']
    );
  end if;

  perform private.assert_configuration_candidate_field_v1(
    candidate,
    experience ->> 'customer_object_key',
    private.preorder_mapping_key(config, 'customer', 'name'),
    array['short_text']
  );
  perform private.assert_configuration_candidate_field_v1(
    candidate,
    experience ->> 'customer_object_key',
    private.preorder_mapping_key(config, 'customer', 'email'),
    array['email']
  );
  customer_phone_key :=
    private.preorder_mapping_key(config, 'customer', 'phone');
  if customer_phone_key is not null then
    perform private.assert_configuration_candidate_field_v1(
      candidate,
      experience ->> 'customer_object_key',
      customer_phone_key,
      array['phone']
    );
  end if;

  perform private.assert_configuration_candidate_field_v1(
    candidate,
    experience ->> 'order_object_key',
    private.preorder_mapping_key(config, 'order', 'public_reference'),
    array['short_text']
  );
  mapped_field := private.assert_configuration_candidate_field_v1(
    candidate,
    experience ->> 'order_object_key',
    private.preorder_mapping_key(config, 'order', 'status'),
    array['select', 'status']
  );
  if not (
    mapped_field -> 'settings_json' -> 'options'
      @> jsonb_build_array(
        config -> 'field_mappings' -> 'order' -> 'new_status_value'
      )
  ) then
    raise exception 'configuration_order_status_value_invalid'
      using errcode = '23514';
  end if;

  perform private.assert_configuration_candidate_field_v1(
    candidate,
    experience ->> 'order_object_key',
    private.preorder_mapping_key(config, 'order', 'collection_at'),
    array['datetime']
  );
  perform private.assert_configuration_candidate_field_v1(
    candidate,
    experience ->> 'order_object_key',
    private.preorder_mapping_key(config, 'order', 'collection_local_display'),
    array['short_text']
  );
  perform private.assert_configuration_candidate_field_v1(
    candidate,
    experience ->> 'order_object_key',
    private.preorder_mapping_key(config, 'order', 'collection_timezone'),
    array['short_text']
  );
  perform private.assert_configuration_candidate_field_v1(
    candidate,
    experience ->> 'order_object_key',
    private.preorder_mapping_key(config, 'order', 'collection_location_name'),
    array['short_text']
  );
  perform private.assert_configuration_candidate_field_v1(
    candidate,
    experience ->> 'order_object_key',
    private.preorder_mapping_key(config, 'order', 'customer_name'),
    array['short_text']
  );
  perform private.assert_configuration_candidate_field_v1(
    candidate,
    experience ->> 'order_object_key',
    private.preorder_mapping_key(config, 'order', 'customer_email'),
    array['email']
  );
  order_phone_key :=
    private.preorder_mapping_key(config, 'order', 'customer_phone');
  if order_phone_key is not null then
    perform private.assert_configuration_candidate_field_v1(
      candidate,
      experience ->> 'order_object_key',
      order_phone_key,
      array['phone']
    );
  end if;
  if (customer_phone_key is null) <> (order_phone_key is null) then
    raise exception 'configuration_phone_mappings_disagree'
      using errcode = '23514';
  end if;
  perform private.assert_configuration_candidate_field_v1(
    candidate,
    experience ->> 'order_object_key',
    private.preorder_mapping_key(config, 'order', 'item_summary'),
    array['short_text', 'long_text']
  );
  perform private.assert_configuration_candidate_field_v1(
    candidate,
    experience ->> 'order_object_key',
    private.preorder_mapping_key(config, 'order', 'total'),
    array['currency']
  );

  perform private.assert_configuration_candidate_field_v1(
    candidate,
    experience ->> 'order_item_object_key',
    private.preorder_mapping_key(config, 'order_item', 'product_name'),
    array['short_text']
  );
  perform private.assert_configuration_candidate_field_v1(
    candidate,
    experience ->> 'order_item_object_key',
    private.preorder_mapping_key(config, 'order_item', 'quantity'),
    array['number']
  );
  perform private.assert_configuration_candidate_field_v1(
    candidate,
    experience ->> 'order_item_object_key',
    private.preorder_mapping_key(config, 'order_item', 'unit_price'),
    array['currency']
  );
  perform private.assert_configuration_candidate_field_v1(
    candidate,
    experience ->> 'order_item_object_key',
    private.preorder_mapping_key(config, 'order_item', 'line_total'),
    array['currency']
  );

  for configured_public_field in
    select value
    from jsonb_array_elements(config -> 'public_fields')
  loop
    configured_field :=
      private.assert_configuration_candidate_field_v1(
        candidate,
        case configured_public_field ->> 'target'
          when 'customer' then experience ->> 'customer_object_key'
          else experience ->> 'order_object_key'
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
        ]
      );

    if (configured_field ->> 'required')::boolean
      and not (configured_public_field ->> 'required')::boolean
    then
      raise exception 'configuration_public_required_field_invalid'
        using errcode = '23514';
    end if;
  end loop;

  if not exists (
    select 1
    from jsonb_array_elements(config -> 'public_fields') as public_field
    where public_field ->> 'target' = 'customer'
      and public_field ->> 'field' =
        private.preorder_mapping_key(config, 'customer', 'name')
      and (public_field ->> 'required')::boolean
  ) or not exists (
    select 1
    from jsonb_array_elements(config -> 'public_fields') as public_field
    where public_field ->> 'target' = 'customer'
      and public_field ->> 'field' =
        private.preorder_mapping_key(config, 'customer', 'email')
      and (public_field ->> 'required')::boolean
  ) then
    raise exception 'configuration_public_identity_fields_required'
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
    select field_definition
    from jsonb_array_elements(
      candidate -> 'field_definitions'
    ) as field_definition
    where field_definition ->> 'object_key' in (
      experience ->> 'customer_object_key',
      experience ->> 'order_object_key',
      experience ->> 'order_item_object_key'
    )
      and (field_definition ->> 'is_active')::boolean
      and (field_definition ->> 'required')::boolean
    order by
      field_definition ->> 'object_key' collate "C",
      (field_definition ->> 'position')::integer,
      field_definition ->> 'key' collate "C"
  loop
    if private.graph_value_is_present(
      configured_field -> 'default_value'
    ) then
      continue;
    end if;

    if configured_field ->> 'object_key' =
      experience ->> 'customer_object_key'
      and exists (
        select 1
        from jsonb_array_elements(config -> 'public_fields') as public_field
        where public_field ->> 'target' = 'customer'
          and public_field ->> 'field' = configured_field ->> 'key'
          and (public_field ->> 'required')::boolean
      )
    then
      continue;
    end if;

    if configured_field ->> 'object_key' =
      experience ->> 'order_object_key'
      and configured_field ->> 'key' = any(runtime_order_field_keys)
    then
      continue;
    end if;

    if configured_field ->> 'object_key' =
      experience ->> 'order_object_key'
      and configured_field ->> 'key' = order_phone_key
      and (
        exists (
          select 1
          from jsonb_array_elements(config -> 'public_fields') as public_field
          where public_field ->> 'target' = 'customer'
            and public_field ->> 'field' = customer_phone_key
            and (public_field ->> 'required')::boolean
        )
        or private.graph_value_is_present(
          private.configuration_candidate_field_v1(
            candidate,
            experience ->> 'customer_object_key',
            customer_phone_key
          ) -> 'default_value'
        )
      )
    then
      continue;
    end if;

    if configured_field ->> 'object_key' =
      experience ->> 'order_object_key'
      and exists (
        select 1
        from jsonb_array_elements(config -> 'public_fields') as public_field
        where public_field ->> 'target' = 'order'
          and public_field ->> 'field' = configured_field ->> 'key'
          and (public_field ->> 'required')::boolean
      )
    then
      continue;
    end if;

    if configured_field ->> 'object_key' =
      experience ->> 'order_item_object_key'
      and configured_field ->> 'key' = any(runtime_item_field_keys)
    then
      continue;
    end if;

    raise exception 'configuration_preorder_required_field_uncovered:%',
      configured_field ->> 'key'
      using errcode = '23514';
  end loop;

  if not exists (
    select 1
    from jsonb_array_elements(
      candidate -> 'preorder_experience_locations'
    ) as allowed
    where allowed ->> 'preorder_key' = experience ->> 'key'
      and (allowed ->> 'is_active')::boolean
  ) then
    raise exception 'configuration_preorder_location_required'
      using errcode = '23514';
  end if;

end;
$$;

create or replace function private.assert_configuration_candidate_v1(
  target_business_id uuid,
  candidate jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  object_definition jsonb;
  parent_object jsonb;
  field_definition jsonb;
  relationship_definition jsonb;
  source_object jsonb;
  target_object jsonb;
  view_definition jsonb;
  form_definition jsonb;
  page_definition jsonb;
  preorder_definition jsonb;
  allowed_location jsonb;
  referenced_field_key text;
  referenced_field jsonb;
  configured_field jsonb;
  block jsonb;
begin
  if not private.configuration_json_has_exact_keys(
    candidate,
    array[
      'schema_version',
      'object_definitions',
      'field_definitions',
      'relationship_definitions',
      'views',
      'forms',
      'pages',
      'preorder_experiences',
      'preorder_experience_locations'
    ]
  )
    or candidate ->> 'schema_version' <> '1'
    or jsonb_typeof(candidate -> 'object_definitions') <> 'array'
    or jsonb_typeof(candidate -> 'field_definitions') <> 'array'
    or jsonb_typeof(candidate -> 'relationship_definitions') <> 'array'
    or jsonb_typeof(candidate -> 'views') <> 'array'
    or jsonb_typeof(candidate -> 'forms') <> 'array'
    or jsonb_typeof(candidate -> 'pages') <> 'array'
    or jsonb_typeof(candidate -> 'preorder_experiences') <> 'array'
    or jsonb_typeof(
      candidate -> 'preorder_experience_locations'
    ) <> 'array'
  then
    raise exception 'configuration_candidate_shape_invalid'
      using errcode = '22023';
  end if;

  if octet_length(candidate::text) > 1048576 then
    raise exception 'configuration_candidate_too_large'
      using errcode = '22023';
  end if;

  if exists (
    select entity_key
    from (
      select candidate_object ->> 'key' as entity_key
      from jsonb_array_elements(
        candidate -> 'object_definitions'
      ) as candidate_object
    ) as object_keys
    group by entity_key
    having count(*) > 1
  ) or exists (
    select entity_key
    from (
      select
        (candidate_field ->> 'object_key') || chr(31) ||
          (candidate_field ->> 'key') as entity_key
      from jsonb_array_elements(
        candidate -> 'field_definitions'
      ) as candidate_field
    ) as field_keys
    group by entity_key
    having count(*) > 1
  ) or exists (
    select entity_key
    from (
      select candidate_relationship ->> 'key' as entity_key
      from jsonb_array_elements(
        candidate -> 'relationship_definitions'
      ) as candidate_relationship
    ) as relationship_keys
    group by entity_key
    having count(*) > 1
  ) or exists (
    select entity_key
    from (
      select candidate_view ->> 'key' as entity_key
      from jsonb_array_elements(candidate -> 'views') as candidate_view
    ) as view_keys
    group by entity_key
    having count(*) > 1
  ) or exists (
    select entity_key
    from (
      select candidate_form ->> 'key' as entity_key
      from jsonb_array_elements(candidate -> 'forms') as candidate_form
    ) as form_keys
    group by entity_key
    having count(*) > 1
  ) or exists (
    select entity_key
    from (
      select candidate_page ->> 'key' as entity_key
      from jsonb_array_elements(candidate -> 'pages') as candidate_page
    ) as page_keys
    group by entity_key
    having count(*) > 1
  ) or exists (
    select page_slug
    from (
      select candidate_page ->> 'slug' as page_slug
      from jsonb_array_elements(candidate -> 'pages') as candidate_page
    ) as page_slugs
    group by page_slug
    having count(*) > 1
  ) or exists (
    select entity_key
    from (
      select candidate_preorder ->> 'key' as entity_key
      from jsonb_array_elements(
        candidate -> 'preorder_experiences'
      ) as candidate_preorder
    ) as preorder_keys
    group by entity_key
    having count(*) > 1
  ) or exists (
    select entity_key
    from (
      select
        (allowed ->> 'preorder_key') || chr(31) ||
          (allowed ->> 'location_id') as entity_key
      from jsonb_array_elements(
        candidate -> 'preorder_experience_locations'
      ) as allowed
    ) as allowed_keys
    group by entity_key
    having count(*) > 1
  ) then
    raise exception 'configuration_candidate_duplicate_identity'
      using errcode = '23505';
  end if;

  for object_definition in
    select value
    from jsonb_array_elements(candidate -> 'object_definitions')
  loop
    if not private.configuration_json_has_exact_keys(
      object_definition,
      array[
        'id',
        'key',
        'singular_label',
        'plural_label',
        'description',
        'kind',
        'semantic_type',
        'icon',
        'is_active'
      ]
    )
      or not private.configuration_uuid_is_valid(
        object_definition ->> 'id'
      )
      or not private.experience_key_is_valid(object_definition ->> 'key')
      or not private.experience_string_is_valid(
        object_definition ->> 'singular_label',
        120
      )
      or not private.experience_string_is_valid(
        object_definition ->> 'plural_label',
        120
      )
      or jsonb_typeof(object_definition -> 'description') <> 'string'
      or object_definition ->> 'kind' not in ('template', 'custom')
      or (
        object_definition -> 'semantic_type' <> 'null'::jsonb
        and (
          jsonb_typeof(object_definition -> 'semantic_type') <> 'string'
          or not private.experience_string_is_valid(
            object_definition ->> 'semantic_type',
            80
          )
        )
      )
      or (
        object_definition -> 'icon' <> 'null'::jsonb
        and (
          jsonb_typeof(object_definition -> 'icon') <> 'string'
          or not private.experience_string_is_valid(
            object_definition ->> 'icon',
            120
          )
        )
      )
      or jsonb_typeof(object_definition -> 'is_active') <> 'boolean'
    then
      raise exception 'configuration_candidate_object_invalid'
        using errcode = '22023';
    end if;
  end loop;

  for field_definition in
    select value
    from jsonb_array_elements(candidate -> 'field_definitions')
  loop
    if not private.configuration_json_has_exact_keys(
      field_definition,
      array[
        'id',
        'object_definition_id',
        'object_key',
        'key',
        'label',
        'field_type',
        'required',
        'default_value',
        'settings_json',
        'position',
        'is_active'
      ]
    )
      or not private.configuration_uuid_is_valid(
        field_definition ->> 'id'
      )
      or not private.configuration_uuid_is_valid(
        field_definition ->> 'object_definition_id'
      )
      or not private.experience_key_is_valid(
        field_definition ->> 'object_key'
      )
      or not private.experience_key_is_valid(field_definition ->> 'key')
      or not private.experience_string_is_valid(
        field_definition ->> 'label',
        120
      )
      or field_definition ->> 'field_type' not in (
        'short_text',
        'long_text',
        'number',
        'currency',
        'boolean',
        'date',
        'datetime',
        'email',
        'phone',
        'url',
        'select',
        'multi_select',
        'file',
        'status'
      )
      or jsonb_typeof(field_definition -> 'required') <> 'boolean'
      or jsonb_typeof(field_definition -> 'settings_json') <> 'object'
      or jsonb_typeof(field_definition -> 'position') <> 'number'
      or (field_definition ->> 'position') !~ '^[0-9]+$'
      or jsonb_typeof(field_definition -> 'is_active') <> 'boolean'
    then
      raise exception 'configuration_candidate_field_invalid'
        using errcode = '22023';
    end if;

    select configured_object
    into parent_object
    from jsonb_array_elements(
      candidate -> 'object_definitions'
    ) as configured_object
    where configured_object ->> 'key' =
      field_definition ->> 'object_key';
    if parent_object is null
      or parent_object ->> 'id' <>
        field_definition ->> 'object_definition_id'
    then
      raise exception 'configuration_field_object_reference_invalid'
        using errcode = '23514';
    end if;

    if field_definition ->> 'field_type' in (
      'select',
      'multi_select',
      'status'
    ) and not private.graph_options_are_valid(
      field_definition -> 'settings_json'
    ) then
      raise exception 'configuration_candidate_field_options_invalid'
        using errcode = '22023';
    end if;

    if field_definition -> 'default_value' <> 'null'::jsonb
      and not private.graph_field_value_is_valid(
        field_definition -> 'default_value',
        (field_definition ->> 'field_type')::public.graph_field_type,
        field_definition -> 'settings_json'
      )
    then
      raise exception 'configuration_candidate_field_default_invalid'
        using errcode = '22023';
    end if;
  end loop;

  for relationship_definition in
    select value
    from jsonb_array_elements(candidate -> 'relationship_definitions')
  loop
    if not private.configuration_json_has_exact_keys(
      relationship_definition,
      array[
        'id',
        'key',
        'source_object_definition_id',
        'source_object_key',
        'target_object_definition_id',
        'target_object_key',
        'source_label',
        'target_label',
        'cardinality',
        'is_required',
        'is_active'
      ]
    )
      or not private.configuration_uuid_is_valid(
        relationship_definition ->> 'id'
      )
      or not private.experience_key_is_valid(
        relationship_definition ->> 'key'
      )
      or relationship_definition ->> 'cardinality' not in (
        'one_to_one',
        'one_to_many',
        'many_to_many'
      )
      or not private.experience_string_is_valid(
        relationship_definition ->> 'source_label',
        120
      )
      or not private.experience_string_is_valid(
        relationship_definition ->> 'target_label',
        120
      )
      or jsonb_typeof(
        relationship_definition -> 'is_required'
      ) <> 'boolean'
      or jsonb_typeof(
        relationship_definition -> 'is_active'
      ) <> 'boolean'
    then
      raise exception 'configuration_candidate_relationship_invalid'
        using errcode = '22023';
    end if;

    select configured_object
    into source_object
    from jsonb_array_elements(
      candidate -> 'object_definitions'
    ) as configured_object
    where configured_object ->> 'key' =
      relationship_definition ->> 'source_object_key';
    select configured_object
    into target_object
    from jsonb_array_elements(
      candidate -> 'object_definitions'
    ) as configured_object
    where configured_object ->> 'key' =
      relationship_definition ->> 'target_object_key';
    if source_object is null
      or target_object is null
      or source_object ->> 'id' <>
        relationship_definition ->> 'source_object_definition_id'
      or target_object ->> 'id' <>
        relationship_definition ->> 'target_object_definition_id'
      or (
        (relationship_definition ->> 'is_active')::boolean
        and (
          not (source_object ->> 'is_active')::boolean
          or not (target_object ->> 'is_active')::boolean
        )
      )
    then
      raise exception 'configuration_relationship_endpoint_invalid'
        using errcode = '23514';
    end if;
  end loop;

  for view_definition in
    select value
    from jsonb_array_elements(candidate -> 'views')
  loop
    if not private.configuration_json_has_exact_keys(
      view_definition,
      array[
        'id',
        'key',
        'name',
        'view_type',
        'object_definition_id',
        'object_key',
        'config_json',
        'audience',
        'is_active'
      ]
    )
      or not private.configuration_uuid_is_valid(view_definition ->> 'id')
      or not private.experience_key_is_valid(view_definition ->> 'key')
      or not private.experience_string_is_valid(
        view_definition ->> 'name',
        120
      )
      or view_definition ->> 'view_type' not in (
        'table',
        'list',
        'cards',
        'detail'
      )
      or view_definition ->> 'audience' not in ('internal', 'public')
      or jsonb_typeof(view_definition -> 'is_active') <> 'boolean'
    then
      raise exception 'configuration_candidate_view_invalid'
        using errcode = '22023';
    end if;

    perform private.assert_valid_view_config_shape(
      (view_definition ->> 'view_type')::public.experience_view_type,
      view_definition -> 'config_json'
    );

    select configured_object
    into parent_object
    from jsonb_array_elements(
      candidate -> 'object_definitions'
    ) as configured_object
    where configured_object ->> 'key' =
      view_definition ->> 'object_key';
    if parent_object is null
      or parent_object ->> 'id' <>
        view_definition ->> 'object_definition_id'
      or (
        (view_definition ->> 'is_active')::boolean
        and not (parent_object ->> 'is_active')::boolean
      )
    then
      raise exception 'configuration_view_object_reference_invalid'
        using errcode = '23514';
    end if;

    if (view_definition ->> 'is_active')::boolean then
      for referenced_field_key in
        select distinct field_key
        from private.experience_view_field_keys(
          (view_definition ->> 'view_type')::public.experience_view_type,
          view_definition -> 'config_json'
        ) as field_key
      loop
        referenced_field := private.configuration_candidate_field_v1(
          candidate,
          view_definition ->> 'object_key',
          referenced_field_key
        );
        if referenced_field is null
          or not (referenced_field ->> 'is_active')::boolean
        then
          raise exception 'configuration_view_field_reference_invalid:%',
            referenced_field_key
            using errcode = '23514';
        end if;
      end loop;

      if view_definition -> 'config_json' ? 'image_field' then
        referenced_field := private.configuration_candidate_field_v1(
          candidate,
          view_definition ->> 'object_key',
          view_definition -> 'config_json' ->> 'image_field'
        );
        if referenced_field ->> 'field_type' <> 'file' then
          raise exception 'configuration_view_image_field_invalid'
            using errcode = '23514';
        end if;
      end if;

      if view_definition -> 'config_json' ? 'create_form_key'
        and not exists (
          select 1
          from jsonb_array_elements(candidate -> 'forms') as candidate_form
          where candidate_form ->> 'key' =
            view_definition -> 'config_json' ->> 'create_form_key'
            and candidate_form ->> 'object_key' =
              view_definition ->> 'object_key'
            and candidate_form ->> 'mode' = 'create'
            and candidate_form ->> 'audience' =
              view_definition ->> 'audience'
            and (candidate_form ->> 'is_active')::boolean
        )
      then
        raise exception 'configuration_view_create_form_invalid'
          using errcode = '23514';
      end if;

      if view_definition -> 'config_json' ? 'edit_form_key'
        and not exists (
          select 1
          from jsonb_array_elements(candidate -> 'forms') as candidate_form
          where candidate_form ->> 'key' =
            view_definition -> 'config_json' ->> 'edit_form_key'
            and candidate_form ->> 'object_key' =
              view_definition ->> 'object_key'
            and candidate_form ->> 'mode' = 'edit'
            and candidate_form ->> 'audience' =
              view_definition ->> 'audience'
            and (candidate_form ->> 'is_active')::boolean
        )
      then
        raise exception 'configuration_view_edit_form_invalid'
          using errcode = '23514';
      end if;
    end if;
  end loop;

  for form_definition in
    select value
    from jsonb_array_elements(candidate -> 'forms')
  loop
    if not private.configuration_json_has_exact_keys(
      form_definition,
      array[
        'id',
        'key',
        'name',
        'object_definition_id',
        'object_key',
        'mode',
        'config_json',
        'audience',
        'is_active'
      ]
    )
      or not private.configuration_uuid_is_valid(form_definition ->> 'id')
      or not private.experience_key_is_valid(form_definition ->> 'key')
      or not private.experience_string_is_valid(
        form_definition ->> 'name',
        120
      )
      or form_definition ->> 'mode' not in ('create', 'edit')
      or form_definition ->> 'audience' not in ('internal', 'public')
      or jsonb_typeof(form_definition -> 'is_active') <> 'boolean'
    then
      raise exception 'configuration_candidate_form_invalid'
        using errcode = '22023';
    end if;

    perform private.assert_valid_form_config_shape(
      form_definition -> 'config_json'
    );

    select configured_object
    into parent_object
    from jsonb_array_elements(
      candidate -> 'object_definitions'
    ) as configured_object
    where configured_object ->> 'key' =
      form_definition ->> 'object_key';
    if parent_object is null
      or parent_object ->> 'id' <>
        form_definition ->> 'object_definition_id'
      or (
        (form_definition ->> 'is_active')::boolean
        and not (parent_object ->> 'is_active')::boolean
      )
    then
      raise exception 'configuration_form_object_reference_invalid'
        using errcode = '23514';
    end if;

    if (form_definition ->> 'is_active')::boolean then
      for configured_field in
        select value
        from jsonb_array_elements(
          form_definition -> 'config_json' -> 'fields'
        )
      loop
        referenced_field := private.configuration_candidate_field_v1(
          candidate,
          form_definition ->> 'object_key',
          configured_field ->> 'field'
        );
        if referenced_field is null
          or not (referenced_field ->> 'is_active')::boolean
        then
          raise exception 'configuration_form_field_reference_invalid:%',
            configured_field ->> 'field'
            using errcode = '23514';
        end if;

        if configured_field ? 'default_value'
          and not private.graph_field_value_is_valid(
            configured_field -> 'default_value',
            (referenced_field ->> 'field_type')::public.graph_field_type,
            referenced_field -> 'settings_json'
          )
        then
          raise exception 'configuration_form_default_invalid:%',
            configured_field ->> 'field'
            using errcode = '23514';
        end if;
      end loop;

      if form_definition ->> 'mode' = 'create'
        and exists (
          select 1
          from jsonb_array_elements(
            candidate -> 'field_definitions'
          ) as required_field
          where required_field ->> 'object_key' =
            form_definition ->> 'object_key'
            and (required_field ->> 'is_active')::boolean
            and (required_field ->> 'required')::boolean
            and required_field -> 'default_value' = 'null'::jsonb
            and not exists (
              select 1
              from jsonb_array_elements(
                form_definition -> 'config_json' -> 'fields'
              ) as form_field
              where form_field ->> 'field' =
                required_field ->> 'key'
            )
        )
      then
        raise exception 'configuration_create_form_required_coverage_invalid'
          using errcode = '23514';
      end if;
    end if;
  end loop;

  for page_definition in
    select value
    from jsonb_array_elements(candidate -> 'pages')
  loop
    if not private.configuration_json_has_exact_keys(
      page_definition,
      array[
        'id',
        'key',
        'title',
        'slug',
        'audience',
        'layout_json',
        'status',
        'is_active'
      ]
    )
      or not private.configuration_uuid_is_valid(page_definition ->> 'id')
      or not private.experience_key_is_valid(page_definition ->> 'key')
      or not private.experience_string_is_valid(
        page_definition ->> 'title',
        120
      )
      or (page_definition ->> 'slug')
        !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      or char_length(page_definition ->> 'slug') not between 1 and 80
      or page_definition ->> 'audience' not in ('internal', 'public')
      or page_definition ->> 'status' not in ('draft', 'published')
      or jsonb_typeof(page_definition -> 'is_active') <> 'boolean'
    then
      raise exception 'configuration_candidate_page_invalid'
        using errcode = '22023';
    end if;

    perform private.assert_valid_page_config_shape(
      page_definition -> 'layout_json'
    );

    if (page_definition ->> 'is_active')::boolean then
      if page_definition ->> 'audience' = 'public'
        and page_definition ->> 'status' = 'published'
        and exists (
          select 1
          from jsonb_array_elements(
            page_definition -> 'layout_json' -> 'blocks'
          ) as configured_block
          where configured_block ->> 'type' in ('view', 'form')
        )
      then
        raise exception 'configuration_public_page_exposure_invalid'
          using errcode = '23514';
      end if;

      for block in
        select value
        from jsonb_array_elements(
          page_definition -> 'layout_json' -> 'blocks'
        )
      loop
        if block ->> 'type' = 'view'
          and not exists (
            select 1
            from jsonb_array_elements(candidate -> 'views') as page_view
            where page_view ->> 'key' = block ->> 'view_key'
              and page_view ->> 'audience' =
                page_definition ->> 'audience'
              and (page_view ->> 'is_active')::boolean
          )
        then
          raise exception 'configuration_page_view_reference_invalid'
            using errcode = '23514';
        elsif block ->> 'type' = 'form'
          and not exists (
            select 1
            from jsonb_array_elements(candidate -> 'forms') as page_form
            where page_form ->> 'key' = block ->> 'form_key'
              and page_form ->> 'audience' =
                page_definition ->> 'audience'
              and page_form ->> 'mode' = 'create'
              and (page_form ->> 'is_active')::boolean
          )
        then
          raise exception 'configuration_page_form_reference_invalid'
            using errcode = '23514';
        elsif block ->> 'type' = 'preorder' then
          if page_definition ->> 'audience' <> 'public'
            or not exists (
              select 1
              from jsonb_array_elements(
                candidate -> 'preorder_experiences'
              ) as page_preorder
              where page_preorder ->> 'key' =
                block ->> 'preorder_key'
                and (page_preorder ->> 'is_active')::boolean
            )
          then
            raise exception 'configuration_page_preorder_reference_invalid'
              using errcode = '23514';
          end if;
        end if;
      end loop;
    end if;
  end loop;

  for preorder_definition in
    select value
    from jsonb_array_elements(candidate -> 'preorder_experiences')
  loop
    if not private.configuration_json_has_exact_keys(
      preorder_definition,
      array[
        'id',
        'key',
        'product_object_definition_id',
        'product_object_key',
        'customer_object_definition_id',
        'customer_object_key',
        'order_object_definition_id',
        'order_object_key',
        'order_item_object_definition_id',
        'order_item_object_key',
        'customer_places_order_relationship_definition_id',
        'customer_places_order_relationship_key',
        'order_contains_item_relationship_definition_id',
        'order_contains_item_relationship_key',
        'product_appears_in_item_relationship_definition_id',
        'product_appears_in_item_relationship_key',
        'config_json',
        'is_active'
      ]
    )
      or not private.configuration_uuid_is_valid(
        preorder_definition ->> 'id'
      )
      or not private.experience_key_is_valid(
        preorder_definition ->> 'key'
      )
      or jsonb_typeof(preorder_definition -> 'config_json') <> 'object'
      or jsonb_typeof(preorder_definition -> 'is_active') <> 'boolean'
    then
      raise exception 'configuration_candidate_preorder_invalid'
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from (
        values
          (
            preorder_definition ->> 'product_object_key',
            preorder_definition ->> 'product_object_definition_id'
          ),
          (
            preorder_definition ->> 'customer_object_key',
            preorder_definition ->> 'customer_object_definition_id'
          ),
          (
            preorder_definition ->> 'order_object_key',
            preorder_definition ->> 'order_object_definition_id'
          ),
          (
            preorder_definition ->> 'order_item_object_key',
            preorder_definition ->> 'order_item_object_definition_id'
          )
      ) as object_reference(object_key, object_id)
      where not exists (
        select 1
        from jsonb_array_elements(
          candidate -> 'object_definitions'
        ) as referenced_object
        where referenced_object ->> 'key' = object_reference.object_key
          and referenced_object ->> 'id' = object_reference.object_id
      )
    ) or exists (
      select 1
      from (
        values
          (
            preorder_definition ->>
              'customer_places_order_relationship_key',
            preorder_definition ->>
              'customer_places_order_relationship_definition_id'
          ),
          (
            preorder_definition ->>
              'order_contains_item_relationship_key',
            preorder_definition ->>
              'order_contains_item_relationship_definition_id'
          ),
          (
            preorder_definition ->>
              'product_appears_in_item_relationship_key',
            preorder_definition ->>
              'product_appears_in_item_relationship_definition_id'
          )
      ) as relationship_reference(relationship_key, relationship_id)
      where not exists (
        select 1
        from jsonb_array_elements(
          candidate -> 'relationship_definitions'
        ) as referenced_relationship
        where referenced_relationship ->> 'key' =
          relationship_reference.relationship_key
          and referenced_relationship ->> 'id' =
            relationship_reference.relationship_id
      )
    ) then
      raise exception 'configuration_preorder_identity_reference_invalid'
        using errcode = '23514';
    end if;

    perform private.assert_configuration_candidate_preorder_v1(
      target_business_id,
      candidate,
      preorder_definition
    );
  end loop;

  for allowed_location in
    select value
    from jsonb_array_elements(
      candidate -> 'preorder_experience_locations'
    )
  loop
    if not private.configuration_json_has_exact_keys(
      allowed_location,
      array[
        'id',
        'preorder_experience_id',
        'preorder_key',
        'location_id',
        'is_active'
      ]
    )
      or not private.configuration_uuid_is_valid(
        allowed_location ->> 'id'
      )
      or not private.configuration_uuid_is_valid(
        allowed_location ->> 'preorder_experience_id'
      )
      or not private.configuration_uuid_is_valid(
        allowed_location ->> 'location_id'
      )
      or jsonb_typeof(allowed_location -> 'is_active') <> 'boolean'
    then
      raise exception 'configuration_candidate_preorder_location_invalid'
        using errcode = '22023';
    end if;

    select configured_preorder
    into preorder_definition
    from jsonb_array_elements(
      candidate -> 'preorder_experiences'
    ) as configured_preorder
    where configured_preorder ->> 'key' =
      allowed_location ->> 'preorder_key';
    if preorder_definition is null
      or preorder_definition ->> 'id' <>
        allowed_location ->> 'preorder_experience_id'
    then
      raise exception 'configuration_preorder_location_reference_invalid'
        using errcode = '23514';
    end if;
  end loop;
end;
$$;

create or replace function public.validate_configuration_change(
  expected_business_id uuid,
  expected_actor_id uuid,
  requested_change_set_id uuid
)
returns public.configuration_change_sets
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  current_head public.business_configuration_heads;
  selected_change_set public.configuration_change_sets;
  base_version public.configuration_versions;
  replayed jsonb;
  live_snapshot jsonb;
  validation_result jsonb;
  lifecycle_at timestamptz;
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

  select head.*
  into current_head
  from public.business_configuration_heads as head
  where head.business_id = expected_business_id
  for update;
  if not found then
    raise exception 'configuration_head_not_found'
      using errcode = 'P0002';
  end if;

  select change_set.*
  into selected_change_set
  from public.configuration_change_sets as change_set
  where change_set.business_id = expected_business_id
    and change_set.id = requested_change_set_id
  for update;
  if not found then
    raise exception 'configuration_change_set_not_found'
      using errcode = 'P0002';
  end if;

  if selected_change_set.status = 'validated' then
    return selected_change_set;
  end if;
  if selected_change_set.status <> 'proposed' then
    raise exception 'configuration_change_set_not_validatable'
      using errcode = '55000';
  end if;

  if selected_change_set.base_version_id <>
      current_head.active_version_id
    or selected_change_set.base_head_revision <>
      current_head.head_revision
  then
    update public.configuration_change_sets as change_set
    set
      status = 'conflicted',
      closed_by = current_actor_id,
      closed_at = now(),
      updated_at = now()
    where change_set.business_id = expected_business_id
      and change_set.id = requested_change_set_id
    returning change_set.* into selected_change_set;
    return selected_change_set;
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

  begin
    replayed := private.configuration_materialize_candidate_v1(
      expected_business_id,
      base_version.snapshot_json,
      selected_change_set.operations_json,
      selected_change_set.id_allocations_json
    );
  exception
    when others then
      raise exception 'configuration_candidate_replay_failed'
        using errcode = 'P0001';
  end;

  if replayed -> 'candidate_snapshot' <>
      selected_change_set.candidate_snapshot_json
    or replayed ->> 'candidate_checksum' <>
      selected_change_set.candidate_checksum
    or replayed -> 'id_allocations' <>
      selected_change_set.id_allocations_json
    or replayed -> 'semantic_diff' <>
      selected_change_set.semantic_diff_json
  then
    raise exception 'configuration_candidate_replay_mismatch'
      using errcode = 'P0001';
  end if;

  live_snapshot := private.configuration_snapshot_v1(expected_business_id);
  if live_snapshot <> base_version.snapshot_json
    or private.configuration_snapshot_checksum_v1(live_snapshot) <>
      base_version.snapshot_checksum
  then
    raise exception 'configuration_projection_out_of_sync'
      using errcode = 'P0001';
  end if;

  validation_result :=
    private.validate_configuration_candidate_in_sandbox_v1(
      expected_business_id,
      selected_change_set.base_version_id,
      selected_change_set.base_head_revision,
      selected_change_set.candidate_checksum,
      selected_change_set.candidate_snapshot_json
    );
  lifecycle_at := now();

  if validation_result ->> 'outcome' = 'valid' then
    update public.configuration_change_sets as change_set
    set
      status = 'validated',
      validation_result_json = validation_result,
      validated_by = current_actor_id,
      validated_at = lifecycle_at,
      updated_at = lifecycle_at
    where change_set.business_id = expected_business_id
      and change_set.id = requested_change_set_id
    returning change_set.* into selected_change_set;
  else
    update public.configuration_change_sets as change_set
    set
      status = 'rejected',
      validation_result_json = validation_result,
      validated_by = current_actor_id,
      validated_at = lifecycle_at,
      closed_by = current_actor_id,
      closed_at = lifecycle_at,
      updated_at = lifecycle_at
    where change_set.business_id = expected_business_id
      and change_set.id = requested_change_set_id
    returning change_set.* into selected_change_set;
  end if;

  return selected_change_set;
end;
$$;

drop policy if exists "Owners and admins can delete locations"
on public.locations;

revoke delete on table public.locations from authenticated;

revoke all on function private.assert_configuration_candidate_preorder_v1(
  uuid,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.assert_configuration_candidate_v1(
  uuid,
  jsonb
) from public, anon, authenticated, service_role;

comment on function private.assert_configuration_candidate_preorder_v1(
  uuid,
  jsonb,
  jsonb
) is
  'Validates preorder candidate structure without consulting mutable Location rows.';
comment on function private.assert_configuration_candidate_v1(uuid, jsonb) is
  'Validates canonical candidate structure and references without current operational Location eligibility.';
comment on function public.validate_configuration_change(uuid, uuid, uuid) is
  'Owner/Admin validation lifecycle boundary with immutable replay and rollback-only authoritative projection validation.';
comment on column public.locations.is_active is
  'v0.1 per-Location lifecycle boundary; authenticated hard deletion is not allowed.';
