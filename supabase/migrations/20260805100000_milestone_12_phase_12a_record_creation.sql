/*
 * Milestone 12 Phase 12A
 *
 * This migration adds only the narrow confirmed generic Record boundary. The
 * ordinary graph Record RPC and its existing trigger remain unchanged.
 */

create function private.graph_record_creation_eligibility_v1(
  target_business_id uuid,
  target_object_definition_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with reasons(reason_code) as (
    select 'inactive_object'::text
    from public.object_definitions as object_definition
    where object_definition.business_id = $1
      and object_definition.id = $2
      and not object_definition.is_active

    union all

    select 'required_relationship_target'::text
    where exists (
      select 1
      from public.relationship_definitions as relationship_definition
      where relationship_definition.business_id = $1
        and relationship_definition.target_object_definition_id
          = $2
        and relationship_definition.is_active
        and relationship_definition.is_required
    )

    union all

    select 'preorder_order_object'::text
    where exists (
      select 1
      from public.preorder_experiences as preorder
      where preorder.business_id = $1
        and preorder.order_object_definition_id = $2
        and preorder.is_active
    )

    union all

    select 'preorder_order_item_object'::text
    where exists (
      select 1
      from public.preorder_experiences as preorder
      where preorder.business_id = $1
        and preorder.order_item_object_definition_id
          = $2
        and preorder.is_active
    )

    union all

    select 'required_file_without_default'::text
    where exists (
      select 1
      from public.field_definitions as field_definition
      where field_definition.business_id = $1
        and field_definition.object_definition_id
          = $2
        and field_definition.is_active
        and field_definition.required
        and field_definition.field_type = 'file'::public.graph_field_type
        and field_definition.default_value is null
    )

    union all

    select 'no_writable_fields'::text
    where not exists (
      select 1
      from public.field_definitions as field_definition
      where field_definition.business_id = $1
        and field_definition.object_definition_id
          = $2
        and field_definition.is_active
        and field_definition.field_type <> 'file'::public.graph_field_type
    )
  )
  select jsonb_build_object(
    'eligible', not exists (select 1 from reasons),
    'reason_codes', coalesce(
      (
        select jsonb_agg(reason_code order by reason_code)
        from reasons
      ),
      '[]'::jsonb
    )
  );
$$;

create function private.graph_record_creation_schema_v1(
  target_business_id uuid,
  target_object_definition_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'object', jsonb_build_object(
      'id', object_definition.id,
      'key', object_definition.key,
      'singular_label', object_definition.singular_label,
      'plural_label', object_definition.plural_label,
      'description', object_definition.description,
      'kind', object_definition.kind,
      'semantic_type', object_definition.semantic_type,
      'icon', object_definition.icon,
      'is_active', object_definition.is_active
    ),
    'fields', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', field_definition.id,
            'key', field_definition.key,
            'label', field_definition.label,
            'field_type', field_definition.field_type,
            'required', field_definition.required,
            'default_value', field_definition.default_value,
            'settings_json', field_definition.settings_json,
            'position', field_definition.position,
            'is_active', field_definition.is_active
          )
          order by field_definition.position,
            field_definition.key,
            field_definition.id
        )
        from public.field_definitions as field_definition
        where field_definition.business_id = $1
          and field_definition.object_definition_id
            = $2
      ),
      '[]'::jsonb
    ),
    'required_relationships', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', relationship_definition.id,
            'key', relationship_definition.key,
            'source_object_definition_id',
              relationship_definition.source_object_definition_id,
            'target_object_definition_id',
              relationship_definition.target_object_definition_id,
            'is_required', relationship_definition.is_required,
            'is_active', relationship_definition.is_active
          )
          order by relationship_definition.key,
            relationship_definition.id
        )
        from public.relationship_definitions as relationship_definition
        where relationship_definition.business_id = $1
          and relationship_definition.target_object_definition_id
            = $2
          and relationship_definition.is_active
          and relationship_definition.is_required
      ),
      '[]'::jsonb
    ),
    'trusted_preorder_roles', coalesce(
      (
        select jsonb_agg(role_metadata.value order by role_metadata.key)
        from (
          select
            preorder.key || ':order' as key,
            jsonb_build_object(
              'preorder_key', preorder.key,
              'role', 'order',
              'object_definition_id', preorder.order_object_definition_id
            ) as value
          from public.preorder_experiences as preorder
          where preorder.business_id = $1
            and preorder.order_object_definition_id
              = $2
            and preorder.is_active

          union all

          select
            preorder.key || ':order_item' as key,
            jsonb_build_object(
              'preorder_key', preorder.key,
              'role', 'order_item',
              'object_definition_id', preorder.order_item_object_definition_id
            ) as value
          from public.preorder_experiences as preorder
          where preorder.business_id = $1
            and preorder.order_item_object_definition_id
              = $2
            and preorder.is_active
        ) as role_metadata
      ),
      '[]'::jsonb
    ),
    'eligibility', private.graph_record_creation_eligibility_v1(
      $1,
      $2
    )
  )
  from public.object_definitions as object_definition
  where object_definition.business_id = $1
    and object_definition.id = $2;
$$;

create function private.graph_record_creation_schema_checksum_v1(
  target_business_id uuid,
  target_object_definition_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        private.graph_record_creation_schema_v1(
          $1,
          $2
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create function private.graph_object_record_state_v1(
  target_business_id uuid,
  target_object_definition_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'object_definition_id', $2,
    'records', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', record_value.id,
            'record_status', record_value.record_status,
            'created_at', record_value.created_at,
            'updated_at', record_value.updated_at,
            'data_checksum', encode(
              extensions.digest(
                convert_to(record_value.data_json::text, 'UTF8'),
                'sha256'
              ),
              'hex'
            )
          )
          order by record_value.id
        )
        from public.records as record_value
        where record_value.business_id = $1
          and record_value.object_definition_id = $2
      ),
      '[]'::jsonb
    )
  );
$$;

create function private.graph_object_record_state_checksum_v1(
  target_business_id uuid,
  target_object_definition_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        private.graph_object_record_state_v1(
          $1,
          $2
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function private.graph_record_creation_eligibility_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.graph_record_creation_schema_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.graph_record_creation_schema_checksum_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.graph_object_record_state_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.graph_object_record_state_checksum_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.get_confirmed_graph_record_creation_state(
  expected_business_id uuid,
  expected_actor_id uuid,
  target_object_key text
)
returns table (
  schema_version integer,
  business_id uuid,
  actor_id uuid,
  base_version_id uuid,
  head_revision bigint,
  object_definition_id uuid,
  object_key text,
  singular_label text,
  plural_label text,
  is_active boolean,
  eligibility jsonb,
  object_schema_digest text,
  record_state_digest text,
  fields jsonb,
  internal_views jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  current_business public.businesses;
  current_head public.business_configuration_heads;
  current_object public.object_definitions;
  object_fields jsonb;
  object_views jsonb;
begin
  if current_actor_id is null then
    raise exception 'record_creation_authentication_required'
      using errcode = '42501';
  end if;

  if current_actor_id is distinct from expected_actor_id then
    raise exception 'record_creation_actor_context_mismatch'
      using errcode = '42501';
  end if;

  if not private.can_manage_tenant(expected_business_id) then
    raise exception 'record_creation_owner_or_admin_required'
      using errcode = '42501';
  end if;

  select business.*
  into current_business
  from public.businesses as business
  where business.id = expected_business_id;
  if not found then
    raise exception 'record_creation_business_not_found'
      using errcode = 'P0002';
  end if;

  select head.*
  into current_head
  from public.business_configuration_heads as head
  where head.business_id = expected_business_id;
  if not found then
    raise exception 'record_creation_configuration_changed'
      using errcode = 'P0001';
  end if;

  select object_definition.*
  into current_object
  from public.object_definitions as object_definition
  where object_definition.business_id = expected_business_id
    and object_definition.key = target_object_key;
  if not found then
    raise exception 'record_creation_object_not_found'
      using errcode = 'P0002';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'key', field_definition.key,
        'label', field_definition.label,
        'field_type', field_definition.field_type,
        'required', field_definition.required,
        'default_value', field_definition.default_value,
        'settings_json', field_definition.settings_json,
        'position', field_definition.position,
        'is_active', field_definition.is_active
      )
      order by field_definition.position,
        field_definition.key,
        field_definition.id
    ),
    '[]'::jsonb
  )
  into object_fields
  from public.field_definitions as field_definition
  where field_definition.business_id = expected_business_id
    and field_definition.object_definition_id = current_object.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'key', view_definition.key,
        'name', view_definition.name,
        'view_type', view_definition.view_type,
        'object_key', current_object.key
      )
      order by view_definition.key, view_definition.id
    ),
    '[]'::jsonb
  )
  into object_views
  from public.views as view_definition
  where view_definition.business_id = expected_business_id
    and view_definition.object_definition_id = current_object.id
    and view_definition.audience = 'internal'::public.experience_audience
    and view_definition.is_active
    and view_definition.view_type <> 'detail'::public.experience_view_type;

  return query
  select
    1,
    current_business.id,
    current_actor_id,
    current_head.active_version_id,
    current_head.head_revision,
    current_object.id,
    current_object.key,
    current_object.singular_label,
    current_object.plural_label,
    current_object.is_active,
    private.graph_record_creation_eligibility_v1(
      current_business.id,
      current_object.id
    ),
    private.graph_record_creation_schema_checksum_v1(
      current_business.id,
      current_object.id
    ),
    private.graph_object_record_state_checksum_v1(
      current_business.id,
      current_object.id
    ),
    object_fields,
    object_views;
end;
$$;

revoke all on function public.get_confirmed_graph_record_creation_state(
  uuid,
  uuid,
  text
) from public, anon, service_role;
grant execute on function public.get_confirmed_graph_record_creation_state(
  uuid,
  uuid,
  text
) to authenticated;

create function public.create_confirmed_graph_record(
  expected_business_id uuid,
  expected_actor_id uuid,
  expected_base_version_id uuid,
  expected_head_revision bigint,
  target_object_key text,
  expected_object_schema_digest text,
  expected_record_state_digest text,
  requested_data jsonb
)
returns public.records
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  current_head public.business_configuration_heads;
  current_object public.object_definitions;
  current_schema_digest text;
  current_record_state_digest text;
  current_eligibility jsonb;
  created_record public.records;
begin
  if current_actor_id is null then
    raise exception 'record_creation_authentication_required'
      using errcode = '42501';
  end if;

  if current_actor_id is distinct from expected_actor_id then
    raise exception 'record_creation_actor_context_mismatch'
      using errcode = '42501';
  end if;

  if not private.can_manage_tenant(expected_business_id) then
    raise exception 'record_creation_owner_or_admin_required'
      using errcode = '42501';
  end if;

  /* Keep this lock order compatible with configuration application. */
  select head.*
  into current_head
  from public.business_configuration_heads as head
  where head.business_id = expected_business_id
  for share;
  if not found then
    raise exception 'record_creation_configuration_changed'
      using errcode = 'P0001';
  end if;

  if current_head.active_version_id is distinct from expected_base_version_id
    or current_head.head_revision is distinct from expected_head_revision then
    raise exception 'record_creation_configuration_changed'
      using errcode = 'P0001';
  end if;

  select object_definition.*
  into current_object
  from public.object_definitions as object_definition
  where object_definition.business_id = expected_business_id
    and object_definition.key = target_object_key
  for update;
  if not found then
    raise exception 'record_creation_object_not_found'
      using errcode = 'P0002';
  end if;

  current_eligibility := private.graph_record_creation_eligibility_v1(
    expected_business_id,
    current_object.id
  );
  if coalesce((current_eligibility ->> 'eligible')::boolean, false) = false then
    raise exception 'record_creation_object_ineligible'
      using errcode = '23514';
  end if;

  current_schema_digest := private.graph_record_creation_schema_checksum_v1(
    expected_business_id,
    current_object.id
  );
  if current_schema_digest is distinct from expected_object_schema_digest then
    raise exception 'record_creation_schema_changed'
      using errcode = 'P0001';
  end if;

  current_record_state_digest := private.graph_object_record_state_checksum_v1(
    expected_business_id,
    current_object.id
  );
  if current_record_state_digest is distinct from expected_record_state_digest then
    raise exception 'record_creation_state_changed'
      using errcode = 'P0001';
  end if;

  if jsonb_typeof(requested_data) <> 'object' then
    raise exception 'record_creation_data_invalid'
      using errcode = '22023';
  end if;

  insert into public.records (
    business_id,
    object_definition_id,
    data_json,
    record_status
  )
  values (
    expected_business_id,
    current_object.id,
    requested_data,
    'active'::public.graph_record_status
  )
  returning * into created_record;

  return created_record;
exception
  when unique_violation then
    raise exception 'record_creation_failed'
      using errcode = '23505';
end;
$$;

revoke all on function public.create_confirmed_graph_record(
  uuid,
  uuid,
  uuid,
  bigint,
  text,
  text,
  text,
  jsonb
) from public, anon, service_role;
grant execute on function public.create_confirmed_graph_record(
  uuid,
  uuid,
  uuid,
  bigint,
  text,
  text,
  text,
  jsonb
) to authenticated;

comment on function public.create_confirmed_graph_record(
  uuid,
  uuid,
  uuid,
  bigint,
  text,
  text,
  text,
  jsonb
) is
  'Creates one generic active Record after currentness, schema, eligibility and PII-free Record-state checks under the configuration-head then Object lock order.';
