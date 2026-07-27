create type public.object_definition_kind as enum ('template', 'custom');

create type public.graph_field_type as enum (
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
);

create type public.relationship_cardinality as enum (
  'one_to_one',
  'one_to_many',
  'many_to_many'
);

create type public.graph_record_status as enum ('active', 'archived');

create table public.object_definitions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  key text not null check (
    key ~ '^[a-z][a-z0-9_]*$'
    and char_length(key) between 1 and 80
  ),
  singular_label text not null check (
    char_length(trim(singular_label)) between 1 and 120
  ),
  plural_label text not null check (
    char_length(trim(plural_label)) between 1 and 120
  ),
  description text not null default '',
  kind public.object_definition_kind not null,
  semantic_type text null check (
    semantic_type is null
    or char_length(trim(semantic_type)) between 1 and 80
  ),
  icon text null check (
    icon is null
    or char_length(trim(icon)) between 1 and 120
  ),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, key),
  unique (business_id, id)
);

create table public.field_definitions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  object_definition_id uuid not null,
  key text not null check (
    key ~ '^[a-z][a-z0-9_]*$'
    and char_length(key) between 1 and 80
  ),
  label text not null check (char_length(trim(label)) between 1 and 120),
  field_type public.graph_field_type not null,
  required boolean not null default false,
  default_value jsonb null,
  settings_json jsonb not null default '{}'::jsonb check (
    jsonb_typeof(settings_json) = 'object'
  ),
  position integer not null default 0 check (position >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, object_definition_id, key),
  unique (business_id, id),
  constraint field_definitions_tenant_object_fkey
    foreign key (business_id, object_definition_id)
    references public.object_definitions(business_id, id)
    on delete cascade
);

create table public.relationship_definitions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  key text not null check (
    key ~ '^[a-z][a-z0-9_]*$'
    and char_length(key) between 1 and 80
  ),
  source_object_definition_id uuid not null,
  target_object_definition_id uuid not null,
  source_label text not null check (
    char_length(trim(source_label)) between 1 and 120
  ),
  target_label text not null check (
    char_length(trim(target_label)) between 1 and 120
  ),
  cardinality public.relationship_cardinality not null,
  is_required boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, key),
  unique (business_id, id),
  constraint relationship_definitions_tenant_source_object_fkey
    foreign key (business_id, source_object_definition_id)
    references public.object_definitions(business_id, id),
  constraint relationship_definitions_tenant_target_object_fkey
    foreign key (business_id, target_object_definition_id)
    references public.object_definitions(business_id, id)
);

create table public.records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  object_definition_id uuid not null,
  data_json jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_json) = 'object'
  ),
  record_status public.graph_record_status not null default 'active',
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  constraint records_tenant_object_fkey
    foreign key (business_id, object_definition_id)
    references public.object_definitions(business_id, id)
);

create index records_business_object_idx
  on public.records(business_id, object_definition_id);

create index records_data_json_idx
  on public.records using gin(data_json);

create index records_business_created_at_idx
  on public.records(business_id, created_at);

create table public.record_relationships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  relationship_definition_id uuid not null,
  source_record_id uuid not null,
  target_record_id uuid not null,
  created_at timestamptz not null default now(),
  unique (
    business_id,
    relationship_definition_id,
    source_record_id,
    target_record_id
  ),
  constraint record_relationships_tenant_definition_fkey
    foreign key (business_id, relationship_definition_id)
    references public.relationship_definitions(business_id, id),
  constraint record_relationships_tenant_source_record_fkey
    foreign key (business_id, source_record_id)
    references public.records(business_id, id),
  constraint record_relationships_tenant_target_record_fkey
    foreign key (business_id, target_record_id)
    references public.records(business_id, id)
);

create index record_relationships_source_idx
  on public.record_relationships(
    business_id,
    relationship_definition_id,
    source_record_id
  );

create index record_relationships_target_idx
  on public.record_relationships(
    business_id,
    relationship_definition_id,
    target_record_id
  );

create trigger object_definitions_set_updated_at
before update on public.object_definitions
for each row execute function private.set_updated_at();

create trigger field_definitions_set_updated_at
before update on public.field_definitions
for each row execute function private.set_updated_at();

create trigger relationship_definitions_set_updated_at
before update on public.relationship_definitions
for each row execute function private.set_updated_at();

create trigger records_set_updated_at
before update on public.records
for each row execute function private.set_updated_at();

create function private.graph_options_are_valid(settings jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    jsonb_typeof(settings -> 'options') = 'array'
    and jsonb_array_length(settings -> 'options') > 0
    and not exists (
      select 1
      from jsonb_array_elements(settings -> 'options') as option_value
      where jsonb_typeof(option_value) <> 'string'
        or char_length(trim(option_value #>> '{}')) = 0
    )
    and (
      select count(*)
      from jsonb_array_elements(settings -> 'options')
    ) = (
      select count(distinct option_value)
      from jsonb_array_elements(settings -> 'options') as option_value
    );
$$;

create function private.graph_value_is_present(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when value is null or value = 'null'::jsonb then false
    when jsonb_typeof(value) = 'string'
      then char_length(trim(value #>> '{}')) > 0
    when jsonb_typeof(value) = 'array'
      then jsonb_array_length(value) > 0
    else true
  end;
$$;

create function private.graph_field_value_is_valid(
  value jsonb,
  requested_field_type public.graph_field_type,
  settings jsonb
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  text_value text;
begin
  if value is null or value = 'null'::jsonb then
    return true;
  end if;

  case requested_field_type
    when 'short_text', 'long_text', 'phone' then
      return jsonb_typeof(value) = 'string';
    when 'number', 'currency' then
      return jsonb_typeof(value) = 'number';
    when 'boolean' then
      return jsonb_typeof(value) = 'boolean';
    when 'date' then
      if jsonb_typeof(value) <> 'string' then
        return false;
      end if;
      text_value := value #>> '{}';
      return text_value ~ '^\d{4}-\d{2}-\d{2}$'
        and (text_value::date)::text = text_value;
    when 'datetime' then
      if jsonb_typeof(value) <> 'string' then
        return false;
      end if;
      text_value := value #>> '{}';
      return text_value ~ '^\d{4}-\d{2}-\d{2}T'
        and text_value::timestamptz is not null;
    when 'email' then
      return jsonb_typeof(value) = 'string'
        and (value #>> '{}') ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
    when 'url' then
      return jsonb_typeof(value) = 'string'
        and (value #>> '{}') ~* '^https?://[^[:space:]]+$';
    when 'file' then
      return jsonb_typeof(value) in ('object', 'string');
    when 'select', 'status' then
      return jsonb_typeof(value) = 'string'
        and private.graph_options_are_valid(settings)
        and (settings -> 'options') @> jsonb_build_array(value);
    when 'multi_select' then
      return jsonb_typeof(value) = 'array'
        and private.graph_options_are_valid(settings)
        and not exists (
          select 1
          from jsonb_array_elements(value) as selected_value
          where jsonb_typeof(selected_value) <> 'string'
            or not ((settings -> 'options') @> jsonb_build_array(selected_value))
        )
        and (
          select count(*)
          from jsonb_array_elements(value)
        ) = (
          select count(distinct selected_value)
          from jsonb_array_elements(value) as selected_value
        );
  end case;

  return false;
exception
  when datetime_field_overflow
    or invalid_datetime_format
    or invalid_text_representation then
    return false;
end;
$$;

create function private.assert_valid_graph_record_data(
  target_business_id uuid,
  target_object_definition_id uuid,
  proposed_data jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  supplied_field record;
  defined_field public.field_definitions;
begin
  if jsonb_typeof(proposed_data) <> 'object' then
    raise exception 'Record data must be a JSON object'
      using errcode = '22023';
  end if;

  for supplied_field in
    select entry.key, entry.value
    from jsonb_each(proposed_data) as entry
  loop
    select field_definition.*
    into defined_field
    from public.field_definitions as field_definition
    where field_definition.business_id = target_business_id
      and field_definition.object_definition_id = target_object_definition_id
      and field_definition.key = supplied_field.key;

    if not found then
      raise exception 'Unknown record field key: %', supplied_field.key
        using errcode = '22023';
    end if;

    if defined_field.is_active
      and not private.graph_field_value_is_valid(
        supplied_field.value,
        defined_field.field_type,
        defined_field.settings_json
      ) then
      raise exception 'Invalid value for field: %', supplied_field.key
        using errcode = '22023';
    end if;
  end loop;

  for defined_field in
    select field_definition.*
    from public.field_definitions as field_definition
    where field_definition.business_id = target_business_id
      and field_definition.object_definition_id = target_object_definition_id
      and field_definition.is_active
  loop
    if defined_field.required
      and (
        not (proposed_data ? defined_field.key)
        or not private.graph_value_is_present(
          proposed_data -> defined_field.key
        )
      ) then
      raise exception 'Required field is missing: %', defined_field.key
        using errcode = '23514';
    end if;

    if proposed_data ? defined_field.key
      and not private.graph_field_value_is_valid(
        proposed_data -> defined_field.key,
        defined_field.field_type,
        defined_field.settings_json
      ) then
      raise exception 'Invalid value for field: %', defined_field.key
        using errcode = '22023';
    end if;
  end loop;
end;
$$;

create function private.protect_object_definition_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.business_id is distinct from old.business_id
    or new.key is distinct from old.key then
    raise exception 'Object definition business and key are immutable'
      using errcode = '22023';
  end if;

  if old.is_active and not new.is_active and exists (
    select 1
    from public.relationship_definitions as relationship_definition
    where relationship_definition.business_id = old.business_id
      and relationship_definition.is_active
      and (
        relationship_definition.source_object_definition_id = old.id
        or relationship_definition.target_object_definition_id = old.id
      )
  ) then
    raise exception
      'Objects referenced by active relationships cannot be archived'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger object_definitions_protect_identity
before update on public.object_definitions
for each row execute function private.protect_object_definition_identity();

create function private.validate_field_definition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.business_id is distinct from old.business_id
      or new.object_definition_id is distinct from old.object_definition_id
      or new.key is distinct from old.key then
      raise exception 'Field definition business, object and key are immutable'
        using errcode = '22023';
    end if;

    perform 1
    from public.object_definitions as object_definition
    where object_definition.business_id = new.business_id
      and object_definition.id = new.object_definition_id
    for update;

    if new.field_type is distinct from old.field_type
      and exists (
        select 1
        from public.records as existing_record
        where existing_record.business_id = old.business_id
          and existing_record.object_definition_id = old.object_definition_id
          and existing_record.data_json ? old.key
      ) then
      raise exception 'Populated field types cannot be changed'
        using errcode = '23514';
    end if;
  end if;

  if new.field_type in ('select', 'multi_select', 'status')
    and not private.graph_options_are_valid(new.settings_json) then
    raise exception 'Select, multi-select and status fields require valid options'
      using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    perform 1
    from public.object_definitions as object_definition
    where object_definition.business_id = new.business_id
      and object_definition.id = new.object_definition_id
    for update;
  end if;

  if new.default_value is not null
    and not private.graph_field_value_is_valid(
      new.default_value,
      new.field_type,
      new.settings_json
    ) then
    raise exception 'Field default value is invalid'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger field_definitions_validate
before insert or update on public.field_definitions
for each row execute function private.validate_field_definition();

create function private.ensure_field_change_preserves_records()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  existing_record public.records;
begin
  for existing_record in
    select record_value.*
    from public.records as record_value
    where record_value.business_id = new.business_id
      and record_value.object_definition_id = new.object_definition_id
  loop
    perform private.assert_valid_graph_record_data(
      existing_record.business_id,
      existing_record.object_definition_id,
      existing_record.data_json
    );
  end loop;

  return null;
end;
$$;

create trigger field_definitions_preserve_record_validity
after insert or update on public.field_definitions
for each row execute function private.ensure_field_change_preserves_records();

create function private.validate_relationship_definition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  expected_object_count integer;
  locked_object_count integer := 0;
  locked_object record;
begin
  if tg_op = 'UPDATE' then
    if new.business_id is distinct from old.business_id
      or new.key is distinct from old.key then
      raise exception 'Relationship definition business and key are immutable'
        using errcode = '22023';
    end if;

    if (
      new.source_object_definition_id
        is distinct from old.source_object_definition_id
      or new.target_object_definition_id
        is distinct from old.target_object_definition_id
      or new.cardinality is distinct from old.cardinality
    ) and exists (
      select 1
      from public.record_relationships as edge
      where edge.business_id = old.business_id
        and edge.relationship_definition_id = old.id
    ) then
      raise exception 'A relationship definition with edges cannot change shape'
        using errcode = '23514';
    end if;
  end if;

  if new.is_active then
    expected_object_count := case
      when new.source_object_definition_id
        = new.target_object_definition_id then 1
      else 2
    end;

    for locked_object in
      select object_definition.id, object_definition.is_active
      from public.object_definitions as object_definition
      where object_definition.business_id = new.business_id
        and object_definition.id in (
          new.source_object_definition_id,
          new.target_object_definition_id
        )
      order by object_definition.id
      for share
    loop
      locked_object_count := locked_object_count + 1;

      if not locked_object.is_active then
        raise exception
          'Active relationships require active source and target objects'
          using errcode = '23514';
      end if;
    end loop;

    if locked_object_count <> expected_object_count then
      raise exception
        'Active relationships require active source and target objects'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger relationship_definitions_validate
before insert or update on public.relationship_definitions
for each row execute function private.validate_relationship_definition();

create function private.validate_graph_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  object_is_active boolean;
  field_definition public.field_definitions;
  authenticated_user_id uuid := auth.uid();
begin
  select object_definition.is_active
  into object_is_active
  from public.object_definitions as object_definition
  where object_definition.business_id = new.business_id
    and object_definition.id = new.object_definition_id
  for share;

  if not found then
    raise exception 'Record object does not belong to the record business'
      using errcode = '23503';
  end if;

  if tg_op = 'INSERT' then
    if not object_is_active then
      raise exception 'Records cannot be created for an archived object'
        using errcode = '23514';
    end if;

    for field_definition in
      select active_field.*
      from public.field_definitions as active_field
      where active_field.business_id = new.business_id
        and active_field.object_definition_id = new.object_definition_id
        and active_field.is_active
        and active_field.default_value is not null
        and not (new.data_json ? active_field.key)
      order by active_field.position, active_field.id
    loop
      new.data_json := new.data_json
        || jsonb_build_object(
          field_definition.key,
          field_definition.default_value
        );
    end loop;

    if exists (
      select 1
      from public.field_definitions as inactive_field
      where inactive_field.business_id = new.business_id
        and inactive_field.object_definition_id = new.object_definition_id
        and not inactive_field.is_active
        and new.data_json ? inactive_field.key
    ) then
      raise exception 'Archived fields cannot be written on new records'
        using errcode = '23514';
    end if;

    if authenticated_user_id is not null then
      new.created_by := authenticated_user_id;
    end if;
  else
    if new.business_id is distinct from old.business_id
      or new.object_definition_id is distinct from old.object_definition_id then
      raise exception 'A record cannot move between businesses or objects'
        using errcode = '22023';
    end if;

    new.created_by := old.created_by;

    if not object_is_active
      and new.data_json is distinct from old.data_json then
      raise exception 'Data on an archived object cannot be changed'
        using errcode = '23514';
    end if;

    for field_definition in
      select inactive_field.*
      from public.field_definitions as inactive_field
      where inactive_field.business_id = new.business_id
        and inactive_field.object_definition_id = new.object_definition_id
        and not inactive_field.is_active
    loop
      if (new.data_json ? field_definition.key)
          is distinct from (old.data_json ? field_definition.key)
        or (
          new.data_json ? field_definition.key
          and new.data_json -> field_definition.key
            is distinct from old.data_json -> field_definition.key
        ) then
        raise exception 'Archived field cannot be changed: %',
          field_definition.key
          using errcode = '23514';
      end if;
    end loop;
  end if;

  perform private.assert_valid_graph_record_data(
    new.business_id,
    new.object_definition_id,
    new.data_json
  );

  return new;
end;
$$;

create trigger records_validate
before insert or update on public.records
for each row execute function private.validate_graph_record();

create function private.validate_record_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  relationship_definition public.relationship_definitions;
  source_record public.records;
  target_record public.records;
begin
  select definition.*
  into relationship_definition
  from public.relationship_definitions as definition
  where definition.business_id = new.business_id
    and definition.id = new.relationship_definition_id
  for update;

  if not found then
    raise exception 'Relationship definition does not belong to edge business'
      using errcode = '23503';
  end if;

  if not relationship_definition.is_active then
    raise exception 'Archived relationships cannot receive new edges'
      using errcode = '23514';
  end if;

  select record_value.*
  into source_record
  from public.records as record_value
  where record_value.business_id = new.business_id
    and record_value.id = new.source_record_id;

  select record_value.*
  into target_record
  from public.records as record_value
  where record_value.business_id = new.business_id
    and record_value.id = new.target_record_id;

  if source_record.id is null or target_record.id is null then
    raise exception 'Relationship records must belong to edge business'
      using errcode = '23503';
  end if;

  if source_record.record_status = 'archived'
    or target_record.record_status = 'archived' then
    raise exception 'Archived records cannot receive new edges'
      using errcode = '23514';
  end if;

  if source_record.object_definition_id
      <> relationship_definition.source_object_definition_id
    or target_record.object_definition_id
      <> relationship_definition.target_object_definition_id then
    raise exception 'Relationship record types do not match definition'
      using errcode = '23514';
  end if;

  if relationship_definition.cardinality = 'one_to_one'
    and exists (
      select 1
      from public.record_relationships as existing_edge
      where existing_edge.business_id = new.business_id
        and existing_edge.relationship_definition_id
          = new.relationship_definition_id
        and (
          existing_edge.source_record_id = new.source_record_id
          or existing_edge.target_record_id = new.target_record_id
        )
    ) then
    raise exception 'One-to-one relationship cardinality would be violated'
      using errcode = '23505';
  end if;

  if relationship_definition.cardinality = 'one_to_many'
    and exists (
      select 1
      from public.record_relationships as existing_edge
      where existing_edge.business_id = new.business_id
        and existing_edge.relationship_definition_id
          = new.relationship_definition_id
        and existing_edge.target_record_id = new.target_record_id
    ) then
    raise exception 'One-to-many target already has a source'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

create trigger record_relationships_validate
before insert on public.record_relationships
for each row execute function private.validate_record_relationship();

alter table public.object_definitions enable row level security;
alter table public.field_definitions enable row level security;
alter table public.relationship_definitions enable row level security;
alter table public.records enable row level security;
alter table public.record_relationships enable row level security;

create policy "Members can read object definitions"
on public.object_definitions
for select
to authenticated
using (private.is_business_member(business_id));

create policy "Owners and admins can create object definitions"
on public.object_definitions
for insert
to authenticated
with check (private.can_manage_tenant(business_id));

create policy "Owners and admins can update object definitions"
on public.object_definitions
for update
to authenticated
using (private.can_manage_tenant(business_id))
with check (private.can_manage_tenant(business_id));

create policy "Members can read field definitions"
on public.field_definitions
for select
to authenticated
using (private.is_business_member(business_id));

create policy "Owners and admins can create field definitions"
on public.field_definitions
for insert
to authenticated
with check (private.can_manage_tenant(business_id));

create policy "Owners and admins can update field definitions"
on public.field_definitions
for update
to authenticated
using (private.can_manage_tenant(business_id))
with check (private.can_manage_tenant(business_id));

create policy "Members can read relationship definitions"
on public.relationship_definitions
for select
to authenticated
using (private.is_business_member(business_id));

create policy "Owners and admins can create relationship definitions"
on public.relationship_definitions
for insert
to authenticated
with check (private.can_manage_tenant(business_id));

create policy "Owners and admins can update relationship definitions"
on public.relationship_definitions
for update
to authenticated
using (private.can_manage_tenant(business_id))
with check (private.can_manage_tenant(business_id));

create policy "Members can read records"
on public.records
for select
to authenticated
using (private.is_business_member(business_id));

create policy "Members can create records"
on public.records
for insert
to authenticated
with check (private.is_business_member(business_id));

create policy "Members can update records"
on public.records
for update
to authenticated
using (private.is_business_member(business_id))
with check (private.is_business_member(business_id));

create policy "Members can read record relationships"
on public.record_relationships
for select
to authenticated
using (private.is_business_member(business_id));

create policy "Members can create record relationships"
on public.record_relationships
for insert
to authenticated
with check (private.is_business_member(business_id));

create policy "Members can remove record relationships"
on public.record_relationships
for delete
to authenticated
using (private.is_business_member(business_id));

create function public.create_graph_record(
  target_object_definition_id uuid,
  requested_data jsonb default '{}'::jsonb,
  requested_record_status public.graph_record_status default 'active'
)
returns public.records
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_business_id uuid;
  created_record public.records;
begin
  select object_definition.business_id
  into target_business_id
  from public.object_definitions as object_definition
  where object_definition.id = target_object_definition_id;

  if target_business_id is null then
    raise exception 'Object definition not found'
      using errcode = 'P0002';
  end if;

  insert into public.records (
    business_id,
    object_definition_id,
    data_json,
    record_status
  )
  values (
    target_business_id,
    target_object_definition_id,
    requested_data,
    requested_record_status
  )
  returning * into created_record;

  return created_record;
end;
$$;

create function public.update_graph_record(
  target_record_id uuid,
  data_patch jsonb default '{}'::jsonb,
  requested_record_status public.graph_record_status default null
)
returns public.records
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing_record public.records;
  updated_record public.records;
begin
  if jsonb_typeof(data_patch) <> 'object' then
    raise exception 'Record patch must be a JSON object'
      using errcode = '22023';
  end if;

  select record_value.*
  into existing_record
  from public.records as record_value
  where record_value.id = target_record_id
  for update;

  if not found then
    raise exception 'Record not found'
      using errcode = 'P0002';
  end if;

  update public.records
  set
    data_json = existing_record.data_json || data_patch,
    record_status = coalesce(
      requested_record_status,
      existing_record.record_status
    )
  where id = target_record_id
  returning * into updated_record;

  return updated_record;
end;
$$;

create function public.archive_graph_record(target_record_id uuid)
returns public.records
language plpgsql
security invoker
set search_path = ''
as $$
declare
  archived_record public.records;
begin
  update public.records
  set record_status = 'archived'
  where id = target_record_id
  returning * into archived_record;

  if not found then
    raise exception 'Record not found'
      using errcode = 'P0002';
  end if;

  return archived_record;
end;
$$;

create function public.create_graph_relationship(
  target_relationship_definition_id uuid,
  target_source_record_id uuid,
  target_target_record_id uuid
)
returns public.record_relationships
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_business_id uuid;
  created_relationship public.record_relationships;
begin
  select relationship_definition.business_id
  into target_business_id
  from public.relationship_definitions as relationship_definition
  where relationship_definition.id = target_relationship_definition_id;

  if target_business_id is null then
    raise exception 'Relationship definition not found'
      using errcode = 'P0002';
  end if;

  insert into public.record_relationships (
    business_id,
    relationship_definition_id,
    source_record_id,
    target_record_id
  )
  values (
    target_business_id,
    target_relationship_definition_id,
    target_source_record_id,
    target_target_record_id
  )
  returning * into created_relationship;

  return created_relationship;
end;
$$;

create function public.remove_graph_relationship(
  target_record_relationship_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  removed_count integer;
begin
  delete from public.record_relationships
  where id = target_record_relationship_id;

  get diagnostics removed_count = row_count;
  return removed_count = 1;
end;
$$;

revoke all on table public.object_definitions from anon;
revoke all on table public.field_definitions from anon;
revoke all on table public.relationship_definitions from anon;
revoke all on table public.records from anon;
revoke all on table public.record_relationships from anon;

grant select, insert, update on table public.object_definitions to authenticated;
grant select, insert, update on table public.field_definitions to authenticated;
grant select, insert, update on table public.relationship_definitions
  to authenticated;
grant select, insert, update on table public.records to authenticated;
grant select, insert, delete on table public.record_relationships
  to authenticated;

grant all on table public.object_definitions to service_role;
grant all on table public.field_definitions to service_role;
grant all on table public.relationship_definitions to service_role;
grant all on table public.records to service_role;
grant all on table public.record_relationships to service_role;

grant usage on type public.object_definition_kind to authenticated, service_role;
grant usage on type public.graph_field_type to authenticated, service_role;
grant usage on type public.relationship_cardinality
  to authenticated, service_role;
grant usage on type public.graph_record_status to authenticated, service_role;

revoke all on function public.create_graph_record(
  uuid,
  jsonb,
  public.graph_record_status
) from public;
revoke all on function public.update_graph_record(
  uuid,
  jsonb,
  public.graph_record_status
) from public;
revoke all on function public.archive_graph_record(uuid) from public;
revoke all on function public.create_graph_relationship(
  uuid,
  uuid,
  uuid
) from public;
revoke all on function public.remove_graph_relationship(uuid) from public;

grant execute on function public.create_graph_record(
  uuid,
  jsonb,
  public.graph_record_status
) to authenticated;
grant execute on function public.update_graph_record(
  uuid,
  jsonb,
  public.graph_record_status
) to authenticated;
grant execute on function public.archive_graph_record(uuid) to authenticated;
grant execute on function public.create_graph_relationship(
  uuid,
  uuid,
  uuid
) to authenticated;
grant execute on function public.remove_graph_relationship(uuid)
  to authenticated;

comment on function private.validate_graph_record() is
  'Locks the parent Object in share mode before authoritative PostgREST-safe record validation and created_by derivation.';

comment on function private.validate_record_relationship() is
  'Locks each relationship definition to serialize cardinality checks.';

comment on function private.validate_field_definition() is
  'Locks the parent Object exclusively so Field changes serialize with Record validation.';

comment on function private.protect_object_definition_identity() is
  'Protects immutable identity and prevents archival while active Relationships reference the Object.';

comment on function private.validate_relationship_definition() is
  'Share-locks active source and target Objects so archival cannot race Relationship configuration.';
