-- Milestone 5 Phase 2B semantic display-context hardening:
-- proposal-time Location names are immutable display metadata, never
-- canonical configuration or current eligibility input.

drop trigger configuration_change_sets_protect
on public.configuration_change_sets;

alter table public.configuration_change_sets
  add column display_context_json jsonb null;

create function private.configuration_display_context_v1_is_valid(
  display_context jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  configured_location record;
begin
  if display_context is null
    or not private.configuration_json_has_exact_keys(
      display_context,
      array['schema_version', 'locations']
    )
    or display_context ->> 'schema_version' <> '1'
    or jsonb_typeof(display_context -> 'locations') <> 'object'
    or octet_length(display_context::text) > 131072
  then
    return false;
  end if;

  for configured_location in
    select key, value
    from jsonb_each(display_context -> 'locations')
  loop
    if not private.configuration_uuid_is_valid(configured_location.key)
      or not private.configuration_json_has_exact_keys(
        configured_location.value,
        array['name']
      )
      or jsonb_typeof(configured_location.value -> 'name') <> 'string'
      or char_length(configured_location.value ->> 'name') not between 1 and 120
      or char_length(trim(configured_location.value ->> 'name')) = 0
    then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create function private.assert_configuration_display_context_v1(
  display_context jsonb,
  base_snapshot jsonb,
  candidate_snapshot jsonb
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if not private.configuration_display_context_v1_is_valid(display_context)
  then
    raise exception 'configuration_display_context_invalid'
      using errcode = '22023';
  end if;

  if exists (
    with expected_locations as (
      select allowed ->> 'location_id' as location_id
      from jsonb_array_elements(
        base_snapshot -> 'preorder_experience_locations'
      ) as allowed
      union
      select allowed ->> 'location_id'
      from jsonb_array_elements(
        candidate_snapshot -> 'preorder_experience_locations'
      ) as allowed
    ),
    context_locations as (
      select key as location_id
      from jsonb_each(display_context -> 'locations')
    )
    (
      select location_id from expected_locations
      except
      select location_id from context_locations
    )
    union all
    (
      select location_id from context_locations
      except
      select location_id from expected_locations
    )
  ) then
    raise exception 'configuration_display_context_references_invalid'
      using errcode = '23514';
  end if;
end;
$$;

create function private.build_configuration_display_context_v1(
  target_business_id uuid,
  base_snapshot jsonb,
  operations jsonb,
  existing_semantic_diff jsonb default null
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  display_context jsonb;
begin
  if target_business_id is null then
    raise exception 'configuration_candidate_business_invalid'
      using errcode = '22023';
  end if;

  if exists (
    with referenced_locations as (
      select (allowed ->> 'location_id')::uuid as location_id
      from jsonb_array_elements(
        base_snapshot -> 'preorder_experience_locations'
      ) as allowed
      union
      select (configured_location #>> '{}')::uuid
      from jsonb_array_elements(operations) as operation
      cross join lateral jsonb_array_elements(
        operation -> 'allowed_location_ids'
      ) as configured_location
      where operation ->> 'op' = 'set_preorder_experience'
    )
    select 1
    from referenced_locations as referenced
    where not exists (
      select 1
      from public.locations as location
      where location.business_id = target_business_id
        and location.id = referenced.location_id
    )
  ) then
    raise exception 'configuration_preorder_location_invalid'
      using errcode = '23514';
  end if;

  with referenced_locations as (
    select (allowed ->> 'location_id')::uuid as location_id
    from jsonb_array_elements(
      base_snapshot -> 'preorder_experience_locations'
    ) as allowed
    union
    select (configured_location #>> '{}')::uuid
    from jsonb_array_elements(operations) as operation
    cross join lateral jsonb_array_elements(
      operation -> 'allowed_location_ids'
    ) as configured_location
    where operation ->> 'op' = 'set_preorder_experience'
  ),
  labelled_locations as (
    select
      referenced.location_id,
      coalesce(
        (
          select change ->> 'label'
          from jsonb_array_elements(
            coalesce(
              existing_semantic_diff -> 'changes',
              '[]'::jsonb
            )
          ) as change
          where change ->> 'entity_type' = 'preorder_location'
            and split_part(change ->> 'entity_key', ':', 2) =
              referenced.location_id::text
          order by change ->> 'entity_key' collate "C"
          limit 1
        ),
        trim(location.name)
      ) as location_name
    from referenced_locations as referenced
    join public.locations as location
      on location.business_id = target_business_id
      and location.id = referenced.location_id
  )
  select jsonb_build_object(
    'schema_version',
    1,
    'locations',
    coalesce(
      jsonb_object_agg(
        location_id::text,
        jsonb_build_object('name', location_name)
        order by location_id::text
      ),
      '{}'::jsonb
    )
  )
  into display_context
  from labelled_locations;

  if not private.configuration_display_context_v1_is_valid(display_context)
  then
    raise exception 'configuration_display_context_invalid'
      using errcode = '22023';
  end if;

  return display_context;
end;
$$;

update public.configuration_change_sets as change_set
set display_context_json =
  private.build_configuration_display_context_v1(
    change_set.business_id,
    version.snapshot_json,
    change_set.operations_json,
    change_set.semantic_diff_json
  )
from public.configuration_versions as version
where version.business_id = change_set.business_id
  and version.id = change_set.base_version_id;

alter table public.configuration_change_sets
  alter column display_context_json set not null,
  add constraint configuration_change_sets_display_context_shape
    check (
      private.configuration_display_context_v1_is_valid(
        display_context_json
      )
    );

create function private.configuration_semantic_diff_v1(
  base_snapshot jsonb,
  candidate_snapshot jsonb,
  trusted_display_context jsonb
)
returns jsonb
language sql
immutable
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
      coalesce(
        trusted_display_context -> 'locations' -> coalesce(
          after_entity ->> 'location_id',
          before_entity ->> 'location_id'
        ) ->> 'name',
        'Location'
      ),
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
  trusted_allocations jsonb,
  trusted_display_context jsonb
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
  perform private.assert_configuration_display_context_v1(
    trusted_display_context,
    base_snapshot,
    candidate
  );
  checksum := private.configuration_snapshot_checksum_v1(candidate);
  semantic_diff := private.configuration_semantic_diff_v1(
    base_snapshot,
    candidate,
    trusted_display_context
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

create or replace function private.protect_configuration_change_set()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  immutable_payload_unchanged boolean;
begin
  immutable_payload_unchanged :=
    new.business_id = old.business_id
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
    and new.display_context_json = old.display_context_json
    and new.candidate_snapshot_json = old.candidate_snapshot_json
    and new.candidate_checksum = old.candidate_checksum
    and new.semantic_diff_json = old.semantic_diff_json
    and new.applied_version_id is not distinct from old.applied_version_id
    and new.applied_by is not distinct from old.applied_by
    and new.applied_at is not distinct from old.applied_at
    and new.created_at = old.created_at;

  if old.status = 'proposed'
    and immutable_payload_unchanged
    and (
      (
        new.status = 'abandoned'
        and new.validation_result_json is null
        and new.validated_by is null
        and new.validated_at is null
        and new.closed_by is not null
        and new.closed_at is not null
      )
      or (
        new.status = 'conflicted'
        and new.validation_result_json is null
        and new.validated_by is null
        and new.validated_at is null
        and new.closed_by is not null
        and new.closed_at is not null
      )
      or (
        new.status = 'validated'
        and private.configuration_validation_result_v1_is_valid(
          new.validation_result_json
        )
        and new.validation_result_json ->> 'outcome' = 'valid'
        and new.validated_by is not null
        and new.validated_at is not null
        and new.closed_by is null
        and new.closed_at is null
      )
      or (
        new.status = 'rejected'
        and private.configuration_validation_result_v1_is_valid(
          new.validation_result_json
        )
        and new.validation_result_json ->> 'outcome' = 'invalid'
        and new.validated_by is not null
        and new.validated_at is not null
        and new.closed_by = new.validated_by
        and new.closed_at = new.validated_at
      )
    )
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

create or replace function public.propose_configuration_change(
  expected_business_id uuid,
  expected_actor_id uuid,
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
  display_context jsonb;
  materialized jsonb;
  created_change_set public.configuration_change_sets;
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

  perform private.assert_configuration_operations_v1(requested_operations);
  display_context := private.build_configuration_display_context_v1(
    expected_business_id,
    base_version.snapshot_json,
    requested_operations,
    null
  );
  materialized := private.configuration_materialize_candidate_v1(
    expected_business_id,
    base_version.snapshot_json,
    requested_operations,
    null,
    display_context
  );
  perform private.assert_configuration_candidate_locations_active_v1(
    expected_business_id,
    materialized -> 'candidate_snapshot'
  );

  if materialized -> 'candidate_snapshot' = base_version.snapshot_json
    or materialized ->> 'candidate_checksum' =
      base_version.snapshot_checksum
    or jsonb_array_length(
      materialized -> 'semantic_diff' -> 'changes'
    ) = 0
  then
    raise exception 'configuration_proposal_no_changes'
      using errcode = '22023';
  end if;

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
    display_context_json,
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
    display_context,
    materialized -> 'candidate_snapshot',
    materialized ->> 'candidate_checksum',
    materialized -> 'semantic_diff'
  )
  returning * into created_change_set;

  return created_change_set;
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
      selected_change_set.id_allocations_json,
      selected_change_set.display_context_json
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

drop function private.configuration_materialize_candidate_v1(
  uuid,
  jsonb,
  jsonb,
  jsonb
);
drop function private.configuration_semantic_diff_v1(uuid, jsonb, jsonb);

revoke all on function private.configuration_display_context_v1_is_valid(jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.assert_configuration_display_context_v1(
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.build_configuration_display_context_v1(
  uuid,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.configuration_semantic_diff_v1(
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.configuration_materialize_candidate_v1(
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;

comment on column public.configuration_change_sets.display_context_json is
  'Immutable proposal-time owner display metadata; excluded from canonical configuration, checksums and current eligibility.';
comment on function private.configuration_semantic_diff_v1(
  jsonb,
  jsonb,
  jsonb
) is
  'Builds deterministic owner-readable semantic diff from immutable snapshots and trusted display context only.';
comment on function private.configuration_materialize_candidate_v1(
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) is
  'The sole schema-v1 candidate materializer using immutable base, operations, allocations and display context.';
