create function private.configuration_validation_result_v1_is_valid(
  value jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    private.configuration_json_has_exact_keys(
      value,
      array[
        'schema_version',
        'outcome',
        'base_version_id',
        'base_head_revision',
        'candidate_checksum',
        'errors',
        'warnings'
      ]
    )
    and value -> 'schema_version' = '1'::jsonb
    and value ->> 'outcome' in ('valid', 'invalid')
    and private.configuration_uuid_is_valid(value ->> 'base_version_id')
    and jsonb_typeof(value -> 'base_head_revision') = 'number'
    and (value ->> 'base_head_revision') ~ '^[1-9][0-9]*$'
    and value ->> 'candidate_checksum' ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(value -> 'errors') = 'array'
    and jsonb_array_length(value -> 'errors') <= 50
    and jsonb_typeof(value -> 'warnings') = 'array'
    and jsonb_array_length(value -> 'warnings') <= 50
    and not exists (
      select 1
      from jsonb_array_elements(
        (value -> 'errors') || (value -> 'warnings')
      ) as issue
      where not private.configuration_json_has_exact_keys(
        issue,
        array['code', 'message']
      )
        or jsonb_typeof(issue -> 'code') <> 'string'
        or issue ->> 'code' !~ '^[a-z][a-z0-9_]{0,79}$'
        or jsonb_typeof(issue -> 'message') <> 'string'
        or char_length(trim(issue ->> 'message')) not between 1 and 300
    )
    and (
      (
        value ->> 'outcome' = 'valid'
        and jsonb_array_length(value -> 'errors') = 0
      )
      or (
        value ->> 'outcome' = 'invalid'
        and jsonb_array_length(value -> 'errors') > 0
      )
    ),
    false
  );
$$;

alter table public.configuration_change_sets
  drop constraint configuration_change_sets_validation_shape,
  drop constraint configuration_change_sets_closure_shape;

alter table public.configuration_change_sets
  add constraint configuration_change_sets_validation_shape
  check (
    (
      status in ('validated', 'rejected', 'applied')
      and validation_result_json is not null
      and private.configuration_validation_result_v1_is_valid(
        validation_result_json
      )
      and (validation_result_json ->> 'base_version_id')::uuid =
        base_version_id
      and (validation_result_json ->> 'base_head_revision')::bigint =
        base_head_revision
      and validation_result_json ->> 'candidate_checksum' =
        candidate_checksum
      and validated_by is not null
      and validated_at is not null
      and (
        (
          status in ('validated', 'applied')
          and validation_result_json ->> 'outcome' = 'valid'
        )
        or (
          status = 'rejected'
          and validation_result_json ->> 'outcome' = 'invalid'
        )
      )
    )
    or (
      status not in ('validated', 'rejected', 'applied')
      and validation_result_json is null
      and validated_by is null
      and validated_at is null
    )
  ),
  add constraint configuration_change_sets_closure_shape
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
  ),
  add constraint configuration_change_sets_rejected_actor_shape
  check (
    status <> 'rejected'
    or (
      closed_by = validated_by
      and closed_at = validated_at
    )
  );

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

create function private.assert_configuration_candidate_locations_active_v1(
  target_business_id uuid,
  candidate jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if exists (
    select 1
    from jsonb_array_elements(
      candidate -> 'preorder_experience_locations'
    ) as allowed
    where (allowed ->> 'is_active')::boolean
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

create function private.project_configuration_candidate_v1(
  target_business_id uuid,
  candidate jsonb
)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  configured_entity jsonb;
  actual_snapshot jsonb;
begin
  perform private.assert_configuration_candidate_v1(
    target_business_id,
    candidate
  );

  -- Park outward-facing and dependent configuration before changing graph
  -- definitions. These writes are transaction-local and never become visible
  -- during sandbox validation.
  update public.pages as page
  set is_active = false
  where page.business_id = target_business_id
    and page.is_active;

  update public.preorder_experiences as experience
  set is_active = false
  where experience.business_id = target_business_id
    and experience.is_active;

  update public.views as view_definition
  set is_active = false
  where view_definition.business_id = target_business_id
    and view_definition.is_active;

  update public.forms as form_definition
  set is_active = false
  where form_definition.business_id = target_business_id
    and form_definition.is_active;

  update public.relationship_definitions as relationship_definition
  set is_active = false
  where relationship_definition.business_id = target_business_id
    and relationship_definition.is_active;

  -- Park changing Page slugs under deterministic temporary values so valid
  -- slug swaps cannot trip the live tenant-scoped uniqueness constraint.
  update public.pages as page
  set slug = 'm5-park-' || replace(page.id::text, '-', '')
  from jsonb_array_elements(candidate -> 'pages') as target_page
  where page.business_id = target_business_id
    and page.id = (target_page ->> 'id')::uuid
    and page.slug is distinct from target_page ->> 'slug';

  -- Existing Objects are parked before Fields are materialised; new Objects
  -- are inserted inactive. Object kind and semantic type come only from the
  -- trusted candidate and therefore preserve Phase 2A identity rules.
  update public.object_definitions as object_definition
  set is_active = false
  where object_definition.business_id = target_business_id
    and object_definition.is_active;

  for configured_entity in
    select value
    from jsonb_array_elements(candidate -> 'object_definitions')
    order by value ->> 'key' collate "C"
  loop
    insert into public.object_definitions (
      id,
      business_id,
      key,
      singular_label,
      plural_label,
      description,
      kind,
      semantic_type,
      icon,
      is_active
    )
    values (
      (configured_entity ->> 'id')::uuid,
      target_business_id,
      configured_entity ->> 'key',
      configured_entity ->> 'singular_label',
      configured_entity ->> 'plural_label',
      configured_entity ->> 'description',
      (configured_entity ->> 'kind')::public.object_definition_kind,
      configured_entity ->> 'semantic_type',
      configured_entity ->> 'icon',
      false
    )
    on conflict (id) do update
    set
      singular_label = excluded.singular_label,
      plural_label = excluded.plural_label,
      description = excluded.description,
      kind = excluded.kind,
      semantic_type = excluded.semantic_type,
      icon = excluded.icon
    where object_definitions.business_id = target_business_id
      and (
        object_definitions.singular_label,
        object_definitions.plural_label,
        object_definitions.description,
        object_definitions.kind,
        object_definitions.semantic_type,
        object_definitions.icon
      ) is distinct from (
        excluded.singular_label,
        excluded.plural_label,
        excluded.description,
        excluded.kind,
        excluded.semantic_type,
        excluded.icon
      );
  end loop;

  update public.field_definitions as field_definition
  set is_active = false
  where field_definition.business_id = target_business_id
    and field_definition.is_active
    and not exists (
      select 1
      from jsonb_array_elements(
        candidate -> 'field_definitions'
      ) as target_field
      where (target_field ->> 'id')::uuid = field_definition.id
    );

  for configured_entity in
    select value
    from jsonb_array_elements(candidate -> 'field_definitions')
    order by
      value ->> 'object_key' collate "C",
      (value ->> 'position')::integer,
      value ->> 'key' collate "C"
  loop
    insert into public.field_definitions (
      id,
      business_id,
      object_definition_id,
      key,
      label,
      field_type,
      required,
      default_value,
      settings_json,
      position,
      is_active
    )
    values (
      (configured_entity ->> 'id')::uuid,
      target_business_id,
      (configured_entity ->> 'object_definition_id')::uuid,
      configured_entity ->> 'key',
      configured_entity ->> 'label',
      (configured_entity ->> 'field_type')::public.graph_field_type,
      (configured_entity ->> 'required')::boolean,
      nullif(configured_entity -> 'default_value', 'null'::jsonb),
      configured_entity -> 'settings_json',
      (configured_entity ->> 'position')::integer,
      (configured_entity ->> 'is_active')::boolean
    )
    on conflict (id) do update
    set
      label = excluded.label,
      field_type = excluded.field_type,
      required = excluded.required,
      default_value = excluded.default_value,
      settings_json = excluded.settings_json,
      position = excluded.position,
      is_active = excluded.is_active
    where field_definitions.business_id = target_business_id
      and (
        field_definitions.label,
        field_definitions.field_type,
        field_definitions.required,
        field_definitions.default_value,
        field_definitions.settings_json,
        field_definitions.position,
        field_definitions.is_active
      ) is distinct from (
        excluded.label,
        excluded.field_type,
        excluded.required,
        excluded.default_value,
        excluded.settings_json,
        excluded.position,
        excluded.is_active
      );
  end loop;

  for configured_entity in
    select value
    from jsonb_array_elements(candidate -> 'object_definitions')
    order by value ->> 'key' collate "C"
  loop
    update public.object_definitions as object_definition
    set is_active = (configured_entity ->> 'is_active')::boolean
    where object_definition.business_id = target_business_id
      and object_definition.id = (configured_entity ->> 'id')::uuid
      and object_definition.is_active is distinct from
        (configured_entity ->> 'is_active')::boolean;
  end loop;

  update public.relationship_definitions as relationship_definition
  set is_active = false
  where relationship_definition.business_id = target_business_id
    and relationship_definition.is_active
    and not exists (
      select 1
      from jsonb_array_elements(
        candidate -> 'relationship_definitions'
      ) as target_relationship
      where (target_relationship ->> 'id')::uuid =
        relationship_definition.id
    );

  for configured_entity in
    select value
    from jsonb_array_elements(candidate -> 'relationship_definitions')
    order by value ->> 'key' collate "C"
  loop
    insert into public.relationship_definitions (
      id,
      business_id,
      key,
      source_object_definition_id,
      target_object_definition_id,
      source_label,
      target_label,
      cardinality,
      is_required,
      is_active
    )
    values (
      (configured_entity ->> 'id')::uuid,
      target_business_id,
      (configured_entity ->> 'key'),
      (configured_entity ->> 'source_object_definition_id')::uuid,
      (configured_entity ->> 'target_object_definition_id')::uuid,
      configured_entity ->> 'source_label',
      configured_entity ->> 'target_label',
      (configured_entity ->> 'cardinality')::
        public.relationship_cardinality,
      (configured_entity ->> 'is_required')::boolean,
      (configured_entity ->> 'is_active')::boolean
    )
    on conflict (id) do update
    set
      source_label = excluded.source_label,
      target_label = excluded.target_label,
      cardinality = excluded.cardinality,
      is_required = excluded.is_required,
      is_active = excluded.is_active
    where relationship_definitions.business_id = target_business_id
      and (
        relationship_definitions.source_label,
        relationship_definitions.target_label,
        relationship_definitions.cardinality,
        relationship_definitions.is_required,
        relationship_definitions.is_active
      ) is distinct from (
        excluded.source_label,
        excluded.target_label,
        excluded.cardinality,
        excluded.is_required,
        excluded.is_active
      );
  end loop;

  update public.forms as form_definition
  set is_active = false
  where form_definition.business_id = target_business_id
    and form_definition.is_active
    and not exists (
      select 1
      from jsonb_array_elements(candidate -> 'forms') as target_form
      where (target_form ->> 'id')::uuid = form_definition.id
    );

  for configured_entity in
    select value
    from jsonb_array_elements(candidate -> 'forms')
    order by value ->> 'key' collate "C"
  loop
    insert into public.forms (
      id,
      business_id,
      key,
      name,
      object_definition_id,
      mode,
      config_json,
      audience,
      is_active
    )
    values (
      (configured_entity ->> 'id')::uuid,
      target_business_id,
      configured_entity ->> 'key',
      configured_entity ->> 'name',
      (configured_entity ->> 'object_definition_id')::uuid,
      (configured_entity ->> 'mode')::public.experience_form_mode,
      configured_entity -> 'config_json',
      (configured_entity ->> 'audience')::public.experience_audience,
      (configured_entity ->> 'is_active')::boolean
    )
    on conflict (id) do update
    set
      name = excluded.name,
      config_json = excluded.config_json,
      audience = excluded.audience,
      is_active = excluded.is_active
    where forms.business_id = target_business_id
      and (
        forms.name,
        forms.config_json,
        forms.audience,
        forms.is_active
      ) is distinct from (
        excluded.name,
        excluded.config_json,
        excluded.audience,
        excluded.is_active
      );
  end loop;

  update public.views as view_definition
  set is_active = false
  where view_definition.business_id = target_business_id
    and view_definition.is_active
    and not exists (
      select 1
      from jsonb_array_elements(candidate -> 'views') as target_view
      where (target_view ->> 'id')::uuid = view_definition.id
    );

  for configured_entity in
    select value
    from jsonb_array_elements(candidate -> 'views')
    order by value ->> 'key' collate "C"
  loop
    insert into public.views (
      id,
      business_id,
      key,
      name,
      view_type,
      object_definition_id,
      config_json,
      audience,
      is_active
    )
    values (
      (configured_entity ->> 'id')::uuid,
      target_business_id,
      configured_entity ->> 'key',
      configured_entity ->> 'name',
      (configured_entity ->> 'view_type')::public.experience_view_type,
      (configured_entity ->> 'object_definition_id')::uuid,
      configured_entity -> 'config_json',
      (configured_entity ->> 'audience')::public.experience_audience,
      (configured_entity ->> 'is_active')::boolean
    )
    on conflict (id) do update
    set
      name = excluded.name,
      view_type = excluded.view_type,
      config_json = excluded.config_json,
      audience = excluded.audience,
      is_active = excluded.is_active
    where views.business_id = target_business_id
      and (
        views.name,
        views.view_type,
        views.config_json,
        views.audience,
        views.is_active
      ) is distinct from (
        excluded.name,
        excluded.view_type,
        excluded.config_json,
        excluded.audience,
        excluded.is_active
      );
  end loop;

  update public.preorder_experiences as experience
  set is_active = false
  where experience.business_id = target_business_id
    and experience.is_active
    and not exists (
      select 1
      from jsonb_array_elements(
        candidate -> 'preorder_experiences'
      ) as target_experience
      where (target_experience ->> 'id')::uuid = experience.id
    );

  -- Insert or reshape preorder rows while inactive. Their active-state graph
  -- and constructability checks run only after associations are ready.
  for configured_entity in
    select value
    from jsonb_array_elements(candidate -> 'preorder_experiences')
    order by value ->> 'key' collate "C"
  loop
    insert into public.preorder_experiences (
      id,
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
      (configured_entity ->> 'id')::uuid,
      target_business_id,
      configured_entity ->> 'key',
      (configured_entity ->> 'product_object_definition_id')::uuid,
      (configured_entity ->> 'customer_object_definition_id')::uuid,
      (configured_entity ->> 'order_object_definition_id')::uuid,
      (configured_entity ->> 'order_item_object_definition_id')::uuid,
      (
        configured_entity ->>
          'customer_places_order_relationship_definition_id'
      )::uuid,
      (
        configured_entity ->>
          'order_contains_item_relationship_definition_id'
      )::uuid,
      (
        configured_entity ->>
          'product_appears_in_item_relationship_definition_id'
      )::uuid,
      configured_entity -> 'config_json',
      false
    )
    on conflict (id) do update
    set
      config_json = excluded.config_json
    where preorder_experiences.business_id = target_business_id
      and preorder_experiences.config_json is distinct from
        excluded.config_json;
  end loop;

  update public.preorder_experience_locations as allowed
  set is_active = false
  where allowed.business_id = target_business_id
    and allowed.is_active
    and not exists (
      select 1
      from jsonb_array_elements(
        candidate -> 'preorder_experience_locations'
      ) as target_allowed
      where (target_allowed ->> 'id')::uuid = allowed.id
    );

  for configured_entity in
    select value
    from jsonb_array_elements(
      candidate -> 'preorder_experience_locations'
    )
    order by
      value ->> 'preorder_key' collate "C",
      (value ->> 'location_id')::uuid
  loop
    insert into public.preorder_experience_locations (
      id,
      business_id,
      preorder_experience_id,
      location_id,
      is_active
    )
    values (
      (configured_entity ->> 'id')::uuid,
      target_business_id,
      (configured_entity ->> 'preorder_experience_id')::uuid,
      (configured_entity ->> 'location_id')::uuid,
      (configured_entity ->> 'is_active')::boolean
    )
    on conflict (id) do update
    set is_active = excluded.is_active
    where preorder_experience_locations.business_id = target_business_id
      and preorder_experience_locations.is_active is distinct from
        excluded.is_active;
  end loop;

  perform private.assert_configuration_candidate_locations_active_v1(
    target_business_id,
    candidate
  );

  for configured_entity in
    select value
    from jsonb_array_elements(candidate -> 'preorder_experiences')
    order by value ->> 'key' collate "C"
  loop
    update public.preorder_experiences as experience
    set is_active = (configured_entity ->> 'is_active')::boolean
    where experience.business_id = target_business_id
      and experience.id = (configured_entity ->> 'id')::uuid
      and experience.is_active is distinct from
        (configured_entity ->> 'is_active')::boolean;
  end loop;

  update public.pages as page
  set is_active = false
  where page.business_id = target_business_id
    and page.is_active
    and not exists (
      select 1
      from jsonb_array_elements(candidate -> 'pages') as target_page
      where (target_page ->> 'id')::uuid = page.id
    );

  for configured_entity in
    select value
    from jsonb_array_elements(candidate -> 'pages')
    order by value ->> 'key' collate "C"
  loop
    insert into public.pages (
      id,
      business_id,
      key,
      title,
      slug,
      audience,
      layout_json,
      status,
      is_active
    )
    values (
      (configured_entity ->> 'id')::uuid,
      target_business_id,
      configured_entity ->> 'key',
      configured_entity ->> 'title',
      configured_entity ->> 'slug',
      (configured_entity ->> 'audience')::public.experience_audience,
      configured_entity -> 'layout_json',
      (configured_entity ->> 'status')::public.experience_page_status,
      (configured_entity ->> 'is_active')::boolean
    )
    on conflict (id) do update
    set
      title = excluded.title,
      slug = excluded.slug,
      audience = excluded.audience,
      layout_json = excluded.layout_json,
      status = excluded.status,
      is_active = excluded.is_active
    where pages.business_id = target_business_id
      and (
        pages.title,
        pages.slug,
        pages.audience,
        pages.layout_json,
        pages.status,
        pages.is_active
      ) is distinct from (
        excluded.title,
        excluded.slug,
        excluded.audience,
        excluded.layout_json,
        excluded.status,
        excluded.is_active
      );
  end loop;

  set constraints all immediate;

  actual_snapshot := private.configuration_snapshot_v1(target_business_id);
  if actual_snapshot <> candidate
    or private.configuration_snapshot_checksum_v1(actual_snapshot) <>
      private.configuration_snapshot_checksum_v1(candidate)
  then
    raise exception 'configuration_projector_snapshot_mismatch'
      using errcode = 'P0001';
  end if;
end;
$$;

create function private.configuration_validation_issue_v1(
  error_state text,
  error_message text,
  error_constraint text
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  if error_message like 'Populated field types cannot be changed%'
    or error_message like 'Required field is missing:%'
    or error_message like 'Invalid value for field:%'
    or error_message like 'Unknown record field key:%'
  then
    return jsonb_build_object(
      'code',
      'existing_records_incompatible',
      'message',
      'This change is not compatible with existing business information.'
    );
  end if;

  if error_message like
      'A relationship definition with edges cannot change shape%'
    or error_message like
      'Objects referenced by active relationships cannot be archived%'
  then
    return jsonb_build_object(
      'code',
      'existing_relationships_incompatible',
      'message',
      'This change is not compatible with existing linked information.'
    );
  end if;

  if error_message like 'Allowed preorder Locations must be active%'
    or error_message like 'configuration_preorder_location_invalid%'
    or error_constraint like
      'preorder_experience_locations_tenant_location_fkey%'
  then
    return jsonb_build_object(
      'code',
      'location_ineligible',
      'message',
      'A collection location in this change is no longer available.'
    );
  end if;

  if error_message like '%Page%'
    or error_message like 'configuration_page_%'
  then
    return jsonb_build_object(
      'code',
      'page_configuration_incompatible',
      'message',
      'A page in this change has a reference that is no longer available.'
    );
  end if;

  if error_message like '%View%'
    or error_message like '%Form%'
    or error_message like 'configuration_view_%'
    or error_message like 'configuration_form_%'
  then
    return jsonb_build_object(
      'code',
      'experience_configuration_incompatible',
      'message',
      'A screen or form in this change is no longer compatible.'
    );
  end if;

  if error_message like '%preorder%'
    or error_message like '%Preorder%'
  then
    return jsonb_build_object(
      'code',
      'preorder_configuration_incompatible',
      'message',
      'The preorder setup in this change is no longer compatible.'
    );
  end if;

  if error_state in ('22023', '23502', '23503', '23505', '23514', '23P01')
  then
    return jsonb_build_object(
      'code',
      'configuration_candidate_incompatible',
      'message',
      'This change cannot be used with the current business setup.'
    );
  end if;

  return null;
end;
$$;

create function private.validate_configuration_candidate_in_sandbox_v1(
  target_business_id uuid,
  target_base_version_id uuid,
  target_base_head_revision bigint,
  target_candidate_checksum text,
  candidate jsonb
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  captured_state text;
  captured_message text;
  captured_constraint text;
  owner_issue jsonb;
begin
  begin
    perform private.project_configuration_candidate_v1(
      target_business_id,
      candidate
    );

    raise exception 'configuration_validation_sandbox_success'
      using errcode = 'ZB001';
  exception
    when sqlstate 'ZB001' then
      set constraints all deferred;
      return jsonb_build_object(
        'schema_version',
        1,
        'outcome',
        'valid',
        'base_version_id',
        target_base_version_id,
        'base_head_revision',
        target_base_head_revision,
        'candidate_checksum',
        target_candidate_checksum,
        'errors',
        jsonb_build_array(),
        'warnings',
        jsonb_build_array()
      );
    when others then
      get stacked diagnostics
        captured_state = returned_sqlstate,
        captured_message = message_text,
        captured_constraint = constraint_name;
      set constraints all deferred;

      owner_issue := private.configuration_validation_issue_v1(
        captured_state,
        captured_message,
        captured_constraint
      );
      if owner_issue is null then
        raise exception 'configuration_validation_engine_failure'
          using errcode = 'P0001';
      end if;

      return jsonb_build_object(
        'schema_version',
        1,
        'outcome',
        'invalid',
        'base_version_id',
        target_base_version_id,
        'base_head_revision',
        target_base_head_revision,
        'candidate_checksum',
        target_candidate_checksum,
        'errors',
        jsonb_build_array(owner_issue),
        'warnings',
        jsonb_build_array()
      );
  end;
end;
$$;

drop function public.propose_configuration_change(
  uuid,
  text,
  text,
  jsonb
);

create function public.propose_configuration_change(
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

  materialized := private.configuration_materialize_candidate_v1(
    expected_business_id,
    base_version.snapshot_json,
    requested_operations,
    null
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

drop function public.abandon_configuration_change_set(uuid, uuid);

create function public.abandon_configuration_change_set(
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
  abandoned_change_set public.configuration_change_sets;
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

create function public.validate_configuration_change(
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
  replay_error_message text;
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
      get stacked diagnostics replay_error_message = message_text;
      if replay_error_message = 'configuration_preorder_location_invalid' then
        -- Phase 2A deliberately checked current Location eligibility inside
        -- its materializer. When that mutable state has changed, reproduce
        -- the immutable candidate in a nested rollback-only subtransaction:
        -- inactive referenced Locations are transaction-locally eligible only
        -- for replay, the exact materialized outputs escape in PL/pgSQL local
        -- variables, and the controlled sentinel rolls every Location write
        -- back before the real sandbox rechecks the actual inactive state.
        begin
          update public.locations as location
          set is_active = true
          where location.business_id = expected_business_id
            and not location.is_active
            and exists (
              select 1
              from jsonb_array_elements(
                selected_change_set.candidate_snapshot_json ->
                  'preorder_experience_locations'
              ) as allowed
              where (allowed ->> 'is_active')::boolean
                and (allowed ->> 'location_id')::uuid = location.id
            );

          replayed := private.configuration_materialize_candidate_v1(
            expected_business_id,
            base_version.snapshot_json,
            selected_change_set.operations_json,
            selected_change_set.id_allocations_json
          );
          raise exception 'configuration_location_replay_success'
            using errcode = 'ZB002';
        exception
          when sqlstate 'ZB002' then
            null;
          when others then
            raise exception 'configuration_candidate_replay_failed'
              using errcode = 'P0001';
        end;
      else
        raise exception 'configuration_candidate_replay_failed'
          using errcode = 'P0001';
      end if;
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

revoke all on function private.configuration_validation_result_v1_is_valid(
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.assert_configuration_candidate_locations_active_v1(
  uuid,
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.project_configuration_candidate_v1(
  uuid,
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.configuration_validation_issue_v1(
  text,
  text,
  text
) from public, anon, authenticated, service_role;
revoke all on function private.validate_configuration_candidate_in_sandbox_v1(
  uuid,
  uuid,
  bigint,
  text,
  jsonb
) from public, anon, authenticated, service_role;

revoke all on function public.propose_configuration_change(
  uuid,
  uuid,
  text,
  text,
  jsonb
) from public, anon, service_role;
revoke all on function public.abandon_configuration_change_set(
  uuid,
  uuid,
  uuid
) from public, anon, service_role;
revoke all on function public.validate_configuration_change(
  uuid,
  uuid,
  uuid
) from public, anon, service_role;

grant execute on function public.propose_configuration_change(
  uuid,
  uuid,
  text,
  text,
  jsonb
) to authenticated;
grant execute on function public.abandon_configuration_change_set(
  uuid,
  uuid,
  uuid
) to authenticated;
grant execute on function public.validate_configuration_change(
  uuid,
  uuid,
  uuid
) to authenticated;

comment on function private.project_configuration_candidate_v1(uuid, jsonb)
is
  'Static table-specific complete configuration projector shared by rollback-only validation and later application. It never deletes configuration rows.';
comment on function private.validate_configuration_candidate_in_sandbox_v1(
  uuid,
  uuid,
  bigint,
  text,
  jsonb
) is
  'Runs the static projector inside an exception-backed subtransaction and always rolls its configuration writes back.';
comment on function public.validate_configuration_change(uuid, uuid, uuid)
is
  'Owner/Admin Phase 2B validation boundary. It locks head then change set, replays immutable inputs, validates in a rollback-only sandbox, and commits only lifecycle metadata.';
