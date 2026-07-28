create type public.configuration_change_kind as enum (
  'change',
  'rollback'
);

create type public.configuration_change_status as enum (
  'proposed',
  'validated',
  'applied',
  'rejected',
  'conflicted',
  'abandoned'
);

create table public.configuration_change_sets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null
    references public.businesses(id) on delete cascade,
  kind public.configuration_change_kind not null,
  status public.configuration_change_status not null default 'proposed',
  title text not null check (
    char_length(trim(title)) between 1 and 120
  ),
  description text null check (
    description is null or char_length(description) <= 5000
  ),
  base_version_id uuid not null,
  base_head_revision bigint not null check (base_head_revision > 0),
  rollback_target_version_id uuid null,
  requested_by uuid not null,
  operations_schema_version integer not null check (
    operations_schema_version > 0
  ),
  operations_json jsonb not null check (
    jsonb_typeof(operations_json) = 'array'
    and jsonb_array_length(operations_json) between 1 and 100
    and octet_length(operations_json::text) <= 262144
  ),
  id_allocations_json jsonb not null check (
    jsonb_typeof(id_allocations_json) = 'object'
    and octet_length(id_allocations_json::text) <= 131072
  ),
  candidate_snapshot_json jsonb not null check (
    jsonb_typeof(candidate_snapshot_json) = 'object'
    and octet_length(candidate_snapshot_json::text) <= 1048576
  ),
  candidate_checksum text not null check (
    candidate_checksum ~ '^[a-f0-9]{64}$'
    and candidate_checksum =
      private.configuration_snapshot_checksum_v1(candidate_snapshot_json)
  ),
  semantic_diff_json jsonb not null check (
    jsonb_typeof(semantic_diff_json) = 'object'
    and octet_length(semantic_diff_json::text) <= 524288
  ),
  validation_result_json jsonb null check (
    validation_result_json is null
    or (
      jsonb_typeof(validation_result_json) = 'object'
      and octet_length(validation_result_json::text) <= 524288
    )
  ),
  validated_by uuid null,
  validated_at timestamptz null,
  applied_version_id uuid null,
  applied_by uuid null,
  applied_at timestamptz null,
  closed_by uuid null,
  closed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  constraint configuration_change_sets_tenant_base_version_fkey
    foreign key (business_id, base_version_id)
    references public.configuration_versions(business_id, id),
  constraint configuration_change_sets_tenant_rollback_target_fkey
    foreign key (business_id, rollback_target_version_id)
    references public.configuration_versions(business_id, id),
  constraint configuration_change_sets_tenant_applied_version_fkey
    foreign key (business_id, applied_version_id)
    references public.configuration_versions(business_id, id),
  constraint configuration_change_sets_kind_shape
    check (
      (
        kind = 'change'
        and rollback_target_version_id is null
      )
      or (
        kind = 'rollback'
        and rollback_target_version_id is not null
      )
    ),
  constraint configuration_change_sets_validation_shape
    check (
      (
        validation_result_json is null
        and validated_by is null
        and validated_at is null
      )
      or (
        validation_result_json is not null
        and validated_by is not null
        and validated_at is not null
      )
    ),
  constraint configuration_change_sets_application_shape
    check (
      (
        status = 'applied'
        and applied_version_id is not null
        and applied_by is not null
        and applied_at is not null
      )
      or (
        status <> 'applied'
        and applied_version_id is null
        and applied_by is null
        and applied_at is null
      )
    ),
  constraint configuration_change_sets_closure_shape
    check (
      (
        status in ('rejected', 'conflicted', 'abandoned')
        and closed_by is not null
        and closed_at is not null
      )
      or (
        status not in ('rejected', 'conflicted', 'abandoned')
        and closed_by is null
        and closed_at is null
      )
    )
);

alter table public.configuration_versions
  add constraint configuration_versions_tenant_source_change_set_fkey
  foreign key (business_id, source_change_set_id)
  references public.configuration_change_sets(business_id, id);

create index configuration_change_sets_business_created_idx
  on public.configuration_change_sets(business_id, created_at desc);

create index configuration_change_sets_business_status_idx
  on public.configuration_change_sets(business_id, status, created_at desc);

create function private.protect_configuration_change_set()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'proposed'
    and new.status = 'abandoned'
    and new.business_id = old.business_id
    and new.kind = old.kind
    and new.title = old.title
    and new.description is not distinct from old.description
    and new.base_version_id = old.base_version_id
    and new.base_head_revision = old.base_head_revision
    and new.rollback_target_version_id is not distinct from
      old.rollback_target_version_id
    and new.requested_by = old.requested_by
    and new.operations_schema_version = old.operations_schema_version
    and new.operations_json = old.operations_json
    and new.id_allocations_json = old.id_allocations_json
    and new.candidate_snapshot_json = old.candidate_snapshot_json
    and new.candidate_checksum = old.candidate_checksum
    and new.semantic_diff_json = old.semantic_diff_json
    and new.validation_result_json is not distinct from
      old.validation_result_json
    and new.validated_by is not distinct from old.validated_by
    and new.validated_at is not distinct from old.validated_at
    and new.applied_version_id is not distinct from old.applied_version_id
    and new.applied_by is not distinct from old.applied_by
    and new.applied_at is not distinct from old.applied_at
    and new.closed_by is not null
    and new.closed_at is not null
    and new.created_at = old.created_at
  then
    return new;
  end if;

  raise exception 'configuration_change_set_immutable'
    using errcode = '55000';
end;
$$;

create trigger configuration_change_sets_protect
before update on public.configuration_change_sets
for each row execute function private.protect_configuration_change_set();

create function private.reject_configuration_change_set_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.businesses
    where id = old.business_id
  ) then
    raise exception 'configuration_change_set_delete_forbidden'
      using errcode = '55000';
  end if;

  return old;
end;
$$;

create trigger configuration_change_sets_reject_delete
before delete on public.configuration_change_sets
for each row execute function private.reject_configuration_change_set_delete();

create function private.configuration_json_has_exact_keys(
  value jsonb,
  required_keys text[]
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(value) = 'object'
      and value ?& required_keys
      and value - required_keys = '{}'::jsonb,
    false
  );
$$;

create function private.configuration_json_has_only_keys(
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

create function private.configuration_uuid_is_valid(value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    false
  );
$$;

create function private.configuration_operation_target_v1(operation jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case operation ->> 'op'
    when 'set_object' then 'object:' || (operation ->> 'key')
    when 'set_field' then
      'field:' || (operation ->> 'object_key') || '.' ||
        (operation ->> 'key')
    when 'set_relationship' then
      'relationship:' || (operation ->> 'key')
    when 'set_view' then 'view:' || (operation ->> 'key')
    when 'set_form' then 'form:' || (operation ->> 'key')
    when 'set_page' then 'page:' || (operation ->> 'key')
    when 'set_preorder_experience' then
      'preorder:' || (operation ->> 'key')
    else null
  end;
$$;

create function private.assert_configuration_operations_v1(
  operations jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  operation jsonb;
  operation_type text;
begin
  if operations is null
    or jsonb_typeof(operations) <> 'array'
    or jsonb_array_length(operations) not between 1 and 100
    or octet_length(operations::text) > 262144
  then
    raise exception 'configuration_operations_invalid'
      using errcode = '22023';
  end if;

  for operation in
    select value
    from jsonb_array_elements(operations)
  loop
    operation_type := operation ->> 'op';

    if operation_type = 'set_object' then
      if not private.configuration_json_has_exact_keys(
        operation,
        array[
          'op',
          'key',
          'singular_label',
          'plural_label',
          'description',
          'icon',
          'is_active'
        ]
      )
        or not private.experience_key_is_valid(operation ->> 'key')
        or not private.experience_string_is_valid(
          operation ->> 'singular_label',
          120
        )
        or not private.experience_string_is_valid(
          operation ->> 'plural_label',
          120
        )
        or jsonb_typeof(operation -> 'description') <> 'string'
        or char_length(operation ->> 'description') > 5000
        or (
          operation -> 'icon' <> 'null'::jsonb
          and (
            jsonb_typeof(operation -> 'icon') <> 'string'
            or not private.experience_string_is_valid(
              operation ->> 'icon',
              120
            )
          )
        )
        or jsonb_typeof(operation -> 'is_active') <> 'boolean'
      then
        raise exception 'configuration_set_object_invalid'
          using errcode = '22023';
      end if;
    elsif operation_type = 'set_field' then
      if not private.configuration_json_has_exact_keys(
        operation,
        array[
          'op',
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
        or not private.experience_key_is_valid(operation ->> 'object_key')
        or not private.experience_key_is_valid(operation ->> 'key')
        or not private.experience_string_is_valid(operation ->> 'label', 120)
        or operation ->> 'field_type' not in (
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
        or jsonb_typeof(operation -> 'required') <> 'boolean'
        or jsonb_typeof(operation -> 'settings_json') <> 'object'
        or jsonb_typeof(operation -> 'position') <> 'number'
        or (operation ->> 'position') !~ '^[0-9]+$'
        or jsonb_typeof(operation -> 'is_active') <> 'boolean'
      then
        raise exception 'configuration_set_field_invalid'
          using errcode = '22023';
      end if;

      if operation ->> 'field_type' in ('select', 'multi_select', 'status')
        and not private.graph_options_are_valid(
          operation -> 'settings_json'
        )
      then
        raise exception 'configuration_field_options_invalid'
          using errcode = '22023';
      end if;

      if operation -> 'default_value' <> 'null'::jsonb
        and not private.graph_field_value_is_valid(
          operation -> 'default_value',
          (operation ->> 'field_type')::public.graph_field_type,
          operation -> 'settings_json'
        )
      then
        raise exception 'configuration_field_default_invalid'
          using errcode = '22023';
      end if;

      if (operation ->> 'required')::boolean
        and operation -> 'default_value' <> 'null'::jsonb
        and not private.graph_value_is_present(
          operation -> 'default_value'
        )
      then
        raise exception 'configuration_required_field_default_invalid'
          using errcode = '23514';
      end if;
    elsif operation_type = 'set_relationship' then
      if not private.configuration_json_has_exact_keys(
        operation,
        array[
          'op',
          'key',
          'source_object_key',
          'target_object_key',
          'source_label',
          'target_label',
          'cardinality',
          'is_required',
          'is_active'
        ]
      )
        or not private.experience_key_is_valid(operation ->> 'key')
        or not private.experience_key_is_valid(
          operation ->> 'source_object_key'
        )
        or not private.experience_key_is_valid(
          operation ->> 'target_object_key'
        )
        or not private.experience_string_is_valid(
          operation ->> 'source_label',
          120
        )
        or not private.experience_string_is_valid(
          operation ->> 'target_label',
          120
        )
        or operation ->> 'cardinality' not in (
          'one_to_one',
          'one_to_many',
          'many_to_many'
        )
        or jsonb_typeof(operation -> 'is_required') <> 'boolean'
        or jsonb_typeof(operation -> 'is_active') <> 'boolean'
      then
        raise exception 'configuration_set_relationship_invalid'
          using errcode = '22023';
      end if;
    elsif operation_type = 'set_view' then
      if not private.configuration_json_has_exact_keys(
        operation,
        array[
          'op',
          'key',
          'name',
          'view_type',
          'object_key',
          'config_json',
          'audience',
          'is_active'
        ]
      )
        or not private.experience_key_is_valid(operation ->> 'key')
        or not private.experience_string_is_valid(operation ->> 'name', 120)
        or operation ->> 'view_type' not in (
          'table',
          'list',
          'cards',
          'detail'
        )
        or not private.experience_key_is_valid(operation ->> 'object_key')
        or jsonb_typeof(operation -> 'config_json') <> 'object'
        or operation ->> 'audience' not in ('internal', 'public')
        or jsonb_typeof(operation -> 'is_active') <> 'boolean'
      then
        raise exception 'configuration_set_view_invalid'
          using errcode = '22023';
      end if;

      perform private.assert_valid_view_config_shape(
        (operation ->> 'view_type')::public.experience_view_type,
        operation -> 'config_json'
      );
    elsif operation_type = 'set_form' then
      if not private.configuration_json_has_exact_keys(
        operation,
        array[
          'op',
          'key',
          'name',
          'object_key',
          'mode',
          'config_json',
          'audience',
          'is_active'
        ]
      )
        or not private.experience_key_is_valid(operation ->> 'key')
        or not private.experience_string_is_valid(operation ->> 'name', 120)
        or not private.experience_key_is_valid(operation ->> 'object_key')
        or operation ->> 'mode' not in ('create', 'edit')
        or jsonb_typeof(operation -> 'config_json') <> 'object'
        or operation ->> 'audience' not in ('internal', 'public')
        or jsonb_typeof(operation -> 'is_active') <> 'boolean'
      then
        raise exception 'configuration_set_form_invalid'
          using errcode = '22023';
      end if;

      perform private.assert_valid_form_config_shape(
        operation -> 'config_json'
      );
    elsif operation_type = 'set_page' then
      if not private.configuration_json_has_exact_keys(
        operation,
        array[
          'op',
          'key',
          'title',
          'slug',
          'audience',
          'layout_json',
          'status',
          'is_active'
        ]
      )
        or not private.experience_key_is_valid(operation ->> 'key')
        or not private.experience_string_is_valid(operation ->> 'title', 120)
        or (operation ->> 'slug') !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
        or char_length(operation ->> 'slug') not between 1 and 80
        or operation ->> 'audience' not in ('internal', 'public')
        or jsonb_typeof(operation -> 'layout_json') <> 'object'
        or operation ->> 'status' not in ('draft', 'published')
        or jsonb_typeof(operation -> 'is_active') <> 'boolean'
      then
        raise exception 'configuration_set_page_invalid'
          using errcode = '22023';
      end if;

      perform private.assert_valid_page_config_shape(
        operation -> 'layout_json'
      );
    elsif operation_type = 'set_preorder_experience' then
      if not private.configuration_json_has_exact_keys(
        operation,
        array[
          'op',
          'key',
          'product_object_key',
          'customer_object_key',
          'order_object_key',
          'order_item_object_key',
          'customer_places_order_relationship_key',
          'order_contains_item_relationship_key',
          'product_appears_in_item_relationship_key',
          'config_json',
          'allowed_location_ids',
          'is_active'
        ]
      )
        or not private.experience_key_is_valid(operation ->> 'key')
        or not private.experience_key_is_valid(
          operation ->> 'product_object_key'
        )
        or not private.experience_key_is_valid(
          operation ->> 'customer_object_key'
        )
        or not private.experience_key_is_valid(
          operation ->> 'order_object_key'
        )
        or not private.experience_key_is_valid(
          operation ->> 'order_item_object_key'
        )
        or not private.experience_key_is_valid(
          operation ->> 'customer_places_order_relationship_key'
        )
        or not private.experience_key_is_valid(
          operation ->> 'order_contains_item_relationship_key'
        )
        or not private.experience_key_is_valid(
          operation ->> 'product_appears_in_item_relationship_key'
        )
        or jsonb_typeof(operation -> 'config_json') <> 'object'
        or jsonb_typeof(operation -> 'allowed_location_ids') <> 'array'
        or jsonb_array_length(operation -> 'allowed_location_ids') > 50
        or (
          (operation ->> 'is_active')::boolean
          and jsonb_array_length(
            operation -> 'allowed_location_ids'
          ) = 0
        )
        or exists (
          select 1
          from jsonb_array_elements(
            operation -> 'allowed_location_ids'
          ) as configured_location
          where jsonb_typeof(configured_location) <> 'string'
            or not private.configuration_uuid_is_valid(
              configured_location #>> '{}'
            )
        )
        or (
          select count(*)
          from jsonb_array_elements(
            operation -> 'allowed_location_ids'
          )
        ) <> (
          select count(distinct configured_location)
          from jsonb_array_elements(
            operation -> 'allowed_location_ids'
          ) as configured_location
        )
        or jsonb_typeof(operation -> 'is_active') <> 'boolean'
      then
        raise exception 'configuration_set_preorder_invalid'
          using errcode = '22023';
      end if;

      perform private.assert_valid_preorder_config_shape(
        operation -> 'config_json'
      );
    else
      raise exception 'configuration_operation_unknown'
        using errcode = '22023';
    end if;
  end loop;

  if exists (
    select private.configuration_operation_target_v1(
      configured_operation
    ) as target
    from jsonb_array_elements(operations) as configured_operation
    group by target
    having count(*) > 1
  ) then
    raise exception 'configuration_operation_duplicate_target'
      using errcode = '22023';
  end if;
end;
$$;

create function private.configuration_candidate_field_v1(
  candidate jsonb,
  object_key_value text,
  field_key_value text
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select field_definition
  from jsonb_array_elements(
    candidate -> 'field_definitions'
  ) as field_definition
  where field_definition ->> 'object_key' = object_key_value
    and field_definition ->> 'key' = field_key_value
  limit 1;
$$;

create function private.assert_configuration_candidate_field_v1(
  candidate jsonb,
  object_key_value text,
  field_key_value text,
  allowed_types text[]
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  field_definition jsonb;
begin
  field_definition := private.configuration_candidate_field_v1(
    candidate,
    object_key_value,
    field_key_value
  );

  if field_definition is null
    or not (field_definition ->> 'is_active')::boolean
    or not (field_definition ->> 'field_type' = any(allowed_types))
  then
    raise exception 'configuration_preorder_field_invalid:%', field_key_value
      using errcode = '23514';
  end if;

  return field_definition;
end;
$$;

create function private.assert_configuration_candidate_preorder_v1(
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

  if exists (
    select 1
    from jsonb_array_elements(
      candidate -> 'preorder_experience_locations'
    ) as allowed
    where allowed ->> 'preorder_key' = experience ->> 'key'
      and (allowed ->> 'is_active')::boolean
      and not exists (
        select 1
        from public.locations as location
        where location.business_id = target_business_id
          and location.id = (allowed ->> 'location_id')::uuid
          and location.is_active
      )
  ) then
    raise exception 'configuration_preorder_location_invalid'
      using errcode = '23514';
  end if;
end;
$$;

create function private.assert_configuration_candidate_v1(
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
      or (
        (allowed_location ->> 'is_active')::boolean
        and not exists (
          select 1
          from public.locations as location
          where location.business_id = target_business_id
            and location.id =
              (allowed_location ->> 'location_id')::uuid
            and location.is_active
        )
      )
    then
      raise exception 'configuration_preorder_location_reference_invalid'
        using errcode = '23514';
    end if;
  end loop;
end;
$$;

create function private.configuration_diff_properties_v1(
  before_value jsonb,
  after_value jsonb,
  excluded_keys text[]
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'property',
        coalesce(before_entry.key, after_entry.key),
        'before',
        before_entry.value,
        'after',
        after_entry.value
      )
      order by coalesce(before_entry.key, after_entry.key) collate "C"
    ) filter (
      where coalesce(before_entry.key, after_entry.key) <>
        all(excluded_keys)
        and before_entry.value is distinct from after_entry.value
    ),
    '[]'::jsonb
  )
  from jsonb_each(coalesce(before_value, '{}'::jsonb)) as before_entry
  full join jsonb_each(coalesce(after_value, '{}'::jsonb)) as after_entry
    on after_entry.key = before_entry.key;
$$;

create function private.configuration_preorder_diff_properties_v1(
  before_value jsonb,
  after_value jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  properties jsonb;
  schedule_property text;
  before_property jsonb;
  after_property jsonb;
begin
  properties := private.configuration_diff_properties_v1(
    before_value - 'config_json',
    after_value - 'config_json',
    array[
      'id',
      'key',
      'product_object_definition_id',
      'customer_object_definition_id',
      'order_object_definition_id',
      'order_item_object_definition_id',
      'customer_places_order_relationship_definition_id',
      'order_contains_item_relationship_definition_id',
      'product_appears_in_item_relationship_definition_id'
    ]
  );

  for schedule_property in
    select value
    from unnest(array[
      'days_of_week',
      'start_time',
      'end_time',
      'slot_interval_minutes',
      'slot_capacity',
      'cutoff_hours',
      'booking_horizon_days'
    ]) as value
  loop
    before_property :=
      before_value -> 'config_json' -> 'schedule' -> schedule_property;
    after_property :=
      after_value -> 'config_json' -> 'schedule' -> schedule_property;
    if before_property is distinct from after_property then
      properties := properties || jsonb_build_array(
        jsonb_build_object(
          'property',
          'schedule.' || schedule_property,
          'before',
          before_property,
          'after',
          after_property
        )
      );
    end if;
  end loop;

  before_property :=
    before_value -> 'config_json' -> 'field_mappings';
  after_property :=
    after_value -> 'config_json' -> 'field_mappings';
  if before_property is distinct from after_property then
    properties := properties || jsonb_build_array(
      jsonb_build_object(
        'property',
        'field_mappings',
        'before',
        before_property,
        'after',
        after_property
      )
    );
  end if;

  before_property :=
    before_value -> 'config_json' -> 'public_fields';
  after_property :=
    after_value -> 'config_json' -> 'public_fields';
  if before_property is distinct from after_property then
    properties := properties || jsonb_build_array(
      jsonb_build_object(
        'property',
        'public_fields',
        'before',
        before_property,
        'after',
        after_property
      )
    );
  end if;

  select coalesce(
    jsonb_agg(property order by property ->> 'property' collate "C"),
    '[]'::jsonb
  )
  into properties
  from jsonb_array_elements(properties) as property;

  return properties;
end;
$$;

create function private.configuration_semantic_diff_v1(
  target_business_id uuid,
  base_snapshot jsonb,
  candidate_snapshot jsonb
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with paired as (
    select
      1 as entity_rank,
      'object'::text as entity_type,
      coalesce(before_entity ->> 'key', after_entity ->> 'key') as entity_key,
      coalesce(
        after_entity ->> 'singular_label',
        before_entity ->> 'singular_label'
      ) as label,
      before_entity,
      after_entity,
      private.configuration_diff_properties_v1(
        before_entity,
        after_entity,
        array['id', 'key']
      ) as properties
    from jsonb_array_elements(
      base_snapshot -> 'object_definitions'
    ) as before_entity
    full join jsonb_array_elements(
      candidate_snapshot -> 'object_definitions'
    ) as after_entity
      on after_entity ->> 'key' = before_entity ->> 'key'

    union all

    select
      2,
      'field',
      coalesce(
        before_entity ->> 'object_key',
        after_entity ->> 'object_key'
      ) || '.' || coalesce(
        before_entity ->> 'key',
        after_entity ->> 'key'
      ),
      coalesce(after_entity ->> 'label', before_entity ->> 'label'),
      before_entity,
      after_entity,
      private.configuration_diff_properties_v1(
        before_entity,
        after_entity,
        array['id', 'key', 'object_definition_id', 'object_key']
      )
    from jsonb_array_elements(
      base_snapshot -> 'field_definitions'
    ) as before_entity
    full join jsonb_array_elements(
      candidate_snapshot -> 'field_definitions'
    ) as after_entity
      on after_entity ->> 'object_key' =
        before_entity ->> 'object_key'
      and after_entity ->> 'key' = before_entity ->> 'key'

    union all

    select
      3,
      'relationship',
      coalesce(before_entity ->> 'key', after_entity ->> 'key'),
      coalesce(
        after_entity ->> 'source_label',
        before_entity ->> 'source_label'
      ) || ' / ' || coalesce(
        after_entity ->> 'target_label',
        before_entity ->> 'target_label'
      ),
      before_entity,
      after_entity,
      private.configuration_diff_properties_v1(
        before_entity,
        after_entity,
        array[
          'id',
          'key',
          'source_object_definition_id',
          'target_object_definition_id'
        ]
      )
    from jsonb_array_elements(
      base_snapshot -> 'relationship_definitions'
    ) as before_entity
    full join jsonb_array_elements(
      candidate_snapshot -> 'relationship_definitions'
    ) as after_entity
      on after_entity ->> 'key' = before_entity ->> 'key'

    union all

    select
      4,
      'view',
      coalesce(before_entity ->> 'key', after_entity ->> 'key'),
      coalesce(after_entity ->> 'name', before_entity ->> 'name'),
      before_entity,
      after_entity,
      private.configuration_diff_properties_v1(
        before_entity,
        after_entity,
        array['id', 'key', 'object_definition_id']
      )
    from jsonb_array_elements(base_snapshot -> 'views') as before_entity
    full join jsonb_array_elements(
      candidate_snapshot -> 'views'
    ) as after_entity
      on after_entity ->> 'key' = before_entity ->> 'key'

    union all

    select
      5,
      'form',
      coalesce(before_entity ->> 'key', after_entity ->> 'key'),
      coalesce(after_entity ->> 'name', before_entity ->> 'name'),
      before_entity,
      after_entity,
      private.configuration_diff_properties_v1(
        before_entity,
        after_entity,
        array['id', 'key', 'object_definition_id']
      )
    from jsonb_array_elements(base_snapshot -> 'forms') as before_entity
    full join jsonb_array_elements(
      candidate_snapshot -> 'forms'
    ) as after_entity
      on after_entity ->> 'key' = before_entity ->> 'key'

    union all

    select
      6,
      'page',
      coalesce(before_entity ->> 'key', after_entity ->> 'key'),
      coalesce(after_entity ->> 'title', before_entity ->> 'title'),
      before_entity,
      after_entity,
      private.configuration_diff_properties_v1(
        before_entity,
        after_entity,
        array['id', 'key']
      )
    from jsonb_array_elements(base_snapshot -> 'pages') as before_entity
    full join jsonb_array_elements(
      candidate_snapshot -> 'pages'
    ) as after_entity
      on after_entity ->> 'key' = before_entity ->> 'key'

    union all

    select
      7,
      'preorder_experience',
      coalesce(before_entity ->> 'key', after_entity ->> 'key'),
      'Preorder ' || coalesce(
        after_entity ->> 'key',
        before_entity ->> 'key'
      ),
      before_entity,
      after_entity,
      private.configuration_preorder_diff_properties_v1(
        before_entity,
        after_entity
      )
    from jsonb_array_elements(
      base_snapshot -> 'preorder_experiences'
    ) as before_entity
    full join jsonb_array_elements(
      candidate_snapshot -> 'preorder_experiences'
    ) as after_entity
      on after_entity ->> 'key' = before_entity ->> 'key'

    union all

    select
      8,
      'preorder_location',
      coalesce(
        before_entity ->> 'preorder_key',
        after_entity ->> 'preorder_key'
      ) || ':' || coalesce(
        before_entity ->> 'location_id',
        after_entity ->> 'location_id'
      ),
      coalesce(location.name, 'Location'),
      before_entity,
      after_entity,
      private.configuration_diff_properties_v1(
        before_entity,
        after_entity,
        array[
          'id',
          'preorder_experience_id',
          'preorder_key',
          'location_id'
        ]
      )
    from jsonb_array_elements(
      base_snapshot -> 'preorder_experience_locations'
    ) as before_entity
    full join jsonb_array_elements(
      candidate_snapshot -> 'preorder_experience_locations'
    ) as after_entity
      on after_entity ->> 'preorder_key' =
        before_entity ->> 'preorder_key'
      and after_entity ->> 'location_id' =
        before_entity ->> 'location_id'
    left join public.locations as location
      on location.business_id = target_business_id
      and location.id = coalesce(
        (after_entity ->> 'location_id')::uuid,
        (before_entity ->> 'location_id')::uuid
      )
  ),
  classified as (
    select
      entity_rank,
      entity_type,
      entity_key,
      label,
      case
        when before_entity is null then 'created'
        when (before_entity ->> 'is_active')::boolean
          and not (after_entity ->> 'is_active')::boolean
          then 'archived'
        when not (before_entity ->> 'is_active')::boolean
          and (after_entity ->> 'is_active')::boolean
          then 'restored'
        else 'updated'
      end as change_type,
      properties
    from paired
    where before_entity is distinct from after_entity
  )
  select jsonb_build_object(
    'schema_version',
    1,
    'counts',
    jsonb_build_object(
      'created',
      count(*) filter (where change_type = 'created'),
      'updated',
      count(*) filter (where change_type = 'updated'),
      'archived',
      count(*) filter (where change_type = 'archived'),
      'restored',
      count(*) filter (where change_type = 'restored')
    ),
    'changes',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'entity_type',
          entity_type,
          'entity_key',
          entity_key,
          'change_type',
          change_type,
          'label',
          label,
          'properties',
          properties
        )
        order by entity_rank, entity_key collate "C"
      ),
      '[]'::jsonb
    )
  )
  from classified;
$$;

create function private.configuration_materialize_candidate_v1(
  target_business_id uuid,
  base_snapshot jsonb,
  operations jsonb,
  trusted_allocations jsonb default null
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  object_map jsonb;
  field_map jsonb;
  relationship_map jsonb;
  view_map jsonb;
  form_map jsonb;
  page_map jsonb;
  preorder_map jsonb;
  association_map jsonb;
  allocations jsonb := coalesce(trusted_allocations, '{}'::jsonb);
  expected_allocation_keys jsonb := '{}'::jsonb;
  allocation_key text;
  operation jsonb;
  entity_key text;
  composite_key text;
  existing_entity jsonb;
  referenced_object jsonb;
  source_object jsonb;
  target_object jsonb;
  referenced_relationship jsonb;
  candidate jsonb;
  checksum text;
  semantic_diff jsonb;
  map_entry record;
  configured_location jsonb;
  desired_location_active boolean;
begin
  perform private.assert_configuration_candidate_v1(
    target_business_id,
    base_snapshot
  );
  perform private.assert_configuration_operations_v1(operations);

  if trusted_allocations is not null
    and (
      jsonb_typeof(trusted_allocations) <> 'object'
      or octet_length(trusted_allocations::text) > 131072
    )
  then
    raise exception 'configuration_id_allocations_invalid'
      using errcode = '22023';
  end if;

  select coalesce(
    jsonb_object_agg(value ->> 'key', value),
    '{}'::jsonb
  )
  into object_map
  from jsonb_array_elements(base_snapshot -> 'object_definitions');

  select coalesce(
    jsonb_object_agg(
      (value ->> 'object_key') || chr(31) || (value ->> 'key'),
      value
    ),
    '{}'::jsonb
  )
  into field_map
  from jsonb_array_elements(base_snapshot -> 'field_definitions');

  select coalesce(
    jsonb_object_agg(value ->> 'key', value),
    '{}'::jsonb
  )
  into relationship_map
  from jsonb_array_elements(base_snapshot -> 'relationship_definitions');

  select coalesce(
    jsonb_object_agg(value ->> 'key', value),
    '{}'::jsonb
  )
  into view_map
  from jsonb_array_elements(base_snapshot -> 'views');

  select coalesce(
    jsonb_object_agg(value ->> 'key', value),
    '{}'::jsonb
  )
  into form_map
  from jsonb_array_elements(base_snapshot -> 'forms');

  select coalesce(
    jsonb_object_agg(value ->> 'key', value),
    '{}'::jsonb
  )
  into page_map
  from jsonb_array_elements(base_snapshot -> 'pages');

  select coalesce(
    jsonb_object_agg(value ->> 'key', value),
    '{}'::jsonb
  )
  into preorder_map
  from jsonb_array_elements(base_snapshot -> 'preorder_experiences');

  select coalesce(
    jsonb_object_agg(
      (value ->> 'preorder_key') || chr(31) ||
        (value ->> 'location_id'),
      value
    ),
    '{}'::jsonb
  )
  into association_map
  from jsonb_array_elements(
    base_snapshot -> 'preorder_experience_locations'
  );

  for allocation_key in
    with requested_allocations as (
      select 'object:' || (configured_operation ->> 'key') as key
      from jsonb_array_elements(operations) as configured_operation
      where configured_operation ->> 'op' = 'set_object'
        and not object_map ? (configured_operation ->> 'key')

      union all

      select
        'field:' || (configured_operation ->> 'object_key') || '.' ||
          (configured_operation ->> 'key')
      from jsonb_array_elements(operations) as configured_operation
      where configured_operation ->> 'op' = 'set_field'
        and not field_map ? (
          (configured_operation ->> 'object_key') || chr(31) ||
            (configured_operation ->> 'key')
        )

      union all

      select 'relationship:' || (configured_operation ->> 'key')
      from jsonb_array_elements(operations) as configured_operation
      where configured_operation ->> 'op' = 'set_relationship'
        and not relationship_map ? (configured_operation ->> 'key')

      union all

      select 'view:' || (configured_operation ->> 'key')
      from jsonb_array_elements(operations) as configured_operation
      where configured_operation ->> 'op' = 'set_view'
        and not view_map ? (configured_operation ->> 'key')

      union all

      select 'form:' || (configured_operation ->> 'key')
      from jsonb_array_elements(operations) as configured_operation
      where configured_operation ->> 'op' = 'set_form'
        and not form_map ? (configured_operation ->> 'key')

      union all

      select 'page:' || (configured_operation ->> 'key')
      from jsonb_array_elements(operations) as configured_operation
      where configured_operation ->> 'op' = 'set_page'
        and not page_map ? (configured_operation ->> 'key')

      union all

      select 'preorder:' || (configured_operation ->> 'key')
      from jsonb_array_elements(operations) as configured_operation
      where configured_operation ->> 'op' = 'set_preorder_experience'
        and not preorder_map ? (configured_operation ->> 'key')

      union all

      select
        'preorder-location:' ||
          (configured_operation ->> 'key') || ':' ||
          (requested_location #>> '{}')
      from jsonb_array_elements(operations) as configured_operation
      cross join lateral jsonb_array_elements(
        configured_operation -> 'allowed_location_ids'
      ) as requested_location
      where configured_operation ->> 'op' = 'set_preorder_experience'
        and not association_map ? (
          (configured_operation ->> 'key') || chr(31) ||
            (requested_location #>> '{}')
        )
    )
    select key
    from requested_allocations
    order by key collate "C"
  loop
    expected_allocation_keys :=
      expected_allocation_keys || jsonb_build_object(allocation_key, true);

    if trusted_allocations is null then
      allocations := allocations || jsonb_build_object(
        allocation_key,
        gen_random_uuid()
      );
    elsif not allocations ? allocation_key
      or jsonb_typeof(allocations -> allocation_key) <> 'string'
      or not private.configuration_uuid_is_valid(
        allocations ->> allocation_key
      )
    then
      raise exception 'configuration_id_allocation_missing_or_invalid:%',
        allocation_key
        using errcode = '22023';
    end if;
  end loop;

  if allocations - coalesce(
    (
      select array_agg(key)
      from jsonb_object_keys(expected_allocation_keys) as key
    ),
    array[]::text[]
  ) <> '{}'::jsonb
    or (
      select count(*)
      from jsonb_each_text(allocations)
    ) <> (
      select count(distinct value)
      from jsonb_each_text(allocations)
    )
    or exists (
      select 1
      from jsonb_each_text(allocations) as allocation
      where not private.configuration_uuid_is_valid(allocation.value)
        or exists (
          select 1
          from (
            select value ->> 'id' as id
            from jsonb_array_elements(
              base_snapshot -> 'object_definitions'
            )
            union all
            select value ->> 'id'
            from jsonb_array_elements(
              base_snapshot -> 'field_definitions'
            )
            union all
            select value ->> 'id'
            from jsonb_array_elements(
              base_snapshot -> 'relationship_definitions'
            )
            union all
            select value ->> 'id'
            from jsonb_array_elements(base_snapshot -> 'views')
            union all
            select value ->> 'id'
            from jsonb_array_elements(base_snapshot -> 'forms')
            union all
            select value ->> 'id'
            from jsonb_array_elements(base_snapshot -> 'pages')
            union all
            select value ->> 'id'
            from jsonb_array_elements(
              base_snapshot -> 'preorder_experiences'
            )
            union all
            select value ->> 'id'
            from jsonb_array_elements(
              base_snapshot -> 'preorder_experience_locations'
            )
          ) as existing_identity
          where existing_identity.id = allocation.value
        )
    )
  then
    raise exception 'configuration_id_allocations_invalid'
      using errcode = '22023';
  end if;

  for operation in
    select value
    from jsonb_array_elements(operations)
    where value ->> 'op' = 'set_object'
    order by value ->> 'key' collate "C"
  loop
    entity_key := operation ->> 'key';
    existing_entity := object_map -> entity_key;
    object_map := object_map || jsonb_build_object(
      entity_key,
      jsonb_build_object(
        'id',
        coalesce(
          existing_entity ->> 'id',
          allocations ->> ('object:' || entity_key)
        )::uuid,
        'key',
        entity_key,
        'singular_label',
        operation -> 'singular_label',
        'plural_label',
        operation -> 'plural_label',
        'description',
        operation -> 'description',
        'kind',
        coalesce(existing_entity -> 'kind', '"custom"'::jsonb),
        'semantic_type',
        case
          when existing_entity is null then 'null'::jsonb
          else existing_entity -> 'semantic_type'
        end,
        'icon',
        operation -> 'icon',
        'is_active',
        operation -> 'is_active'
      )
    );
  end loop;

  for operation in
    select value
    from jsonb_array_elements(operations)
    where value ->> 'op' = 'set_field'
    order by
      value ->> 'object_key' collate "C",
      value ->> 'key' collate "C"
  loop
    entity_key := operation ->> 'key';
    composite_key :=
      (operation ->> 'object_key') || chr(31) || entity_key;
    existing_entity := field_map -> composite_key;
    referenced_object := object_map -> (operation ->> 'object_key');
    if referenced_object is null then
      raise exception 'configuration_field_object_missing:%',
        operation ->> 'object_key'
        using errcode = '23514';
    end if;

    field_map := field_map || jsonb_build_object(
      composite_key,
      jsonb_build_object(
        'id',
        coalesce(
          existing_entity ->> 'id',
          allocations ->> (
            'field:' || (operation ->> 'object_key') || '.' || entity_key
          )
        )::uuid,
        'object_definition_id',
        (referenced_object ->> 'id')::uuid,
        'object_key',
        operation -> 'object_key',
        'key',
        entity_key,
        'label',
        operation -> 'label',
        'field_type',
        operation -> 'field_type',
        'required',
        operation -> 'required',
        'default_value',
        operation -> 'default_value',
        'settings_json',
        operation -> 'settings_json',
        'position',
        operation -> 'position',
        'is_active',
        operation -> 'is_active'
      )
    );
  end loop;

  for operation in
    select value
    from jsonb_array_elements(operations)
    where value ->> 'op' = 'set_relationship'
    order by value ->> 'key' collate "C"
  loop
    entity_key := operation ->> 'key';
    existing_entity := relationship_map -> entity_key;
    source_object := object_map -> (operation ->> 'source_object_key');
    target_object := object_map -> (operation ->> 'target_object_key');
    if source_object is null or target_object is null then
      raise exception 'configuration_relationship_object_missing'
        using errcode = '23514';
    end if;
    if existing_entity is not null
      and (
        existing_entity ->> 'source_object_key' <>
          operation ->> 'source_object_key'
        or existing_entity ->> 'target_object_key' <>
          operation ->> 'target_object_key'
      )
    then
      raise exception 'configuration_relationship_endpoints_immutable'
        using errcode = '23514';
    end if;

    relationship_map := relationship_map || jsonb_build_object(
      entity_key,
      jsonb_build_object(
        'id',
        coalesce(
          existing_entity ->> 'id',
          allocations ->> ('relationship:' || entity_key)
        )::uuid,
        'key',
        entity_key,
        'source_object_definition_id',
        (source_object ->> 'id')::uuid,
        'source_object_key',
        operation -> 'source_object_key',
        'target_object_definition_id',
        (target_object ->> 'id')::uuid,
        'target_object_key',
        operation -> 'target_object_key',
        'source_label',
        operation -> 'source_label',
        'target_label',
        operation -> 'target_label',
        'cardinality',
        operation -> 'cardinality',
        'is_required',
        operation -> 'is_required',
        'is_active',
        operation -> 'is_active'
      )
    );
  end loop;

  for operation in
    select value
    from jsonb_array_elements(operations)
    where value ->> 'op' = 'set_view'
    order by value ->> 'key' collate "C"
  loop
    entity_key := operation ->> 'key';
    existing_entity := view_map -> entity_key;
    referenced_object := object_map -> (operation ->> 'object_key');
    if referenced_object is null then
      raise exception 'configuration_view_object_missing'
        using errcode = '23514';
    end if;
    if existing_entity is not null
      and existing_entity ->> 'object_key' <>
        operation ->> 'object_key'
    then
      raise exception 'configuration_view_object_immutable'
        using errcode = '23514';
    end if;

    view_map := view_map || jsonb_build_object(
      entity_key,
      jsonb_build_object(
        'id',
        coalesce(
          existing_entity ->> 'id',
          allocations ->> ('view:' || entity_key)
        )::uuid,
        'key',
        entity_key,
        'name',
        operation -> 'name',
        'view_type',
        operation -> 'view_type',
        'object_definition_id',
        (referenced_object ->> 'id')::uuid,
        'object_key',
        operation -> 'object_key',
        'config_json',
        operation -> 'config_json',
        'audience',
        operation -> 'audience',
        'is_active',
        operation -> 'is_active'
      )
    );
  end loop;

  for operation in
    select value
    from jsonb_array_elements(operations)
    where value ->> 'op' = 'set_form'
    order by value ->> 'key' collate "C"
  loop
    entity_key := operation ->> 'key';
    existing_entity := form_map -> entity_key;
    referenced_object := object_map -> (operation ->> 'object_key');
    if referenced_object is null then
      raise exception 'configuration_form_object_missing'
        using errcode = '23514';
    end if;
    if existing_entity is not null
      and (
        existing_entity ->> 'object_key' <>
          operation ->> 'object_key'
        or existing_entity ->> 'mode' <> operation ->> 'mode'
      )
    then
      raise exception 'configuration_form_identity_immutable'
        using errcode = '23514';
    end if;

    form_map := form_map || jsonb_build_object(
      entity_key,
      jsonb_build_object(
        'id',
        coalesce(
          existing_entity ->> 'id',
          allocations ->> ('form:' || entity_key)
        )::uuid,
        'key',
        entity_key,
        'name',
        operation -> 'name',
        'object_definition_id',
        (referenced_object ->> 'id')::uuid,
        'object_key',
        operation -> 'object_key',
        'mode',
        operation -> 'mode',
        'config_json',
        operation -> 'config_json',
        'audience',
        operation -> 'audience',
        'is_active',
        operation -> 'is_active'
      )
    );
  end loop;

  for operation in
    select value
    from jsonb_array_elements(operations)
    where value ->> 'op' = 'set_page'
    order by value ->> 'key' collate "C"
  loop
    entity_key := operation ->> 'key';
    existing_entity := page_map -> entity_key;
    page_map := page_map || jsonb_build_object(
      entity_key,
      jsonb_build_object(
        'id',
        coalesce(
          existing_entity ->> 'id',
          allocations ->> ('page:' || entity_key)
        )::uuid,
        'key',
        entity_key,
        'title',
        operation -> 'title',
        'slug',
        operation -> 'slug',
        'audience',
        operation -> 'audience',
        'layout_json',
        operation -> 'layout_json',
        'status',
        operation -> 'status',
        'is_active',
        operation -> 'is_active'
      )
    );
  end loop;

  for operation in
    select value
    from jsonb_array_elements(operations)
    where value ->> 'op' = 'set_preorder_experience'
    order by value ->> 'key' collate "C"
  loop
    entity_key := operation ->> 'key';
    existing_entity := preorder_map -> entity_key;
    source_object := object_map -> (operation ->> 'product_object_key');
    referenced_object := object_map -> (operation ->> 'customer_object_key');
    target_object := object_map -> (operation ->> 'order_object_key');
    if source_object is null
      or referenced_object is null
      or target_object is null
      or not object_map ? (operation ->> 'order_item_object_key')
    then
      raise exception 'configuration_preorder_object_missing'
        using errcode = '23514';
    end if;

    if existing_entity is not null
      and (
        existing_entity ->> 'product_object_key' <>
          operation ->> 'product_object_key'
        or existing_entity ->> 'customer_object_key' <>
          operation ->> 'customer_object_key'
        or existing_entity ->> 'order_object_key' <>
          operation ->> 'order_object_key'
        or existing_entity ->> 'order_item_object_key' <>
          operation ->> 'order_item_object_key'
        or existing_entity ->>
          'customer_places_order_relationship_key' <>
          operation ->> 'customer_places_order_relationship_key'
        or existing_entity ->>
          'order_contains_item_relationship_key' <>
          operation ->> 'order_contains_item_relationship_key'
        or existing_entity ->>
          'product_appears_in_item_relationship_key' <>
          operation ->> 'product_appears_in_item_relationship_key'
      )
    then
      raise exception 'configuration_preorder_graph_references_immutable'
        using errcode = '23514';
    end if;

    referenced_relationship := relationship_map -> (
      operation ->> 'customer_places_order_relationship_key'
    );
    if referenced_relationship is null
      or not relationship_map ? (
        operation ->> 'order_contains_item_relationship_key'
      )
      or not relationship_map ? (
        operation ->> 'product_appears_in_item_relationship_key'
      )
    then
      raise exception 'configuration_preorder_relationship_missing'
        using errcode = '23514';
    end if;

    preorder_map := preorder_map || jsonb_build_object(
      entity_key,
      jsonb_build_object(
        'id',
        coalesce(
          existing_entity ->> 'id',
          allocations ->> ('preorder:' || entity_key)
        )::uuid,
        'key',
        entity_key,
        'product_object_definition_id',
        (source_object ->> 'id')::uuid,
        'product_object_key',
        operation -> 'product_object_key',
        'customer_object_definition_id',
        (referenced_object ->> 'id')::uuid,
        'customer_object_key',
        operation -> 'customer_object_key',
        'order_object_definition_id',
        (target_object ->> 'id')::uuid,
        'order_object_key',
        operation -> 'order_object_key',
        'order_item_object_definition_id',
        (
          object_map -> (operation ->> 'order_item_object_key') ->> 'id'
        )::uuid,
        'order_item_object_key',
        operation -> 'order_item_object_key',
        'customer_places_order_relationship_definition_id',
        (referenced_relationship ->> 'id')::uuid,
        'customer_places_order_relationship_key',
        operation -> 'customer_places_order_relationship_key',
        'order_contains_item_relationship_definition_id',
        (
          relationship_map -> (
            operation ->> 'order_contains_item_relationship_key'
          ) ->> 'id'
        )::uuid,
        'order_contains_item_relationship_key',
        operation -> 'order_contains_item_relationship_key',
        'product_appears_in_item_relationship_definition_id',
        (
          relationship_map -> (
            operation ->> 'product_appears_in_item_relationship_key'
          ) ->> 'id'
        )::uuid,
        'product_appears_in_item_relationship_key',
        operation -> 'product_appears_in_item_relationship_key',
        'config_json',
        operation -> 'config_json',
        'is_active',
        operation -> 'is_active'
      )
    );

    for map_entry in
      select key, value
      from jsonb_each(association_map)
      where value ->> 'preorder_key' = entity_key
      order by key collate "C"
    loop
      desired_location_active := exists (
        select 1
        from jsonb_array_elements(
          operation -> 'allowed_location_ids'
        ) as desired_location
        where desired_location #>> '{}' =
          map_entry.value ->> 'location_id'
      );
      association_map := jsonb_set(
        association_map,
        array[map_entry.key, 'is_active'],
        to_jsonb(desired_location_active),
        false
      );
    end loop;

    for configured_location in
      select value
      from jsonb_array_elements(
        operation -> 'allowed_location_ids'
      )
      order by value #>> '{}'
    loop
      composite_key :=
        entity_key || chr(31) || (configured_location #>> '{}');
      existing_entity := association_map -> composite_key;
      if existing_entity is null then
        association_map := association_map || jsonb_build_object(
          composite_key,
          jsonb_build_object(
            'id',
            (
              allocations ->> (
                'preorder-location:' || entity_key || ':' ||
                  (configured_location #>> '{}')
              )
            )::uuid,
            'preorder_experience_id',
            (preorder_map -> entity_key ->> 'id')::uuid,
            'preorder_key',
            entity_key,
            'location_id',
            (configured_location #>> '{}')::uuid,
            'is_active',
            true
          )
        );
      end if;
    end loop;
  end loop;

  select jsonb_build_object(
    'schema_version',
    1,
    'object_definitions',
    (
      select coalesce(
        jsonb_agg(value order by value ->> 'key' collate "C"),
        '[]'::jsonb
      )
      from jsonb_each(object_map)
    ),
    'field_definitions',
    (
      select coalesce(
        jsonb_agg(
          value
          order by
            value ->> 'object_key' collate "C",
            (value ->> 'position')::integer,
            value ->> 'key' collate "C"
        ),
        '[]'::jsonb
      )
      from jsonb_each(field_map)
    ),
    'relationship_definitions',
    (
      select coalesce(
        jsonb_agg(value order by value ->> 'key' collate "C"),
        '[]'::jsonb
      )
      from jsonb_each(relationship_map)
    ),
    'views',
    (
      select coalesce(
        jsonb_agg(value order by value ->> 'key' collate "C"),
        '[]'::jsonb
      )
      from jsonb_each(view_map)
    ),
    'forms',
    (
      select coalesce(
        jsonb_agg(value order by value ->> 'key' collate "C"),
        '[]'::jsonb
      )
      from jsonb_each(form_map)
    ),
    'pages',
    (
      select coalesce(
        jsonb_agg(value order by value ->> 'key' collate "C"),
        '[]'::jsonb
      )
      from jsonb_each(page_map)
    ),
    'preorder_experiences',
    (
      select coalesce(
        jsonb_agg(value order by value ->> 'key' collate "C"),
        '[]'::jsonb
      )
      from jsonb_each(preorder_map)
    ),
    'preorder_experience_locations',
    (
      select coalesce(
        jsonb_agg(
          value
          order by
            value ->> 'preorder_key' collate "C",
            (value ->> 'location_id')::uuid
        ),
        '[]'::jsonb
      )
      from jsonb_each(association_map)
    )
  )
  into candidate;

  perform private.assert_configuration_candidate_v1(
    target_business_id,
    candidate
  );
  checksum := private.configuration_snapshot_checksum_v1(candidate);
  semantic_diff := private.configuration_semantic_diff_v1(
    target_business_id,
    base_snapshot,
    candidate
  );

  if octet_length(allocations::text) > 131072
    or octet_length(semantic_diff::text) > 524288
  then
    raise exception 'configuration_proposal_output_too_large'
      using errcode = '22023';
  end if;

  return jsonb_build_object(
    'candidate_snapshot',
    candidate,
    'candidate_checksum',
    checksum,
    'id_allocations',
    allocations,
    'semantic_diff',
    semantic_diff
  );
end;
$$;

create function public.propose_configuration_change(
  expected_business_id uuid,
  requested_title text,
  requested_description text,
  requested_operations jsonb
)
returns public.configuration_change_sets
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  current_head public.business_configuration_heads;
  base_version public.configuration_versions;
  live_snapshot jsonb;
  materialized jsonb;
  created_change_set public.configuration_change_sets;
begin
  if current_actor_id is null then
    raise exception 'configuration_authentication_required'
      using errcode = '42501';
  end if;
  if not private.can_manage_tenant(expected_business_id) then
    raise exception 'configuration_owner_or_admin_required'
      using errcode = '42501';
  end if;
  if char_length(trim(coalesce(requested_title, ''))) not between 1 and 120
    or (
      requested_description is not null
      and char_length(requested_description) > 5000
    )
  then
    raise exception 'configuration_proposal_metadata_invalid'
      using errcode = '22023';
  end if;

  select head.*
  into current_head
  from public.business_configuration_heads as head
  where head.business_id = expected_business_id
  for share;
  if not found then
    raise exception 'configuration_head_not_found'
      using errcode = 'P0002';
  end if;

  select version.*
  into base_version
  from public.configuration_versions as version
  where version.business_id = expected_business_id
    and version.id = current_head.active_version_id;
  if not found then
    raise exception 'configuration_active_version_not_found'
      using errcode = 'P0002';
  end if;

  live_snapshot := private.configuration_snapshot_v1(expected_business_id);
  if live_snapshot <> base_version.snapshot_json
    or private.configuration_snapshot_checksum_v1(live_snapshot) <>
      base_version.snapshot_checksum
  then
    raise exception 'configuration_projection_out_of_sync'
      using errcode = 'P0001';
  end if;

  materialized := private.configuration_materialize_candidate_v1(
    expected_business_id,
    base_version.snapshot_json,
    requested_operations,
    null
  );

  insert into public.configuration_change_sets (
    business_id,
    kind,
    status,
    title,
    description,
    base_version_id,
    base_head_revision,
    requested_by,
    operations_schema_version,
    operations_json,
    id_allocations_json,
    candidate_snapshot_json,
    candidate_checksum,
    semantic_diff_json
  )
  values (
    expected_business_id,
    'change',
    'proposed',
    trim(requested_title),
    requested_description,
    base_version.id,
    current_head.head_revision,
    current_actor_id,
    1,
    requested_operations,
    materialized -> 'id_allocations',
    materialized -> 'candidate_snapshot',
    materialized ->> 'candidate_checksum',
    materialized -> 'semantic_diff'
  )
  returning * into created_change_set;

  return created_change_set;
end;
$$;

create function public.list_configuration_change_sets(
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
  order by change_set.created_at desc, change_set.id;
end;
$$;

create function public.get_configuration_change_set(
  expected_business_id uuid,
  requested_change_set_id uuid
)
returns public.configuration_change_sets
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_change_set public.configuration_change_sets;
begin
  if auth.uid() is null then
    raise exception 'configuration_authentication_required'
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
    raise exception 'configuration_change_set_not_found'
      using errcode = 'P0002';
  end if;

  return selected_change_set;
end;
$$;

create function public.abandon_configuration_change_set(
  expected_business_id uuid,
  requested_change_set_id uuid
)
returns public.configuration_change_sets
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  abandoned_change_set public.configuration_change_sets;
begin
  if current_actor_id is null then
    raise exception 'configuration_authentication_required'
      using errcode = '42501';
  end if;
  if not private.can_manage_tenant(expected_business_id) then
    raise exception 'configuration_owner_or_admin_required'
      using errcode = '42501';
  end if;

  update public.configuration_change_sets as change_set
  set
    status = 'abandoned',
    closed_by = current_actor_id,
    closed_at = now(),
    updated_at = now()
  where change_set.business_id = expected_business_id
    and change_set.id = requested_change_set_id
    and change_set.status = 'proposed'
  returning change_set.* into abandoned_change_set;
  if not found then
    if exists (
      select 1
      from public.configuration_change_sets as change_set
      where change_set.business_id = expected_business_id
        and change_set.id = requested_change_set_id
    ) then
      raise exception 'configuration_change_set_not_abandonable'
        using errcode = '55000';
    end if;

    raise exception 'configuration_change_set_not_found'
      using errcode = 'P0002';
  end if;

  return abandoned_change_set;
end;
$$;

alter table public.configuration_change_sets enable row level security;

create policy "Owners and admins can read configuration change sets"
on public.configuration_change_sets
for select
to authenticated
using (private.can_manage_tenant(business_id));

revoke all on table public.configuration_change_sets
  from anon, authenticated, service_role;
grant select on table public.configuration_change_sets
  to authenticated, service_role;

grant usage on type public.configuration_change_kind
  to authenticated, service_role;
grant usage on type public.configuration_change_status
  to authenticated, service_role;

revoke all on function private.protect_configuration_change_set()
  from public, anon, authenticated, service_role;
revoke all on function private.reject_configuration_change_set_delete()
  from public, anon, authenticated, service_role;
revoke all on function private.configuration_json_has_exact_keys(
  jsonb,
  text[]
) from public, anon, authenticated, service_role;
revoke all on function private.configuration_json_has_only_keys(
  jsonb,
  text[]
) from public, anon, authenticated, service_role;
revoke all on function private.configuration_uuid_is_valid(text)
  from public, anon, authenticated, service_role;
revoke all on function private.assert_configuration_operations_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.configuration_candidate_field_v1(
  jsonb,
  text,
  text
) from public, anon, authenticated, service_role;
revoke all on function private.assert_configuration_candidate_field_v1(
  jsonb,
  text,
  text,
  text[]
) from public, anon, authenticated, service_role;
revoke all on function private.assert_configuration_candidate_preorder_v1(
  uuid,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.assert_configuration_candidate_v1(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.configuration_diff_properties_v1(
  jsonb,
  jsonb,
  text[]
) from public, anon, authenticated, service_role;
revoke all on function private.configuration_preorder_diff_properties_v1(
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.configuration_semantic_diff_v1(
  uuid,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.configuration_materialize_candidate_v1(
  uuid,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;

revoke all on function public.propose_configuration_change(
  uuid,
  text,
  text,
  jsonb
) from public, anon;
revoke all on function public.list_configuration_change_sets(uuid)
  from public, anon;
revoke all on function public.get_configuration_change_set(uuid, uuid)
  from public, anon;
revoke all on function public.abandon_configuration_change_set(uuid, uuid)
  from public, anon;

grant execute on function public.propose_configuration_change(
  uuid,
  text,
  text,
  jsonb
) to authenticated;
grant execute on function public.list_configuration_change_sets(uuid)
  to authenticated;
grant execute on function public.get_configuration_change_set(uuid, uuid)
  to authenticated;
grant execute on function public.abandon_configuration_change_set(uuid, uuid)
  to authenticated;

comment on table public.configuration_change_sets is
  'Immutable M5 proposal inputs and deterministic engine outputs. Phase 2A supports change proposals and proposed-to-abandoned only.';
comment on function private.configuration_materialize_candidate_v1(
  uuid,
  jsonb,
  jsonb,
  jsonb
) is
  'The authoritative Phase 2A key-based operation materializer. It returns a canonical schema-v1 candidate, trusted allocations, PostgreSQL checksum, and semantic diff.';
comment on function public.propose_configuration_change(
  uuid,
  text,
  text,
  jsonb
) is
  'Owner/Admin proposal boundary. Requires the live projection to equal the active immutable version and never changes the projection or head.';
