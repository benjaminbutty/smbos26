-- Sites remaining milestone: Customer-connected Forms, retained operational
-- actions and deterministic relationship locking.

alter table public.site_releases
  drop constraint if exists site_releases_projection_schema_version_check;
alter table public.site_releases
  add constraint site_releases_projection_schema_version_check
  check (projection_schema_version in (1, 2, 3, 4));

alter table public.site_releases
  drop constraint if exists site_releases_release_token_check;
alter table public.site_releases
  add constraint site_releases_release_token_check
  check (
    (projection_schema_version < 3 and release_token is null)
    or (
      projection_schema_version in (3, 4)
      and release_token is not null
      and release_token ~ '^s_[a-f0-9]{64}$'
    )
  );

create table if not exists public.site_release_actions_v4 (
  business_id uuid not null,
  release_id uuid not null,
  site_id uuid not null,
  action_key text not null check (action_key ~ '^o_[a-f0-9]{64}$'),
  release_token text not null check (release_token ~ '^s_[a-f0-9]{64}$'),
  action_kind text not null check (action_kind in ('booking', 'preorder')),
  source_page_id uuid null,
  booking_key text null check (
    booking_key is null or booking_key ~ '^[a-z][a-z0-9_]*$'
  ),
  preorder_experience_id uuid null,
  action_json jsonb not null check (
    jsonb_typeof(action_json) = 'object'
    and octet_length(action_json::text) <= 131072
  ),
  relationship_ids_json jsonb not null default '[]'::jsonb check (
    jsonb_typeof(relationship_ids_json) = 'array'
    and jsonb_array_length(relationship_ids_json) <= 32
  ),
  customer_binding_json jsonb not null default '{}'::jsonb check (
    jsonb_typeof(customer_binding_json) = 'object'
    and octet_length(customer_binding_json::text) <= 65536
  ),
  offer_json jsonb not null default '{}'::jsonb check (
    jsonb_typeof(offer_json) = 'object'
    and octet_length(offer_json::text) <= 65536
  ),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (business_id, release_id, action_key),
  unique (business_id, release_id, action_kind, source_page_id, booking_key,
    preorder_experience_id),
  constraint site_release_actions_v4_source_shape check (
    (action_kind = 'booking'
      and source_page_id is not null
      and booking_key is not null
      and preorder_experience_id is null)
    or (action_kind = 'preorder'
      and source_page_id is null
      and booking_key is null
      and preorder_experience_id is not null)
  ),
  foreign key (business_id, release_id)
    references public.site_releases(business_id, id) on delete cascade,
  foreign key (business_id, site_id)
    references public.site_states(business_id, id) on delete cascade,
  foreign key (business_id, source_page_id)
    references public.pages(business_id, id) on delete restrict,
  foreign key (business_id, preorder_experience_id)
    references public.preorder_experiences(business_id, id) on delete restrict
);

create index if not exists site_release_actions_v4_lookup_idx
  on public.site_release_actions_v4 (
    business_id, site_id, action_key, release_token
  );
create index if not exists site_release_actions_v4_source_idx
  on public.site_release_actions_v4 (
    business_id, action_kind, source_page_id, booking_key,
    preorder_experience_id
  );

alter table public.site_release_actions_v4 enable row level security;
revoke all on table public.site_release_actions_v4 from public, anon, authenticated;
grant all on table public.site_release_actions_v4 to service_role;

create or replace function private.site_release_action_immutable_v4()
returns trigger
language plpgsql
security definer
  set search_path = ''
as $$
begin
  raise exception 'site_release_action_immutable' using errcode = '55000';
end;
$$;

-- Stable Booking source identities belong to the durable Site draft, while
-- the historical Page grammar intentionally rejects Site-only keys.  Keep
-- the identity through autosave/CAS and strip only this validated metadata
-- before the C1 structural check; editor lifecycle metadata remains intact.
create or replace function private.site_strip_booking_source_metadata_block_v4(
  block jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  child jsonb;
  child_blocks jsonb := '[]'::jsonb;
  column_value jsonb;
  columns_value jsonb := '[]'::jsonb;
begin
  if block ->> 'type' = 'booking' then
    if block ? 'stable_source_page_id'
      and not private.site_valid_uuid_v1(block -> 'stable_source_page_id')
    then
      raise exception 'site_draft_invalid' using errcode = '22023';
    end if;
    return block - 'stable_source_page_id';
  end if;
  if block ->> 'type' = 'collapsible' then
    if jsonb_typeof(block -> 'blocks') is distinct from 'array' then
      return block;
    end if;
    for child in select value from jsonb_array_elements(block -> 'blocks') loop
      child_blocks := child_blocks || jsonb_build_array(
        private.site_strip_booking_source_metadata_block_v4(child)
      );
    end loop;
    return (block - 'blocks') || jsonb_build_object('blocks', child_blocks);
  end if;
  if block ->> 'type' = 'section' then
    if jsonb_typeof(block -> 'columns') is distinct from 'array' then
      return block;
    end if;
    for column_value in select value from jsonb_array_elements(block -> 'columns') loop
      if jsonb_typeof(column_value -> 'blocks') is distinct from 'array' then
        return block;
      end if;
      child_blocks := '[]'::jsonb;
      for child in select value from jsonb_array_elements(column_value -> 'blocks') loop
        child_blocks := child_blocks || jsonb_build_array(
          private.site_strip_booking_source_metadata_block_v4(child)
        );
      end loop;
      columns_value := columns_value || jsonb_build_array(
        (column_value - 'blocks') || jsonb_build_object('blocks', child_blocks)
      );
    end loop;
    return (block - 'columns') || jsonb_build_object('columns', columns_value);
  end if;
  return block;
end;
$$;

revoke all on function private.site_strip_booking_source_metadata_block_v4(jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.site_strip_booking_source_metadata_draft_v4(
  draft jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  page_value jsonb;
  block_value jsonb;
  blocks_value jsonb;
  pages_value jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(draft -> 'pages') is distinct from 'array' then
    return draft;
  end if;
  for page_value in select value from jsonb_array_elements(draft -> 'pages') loop
    if jsonb_typeof(page_value -> 'layout') is distinct from 'object'
      or jsonb_typeof(page_value -> 'layout' -> 'blocks') is distinct from 'array'
    then
      return draft;
    end if;
    blocks_value := '[]'::jsonb;
    for block_value in select value from jsonb_array_elements(page_value -> 'layout' -> 'blocks') loop
      blocks_value := blocks_value || jsonb_build_array(
        private.site_strip_booking_source_metadata_block_v4(block_value)
      );
    end loop;
    pages_value := pages_value || jsonb_build_array(
      (page_value - 'layout') || jsonb_build_object(
        'layout', (page_value -> 'layout') || jsonb_build_object(
          'blocks', blocks_value
        )
      )
    );
  end loop;
  return (draft - 'pages') || jsonb_build_object('pages', pages_value);
end;
$$;

revoke all on function private.site_strip_booking_source_metadata_draft_v4(jsonb)
  from public, anon, authenticated, service_role;

-- Keep the C3 draft boundary and Form shape checks unchanged, but make the
-- C1 structural input use the bounded Site-only metadata adapter above.
create or replace function private.site_assert_site_draft_c2(
  target_business_id uuid,
  draft jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  site_block record;
  form_value jsonb;
  structural_draft jsonb;
begin
  structural_draft := private.site_strip_booking_source_metadata_draft_v4(
    private.site_strip_forms_v3(
      private.site_strip_filter_draft_v2(
        private.site_strip_incomplete_detail_bindings_v2(draft)
      )
    )
  );
  perform private.assert_site_draft_v1(structural_draft);
  for site_block in select * from private.site_draft_blocks_v1(draft) loop
    if site_block.block ->> 'type' = 'collection' then
      perform private.site_assert_collection_filter_v2(
        target_business_id, site_block.block
      );
    end if;
  end loop;
  if draft ? 'forms' then
    if jsonb_typeof(draft -> 'forms') is distinct from 'array'
      or jsonb_array_length(draft -> 'forms') > 20
    then
      raise exception 'site_form_draft_invalid' using errcode = '22023';
    end if;
    for form_value in select value from jsonb_array_elements(draft -> 'forms') loop
      perform private.site_assert_form_draft_shape_v3(form_value);
    end loop;
  end if;
exception when invalid_text_representation then
  raise exception 'site_draft_invalid' using errcode = '22023';
end;
$$;

drop trigger if exists site_release_actions_v4_immutable
  on public.site_release_actions_v4;
create trigger site_release_actions_v4_immutable
before update or delete on public.site_release_actions_v4
for each row execute function private.site_release_action_immutable_v4();
revoke all on function private.site_release_action_immutable_v4()
  from public, anon, authenticated, service_role;

alter table public.site_release_actions_v3
  add column if not exists customer_binding_json jsonb not null default '{}'::jsonb;
alter table public.site_release_actions_v3
  drop constraint if exists site_release_actions_v3_customer_binding_check;
alter table public.site_release_actions_v3
  add constraint site_release_actions_v3_customer_binding_check
  check (jsonb_typeof(customer_binding_json) = 'object');

-- Receipt metadata is nullable for historical rows.  The immutable original
-- matching outcome and mutable owner resolution state live on the receipt.
do $$
declare
  receipt_table text;
begin
  foreach receipt_table in array array[
    'public_form_submissions', 'booking_submissions', 'preorder_submissions'
  ] loop
    execute format(
      'alter table %I add column if not exists source_page_id uuid,
       add column if not exists stable_source_key text,
       add column if not exists action_key text,
       add column if not exists release_id uuid,
       add column if not exists release_token text,
       add column if not exists canonical_submission jsonb,
       add column if not exists frozen_action_json jsonb,
       add column if not exists request_digest text,
       add column if not exists customer_match_identity text,
       add column if not exists customer_match_count integer,
       add column if not exists customer_candidate_ids uuid[],
       add column if not exists original_customer_record_id uuid,
       add column if not exists customer_record_id uuid,
       add column if not exists customer_resolution_state text,
       add column if not exists customer_resolution_revision bigint not null default 0,
       add column if not exists customer_resolution_actor_id uuid,
       add column if not exists customer_resolution_at timestamptz',
      receipt_table
    );
  end loop;
end;
$$;

create index if not exists public_form_submissions_customer_review_idx
  on public.public_form_submissions (
    business_id, customer_resolution_state, created_at
  ) where customer_resolution_state is not null;
create index if not exists booking_submissions_customer_review_idx
  on public.booking_submissions (
    business_id, customer_resolution_state, created_at
  ) where customer_resolution_state is not null;
create index if not exists preorder_submissions_customer_review_idx
  on public.preorder_submissions (
    business_id, customer_resolution_state, created_at
  ) where customer_resolution_state is not null;
drop index if exists public.booking_submissions_v4_idempotency_idx;
drop index if exists public.preorder_submissions_v4_idempotency_idx;
create unique index if not exists booking_submissions_v4_source_idempotency_idx
  on public.booking_submissions (business_id, stable_source_key, idempotency_token)
  where stable_source_key is not null;
create unique index if not exists preorder_submissions_v4_source_idempotency_idx
  on public.preorder_submissions (business_id, stable_source_key, idempotency_token)
  where stable_source_key is not null;

-- Relationship locks are deliberately read-only.  The member bridge retains
-- ordinary Staff RLS for graph writes while giving multi-edge callers one
-- deterministic definition lock order.
create or replace function private.lock_relationship_definitions_v1(
  expected_business_id uuid,
  requested_relationship_definition_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  relationship_id uuid;
  requested_count integer;
  distinct_count integer;
  locked_count integer;
begin
  if expected_business_id is null
    or requested_relationship_definition_ids is null
  then
    raise exception 'relationship_lock_invalid' using errcode = '22023';
  end if;
  requested_count := cardinality(requested_relationship_definition_ids);
  select count(*) into distinct_count
  from (
    select distinct value
    from unnest(requested_relationship_definition_ids) as item(value)
  ) as distinct_ids;
  if requested_count > 32
    or requested_count <> distinct_count
    or exists (
      select 1 from unnest(requested_relationship_definition_ids) as item(value)
      where value is null
    )
  then
    raise exception 'relationship_lock_invalid' using errcode = '22023';
  end if;
  for relationship_id in
    select value
    from unnest(requested_relationship_definition_ids) as item(value)
    order by value
  loop
    perform 1
    from public.relationship_definitions as relationship
    where relationship.business_id = expected_business_id
      and relationship.id = relationship_id
      and relationship.is_active
    for update;
    get diagnostics locked_count = row_count;
    if locked_count <> 1 then
      raise exception 'relationship_lock_unavailable' using errcode = 'P0002';
    end if;
  end loop;
end;
$$;

create or replace function private.lock_relationship_definitions_for_member_v1(
  expected_business_id uuid,
  requested_relationship_definition_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_business_member(expected_business_id) then
    raise exception 'business_membership_required' using errcode = '42501';
  end if;
  perform private.lock_relationship_definitions_v1(
    expected_business_id, requested_relationship_definition_ids
  );
end;
$$;

revoke all on function private.lock_relationship_definitions_v1(uuid, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function private.lock_relationship_definitions_for_member_v1(uuid, uuid[])
  from public, anon, service_role;
grant execute on function private.lock_relationship_definitions_for_member_v1(uuid, uuid[])
  to authenticated;

-- Normalize and choose an existing active Customer while holding one stable
-- tenant/email advisory lock.  The helper only returns bounded private
-- metadata; it never exposes a historical profile to an anonymous caller.
create or replace function private.resolve_site_customer_v1(
  target_business_id uuid,
  target_customer_object_id uuid,
  target_email_field_key text,
  supplied_email text,
  customer_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(supplied_email));
  candidate_ids uuid[];
  selected_id uuid;
  candidate_count integer := 0;
  customer_row public.records;
begin
  if normalized_email is null or normalized_email = ''
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or target_business_id is null or target_customer_object_id is null
    or target_email_field_key is null
    or jsonb_typeof(customer_data) is distinct from 'object'
  then
    raise exception 'site_customer_invalid' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_business_id::text || ':customer-email:' || normalized_email, 0
    )
  );
  select count(*)::integer
  into candidate_count
  from public.records as candidate
  where candidate.business_id = target_business_id
    and candidate.object_definition_id = target_customer_object_id
    and candidate.record_status = 'active'::public.graph_record_status
    and lower(btrim(candidate.data_json ->> target_email_field_key)) = normalized_email;
  select coalesce(array_agg(candidate.id order by candidate.created_at, candidate.id), '{}')
  into candidate_ids
  from (
    select candidate.id, candidate.created_at
    from public.records as candidate
    where candidate.business_id = target_business_id
      and candidate.object_definition_id = target_customer_object_id
      and candidate.record_status = 'active'::public.graph_record_status
      and lower(btrim(candidate.data_json ->> target_email_field_key)) = normalized_email
    order by candidate.created_at, candidate.id
    limit 8
  ) as candidate;
  if candidate_count > 0 then
    selected_id := candidate_ids[1];
    select * into customer_row
    from public.records
    where business_id = target_business_id
      and id = selected_id
      and object_definition_id = target_customer_object_id
      and lower(btrim(data_json ->> target_email_field_key)) = normalized_email
    for update;
    if not found or customer_row.record_status <> 'active'::public.graph_record_status then
      raise exception 'site_customer_changed' using errcode = '40001';
    end if;
  else
    perform private.assert_valid_graph_record_data(
      target_business_id, target_customer_object_id, customer_data
    );
    insert into public.records (
      business_id, object_definition_id, data_json
    ) values (
      target_business_id, target_customer_object_id, customer_data
    ) returning * into customer_row;
    selected_id := customer_row.id;
    candidate_ids := array[selected_id];
    candidate_count := 0;
  end if;
  return jsonb_build_object(
    'record_id', selected_id,
    'normalized_email', normalized_email,
    'match_count', candidate_count,
    'candidate_ids', to_jsonb(candidate_ids),
    'created', candidate_count = 0
  );
end;
$$;

revoke all on function private.resolve_site_customer_v1(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.site_public_operational_action_key_v4(
  target_site_id uuid,
  target_action_kind text,
  target_source_page_id uuid,
  target_booking_key text,
  target_preorder_experience_id uuid
)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'o_' || encode(
    extensions.digest(
      convert_to(
        target_site_id::text || ':' || target_action_kind || ':'
          || coalesce(target_source_page_id::text, '') || ':'
          || coalesce(target_booking_key, '') || ':'
          || coalesce(target_preorder_experience_id::text, ''),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function private.site_public_operational_action_key_v4(
  uuid, text, uuid, text, uuid
) from public, anon, authenticated, service_role;

-- A first Site placement may retain an existing canonical Booking Page as its
-- source.  Validate the complete source atomically from the trusted snapshot;
-- later amendments compare the immutable action's non-schedule definition so
-- an owner can change hours without borrowing another Page's identity.
create or replace function private.site_page_contains_booking_source_v4(
  value jsonb,
  requested_booking_key text,
  requested_config jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  child jsonb;
begin
  if jsonb_typeof(value) = 'object' then
    if value ->> 'type' = 'booking'
      and value ->> 'booking_key' = requested_booking_key
      and coalesce(value -> 'config', '{}'::jsonb)
          = coalesce(requested_config, '{}'::jsonb)
    then
      return true;
    end if;
    for child in select item.value from jsonb_each(value) as item(key, value) loop
      if private.site_page_contains_booking_source_v4(
        child, requested_booking_key, requested_config
      ) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(value) = 'array' then
    for child in select item.value from jsonb_array_elements(value) as item(value) loop
      if private.site_page_contains_booking_source_v4(
        child, requested_booking_key, requested_config
      ) then
        return true;
      end if;
    end loop;
  end if;
  return false;
end;
$$;

revoke all on function private.site_page_contains_booking_source_v4(
  jsonb, text, jsonb
) from public, anon, authenticated, service_role;

-- C3's public projector deliberately drops operational blocks.  v4 keeps a
-- small public atom (the friendly source key plus an opaque action address)
-- while all configuration and relationship details stay in the private row.
create or replace function private.site_public_project_block_v3(
  target_business_id uuid,
  target_site_id uuid,
  block jsonb,
  action_bundles jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  projected jsonb;
  child jsonb;
  child_projection jsonb;
  children jsonb := '[]'::jsonb;
  column_value jsonb;
  projected_columns jsonb := '[]'::jsonb;
  column_blocks jsonb := '[]'::jsonb;
  bundle jsonb;
begin
  if block ->> 'type' in ('booking', 'preorder') then
    if block ->> 'type' = 'booking' then
      return jsonb_build_object(
        'type', 'booking',
        'public_key', private.site_public_block_key_v2(
          target_site_id, (block ->> 'id')::uuid
        ),
        'booking_key', block ->> 'booking_key'
      );
    end if;
    return jsonb_build_object(
      'type', 'preorder',
      'public_key', private.site_public_block_key_v2(
        target_site_id, (block ->> 'id')::uuid
      ),
      'preorder_key', block ->> 'preorder_key'
    );
  end if;
  if block ->> 'type' = 'public_form' then
    select value into bundle
    from jsonb_array_elements(action_bundles) as item(value)
    where value ->> 'form_key' = block ->> 'form_key';
    if bundle is null then return null; end if;
    return jsonb_build_object(
      'type', 'form',
      'public_key', private.site_public_block_key_v2(
        target_site_id, (block ->> 'id')::uuid
      ),
      'action', bundle -> 'action'
    );
  end if;
  if block ->> 'type' = 'collapsible' then
    projected := private.site_public_project_block_v2(
      target_business_id, target_site_id, block
    );
    if projected is null then return null; end if;
    for child in select value from jsonb_array_elements(block -> 'blocks') loop
      child_projection := private.site_public_project_block_v3(
        target_business_id, target_site_id, child, action_bundles
      );
      if child_projection is not null then
        children := children || jsonb_build_array(child_projection);
      end if;
    end loop;
    return (projected - 'blocks') || jsonb_build_object('blocks', children);
  end if;
  if block ->> 'type' = 'section' then
    projected := private.site_public_project_block_v2(
      target_business_id, target_site_id, block
    );
    if projected is null then return null; end if;
    for column_value in select value from jsonb_array_elements(block -> 'columns') loop
      column_blocks := '[]'::jsonb;
      for child in select value from jsonb_array_elements(column_value -> 'blocks') loop
        child_projection := private.site_public_project_block_v3(
          target_business_id, target_site_id, child, action_bundles
        );
        if child_projection is not null then
          column_blocks := column_blocks || jsonb_build_array(child_projection);
        end if;
      end loop;
      projected_columns := projected_columns || jsonb_build_array(
        jsonb_build_object('blocks', column_blocks)
      );
    end loop;
    return (projected - 'columns') || jsonb_build_object(
      'columns', projected_columns
    );
  end if;
  return private.site_public_project_block_v2(
    target_business_id, target_site_id, block
  );
end;
$$;

revoke all on function private.site_public_project_block_v3(
  uuid, uuid, jsonb, jsonb
) from public, anon, authenticated, service_role;

create or replace function private.site_projection_contains_action_v3(
  value jsonb,
  requested_action_key text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  child jsonb;
begin
  if jsonb_typeof(value) = 'object' then
    if value ->> 'type' in ('form', 'booking', 'preorder')
      and value ->> 'action_key' = requested_action_key
    then
      return true;
    end if;
    if value ->> 'type' = 'form'
      and value -> 'action' ->> 'action_key' = requested_action_key
    then
      return true;
    end if;
    for child in select item.value from jsonb_each(value) as item(key, value) loop
      if private.site_projection_contains_action_v3(child, requested_action_key) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(value) = 'array' then
    for child in select item.value from jsonb_array_elements(value) as item(value) loop
      if private.site_projection_contains_action_v3(child, requested_action_key) then
        return true;
      end if;
    end loop;
  end if;
  return false;
end;
$$;

revoke all on function private.site_projection_contains_action_v3(jsonb, text)
  from public, anon, authenticated, service_role;

create or replace function private.site_project_operational_block_v4(
  block jsonb,
  operational_actions jsonb,
  target_release_token text
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  child jsonb;
  column_value jsonb;
  children jsonb := '[]'::jsonb;
  columns jsonb := '[]'::jsonb;
  action_value jsonb;
  next_block jsonb;
begin
  if block ->> 'type' in ('booking', 'preorder') then
    select value into action_value
    from jsonb_array_elements(coalesce(operational_actions, '[]'::jsonb)) as item(value)
    where (
        value ->> 'block_id' = block ->> 'id'
        or value ->> 'public_key' = block ->> 'public_key'
      )
      and value ->> 'kind' = block ->> 'type'
    limit 1;
    if action_value is null then return block; end if;
    return jsonb_strip_nulls(jsonb_build_object(
      'type', block ->> 'type',
      'public_key', block ->> 'public_key',
      case when block ->> 'type' = 'booking'
        then 'booking_key' else 'preorder_key' end,
      case when block ->> 'type' = 'booking'
        then block ->> 'booking_key' else block ->> 'preorder_key' end,
      'action_key', action_value ->> 'action_key',
      'release_token', target_release_token
    ));
  end if;
  if block ->> 'type' = 'collapsible' then
    for child in select value from jsonb_array_elements(
      coalesce(block -> 'blocks', '[]'::jsonb)
    ) loop
      children := children || jsonb_build_array(
        private.site_project_operational_block_v4(
          child, operational_actions, target_release_token
        )
      );
    end loop;
    return (block - 'blocks') || jsonb_build_object('blocks', children);
  end if;
  if block ->> 'type' = 'section' then
    for column_value in select value from jsonb_array_elements(
      coalesce(block -> 'columns', '[]'::jsonb)
    ) loop
      children := '[]'::jsonb;
      for child in select value from jsonb_array_elements(
        coalesce(column_value -> 'blocks', '[]'::jsonb)
      ) loop
        children := children || jsonb_build_array(
          private.site_project_operational_block_v4(
            child, operational_actions, target_release_token
          )
        );
      end loop;
      columns := columns || jsonb_build_array(
        (column_value - 'blocks') || jsonb_build_object('blocks', children)
      );
    end loop;
    return (block - 'columns') || jsonb_build_object('columns', columns);
  end if;
  return block;
end;
$$;

create or replace function private.site_project_operational_projection_v4(
  projection jsonb,
  operational_actions jsonb,
  target_release_token text
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  page_value jsonb;
  pages jsonb := '[]'::jsonb;
begin
  for page_value in select value from jsonb_array_elements(
    coalesce(projection -> 'pages', '[]'::jsonb)
  ) loop
    pages := pages || jsonb_build_array(
      (page_value - 'layout') || jsonb_build_object(
        'layout', jsonb_build_object(
          'blocks', (
            select coalesce(jsonb_agg(
              private.site_project_operational_block_v4(
                value, operational_actions, target_release_token
              )
            ), '[]'::jsonb)
            from jsonb_array_elements(
              coalesce(page_value -> 'layout' -> 'blocks', '[]'::jsonb)
            ) as item(value)
          )
        )
      )
    );
  end loop;
  -- The shared C3 builder emits a v3 projection.  v4 keeps that page
  -- grammar, but the release projection itself must carry the v4 marker so
  -- strict owner and public readers select the operational schema.
  return (projection - 'schema_version') || jsonb_build_object(
    'schema_version', 4,
    'pages', pages
  );
end;
$$;

revoke all on function private.site_project_operational_block_v4(jsonb, jsonb, text),
  private.site_project_operational_projection_v4(jsonb, jsonb, text)
  from public, anon, authenticated, service_role;

-- Legacy C2 validators intentionally reject operational blocks.  v4 keeps
-- that fail-closed boundary intact and removes only those blocks from the
-- private validation input; the original draft continues into Page/source
-- compilation and the immutable operational action rows below.
create or replace function private.site_strip_operational_block_for_legacy_checks_v4(
  block jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  child jsonb;
  column_value jsonb;
  child_blocks jsonb;
  columns_value jsonb := '[]'::jsonb;
  blocks_value jsonb := '[]'::jsonb;
begin
  if block is null or block ->> 'type' in ('booking', 'preorder') then
    return null;
  end if;
  if block ->> 'type' = 'collapsible' then
    for child in select value from jsonb_array_elements(
      coalesce(block -> 'blocks', '[]'::jsonb)
    ) loop
      child := private.site_strip_operational_block_for_legacy_checks_v4(child);
      if child is not null then
        blocks_value := blocks_value || jsonb_build_array(child);
      end if;
    end loop;
    return (block - 'blocks') || jsonb_build_object('blocks', blocks_value);
  end if;
  if block ->> 'type' = 'section' then
    for column_value in select value from jsonb_array_elements(
      coalesce(block -> 'columns', '[]'::jsonb)
    ) loop
      child_blocks := '[]'::jsonb;
      for child in select value from jsonb_array_elements(
        coalesce(column_value -> 'blocks', '[]'::jsonb)
      ) loop
        child := private.site_strip_operational_block_for_legacy_checks_v4(child);
        if child is not null then
          child_blocks := child_blocks || jsonb_build_array(child);
        end if;
      end loop;
      columns_value := columns_value || jsonb_build_array(
        (column_value - 'blocks') || jsonb_build_object('blocks', child_blocks)
      );
    end loop;
    return (block - 'columns') || jsonb_build_object('columns', columns_value);
  end if;
  return block;
end;
$$;

create or replace function private.site_strip_operational_blocks_for_legacy_checks_v4(
  draft jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  page_value jsonb;
  block jsonb;
  blocks_value jsonb;
  pages_value jsonb := '[]'::jsonb;
begin
  for page_value in select value from jsonb_array_elements(
    coalesce(draft -> 'pages', '[]'::jsonb)
  ) loop
    blocks_value := '[]'::jsonb;
    for block in select value from jsonb_array_elements(
      coalesce(page_value -> 'layout' -> 'blocks', '[]'::jsonb)
    ) loop
      block := private.site_strip_operational_block_for_legacy_checks_v4(block);
      if block is not null then
        blocks_value := blocks_value || jsonb_build_array(block);
      end if;
    end loop;
    pages_value := pages_value || jsonb_build_array(
      page_value || jsonb_build_object(
        'layout', (page_value -> 'layout') || jsonb_build_object(
          'blocks', blocks_value
        )
      )
    );
  end loop;
  return draft || jsonb_build_object('pages', pages_value);
end;
$$;

revoke all on function private.site_strip_operational_block_for_legacy_checks_v4(jsonb),
  private.site_strip_operational_blocks_for_legacy_checks_v4(jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.site_assert_operational_customer_cardinality_v4(
  target_business_id uuid,
  draft jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  site_block record;
  relation_key text;
  relation_row public.relationship_definitions;
  customer_object_id uuid;
  activity_object_id uuid;
  experience public.preorder_experiences;
begin
  for site_block in
    select draft_block.page_id, draft_block.block
    from private.site_draft_blocks_v1(draft) as draft_block
    where draft_block.block ->> 'type' in ('booking', 'preorder')
      and exists (
        select 1
        from jsonb_array_elements(draft -> 'pages') as included_page(value)
        where (included_page.value ->> 'id')::uuid = draft_block.page_id
          and coalesce((included_page.value ->> 'is_included')::boolean, true)
      )
  loop
    if site_block.block ->> 'type' = 'booking' then
      select object_definition.id into customer_object_id
      from public.object_definitions as object_definition
      where object_definition.business_id = target_business_id
        and object_definition.key = site_block.block -> 'config' ->> 'customer_object_key'
        and object_definition.is_active;
      select object_definition.id into activity_object_id
      from public.object_definitions as object_definition
      where object_definition.business_id = target_business_id
        and object_definition.key = site_block.block -> 'config' ->> 'booking_object_key'
        and object_definition.is_active;
      relation_key := site_block.block -> 'config' -> 'relationships' ->> 'customer_booking';
      select * into relation_row
      from public.relationship_definitions as relationship
      where relationship.business_id = target_business_id
        and relationship.key = relation_key
        and relationship.is_active;
    else
      select * into experience
      from public.preorder_experiences
      where business_id = target_business_id
        and key = site_block.block ->> 'preorder_key'
        and is_active;
      customer_object_id := experience.customer_object_definition_id;
      activity_object_id := experience.order_object_definition_id;
      select * into relation_row
      from public.relationship_definitions as relationship
      where relationship.business_id = target_business_id
        and relationship.id = experience.customer_places_order_relationship_definition_id
        and relationship.is_active;
    end if;
    if relation_row.id is null or customer_object_id is null
      or activity_object_id is null
      or not (
        (relation_row.source_object_definition_id = customer_object_id
          and relation_row.target_object_definition_id = activity_object_id
          and relation_row.cardinality in ('one_to_many', 'many_to_many'))
        or (relation_row.source_object_definition_id = activity_object_id
          and relation_row.target_object_definition_id = customer_object_id
          and relation_row.cardinality = 'many_to_many')
      ) then
      raise exception 'site_customer_relationship_cardinality_invalid'
        using errcode = '23514';
    end if;
  end loop;
end;
$$;
revoke all on function private.site_assert_operational_customer_cardinality_v4(uuid, jsonb)
  from public, anon, authenticated, service_role;


-- Extend the durable Form grammar with the finite Customer connection intent.
create or replace function private.site_assert_form_draft_shape_v3(
  form_value jsonb
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  question jsonb;
  condition jsonb;
  question_key_value text;
begin
  if jsonb_typeof(form_value) is distinct from 'object'
    or not private.site_json_has_only_keys_v1(
      form_value,
      array[
        'id', 'key', 'name', 'object_mode', 'object_key',
        'singular_label', 'plural_label', 'view_mode', 'view_key',
        'view_name', 'submit_label', 'customer_connection', 'questions'
      ]
    )
    or not private.site_valid_uuid_v1(form_value -> 'id')
    or jsonb_typeof(form_value -> 'key') is distinct from 'string'
    or jsonb_typeof(form_value -> 'name') is distinct from 'string'
    or jsonb_typeof(form_value -> 'object_mode') is distinct from 'string'
    or form_value ->> 'object_mode' not in ('existing', 'new')
    or jsonb_typeof(form_value -> 'object_key') is distinct from 'string'
    or jsonb_typeof(form_value -> 'view_mode') is distinct from 'string'
    or form_value ->> 'view_mode' not in ('existing', 'new')
    or jsonb_typeof(form_value -> 'questions') is distinct from 'array'
    or jsonb_array_length(form_value -> 'questions') > 50
    or not private.site_valid_optional_string_v1(form_value -> 'key', 80)
    or not private.site_valid_optional_string_v1(form_value -> 'name', 120)
    or not private.site_valid_optional_string_v1(form_value -> 'object_key', 80)
    or (form_value ? 'singular_label'
      and not private.site_valid_optional_string_v1(form_value -> 'singular_label', 120))
    or (form_value ? 'plural_label'
      and not private.site_valid_optional_string_v1(form_value -> 'plural_label', 120))
    or (form_value ? 'view_key'
      and not private.site_valid_optional_string_v1(form_value -> 'view_key', 80))
    or (form_value ? 'view_name'
      and not private.site_valid_optional_string_v1(form_value -> 'view_name', 120))
    or (form_value ? 'submit_label'
      and not private.site_valid_optional_string_v1(form_value -> 'submit_label', 120))
  then
    raise exception 'site_form_draft_invalid' using errcode = '22023';
  end if;

  if form_value ? 'customer_connection' then
    if jsonb_typeof(form_value -> 'customer_connection') is distinct from 'object'
      or not private.site_json_has_only_keys_v1(
        form_value -> 'customer_connection',
        array['enabled', 'customer_object_key', 'relationship_key',
          'email_field_key', 'mappings']
      )
      or (form_value -> 'customer_connection' ? 'enabled'
        and jsonb_typeof(form_value -> 'customer_connection' -> 'enabled')
          is distinct from 'boolean')
      or jsonb_typeof(form_value -> 'customer_connection' -> 'customer_object_key')
        is distinct from 'string'
      or jsonb_typeof(form_value -> 'customer_connection' -> 'relationship_key')
        is distinct from 'string'
      or jsonb_typeof(form_value -> 'customer_connection' -> 'email_field_key')
        is distinct from 'string'
      or not private.site_valid_optional_string_v1(
        form_value -> 'customer_connection' -> 'customer_object_key', 80
      )
      or not private.site_valid_optional_string_v1(
        form_value -> 'customer_connection' -> 'relationship_key', 80
      )
      or not private.site_valid_optional_string_v1(
        form_value -> 'customer_connection' -> 'email_field_key', 80
      )
      or (form_value -> 'customer_connection' ? 'mappings'
        and (jsonb_typeof(form_value -> 'customer_connection' -> 'mappings')
          is distinct from 'array'
          or jsonb_array_length(form_value -> 'customer_connection' -> 'mappings') > 50
          or exists (
            select 1
            from jsonb_array_elements(
              form_value -> 'customer_connection' -> 'mappings'
            ) as mapping(value)
            where jsonb_typeof(mapping.value) is distinct from 'object'
              or not private.site_json_has_only_keys_v1(
                mapping.value, array['customer_field_key', 'question_key', 'default_value']
              )
              or jsonb_typeof(mapping.value -> 'customer_field_key') is distinct from 'string'
              or jsonb_typeof(mapping.value -> 'question_key') is distinct from 'string'
              or not private.site_valid_optional_string_v1(
                mapping.value -> 'customer_field_key', 80
              )
              or not private.site_valid_optional_string_v1(
                mapping.value -> 'question_key', 80
              )
          )))
    then
      raise exception 'site_form_customer_connection_invalid' using errcode = '22023';
    end if;
  end if;

  for question in select value from jsonb_array_elements(form_value -> 'questions') loop
    if jsonb_typeof(question) is distinct from 'object'
      or not private.site_json_has_only_keys_v1(
        question,
        array[
          'id', 'key', 'label', 'help_text', 'field_type', 'required',
          'options', 'default_value', 'visible_when', 'upload_kind',
          'upload_count', 'field_mode'
        ]
      )
      or not private.site_valid_uuid_v1(question -> 'id')
      or jsonb_typeof(question -> 'key') is distinct from 'string'
      or jsonb_typeof(question -> 'label') is distinct from 'string'
      or not private.site_valid_optional_string_v1(question -> 'key', 80)
      or not private.site_valid_optional_string_v1(question -> 'label', 120)
      or (question ? 'help_text'
        and not private.site_valid_optional_string_v1(question -> 'help_text', 500))
      or question ->> 'field_type' not in (
        'short_text', 'long_text', 'number', 'currency', 'date',
        'datetime', 'email', 'phone', 'url', 'select', 'multi_select',
        'boolean', 'file', 'status'
      )
      or (question ? 'required'
        and jsonb_typeof(question -> 'required') is distinct from 'boolean')
      or (question ? 'options' and (
        jsonb_typeof(question -> 'options') is distinct from 'array'
        or jsonb_array_length(question -> 'options') > 50
        or exists (
          select 1
          from jsonb_array_elements(question -> 'options') as option(value)
          where jsonb_typeof(option.value) is distinct from 'string'
            or char_length(btrim(option.value #>> '{}')) > 120
        )
      ))
      or (question ? 'upload_kind'
        and (jsonb_typeof(question -> 'upload_kind') is distinct from 'string'
          or question ->> 'upload_kind' not in ('image', 'pdf')))
      or (question ? 'upload_count' and (
        jsonb_typeof(question -> 'upload_count') is distinct from 'number'
        or (question ->> 'upload_count') !~ '^[0-9]+$'
        or (question ->> 'upload_count')::integer not between 1 and 5
      ))
      or (question ? 'field_mode' and (
        jsonb_typeof(question -> 'field_mode') is distinct from 'string'
        or question ->> 'field_mode' not in ('existing', 'new')
      ))
    then
      raise exception 'site_form_question_invalid' using errcode = '22023';
    end if;

    if question ? 'visible_when' then
      condition := question -> 'visible_when';
      if jsonb_typeof(condition) is distinct from 'object'
        or not private.site_json_has_only_keys_v1(
          condition, array['field', 'operator', 'value']
        )
        or jsonb_typeof(condition -> 'field') is distinct from 'string'
        or not private.site_valid_optional_string_v1(condition -> 'field', 80)
        or condition ->> 'operator' not in ('equals', 'not_equals', 'includes')
        or jsonb_typeof(condition -> 'value') is null
        or jsonb_typeof(condition -> 'value') not in (
          'string', 'number', 'boolean'
        )
      then
        raise exception 'site_form_condition_invalid' using errcode = '22023';
      end if;
    end if;

    if question ? 'default_value'
      and octet_length((question -> 'default_value')::text) > 65536
    then
      raise exception 'site_form_default_too_large' using errcode = '22023';
    end if;
  end loop;

  if exists (
    select question_key
    from (
      select nullif(value ->> 'key', '') as question_key
      from jsonb_array_elements(form_value -> 'questions') as item(value)
    ) as keys
    where question_key is not null
    group by question_key
    having count(*) > 1
  ) then
    raise exception 'site_form_question_duplicate' using errcode = '22023';
  end if;
end;
$$;

-- Allow the canonical Form config to retain the finite Customer binding.
create or replace function private.assert_valid_form_config_shape(config jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  field_config jsonb;
  condition jsonb;
begin
  if jsonb_typeof(config) is distinct from 'object'
    or not private.experience_json_has_only_keys(
      config, array['fields', 'submit_label', 'customer_binding']
    )
    or jsonb_typeof(config -> 'fields') is distinct from 'array'
    or jsonb_array_length(config -> 'fields') not between 1 and 50
  then
    raise exception 'Invalid Form configuration' using errcode = '22023';
  end if;
  if config ? 'submit_label' and (
    jsonb_typeof(config -> 'submit_label') is distinct from 'string'
    or not private.experience_string_is_valid(config ->> 'submit_label', 120)
  ) then
    raise exception 'Invalid Form submit label' using errcode = '22023';
  end if;

  for field_config in select value from jsonb_array_elements(config -> 'fields') loop
    if jsonb_typeof(field_config) is distinct from 'object'
      or not private.experience_json_has_only_keys(
        field_config,
        array[
          'field', 'label', 'help_text', 'hidden', 'default_value',
          'required', 'visible_when', 'upload_kind', 'upload_count'
        ]
      )
      or jsonb_typeof(field_config -> 'field') is distinct from 'string'
      or not private.experience_key_is_valid(field_config ->> 'field')
      or (field_config ? 'label' and (
        jsonb_typeof(field_config -> 'label') is distinct from 'string'
        or not private.experience_string_is_valid(field_config ->> 'label', 120)
      ))
      or (field_config ? 'help_text' and (
        jsonb_typeof(field_config -> 'help_text') is distinct from 'string'
        or not private.experience_string_is_valid(field_config ->> 'help_text', 500)
      ))
      or (field_config ? 'hidden'
        and jsonb_typeof(field_config -> 'hidden') is distinct from 'boolean')
      or (field_config ? 'required'
        and jsonb_typeof(field_config -> 'required') is distinct from 'boolean')
      or (field_config ? 'upload_kind' and (
        jsonb_typeof(field_config -> 'upload_kind') is distinct from 'string'
        or field_config ->> 'upload_kind' not in ('image', 'pdf')
      ))
      or (field_config ? 'upload_count' and (
        jsonb_typeof(field_config -> 'upload_count') is distinct from 'number'
        or (field_config ->> 'upload_count') !~ '^[0-9]+$'
        or (field_config ->> 'upload_count')::integer not between 1 and 5
      ))
    then
      raise exception 'Invalid configured Form Field' using errcode = '22023';
    end if;

    if field_config ? 'visible_when' then
      condition := field_config -> 'visible_when';
      if jsonb_typeof(condition) is distinct from 'object'
        or not private.experience_json_has_only_keys(
          condition, array['field', 'operator', 'value']
        )
        or jsonb_typeof(condition -> 'field') is distinct from 'string'
        or not private.experience_key_is_valid(condition ->> 'field')
        or condition ->> 'operator' not in ('equals', 'not_equals', 'includes')
        or jsonb_typeof(condition -> 'value') not in (
          'string', 'number', 'boolean'
        )
      then
        raise exception 'Invalid Form visibility condition' using errcode = '22023';
      end if;
    end if;

    if coalesce((field_config ->> 'hidden')::boolean, false)
      and field_config ? 'visible_when'
    then
      raise exception 'Hidden Form Fields cannot have visibility conditions'
        using errcode = '23514';
    end if;

    if coalesce((field_config ->> 'hidden')::boolean, false)
      and (
        not (field_config ? 'default_value')
        or not private.graph_value_is_present(field_config -> 'default_value')
      )
    then
      raise exception 'Hidden Form Fields require a usable default value'
        using errcode = '23514';
    end if;

    if field_config ? 'upload_count' and not field_config ? 'upload_kind' then
      raise exception 'File upload count requires an upload kind'
        using errcode = '22023';
    end if;
  end loop;

  if (
    select count(*) from jsonb_array_elements(config -> 'fields')
  ) <> (
    select count(distinct value ->> 'field')
    from jsonb_array_elements(config -> 'fields') as item(value)
  ) then
    raise exception 'Form Fields cannot be configured more than once'
      using errcode = '22023';
  end if;
end;
$$;

-- Carry the Customer binding into the ordinary canonical Form operation.
create or replace function private.site_form_configuration_operations_v3(
  target_business_id uuid,
  draft jsonb,
  base_snapshot jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  form_value jsonb;
  question jsonb;
  object_value jsonb;
  field_value jsonb;
  view_value jsonb;
  base_for_form jsonb;
  form_fields jsonb := '[]'::jsonb;
  question_keys jsonb := '[]'::jsonb;
  view_fields jsonb := '[]'::jsonb;
  config_value jsonb;
  settings_value jsonb;
  operations jsonb := '[]'::jsonb;
  object_key_value text;
  question_key_value text;
  question_field_mode text;
  question_index bigint;
  append_position integer;
  effective_existing_object boolean;
  existing_view_field text;
  view_field_property text;
  view_columns jsonb := '[]'::jsonb;
begin
  for form_value in select value from jsonb_array_elements(
    coalesce(draft -> 'forms', '[]'::jsonb)
  ) where value ->> 'key' in (
    select form_key from private.site_reachable_form_keys_v3(draft)
  ) loop
    base_for_form := base_snapshot;
    if draft ->> '_c3_site_id' is not null then
      base_for_form := base_snapshot || jsonb_build_object(
        '_c3_site_id', draft ->> '_c3_site_id'
      );
    end if;
    perform private.site_assert_form_draft_ready_v3(
      target_business_id, form_value, base_for_form
    );
    perform private.site_assert_form_customer_binding_v1(
      target_business_id, form_value, base_for_form
    );
    object_key_value := btrim(form_value ->> 'object_key');
    select value into object_value
    from jsonb_array_elements(base_snapshot -> 'object_definitions') as item(value)
    where value ->> 'key' = object_key_value;
    effective_existing_object := object_value is not null;

    if form_value ->> 'object_mode' = 'new'
      and not effective_existing_object
    then
      operations := operations || jsonb_build_array(jsonb_build_object(
        'op', 'set_object',
        'key', object_key_value,
        'singular_label', btrim(form_value ->> 'singular_label'),
        'plural_label', btrim(form_value ->> 'plural_label'),
        'description', '',
        'icon', null,
        'is_active', true
      ));
    end if;

    if effective_existing_object then
      select coalesce(max((value ->> 'position')::integer) + 1, 0)
      into append_position
      from jsonb_array_elements(base_snapshot -> 'field_definitions') as item(value)
      where value ->> 'object_key' = object_key_value;
    else
      append_position := 0;
    end if;

    form_fields := '[]'::jsonb;
    question_keys := '[]'::jsonb;
    for question, question_index in
      select value, ordinality
      from jsonb_array_elements(form_value -> 'questions') with ordinality
    loop
      question_key_value := btrim(question ->> 'key');
      question_field_mode := coalesce(
        question ->> 'field_mode',
        case when effective_existing_object then 'existing' else 'new' end
      );
      settings_value := case
        when question ->> 'field_type' in ('select', 'multi_select', 'status')
          then jsonb_build_object(
            'options', private.site_form_choice_options_v3(
              question -> 'options'
            )
          )
        else '{}'::jsonb
      end;
      field_value := private.configuration_candidate_field_v1(
        base_snapshot, object_key_value, question_key_value
      );
      if question_field_mode = 'new' then
        operations := operations || jsonb_build_array(jsonb_build_object(
          'op', 'set_field',
          'object_key', object_key_value,
          'key', question_key_value,
          'label', btrim(question ->> 'label'),
          'field_type', question ->> 'field_type',
          -- Form requiredness may tighten this canonical Field later.  A
          -- newly authored question therefore remains a reusable optional
          -- Property in the shared graph.
          'required', false,
          'default_value', null,
          'settings_json', settings_value,
          'position', case
            when effective_existing_object then append_position
            else question_index - 1
          end,
          'is_active', true
        ));
        if effective_existing_object then
          append_position := append_position + 1;
        end if;
      elsif field_value is null then
        raise exception 'site_form_field_invalid' using errcode = '23514';
      end if;

      config_value := jsonb_build_object(
        'field', question_key_value,
        'label', btrim(question ->> 'label'),
        'hidden', false,
        'required', coalesce((question ->> 'required')::boolean, false)
      );
      if question ? 'help_text' and btrim(question ->> 'help_text') <> '' then
        config_value := config_value || jsonb_build_object(
          'help_text', btrim(question ->> 'help_text')
        );
      end if;
      if question ? 'default_value' then
        config_value := config_value || jsonb_build_object(
          'default_value', question -> 'default_value'
        );
      end if;
      if question ? 'visible_when' then
        config_value := config_value || jsonb_build_object(
          'visible_when', question -> 'visible_when'
        );
      end if;
      if question ? 'upload_kind' then
        config_value := config_value || jsonb_build_object(
          'upload_kind', question -> 'upload_kind'
        );
      end if;
      if question ? 'upload_count' then
        config_value := config_value || jsonb_build_object(
          'upload_count', question -> 'upload_count'
        );
      end if;
      form_fields := form_fields || jsonb_build_array(config_value);
      question_keys := question_keys || jsonb_build_array(question_key_value);
    end loop;

    config_value := jsonb_build_object('fields', form_fields);
    if form_value ? 'submit_label' and btrim(form_value ->> 'submit_label') <> '' then
      config_value := config_value || jsonb_build_object(
        'submit_label', btrim(form_value ->> 'submit_label')
      );
    end if;
    if form_value ? 'customer_connection' then
      config_value := config_value || jsonb_build_object(
        'customer_binding', form_value -> 'customer_connection'
      );
    end if;
    operations := operations || jsonb_build_array(jsonb_build_object(
      'op', 'set_form',
      'key', btrim(form_value ->> 'key'),
      'name', btrim(form_value ->> 'name'),
      'object_key', object_key_value,
      'mode', 'create',
      'config_json', config_value,
      'audience', 'public',
      'is_active', true
    ));

    if form_value ->> 'view_mode' = 'new' then
      select value into view_value
      from jsonb_array_elements(base_snapshot -> 'views') as item(value)
      where value ->> 'key' = form_value ->> 'view_key';
    else
      select value into view_value
      from jsonb_array_elements(base_snapshot -> 'views') as item(value)
      where value ->> 'key' = form_value ->> 'view_key';
    end if;

    if view_value is null then
      operations := operations || jsonb_build_array(jsonb_build_object(
        'op', 'set_view',
        'key', btrim(form_value ->> 'view_key'),
        'name', btrim(form_value ->> 'view_name'),
        'view_type', 'table',
        'object_key', object_key_value,
        'config_json', jsonb_build_object(
          'fields', question_keys,
          -- The destination is the ordinary internal Table for submitted
          -- Records.  Public Forms are a separate audience boundary and
          -- cannot be used as an internal View's create Form.
          'title_field', question_keys -> 0,
          'include_archived', false
        ),
        'audience', 'internal',
          'is_active', true
      ));
    else
      view_field_property := case view_value ->> 'view_type'
        when 'table' then 'fields'
        when 'detail' then 'fields'
        when 'list' then 'secondary_fields'
        when 'cards' then 'supporting_fields'
        else null
      end;
      if view_field_property is null then
        raise exception 'site_form_view_invalid' using errcode = '23514';
      end if;
      view_fields := coalesce(
        view_value -> 'config_json' -> view_field_property,
        '[]'::jsonb
      );
      view_columns := coalesce(
        view_value -> 'config_json' -> 'columns',
        '[]'::jsonb
      );
      for existing_view_field in
        select value #>> '{}'
        from jsonb_array_elements(question_keys) as item(value)
      loop
        if not exists (
          select 1 from jsonb_array_elements(view_fields) as item(value)
          where value #>> '{}' = existing_view_field
        ) then
          view_fields := view_fields || to_jsonb(existing_view_field);
        end if;
        if jsonb_typeof(view_value -> 'config_json' -> 'columns') = 'array'
          and not exists (
            select 1
            from jsonb_array_elements(view_columns) as item(value)
            where value ->> 'kind' = 'field'
              and value ->> 'field_key' = existing_view_field
          )
        then
          view_columns := view_columns || jsonb_build_array(jsonb_build_object(
            'kind', 'field',
            'field_key', existing_view_field
          ));
        end if;
      end loop;
      if view_fields <> coalesce(
        view_value -> 'config_json' -> view_field_property, '[]'::jsonb
      ) or (
        jsonb_typeof(view_value -> 'config_json' -> 'columns') = 'array'
        and view_columns <> view_value -> 'config_json' -> 'columns'
      ) then
        config_value := coalesce(view_value -> 'config_json', '{}'::jsonb)
          || jsonb_build_object(view_field_property, view_fields);
        if jsonb_typeof(view_value -> 'config_json' -> 'columns') = 'array' then
          config_value := config_value || jsonb_build_object(
            'columns', view_columns
          );
        end if;
        operations := operations || jsonb_build_array(jsonb_build_object(
          'op', 'set_view',
          'key', view_value ->> 'key',
          'name', view_value ->> 'name',
          'view_type', view_value ->> 'view_type',
          'object_key', object_key_value,
          'config_json', config_value,
          'audience', view_value ->> 'audience',
          'is_active', coalesce((view_value ->> 'is_active')::boolean, true)
        ));
      end if;
    end if;
  end loop;
  return operations;
end;
$$;

-- Validate the Customer connection before canonical operations are emitted.
-- A reusable Customer is the source of a one-to-many Relationship to the
-- activity.  A reverse activity-to-Customer binding is accepted only for a
-- many-to-many Relationship.
create or replace function private.site_assert_form_customer_binding_v1(
  target_business_id uuid,
  form_value jsonb,
  base_snapshot jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  binding jsonb := form_value -> 'customer_connection';
  customer_object jsonb;
  relationship jsonb;
  email_field jsonb;
  customer_field jsonb;
  mapping jsonb;
  mapped_question jsonb;
  mapped_keys text[] := '{}';
  mapped_question_keys text[] := '{}';
  activity_key text := btrim(form_value ->> 'object_key');
  customer_key text;
  relationship_key_value text;
  email_key text;
  mapping_key text;
begin
  if binding is null or not coalesce((binding ->> 'enabled')::boolean, true) then
    return;
  end if;
  customer_key := btrim(binding ->> 'customer_object_key');
  relationship_key_value := btrim(binding ->> 'relationship_key');
  email_key := btrim(binding ->> 'email_field_key');
  select value into customer_object
  from jsonb_array_elements(base_snapshot -> 'object_definitions') as item(value)
  where value ->> 'key' = customer_key
    and coalesce((value ->> 'is_active')::boolean, false);
  if customer_object is null then
    raise exception 'site_customer_object_invalid' using errcode = '23514';
  end if;
  select value into relationship
  from jsonb_array_elements(base_snapshot -> 'relationship_definitions') as item(value)
  where value ->> 'key' = relationship_key_value
    and coalesce((value ->> 'is_active')::boolean, false);
  if relationship is null
    or not (
      (relationship ->> 'source_object_key' = customer_key
        and relationship ->> 'target_object_key' = activity_key
        and relationship ->> 'cardinality' in ('one_to_many', 'many_to_many'))
      or (relationship ->> 'source_object_key' = activity_key
        and relationship ->> 'target_object_key' = customer_key
        and relationship ->> 'cardinality' = 'many_to_many')
    )
  then
    raise exception 'site_customer_relationship_invalid' using errcode = '23514';
  end if;
  select value into email_field
  from jsonb_array_elements(base_snapshot -> 'field_definitions') as item(value)
  where value ->> 'object_key' = customer_key
    and value ->> 'key' = email_key
    and value ->> 'field_type' = 'email'
    and coalesce((value ->> 'is_active')::boolean, false);
  if email_field is null then
    raise exception 'site_customer_email_field_invalid' using errcode = '23514';
  end if;
  for mapping in select value from jsonb_array_elements(
    coalesce(binding -> 'mappings', '[]'::jsonb)
  ) loop
    mapping_key := btrim(mapping ->> 'customer_field_key');
    if mapping_key = any(mapped_keys) then
      raise exception 'site_customer_mapping_duplicate' using errcode = '23514';
    end if;
    mapped_keys := array_append(mapped_keys, mapping_key);
    mapped_question_keys := array_append(
      mapped_question_keys, btrim(mapping ->> 'question_key')
    );
    select value into customer_field
    from jsonb_array_elements(base_snapshot -> 'field_definitions') as item(value)
    where value ->> 'object_key' = customer_key
      and value ->> 'key' = mapping_key
      and coalesce((value ->> 'is_active')::boolean, false);
    if customer_field is null then
      raise exception 'site_customer_mapping_invalid' using errcode = '23514';
    end if;
    if nullif(btrim(mapping ->> 'question_key'), '') is not null then
      select value into mapped_question
      from jsonb_array_elements(form_value -> 'questions') as item(value)
      where value ->> 'key' = btrim(mapping ->> 'question_key');
      if mapped_question is null
        or not (
          mapped_question ->> 'field_type'
            = customer_field ->> 'field_type'
          or (
            mapped_question ->> 'field_type' in ('short_text', 'long_text')
            and customer_field ->> 'field_type' in ('short_text', 'long_text')
          )
        )
      then
        raise exception 'site_customer_mapping_invalid' using errcode = '23514';
      end if;
      if coalesce((customer_field ->> 'required')::boolean, false)
        and not (mapping ? 'default_value')
        and (
          not coalesce((mapped_question ->> 'required')::boolean, false)
          or mapped_question ? 'visible_when'
        )
      then
        raise exception 'site_customer_required_mapping_missing'
          using errcode = '23514';
      end if;
    elsif not (mapping ? 'default_value')
      or not private.graph_value_is_present(mapping -> 'default_value')
    then
      raise exception 'site_customer_mapping_invalid' using errcode = '23514';
    end if;
    if mapping ? 'default_value'
      and not private.graph_field_value_is_valid(
        mapping -> 'default_value',
        (customer_field ->> 'field_type')::public.graph_field_type,
        customer_field -> 'settings_json'
      )
    then
      raise exception 'site_customer_mapping_invalid' using errcode = '23514';
    end if;
  end loop;
  if not (email_key = any(mapped_keys)) then
    -- The email answer may be supplied by a question with the configured
    -- email property key, or through a valid Customer default.
    if not exists (
      select 1 from jsonb_array_elements(form_value -> 'questions') as item(value)
      where value ->> 'key' = email_key and value ->> 'field_type' = 'email'
    ) then
      raise exception 'site_customer_email_mapping_missing' using errcode = '23514';
    end if;
  else
    select value into mapped_question
    from jsonb_array_elements(coalesce(binding -> 'mappings', '[]'::jsonb)) as item(value)
    where value ->> 'customer_field_key' = email_key;
    if mapped_question is null
      or nullif(btrim(mapped_question ->> 'question_key'), '') is null
      or not exists (
        select 1
        from jsonb_array_elements(form_value -> 'questions') as item(value)
        where value ->> 'key' = btrim(mapped_question ->> 'question_key')
          and value ->> 'field_type' = 'email'
      )
    then
      raise exception 'site_customer_email_mapping_missing' using errcode = '23514';
    end if;
  end if;
  for customer_field in
    select value
    from jsonb_array_elements(base_snapshot -> 'field_definitions') as item(value)
    where value ->> 'object_key' = customer_key
      and coalesce((value ->> 'is_active')::boolean, false)
      and coalesce((value ->> 'required')::boolean, false)
  loop
    if (customer_field ->> 'key') <> all(mapped_keys)
      and (
        customer_field -> 'default_value' is null
        or customer_field -> 'default_value' = 'null'::jsonb
        or not private.graph_value_is_present(customer_field -> 'default_value')
      )
    then
      raise exception 'site_customer_required_mapping_missing' using errcode = '23514';
    end if;
  end loop;
end;
$$;

revoke all on function private.site_assert_form_customer_binding_v1(uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;

-- Retain the private Customer binding with each immutable Form action.
create or replace function private.site_build_form_action_bundle_v3(
  target_site_id uuid,
  target_release_id uuid,
  target_release_token text,
  candidate_snapshot jsonb,
  form_key_value text,
  view_key_value text
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  form_value jsonb;
  field_value jsonb;
  field_config jsonb;
  question_value jsonb;
  binding_value jsonb;
  action_questions jsonb := '[]'::jsonb;
  field_bindings jsonb := '[]'::jsonb;
  object_id_value uuid;
  form_id_value uuid;
  view_id_value uuid;
  object_key_value text;
  field_key_value text;
  action_key_value text;
  submit_label_value text;
  question_required boolean;
  options_value jsonb;
begin
  select value into form_value
  from jsonb_array_elements(candidate_snapshot -> 'forms') as item(value)
  where value ->> 'key' = form_key_value;
  if form_value is null
    or form_value ->> 'mode' <> 'create'
    or form_value ->> 'audience' <> 'public'
    or not coalesce((form_value ->> 'is_active')::boolean, false)
  then
    raise exception 'site_form_candidate_invalid' using errcode = '23514';
  end if;

  select value into field_config
  from jsonb_array_elements(candidate_snapshot -> 'views') as item(value)
  where value ->> 'key' = view_key_value;
  if field_config is null
    or field_config ->> 'object_key' <> form_value ->> 'object_key'
    or not coalesce((field_config ->> 'is_active')::boolean, false)
  then
    raise exception 'site_form_candidate_view_invalid' using errcode = '23514';
  end if;
  view_id_value := (field_config ->> 'id')::uuid;

  form_id_value := (form_value ->> 'id')::uuid;
  object_id_value := (form_value ->> 'object_definition_id')::uuid;
  object_key_value := form_value ->> 'object_key';
  action_key_value := private.site_public_form_action_key_v3(
    target_site_id, form_id_value
  );
  submit_label_value := form_value -> 'config_json' ->> 'submit_label';

  for field_config in
    select value from jsonb_array_elements(form_value -> 'config_json' -> 'fields')
  loop
    field_key_value := field_config ->> 'field';
    field_value := private.configuration_candidate_field_v1(
      candidate_snapshot, object_key_value, field_key_value
    );
    if field_value is null
      or not coalesce((field_value ->> 'is_active')::boolean, false)
    then
      raise exception 'site_form_candidate_field_invalid' using errcode = '23514';
    end if;
    question_required := coalesce((field_value ->> 'required')::boolean, false)
      or coalesce((field_config ->> 'required')::boolean, false);
    question_value := jsonb_build_object(
      'key', field_key_value,
      'label', coalesce(field_config ->> 'label', field_value ->> 'label'),
      'field_type', field_value ->> 'field_type',
      'required', question_required
    );
    if field_config ? 'help_text' then
      question_value := question_value || jsonb_build_object(
        'help_text', field_config -> 'help_text'
      );
    end if;
    options_value := field_value -> 'settings_json' -> 'options';
    if jsonb_typeof(options_value) = 'array'
      and field_value ->> 'field_type' in ('select', 'multi_select', 'status')
    then
      question_value := question_value || jsonb_build_object(
        'options', options_value
      );
    end if;
    if field_config ? 'visible_when' then
      question_value := question_value || jsonb_build_object(
        'visible_when', field_config -> 'visible_when'
      );
    end if;
    if field_config ? 'upload_kind' then
      question_value := question_value || jsonb_build_object(
        'upload_kind', field_config -> 'upload_kind'
      );
      question_value := question_value || jsonb_build_object(
        'upload_count', coalesce(field_config -> 'upload_count', '1'::jsonb)
      );
    end if;
    if not coalesce((field_config ->> 'hidden')::boolean, false) then
      action_questions := action_questions || jsonb_build_array(question_value);
    end if;
    binding_value := jsonb_build_object(
      'question_key', field_key_value,
      'field_key', field_key_value,
      'field_id', field_value ->> 'id',
      'object_id', field_value ->> 'object_definition_id',
      'field_type', field_value ->> 'field_type',
      'canonical_required', coalesce((field_value ->> 'required')::boolean, false),
      'form_required', coalesce((field_config ->> 'required')::boolean, false),
      'required', question_required,
      'settings_json', field_value -> 'settings_json',
      'default_value', field_value -> 'default_value',
      'form_default_value', coalesce(field_config -> 'default_value', 'null'::jsonb),
      'hidden', coalesce((field_config ->> 'hidden')::boolean, false),
      'visible_when', coalesce(field_config -> 'visible_when', 'null'::jsonb),
      'upload_kind', coalesce(field_config -> 'upload_kind', 'null'::jsonb),
      'upload_count', coalesce(field_config -> 'upload_count', 'null'::jsonb)
    );
    field_bindings := field_bindings || jsonb_build_array(binding_value);
  end loop;

  return jsonb_build_object(
    'form_key', form_key_value,
    'form_id', form_id_value,
    'object_definition_id', object_id_value,
    'view_key', view_key_value,
    'view_id', view_id_value,
    'action_key', action_key_value,
    'release_token', target_release_token,
    'action', jsonb_build_object(
      'release_token', target_release_token,
      'action_key', action_key_value,
      'form_name', form_value -> 'name',
      'questions', action_questions
    ) || case
      when submit_label_value is null or btrim(submit_label_value) = ''
        then '{}'::jsonb
      else jsonb_build_object('submit_label', submit_label_value)
    end,
    'bindings', field_bindings,
    -- Prepare receives the durable Site draft shape (`customer_connection`),
    -- while a re-prepared canonical form may already carry the same value
    -- under `config_json.customer_binding`.  Freeze either source here so
    -- both v3 and v4 publishers retain the binding in their action row.
    'customer_binding', coalesce(
      form_value -> 'config_json' -> 'customer_binding',
      form_value -> 'customer_connection',
      '{}'::jsonb
    )
  );
end;
$$;
-- Expose the private canonical Customer binding to trusted submitters only.
create or replace function private.resolve_site_public_form_action_v3(
  requested_business_slug text,
  requested_page_slug text,
  requested_action_key text,
  requested_release_token text,
  for_write boolean
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
  page_id_value uuid;
  form_id_value uuid;
  object_id_value uuid;
  business_name_value text;
  page_value jsonb;
  draft_page jsonb;
  action_row public.site_release_actions_v3;
  state_row public.site_states;
  release_row public.site_releases;
  head_row public.business_configuration_heads;
  form_row public.forms;
  object_row public.object_definitions;
  view_row public.views;
  field_row public.field_definitions;
  binding jsonb;
  configured_field jsonb;
  action_question jsonb;
  binding_key text;
  visible_when_value jsonb;
  expected_visible_when jsonb;
  expected_required boolean;
  expected_hidden boolean;
  configured_count integer;
begin
  if requested_business_slug is null
    or requested_business_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or requested_page_slug is null
    or requested_page_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or requested_action_key is null
    or requested_action_key !~ '^a_[a-f0-9]{64}$'
    or requested_release_token is null
    or requested_release_token !~ '^s_[a-f0-9]{64}$'
  then
    if for_write then raise exception 'site_form_action_unavailable' using errcode = 'P0002'; end if;
    return null;
  end if;

  select business.id, business.name
  into business_id_value, business_name_value
  from public.businesses as business
  where business.slug = requested_business_slug;
  if business_id_value is null then
    if for_write then raise exception 'site_form_action_unavailable' using errcode = 'P0002'; end if;
    return null;
  end if;
  if for_write then
    -- Match the C2 configuration application order: the immutable active
    -- head is shared-locked before Business, Site or release rows.
    select * into head_row
    from public.business_configuration_heads
    where business_id = business_id_value
    for share;
    if head_row.business_id is null then
      raise exception 'site_form_action_unavailable' using errcode = 'P0002';
    end if;
  end if;
  if for_write then
    perform 1 from public.businesses where id = business_id_value for update;
  end if;

  select * into state_row
  from public.site_states
  where business_id = business_id_value
    and migration_state = 'adopted';
  if for_write then
    if state_row.id is null then
      raise exception 'site_form_action_unavailable' using errcode = 'P0002';
    end if;
    select * into state_row
    from public.site_states
    where business_id = business_id_value and id = state_row.id
    for update;
  end if;
  if state_row.id is null or state_row.active_release_id is null then
    if for_write then raise exception 'site_form_action_unavailable' using errcode = 'P0002'; end if;
    return null;
  end if;
  site_id_value := state_row.id;
  release_id_value := state_row.active_release_id;

  select * into release_row
  from public.site_releases
  where business_id = business_id_value
    and site_id = site_id_value
    and id = release_id_value
    and status = 'published'
    and projection_schema_version in (3, 4)
    and release_token = requested_release_token;
  if for_write then
    if release_row.id is null then
      raise exception 'site_form_action_unavailable' using errcode = 'P0002';
    end if;
    select * into release_row
    from public.site_releases
    where business_id = business_id_value and id = release_id_value
    for update;
  end if;
  if release_row.id is null
    or release_row.release_token is distinct from requested_release_token
    or release_row.status <> 'published'
    or release_row.projection_schema_version not in (3, 4)
  then
    if for_write then raise exception 'site_form_action_unavailable' using errcode = 'P0002'; end if;
    return null;
  end if;

  select value into page_value
  from jsonb_array_elements(release_row.projection_json -> 'pages') as item(value)
  where value ->> 'slug' = requested_page_slug
    and private.site_projection_contains_action_v3(value, requested_action_key)
  limit 1;
  if page_value is null then
    if for_write then raise exception 'site_form_action_unavailable' using errcode = 'P0002'; end if;
    return null;
  end if;

  select * into action_row
  from public.site_release_actions_v3
  where business_id = business_id_value
    and release_id = release_id_value
    and action_key = requested_action_key
    and release_token = requested_release_token;
  if action_row.action_key is null then
    if for_write then raise exception 'site_form_action_unavailable' using errcode = 'P0002'; end if;
    return null;
  end if;
  form_id_value := action_row.form_id;
  object_id_value := action_row.object_definition_id;

  -- Resolve the canonical Page identity from retained immutable binding
  -- metadata.  The current unpublished draft may remove or replace a Page
  -- while its active release remains live, so it is never consulted here.
  select binding.canonical_page_id
  into page_id_value
  from public.site_page_bindings as binding
  where binding.business_id = business_id_value
    and binding.site_id = site_id_value
    and private.site_public_block_key_v2(
      site_id_value, binding.draft_page_id
    ) = page_value ->> 'public_key'
  order by binding.updated_at desc, binding.draft_page_id
  limit 1;
  if page_id_value is null then
    if for_write then raise exception 'site_form_action_unavailable' using errcode = 'P0002'; end if;
    return null;
  end if;

  select * into form_row
  from public.forms
  where business_id = business_id_value
    and id = form_id_value
    and object_definition_id = object_id_value
    and key = action_row.form_key
    and mode = 'create'
    and audience = 'public'
    and is_active;
  select * into object_row
  from public.object_definitions
  where business_id = business_id_value and id = object_id_value and is_active;
  select * into view_row
  from public.views
  where business_id = business_id_value
    and id = action_row.view_id
    and key = action_row.view_key
    and object_definition_id = object_id_value
    and is_active;
  if form_row.id is null or object_row.id is null or view_row.id is null then
    if for_write then raise exception 'site_form_action_unavailable' using errcode = 'P0002'; end if;
    return null;
  end if;
  if not private.site_public_form_required_fields_available_v3(
    business_id_value, object_id_value, action_row.field_bindings_json
  ) then
    if for_write then raise exception 'site_form_action_unavailable' using errcode = 'P0002'; end if;
    return null;
  end if;

  -- Compare only semantic bindings.  Labels and help text may change in a
  -- later canonical edit without rewriting this release's public bytes.
  for binding in select value from jsonb_array_elements(action_row.field_bindings_json) loop
    binding_key := binding ->> 'field_key';
    select * into field_row
    from public.field_definitions
    where business_id = business_id_value
      and id = (binding ->> 'field_id')::uuid
      and object_definition_id = object_id_value
      and key = binding_key
      and is_active;
    if field_row.id is null
      or field_row.field_type::text <> binding ->> 'field_type'
      or field_row.required is distinct from coalesce((binding ->> 'canonical_required')::boolean, false)
      or (field_row.field_type in ('select', 'multi_select', 'status')
        and field_row.settings_json -> 'options' is distinct from binding -> 'settings_json' -> 'options')
      or coalesce(field_row.default_value, 'null'::jsonb)
          is distinct from coalesce(binding -> 'default_value', 'null'::jsonb)
    then
      if for_write then raise exception 'site_form_action_unavailable' using errcode = 'P0002'; end if;
      return null;
    end if;
    select value into configured_field
    from jsonb_array_elements(form_row.config_json -> 'fields') as item(value)
    where value ->> 'field' = binding_key;
    if configured_field is null then
      if for_write then raise exception 'site_form_action_unavailable' using errcode = 'P0002'; end if;
      return null;
    end if;
    expected_required := coalesce((binding ->> 'required')::boolean, false);
    expected_hidden := coalesce((binding ->> 'hidden')::boolean, false);
    visible_when_value := coalesce(configured_field -> 'visible_when', 'null'::jsonb);
    expected_visible_when := coalesce(binding -> 'visible_when', 'null'::jsonb);
    if (field_row.required or coalesce((configured_field ->> 'required')::boolean, false))
        is distinct from expected_required
      or coalesce((configured_field ->> 'hidden')::boolean, false) is distinct from expected_hidden
      or visible_when_value is distinct from expected_visible_when
      or coalesce(configured_field -> 'upload_kind', 'null'::jsonb) is distinct from coalesce(binding -> 'upload_kind', 'null'::jsonb)
      or coalesce(configured_field -> 'upload_count', 'null'::jsonb) is distinct from coalesce(binding -> 'upload_count', 'null'::jsonb)
      or coalesce(configured_field -> 'default_value', 'null'::jsonb)
          is distinct from coalesce(binding -> 'form_default_value', 'null'::jsonb)
    then
      if for_write then raise exception 'site_form_action_unavailable' using errcode = 'P0002'; end if;
      return null;
    end if;
  end loop;
  select count(*) into configured_count
  from jsonb_array_elements(form_row.config_json -> 'fields');
  if configured_count <> jsonb_array_length(action_row.field_bindings_json) then
    if for_write then raise exception 'site_form_action_unavailable' using errcode = 'P0002'; end if;
    return null;
  end if;

  return jsonb_build_object(
    'business_id', business_id_value,
    'business_name', business_name_value,
    'site_id', site_id_value,
    'release_id', release_id_value,
    'page_id', page_id_value,
    'form_id', form_id_value,
    'object_definition_id', object_id_value,
    'form_key', action_row.form_key,
    'action_key', action_row.action_key,
    'release_token', action_row.release_token,
    'action', action_row.action_json,
    'bindings', action_row.field_bindings_json,
    'customer_binding', coalesce(action_row.customer_binding_json, '{}'::jsonb)
  );
end;
$$;

-- Resolve Customer identity and connect the activity Record atomically.
create or replace function public.submit_public_site_form_v3(
  requested_business_slug text,
  requested_page_slug text,
  requested_action_key text,
  requested_release_token text,
  requested_idempotency_token uuid,
  requested_submission_attempt_id uuid,
  requested_answers jsonb,
  requested_grant_ids uuid[],
  requested_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  business_id_value uuid;
  resolved jsonb;
  existing_submission public.public_form_submissions;
  legacy_submission public.public_form_submissions;
  canonical_answers jsonb;
  record_data jsonb;
  retry_answers jsonb;
  frozen_action jsonb;
  upload_result jsonb := '{}'::jsonb;
  file_values jsonb := '{}'::jsonb;
  binding jsonb;
  file_value jsonb;
  attempt_expires_at timestamptz;
  window_start timestamptz := date_trunc('minute', statement_timestamp());
  rate_attempt integer;
  record_id_value uuid;
  receipt_id_value uuid;
  request_digest_value text;
  default_field public.field_definitions;
  supplied_key text;
  visible boolean;
  required boolean;
  is_file boolean;
  customer_binding jsonb;
  customer_result jsonb;
  customer_data jsonb := '{}'::jsonb;
  customer_object_id uuid;
  customer_email_key text;
  customer_relationship_id uuid;
  customer_record_id uuid;
  customer_mapping jsonb;
  customer_question_key text;
  customer_field_key text;
  customer_value jsonb;
begin
  if requested_business_slug is null
    or requested_page_slug is null
    or requested_action_key is null
    or requested_action_key !~ '^a_[a-f0-9]{64}$'
    or requested_release_token is null
    or requested_release_token !~ '^s_[a-f0-9]{64}$'
    or requested_idempotency_token is null
    or requested_submission_attempt_id is null
    or requested_submission_attempt_id <> requested_idempotency_token
    or requested_answers is null
    or jsonb_typeof(requested_answers) is distinct from 'object'
    or octet_length(requested_answers::text) > 65536
    or (
      select count(*) from jsonb_object_keys(requested_answers)
    ) > 50
    or requested_grant_ids is null
    or cardinality(requested_grant_ids) > 5
    or requested_request_hash is null
    or requested_request_hash !~ '^[a-f0-9]{64}$'
    or cardinality(requested_grant_ids) <> (
      select count(*) from (
        select distinct grant_id
        from unnest(requested_grant_ids) as grant_ids(grant_id)
      ) as unique_grants
    )
  then
    return jsonb_build_object('ok', false, 'code', 'invalid_submission');
  end if;

  select business.id into business_id_value
  from public.businesses as business
  where business.slug = requested_business_slug;
  if business_id_value is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- The idempotency advisory lock precedes all existing C2 row locks.  A
  -- replay therefore sees one immutable receipt and cannot create an orphan
  -- Record during a uniqueness race.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      business_id_value::text || ':' || requested_action_key || ':' ||
        requested_idempotency_token::text,
      0
    )
  );

  -- Receipt lookup deliberately precedes current release freshness.  Retries
  -- are canonicalised against the original frozen action stored with the
  -- receipt, so changed labels or a newer question set cannot alter it.
  select * into existing_submission
  from public.public_form_submissions
  where business_id = business_id_value
    and action_key = requested_action_key
    and idempotency_token = requested_idempotency_token;
  if found then
    begin
      if existing_submission.submission_attempt_id is distinct from
          requested_submission_attempt_id
        or existing_submission.request_digest is null
        or existing_submission.action_json -> 'action' is null
        or existing_submission.action_json -> 'bindings' is null
      then
        return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
      end if;
      retry_answers := private.site_canonicalize_submission_answers_v3(
        existing_submission.action_json -> 'action',
        existing_submission.action_json -> 'bindings',
        requested_answers
      );
      if private.site_form_submission_digest_v3(
        existing_submission.action_json, retry_answers,
        requested_grant_ids
      ) = existing_submission.request_digest
      then
        return jsonb_build_object(
          'ok', true,
          'idempotent', true,
          'confirmation', jsonb_build_object(
            'public_reference', existing_submission.public_reference
          )
        );
      end if;
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end;
  end if;

  begin
    resolved := private.resolve_site_public_form_action_v3(
      requested_business_slug, requested_page_slug, requested_action_key,
      requested_release_token, true
    );
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'action_unavailable');
  end;
  if resolved is null then
    return jsonb_build_object('ok', false, 'code', 'action_unavailable');
  end if;
  frozen_action := jsonb_build_object(
    'action', resolved -> 'action',
    'bindings', resolved -> 'bindings',
    'customer_binding', coalesce(resolved -> 'customer_binding', '{}'::jsonb)
  );

  begin
    canonical_answers := private.site_canonicalize_submission_answers_v3(
      resolved -> 'action', resolved -> 'bindings', requested_answers
    );
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'invalid_submission');
  end;
  -- The digest covers the stable caller-visible answer canonicalisation and
  -- grant manifest.  Attachment UUIDs are allocated later and belong only in
  -- Record data, so a retry can reproduce this digest exactly.
  request_digest_value := private.site_form_submission_digest_v3(
    frozen_action, canonical_answers, requested_grant_ids
  );

  -- Check receipt identity and rate limits before resolving Customer.  The
  -- resolver may create a complete Customer on a no-match path; doing that
  -- after these non-writing gates prevents an old-token or rate-limited
  -- request from leaving an orphan profile behind.
  select * into legacy_submission
  from public.public_form_submissions
  where business_id = (resolved ->> 'business_id')::uuid
    and page_id = (resolved ->> 'page_id')::uuid
    and form_id = (resolved ->> 'form_id')::uuid
    and idempotency_token = requested_idempotency_token;
  if found then
    if legacy_submission.action_key is null then
      return jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'confirmation', jsonb_build_object(
          'public_reference', legacy_submission.public_reference
        )
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;
  insert into public.public_form_rate_limits (
    business_id, form_id, request_hash, window_started_at
  ) values (
    (resolved ->> 'business_id')::uuid,
    (resolved ->> 'form_id')::uuid,
    requested_request_hash,
    window_start
  ) on conflict (business_id, form_id, request_hash, window_started_at)
  do update set attempt_count = public.public_form_rate_limits.attempt_count + 1,
    updated_at = statement_timestamp()
  returning attempt_count into rate_attempt;
  if rate_attempt > 10 then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;

  -- Customer identity is resolved inside this same transaction.  The binding
  -- is private canonical Form configuration and never comes from the caller.
  customer_binding := coalesce(resolved -> 'customer_binding', '{}'::jsonb);
  if coalesce((customer_binding ->> 'enabled')::boolean, false) then
    select object_definition.id into customer_object_id
    from public.object_definitions as object_definition
    where object_definition.business_id = (resolved ->> 'business_id')::uuid
      and object_definition.key = customer_binding ->> 'customer_object_key'
      and object_definition.is_active;
    select field_definition.key into customer_email_key
    from public.field_definitions as field_definition
    where field_definition.business_id = (resolved ->> 'business_id')::uuid
      and field_definition.object_definition_id = customer_object_id
      and field_definition.key = customer_binding ->> 'email_field_key'
      and field_definition.field_type = 'email'
      and field_definition.is_active;
    select relationship.id into customer_relationship_id
    from public.relationship_definitions as relationship
    where relationship.business_id = (resolved ->> 'business_id')::uuid
      and relationship.key = customer_binding ->> 'relationship_key'
      and relationship.is_active;
    if customer_object_id is null or customer_email_key is null
      or customer_relationship_id is null then
      return jsonb_build_object('ok', false, 'code', 'action_unavailable');
    end if;
    perform private.lock_relationship_definitions_v1(
      (resolved ->> 'business_id')::uuid,
      array[customer_relationship_id]
    );
    for customer_mapping in select value from jsonb_array_elements(
      coalesce(customer_binding -> 'mappings', '[]'::jsonb)
    ) loop
      customer_field_key := customer_mapping ->> 'customer_field_key';
      customer_question_key := customer_mapping ->> 'question_key';
      customer_value := canonical_answers -> customer_question_key;
      if customer_value is null and customer_mapping ? 'default_value' then
        customer_value := customer_mapping -> 'default_value';
      end if;
      if customer_value is not null then
        customer_data := customer_data || jsonb_build_object(
          customer_field_key, customer_value
        );
      end if;
    end loop;
    select mapping ->> 'question_key'
    into customer_question_key
    from jsonb_array_elements(
      coalesce(customer_binding -> 'mappings', '[]'::jsonb)
    ) as item(mapping)
    where mapping ->> 'customer_field_key' = customer_email_key
    limit 1;
    customer_value := canonical_answers -> coalesce(
      nullif(customer_question_key, ''), customer_email_key
    );
    if customer_value is null then
      select mapping -> 'default_value'
      into customer_value
      from jsonb_array_elements(
        coalesce(customer_binding -> 'mappings', '[]'::jsonb)
      ) as item(mapping)
      where mapping ->> 'customer_field_key' = customer_email_key
        and mapping ? 'default_value'
      limit 1;
    end if;
    if customer_value is null then
      return jsonb_build_object('ok', false, 'code', 'invalid_submission');
    end if;
    customer_data := customer_data || jsonb_build_object(
      customer_email_key, customer_value
    );
    customer_result := private.resolve_site_customer_v1(
      (resolved ->> 'business_id')::uuid,
      customer_object_id,
      customer_email_key,
      customer_value #>> '{}',
      customer_data
    );
    customer_record_id := (customer_result ->> 'record_id')::uuid;
  end if;

  record_id_value := gen_random_uuid();
  receipt_id_value := gen_random_uuid();
  record_data := canonical_answers;
  -- The normal Record trigger applies these defaults during INSERT.  Apply
  -- the same trusted values before the explicit validator so required fields
  -- with canonical defaults pass validation without relying on trigger order.
  for default_field in
    select field_definition.*
    from public.field_definitions as field_definition
    where field_definition.business_id = (resolved ->> 'business_id')::uuid
      and field_definition.object_definition_id = (resolved ->> 'object_definition_id')::uuid
      and field_definition.is_active
      and field_definition.default_value is not null
      and not (record_data ? field_definition.key)
    order by field_definition.position, field_definition.id
  loop
    record_data := record_data || jsonb_build_object(
      default_field.key, default_field.default_value
    );
  end loop;
  if cardinality(requested_grant_ids) > 0 then
    -- The helper receives the earliest reservation across every grant for
    -- this attempt, rather than a browser-supplied clock or selected subset.
    select min(grant_item.reservation_expires_at)
    into attempt_expires_at
    from public.site_public_upload_grants as grant_item
    where grant_item.business_id = (resolved ->> 'business_id')::uuid
      and grant_item.action_key = resolved ->> 'action_key'
      and grant_item.submission_attempt_id = requested_submission_attempt_id;
    upload_result := private.consume_site_public_upload_grants_v1(
      (resolved ->> 'business_id')::uuid,
      (resolved ->> 'release_id')::uuid,
      (resolved ->> 'form_id')::uuid,
      resolved ->> 'action_key',
      requested_submission_attempt_id,
      coalesce(attempt_expires_at, statement_timestamp()),
      requested_grant_ids,
      record_id_value,
      receipt_id_value
    );
    file_values := coalesce(upload_result -> 'file_values', '{}'::jsonb);
  end if;

  -- Merge only grant-backed File values after re-evaluating the frozen
  -- visibility sequence. A grant for a hidden or non-File question is never
  -- allowed to reach the Record.
  for binding in select value from jsonb_array_elements(resolved -> 'bindings') loop
    is_file := binding ->> 'field_type' = 'file';
    visible := not coalesce((binding ->> 'hidden')::boolean, false)
      and private.site_form_condition_satisfied_v3(
        nullif(binding -> 'visible_when', 'null'::jsonb), canonical_answers
      );
    if is_file then
      if visible and file_values ? (binding ->> 'field_key') then
        file_value := file_values -> (binding ->> 'field_key');
        if jsonb_typeof(file_value) is distinct from 'object'
          or jsonb_typeof(file_value -> 'attachment_ids') is distinct from 'array'
          or jsonb_array_length(file_value -> 'attachment_ids') < 1
        then
          raise exception 'site_submission_file_invalid' using errcode = '22023';
        end if;
        record_data := record_data || jsonb_build_object(
          binding ->> 'field_key', file_value
        );
      elsif visible and coalesce((binding ->> 'required')::boolean, false) then
        raise exception 'site_submission_required_answer_missing'
          using errcode = '23514';
      elsif not visible and file_values ? (binding ->> 'field_key') then
        raise exception 'site_submission_file_hidden' using errcode = '22023';
      end if;
    elsif file_values ? (binding ->> 'field_key') then
      raise exception 'site_submission_file_invalid' using errcode = '22023';
    end if;
  end loop;

  perform private.assert_valid_graph_record_data(
    (resolved ->> 'business_id')::uuid,
    (resolved ->> 'object_definition_id')::uuid,
    record_data
  );
  insert into public.records (
    id, business_id, object_definition_id, data_json
  ) values (
    record_id_value,
    (resolved ->> 'business_id')::uuid,
    (resolved ->> 'object_definition_id')::uuid,
    record_data
  );
  if customer_record_id is not null then
    insert into public.record_relationships (
      business_id, relationship_definition_id, source_record_id, target_record_id
    )
    select
      (resolved ->> 'business_id')::uuid,
      relationship.id,
      case when relationship.source_object_definition_id = customer_object_id
        then customer_record_id else record_id_value end,
      case when relationship.source_object_definition_id = customer_object_id
        then record_id_value else customer_record_id end
    from public.relationship_definitions as relationship
    where relationship.business_id = (resolved ->> 'business_id')::uuid
      and relationship.id = customer_relationship_id;
  end if;
  insert into public.public_form_submissions (
    id, business_id, page_id, form_id, idempotency_token, record_id,
    release_id, action_key, release_token, submission_attempt_id,
    request_digest, canonical_answers, action_json, grant_ids,
    customer_match_identity, customer_match_count, customer_candidate_ids,
    original_customer_record_id, customer_record_id, customer_resolution_state
  ) values (
    receipt_id_value,
    (resolved ->> 'business_id')::uuid,
    (resolved ->> 'page_id')::uuid,
    (resolved ->> 'form_id')::uuid,
    requested_idempotency_token,
    record_id_value,
    (resolved ->> 'release_id')::uuid,
    resolved ->> 'action_key',
    resolved ->> 'release_token',
    requested_submission_attempt_id,
    request_digest_value,
    canonical_answers,
    frozen_action,
    requested_grant_ids,
    customer_result ->> 'normalized_email',
    nullif(customer_result ->> 'match_count', '')::integer,
    case when customer_result ? 'candidate_ids'
      then array(select value::text::uuid from jsonb_array_elements_text(
        customer_result -> 'candidate_ids'
      ) as candidate(value))
      else null end,
    customer_record_id,
    customer_record_id,
    case when customer_record_id is null then null
      when coalesce((customer_result ->> 'created')::boolean, false)
        then 'matched_or_created' else 'matched' end
  ) returning * into existing_submission;
  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'confirmation', jsonb_build_object(
      'public_reference', existing_submission.public_reference
    )
  );
exception when unique_violation then
  return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
when others then
  return jsonb_build_object('ok', false, 'code', 'invalid_submission');
end;
$$;

-- Pre-lock contextual multi-edge graph writes without changing Staff RLS.
create or replace function public.create_contextual_graph_record(
  expected_business_id uuid,
  initiating_relationship_key text,
  initiating_direction text,
  parent_record_id uuid,
  requested_data jsonb default '{}'::jsonb,
  requested_connections jsonb default '[]'::jsonb
)
returns public.records
language plpgsql
security invoker
set search_path = ''
as $$
declare
  relationship_definition public.relationship_definitions;
  parent_record public.records;
  created_record public.records;
  connection_value jsonb;
  additional_relationship public.relationship_definitions;
  target_id uuid;
  source_id uuid;
  target_id_for_edge uuid;
  requested_relationship_ids uuid[] := '{}';
begin
  if initiating_direction not in ('source', 'target')
    or jsonb_typeof(requested_data) <> 'object'
    or jsonb_typeof(requested_connections) <> 'array'
    or jsonb_array_length(requested_connections) > 20 then
    raise exception 'contextual_record_request_invalid' using errcode = '22023';
  end if;

  select relationship.* into relationship_definition
  from public.relationship_definitions as relationship
  where relationship.business_id = expected_business_id
    and relationship.key = initiating_relationship_key
    and relationship.is_active
  ;
  if not found then
    raise exception 'contextual_record_connection_unavailable' using errcode = 'P0002';
  end if;

  select record_value.* into parent_record
  from public.records as record_value
  where record_value.business_id = expected_business_id
    and record_value.id = parent_record_id
    and record_value.record_status = 'active'::public.graph_record_status
  ;
  if not found then
    raise exception 'contextual_record_parent_unavailable' using errcode = 'P0002';
  end if;

  if (
    initiating_direction = 'source'
    and parent_record.object_definition_id <> relationship_definition.source_object_definition_id
  ) or (
    initiating_direction = 'target'
    and parent_record.object_definition_id <> relationship_definition.target_object_definition_id
  ) then
    raise exception 'contextual_record_connection_unavailable' using errcode = '23514';
  end if;
  requested_relationship_ids := array_append(
    requested_relationship_ids, relationship_definition.id
  );

  -- Validate every additional edge and target before the first Record write.
  -- The member bridge then locks the complete finite set in UUID order.
  for connection_value in
    select value from jsonb_array_elements(requested_connections)
  loop
    if not private.experience_json_has_only_keys(
      connection_value,
      array['relationship_key', 'direction', 'target_record_ids']
    )
      or jsonb_typeof(connection_value -> 'relationship_key') <> 'string'
      or connection_value ->> 'relationship_key' !~ '^[a-z][a-z0-9_]*$'
      or connection_value ->> 'direction' not in ('source', 'target')
      or jsonb_typeof(connection_value -> 'target_record_ids') <> 'array'
      or jsonb_array_length(connection_value -> 'target_record_ids') > 100
    then
      raise exception 'contextual_record_request_invalid' using errcode = '22023';
    end if;
    select relationship.* into additional_relationship
    from public.relationship_definitions as relationship
    where relationship.business_id = expected_business_id
      and relationship.key = connection_value ->> 'relationship_key'
      and relationship.is_active;
    if not found then
      raise exception 'contextual_record_connection_unavailable' using errcode = 'P0002';
    end if;
    if (
      connection_value ->> 'direction' = 'source'
      and additional_relationship.source_object_definition_id <> case
        when initiating_direction = 'source'
          then relationship_definition.target_object_definition_id
          else relationship_definition.source_object_definition_id end
    ) or (
      connection_value ->> 'direction' = 'target'
      and additional_relationship.target_object_definition_id <> case
        when initiating_direction = 'source'
          then relationship_definition.target_object_definition_id
          else relationship_definition.source_object_definition_id end
    ) then
      raise exception 'contextual_record_connection_unavailable' using errcode = '23514';
    end if;
    for target_id in
      select value::text::uuid
      from jsonb_array_elements_text(connection_value -> 'target_record_ids') as item(value)
    loop
      if not exists (
        select 1 from public.records as target_record
        where target_record.business_id = expected_business_id
          and target_record.id = target_id
          and target_record.record_status = 'active'::public.graph_record_status
          and target_record.object_definition_id = case
            when connection_value ->> 'direction' = 'source'
              then additional_relationship.target_object_definition_id
            else additional_relationship.source_object_definition_id
          end
      ) then
        raise exception 'contextual_record_target_unavailable' using errcode = 'P0002';
      end if;
    end loop;
    requested_relationship_ids := array_append(
      requested_relationship_ids, additional_relationship.id
    );
  end loop;
  perform private.lock_relationship_definitions_for_member_v1(
    expected_business_id, requested_relationship_ids
  );

  insert into public.records (business_id, object_definition_id, data_json)
  values (
    expected_business_id,
    case when initiating_direction = 'source'
      then relationship_definition.target_object_definition_id
      else relationship_definition.source_object_definition_id
    end,
    requested_data
  )
  returning * into created_record;

  if initiating_direction = 'source' then
    source_id := parent_record.id;
    target_id_for_edge := created_record.id;
  else
    source_id := created_record.id;
    target_id_for_edge := parent_record.id;
  end if;

  insert into public.record_relationships (
    business_id, relationship_definition_id, source_record_id, target_record_id
  ) values (
    expected_business_id, relationship_definition.id, source_id, target_id_for_edge
  );

  for connection_value in
    select value from jsonb_array_elements(requested_connections)
  loop
    if not private.experience_json_has_only_keys(
      connection_value,
      array['relationship_key', 'direction', 'target_record_ids']
    )
      or jsonb_typeof(connection_value -> 'relationship_key') <> 'string'
      or connection_value ->> 'relationship_key' !~ '^[a-z][a-z0-9_]*$'
      or connection_value ->> 'direction' not in ('source', 'target')
      or jsonb_typeof(connection_value -> 'target_record_ids') <> 'array'
      or jsonb_array_length(connection_value -> 'target_record_ids') > 100
    then
      raise exception 'contextual_record_request_invalid' using errcode = '22023';
    end if;

    select relationship.* into additional_relationship
    from public.relationship_definitions as relationship
    where relationship.business_id = expected_business_id
      and relationship.key = connection_value ->> 'relationship_key'
      and relationship.is_active
    ;
    if not found then
      raise exception 'contextual_record_connection_unavailable' using errcode = 'P0002';
    end if;

    if (
      connection_value ->> 'direction' = 'source'
      and additional_relationship.source_object_definition_id <> created_record.object_definition_id
    ) or (
      connection_value ->> 'direction' = 'target'
      and additional_relationship.target_object_definition_id <> created_record.object_definition_id
    ) then
      raise exception 'contextual_record_connection_unavailable' using errcode = '23514';
    end if;

    for target_id in
      select value::text::uuid
      from jsonb_array_elements_text(connection_value -> 'target_record_ids') as item(value)
    loop
      if not exists (
        select 1 from public.records as target_record
        where target_record.business_id = expected_business_id
          and target_record.id = target_id
          and target_record.record_status = 'active'::public.graph_record_status
          and target_record.object_definition_id = case
            when connection_value ->> 'direction' = 'source'
              then additional_relationship.target_object_definition_id
            else additional_relationship.source_object_definition_id
          end
      ) then
        raise exception 'contextual_record_target_unavailable' using errcode = 'P0002';
      end if;

      insert into public.record_relationships (
        business_id, relationship_definition_id, source_record_id, target_record_id
      ) values (
        expected_business_id,
        additional_relationship.id,
        case when connection_value ->> 'direction' = 'source'
          then created_record.id else target_id end,
        case when connection_value ->> 'direction' = 'source'
          then target_id else created_record.id end
      );
    end loop;
  end loop;

  return created_record;
end;
$$;

-- Pre-lock replacement edge definitions before Staff RLS deletes/inserts.
create or replace function public.set_record_connection_values(
  expected_business_id uuid,
  requested_view_key text,
  requested_record_id uuid,
  requested_relationship_key text,
  requested_direction text,
  requested_target_record_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_view public.views;
  relationship_definition public.relationship_definitions;
  current_record public.records;
  target_object_id uuid;
  target_count integer;
  target_id uuid;
  source_id uuid;
  target_id_for_insert uuid;
begin
  if not private.is_business_member(expected_business_id) then
    raise exception 'workspace_connection_write_membership_required'
      using errcode = '42501';
  end if;
  if requested_direction not in ('source', 'target')
    or coalesce(array_length(requested_target_record_ids, 1), 0) > 100
    or (
      select count(*) from unnest(coalesce(requested_target_record_ids, '{}'::uuid[]))
    ) <> (
      select count(distinct value)
      from unnest(coalesce(requested_target_record_ids, '{}'::uuid[])) as value
    )
  then
    raise exception 'workspace_connection_write_invalid'
      using errcode = '22023';
  end if;

  select view_definition.* into target_view
  from public.views as view_definition
  where view_definition.business_id = expected_business_id
    and view_definition.key = requested_view_key
    and view_definition.view_type = 'table'
    and view_definition.audience = 'internal'
    and view_definition.is_active;
  if not found then
    raise exception 'workspace_query_view_not_found'
      using errcode = 'P0002';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(target_view.config_json -> 'columns') as column_value
    where column_value ->> 'kind' = 'connection'
      and column_value ->> 'relationship_key' = requested_relationship_key
      and column_value ->> 'direction' = requested_direction
  ) then
    raise exception 'workspace_connection_column_not_found'
      using errcode = 'P0002';
  end if;

  select record_value.* into current_record
  from public.records as record_value
  where record_value.business_id = expected_business_id
    and record_value.id = requested_record_id
    and record_value.object_definition_id = target_view.object_definition_id
    and record_value.record_status = 'active';
  if not found then
    raise exception 'workspace_connection_record_not_found'
      using errcode = 'P0002';
  end if;

  select definition.* into relationship_definition
  from public.relationship_definitions as definition
  where definition.business_id = expected_business_id
    and definition.key = requested_relationship_key
    and definition.is_active;
  if not found then
    raise exception 'workspace_connection_not_found'
      using errcode = 'P0002';
  end if;
  if requested_direction = 'source' then
    if relationship_definition.source_object_definition_id <> current_record.object_definition_id then
      raise exception 'workspace_connection_direction_invalid'
        using errcode = '22023';
    end if;
    target_object_id := relationship_definition.target_object_definition_id;
  else
    if relationship_definition.target_object_definition_id <> current_record.object_definition_id then
      raise exception 'workspace_connection_direction_invalid'
        using errcode = '22023';
    end if;
    target_object_id := relationship_definition.source_object_definition_id;
  end if;
  target_count := coalesce(array_length(requested_target_record_ids, 1), 0);
  if relationship_definition.cardinality = 'one_to_one'
    and target_count > 1
  then
    raise exception 'workspace_connection_cardinality_invalid'
      using errcode = '22023';
  end if;
  if relationship_definition.cardinality = 'one_to_many'
    and requested_direction = 'source'
    and target_count > 1
  then
    raise exception 'workspace_connection_cardinality_invalid'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(coalesce(requested_target_record_ids, '{}'::uuid[])) as requested_id
    where not exists (
      select 1
      from public.records as record_value
      where record_value.business_id = expected_business_id
        and record_value.id = requested_id
        and record_value.object_definition_id = target_object_id
        and record_value.record_status = 'active'
    )
  ) then
    raise exception 'workspace_connection_target_invalid'
      using errcode = '22023';
  end if;

  perform private.lock_relationship_definitions_for_member_v1(
    expected_business_id, array[relationship_definition.id]
  );

  if requested_direction = 'source' then
    delete from public.record_relationships as edge
    where edge.business_id = expected_business_id
      and edge.relationship_definition_id = relationship_definition.id
      and edge.source_record_id = current_record.id;
  else
    delete from public.record_relationships as edge
    where edge.business_id = expected_business_id
      and edge.relationship_definition_id = relationship_definition.id
      and edge.target_record_id = current_record.id;
  end if;

  foreach target_id in array coalesce(requested_target_record_ids, '{}'::uuid[])
  loop
    if requested_direction = 'source' then
      source_id := current_record.id;
      target_id_for_insert := target_id;
    else
      source_id := target_id;
      target_id_for_insert := current_record.id;
    end if;
    insert into public.record_relationships (
      business_id,
      relationship_definition_id,
      source_record_id,
      target_record_id
    ) values (
      expected_business_id,
      relationship_definition.id,
      source_id,
      target_id_for_insert
    );
  end loop;

  return jsonb_build_object(
    'record_id', current_record.id,
    'relationship_key', requested_relationship_key,
    'direction', requested_direction,
    'target_record_ids', to_jsonb(coalesce(requested_target_record_ids, '{}'::uuid[]))
  );
end;
$$;


-- Freeze the selected preorder offer at Prepare.  The public resolver and
-- submitter may still consult live Record status and Location links, but
-- labels, prices and image references come from this bounded release value.
create or replace function private.site_freeze_preorder_offer_v4(
  target_business_id uuid,
  target_experience_id uuid,
  target_config jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  product_value public.records;
  product_name_key text := target_config -> 'field_mappings' -> 'product' ->> 'name';
  product_description_key text := target_config -> 'field_mappings' -> 'product' ->> 'description';
  product_price_key text := target_config -> 'field_mappings' -> 'product' ->> 'price';
  product_image_key text := target_config -> 'field_mappings' -> 'product' ->> 'image';
  product_status_key text := target_config -> 'field_mappings' -> 'product' ->> 'status';
  active_status text := target_config -> 'field_mappings' -> 'product' ->> 'active_status_value';
  price_value numeric;
  image_value jsonb;
  location_ids jsonb;
  frozen_products jsonb := '[]'::jsonb;
begin
  if target_business_id is null or target_experience_id is null
    or jsonb_typeof(target_config) is distinct from 'object'
  then
    raise exception 'site_operational_offer_invalid' using errcode = '23514';
  end if;
  for product_value in
    select record_value.*
    from public.records as record_value
    where record_value.business_id = target_business_id
      and record_value.object_definition_id = (
        select experience.product_object_definition_id
        from public.preorder_experiences as experience
        where experience.business_id = target_business_id
          and experience.id = target_experience_id
          and experience.is_active
      )
      and record_value.record_status = 'active'::public.graph_record_status
      and record_value.data_json ->> product_status_key = active_status
      and exists (
        select 1
        from public.record_location_links as availability
        join public.preorder_experience_locations as allowed
          on allowed.business_id = availability.business_id
          and allowed.location_id = availability.location_id
          and allowed.preorder_experience_id = target_experience_id
        join public.locations as active_location
          on active_location.business_id = availability.business_id
          and active_location.id = availability.location_id
          and active_location.is_active
        where availability.business_id = target_business_id
          and availability.record_id = record_value.id
      )
    order by record_value.data_json ->> product_name_key, record_value.id
  loop
    begin
      price_value := (product_value.data_json ->> product_price_key)::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        continue;
    end;
    if price_value <= 0 or price_value > 999999.99
      or round(price_value, 2) <> price_value then
      continue;
    end if;
    select coalesce(jsonb_agg(availability.location_id), '[]'::jsonb)
    into location_ids
    from public.record_location_links as availability
    join public.preorder_experience_locations as allowed
      on allowed.business_id = availability.business_id
      and allowed.location_id = availability.location_id
      and allowed.preorder_experience_id = target_experience_id
    join public.locations as active_location
      on active_location.business_id = availability.business_id
      and active_location.id = availability.location_id
      and active_location.is_active
    where availability.business_id = target_business_id
      and availability.record_id = product_value.id;
    image_value := null;
    if product_image_key is not null then
      if jsonb_typeof(product_value.data_json -> product_image_key) = 'string'
        and product_value.data_json ->> product_image_key
          ~* '^https?://[^[:space:]]+$'
      then
        image_value := product_value.data_json -> product_image_key;
      elsif jsonb_typeof(product_value.data_json -> product_image_key) = 'object'
        and product_value.data_json -> product_image_key ->> 'url'
          ~* '^https?://[^[:space:]]+$'
      then
        image_value := product_value.data_json -> product_image_key -> 'url';
      end if;
    end if;
    frozen_products := frozen_products || jsonb_build_array(
      jsonb_strip_nulls(jsonb_build_object(
        'id', product_value.id,
        'name', product_value.data_json ->> product_name_key,
        'description', product_value.data_json ->> product_description_key,
        'price', price_value,
        'image_url', image_value,
        'location_ids', location_ids
      ))
    );
  end loop;
  return jsonb_build_object('products', frozen_products);
end;
$$;
revoke all on function private.site_freeze_preorder_offer_v4(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

-- v4 release wrapper retaining the existing C3 materialisation path.
create or replace function public.prepare_site_release_v4(
  expected_business_id uuid,
  expected_actor_id uuid,
  requested_site_id uuid,
  expected_draft_revision bigint,
  expected_base_version_id uuid,
  expected_head_revision bigint
)
returns public.site_releases
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_head public.business_configuration_heads;
  active_version public.configuration_versions;
  selected_state public.site_states;
  existing_release public.site_releases;
  existing_change public.configuration_change_sets;
  prepared_release public.site_releases;
  proposed_change public.configuration_change_sets;
  validated_change public.configuration_change_sets;
  materialized jsonb;
  display_context jsonb;
  candidate_snapshot jsonb;
  canonical_draft jsonb;
  all_operations jsonb;
  derived_operations jsonb;
  form_operations jsonb;
  form_stripped_draft jsonb;
  legacy_validation_draft jsonb;
  projection jsonb;
  review_metadata jsonb;
  action_bundles jsonb := '[]'::jsonb;
  form_value jsonb;
  prepared_release_id uuid;
  release_token_value text;
  draft_checksum text;
  projection_checksum text;
  operational_actions jsonb := '[]'::jsonb;
  operational_block record;
  operational_action_key text;
  operational_source_page_id uuid;
  canonical_source_page_id uuid;
  prior_source_page_id uuid;
  operational_frozen_offer jsonb;
  operational_definition_hash text;
begin
  if expected_business_id is null or expected_actor_id is null
    or requested_site_id is null or expected_draft_revision is null
    or expected_draft_revision <= 0 or expected_base_version_id is null
    or expected_head_revision is null or expected_head_revision <= 0
  then
    raise exception 'site_request_invalid' using errcode = '22023';
  end if;

  perform private.site_assert_actor_v1(expected_business_id, expected_actor_id);
  select * into current_head
  from public.business_configuration_heads
  where business_id = expected_business_id
  for update;
  if not found then
    raise exception 'configuration_head_not_found' using errcode = 'P0002';
  end if;
  if current_head.active_version_id <> expected_base_version_id
    or current_head.head_revision <> expected_head_revision
  then
    raise exception 'site_configuration_stale' using errcode = 'P0001';
  end if;

  select * into active_version
  from public.configuration_versions
  where business_id = expected_business_id
    and id = current_head.active_version_id;
  if not found then
    raise exception 'configuration_active_version_not_found' using errcode = 'P0002';
  end if;
  perform private.assert_configuration_projection_matches_v1(
    expected_business_id, active_version.snapshot_json,
    active_version.snapshot_checksum
  );

  select * into selected_state
  from public.site_states
  where business_id = expected_business_id
    and id = requested_site_id
  for update;
  if not found then
    raise exception 'site_not_found' using errcode = 'P0002';
  end if;
  if selected_state.draft_revision <> expected_draft_revision then
    raise exception 'site_draft_stale' using errcode = 'P0001';
  end if;
  if selected_state.draft_base_version_id <> current_head.active_version_id
    or selected_state.draft_base_head_revision <> current_head.head_revision
  then
    raise exception 'site_configuration_rebase_required' using errcode = 'P0001';
  end if;

  -- Preserve C2's structural draft boundary for every intent, including a
  -- recoverable Form on an excluded Page.  Strict readiness below is limited
  -- to the Forms reachable from this release's included Pages.
  perform private.site_assert_site_draft_c2(
    expected_business_id, selected_state.draft_json
  );

  perform private.site_assert_site_forms_publication_ready_for_site_v3(
    expected_business_id, requested_site_id,
    private.site_strip_operational_blocks_for_legacy_checks_v4(
      selected_state.draft_json
    ),
    active_version.snapshot_json
  );
  -- Operational Customer connections must be able to accept repeated
  -- activities before a release can freeze the source and matching policy.
  perform private.site_assert_operational_customer_cardinality_v4(
    expected_business_id, selected_state.draft_json
  );
  if selected_state.migration_state = 'new' and exists (
    select 1 from public.pages as page_value
    where page_value.business_id = expected_business_id
      and page_value.audience = 'public'
      and page_value.status = 'published'
      and page_value.is_active
  ) then
    raise exception 'site_adoption_required' using errcode = 'P0001';
  end if;
  if selected_state.migration_state = 'legacy_pending' then
    perform private.site_assert_adoption_source_v2(
      expected_business_id, requested_site_id,
      selected_state.legacy_source_checksum
    );
  end if;

  draft_checksum := encode(
    extensions.digest(convert_to(selected_state.draft_json::text, 'UTF8'), 'sha256'),
    'hex'
  );
  -- Reuse an equivalent prepared release before compiling or proposing a new
  -- ConfigurationChangeSet.  Repeated Prepare calls therefore leave no
  -- unused validated artifact behind.
  perform private.site_expire_prepared_releases_v1(
    expected_business_id, requested_site_id
  );
  select * into existing_release
  from public.site_releases
  where business_id = expected_business_id
    and site_id = requested_site_id
    and status = 'prepared'
    and projection_schema_version = 4
    and source_draft_revision = selected_state.draft_revision
    and source_base_version_id = current_head.active_version_id
    and source_head_revision = current_head.head_revision
    and expected_active_release_revision = selected_state.active_release_revision
    and review_json ->> '_c3_draft_checksum' = draft_checksum
  order by prepared_at desc
  limit 1
  for share;
  if found then
    if existing_release.configuration_change_set_id is null then
      return existing_release;
    end if;
    select * into existing_change
    from public.configuration_change_sets
    where business_id = expected_business_id
      and id = existing_release.configuration_change_set_id
    for share;
    if found and existing_change.status = 'validated' then
      return existing_release;
    end if;
    update public.site_releases
    set status = 'invalidated'
    where business_id = expected_business_id
      and id = existing_release.id;
  end if;

  -- Canonical Pages retain the C2 layout grammar; the public release below
  -- carries the reviewed Form atoms alongside that canonical Page projection.
  form_stripped_draft := private.site_strip_public_forms_from_draft_v3(
    selected_state.draft_json
  );
  legacy_validation_draft :=
    private.site_strip_operational_blocks_for_legacy_checks_v4(
      form_stripped_draft
    );
  perform private.site_assert_publication_draft_c2(
    expected_business_id, legacy_validation_draft
  );
  perform private.site_assert_publication_ready_v1(
    private.site_strip_filter_draft_v2(legacy_validation_draft)
  );
  canonical_draft := private.site_strip_draft_metadata_draft_v2(
    private.site_strip_filter_draft_v2(form_stripped_draft)
  );
  perform private.site_assert_assets_available_v1(
    expected_business_id, selected_state.draft_json
  );
  perform private.site_lock_selected_records_c2(
    expected_business_id, selected_state.draft_json
  );

  derived_operations := private.site_derived_page_operations_v1(
    expected_business_id, requested_site_id, canonical_draft
  );
  form_operations := private.site_form_configuration_operations_v3(
    expected_business_id,
    selected_state.draft_json || jsonb_build_object(
      '_c3_site_id', requested_site_id::text
    ),
    active_version.snapshot_json
  );
  all_operations := coalesce(form_operations, '[]'::jsonb)
    || coalesce(derived_operations, '[]'::jsonb);

  -- Materialise once to detect a no-op re-publication.  The public proposal
  -- boundary repeats the same five-argument materialisation with its trusted
  -- display context when there is a real canonical change.
  if jsonb_array_length(all_operations) = 0 then
    candidate_snapshot := active_version.snapshot_json;
  else
    display_context := private.build_configuration_display_context_v1(
      expected_business_id, active_version.snapshot_json, all_operations, null
    );
    materialized := private.configuration_materialize_candidate_v1(
      expected_business_id, active_version.snapshot_json, all_operations,
      null, display_context
    );
    candidate_snapshot := materialized -> 'candidate_snapshot';
  end if;
  if jsonb_array_length(all_operations) = 0
    or candidate_snapshot = active_version.snapshot_json
    or jsonb_array_length(materialized -> 'semantic_diff' -> 'changes') = 0
  then
    all_operations := '[]'::jsonb;
    candidate_snapshot := active_version.snapshot_json;
  else
    proposed_change := public.propose_configuration_change(
      expected_business_id, expected_actor_id,
      current_head.active_version_id, current_head.head_revision,
      'Prepare Site Forms',
      'Server-derived canonical Site Form, destination and Page definitions.',
      all_operations
    );
    validated_change := public.validate_configuration_change(
      expected_business_id, expected_actor_id, proposed_change.id
    );
    if validated_change.status <> 'validated'
      or validated_change.validation_result_json ->> 'outcome' <> 'valid'
    then
      raise exception 'site_configuration_incompatible' using errcode = '23514';
    end if;
    candidate_snapshot := validated_change.candidate_snapshot_json;
  end if;

  prepared_release_id := gen_random_uuid();
  release_token_value := private.site_public_release_token_v3(
    requested_site_id, prepared_release_id
  );
  for form_value in select value from jsonb_array_elements(
    coalesce(selected_state.draft_json -> 'forms', '[]'::jsonb)
  ) where value ->> 'key' in (
    select form_key
    from private.site_reachable_form_keys_v3(selected_state.draft_json)
  ) loop
    action_bundles := action_bundles || jsonb_build_array(
      private.site_build_form_action_bundle_v3(
        requested_site_id, prepared_release_id, release_token_value,
        candidate_snapshot, form_value ->> 'key', form_value ->> 'view_key'
      )
    );
  end loop;
  for operational_block in
    select draft_block.page_id, draft_block.block
    from private.site_draft_blocks_v1(selected_state.draft_json) as draft_block
    where draft_block.block ->> 'type' in ('booking', 'preorder')
      and exists (
        select 1
        from jsonb_array_elements(selected_state.draft_json -> 'pages')
          as included_page(value)
        where (included_page.value ->> 'id')::uuid = draft_block.page_id
          and coalesce((included_page.value ->> 'is_included')::boolean, true)
      )
  loop
    operational_source_page_id := null;
    canonical_source_page_id := null;
    prior_source_page_id := null;
    if operational_block.block ->> 'type' = 'booking'
      and operational_block.block ->> 'stable_source_page_id' is not null
    then
      begin
        operational_source_page_id := (
          operational_block.block ->> 'stable_source_page_id'
        )::uuid;
      exception when invalid_text_representation then
        raise exception 'site_operational_source_unavailable'
          using errcode = '23514';
      end;
      if operational_source_page_id = operational_block.page_id then
        select (source_page.value ->> 'id')::uuid
        into canonical_source_page_id
        from jsonb_array_elements(candidate_snapshot -> 'pages')
          as source_page(value)
        where source_page.value ->> 'key' = private.site_page_key_v1(
          requested_site_id, operational_block.page_id
        )
          and private.site_page_contains_booking_source_v4(
            source_page.value -> 'layout_json',
            operational_block.block ->> 'booking_key',
            operational_block.block -> 'config'
          )
        limit 1;
        operational_source_page_id := coalesce(
          canonical_source_page_id, operational_source_page_id
        );
      end if;
      -- A Site draft may retain a source identity only when it is already
      -- anchored by this Site's immutable action/binding, or when the source
      -- is the current draft Page on its first publication.  A browser-sent
      -- Page UUID that merely exists in the tenant is not sufficient: it
      -- could otherwise move an action into another Page's namespace.
      if not (
        exists (
          select 1
          from public.site_release_actions_v4 as retained_action
          join public.site_releases as retained_release
            on retained_release.business_id = retained_action.business_id
           and retained_release.id = retained_action.release_id
          where retained_action.business_id = expected_business_id
            and retained_action.site_id = requested_site_id
            and retained_action.action_kind = 'booking'
            and retained_action.source_page_id = operational_source_page_id
            and retained_action.booking_key = operational_block.block ->> 'booking_key'
            and (retained_action.action_json -> 'config')
              - 'schedule'
              = coalesce(operational_block.block -> 'config', '{}'::jsonb)
                - 'schedule'
            and retained_release.status = 'published'
        )
        or exists (
          select 1
          from jsonb_array_elements(candidate_snapshot -> 'pages')
            as source_page(value)
          where (source_page.value ->> 'id')::uuid
              = operational_source_page_id
            and source_page.value ->> 'audience' = 'public'
            and coalesce((source_page.value ->> 'is_active')::boolean, false)
            and private.site_page_contains_booking_source_v4(
              source_page.value -> 'layout_json',
              operational_block.block ->> 'booking_key',
              operational_block.block -> 'config'
            )
        )
        or exists (
          select 1
          from public.site_page_bindings as retained_binding
          where retained_binding.business_id = expected_business_id
            and retained_binding.site_id = requested_site_id
            and retained_binding.draft_page_id = operational_block.page_id
            and (
              retained_binding.canonical_page_id = operational_source_page_id
              or retained_binding.legacy_source_page_id = operational_source_page_id
            )
        )
        or (
          operational_source_page_id = operational_block.page_id
          and not exists (
            select 1
            from public.site_page_bindings as first_binding
            where first_binding.business_id = expected_business_id
              and first_binding.site_id = requested_site_id
              and first_binding.draft_page_id = operational_block.page_id
          )
          and not exists (
            select 1
            from public.site_release_actions_v4 as first_action
            join public.site_releases as first_release
              on first_release.business_id = first_action.business_id
             and first_release.id = first_action.release_id
            where first_action.business_id = expected_business_id
              and first_action.site_id = requested_site_id
              and first_action.action_kind = 'booking'
              and first_action.booking_key = operational_block.block ->> 'booking_key'
              and first_action.action_json -> 'config'
                = coalesce(operational_block.block -> 'config', '{}'::jsonb)
              and first_release.status = 'published'
          )
        )
      ) then
        raise exception 'site_operational_source_unavailable'
          using errcode = '23514';
      end if;
    end if;
    -- The block identity in the last published v4 review is the durable
    -- source anchor.  A block may move between Pages or be copied after the
    -- first release; its current placement must not silently become a new
    -- booking action namespace.
    if operational_source_page_id is null then
      select nullif(item.value ->> 'stable_source_page_id', '')::uuid
      into operational_source_page_id
      from public.site_releases as prior_release,
        jsonb_array_elements(
          coalesce(prior_release.review_json -> '_c4_operational_actions', '[]'::jsonb)
        ) as item(value)
      where prior_release.business_id = expected_business_id
        and prior_release.site_id = requested_site_id
        and prior_release.status = 'published'
        and prior_release.projection_schema_version = 4
        and item.value ->> 'block_id' = operational_block.block ->> 'id'
        and item.value ->> 'kind' = operational_block.block ->> 'type'
        and item.value ->> 'stable_source_page_id' is not null
      order by prior_release.published_at desc nulls last,
        prior_release.prepared_at desc
      limit 1;
    end if;
    if operational_source_page_id is null
      and operational_block.block ->> 'type' = 'booking'
    then
      -- A duplicated block has a new block id.  Reuse the oldest published
      -- source for the same frozen booking definition, so copies still share
      -- the action/counter/receipt namespace.
      select action.source_page_id
      into prior_source_page_id
      from public.site_release_actions_v4 as action
      join public.site_releases as prior_release
        on prior_release.business_id = action.business_id
       and prior_release.id = action.release_id
      where action.business_id = expected_business_id
        and action.site_id = requested_site_id
        and action.action_kind = 'booking'
        and action.booking_key = operational_block.block ->> 'booking_key'
        and (action.action_json -> 'config')
          - 'schedule'
          = coalesce(operational_block.block -> 'config', '{}'::jsonb)
            - 'schedule'
        and prior_release.status = 'published'
      order by prior_release.published_at asc nulls last,
        prior_release.prepared_at asc, action.source_page_id
      limit 1;
      operational_source_page_id := prior_source_page_id;
    end if;
    if operational_source_page_id is null then
      select coalesce(binding.legacy_source_page_id, binding.canonical_page_id)
      into operational_source_page_id
      from public.site_page_bindings as binding
      where binding.business_id = expected_business_id
        and binding.site_id = requested_site_id
        and binding.draft_page_id = operational_block.page_id;
    end if;
    if operational_source_page_id is null
      and operational_block.block ->> 'type' = 'booking'
    then
      -- On first publication a Site-owned Booking has no retained action or
      -- binding yet.  The canonical Page operation was materialised above;
      -- use that actual Page UUID rather than the private draft UUID.
      select (source_page.value ->> 'id')::uuid
      into operational_source_page_id
      from jsonb_array_elements(candidate_snapshot -> 'pages')
        as source_page(value)
      where source_page.value ->> 'key' = private.site_page_key_v1(
        requested_site_id, operational_block.page_id
      )
        and source_page.value ->> 'audience' = 'public'
        and coalesce((source_page.value ->> 'is_active')::boolean, false)
        and private.site_page_contains_booking_source_v4(
          source_page.value -> 'layout_json',
          operational_block.block ->> 'booking_key',
          operational_block.block -> 'config'
        )
      limit 1;
    end if;
    if operational_source_page_id is null
      and operational_block.block ->> 'type' = 'booking'
    then
      raise exception 'site_operational_source_unavailable'
        using errcode = '23514';
    end if;
    if operational_block.block ->> 'type' = 'booking'
      and not exists (
      select 1
      from jsonb_array_elements(candidate_snapshot -> 'pages')
        as source_page(value)
      where (source_page.value ->> 'id')::uuid = operational_source_page_id
      ) then
      raise exception 'site_operational_source_unavailable'
        using errcode = '23514';
    end if;
    operational_action_key := case
      when operational_block.block ->> 'type' = 'booking' then
        private.site_public_operational_action_key_v4(
          requested_site_id, 'booking',
          operational_source_page_id,
          operational_block.block ->> 'booking_key', null
        )
      else private.site_public_operational_action_key_v4(
        requested_site_id, 'preorder', null, null,
        (select experience.id
         from public.preorder_experiences as experience
         where experience.business_id = expected_business_id
           and experience.key = operational_block.block ->> 'preorder_key'
         limit 1))
      end;
    operational_frozen_offer := null;
    if operational_block.block ->> 'type' = 'preorder' then
      select private.site_freeze_preorder_offer_v4(
        expected_business_id,
        experience.id,
        experience.config_json
      )
      into operational_frozen_offer
      from public.preorder_experiences as experience
      where experience.business_id = expected_business_id
        and experience.key = operational_block.block ->> 'preorder_key'
        and experience.is_active;
      if operational_frozen_offer is null then
        raise exception 'site_operational_offer_invalid' using errcode = '23514';
      end if;
    end if;
    operational_definition_hash := encode(
      extensions.digest(
        convert_to(
          jsonb_build_object(
            'kind', operational_block.block ->> 'type',
            'stable_source_page_id', operational_source_page_id,
            'booking_key', operational_block.block ->> 'booking_key',
            'preorder_key', operational_block.block ->> 'preorder_key',
            'config', coalesce(operational_block.block -> 'config', '{}'::jsonb),
            'frozen_offer', coalesce(operational_frozen_offer, '{}'::jsonb)
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
    if exists (
      select 1
      from jsonb_array_elements(operational_actions) as existing(value)
      where existing.value ->> 'action_key' = operational_action_key
        and existing.value ->> 'definition_hash'
          is distinct from operational_definition_hash
    ) then
      raise exception 'site_operational_action_conflict' using errcode = '23514';
    end if;
    operational_actions := operational_actions || jsonb_build_array(
      jsonb_build_object(
        'kind', operational_block.block ->> 'type',
        'block_id', operational_block.block ->> 'id',
        'stable_source_page_id', case
          when operational_block.block ->> 'type' = 'booking'
            then operational_source_page_id
          else null
        end,
        'public_key', private.site_public_block_key_v2(
          requested_site_id, (operational_block.block ->> 'id')::uuid
        ),
        'action_key', operational_action_key,
        'definition_hash', operational_definition_hash,
        'booking_key', operational_block.block ->> 'booking_key',
        'preorder_key', operational_block.block ->> 'preorder_key',
        'config', case
          when operational_block.block ->> 'type' = 'booking'
            then coalesce(operational_block.block -> 'config', '{}'::jsonb)
          else coalesce((
            select experience.config_json
            from public.preorder_experiences as experience
            where experience.business_id = expected_business_id
              and experience.key = operational_block.block ->> 'preorder_key'
              and experience.is_active
            limit 1
          ), '{}'::jsonb)
        end,
        'frozen_offer', operational_frozen_offer
      )
    );
  end loop;
  projection := private.build_site_projection_v3(
    expected_business_id, requested_site_id, selected_state.draft_json,
    action_bundles
  );
  projection := private.site_project_operational_projection_v4(
    projection, operational_actions, release_token_value
  );
  if octet_length(convert_to(projection::text, 'UTF8')) > 524288 then
    raise exception 'site_projection_too_large' using errcode = '22023';
  end if;
  projection_checksum := encode(
    extensions.digest(convert_to(projection::text, 'UTF8'), 'sha256'),
    'hex'
  );
  review_metadata := private.build_site_review_metadata_v1(
    selected_state.draft_json
  ) || jsonb_build_object(
    'schema_version', 3,
    'legacy_source_checksum', selected_state.legacy_source_checksum,
    '_c3_draft_checksum', draft_checksum,
    '_c3_form_actions', action_bundles,
    '_c4_operational_actions', operational_actions
  );

  insert into public.site_releases (
    id, business_id, site_id, status, source_draft_revision,
    source_base_version_id, source_head_revision,
    expected_active_release_revision, configuration_change_set_id,
    projection_schema_version, projection_json, review_json,
    projection_checksum, release_token, prepared_by, expires_at
  ) values (
    prepared_release_id, expected_business_id, requested_site_id, 'prepared',
    selected_state.draft_revision, current_head.active_version_id,
    current_head.head_revision, selected_state.active_release_revision,
    case when all_operations = '[]'::jsonb then null else validated_change.id end,
    4, projection, review_metadata, projection_checksum,
    release_token_value, expected_actor_id,
    timezone('utc', now()) + interval '24 hours'
  ) returning * into prepared_release;
  perform private.site_sync_public_tokens_v2(
    expected_business_id, requested_site_id, prepared_release.id,
    selected_state.draft_json
  );
  return prepared_release;
end;
$$;


-- v4 release wrapper retaining the existing C3 materialisation path.
create or replace function public.publish_site_release_v4(
  expected_business_id uuid,
  expected_actor_id uuid,
  requested_site_id uuid,
  requested_candidate_id uuid,
  expected_draft_revision bigint,
  expected_base_version_id uuid,
  expected_head_revision bigint
)
returns public.site_releases
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_head public.business_configuration_heads;
  selected_change public.configuration_change_sets;
  selected_state public.site_states;
  selected_release public.site_releases;
  applied_change public.configuration_change_sets;
  action_bundle jsonb;
  normalized_draft jsonb;
  configuration_already_applied boolean := false;
  site_block record;
  source_page_id_value uuid;
  retained_source_page_id uuid;
  preorder_experience_id_value uuid;
  operational_action_key text;
  operational_action_json jsonb;
  operational_relationship_ids jsonb;
  operational_customer_binding jsonb;
  operational_offer jsonb;
  review_operational_action jsonb;
  existing_operational_action public.site_release_actions_v4;
begin
  if expected_business_id is null or expected_actor_id is null
    or requested_site_id is null or requested_candidate_id is null
    or expected_draft_revision is null or expected_draft_revision <= 0
    or expected_base_version_id is null or expected_head_revision is null
    or expected_head_revision <= 0
  then
    raise exception 'site_request_invalid' using errcode = '22023';
  end if;
  perform private.site_assert_actor_v1(expected_business_id, expected_actor_id);
  select * into current_head
  from public.business_configuration_heads
  where business_id = expected_business_id
  for update;
  if not found then
    raise exception 'configuration_head_not_found' using errcode = 'P0002';
  end if;
  select * into selected_release
  from public.site_releases
  where business_id = expected_business_id
    and site_id = requested_site_id
    and id = requested_candidate_id
  for update;
  if not found then
    raise exception 'site_release_not_found' using errcode = 'P0002';
  end if;
  if selected_release.projection_schema_version <> 4 then
    raise exception 'site_release_schema_unsupported' using errcode = '55000';
  end if;
  if selected_release.status in ('published', 'expired') then
    return selected_release;
  end if;
  if selected_release.status = 'prepared'
    and selected_release.expires_at <= timezone('utc', now())
  then
    update public.site_releases
    set status = 'expired'
    where business_id = expected_business_id
      and id = requested_candidate_id
    returning * into selected_release;
    return selected_release;
  end if;
  if selected_release.status <> 'prepared' then
    raise exception 'site_release_not_publishable' using errcode = '55000';
  end if;

  if selected_release.configuration_change_set_id is not null then
    select * into selected_change
    from public.configuration_change_sets
    where business_id = expected_business_id
      and id = selected_release.configuration_change_set_id
    for update;
    if not found
      or selected_change.base_version_id <> selected_release.source_base_version_id
      or selected_change.base_head_revision <> selected_release.source_head_revision
    then
      raise exception 'site_configuration_incompatible' using errcode = '23514';
    end if;
    if selected_change.status = 'applied' then
      if selected_change.applied_version_id <> current_head.active_version_id then
        raise exception 'site_configuration_stale' using errcode = 'P0001';
      end if;
      configuration_already_applied := true;
    elsif selected_change.status <> 'validated' then
      raise exception 'site_configuration_incompatible' using errcode = '23514';
    end if;
  end if;

  select * into selected_state
  from public.site_states
  where business_id = expected_business_id
    and id = requested_site_id
  for update;
  if not found then
    raise exception 'site_not_found' using errcode = 'P0002';
  end if;
  if selected_state.draft_revision <> expected_draft_revision
    or selected_release.source_draft_revision <> expected_draft_revision
  then
    raise exception 'site_draft_stale' using errcode = 'P0001';
  end if;
  if selected_state.active_release_revision
      <> selected_release.expected_active_release_revision
  then
    raise exception 'site_release_stale' using errcode = 'P0001';
  end if;
  if selected_state.draft_base_version_id <> selected_release.source_base_version_id
    or selected_state.draft_base_head_revision <> selected_release.source_head_revision
  then
    raise exception 'site_configuration_rebase_required' using errcode = 'P0001';
  end if;
  if (not configuration_already_applied and (
      current_head.active_version_id <> expected_base_version_id
      or current_head.head_revision <> expected_head_revision
    ))
    or selected_release.source_base_version_id <> expected_base_version_id
    or selected_release.source_head_revision <> expected_head_revision
  then
    raise exception 'site_configuration_stale' using errcode = 'P0001';
  end if;
  if selected_state.migration_state = 'new' and exists (
    select 1 from public.pages as page_value
    where page_value.business_id = expected_business_id
      and page_value.audience = 'public'
      and page_value.status = 'published'
      and page_value.is_active
  ) then
    raise exception 'site_adoption_required' using errcode = 'P0001';
  end if;
  if selected_state.migration_state = 'legacy_pending' then
    perform private.site_assert_adoption_source_v2(
      expected_business_id, requested_site_id,
      selected_state.legacy_source_checksum
    );
  end if;

  if selected_release.configuration_change_set_id is not null
    and not configuration_already_applied
  then
    perform pg_catalog.set_config('smbos.site_release_write', 'on', true);
    applied_change := public.apply_configuration_change_c1_v1(
      expected_business_id, expected_actor_id,
      selected_release.configuration_change_set_id
    );
    perform pg_catalog.set_config('smbos.site_release_write', 'off', true);
    if applied_change.status <> 'applied' then
      raise exception 'site_configuration_incompatible' using errcode = '23514';
    end if;
    selected_release.applied_version_id := applied_change.applied_version_id;
    select * into current_head
    from public.business_configuration_heads
    where business_id = expected_business_id;
  elsif configuration_already_applied then
    selected_release.applied_version_id := selected_change.applied_version_id;
  end if;

  -- Action rows have immediate canonical foreign keys by design.  They are
  -- inserted only after the candidate application above, never at Prepare.
  if jsonb_typeof(selected_release.review_json -> '_c3_form_actions')
      is distinct from 'array'
  then
    raise exception 'site_form_action_index_invalid' using errcode = '23514';
  end if;
  for action_bundle in select value from jsonb_array_elements(
    selected_release.review_json -> '_c3_form_actions'
  ) loop
    if action_bundle ->> 'release_token' <> selected_release.release_token
      or action_bundle ->> 'view_key' is null
      or action_bundle ->> 'view_id' is null
    then
      raise exception 'site_form_action_index_invalid' using errcode = '23514';
    end if;
    insert into public.site_release_actions_v3 (
      business_id, release_id, site_id, form_id, object_definition_id,
      form_key, view_id, view_key, action_key, release_token,
      action_json, field_bindings_json, customer_binding_json
    ) values (
      expected_business_id, selected_release.id, requested_site_id,
      (action_bundle ->> 'form_id')::uuid,
      (action_bundle ->> 'object_definition_id')::uuid,
      action_bundle ->> 'form_key', (action_bundle ->> 'view_id')::uuid,
      action_bundle ->> 'view_key', action_bundle ->> 'action_key',
      action_bundle ->> 'release_token', action_bundle -> 'action',
      action_bundle -> 'bindings',
      coalesce(action_bundle -> 'customer_binding', '{}'::jsonb)
    );
  end loop;

  perform private.site_bind_canonical_pages_v1(
    expected_business_id, requested_site_id, selected_state.draft_json
  );

  -- Retain operational source identities after canonical Page binding exists.
  -- This index is additive to the unchanged v3 Form rows.
  for site_block in
    select draft_block.page_id, draft_block.block
    from private.site_draft_blocks_v1(selected_state.draft_json) as draft_block
    where draft_block.block ->> 'type' in ('booking', 'preorder')
      and exists (
        select 1
        from jsonb_array_elements(selected_state.draft_json -> 'pages')
          as included_page(value)
        where (included_page.value ->> 'id')::uuid = draft_block.page_id
          and coalesce((included_page.value ->> 'is_included')::boolean, true)
      )
  loop
    retained_source_page_id := null;
    review_operational_action := null;
    select item.value
    into review_operational_action
    from jsonb_array_elements(
      coalesce(
        selected_release.review_json -> '_c4_operational_actions',
        '[]'::jsonb
      )
    ) as item(value)
    where item.value ->> 'block_id' = site_block.block ->> 'id'
      and item.value ->> 'kind' = site_block.block ->> 'type'
    limit 1;
    select nullif(item.value ->> 'stable_source_page_id', '')::uuid
    into retained_source_page_id
    from jsonb_array_elements(
      coalesce(
        selected_release.review_json -> '_c4_operational_actions',
        '[]'::jsonb
      )
    ) as item(value)
    where item.value ->> 'block_id' = site_block.block ->> 'id'
      and item.value ->> 'kind' = site_block.block ->> 'type'
      and item.value ->> 'stable_source_page_id' is not null
    limit 1;
    select coalesce(binding.legacy_source_page_id, binding.canonical_page_id)
    into source_page_id_value
    from public.site_page_bindings as binding
    where binding.business_id = expected_business_id
      and binding.site_id = requested_site_id
      and binding.draft_page_id = site_block.page_id;
    if site_block.block ->> 'type' = 'booking' then
      source_page_id_value := coalesce(
        retained_source_page_id, source_page_id_value,
        site_block.page_id
      );
      if source_page_id_value is null then
        raise exception 'site_operational_source_unavailable' using errcode = '23514';
      end if;
      operational_action_key := private.site_public_operational_action_key_v4(
        requested_site_id, 'booking', source_page_id_value,
        site_block.block ->> 'booking_key', null
      );
      operational_action_json := jsonb_build_object(
        'kind', 'booking',
        'booking_key', site_block.block ->> 'booking_key',
        'source_page_id', source_page_id_value,
        'config', coalesce(site_block.block -> 'config', '{}'::jsonb)
      );
      select coalesce(jsonb_agg(to_jsonb(relationship.id) order by relationship.id), '[]'::jsonb)
      into operational_relationship_ids
      from public.relationship_definitions as relationship
      where relationship.business_id = expected_business_id
        and relationship.key in (
          select value
          from jsonb_each_text(
            coalesce(site_block.block -> 'config' -> 'relationships', '{}'::jsonb)
          )
        )
        and relationship.is_active;
      operational_customer_binding := jsonb_build_object(
        'customer_object_key', site_block.block -> 'config' ->> 'customer_object_key',
        'email_field_key', site_block.block -> 'config' -> 'field_mappings' -> 'customer' ->> 'email',
        'relationship_key', site_block.block -> 'config' -> 'relationships' ->> 'customer_booking'
      );
      operational_offer := coalesce(site_block.block -> 'config' -> 'schedule', '{}'::jsonb);
      existing_operational_action := null;
      select * into existing_operational_action
      from public.site_release_actions_v4
      where business_id = expected_business_id
        and release_id = selected_release.id
        and action_key = operational_action_key;
      if found then
        if existing_operational_action.action_kind is distinct from 'booking'
          or existing_operational_action.source_page_id is distinct from source_page_id_value
          or existing_operational_action.booking_key is distinct from site_block.block ->> 'booking_key'
          or existing_operational_action.action_json is distinct from operational_action_json
          or existing_operational_action.relationship_ids_json is distinct from operational_relationship_ids
          or existing_operational_action.customer_binding_json is distinct from operational_customer_binding
          or existing_operational_action.offer_json is distinct from operational_offer
        then
          raise exception 'site_operational_action_conflict' using errcode = '23514';
        end if;
      else
        insert into public.site_release_actions_v4 (
          business_id, release_id, site_id, action_key, release_token,
          action_kind, source_page_id, booking_key, action_json,
          relationship_ids_json, customer_binding_json, offer_json
        ) values (
          expected_business_id, selected_release.id, requested_site_id,
          operational_action_key, selected_release.release_token, 'booking',
          source_page_id_value, site_block.block ->> 'booking_key',
          operational_action_json, operational_relationship_ids,
          operational_customer_binding, operational_offer
        );
      end if;
    else
      select experience.id into preorder_experience_id_value
      from public.preorder_experiences as experience
      where experience.business_id = expected_business_id
        and experience.key = site_block.block ->> 'preorder_key'
        and experience.is_active;
      if preorder_experience_id_value is null then
        raise exception 'site_operational_source_unavailable' using errcode = '23514';
      end if;
      operational_action_key := private.site_public_operational_action_key_v4(
        requested_site_id, 'preorder', null, null,
        preorder_experience_id_value
      );
      select experience.config_json,
        jsonb_build_object(
          'customer_places_order_relationship_definition_id',
          experience.customer_places_order_relationship_definition_id,
          'order_contains_item_relationship_definition_id',
          experience.order_contains_item_relationship_definition_id,
          'product_appears_in_item_relationship_definition_id',
          experience.product_appears_in_item_relationship_definition_id
        )
      into operational_action_json, operational_customer_binding
      from public.preorder_experiences as experience
      where experience.business_id = expected_business_id
        and experience.id = preorder_experience_id_value;
      operational_action_json := jsonb_build_object(
        'kind', 'preorder',
        'preorder_key', site_block.block ->> 'preorder_key',
        'experience_id', preorder_experience_id_value,
        'config', coalesce(operational_action_json, '{}'::jsonb)
      );
      operational_offer := review_operational_action -> 'frozen_offer';
      if jsonb_typeof(operational_offer) is distinct from 'object'
        or jsonb_typeof(operational_offer -> 'products') is distinct from 'array'
      then
        raise exception 'site_operational_offer_invalid' using errcode = '23514';
      end if;
      operational_action_json := operational_action_json || jsonb_build_object(
        'frozen_offer', operational_offer
      );
      select coalesce(jsonb_agg(to_jsonb(relationship.id) order by relationship.id), '[]'::jsonb)
      into operational_relationship_ids
      from public.relationship_definitions as relationship
      where relationship.business_id = expected_business_id
        and relationship.id in (
          (operational_customer_binding ->> 'customer_places_order_relationship_definition_id')::uuid,
          (operational_customer_binding ->> 'order_contains_item_relationship_definition_id')::uuid,
          (operational_customer_binding ->> 'product_appears_in_item_relationship_definition_id')::uuid
        )
        and relationship.is_active;
      operational_customer_binding := jsonb_build_object(
        'customer_object_definition_id', (
          select experience.customer_object_definition_id
          from public.preorder_experiences as experience
          where experience.id = preorder_experience_id_value
        ),
        'relationship_definition_id', operational_customer_binding -> 'customer_places_order_relationship_definition_id',
        'email_field_key', (
          select experience.config_json -> 'field_mappings' -> 'customer' ->> 'email'
          from public.preorder_experiences as experience
          where experience.id = preorder_experience_id_value
        )
      );
      existing_operational_action := null;
      select * into existing_operational_action
      from public.site_release_actions_v4
      where business_id = expected_business_id
        and release_id = selected_release.id
        and action_key = operational_action_key;
      if found then
        if existing_operational_action.action_kind is distinct from 'preorder'
          or existing_operational_action.preorder_experience_id is distinct from preorder_experience_id_value
          or existing_operational_action.action_json is distinct from operational_action_json
          or existing_operational_action.relationship_ids_json is distinct from operational_relationship_ids
          or existing_operational_action.customer_binding_json is distinct from operational_customer_binding
          or existing_operational_action.offer_json is distinct from operational_offer
        then
          raise exception 'site_operational_action_conflict' using errcode = '23514';
        end if;
      else
        insert into public.site_release_actions_v4 (
          business_id, release_id, site_id, action_key, release_token,
          action_kind, preorder_experience_id, action_json,
          relationship_ids_json, customer_binding_json, offer_json
        ) values (
          expected_business_id, selected_release.id, requested_site_id,
          operational_action_key, selected_release.release_token, 'preorder',
          preorder_experience_id_value, operational_action_json,
          operational_relationship_ids, operational_customer_binding,
          operational_offer
        );
      end if;
    end if;
  end loop;

  update public.site_releases
  set status = 'published',
    applied_version_id = selected_release.applied_version_id,
    published_by = expected_actor_id,
    published_at = timezone('utc', now())
  where business_id = expected_business_id
    and id = requested_candidate_id
  returning * into selected_release;

  normalized_draft := private.site_normalize_published_form_intents_v3(
    selected_state.draft_json,
    selected_release.review_json -> '_c3_form_actions'
  );
  normalized_draft := private.site_normalize_operational_source_ids_v4(
    normalized_draft,
    selected_release.review_json -> '_c4_operational_actions'
  );
  -- Publication normalizes successful Form/Object/Field intents so the next
  -- owner edit continues the same canonical identities. Treat that
  -- normalization as a real draft mutation: an in-flight autosave carrying
  -- the pre-publication revision must fail its existing CAS check instead of
  -- restoring the old `new` intents over the published destination.
  if normalized_draft is distinct from selected_state.draft_json then
    perform private.site_sync_draft_asset_references_v1(
      expected_business_id,
      requested_site_id,
      selected_state.draft_revision + 1,
      normalized_draft
    );
  end if;
  perform pg_catalog.set_config('smbos.site_release_write', 'on', true);
  update public.site_states
  set active_release_id = selected_release.id,
    active_release_revision = active_release_revision + 1,
    migration_state = 'adopted',
    draft_revision = selected_state.draft_revision + case
      when normalized_draft is distinct from selected_state.draft_json then 1
      else 0
    end,
    draft_json = normalized_draft,
    draft_base_version_id = coalesce(
      selected_release.applied_version_id, current_head.active_version_id
    ),
    draft_base_head_revision = current_head.head_revision,
    updated_at = timezone('utc', now())
  where business_id = expected_business_id
    and id = requested_site_id
    and draft_revision = selected_state.draft_revision
    and draft_base_version_id = selected_release.source_base_version_id
    and draft_base_head_revision = selected_release.source_head_revision
    and active_release_revision = selected_release.expected_active_release_revision
  returning * into selected_state;
  if not found then
    raise exception 'site_draft_stale' using errcode = 'P0001';
  end if;
  perform pg_catalog.set_config('smbos.site_release_write', 'off', true);
  return selected_release;
end;
$$;
-- Public delivery accepts v4 while retaining the v2/v3 projection parser.
create or replace function public.resolve_public_site_page(
  requested_business_slug text,
  requested_page_slug text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  business_value public.businesses;
  state_value public.site_states;
  release_value public.site_releases;
  page_value jsonb;
  delivered_page jsonb;
  navigation_value jsonb := '[]'::jsonb;
  nav_page jsonb;
  branding_value jsonb;
begin
  select business.* into business_value
  from public.businesses as business
  where business.slug = requested_business_slug;
  if not found then return null; end if;
  select * into state_value
  from public.site_states
  where business_id = business_value.id
    and migration_state = 'adopted';
  if not found or state_value.active_release_id is null then return null; end if;
  select * into release_value
  from public.site_releases
  where business_id = business_value.id
    and site_id = state_value.id
    and id = state_value.active_release_id
    and status = 'published'
    and projection_schema_version in (2, 3, 4);
  if not found then return null; end if;
  if release_value.projection_schema_version = 2 then
    return public.resolve_public_site_page_v2(
      requested_business_slug, requested_page_slug
    );
  end if;
  select value into page_value
  from jsonb_array_elements(release_value.projection_json -> 'pages') as item(value)
  where value ->> 'slug' = requested_page_slug
    and coalesce((value ->> 'is_included')::boolean, true)
  limit 1;
  if page_value is null then return null; end if;
  delivered_page := private.site_public_delivery_page_v3(
    business_value.id, state_value.id, release_value.id,
    state_value.active_release_revision, page_value
  );
  branding_value := release_value.projection_json -> 'branding';
  if branding_value ? 'logo_media_token'
    and not private.site_public_media_available_v2(
      business_value.id, state_value.id, state_value.active_release_revision,
      branding_value ->> 'logo_media_token'
    )
  then
    branding_value := branding_value - 'logo_media_token';
  end if;
  for nav_page in select value from jsonb_array_elements(
    release_value.projection_json -> 'pages'
  ) loop
    if coalesce((nav_page ->> 'is_in_navigation')::boolean, false) then
      navigation_value := navigation_value || jsonb_build_array(
        jsonb_build_object(
          'key', nav_page ->> 'public_key',
          'title', nav_page ->> 'title',
          'slug', nav_page ->> 'slug',
          'label', nav_page ->> 'navigation_label'
        )
      );
    end if;
  end loop;
  return jsonb_build_object(
    'business', jsonb_build_object(
      'name', business_value.name, 'slug', business_value.slug
    ),
    'site', jsonb_build_object(
      'schema_version', release_value.projection_schema_version,
      'branding', branding_value,
      'navigation', navigation_value
    ),
    'page', jsonb_build_object(
      'key', delivered_page ->> 'public_key',
      'title', delivered_page -> 'title',
      'slug', delivered_page -> 'slug',
      'navigation_label', delivered_page -> 'navigation_label',
      'is_home', delivered_page -> 'is_home',
      'is_in_navigation', delivered_page -> 'is_in_navigation',
      'layout', delivered_page -> 'layout'
    )
  );
end;
$$;

-- The C3 delivery projector predates operational actions and drops booking and
-- preorder blocks.  Keep the same availability filtering for Forms and the
-- same recursive container handling while retaining only the opaque v4
-- operational address in the public projection.
create or replace function private.site_public_delivery_block_v3(
  target_business_id uuid,
  target_site_id uuid,
  target_release_id uuid,
  target_release_revision bigint,
  block jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  child jsonb;
  projected jsonb;
  projected_children jsonb := '[]'::jsonb;
  projected_columns jsonb := '[]'::jsonb;
  column_value jsonb;
  column_blocks jsonb;
begin
  if block ->> 'type' = 'form' then
    if not private.site_public_form_block_available_v3(
      target_business_id, target_site_id, target_release_id,
      target_release_revision, block
    ) then
      return null;
    end if;
    return block;
  end if;
  if block ->> 'type' in ('booking', 'preorder') then
    if not exists (
      select 1
      from public.site_release_actions_v4 as action_row
      where action_row.business_id = target_business_id
        and action_row.site_id = target_site_id
        and action_row.release_id = target_release_id
        and action_row.action_key = block ->> 'action_key'
        and action_row.release_token = block ->> 'release_token'
        and action_row.action_kind = block ->> 'type'
    ) then
      return null;
    end if;
    return block;
  end if;
  if block ->> 'type' = 'collapsible' then
    for child in select value from jsonb_array_elements(
      coalesce(block -> 'blocks', '[]'::jsonb)
    ) loop
      projected := private.site_public_delivery_block_v3(
        target_business_id, target_site_id, target_release_id,
        target_release_revision, child
      );
      if projected is not null then
        projected_children := projected_children || jsonb_build_array(projected);
      end if;
    end loop;
    return (block - 'blocks') || jsonb_build_object(
      'blocks', projected_children
    );
  end if;
  if block ->> 'type' = 'section' then
    for column_value in select value from jsonb_array_elements(
      coalesce(block -> 'columns', '[]'::jsonb)
    ) loop
      column_blocks := '[]'::jsonb;
      for child in select value from jsonb_array_elements(
        coalesce(column_value -> 'blocks', '[]'::jsonb)
      ) loop
        projected := private.site_public_delivery_block_v3(
          target_business_id, target_site_id, target_release_id,
          target_release_revision, child
        );
        if projected is not null then
          column_blocks := column_blocks || jsonb_build_array(projected);
        end if;
      end loop;
      projected_columns := projected_columns || jsonb_build_array(
        (column_value - 'blocks') || jsonb_build_object(
          'blocks', column_blocks
        )
      );
    end loop;
    return (block - 'columns') || jsonb_build_object(
      'columns', projected_columns
    );
  end if;
  return private.site_public_delivery_block_v2(
    target_business_id, target_site_id, target_release_id,
    target_release_revision, block
  );
end;
$$;

revoke all on function private.site_public_delivery_block_v3(
  uuid, uuid, uuid, bigint, jsonb
) from public, anon, authenticated, service_role;

-- Treat v4 immutable Form actions as the same provenance boundary.
create or replace function private.site_form_created_object_proven_v3(
  target_business_id uuid,
  target_site_id uuid,
  target_form_key text,
  target_object_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.site_release_actions_v3 as action_row
    join public.site_releases as release_row
      on release_row.business_id = action_row.business_id
      and release_row.id = action_row.release_id
      and release_row.status = 'published'
      and release_row.projection_schema_version in (3, 4)
    where action_row.business_id = target_business_id
      and action_row.site_id = target_site_id
      and action_row.form_key = target_form_key
      and action_row.object_definition_id = target_object_id
  );
$$;

-- Treat v4 immutable Form actions as the same provenance boundary.
create or replace function private.site_form_created_form_proven_v3(
  target_business_id uuid,
  target_site_id uuid,
  target_form_key text,
  target_form_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.site_release_actions_v3 as action_row
    join public.site_releases as release_row
      on release_row.business_id = action_row.business_id
      and release_row.id = action_row.release_id
      and release_row.status = 'published'
      and release_row.projection_schema_version in (3, 4)
    where action_row.business_id = target_business_id
      and action_row.site_id = target_site_id
      and action_row.form_key = target_form_key
      and action_row.form_id = target_form_id
  );
$$;

-- Treat v4 immutable Form actions as the same provenance boundary.
create or replace function private.site_form_created_view_proven_v3(
  target_business_id uuid,
  target_site_id uuid,
  target_form_key text,
  target_view_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.site_release_actions_v3 as action_row
    join public.site_releases as release_row
      on release_row.business_id = action_row.business_id
      and release_row.id = action_row.release_id
      and release_row.status = 'published'
      and release_row.projection_schema_version in (3, 4)
    where action_row.business_id = target_business_id
      and action_row.site_id = target_site_id
      and action_row.form_key = target_form_key
      and action_row.view_id = target_view_id
  );
$$;
-- Customer reuse and deterministic Relationship locks for Booking.
create or replace function public.submit_public_booking_legacy(
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
  relationship_ids uuid[];
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

  -- Serialize the finite Relationship definitions before the legacy
  -- capacity/Record writes. The helper validates tenant ownership and locks
  -- the UUIDs in sorted order.
  select coalesce(array_agg(relationship.id order by relationship.id), '{}')
  into relationship_ids
  from public.relationship_definitions as relationship
  where relationship.business_id = business_id_value
    and relationship.key in (
      select value
      from jsonb_each_text(coalesce(block_config -> 'relationships', '{}'::jsonb))
      where value is not null and btrim(value) <> ''
    )
    and relationship.is_active;
  perform private.lock_relationship_definitions_v1(
    business_id_value, relationship_ids
  );

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
  where business.slug = requested_business_slug
    and page.id = (requested_frozen_action ->> 'source_page_id')::uuid
    and page.audience = 'public'
    and page.status = 'published'
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
    where business_id = business_id_value and id = action_row.source_page_id
      and audience = 'public' and status = 'published' and is_active;
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

-- v4 catalogues use the immutable action configuration.  The legacy
-- resolver reads the mutable Page block and therefore cannot be used for an
-- adopted Site after a later owner edit.
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
  where page.business_id = business_value.id
    and page.id = requested_source_page_id
    and page.audience = 'public'
    and page.status = 'published'
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

create or replace function private.resolve_site_preorder_catalogue_v4(
  requested_business_slug text,
  requested_page_slug text,
  requested_preorder_key text,
  requested_experience_id uuid,
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
  page_projection jsonb;
  experience public.preorder_experiences;
  location_value public.locations;
  product_value public.records;
  frozen_product jsonb;
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
  frozen_products jsonb;
  reference_now timestamptz := statement_timestamp();
begin
  if requested_frozen_action is null
    or jsonb_typeof(requested_frozen_action) is distinct from 'object'
    or requested_frozen_action ->> 'kind' <> 'preorder'
    or requested_frozen_action ->> 'preorder_key' <> requested_preorder_key
    or requested_frozen_action ->> 'experience_id'
      is distinct from requested_experience_id::text
  then
    return null;
  end if;
  select business.*
  into business_value
  from public.businesses as business
  where business.slug = requested_business_slug;
  -- The public URL is the immutable Site projection address.  A Site's
  -- canonical Page has an opaque internal slug, so consulting mutable legacy
  -- Page rows here would reject a valid preorder release (and would make an
  -- old Page edit affect the published action).  The action resolver has
  -- already checked the same active release and Page/action membership; use
  -- that release projection for the bounded display metadata.
  select projected_page.value
  into page_projection
  from public.site_states as state
  join public.site_releases as release
    on release.business_id = state.business_id
    and release.site_id = state.id
    and release.id = state.active_release_id
    and release.status = 'published'
    and release.projection_schema_version = 4
  cross join lateral jsonb_array_elements(
    coalesce(release.projection_json -> 'pages', '[]'::jsonb)
  ) as projected_page(value)
  where state.business_id = business_value.id
    and state.migration_state = 'adopted'
    and projected_page.value ->> 'slug' = requested_page_slug
  limit 1;
  select configured_experience.*
  into experience
  from public.preorder_experiences as configured_experience
  where configured_experience.business_id = business_value.id
    and configured_experience.id = requested_experience_id
    and configured_experience.key = requested_preorder_key
    and configured_experience.is_active;
  if business_value.id is null or page_projection is null
    or experience.id is null
  then
    return null;
  end if;
  config := requested_frozen_action -> 'config';
  frozen_products := requested_frozen_action -> 'frozen_offer' -> 'products';
  if jsonb_typeof(frozen_products) is distinct from 'array' then
    return null;
  end if;
  schedule := config -> 'schedule';
  product_name_key := private.preorder_mapping_key(config, 'product', 'name');
  product_description_key := private.preorder_mapping_key(
    config, 'product', 'description'
  );
  product_price_key := private.preorder_mapping_key(config, 'product', 'price');
  product_image_key := private.preorder_mapping_key(config, 'product', 'image');
  product_status_key := private.preorder_mapping_key(config, 'product', 'status');
  active_status := config -> 'field_mappings' -> 'product' ->> 'active_status_value';
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
          'date', to_char(candidate.local_date, 'YYYY-MM-DD'),
          'time', to_char(candidate.local_time, 'HH24:MI'),
          'collection_at', candidate.collection_at,
          'available', coalesce(counter.reservation_count, 0)
            < (schedule ->> 'slot_capacity')::integer,
          'remaining', greatest(
            (schedule ->> 'slot_capacity')::integer
              - coalesce(counter.reservation_count, 0),
            0
          )
        ) order by candidate.collection_at
      ),
      '[]'::jsonb
    )
    into location_slots
    from (
      select generated_day.local_date,
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
          0, (schedule ->> 'booking_horizon_days')::integer
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
        from jsonb_array_elements(schedule -> 'days_of_week') as configured_day
      )
    ) as candidate
    left join public.preorder_slot_counters as counter
      on counter.business_id = business_value.id
      and counter.preorder_experience_id = experience.id
      and counter.location_id = location_value.id
      and counter.collection_at = candidate.collection_at
    where private.preorder_slot_is_configured(
      schedule, location_value.timezone, candidate.collection_at, reference_now
    );
    locations_json := locations_json || jsonb_build_array(
      jsonb_build_object(
        'id', location_value.id,
        'name', location_value.name,
        'timezone', location_value.timezone,
        'slots', location_slots
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
        from jsonb_array_elements(frozen_products) as frozen(value)
        where frozen.value ->> 'id' = record_value.id::text
      )
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
    select frozen.value
    into frozen_product
    from jsonb_array_elements(frozen_products) as frozen(value)
    where frozen.value ->> 'id' = product_value.id::text;
    if frozen_product is null then
      continue;
    end if;
    begin
      price_value := (frozen_product ->> 'price')::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        continue;
    end;
    if price_value <= 0 or price_value > 999999.99
      or round(price_value, 2) <> price_value
    then
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
    product_image := frozen_product -> 'image_url';
    products_json := products_json || jsonb_build_array(
      jsonb_strip_nulls(jsonb_build_object(
        'id', product_value.id,
        'name', frozen_product ->> 'name',
        'description', frozen_product ->> 'description',
        'price', price_value,
        'image_url', product_image,
        'location_ids', product_locations
      ))
    );
  end loop;
  for public_field in
    select value from jsonb_array_elements(config -> 'public_fields')
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
        jsonb_strip_nulls(jsonb_build_object(
          'target', public_field ->> 'target',
          'field', field_definition.key,
          'label', public_field ->> 'label',
          'required', (public_field ->> 'required')::boolean,
          'help_text', public_field -> 'help_text',
          'autocomplete', public_field -> 'autocomplete',
          'field_type', field_definition.field_type,
          'options', case
            when field_definition.field_type in ('select', 'multi_select')
              then field_definition.settings_json -> 'options'
            else null
          end
        ))
      );
    end if;
  end loop;
  return jsonb_build_object(
    'business', jsonb_build_object(
      'name', business_value.name, 'slug', business_value.slug
    ),
    'page', jsonb_build_object(
      'title', coalesce(page_projection ->> 'title', requested_page_slug),
      'slug', requested_page_slug
    ),
    'preorder', jsonb_build_object(
      'key', experience.key,
      'currency', coalesce(price_field.settings_json ->> 'currency', 'GBP'),
      'schedule', jsonb_build_object(
        'days_of_week', schedule -> 'days_of_week',
        'start_time', schedule -> 'start_time',
        'end_time', schedule -> 'end_time',
        'slot_interval_minutes', schedule -> 'slot_interval_minutes',
        'slot_capacity', schedule -> 'slot_capacity',
        'cutoff_hours', schedule -> 'cutoff_hours',
        'booking_horizon_days', schedule -> 'booking_horizon_days'
      ),
      'locations', locations_json,
      'products', products_json,
      'public_fields', public_fields_json
    ),
    'generated_at', reference_now
  );
end;
$$;

revoke all on function private.resolve_site_preorder_catalogue_v4(
  text, text, text, uuid, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.resolve_public_site_operational_action_v4(
  requested_business_slug text,
  requested_page_slug text,
  requested_action_key text,
  requested_release_token text
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select case when result.value is null then null::jsonb else jsonb_build_object(
    'kind', result.value ->> 'action_kind',
    'action_key', result.value ->> 'action_key',
    'release_token', result.value ->> 'release_token',
    'action', case result.value ->> 'action_kind'
      when 'booking' then jsonb_build_object(
        'kind', 'booking',
        'booking_key', result.value -> 'action' -> 'booking_key'
      )
      when 'preorder' then jsonb_build_object(
        'kind', 'preorder',
        'preorder_key', result.value -> 'action' -> 'preorder_key'
      )
      else '{}'::jsonb
    end,
    'catalogue', case result.value ->> 'action_kind'
      when 'booking' then private.resolve_site_booking_catalogue_v4(
        requested_business_slug,
        (result.value ->> 'page_id')::uuid,
        result.value ->> 'booking_key',
        result.value -> 'action'
      )
      when 'preorder' then private.resolve_site_preorder_catalogue_v4(
        requested_business_slug,
        requested_page_slug,
        result.value ->> 'preorder_key',
        (result.value ->> 'preorder_experience_id')::uuid,
        result.value -> 'action'
      )
      else null::jsonb
    end
  ) end
  from private.resolve_site_public_operational_action_v4(
    requested_business_slug, requested_page_slug, requested_action_key,
    requested_release_token, false
  ) as result(value);
$$;

revoke all on function public.resolve_public_site_operational_action_v4(
  text, text, text, text
) from public, authenticated;
grant execute on function public.resolve_public_site_operational_action_v4(
  text, text, text, text
) to anon, authenticated;

-- A v4 retry is bound to the immutable source action and its canonical
-- submission.  The action address is intentionally excluded from this digest:
-- a republish may issue a new opaque address while the original receipt remains
-- the authority for an uncertain response.
create or replace function private.site_operational_submission_digest_v4(
  frozen_action jsonb,
  canonical_submission jsonb
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'frozen_action', coalesce(frozen_action, '{}'::jsonb),
          'submission', coalesce(canonical_submission, '{}'::jsonb)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;
revoke all on function private.site_operational_submission_digest_v4(jsonb, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.submit_public_site_booking_v4(
  requested_business_slug text,
  requested_page_slug text,
  requested_action_key text,
  requested_release_token text,
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
  resolved jsonb;
  business_id_value uuid;
  source_page_id_value uuid;
  source_page_slug_value text;
  booking_key_value text;
  existing_submission public.booking_submissions;
  result jsonb;
  request_digest_value text;
  stable_source_key_value text;
  frozen_action_value jsonb;
begin
  if requested_idempotency_token is null
    or requested_submission is null
    or jsonb_typeof(requested_submission) is distinct from 'object'
    or octet_length(requested_submission::text) > 65536
    or requested_request_hash is null
    or requested_request_hash !~ '^[a-f0-9]{64}$'
  then
    return jsonb_build_object('ok', false, 'code', 'invalid_submission');
  end if;
  select id into business_id_value from public.businesses
  where slug = requested_business_slug;
  if business_id_value is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  -- A receipt may outlive its release.  Bootstrap the stable source from the
  -- old action address without locking on that address, then serialize by
  -- source tuple + token.  A new release can discover the same source after
  -- resolving its current action and will take the same lock.
  select * into existing_submission
  from public.booking_submissions
  where business_id = business_id_value
    and action_key = requested_action_key
    and idempotency_token = requested_idempotency_token;
  if found then
    stable_source_key_value := coalesce(
      existing_submission.stable_source_key,
      'booking:' || existing_submission.page_id::text || ':'
        || existing_submission.booking_key
    );
  else
    resolved := private.resolve_site_public_operational_action_v4(
      requested_business_slug, requested_page_slug, requested_action_key,
      requested_release_token, false
    );
    if resolved is not null then
      stable_source_key_value := 'booking:' || (resolved ->> 'page_id')
        || ':' || (resolved ->> 'booking_key');
    end if;
  end if;
  if stable_source_key_value is null then
    return jsonb_build_object('ok', false, 'code', 'action_unavailable');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      business_id_value::text || ':' || stable_source_key_value || ':'
        || requested_idempotency_token::text,
      0
    )
  );
  select * into existing_submission
  from public.booking_submissions
  where business_id = business_id_value
    and (
      stable_source_key = stable_source_key_value
      or (
        stable_source_key is null
        and stable_source_key_value = 'booking:' || page_id::text || ':'
          || booking_key
      )
    )
    and idempotency_token = requested_idempotency_token;
  if found then
    if existing_submission.frozen_action_json is null
      or existing_submission.request_digest is null then
      if existing_submission.action_key is not null then
        return jsonb_build_object('ok', false, 'code', 'retry');
      end if;
      return jsonb_build_object(
        'ok', true, 'idempotent', true,
        'confirmation', existing_submission.confirmation_json
      );
    end if;
    request_digest_value := private.site_operational_submission_digest_v4(
      existing_submission.frozen_action_json,
      requested_submission
    );
    if existing_submission.request_digest is distinct from request_digest_value then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
    return jsonb_build_object(
      'ok', true, 'idempotent', true,
      'confirmation', existing_submission.confirmation_json
    );
  end if;
  resolved := private.resolve_site_public_operational_action_v4(
    requested_business_slug, requested_page_slug, requested_action_key,
    requested_release_token, true
  );
  if resolved is null or resolved ->> 'action_kind' <> 'booking' then
    return jsonb_build_object('ok', false, 'code', 'action_unavailable');
  end if;
  source_page_id_value := (resolved ->> 'page_id')::uuid;
  source_page_slug_value := resolved ->> 'source_page_slug';
  booking_key_value := resolved ->> 'booking_key';
  if source_page_id_value is null or source_page_slug_value is null
    or booking_key_value is null then
    return jsonb_build_object('ok', false, 'code', 'action_unavailable');
  end if;
  stable_source_key_value := 'booking:' || source_page_id_value::text || ':'
    || booking_key_value;
  -- The read above is only the source bootstrap.  Recheck the stable tuple
  -- after the authority lock so a concurrent writer cannot create a second
  -- receipt under a new action address.
  select * into existing_submission
  from public.booking_submissions
  where business_id = business_id_value
    and (
      stable_source_key = stable_source_key_value
      or (
        stable_source_key is null
        and page_id = source_page_id_value
        and booking_key = booking_key_value
      )
    )
    and idempotency_token = requested_idempotency_token;
  if found then
    if existing_submission.frozen_action_json is null
      or existing_submission.request_digest is null then
      if existing_submission.action_key is not null then
        return jsonb_build_object('ok', false, 'code', 'retry');
      end if;
      return jsonb_build_object(
        'ok', true, 'idempotent', true,
        'confirmation', existing_submission.confirmation_json
      );
    end if;
    request_digest_value := private.site_operational_submission_digest_v4(
      existing_submission.frozen_action_json,
      requested_submission
    );
    if existing_submission.request_digest = request_digest_value then
      return jsonb_build_object(
        'ok', true, 'idempotent', true,
        'confirmation', existing_submission.confirmation_json
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;
  result := private.submit_public_booking_core_v4(
    requested_business_slug,
    requested_page_slug,
    booking_key_value,
    requested_idempotency_token,
    requested_submission,
    requested_request_hash,
    (resolved -> 'action') || jsonb_build_object(
      'action_key', resolved ->> 'action_key',
      'release_id', resolved ->> 'release_id',
      'release_token', resolved ->> 'release_token'
    )
  );
  if coalesce((result ->> 'ok')::boolean, false)
    and not coalesce((result ->> 'idempotent')::boolean, false) then
    frozen_action_value := (resolved -> 'action') || jsonb_build_object(
      'action_key', resolved ->> 'action_key',
      'release_id', resolved ->> 'release_id',
      'customer_binding', coalesce(resolved -> 'customer_binding', '{}'::jsonb)
    );
    request_digest_value := private.site_operational_submission_digest_v4(
      frozen_action_value,
      requested_submission
    );
    update public.booking_submissions
    set action_key = requested_action_key,
      release_id = (resolved ->> 'release_id')::uuid,
      source_page_id = source_page_id_value,
      stable_source_key = stable_source_key_value,
      canonical_submission = requested_submission,
      frozen_action_json = frozen_action_value,
      request_digest = request_digest_value
    where business_id = business_id_value
      and page_id = source_page_id_value
      and booking_key = booking_key_value
      and idempotency_token = requested_idempotency_token;
  end if;
  return result;
exception when unique_violation then
  select * into existing_submission
  from public.booking_submissions
  where business_id = business_id_value
    and stable_source_key = stable_source_key_value
    and idempotency_token = requested_idempotency_token;
  if found then
    if existing_submission.frozen_action_json is null
      or existing_submission.request_digest is null then
      if existing_submission.action_key is not null then
        return jsonb_build_object('ok', false, 'code', 'retry');
      end if;
      return jsonb_build_object(
        'ok', true, 'idempotent', true,
        'confirmation', existing_submission.confirmation_json
      );
    end if;
    request_digest_value := private.site_operational_submission_digest_v4(
      existing_submission.frozen_action_json,
      requested_submission
    );
    if existing_submission.request_digest = request_digest_value then
      return jsonb_build_object(
        'ok', true, 'idempotent', true,
        'confirmation', existing_submission.confirmation_json
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;
  return jsonb_build_object('ok', false, 'code', 'rejected');
end;
$$;

create or replace function public.submit_public_site_preorder_v4(
  requested_business_slug text,
  requested_page_slug text,
  requested_action_key text,
  requested_release_token text,
  requested_idempotency_token uuid,
  submission jsonb,
  requested_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved jsonb;
  business_id_value uuid;
  experience_id_value uuid;
  preorder_key_value text;
  existing_submission public.preorder_submissions;
  result jsonb;
  request_digest_value text;
  stable_source_key_value text;
  frozen_action_value jsonb;
begin
  if requested_idempotency_token is null
    or submission is null
    or jsonb_typeof(submission) is distinct from 'object'
    or octet_length(submission::text) > 65536
    or requested_request_hash is null
    or requested_request_hash !~ '^[a-f0-9]{64}$'
  then
    return jsonb_build_object('ok', false, 'code', 'invalid_submission');
  end if;
  select id into business_id_value from public.businesses
  where slug = requested_business_slug;
  if business_id_value is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  -- Resolve the stable Experience source before taking the idempotency lock.
  -- Receipt lookup remains valid after a release is republished or withdrawn;
  -- the current action address is never the lock identity.
  select * into existing_submission
  from public.preorder_submissions
  where business_id = business_id_value
    and action_key = requested_action_key
    and idempotency_token = requested_idempotency_token;
  if found then
    stable_source_key_value := coalesce(
      existing_submission.stable_source_key,
      'preorder:' || existing_submission.preorder_experience_id::text
    );
  else
    resolved := private.resolve_site_public_operational_action_v4(
      requested_business_slug, requested_page_slug, requested_action_key,
      requested_release_token, false
    );
    if resolved is not null then
      stable_source_key_value := 'preorder:'
        || (resolved ->> 'preorder_experience_id');
    end if;
  end if;
  if stable_source_key_value is null then
    return jsonb_build_object('ok', false, 'code', 'action_unavailable');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      business_id_value::text || ':' || stable_source_key_value || ':'
        || requested_idempotency_token::text,
      0
    )
  );
  select * into existing_submission
  from public.preorder_submissions
  where business_id = business_id_value
    and (
      stable_source_key = stable_source_key_value
      or (
        stable_source_key is null
        and stable_source_key_value = 'preorder:' || preorder_experience_id::text
      )
    )
    and idempotency_token = requested_idempotency_token;
  if found then
    if existing_submission.frozen_action_json is null
      or existing_submission.request_digest is null then
      if existing_submission.action_key is not null then
        return jsonb_build_object('ok', false, 'code', 'retry');
      end if;
      return jsonb_build_object(
        'ok', true, 'idempotent', true,
        'confirmation', existing_submission.confirmation_json
      );
    end if;
    request_digest_value := private.site_operational_submission_digest_v4(
      existing_submission.frozen_action_json, submission
    );
    if existing_submission.request_digest is distinct from request_digest_value then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
    return jsonb_build_object(
      'ok', true, 'idempotent', true,
      'confirmation', existing_submission.confirmation_json
    );
  end if;
  resolved := private.resolve_site_public_operational_action_v4(
    requested_business_slug, requested_page_slug, requested_action_key,
    requested_release_token, true
  );
  if resolved is null or resolved ->> 'action_kind' <> 'preorder' then
    return jsonb_build_object('ok', false, 'code', 'action_unavailable');
  end if;
  experience_id_value := (resolved ->> 'preorder_experience_id')::uuid;
  preorder_key_value := resolved ->> 'preorder_key';
  if experience_id_value is null or preorder_key_value is null then
    return jsonb_build_object('ok', false, 'code', 'action_unavailable');
  end if;
  stable_source_key_value := 'preorder:' || experience_id_value::text;
  select * into existing_submission
  from public.preorder_submissions
  where business_id = business_id_value
    and (
      stable_source_key = stable_source_key_value
      or (
        stable_source_key is null
        and preorder_experience_id = experience_id_value
      )
    )
    and idempotency_token = requested_idempotency_token;
  if found then
    if existing_submission.frozen_action_json is null
      or existing_submission.request_digest is null then
      if existing_submission.action_key is not null then
        return jsonb_build_object('ok', false, 'code', 'retry');
      end if;
      return jsonb_build_object(
        'ok', true, 'idempotent', true,
        'confirmation', existing_submission.confirmation_json
      );
    end if;
    request_digest_value := private.site_operational_submission_digest_v4(
      existing_submission.frozen_action_json, submission
    );
    if existing_submission.request_digest = request_digest_value then
      return jsonb_build_object(
        'ok', true, 'idempotent', true,
        'confirmation', existing_submission.confirmation_json
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;
  result := private.submit_public_site_preorder_core_v4(
    requested_business_slug,
    requested_page_slug,
    preorder_key_value,
    submission,
    requested_request_hash,
    (resolved -> 'action') || jsonb_build_object(
      'action_key', resolved ->> 'action_key',
      'release_id', resolved ->> 'release_id',
      'release_token', resolved ->> 'release_token'
    )
  );
  if coalesce((result ->> 'ok')::boolean, false)
    and not coalesce((result ->> 'idempotent')::boolean, false) then
    frozen_action_value := (resolved -> 'action') || jsonb_build_object(
      'action_key', resolved ->> 'action_key',
      'release_id', resolved ->> 'release_id',
      'customer_binding', coalesce(resolved -> 'customer_binding', '{}'::jsonb)
    );
    request_digest_value := private.site_operational_submission_digest_v4(
      frozen_action_value,
      submission
    );
    update public.preorder_submissions
    set action_key = requested_action_key,
      release_id = (resolved ->> 'release_id')::uuid,
      stable_source_key = stable_source_key_value,
      canonical_submission = submission,
      frozen_action_json = frozen_action_value,
      request_digest = request_digest_value
    where business_id = business_id_value
      and preorder_experience_id = experience_id_value
      and idempotency_token = requested_idempotency_token;
  end if;
  return result;
exception when unique_violation then
  select * into existing_submission
  from public.preorder_submissions
  where business_id = business_id_value
    and stable_source_key = stable_source_key_value
    and idempotency_token = requested_idempotency_token;
  if found then
    if existing_submission.frozen_action_json is null
      or existing_submission.request_digest is null then
      if existing_submission.action_key is not null then
        return jsonb_build_object('ok', false, 'code', 'retry');
      end if;
      return jsonb_build_object(
        'ok', true, 'idempotent', true,
        'confirmation', existing_submission.confirmation_json
      );
    end if;
    request_digest_value := private.site_operational_submission_digest_v4(
      existing_submission.frozen_action_json, submission
    );
    if existing_submission.request_digest = request_digest_value then
      return jsonb_build_object(
        'ok', true, 'idempotent', true,
        'confirmation', existing_submission.confirmation_json
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;
  return jsonb_build_object('ok', false, 'code', 'rejected');
end;
$$;

revoke all on function public.submit_public_site_booking_v4(
  text, text, text, text, uuid, jsonb, text
), public.submit_public_site_preorder_v4(
  text, text, text, text, uuid, jsonb, text
) from public, anon, authenticated;
grant execute on function public.submit_public_site_booking_v4(
  text, text, text, text, uuid, jsonb, text
), public.submit_public_site_preorder_v4(
  text, text, text, text, uuid, jsonb, text
) to service_role;

-- Owner review is receipt-local.  It never changes the selected Customer's
-- profile and never rewrites the immutable original match metadata.
create or replace function private.site_relink_customer_activity_v1(
  target_business_id uuid,
  activity_record_id uuid,
  requested_customer_record_id uuid,
  relationship_definition_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  relationship public.relationship_definitions;
  activity public.records;
  customer public.records;
  relink_source_record_id uuid;
  relink_target_record_id uuid;
begin
  perform private.lock_relationship_definitions_v1(
    target_business_id, array[relationship_definition_id]
  );
  select * into relationship
  from public.relationship_definitions
  where business_id = target_business_id
    and id = relationship_definition_id
    and is_active;
  if not found then
    raise exception 'site_customer_relationship_unavailable' using errcode = 'P0002';
  end if;
  if activity_record_id < requested_customer_record_id then
    select * into activity from public.records
    where records.business_id = target_business_id
      and records.id = activity_record_id
    for update;
    select * into customer from public.records
    where records.business_id = target_business_id
      and records.id = requested_customer_record_id
    for update;
  else
    select * into customer from public.records
    where records.business_id = target_business_id
      and records.id = requested_customer_record_id
    for update;
    select * into activity from public.records
    where records.business_id = target_business_id
      and records.id = activity_record_id
    for update;
  end if;
  if activity.id is null or activity.record_status <> 'active'::public.graph_record_status
    or customer.id is null or customer.record_status <> 'active'::public.graph_record_status
  then
    raise exception 'site_customer_record_unavailable' using errcode = 'P0002';
  end if;
  if relationship.source_object_definition_id = customer.object_definition_id
    and relationship.target_object_definition_id = activity.object_definition_id
  then
    relink_source_record_id := customer.id;
    relink_target_record_id := activity.id;
  elsif relationship.source_object_definition_id = activity.object_definition_id
    and relationship.target_object_definition_id = customer.object_definition_id
  then
    relink_source_record_id := activity.id;
    relink_target_record_id := customer.id;
  else
    raise exception 'site_customer_relationship_invalid' using errcode = '23514';
  end if;
  delete from public.record_relationships as edge
  where edge.business_id = target_business_id
    and edge.relationship_definition_id = relationship.id
    and (edge.source_record_id = activity.id or edge.target_record_id = activity.id);
  insert into public.record_relationships (
    business_id, relationship_definition_id, source_record_id, target_record_id
  ) values (
    target_business_id, relationship.id,
    relink_source_record_id, relink_target_record_id
  );
end;
$$;

revoke all on function private.site_relink_customer_activity_v1(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.site_customer_profile_context_v1(
  target_business_id uuid,
  candidate_ids uuid[]
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', candidate.id,
      'label', coalesce(
        nullif(candidate.data_json ->> 'name', ''),
        nullif(candidate.data_json ->> 'full_name', ''),
        nullif(candidate.data_json ->> 'display_name', ''),
        nullif(candidate.data_json ->> 'email', ''),
        'Customer'
      ),
      'profile', candidate.data_json
    ) order by candidate.created_at, candidate.id
  ), '[]'::jsonb)
  from public.records as candidate
  where candidate.business_id = target_business_id
    and candidate.id = any(coalesce(candidate_ids, '{}'::uuid[]))
    and candidate.record_status = 'active'::public.graph_record_status;
$$;
revoke all on function private.site_customer_profile_context_v1(uuid, uuid[])
  from public, anon, authenticated, service_role;

create or replace function public.list_site_customer_resolution_cases(
  expected_business_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if expected_business_id is null
    or not private.can_manage_tenant(expected_business_id)
  then
    raise exception 'site_customer_review_forbidden' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(item order by item ->> 'created_at'), '[]'::jsonb)
  into result
  from (
    select item
    from (
      select jsonb_build_object(
      'kind', 'form', 'receipt_id', submission.id,
      'public_reference', submission.public_reference,
      'created_at', submission.created_at,
      'match_identity', submission.customer_match_identity,
      'match_count', submission.customer_match_count,
      'candidate_ids', to_jsonb(submission.customer_candidate_ids),
      'candidate_profiles', private.site_customer_profile_context_v1(
        expected_business_id, submission.customer_candidate_ids
      ),
      'original_customer_record_id', submission.original_customer_record_id,
      'customer_record_id', submission.customer_record_id,
      'resolution_state', submission.customer_resolution_state,
      'resolution_revision', submission.customer_resolution_revision,
      'submitted_details', coalesce(submission.canonical_answers, '{}'::jsonb)
      ) as item
      from public.public_form_submissions as submission
      where submission.business_id = expected_business_id
        and coalesce(submission.customer_match_count, 0) > 1
      union all
      select jsonb_build_object(
      'kind', 'booking', 'receipt_id', submission.id,
      'public_reference', submission.public_reference,
      'created_at', submission.created_at,
      'match_identity', submission.customer_match_identity,
      'match_count', submission.customer_match_count,
      'candidate_ids', to_jsonb(submission.customer_candidate_ids),
      'candidate_profiles', private.site_customer_profile_context_v1(
        expected_business_id, submission.customer_candidate_ids
      ),
      'original_customer_record_id', submission.original_customer_record_id,
      'customer_record_id', submission.customer_record_id,
      'resolution_state', submission.customer_resolution_state,
      'resolution_revision', submission.customer_resolution_revision,
      'submitted_details', coalesce(submission.canonical_submission, '{}'::jsonb)
      ) as item
      from public.booking_submissions as submission
      where submission.business_id = expected_business_id
        and coalesce(submission.customer_match_count, 0) > 1
      union all
      select jsonb_build_object(
      'kind', 'preorder', 'receipt_id', submission.id,
      'public_reference', submission.public_reference,
      'created_at', submission.created_at,
      'match_identity', submission.customer_match_identity,
      'match_count', submission.customer_match_count,
      'candidate_ids', to_jsonb(submission.customer_candidate_ids),
      'candidate_profiles', private.site_customer_profile_context_v1(
        expected_business_id, submission.customer_candidate_ids
      ),
      'original_customer_record_id', submission.original_customer_record_id,
      'customer_record_id', submission.customer_record_id,
      'resolution_state', submission.customer_resolution_state,
      'resolution_revision', submission.customer_resolution_revision,
      'submitted_details', coalesce(submission.canonical_submission, '{}'::jsonb)
      ) as item
      from public.preorder_submissions as submission
      where submission.business_id = expected_business_id
        and coalesce(submission.customer_match_count, 0) > 1
    ) as all_cases(item)
    order by item ->> 'created_at'
    limit 100
  ) as cases;
  return result;
end;
$$;

revoke all on function public.list_site_customer_resolution_cases(uuid)
  from public, anon;
grant execute on function public.list_site_customer_resolution_cases(uuid)
  to authenticated;

create or replace function public.resolve_site_customer_resolution_case(
  expected_business_id uuid,
  receipt_kind text,
  receipt_id uuid,
  expected_resolution_revision bigint,
  requested_customer_record_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  activity_record_id uuid;
  relationship_definition_id uuid;
  customer_object_id uuid;
  frozen_action jsonb;
  receipt_revision bigint;
  original_customer_id uuid;
  current_customer_id uuid;
begin
  if actor_id is null
    or expected_business_id is null
    or receipt_id is null
    or requested_customer_record_id is null
    or expected_resolution_revision is null
    or expected_resolution_revision < 0
    or receipt_kind not in ('form', 'booking', 'preorder')
    or not private.can_manage_tenant(expected_business_id)
  then
    raise exception 'site_customer_review_forbidden' using errcode = '42501';
  end if;

  -- Match the public writers' authority order before locking the receipt:
  -- advisory identity, configuration head, Business, Site, then receipt.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      expected_business_id::text || ':customer-review:' || receipt_kind || ':'
        || receipt_id::text,
      0
    )
  );
  perform 1
  from public.business_configuration_heads as configuration_head
  where configuration_head.business_id = expected_business_id
  for share;
  perform 1
  from public.businesses as business_value
  where business_value.id = expected_business_id
  for update;
  perform 1
  from public.site_states as site_state
  where site_state.business_id = expected_business_id
  order by site_state.id
  limit 1
  for share;

  if receipt_kind = 'form' then
    select submission.record_id, submission.customer_resolution_revision,
      submission.original_customer_record_id, submission.customer_record_id,
      submission.action_json
    into activity_record_id, receipt_revision, original_customer_id,
      current_customer_id, frozen_action
    from public.public_form_submissions as submission
    where submission.business_id = expected_business_id and submission.id = receipt_id
    for update;
    if activity_record_id is null then
      raise exception 'site_customer_review_case_not_found' using errcode = 'P0002';
    end if;
    select object_definition.id into customer_object_id
    from public.object_definitions as object_definition
    where object_definition.business_id = expected_business_id
      and object_definition.key = frozen_action -> 'customer_binding' ->> 'customer_object_key'
      and object_definition.is_active;
    select relationship.id into relationship_definition_id
    from public.relationship_definitions as relationship
    where relationship.business_id = expected_business_id
      and relationship.key = frozen_action -> 'customer_binding' ->> 'relationship_key'
      and relationship.is_active;
  elsif receipt_kind = 'booking' then
    select submission.booking_record_id, submission.customer_resolution_revision,
      submission.original_customer_record_id, submission.customer_record_id,
      submission.frozen_action_json
    into activity_record_id, receipt_revision, original_customer_id,
      current_customer_id, frozen_action
    from public.booking_submissions as submission
    where submission.business_id = expected_business_id and submission.id = receipt_id
    for update;
    if activity_record_id is null then
      raise exception 'site_customer_review_case_not_found' using errcode = 'P0002';
    end if;
    select object_definition.id into customer_object_id
    from public.object_definitions as object_definition
    where object_definition.business_id = expected_business_id
      and object_definition.key = frozen_action -> 'customer_binding' ->> 'customer_object_key'
      and object_definition.is_active;
    select relationship.id into relationship_definition_id
    from public.relationship_definitions as relationship
    where relationship.business_id = expected_business_id
      and relationship.key = frozen_action -> 'customer_binding' ->> 'relationship_key'
      and relationship.is_active;
  else
    select submission.order_record_id, submission.customer_resolution_revision,
      submission.original_customer_record_id, submission.customer_record_id,
      submission.frozen_action_json
    into activity_record_id, receipt_revision, original_customer_id,
      current_customer_id, frozen_action
    from public.preorder_submissions as submission
    where submission.business_id = expected_business_id and submission.id = receipt_id
    for update;
    if activity_record_id is null then
      raise exception 'site_customer_review_case_not_found' using errcode = 'P0002';
    end if;
    select (frozen_action -> 'customer_binding' ->> 'customer_object_definition_id')::uuid
      into customer_object_id;
    select (frozen_action -> 'customer_binding' ->> 'relationship_definition_id')::uuid
      into relationship_definition_id;
  end if;
  if receipt_revision is distinct from expected_resolution_revision then
    raise exception 'site_customer_review_stale' using errcode = 'P0001';
  end if;
  if customer_object_id is null or relationship_definition_id is null then
    raise exception 'site_customer_review_case_invalid' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.records as candidate
    where candidate.business_id = expected_business_id
      and candidate.id = requested_customer_record_id
      and candidate.object_definition_id = customer_object_id
      and candidate.record_status = 'active'::public.graph_record_status
  ) then
    raise exception 'site_customer_record_unavailable' using errcode = 'P0002';
  end if;
  perform private.site_relink_customer_activity_v1(
    expected_business_id, activity_record_id,
    requested_customer_record_id, relationship_definition_id
  );
  if receipt_kind = 'form' then
    update public.public_form_submissions
    set customer_record_id = requested_customer_record_id,
      customer_resolution_state = 'owner_relinked',
      customer_resolution_revision = customer_resolution_revision + 1,
      customer_resolution_actor_id = actor_id,
      customer_resolution_at = timezone('utc', now())
    where business_id = expected_business_id and id = receipt_id;
  elsif receipt_kind = 'booking' then
    update public.booking_submissions
    set customer_record_id = requested_customer_record_id,
      customer_resolution_state = 'owner_relinked',
      customer_resolution_revision = customer_resolution_revision + 1,
      customer_resolution_actor_id = actor_id,
      customer_resolution_at = timezone('utc', now())
    where business_id = expected_business_id and id = receipt_id;
  else
    update public.preorder_submissions
    set customer_record_id = requested_customer_record_id,
      customer_resolution_state = 'owner_relinked',
      customer_resolution_revision = customer_resolution_revision + 1,
      customer_resolution_actor_id = actor_id,
      customer_resolution_at = timezone('utc', now())
    where business_id = expected_business_id and id = receipt_id;
  end if;
  return jsonb_build_object(
    'ok', true,
    'receipt_kind', receipt_kind,
    'receipt_id', receipt_id,
    'customer_record_id', requested_customer_record_id,
    'original_customer_record_id', original_customer_id,
    'previous_customer_record_id', current_customer_id,
    'resolution_revision', expected_resolution_revision + 1
  );
end;
$$;

revoke all on function public.resolve_site_customer_resolution_case(
  uuid, text, uuid, bigint, uuid
) from public, anon;
grant execute on function public.resolve_site_customer_resolution_case(
  uuid, text, uuid, bigint, uuid
) to authenticated;
create or replace function private.submit_public_site_preorder_core_v4(
  requested_business_slug text,
  requested_page_slug text,
  requested_preorder_key text,
  submission jsonb,
  requested_request_hash text,
  requested_frozen_action jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  business_value public.businesses;
  active_site_state public.site_states;
  active_release public.site_releases;
  action_row public.site_release_actions_v4;
  experience public.preorder_experiences;
  location_value public.locations;
  submission_row public.preorder_submissions;
  existing_submission public.preorder_submissions;
  customer_record public.records;
  order_record public.records;
  order_item_record public.records;
  product_record public.records;
  frozen_product jsonb;
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
  relationship_ids uuid[] := '{}';
  customer_email_key text;
  customer_match_ids uuid[] := '{}';
  customer_match_count_value integer := 0;
  selected_customer_id uuid;
  frozen_products jsonb;
  requested_action_key text;
  requested_release_token text;
  requested_release_id uuid;
begin
  requested_action_key := nullif(requested_frozen_action ->> 'action_key', '');
  requested_release_token := nullif(
    requested_frozen_action ->> 'release_token', ''
  );
  begin
    requested_release_id := nullif(
      requested_frozen_action ->> 'release_id', ''
    )::uuid;
  exception when invalid_text_representation then
    requested_release_id := null;
  end;
  if requested_frozen_action is null
    or jsonb_typeof(requested_frozen_action) is distinct from 'object'
    or requested_frozen_action ->> 'kind' <> 'preorder'
    or requested_frozen_action ->> 'preorder_key' <> requested_preorder_key
    or requested_action_key is null
    or requested_release_id is null
    or requested_release_token is null
    or requested_release_token !~ '^s_[a-f0-9]{64}$'
  then
    return jsonb_build_object('ok', false, 'code', 'action_unavailable');
  end if;
  select business.*
  into business_value
  from public.businesses as business
  where business.slug = requested_business_slug;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- Revalidate the immutable action against the adopted Site's current
  -- published release inside the core writer.  The wrapper performs the same
  -- authority lookup, but the core must not trust a caller to have preserved
  -- that context between resolution and Record writes.
  select state.*
  into active_site_state
  from public.site_states as state
  where state.business_id = business_value.id
    and state.migration_state = 'adopted'
    and state.active_release_id is not null
  for share;
  if active_site_state.id is null then
    return jsonb_build_object('ok', false, 'code', 'action_unavailable');
  end if;
  select release.*
  into active_release
  from public.site_releases as release
  where release.business_id = business_value.id
    and release.site_id = active_site_state.id
    and release.id = active_site_state.active_release_id
    and release.status = 'published'
    and release.projection_schema_version = 4
    and release.id = requested_release_id
    and release.release_token = requested_release_token
  for share;
  if active_release.id is null then
    return jsonb_build_object('ok', false, 'code', 'action_unavailable');
  end if;
  select action.*
  into action_row
  from public.site_release_actions_v4 as action
  where action.business_id = business_value.id
    and action.release_id = active_release.id
    and action.action_key = requested_action_key
    and action.release_token = requested_release_token
    and action.action_kind = 'preorder'
  for share;
  if action_row.action_key is null
    or action_row.preorder_experience_id is null
    or action_row.action_json ->> 'preorder_key' <> requested_preorder_key
    or requested_frozen_action ->> 'experience_id'
      is distinct from action_row.preorder_experience_id::text
    or requested_frozen_action -> 'config'
      is distinct from action_row.action_json -> 'config'
    or requested_frozen_action -> 'frozen_offer'
      is distinct from action_row.action_json -> 'frozen_offer'
    or not exists (
      select 1
      from jsonb_array_elements(
        coalesce(active_release.projection_json -> 'pages', '[]'::jsonb)
      ) as projected_page(value)
      where projected_page.value ->> 'slug' = requested_page_slug
        and private.site_projection_contains_action_v3(
          projected_page.value, requested_action_key
        )
    )
  then
    return jsonb_build_object('ok', false, 'code', 'action_unavailable');
  end if;

  select configured_experience.*
  into experience
  from public.preorder_experiences as configured_experience
  where configured_experience.business_id = business_value.id
    and configured_experience.id = action_row.preorder_experience_id
    and configured_experience.key = requested_preorder_key
    and configured_experience.is_active
  for share;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if requested_frozen_action ->> 'experience_id' is distinct from experience.id::text then
    return jsonb_build_object('ok', false, 'code', 'action_unavailable');
  end if;

  -- Serialize every edge this writer will add before the capacity counter or
  -- any Record write.  The primitive validates the complete tenant set and
  -- takes the same ordered Relationship locks as the other public writers.
  relationship_ids := array[
    experience.customer_places_order_relationship_definition_id,
    experience.order_contains_item_relationship_definition_id,
    experience.product_appears_in_item_relationship_definition_id
  ];
  perform private.lock_relationship_definitions_v1(
    business_value.id, relationship_ids
  );

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

    config := coalesce(
      requested_frozen_action -> 'config', experience.config_json
    );
    frozen_products := requested_frozen_action -> 'frozen_offer' -> 'products';
    if jsonb_typeof(frozen_products) is distinct from 'array' then
      raise exception 'unavailable_product' using errcode = 'P0001';
    end if;
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

      select frozen.value
      into frozen_product
      from jsonb_array_elements(frozen_products) as frozen(value)
      where frozen.value ->> 'id' = product_id::text;
      if frozen_product is null then
        raise exception 'unavailable_product' using errcode = 'P0001';
      end if;

      begin
        unit_price := (frozen_product ->> 'price')::numeric;
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          raise exception 'unavailable_product' using errcode = 'P0001';
      end;
      if unit_price <= 0
        or unit_price > 999999.99
        or round(unit_price, 2) <> unit_price then
        raise exception 'unavailable_product' using errcode = 'P0001';
      end if;

      product_name := frozen_product ->> 'name';
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
    customer_email_key := private.preorder_mapping_key(
      config, 'customer', 'email'
    );
    if customer_email_key is not null and customer_email is not null then
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          business_value.id::text || ':customer-email:' || lower(btrim(customer_email)), 0
        )
      );
      select count(*)::integer
      into customer_match_count_value
      from public.records as candidate
      where candidate.business_id = business_value.id
        and candidate.object_definition_id = experience.customer_object_definition_id
        and candidate.record_status = 'active'::public.graph_record_status
        and lower(btrim(candidate.data_json ->> customer_email_key)) = lower(btrim(customer_email));
      select coalesce(array_agg(candidate.id order by candidate.created_at, candidate.id), '{}')
      into customer_match_ids
      from (
        select candidate.id, candidate.created_at
        from public.records as candidate
        where candidate.business_id = business_value.id
          and candidate.object_definition_id = experience.customer_object_definition_id
          and candidate.record_status = 'active'::public.graph_record_status
          and lower(btrim(candidate.data_json ->> customer_email_key)) = lower(btrim(customer_email))
        order by candidate.created_at, candidate.id
        limit 8
      ) as candidate;
      selected_customer_id := customer_match_ids[1];
    end if;

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

    if selected_customer_id is not null then
      select * into customer_record
      from public.records
      where business_id = business_value.id and id = selected_customer_id
      for update;
      if not found or customer_record.record_status <> 'active'::public.graph_record_status then
        raise exception 'site_customer_changed' using errcode = '40001';
      end if;
    else
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
    end if;

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
      confirmation_json = confirmation,
      customer_match_identity = lower(btrim(customer_email)),
      customer_match_count = customer_match_count_value,
      customer_candidate_ids = nullif(customer_match_ids, '{}'),
      original_customer_record_id = customer_record.id,
      customer_record_id = customer_record.id,
      customer_resolution_state = case when customer_match_count_value > 1
        then 'review_required' else 'matched_or_created' end
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
          when 'site_customer_changed' then 'retry'
          when 'bot_rejected' then 'rejected'
          else 'invalid_submission'
        end
      );
  end;
end;
$$;

revoke all on function private.submit_public_site_preorder_core_v4(
  text, text, text, jsonb, text, jsonb
) from public, anon, authenticated, service_role;

-- Strip the Site-only operational source identity before canonical Page
-- operations are materialised.  The durable draft retains it for copy/move
-- continuity, while ordinary Page snapshots never acquire the private key.
create or replace function private.site_strip_draft_metadata_block_v2(block jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  child jsonb;
  child_blocks jsonb := '[]'::jsonb;
  column_value jsonb;
  columns_value jsonb := '[]'::jsonb;
  image_value jsonb;
  images_value jsonb := '[]'::jsonb;
begin
  if block ->> 'type' = 'collapsible' then
    for child in select value from jsonb_array_elements(block -> 'blocks') loop
      child_blocks := child_blocks || jsonb_build_array(
        private.site_strip_draft_metadata_block_v2(child)
      );
    end loop;
    return (block - 'draft_state' - 'stable_source_page_id' - 'blocks')
      || jsonb_build_object('blocks', child_blocks);
  end if;
  if block ->> 'type' = 'section' then
    for column_value in select value from jsonb_array_elements(block -> 'columns') loop
      child_blocks := '[]'::jsonb;
      for child in select value from jsonb_array_elements(column_value -> 'blocks') loop
        child_blocks := child_blocks || jsonb_build_array(
          private.site_strip_draft_metadata_block_v2(child)
        );
      end loop;
      columns_value := columns_value || jsonb_build_array(
        (column_value - 'blocks') || jsonb_build_object('blocks', child_blocks)
      );
    end loop;
    return (block - 'draft_state' - 'stable_source_page_id' - 'columns')
      || jsonb_build_object('columns', columns_value);
  end if;
  if block ->> 'type' = 'gallery' then
    for image_value in select value from jsonb_array_elements(block -> 'images') loop
      images_value := images_value || jsonb_build_array(image_value - 'draft_state');
    end loop;
    return (block - 'draft_state' - 'stable_source_page_id' - 'images')
      || jsonb_build_object('images', images_value);
  end if;
  return block - 'draft_state' - 'stable_source_page_id';
end;
$$;

revoke all on function private.site_strip_draft_metadata_block_v2(jsonb)
  from public, anon, authenticated, service_role;

-- Keep the trusted source identity in the recoverable Site draft after a
-- successful publication.  The review action is the authority for this
-- write; the draft never derives it from a browser-provided Page UUID.
create or replace function private.site_normalize_operational_source_block_v4(
  block jsonb,
  operational_actions jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  child jsonb;
  children jsonb := '[]'::jsonb;
  column_value jsonb;
  columns_value jsonb := '[]'::jsonb;
  source_page_id text;
begin
  if block ->> 'type' = 'booking' then
    select nullif(item.value ->> 'stable_source_page_id', '')
    into source_page_id
    from jsonb_array_elements(
      case when jsonb_typeof(operational_actions) = 'array'
        then operational_actions else '[]'::jsonb end
    ) as item(value)
    where item.value ->> 'kind' = 'booking'
      and item.value ->> 'block_id' = block ->> 'id'
      and item.value ->> 'stable_source_page_id' is not null
    limit 1;
    if source_page_id is not null then
      return block || jsonb_build_object(
        'stable_source_page_id', source_page_id
      );
    end if;
    return block;
  end if;
  if block ->> 'type' = 'collapsible' then
    for child in select value from jsonb_array_elements(
      coalesce(block -> 'blocks', '[]'::jsonb)
    ) loop
      children := children || jsonb_build_array(
        private.site_normalize_operational_source_block_v4(
          child, operational_actions
        )
      );
    end loop;
    return (block - 'blocks') || jsonb_build_object('blocks', children);
  end if;
  if block ->> 'type' = 'section' then
    for column_value in select value from jsonb_array_elements(
      coalesce(block -> 'columns', '[]'::jsonb)
    ) loop
      children := '[]'::jsonb;
      for child in select value from jsonb_array_elements(
        coalesce(column_value -> 'blocks', '[]'::jsonb)
      ) loop
        children := children || jsonb_build_array(
          private.site_normalize_operational_source_block_v4(
            child, operational_actions
          )
        );
      end loop;
      columns_value := columns_value || jsonb_build_array(
        (column_value - 'blocks') || jsonb_build_object('blocks', children)
      );
    end loop;
    return (block - 'columns') || jsonb_build_object('columns', columns_value);
  end if;
  return block;
end;
$$;

create or replace function private.site_normalize_operational_source_ids_v4(
  draft jsonb,
  operational_actions jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  page_value jsonb;
  page_blocks jsonb := '[]'::jsonb;
  pages_value jsonb := '[]'::jsonb;
  block jsonb;
begin
  for page_value in select value from jsonb_array_elements(
    coalesce(draft -> 'pages', '[]'::jsonb)
  ) loop
    page_blocks := '[]'::jsonb;
    for block in select value from jsonb_array_elements(
      coalesce(page_value -> 'layout' -> 'blocks', '[]'::jsonb)
    ) loop
      page_blocks := page_blocks || jsonb_build_array(
        private.site_normalize_operational_source_block_v4(
          block, operational_actions
        )
      );
    end loop;
    pages_value := pages_value || jsonb_build_array(
      (page_value - 'layout') || jsonb_build_object(
        'layout', jsonb_build_object('blocks', page_blocks)
      )
    );
  end loop;
  return (draft - 'pages') || jsonb_build_object('pages', pages_value);
end;
$$;

revoke all on function private.site_normalize_operational_source_block_v4(
  jsonb, jsonb
), private.site_normalize_operational_source_ids_v4(jsonb, jsonb)
  from public, anon, authenticated, service_role;

-- The legacy preorder writer predates the v4 action rows.  Keep its existing
-- service-only compatibility surface, but acquire the same authority locks
-- before the legacy body can inspect or write Page/Experience state.  This
-- closes the adoption/release race for the last legacy preorder entrypoint.
create or replace function private.site_lock_legacy_preorder_authority_v3(
  requested_business_slug text,
  requested_preorder_key text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  requested_business_id uuid;
  selected_experience public.preorder_experiences;
  relationship_ids uuid[];
  legacy_allowed boolean;
begin
  legacy_allowed := private.site_lock_legacy_authority_v2(
    requested_business_slug
  );
  if not legacy_allowed then
    return false;
  end if;
  select business.id
  into requested_business_id
  from public.businesses as business
  where business.slug = requested_business_slug;
  if requested_business_id is null then
    return true;
  end if;
  -- M4 writes three graph edges after it reserves capacity.  Resolve and
  -- lock those definitions before the legacy body can write any of them;
  -- the helper orders the UUIDs so adopted writers cannot deadlock with
  -- this compatibility path.  A malformed active Experience fails closed
  -- instead of allowing an unprotected legacy edge write.
  select experience.*
  into selected_experience
  from public.preorder_experiences as experience
  where experience.business_id = requested_business_id
    and experience.key = requested_preorder_key
    and experience.is_active
  for share;

  if found then
    if selected_experience.customer_places_order_relationship_definition_id
        is null
      or selected_experience.order_contains_item_relationship_definition_id
        is null
      or selected_experience.product_appears_in_item_relationship_definition_id
        is null then
      raise exception 'legacy_preorder_relationships_missing'
        using errcode = 'P0001';
    end if;
    relationship_ids := array[
      selected_experience.customer_places_order_relationship_definition_id,
      selected_experience.order_contains_item_relationship_definition_id,
      selected_experience.product_appears_in_item_relationship_definition_id
    ];
    perform private.lock_relationship_definitions_v1(
      requested_business_id, relationship_ids
    );
  end if;

  return true;
end;
$$;

revoke all on function private.site_lock_legacy_preorder_authority_v3(
  text, text
) from public, anon, authenticated, service_role;

-- The historical M4 body is retained for legacy data/role compatibility, but
-- its direct private entrypoint must take the same authority locks as the
-- adopted writer.  Rename the old implementation once, then keep its public
-- name as a locked service-only wrapper so no internal caller can bypass the
-- adopted Site closure.
alter function private.submit_public_preorder_m4(
  text, text, text, jsonb, text
) rename to submit_public_preorder_m4_unlocked_v1;

create function private.submit_public_preorder_m4(
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
begin
  if not private.site_lock_legacy_preorder_authority_v3(
    requested_business_slug, requested_preorder_key
  ) then
    return jsonb_build_object(
      'ok', false,
      'code', 'legacy_public_actions_retired'
    );
  end if;
  return private.submit_public_preorder_m4_unlocked_v1(
    requested_business_slug,
    requested_page_slug,
    requested_preorder_key,
    submission,
    requested_request_hash
  );
end;
$$;

revoke all on function private.submit_public_preorder_m4(
  text, text, text, jsonb, text
) from public, anon, authenticated, service_role;

create or replace function public.submit_public_preorder(
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
begin
  if private.site_lock_legacy_preorder_authority_v3(
    requested_business_slug, requested_preorder_key
  ) then
    return public.submit_public_preorder_legacy_v1(
      requested_business_slug,
      requested_page_slug,
      requested_preorder_key,
      submission,
      requested_request_hash
    );
  end if;
  return jsonb_build_object(
    'ok', false,
    'code', 'legacy_public_actions_retired'
  );
end;
$$;

revoke all on function public.submit_public_preorder(
  text, text, text, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function public.submit_public_preorder(
  text, text, text, jsonb, text
) to service_role;

-- The historical v3 publisher predates the immutable Customer binding column.
-- Replace it additively so Form-only releases retain the same binding as v4
-- releases without editing the already-applied C3 migration.
create or replace function public.publish_site_release_v3(
  expected_business_id uuid,
  expected_actor_id uuid,
  requested_site_id uuid,
  requested_candidate_id uuid,
  expected_draft_revision bigint,
  expected_base_version_id uuid,
  expected_head_revision bigint
)
returns public.site_releases
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_head public.business_configuration_heads;
  selected_change public.configuration_change_sets;
  selected_state public.site_states;
  selected_release public.site_releases;
  applied_change public.configuration_change_sets;
  action_bundle jsonb;
  normalized_draft jsonb;
  configuration_already_applied boolean := false;
begin
  if expected_business_id is null or expected_actor_id is null
    or requested_site_id is null or requested_candidate_id is null
    or expected_draft_revision is null or expected_draft_revision <= 0
    or expected_base_version_id is null or expected_head_revision is null
    or expected_head_revision <= 0
  then
    raise exception 'site_request_invalid' using errcode = '22023';
  end if;
  perform private.site_assert_actor_v1(expected_business_id, expected_actor_id);
  select * into current_head
  from public.business_configuration_heads
  where business_id = expected_business_id
  for update;
  if not found then
    raise exception 'configuration_head_not_found' using errcode = 'P0002';
  end if;
  select * into selected_release
  from public.site_releases
  where business_id = expected_business_id
    and site_id = requested_site_id
    and id = requested_candidate_id
  for update;
  if not found then
    raise exception 'site_release_not_found' using errcode = 'P0002';
  end if;
  if selected_release.projection_schema_version <> 3 then
    raise exception 'site_release_schema_unsupported' using errcode = '55000';
  end if;
  if selected_release.status in ('published', 'expired') then
    return selected_release;
  end if;
  if selected_release.status = 'prepared'
    and selected_release.expires_at <= timezone('utc', now())
  then
    update public.site_releases
    set status = 'expired'
    where business_id = expected_business_id
      and id = requested_candidate_id
    returning * into selected_release;
    return selected_release;
  end if;
  if selected_release.status <> 'prepared' then
    raise exception 'site_release_not_publishable' using errcode = '55000';
  end if;

  if selected_release.configuration_change_set_id is not null then
    select * into selected_change
    from public.configuration_change_sets
    where business_id = expected_business_id
      and id = selected_release.configuration_change_set_id
    for update;
    if not found
      or selected_change.base_version_id <> selected_release.source_base_version_id
      or selected_change.base_head_revision <> selected_release.source_head_revision
    then
      raise exception 'site_configuration_incompatible' using errcode = '23514';
    end if;
    if selected_change.status = 'applied' then
      if selected_change.applied_version_id <> current_head.active_version_id then
        raise exception 'site_configuration_stale' using errcode = 'P0001';
      end if;
      configuration_already_applied := true;
    elsif selected_change.status <> 'validated' then
      raise exception 'site_configuration_incompatible' using errcode = '23514';
    end if;
  end if;

  select * into selected_state
  from public.site_states
  where business_id = expected_business_id
    and id = requested_site_id
  for update;
  if not found then
    raise exception 'site_not_found' using errcode = 'P0002';
  end if;
  if selected_state.draft_revision <> expected_draft_revision
    or selected_release.source_draft_revision <> expected_draft_revision
  then
    raise exception 'site_draft_stale' using errcode = 'P0001';
  end if;
  if selected_state.active_release_revision
      <> selected_release.expected_active_release_revision
  then
    raise exception 'site_release_stale' using errcode = 'P0001';
  end if;
  if selected_state.draft_base_version_id <> selected_release.source_base_version_id
    or selected_state.draft_base_head_revision <> selected_release.source_head_revision
  then
    raise exception 'site_configuration_rebase_required' using errcode = 'P0001';
  end if;
  if (not configuration_already_applied and (
      current_head.active_version_id <> expected_base_version_id
      or current_head.head_revision <> expected_head_revision
    ))
    or selected_release.source_base_version_id <> expected_base_version_id
    or selected_release.source_head_revision <> expected_head_revision
  then
    raise exception 'site_configuration_stale' using errcode = 'P0001';
  end if;
  if selected_state.migration_state = 'new' and exists (
    select 1 from public.pages as page_value
    where page_value.business_id = expected_business_id
      and page_value.audience = 'public'
      and page_value.status = 'published'
      and page_value.is_active
  ) then
    raise exception 'site_adoption_required' using errcode = 'P0001';
  end if;
  if selected_state.migration_state = 'legacy_pending' then
    perform private.site_assert_adoption_source_v2(
      expected_business_id, requested_site_id,
      selected_state.legacy_source_checksum
    );
  end if;

  if selected_release.configuration_change_set_id is not null
    and not configuration_already_applied
  then
    perform pg_catalog.set_config('smbos.site_release_write', 'on', true);
    applied_change := public.apply_configuration_change_c1_v1(
      expected_business_id, expected_actor_id,
      selected_release.configuration_change_set_id
    );
    perform pg_catalog.set_config('smbos.site_release_write', 'off', true);
    if applied_change.status <> 'applied' then
      raise exception 'site_configuration_incompatible' using errcode = '23514';
    end if;
    selected_release.applied_version_id := applied_change.applied_version_id;
    select * into current_head
    from public.business_configuration_heads
    where business_id = expected_business_id;
  elsif configuration_already_applied then
    selected_release.applied_version_id := selected_change.applied_version_id;
  end if;

  -- Action rows have immediate canonical foreign keys by design.  They are
  -- inserted only after the candidate application above, never at Prepare.
  if jsonb_typeof(selected_release.review_json -> '_c3_form_actions')
      is distinct from 'array'
  then
    raise exception 'site_form_action_index_invalid' using errcode = '23514';
  end if;
  for action_bundle in select value from jsonb_array_elements(
    selected_release.review_json -> '_c3_form_actions'
  ) loop
    if action_bundle ->> 'release_token' <> selected_release.release_token
      or action_bundle ->> 'view_key' is null
      or action_bundle ->> 'view_id' is null
    then
      raise exception 'site_form_action_index_invalid' using errcode = '23514';
    end if;
    insert into public.site_release_actions_v3 (
      business_id, release_id, site_id, form_id, object_definition_id,
      form_key, view_id, view_key, action_key, release_token,
      action_json, field_bindings_json, customer_binding_json
    ) values (
      expected_business_id, selected_release.id, requested_site_id,
      (action_bundle ->> 'form_id')::uuid,
      (action_bundle ->> 'object_definition_id')::uuid,
      action_bundle ->> 'form_key', (action_bundle ->> 'view_id')::uuid,
      action_bundle ->> 'view_key', action_bundle ->> 'action_key',
      action_bundle ->> 'release_token', action_bundle -> 'action',
      action_bundle -> 'bindings',
      coalesce(action_bundle -> 'customer_binding', '{}'::jsonb)
    );
  end loop;

  perform private.site_bind_canonical_pages_v1(
    expected_business_id, requested_site_id, selected_state.draft_json
  );
  update public.site_releases
  set status = 'published',
    applied_version_id = selected_release.applied_version_id,
    published_by = expected_actor_id,
    published_at = timezone('utc', now())
  where business_id = expected_business_id
    and id = requested_candidate_id
  returning * into selected_release;

  normalized_draft := private.site_normalize_published_form_intents_v3(
    selected_state.draft_json,
    selected_release.review_json -> '_c3_form_actions'
  );
  -- Publication normalizes successful Form/Object/Field intents so the next
  -- owner edit continues the same canonical identities. Treat that
  -- normalization as a real draft mutation: an in-flight autosave carrying
  -- the pre-publication revision must fail its existing CAS check instead of
  -- restoring the old `new` intents over the published destination.
  if normalized_draft is distinct from selected_state.draft_json then
    perform private.site_sync_draft_asset_references_v1(
      expected_business_id,
      requested_site_id,
      selected_state.draft_revision + 1,
      normalized_draft
    );
  end if;
  perform pg_catalog.set_config('smbos.site_release_write', 'on', true);
  update public.site_states
  set active_release_id = selected_release.id,
    active_release_revision = active_release_revision + 1,
    migration_state = 'adopted',
    draft_revision = selected_state.draft_revision + case
      when normalized_draft is distinct from selected_state.draft_json then 1
      else 0
    end,
    draft_json = normalized_draft,
    draft_base_version_id = coalesce(
      selected_release.applied_version_id, current_head.active_version_id
    ),
    draft_base_head_revision = current_head.head_revision,
    updated_at = timezone('utc', now())
  where business_id = expected_business_id
    and id = requested_site_id
    and draft_revision = selected_state.draft_revision
    and draft_base_version_id = selected_release.source_base_version_id
    and draft_base_head_revision = selected_release.source_head_revision
    and active_release_revision = selected_release.expected_active_release_revision
  returning * into selected_state;
  if not found then
    raise exception 'site_draft_stale' using errcode = 'P0001';
  end if;
  perform pg_catalog.set_config('smbos.site_release_write', 'off', true);
  return selected_release;
end;
$$;
