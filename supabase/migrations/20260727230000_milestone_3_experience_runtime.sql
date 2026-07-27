create type public.experience_view_type as enum (
  'table',
  'list',
  'cards',
  'detail'
);

create type public.experience_audience as enum ('internal', 'public');

create type public.experience_form_mode as enum ('create', 'edit');

create type public.experience_page_status as enum ('draft', 'published');

create table public.views (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  key text not null check (
    key ~ '^[a-z][a-z0-9_]*$'
    and char_length(key) between 1 and 80
  ),
  name text not null check (char_length(trim(name)) between 1 and 120),
  view_type public.experience_view_type not null,
  object_definition_id uuid not null,
  config_json jsonb not null,
  audience public.experience_audience not null default 'internal',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, key),
  unique (business_id, id),
  constraint views_tenant_object_fkey
    foreign key (business_id, object_definition_id)
    references public.object_definitions(business_id, id)
);

create index views_business_audience_idx
  on public.views(business_id, audience, is_active);

create table public.forms (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  key text not null check (
    key ~ '^[a-z][a-z0-9_]*$'
    and char_length(key) between 1 and 80
  ),
  name text not null check (char_length(trim(name)) between 1 and 120),
  object_definition_id uuid not null,
  mode public.experience_form_mode not null,
  config_json jsonb not null,
  audience public.experience_audience not null default 'internal',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, key),
  unique (business_id, id),
  constraint forms_tenant_object_fkey
    foreign key (business_id, object_definition_id)
    references public.object_definitions(business_id, id)
);

create index forms_business_audience_idx
  on public.forms(business_id, audience, is_active);

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  key text not null check (
    key ~ '^[a-z][a-z0-9_]*$'
    and char_length(key) between 1 and 80
  ),
  title text not null check (char_length(trim(title)) between 1 and 120),
  slug text not null check (
    slug = lower(slug)
    and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    and char_length(slug) between 1 and 80
  ),
  audience public.experience_audience not null,
  layout_json jsonb not null,
  status public.experience_page_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, key),
  unique (business_id, slug),
  unique (business_id, id)
);

create index pages_business_audience_status_idx
  on public.pages(business_id, audience, status);

create trigger views_set_updated_at
before update on public.views
for each row execute function private.set_updated_at();

create trigger forms_set_updated_at
before update on public.forms
for each row execute function private.set_updated_at();

create trigger pages_set_updated_at
before update on public.pages
for each row execute function private.set_updated_at();

create function private.experience_json_has_only_keys(
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

create function private.experience_key_is_valid(value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    value ~ '^[a-z][a-z0-9_]*$'
      and char_length(value) between 1 and 80,
    false
  );
$$;

create function private.experience_string_is_valid(
  value text,
  maximum_length integer
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select char_length(trim(coalesce(value, ''))) between 1 and maximum_length;
$$;

create function private.experience_string_array_is_valid(
  value jsonb,
  allow_empty boolean
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(value) = 'array'
      and (allow_empty or jsonb_array_length(value) > 0)
      and not exists (
        select 1
        from jsonb_array_elements(value) as item
        where jsonb_typeof(item) <> 'string'
          or not private.experience_key_is_valid(item #>> '{}')
      )
      and (
        select count(*)
        from jsonb_array_elements(value)
      ) = (
        select count(distinct item)
        from jsonb_array_elements(value) as item
      ),
    false
  );
$$;

create function private.assert_valid_view_config_shape(
  requested_view_type public.experience_view_type,
  config jsonb
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if jsonb_typeof(config) <> 'object' then
    raise exception 'View configuration must be a JSON object'
      using errcode = '22023';
  end if;

  if requested_view_type = 'table' then
    if not private.experience_json_has_only_keys(
      config,
      array[
        'fields',
        'title_field',
        'create_form_key',
        'edit_form_key',
        'include_archived'
      ]
    ) or not private.experience_string_array_is_valid(
      config -> 'fields',
      false
    ) then
      raise exception 'Invalid Table View configuration'
        using errcode = '22023';
    end if;
  elsif requested_view_type = 'list' then
    if not private.experience_json_has_only_keys(
      config,
      array[
        'primary_field',
        'secondary_fields',
        'create_form_key',
        'edit_form_key',
        'include_archived'
      ]
    ) or not private.experience_key_is_valid(config ->> 'primary_field')
      or not private.experience_string_array_is_valid(
        config -> 'secondary_fields',
        true
      ) then
      raise exception 'Invalid List View configuration'
        using errcode = '22023';
    end if;
  elsif requested_view_type = 'cards' then
    if not private.experience_json_has_only_keys(
      config,
      array[
        'title_field',
        'subtitle_field',
        'image_field',
        'supporting_fields',
        'create_form_key',
        'edit_form_key',
        'include_archived'
      ]
    ) or not private.experience_key_is_valid(config ->> 'title_field')
      or not private.experience_string_array_is_valid(
        config -> 'supporting_fields',
        true
      ) then
      raise exception 'Invalid Cards View configuration'
        using errcode = '22023';
    end if;
  elsif requested_view_type = 'detail' then
    if not private.experience_json_has_only_keys(
      config,
      array[
        'fields',
        'title_field',
        'edit_form_key',
        'include_archived'
      ]
    ) or not private.experience_string_array_is_valid(
      config -> 'fields',
      false
    ) then
      raise exception 'Invalid Detail View configuration'
        using errcode = '22023';
    end if;
  else
    raise exception 'Unsupported View type'
      using errcode = '22023';
  end if;

  if config ? 'title_field'
    and (
      jsonb_typeof(config -> 'title_field') <> 'string'
      or not private.experience_key_is_valid(config ->> 'title_field')
    ) then
    raise exception 'Invalid View title field'
      using errcode = '22023';
  end if;

  if config ? 'subtitle_field'
    and (
      jsonb_typeof(config -> 'subtitle_field') <> 'string'
      or not private.experience_key_is_valid(config ->> 'subtitle_field')
    ) then
    raise exception 'Invalid View subtitle field'
      using errcode = '22023';
  end if;

  if config ? 'image_field'
    and (
      jsonb_typeof(config -> 'image_field') <> 'string'
      or not private.experience_key_is_valid(config ->> 'image_field')
    ) then
    raise exception 'Invalid View image field'
      using errcode = '22023';
  end if;

  if config ? 'create_form_key'
    and (
      jsonb_typeof(config -> 'create_form_key') <> 'string'
      or not private.experience_key_is_valid(config ->> 'create_form_key')
    ) then
    raise exception 'Invalid create Form reference'
      using errcode = '22023';
  end if;

  if config ? 'edit_form_key'
    and (
      jsonb_typeof(config -> 'edit_form_key') <> 'string'
      or not private.experience_key_is_valid(config ->> 'edit_form_key')
    ) then
    raise exception 'Invalid edit Form reference'
      using errcode = '22023';
  end if;

  if config ? 'include_archived'
    and jsonb_typeof(config -> 'include_archived') <> 'boolean' then
    raise exception 'View include_archived must be a boolean'
      using errcode = '22023';
  end if;
end;
$$;

create function private.experience_view_field_keys(
  requested_view_type public.experience_view_type,
  config jsonb
)
returns setof text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if requested_view_type in ('table', 'detail') then
    return query
      select value
      from jsonb_array_elements_text(config -> 'fields') as value;
  elsif requested_view_type = 'list' then
    return next config ->> 'primary_field';
    return query
      select value
      from jsonb_array_elements_text(config -> 'secondary_fields') as value;
  elsif requested_view_type = 'cards' then
    return next config ->> 'title_field';
    return query
      select value
      from jsonb_array_elements_text(config -> 'supporting_fields') as value;
  end if;

  if config ? 'title_field' then
    return next config ->> 'title_field';
  end if;

  if config ? 'subtitle_field' then
    return next config ->> 'subtitle_field';
  end if;

  if config ? 'image_field' then
    return next config ->> 'image_field';
  end if;
end;
$$;

create function private.assert_valid_experience_view(
  target_business_id uuid,
  target_object_definition_id uuid,
  requested_view_type public.experience_view_type,
  config jsonb,
  requested_audience public.experience_audience,
  requested_is_active boolean
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  referenced_field_key text;
  referenced_field public.field_definitions;
begin
  perform private.assert_valid_view_config_shape(requested_view_type, config);

  if not requested_is_active then
    return;
  end if;

  perform 1
  from public.object_definitions as object_definition
  where object_definition.business_id = target_business_id
    and object_definition.id = target_object_definition_id
    and object_definition.is_active
  for share;

  if not found then
    raise exception 'Active Views require an active Object'
      using errcode = '23514';
  end if;

  for referenced_field_key in
    select distinct field_key
    from private.experience_view_field_keys(
      requested_view_type,
      config
    ) as field_key
  loop
    select field_definition.*
    into referenced_field
    from public.field_definitions as field_definition
    where field_definition.business_id = target_business_id
      and field_definition.object_definition_id = target_object_definition_id
      and field_definition.key = referenced_field_key
      and field_definition.is_active;

    if not found then
      raise exception 'View references an unknown or archived Field: %',
        referenced_field_key
        using errcode = '23514';
    end if;
  end loop;

  if config ? 'image_field' then
    select field_definition.*
    into referenced_field
    from public.field_definitions as field_definition
    where field_definition.business_id = target_business_id
      and field_definition.object_definition_id = target_object_definition_id
      and field_definition.key = config ->> 'image_field'
      and field_definition.is_active;

    if referenced_field.field_type is distinct from 'file' then
      raise exception 'Card image Fields must use the file type'
        using errcode = '23514';
    end if;
  end if;

  if config ? 'create_form_key' then
    perform 1
    from public.forms as form_definition
    where form_definition.business_id = target_business_id
      and form_definition.key = config ->> 'create_form_key'
      and form_definition.object_definition_id = target_object_definition_id
      and form_definition.mode = 'create'
      and form_definition.audience = requested_audience
      and form_definition.is_active
    for share;

    if not found then
      raise exception 'View create Form reference is invalid'
        using errcode = '23514';
    end if;
  end if;

  if config ? 'edit_form_key' then
    perform 1
    from public.forms as form_definition
    where form_definition.business_id = target_business_id
      and form_definition.key = config ->> 'edit_form_key'
      and form_definition.object_definition_id = target_object_definition_id
      and form_definition.mode = 'edit'
      and form_definition.audience = requested_audience
      and form_definition.is_active
    for share;

    if not found then
      raise exception 'View edit Form reference is invalid'
        using errcode = '23514';
    end if;
  end if;
end;
$$;

create function private.assert_valid_form_config_shape(config jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  field_config jsonb;
begin
  if not private.experience_json_has_only_keys(
    config,
    array['fields', 'submit_label']
  ) or jsonb_typeof(config -> 'fields') <> 'array'
    or jsonb_array_length(config -> 'fields') = 0 then
    raise exception 'Invalid Form configuration'
      using errcode = '22023';
  end if;

  if config ? 'submit_label'
    and (
      jsonb_typeof(config -> 'submit_label') <> 'string'
      or not private.experience_string_is_valid(
        config ->> 'submit_label',
        120
      )
    ) then
    raise exception 'Invalid Form submit label'
      using errcode = '22023';
  end if;

  for field_config in
    select value
    from jsonb_array_elements(config -> 'fields')
  loop
    if not private.experience_json_has_only_keys(
      field_config,
      array['field', 'label', 'help_text', 'hidden', 'default_value']
    ) or jsonb_typeof(field_config -> 'field') <> 'string'
      or not private.experience_key_is_valid(field_config ->> 'field') then
      raise exception 'Invalid configured Form Field'
        using errcode = '22023';
    end if;

    if field_config ? 'label'
      and (
        jsonb_typeof(field_config -> 'label') <> 'string'
        or not private.experience_string_is_valid(
          field_config ->> 'label',
          120
        )
      ) then
      raise exception 'Invalid configured Form Field label'
        using errcode = '22023';
    end if;

    if field_config ? 'help_text'
      and (
        jsonb_typeof(field_config -> 'help_text') <> 'string'
        or not private.experience_string_is_valid(
          field_config ->> 'help_text',
          500
        )
      ) then
      raise exception 'Invalid configured Form Field help text'
        using errcode = '22023';
    end if;

    if field_config ? 'hidden'
      and jsonb_typeof(field_config -> 'hidden') <> 'boolean' then
      raise exception 'Configured Form Field hidden must be a boolean'
        using errcode = '22023';
    end if;

    if coalesce((field_config ->> 'hidden')::boolean, false)
      and (
        not (field_config ? 'default_value')
        or not private.graph_value_is_present(
          field_config -> 'default_value'
        )
      ) then
      raise exception 'Hidden Form Fields require a usable default value'
        using errcode = '23514';
    end if;
  end loop;

  if (
    select count(*)
    from jsonb_array_elements(config -> 'fields')
  ) <> (
    select count(distinct configured_entry ->> 'field')
    from jsonb_array_elements(config -> 'fields') as configured_entry
  ) then
    raise exception 'Form Fields cannot be configured more than once'
      using errcode = '22023';
  end if;
end;
$$;

create function private.assert_valid_experience_form(
  target_business_id uuid,
  target_object_definition_id uuid,
  requested_mode public.experience_form_mode,
  config jsonb,
  requested_is_active boolean
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  field_config jsonb;
  referenced_field public.field_definitions;
begin
  perform private.assert_valid_form_config_shape(config);

  if not requested_is_active then
    return;
  end if;

  perform 1
  from public.object_definitions as object_definition
  where object_definition.business_id = target_business_id
    and object_definition.id = target_object_definition_id
    and object_definition.is_active
  for share;

  if not found then
    raise exception 'Active Forms require an active Object'
      using errcode = '23514';
  end if;

  for field_config in
    select value
    from jsonb_array_elements(config -> 'fields')
  loop
    select field_definition.*
    into referenced_field
    from public.field_definitions as field_definition
    where field_definition.business_id = target_business_id
      and field_definition.object_definition_id = target_object_definition_id
      and field_definition.key = field_config ->> 'field'
      and field_definition.is_active;

    if not found then
      raise exception 'Form references an unknown or archived Field: %',
        field_config ->> 'field'
        using errcode = '23514';
    end if;

    if field_config ? 'default_value'
      and not private.graph_field_value_is_valid(
        field_config -> 'default_value',
        referenced_field.field_type,
        referenced_field.settings_json
      ) then
      raise exception 'Form Field default value is invalid: %',
        field_config ->> 'field'
        using errcode = '23514';
    end if;
  end loop;

  if requested_mode = 'create'
    and exists (
      select 1
      from public.field_definitions as field_definition
      where field_definition.business_id = target_business_id
        and field_definition.object_definition_id = target_object_definition_id
        and field_definition.is_active
        and field_definition.required
        and field_definition.default_value is null
        and not exists (
          select 1
          from jsonb_array_elements(config -> 'fields') as configured_entry
          where configured_entry ->> 'field' = field_definition.key
        )
    ) then
    raise exception 'Create Forms must cover every required Field'
      using errcode = '23514';
  end if;
end;
$$;

create function private.assert_valid_page_config_shape(layout jsonb)
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
    or jsonb_array_length(layout -> 'blocks') = 0 then
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
    elsif block_type = 'divider' then
      if not private.experience_json_has_only_keys(
        block,
        array['type']
      ) then
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

create function private.assert_valid_experience_page(
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
    raise exception
      'Published public Pages cannot expose Records or Forms in Milestone 3'
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
    end if;
  end loop;
end;
$$;

create function private.validate_experience_view()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and (
      new.business_id is distinct from old.business_id
      or new.object_definition_id is distinct from old.object_definition_id
      or new.key is distinct from old.key
    ) then
    raise exception 'View business, Object and key are immutable'
      using errcode = '22023';
  end if;

  perform private.assert_valid_experience_view(
    new.business_id,
    new.object_definition_id,
    new.view_type,
    new.config_json,
    new.audience,
    new.is_active
  );

  return new;
end;
$$;

create trigger views_validate
before insert or update on public.views
for each row execute function private.validate_experience_view();

create function private.validate_experience_form()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and (
      new.business_id is distinct from old.business_id
      or new.object_definition_id is distinct from old.object_definition_id
      or new.key is distinct from old.key
      or new.mode is distinct from old.mode
    ) then
    raise exception 'Form business, Object, key and mode are immutable'
      using errcode = '22023';
  end if;

  perform private.assert_valid_experience_form(
    new.business_id,
    new.object_definition_id,
    new.mode,
    new.config_json,
    new.is_active
  );

  return new;
end;
$$;

create trigger forms_validate
before insert or update on public.forms
for each row execute function private.validate_experience_form();

create function private.validate_experience_page()
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

  perform private.assert_valid_experience_page(
    new.business_id,
    new.audience,
    new.layout_json,
    new.status
  );

  return new;
end;
$$;

create trigger pages_validate
before insert or update on public.pages
for each row execute function private.validate_experience_page();

create function private.ensure_field_change_preserves_experience()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  view_definition public.views;
  form_definition public.forms;
begin
  for view_definition in
    select configured_view.*
    from public.views as configured_view
    where configured_view.business_id = new.business_id
      and configured_view.object_definition_id = new.object_definition_id
      and configured_view.is_active
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

  for form_definition in
    select configured_form.*
    from public.forms as configured_form
    where configured_form.business_id = new.business_id
      and configured_form.object_definition_id = new.object_definition_id
      and configured_form.is_active
  loop
    perform private.assert_valid_experience_form(
      form_definition.business_id,
      form_definition.object_definition_id,
      form_definition.mode,
      form_definition.config_json,
      form_definition.is_active
    );
  end loop;

  return null;
end;
$$;

create trigger field_definitions_preserve_experience_validity
after insert or update on public.field_definitions
for each row execute function private.ensure_field_change_preserves_experience();

create function private.ensure_experience_change_preserves_dependents()
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

create trigger views_preserve_page_validity
after update on public.views
for each row execute function private.ensure_experience_change_preserves_dependents();

create trigger forms_preserve_experience_validity
after update on public.forms
for each row execute function private.ensure_experience_change_preserves_dependents();

create or replace function private.protect_object_definition_identity()
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

  if old.is_active and not new.is_active and (
    exists (
      select 1
      from public.views as view_definition
      where view_definition.business_id = old.business_id
        and view_definition.object_definition_id = old.id
        and view_definition.is_active
    ) or exists (
      select 1
      from public.forms as form_definition
      where form_definition.business_id = old.business_id
        and form_definition.object_definition_id = old.id
        and form_definition.is_active
    )
  ) then
    raise exception
      'Objects referenced by active Views or Forms cannot be archived'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

alter table public.views enable row level security;
alter table public.forms enable row level security;
alter table public.pages enable row level security;

create policy "Members can read Views"
on public.views
for select
to authenticated
using (private.is_business_member(business_id));

create policy "Owners and admins can create Views"
on public.views
for insert
to authenticated
with check (private.can_manage_tenant(business_id));

create policy "Owners and admins can update Views"
on public.views
for update
to authenticated
using (private.can_manage_tenant(business_id))
with check (private.can_manage_tenant(business_id));

create policy "Members can read Forms"
on public.forms
for select
to authenticated
using (private.is_business_member(business_id));

create policy "Owners and admins can create Forms"
on public.forms
for insert
to authenticated
with check (private.can_manage_tenant(business_id));

create policy "Owners and admins can update Forms"
on public.forms
for update
to authenticated
using (private.can_manage_tenant(business_id))
with check (private.can_manage_tenant(business_id));

create policy "Members can read Pages"
on public.pages
for select
to authenticated
using (private.is_business_member(business_id));

create policy "Owners and admins can create Pages"
on public.pages
for insert
to authenticated
with check (private.can_manage_tenant(business_id));

create policy "Owners and admins can update Pages"
on public.pages
for update
to authenticated
using (private.can_manage_tenant(business_id))
with check (private.can_manage_tenant(business_id));

create function public.resolve_public_page(
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
  limit 1;
$$;

revoke all on table public.views from anon;
revoke all on table public.forms from anon;
revoke all on table public.pages from anon;

grant select, insert, update on table public.views to authenticated;
grant select, insert, update on table public.forms to authenticated;
grant select, insert, update on table public.pages to authenticated;

grant all on table public.views to service_role;
grant all on table public.forms to service_role;
grant all on table public.pages to service_role;

grant usage on type public.experience_view_type
  to authenticated, service_role;
grant usage on type public.experience_audience
  to authenticated, service_role;
grant usage on type public.experience_form_mode
  to authenticated, service_role;
grant usage on type public.experience_page_status
  to authenticated, service_role;

revoke all on function public.resolve_public_page(text, text) from public;
grant execute on function public.resolve_public_page(text, text)
  to anon, authenticated;

comment on function private.assert_valid_experience_view(
  uuid,
  uuid,
  public.experience_view_type,
  jsonb,
  public.experience_audience,
  boolean
) is
  'Validates the constrained View grammar and same-tenant active Object, Field and Form references.';

comment on function private.assert_valid_experience_form(
  uuid,
  uuid,
  public.experience_form_mode,
  jsonb,
  boolean
) is
  'Validates the constrained Form grammar, active Fields, safe defaults and required create coverage.';

comment on function public.resolve_public_page(text, text) is
  'Narrow anonymous resolver for static public and published Page content. It never returns graph Records or Forms.';
