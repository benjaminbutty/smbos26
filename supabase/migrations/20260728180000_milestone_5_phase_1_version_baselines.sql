alter table public.pages
  add column is_active boolean not null default true;

alter table public.preorder_experience_locations
  add column is_active boolean not null default true;

create index pages_business_audience_active_status_idx
  on public.pages(business_id, audience, is_active, status);

create index preorder_experience_locations_active_idx
  on public.preorder_experience_locations(
    business_id,
    preorder_experience_id,
    is_active
  );

create or replace function private.validate_experience_page()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and (
      new.business_id is distinct from old.business_id
      or new.key is distinct from old.key
    ) then
    raise exception 'Page business and key are immutable'
      using errcode = '22023';
  end if;

  if new.is_active then
    perform private.assert_valid_experience_page(
      new.business_id,
      new.audience,
      new.layout_json,
      new.status
    );
  else
    perform private.assert_valid_page_config_shape(new.layout_json);
  end if;

  return new;
end;
$$;

create or replace function private.ensure_experience_change_preserves_dependents()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  view_definition public.views;
  page_definition public.pages;
begin
  if tg_table_name = 'forms' then
    for view_definition in
      select configured_view.*
      from public.views as configured_view
      where configured_view.business_id = new.business_id
        and configured_view.is_active
        and (
          configured_view.config_json ->> 'create_form_key' = new.key
          or configured_view.config_json ->> 'edit_form_key' = new.key
        )
    loop
      perform private.assert_valid_experience_view(
        view_definition.business_id,
        view_definition.object_definition_id,
        view_definition.view_type,
        view_definition.config_json,
        view_definition.audience,
        view_definition.is_active
      );
    end loop;
  end if;

  for page_definition in
    select configured_page.*
    from public.pages as configured_page
    where configured_page.business_id = new.business_id
      and configured_page.is_active
      and exists (
        select 1
        from jsonb_array_elements(
          configured_page.layout_json -> 'blocks'
        ) as block
        where (
          tg_table_name = 'views'
          and block ->> 'type' = 'view'
          and block ->> 'view_key' = new.key
        ) or (
          tg_table_name = 'forms'
          and block ->> 'type' = 'form'
          and block ->> 'form_key' = new.key
        )
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

create or replace function private.ensure_preorder_change_preserves_pages()
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
      and configured_page.is_active
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

create or replace function private.validate_preorder_experience_location()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and (
      new.id is distinct from old.id
      or new.business_id is distinct from old.business_id
      or new.preorder_experience_id is distinct from old.preorder_experience_id
      or new.location_id is distinct from old.location_id
      or new.created_at is distinct from old.created_at
    ) then
    raise exception 'Allowed preorder Location identity is immutable'
      using errcode = '22023';
  end if;

  perform 1
  from public.preorder_experiences as experience
  where experience.business_id = new.business_id
    and experience.id = new.preorder_experience_id;
  if not found then
    raise exception 'Allowed Locations require a same-tenant preorder configuration'
      using errcode = '23514';
  end if;

  if new.is_active then
    perform 1
    from public.locations as location
    where location.business_id = new.business_id
      and location.id = new.location_id
      and location.is_active;
    if not found then
      raise exception 'Allowed preorder Locations must be active'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger preorder_experience_locations_validate
  on public.preorder_experience_locations;

create trigger preorder_experience_locations_validate
before insert or update on public.preorder_experience_locations
for each row execute function private.validate_preorder_experience_location();

create or replace function private.ensure_active_preorder_has_location()
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
      and allowed.is_active
  ) then
    raise exception 'Active preorder configuration requires a Location'
      using errcode = '23514';
  end if;

  return null;
end;
$$;

create or replace function public.resolve_public_page(
  requested_business_slug text,
  requested_page_slug text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'business',
    jsonb_build_object(
      'name',
      business.name,
      'slug',
      business.slug
    ),
    'page',
    jsonb_build_object(
      'key',
      page.key,
      'title',
      page.title,
      'slug',
      page.slug,
      'layout',
      page.layout_json
    )
  )
  from public.businesses as business
  join public.pages as page
    on page.business_id = business.id
  where business.slug = requested_business_slug
    and page.slug = requested_page_slug
    and page.audience = 'public'
    and page.status = 'published'
    and page.is_active
  limit 1;
$$;

alter function private.resolve_preorder_catalogue_at(
  text,
  text,
  text,
  timestamptz
) rename to resolve_preorder_catalogue_at_m4;

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
  business_id_value uuid;
  experience_id_value uuid;
  catalogue jsonb;
  active_locations jsonb;
  active_products jsonb;
begin
  select business.id, experience.id
  into business_id_value, experience_id_value
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

  catalogue := private.resolve_preorder_catalogue_at_m4(
    requested_business_slug,
    requested_page_slug,
    requested_preorder_key,
    reference_now
  );
  if catalogue is null then
    return null;
  end if;

  select coalesce(
    jsonb_agg(configured_location.value order by configured_location.ordinality),
    '[]'::jsonb
  )
  into active_locations
  from jsonb_array_elements(
    catalogue -> 'preorder' -> 'locations'
  ) with ordinality as configured_location(value, ordinality)
  where exists (
    select 1
    from public.preorder_experience_locations as allowed
    join public.locations as location
      on location.business_id = allowed.business_id
      and location.id = allowed.location_id
      and location.is_active
    where allowed.business_id = business_id_value
      and allowed.preorder_experience_id = experience_id_value
      and allowed.location_id = (configured_location.value ->> 'id')::uuid
      and allowed.is_active
  );

  select coalesce(
    jsonb_agg(
      jsonb_set(
        configured_product.value,
        '{location_ids}',
        configured_product.active_location_ids
      )
      order by configured_product.ordinality
    ),
    '[]'::jsonb
  )
  into active_products
  from (
    select
      product.value,
      product.ordinality,
      (
        select coalesce(
          jsonb_agg(to_jsonb(product_location.location_id) order by product_location.location_id),
          '[]'::jsonb
        )
        from (
          select (configured_location.value #>> '{}')::uuid as location_id
          from jsonb_array_elements(
            product.value -> 'location_ids'
          ) as configured_location(value)
          where exists (
            select 1
            from public.preorder_experience_locations as allowed
            join public.locations as location
              on location.business_id = allowed.business_id
              and location.id = allowed.location_id
              and location.is_active
            where allowed.business_id = business_id_value
              and allowed.preorder_experience_id = experience_id_value
              and allowed.location_id =
                (configured_location.value #>> '{}')::uuid
              and allowed.is_active
          )
        ) as product_location
      ) as active_location_ids
    from jsonb_array_elements(
      catalogue -> 'preorder' -> 'products'
    ) with ordinality as product(value, ordinality)
  ) as configured_product
  where jsonb_array_length(configured_product.active_location_ids) > 0;

  catalogue := jsonb_set(
    catalogue,
    '{preorder,locations}',
    active_locations
  );
  catalogue := jsonb_set(
    catalogue,
    '{preorder,products}',
    active_products
  );

  return catalogue;
end;
$$;

create or replace function public.resolve_public_preorder(
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

alter function public.submit_public_preorder(
  text,
  text,
  text,
  jsonb,
  text
) rename to submit_public_preorder_m4;

alter function public.submit_public_preorder_m4(
  text,
  text,
  text,
  jsonb,
  text
) set schema private;

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
  business_id_value uuid;
  experience_id_value uuid;
  requested_location_id uuid;
begin
  select business.id, experience.id
  into business_id_value, experience_id_value
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
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  begin
    requested_location_id := (submission ->> 'location_id')::uuid;
  exception
    when invalid_text_representation then
      return private.submit_public_preorder_m4(
        requested_business_slug,
        requested_page_slug,
        requested_preorder_key,
        submission,
        requested_request_hash
      );
  end;

  if requested_location_id is not null and not exists (
    select 1
    from public.preorder_experience_locations as allowed
    join public.locations as location
      on location.business_id = allowed.business_id
      and location.id = allowed.location_id
      and location.is_active
    where allowed.business_id = business_id_value
      and allowed.preorder_experience_id = experience_id_value
      and allowed.location_id = requested_location_id
      and allowed.is_active
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_location');
  end if;

  return private.submit_public_preorder_m4(
    requested_business_slug,
    requested_page_slug,
    requested_preorder_key,
    submission,
    requested_request_hash
  );
end;
$$;

create or replace function public.claim_preorder_confirmation_email(
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
    and page.is_active
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

create type public.configuration_version_kind as enum (
  'baseline',
  'change',
  'rollback'
);

create function private.configuration_snapshot_checksum_v1(snapshot jsonb)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(
    extensions.digest(convert_to(snapshot::text, 'UTF8'), 'sha256'),
    'hex'
  );
$$;

create function private.configuration_snapshot_v1(target_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  snapshot jsonb;
begin
  perform 1
  from public.businesses
  where id = target_business_id;
  if not found then
    raise exception 'Business not found'
      using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'schema_version',
    1,
    'object_definitions',
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', object_definition.id,
            'key', object_definition.key,
            'singular_label', object_definition.singular_label,
            'plural_label', object_definition.plural_label,
            'description', object_definition.description,
            'kind', object_definition.kind,
            'semantic_type', object_definition.semantic_type,
            'icon', object_definition.icon,
            'is_active', object_definition.is_active
          )
          order by object_definition.key collate "C"
        ),
        '[]'::jsonb
      )
      from public.object_definitions as object_definition
      where object_definition.business_id = target_business_id
    ),
    'field_definitions',
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', field_definition.id,
            'object_definition_id', field_definition.object_definition_id,
            'object_key', object_definition.key,
            'key', field_definition.key,
            'label', field_definition.label,
            'field_type', field_definition.field_type,
            'required', field_definition.required,
            'default_value', field_definition.default_value,
            'settings_json', field_definition.settings_json,
            'position', field_definition.position,
            'is_active', field_definition.is_active
          )
          order by
            object_definition.key collate "C",
            field_definition.position,
            field_definition.key collate "C"
        ),
        '[]'::jsonb
      )
      from public.field_definitions as field_definition
      join public.object_definitions as object_definition
        on object_definition.business_id = field_definition.business_id
        and object_definition.id = field_definition.object_definition_id
      where field_definition.business_id = target_business_id
    ),
    'relationship_definitions',
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', relationship_definition.id,
            'key', relationship_definition.key,
            'source_object_definition_id',
              relationship_definition.source_object_definition_id,
            'source_object_key', source_object.key,
            'target_object_definition_id',
              relationship_definition.target_object_definition_id,
            'target_object_key', target_object.key,
            'source_label', relationship_definition.source_label,
            'target_label', relationship_definition.target_label,
            'cardinality', relationship_definition.cardinality,
            'is_required', relationship_definition.is_required,
            'is_active', relationship_definition.is_active
          )
          order by relationship_definition.key collate "C"
        ),
        '[]'::jsonb
      )
      from public.relationship_definitions as relationship_definition
      join public.object_definitions as source_object
        on source_object.business_id = relationship_definition.business_id
        and source_object.id =
          relationship_definition.source_object_definition_id
      join public.object_definitions as target_object
        on target_object.business_id = relationship_definition.business_id
        and target_object.id =
          relationship_definition.target_object_definition_id
      where relationship_definition.business_id = target_business_id
    ),
    'views',
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', view_definition.id,
            'key', view_definition.key,
            'name', view_definition.name,
            'view_type', view_definition.view_type,
            'object_definition_id', view_definition.object_definition_id,
            'object_key', object_definition.key,
            'config_json', view_definition.config_json,
            'audience', view_definition.audience,
            'is_active', view_definition.is_active
          )
          order by view_definition.key collate "C"
        ),
        '[]'::jsonb
      )
      from public.views as view_definition
      join public.object_definitions as object_definition
        on object_definition.business_id = view_definition.business_id
        and object_definition.id = view_definition.object_definition_id
      where view_definition.business_id = target_business_id
    ),
    'forms',
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', form_definition.id,
            'key', form_definition.key,
            'name', form_definition.name,
            'object_definition_id', form_definition.object_definition_id,
            'object_key', object_definition.key,
            'mode', form_definition.mode,
            'config_json', form_definition.config_json,
            'audience', form_definition.audience,
            'is_active', form_definition.is_active
          )
          order by form_definition.key collate "C"
        ),
        '[]'::jsonb
      )
      from public.forms as form_definition
      join public.object_definitions as object_definition
        on object_definition.business_id = form_definition.business_id
        and object_definition.id = form_definition.object_definition_id
      where form_definition.business_id = target_business_id
    ),
    'pages',
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', page_definition.id,
            'key', page_definition.key,
            'title', page_definition.title,
            'slug', page_definition.slug,
            'audience', page_definition.audience,
            'layout_json', page_definition.layout_json,
            'status', page_definition.status,
            'is_active', page_definition.is_active
          )
          order by page_definition.key collate "C"
        ),
        '[]'::jsonb
      )
      from public.pages as page_definition
      where page_definition.business_id = target_business_id
    ),
    'preorder_experiences',
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', experience.id,
            'key', experience.key,
            'product_object_definition_id',
              experience.product_object_definition_id,
            'product_object_key', product_object.key,
            'customer_object_definition_id',
              experience.customer_object_definition_id,
            'customer_object_key', customer_object.key,
            'order_object_definition_id',
              experience.order_object_definition_id,
            'order_object_key', order_object.key,
            'order_item_object_definition_id',
              experience.order_item_object_definition_id,
            'order_item_object_key', order_item_object.key,
            'customer_places_order_relationship_definition_id',
              experience.customer_places_order_relationship_definition_id,
            'customer_places_order_relationship_key',
              customer_order_relationship.key,
            'order_contains_item_relationship_definition_id',
              experience.order_contains_item_relationship_definition_id,
            'order_contains_item_relationship_key',
              order_item_relationship.key,
            'product_appears_in_item_relationship_definition_id',
              experience.product_appears_in_item_relationship_definition_id,
            'product_appears_in_item_relationship_key',
              product_item_relationship.key,
            'config_json', experience.config_json,
            'is_active', experience.is_active
          )
          order by experience.key collate "C"
        ),
        '[]'::jsonb
      )
      from public.preorder_experiences as experience
      join public.object_definitions as product_object
        on product_object.business_id = experience.business_id
        and product_object.id = experience.product_object_definition_id
      join public.object_definitions as customer_object
        on customer_object.business_id = experience.business_id
        and customer_object.id = experience.customer_object_definition_id
      join public.object_definitions as order_object
        on order_object.business_id = experience.business_id
        and order_object.id = experience.order_object_definition_id
      join public.object_definitions as order_item_object
        on order_item_object.business_id = experience.business_id
        and order_item_object.id = experience.order_item_object_definition_id
      join public.relationship_definitions as customer_order_relationship
        on customer_order_relationship.business_id = experience.business_id
        and customer_order_relationship.id =
          experience.customer_places_order_relationship_definition_id
      join public.relationship_definitions as order_item_relationship
        on order_item_relationship.business_id = experience.business_id
        and order_item_relationship.id =
          experience.order_contains_item_relationship_definition_id
      join public.relationship_definitions as product_item_relationship
        on product_item_relationship.business_id = experience.business_id
        and product_item_relationship.id =
          experience.product_appears_in_item_relationship_definition_id
      where experience.business_id = target_business_id
    ),
    'preorder_experience_locations',
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', allowed.id,
            'preorder_experience_id', allowed.preorder_experience_id,
            'preorder_key', experience.key,
            'location_id', allowed.location_id,
            'is_active', allowed.is_active
          )
          order by experience.key collate "C", allowed.location_id
        ),
        '[]'::jsonb
      )
      from public.preorder_experience_locations as allowed
      join public.preorder_experiences as experience
        on experience.business_id = allowed.business_id
        and experience.id = allowed.preorder_experience_id
      where allowed.business_id = target_business_id
    )
  )
  into snapshot;

  return snapshot;
end;
$$;

create table public.configuration_versions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null
    references public.businesses(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  kind public.configuration_version_kind not null,
  parent_version_id uuid null,
  restored_from_version_id uuid null,
  source_change_set_id uuid null,
  snapshot_schema_version integer not null check (
    snapshot_schema_version > 0
  ),
  snapshot_json jsonb not null check (
    jsonb_typeof(snapshot_json) = 'object'
    and octet_length(snapshot_json::text) <= 1048576
  ),
  snapshot_checksum text not null check (
    snapshot_checksum ~ '^[a-f0-9]{64}$'
  ),
  created_by uuid null,
  created_at timestamptz not null default now(),
  unique (business_id, version_number),
  unique (business_id, id),
  constraint configuration_versions_tenant_parent_fkey
    foreign key (business_id, parent_version_id)
    references public.configuration_versions(business_id, id),
  constraint configuration_versions_tenant_restored_from_fkey
    foreign key (business_id, restored_from_version_id)
    references public.configuration_versions(business_id, id),
  constraint configuration_versions_snapshot_schema_matches
    check (
      snapshot_json ->> 'schema_version' =
        snapshot_schema_version::text
    ),
  constraint configuration_versions_checksum_matches
    check (
      snapshot_checksum =
        private.configuration_snapshot_checksum_v1(snapshot_json)
    ),
  constraint configuration_versions_kind_shape
    check (
      (
        kind = 'baseline'
        and version_number = 1
        and parent_version_id is null
        and restored_from_version_id is null
        and source_change_set_id is null
        and created_by is null
      )
      or (
        kind = 'change'
        and version_number > 1
        and parent_version_id is not null
        and restored_from_version_id is null
        and source_change_set_id is not null
        and created_by is not null
      )
      or (
        kind = 'rollback'
        and version_number > 1
        and parent_version_id is not null
        and restored_from_version_id is not null
        and source_change_set_id is not null
        and created_by is not null
      )
    )
);

create unique index configuration_versions_one_baseline_idx
  on public.configuration_versions(business_id)
  where kind = 'baseline';

create unique index configuration_versions_source_change_set_idx
  on public.configuration_versions(business_id, source_change_set_id)
  where source_change_set_id is not null;

create table public.business_configuration_heads (
  business_id uuid primary key
    references public.businesses(id) on delete cascade,
  active_version_id uuid not null,
  head_revision bigint not null default 1 check (head_revision > 0),
  updated_at timestamptz not null default now(),
  constraint business_configuration_heads_tenant_version_fkey
    foreign key (business_id, active_version_id)
    references public.configuration_versions(business_id, id)
    on delete cascade
);

create function private.reject_configuration_version_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Configuration versions are immutable'
    using errcode = '55000';
end;
$$;

create trigger configuration_versions_reject_update
before update on public.configuration_versions
for each row execute function private.reject_configuration_version_update();

create function private.reject_configuration_version_delete()
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
    raise exception 'Configuration versions cannot be deleted individually'
      using errcode = '55000';
  end if;

  return old;
end;
$$;

create trigger configuration_versions_reject_delete
before delete on public.configuration_versions
for each row execute function private.reject_configuration_version_delete();

create function private.protect_business_configuration_head()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.business_id is distinct from old.business_id then
    raise exception 'Configuration head identity cannot change'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger business_configuration_heads_protect_identity
before update on public.business_configuration_heads
for each row execute function private.protect_business_configuration_head();

create trigger business_configuration_heads_set_updated_at
before update on public.business_configuration_heads
for each row execute function private.set_updated_at();

create function private.initialize_business_configuration_baseline(
  target_business_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  snapshot jsonb;
  baseline_version_id uuid;
begin
  perform 1
  from public.businesses
  where id = target_business_id
  for share;
  if not found then
    raise exception 'Business not found'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.business_configuration_heads
    where business_id = target_business_id
  ) then
    return;
  end if;

  snapshot := private.configuration_snapshot_v1(target_business_id);

  insert into public.configuration_versions (
    business_id,
    version_number,
    kind,
    snapshot_schema_version,
    snapshot_json,
    snapshot_checksum
  )
  values (
    target_business_id,
    1,
    'baseline',
    1,
    snapshot,
    private.configuration_snapshot_checksum_v1(snapshot)
  )
  returning id into baseline_version_id;

  insert into public.business_configuration_heads (
    business_id,
    active_version_id,
    head_revision
  )
  values (
    target_business_id,
    baseline_version_id,
    1
  );
end;
$$;

create function private.initialize_new_business_configuration_baseline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.initialize_business_configuration_baseline(new.id);
  return new;
end;
$$;

create trigger businesses_initialize_configuration_baseline
after insert on public.businesses
for each row
execute function private.initialize_new_business_configuration_baseline();

do $$
declare
  business record;
begin
  for business in
    select configured_business.id
    from public.businesses as configured_business
    order by configured_business.id
  loop
    perform private.initialize_business_configuration_baseline(business.id);
  end loop;
end;
$$;

alter table public.configuration_versions enable row level security;
alter table public.business_configuration_heads enable row level security;

create policy "Owners and admins can read configuration versions"
on public.configuration_versions
for select
to authenticated
using (private.can_manage_tenant(business_id));

create policy "Owners and admins can read configuration heads"
on public.business_configuration_heads
for select
to authenticated
using (private.can_manage_tenant(business_id));

create policy "Owners and admins can update allowed preorder Locations"
on public.preorder_experience_locations
for update
to authenticated
using (private.can_manage_tenant(business_id))
with check (private.can_manage_tenant(business_id));

revoke all on table public.configuration_versions
  from anon, authenticated, service_role;
revoke all on table public.business_configuration_heads
  from anon, authenticated, service_role;

grant select on table public.configuration_versions
  to authenticated, service_role;
grant select on table public.business_configuration_heads
  to authenticated, service_role;

grant update on table public.preorder_experience_locations
  to authenticated;

grant usage on type public.configuration_version_kind
  to authenticated, service_role;

revoke all on function private.configuration_snapshot_v1(uuid)
  from public;
revoke all on function private.configuration_snapshot_checksum_v1(jsonb)
  from public;
revoke all on function private.initialize_business_configuration_baseline(uuid)
  from public;
revoke all on function private.initialize_new_business_configuration_baseline()
  from public;
revoke all on function private.resolve_preorder_catalogue_at_m4(
  text,
  text,
  text,
  timestamptz
) from public, anon, authenticated, service_role;
revoke all on function private.submit_public_preorder_m4(
  text,
  text,
  text,
  jsonb,
  text
) from public, anon, authenticated, service_role;
revoke all on function private.resolve_preorder_catalogue_at(
  text,
  text,
  text,
  timestamptz
) from public;
revoke all on function public.submit_public_preorder(
  text,
  text,
  text,
  jsonb,
  text
) from public;

grant execute on function public.submit_public_preorder(
  text,
  text,
  text,
  jsonb,
  text
) to service_role;

comment on table public.configuration_versions is
  'Immutable canonical Business configuration snapshots. Phase 1 creates baseline Version 1 only.';

comment on table public.business_configuration_heads is
  'The single active immutable configuration version pointer for each Business.';

comment on function private.configuration_snapshot_v1(uuid) is
  'Authoritative canonical schema-v1 configuration reader with explicit stable ordering.';

comment on function private.configuration_snapshot_checksum_v1(jsonb) is
  'Authoritative SHA-256 checksum over PostgreSQL canonical jsonb text.';

comment on function private.resolve_preorder_catalogue_at_m4(
  text,
  text,
  text,
  timestamptz
) is
  'Milestone 4 implementation retained privately behind the active-association Phase 1 boundary.';

comment on function private.submit_public_preorder_m4(
  text,
  text,
  text,
  jsonb,
  text
) is
  'Milestone 4 implementation retained privately behind the active-association Phase 1 boundary.';
