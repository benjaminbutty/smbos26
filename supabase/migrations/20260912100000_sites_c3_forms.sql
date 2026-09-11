-- SMBOS Sites C3: durable Form intents, immutable public actions and the
-- service-only submission boundary.
--
-- A Site draft remains the only authoring document.  The Form records below
-- are materialised by Prepare/Publish through the ordinary configuration
-- engine; autosave never writes these rows.  Public delivery reads the
-- immutable release projection and action rows, so a mutable Form row cannot
-- change an already rendered release.

alter table public.site_releases
  drop constraint if exists site_releases_projection_schema_version_check;
alter table public.site_releases
  add constraint site_releases_projection_schema_version_check
  check (projection_schema_version in (1, 2, 3));

alter table public.site_releases
  add column if not exists release_token text;

alter table public.site_releases
  drop constraint if exists site_releases_release_token_check;
alter table public.site_releases
  add constraint site_releases_release_token_check
  check (
    (projection_schema_version < 3 and release_token is null)
    or (
      projection_schema_version = 3
      and release_token is not null
      and release_token ~ '^s_[a-f0-9]{64}$'
    )
  );

create unique index if not exists site_releases_business_release_token_idx
  on public.site_releases (business_id, release_token)
  where release_token is not null;

-- One row is the exact public action rendered in one immutable release.  The
-- binding array is private release metadata used by the resolver to detect
-- type, domain, requiredness and activity changes in canonical definitions.
create table public.site_release_actions_v3 (
  business_id uuid not null,
  release_id uuid not null,
  site_id uuid not null,
  form_id uuid not null,
  object_definition_id uuid not null,
  form_key text not null check (
    form_key ~ '^[a-z][a-z0-9_]*$'
    and char_length(form_key) between 1 and 80
  ),
  view_id uuid not null,
  view_key text not null check (
    view_key ~ '^[a-z][a-z0-9_]*$'
    and char_length(view_key) between 1 and 80
  ),
  action_key text not null check (action_key ~ '^a_[a-f0-9]{64}$'),
  release_token text not null check (
    release_token is not null and release_token ~ '^s_[a-f0-9]{64}$'
  ),
  action_json jsonb not null check (
    jsonb_typeof(action_json) = 'object'
    and octet_length(action_json::text) <= 131072
  ),
  field_bindings_json jsonb not null check (
    jsonb_typeof(field_bindings_json) = 'array'
    and jsonb_array_length(field_bindings_json) between 1 and 50
    and octet_length(field_bindings_json::text) <= 131072
  ),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (business_id, release_id, action_key),
  unique (business_id, release_id, form_id),
  foreign key (business_id, release_id)
    references public.site_releases(business_id, id) on delete cascade,
  foreign key (business_id, site_id)
    references public.site_states(business_id, id) on delete cascade,
  foreign key (business_id, form_id)
    references public.forms(business_id, id) on delete restrict,
  foreign key (business_id, object_definition_id)
    references public.object_definitions(business_id, id) on delete restrict,
  foreign key (business_id, view_id)
    references public.views(business_id, id) on delete restrict
);

create index site_release_actions_v3_lookup_idx
  on public.site_release_actions_v3 (
    business_id, site_id, action_key, release_token
  );

alter table public.site_release_actions_v3 enable row level security;
revoke all on table public.site_release_actions_v3 from public, anon, authenticated;
grant all on table public.site_release_actions_v3 to service_role;

create or replace function private.site_release_action_immutable_v3()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'site_release_action_immutable' using errcode = '55000';
end;
$$;

create trigger site_release_actions_v3_immutable
before update or delete on public.site_release_actions_v3
for each row execute function private.site_release_action_immutable_v3();

revoke all on function private.site_release_action_immutable_v3()
  from public, anon, authenticated, service_role;

-- Additive receipt metadata.  Legacy rows keep the all-null C3 tuple and all
-- legacy unique constraints remain in place for old Forms.
alter table public.public_form_submissions
  add column if not exists release_id uuid,
  add column if not exists action_key text,
  add column if not exists release_token text,
  add column if not exists submission_attempt_id uuid,
  add column if not exists request_digest text,
  add column if not exists canonical_answers jsonb,
  add column if not exists action_json jsonb,
  add column if not exists grant_ids uuid[];

alter table public.public_form_submissions
  drop constraint if exists public_form_submissions_c3_tuple_check;
alter table public.public_form_submissions
  add constraint public_form_submissions_c3_tuple_check
  check (
    (
      release_id is null and action_key is null and release_token is null
      and submission_attempt_id is null and request_digest is null
      and canonical_answers is null and action_json is null and grant_ids is null
    )
    or (
      release_id is not null
      and action_key is not null
      and action_key ~ '^a_[a-f0-9]{64}$'
      and release_token is not null
      and release_token ~ '^s_[a-f0-9]{64}$'
      and submission_attempt_id is not null
      and request_digest is not null
      and request_digest ~ '^[a-f0-9]{64}$'
      and canonical_answers is not null
      and jsonb_typeof(canonical_answers) = 'object'
      and action_json is not null
      and jsonb_typeof(action_json) = 'object'
      and grant_ids is not null
      and cardinality(coalesce(grant_ids, array[]::uuid[])) <= 5
    )
  );

alter table public.public_form_submissions
  add constraint public_form_submissions_c3_release_fkey
  foreign key (business_id, release_id)
  references public.site_releases(business_id, id) on delete restrict;

create unique index public_form_submissions_c3_idempotency_idx
  on public.public_form_submissions (business_id, action_key, idempotency_token)
  where action_key is not null;

create index public_form_submissions_c3_attempt_idx
  on public.public_form_submissions (
    business_id, action_key, submission_attempt_id
  )
  where action_key is not null;

-- The release content, including its token, is immutable after preparation.
create or replace function private.enforce_site_release_immutability_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.business_id <> old.business_id or new.site_id <> old.site_id
    or new.source_draft_revision <> old.source_draft_revision
    or new.source_base_version_id <> old.source_base_version_id
    or new.source_head_revision <> old.source_head_revision
    or new.expected_active_release_revision <> old.expected_active_release_revision
    or new.configuration_change_set_id is distinct from old.configuration_change_set_id
    or new.projection_schema_version <> old.projection_schema_version
    or new.projection_json <> old.projection_json
    or new.review_json <> old.review_json
    or new.projection_checksum <> old.projection_checksum
    or new.prepared_by <> old.prepared_by or new.prepared_at <> old.prepared_at
    or new.expires_at <> old.expires_at
    or new.release_token is distinct from old.release_token
  then
    raise exception 'Site release content is immutable' using errcode = '55000';
  end if;
  if old.status = 'prepared' and new.status = 'published' then return new; end if;
  if old.status = 'prepared' and new.status in ('invalidated', 'expired') then return new; end if;
  raise exception 'Site release transition is invalid' using errcode = '55000';
end;
$$;

-- Helpers shared by compiler, public resolver, upload grant/finalization
-- callers and the submit RPC.  They deliberately use the existing opaque
-- token construction pattern and never expose canonical UUIDs.
create or replace function private.site_public_form_action_key_v3(
  target_site_id uuid,
  target_form_id uuid
)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'a_' || encode(
    extensions.digest(
      convert_to(
        'smbos-site-form-action-v3:' || target_site_id::text || ':' ||
          target_form_id::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function private.site_public_release_token_v3(
  target_site_id uuid,
  target_release_id uuid
)
returns text
language sql
immutable
set search_path = ''
as $$
  select 's_' || encode(
    extensions.digest(
      convert_to(
        'smbos-site-release-v3:' || target_site_id::text || ':' ||
          target_release_id::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function private.site_form_answer_present_v3(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when value is null or jsonb_typeof(value) = 'null' then false
    when jsonb_typeof(value) = 'string' then char_length(btrim(value #>> '{}')) > 0
    when jsonb_typeof(value) = 'array' then jsonb_array_length(value) > 0
    else true
  end;
$$;

create or replace function private.site_form_condition_satisfied_v3(
  condition jsonb,
  visible_answers jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  source_value jsonb;
  expected_value jsonb;
begin
  if condition is null then return true; end if;
  source_value := visible_answers -> (condition ->> 'field');
  if not private.site_form_answer_present_v3(source_value) then
    return false;
  end if;
  expected_value := condition -> 'value';
  if condition ->> 'operator' = 'includes' then
    if jsonb_typeof(source_value) <> 'array' then return false; end if;
    return exists (
      select 1
      from jsonb_array_elements(source_value) as item(value)
      where item.value = expected_value
    );
  end if;
  if condition ->> 'operator' = 'equals' then
    return source_value = expected_value;
  end if;
  if condition ->> 'operator' = 'not_equals' then
    return source_value <> expected_value;
  end if;
  return false;
end;
$$;

create or replace function private.site_form_submission_digest_v3(
  frozen_action jsonb,
  canonical_answers jsonb,
  submitted_grant_ids uuid[]
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'action', frozen_action,
          'answers', canonical_answers,
          'grant_ids', coalesce(
            (
              select jsonb_agg(value::text order by value::text)
              from unnest(coalesce(submitted_grant_ids, array[]::uuid[])) as ids(value)
            ),
            '[]'::jsonb
          )
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function private.site_public_form_action_key_v3(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.site_public_release_token_v3(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.site_form_answer_present_v3(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.site_form_condition_satisfied_v3(jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.site_form_submission_digest_v3(jsonb, jsonb, uuid[])
  from public, anon, authenticated, service_role;

-- Draft Form validation is deliberately permissive about empty labels, keys
-- and choices.  That is what makes an interrupted builder session durable;
-- the strict destination and question checks below run only at Prepare.
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
        'view_name', 'submit_label', 'questions'
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

-- Choice lines remain untouched in the durable draft while the owner is
-- typing.  Prepare applies this release-only normalization before writing a
-- canonical Field: trim each string, discard blank lines, and retain the
-- original order for the resulting options.
create or replace function private.site_form_choice_options_v3(
  requested_options jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      case
        when jsonb_typeof(option.value) = 'string'
          then to_jsonb(btrim(option.value #>> '{}'))
        else option.value
      end
      order by option.ordinality
    ) filter (
      where jsonb_typeof(option.value) <> 'string'
        or btrim(option.value #>> '{}') <> ''
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(coalesce(requested_options, '[]'::jsonb))
    with ordinality as option(value, ordinality);
$$;

create or replace function private.site_strip_forms_v3(draft jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select draft - 'forms';
$$;

-- A draft that still says "new" after a successful publication is only a
-- continuation of that Site's own destination when an earlier immutable
-- action bundle proves the canonical identity.  A same-key Object or View
-- from another authoring path is never accepted as that destination.
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
      and release_row.projection_schema_version = 3
    where action_row.business_id = target_business_id
      and action_row.site_id = target_site_id
      and action_row.form_key = target_form_key
      and action_row.object_definition_id = target_object_id
  );
$$;

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
      and release_row.projection_schema_version = 3
    where action_row.business_id = target_business_id
      and action_row.site_id = target_site_id
      and action_row.form_key = target_form_key
      and action_row.form_id = target_form_id
  );
$$;

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
      and release_row.projection_schema_version = 3
    where action_row.business_id = target_business_id
      and action_row.site_id = target_site_id
      and action_row.form_key = target_form_key
      and action_row.view_id = target_view_id
  );
$$;

revoke all on function private.site_form_created_object_proven_v3(uuid, uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.site_form_created_form_proven_v3(uuid, uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.site_form_created_view_proven_v3(uuid, uuid, text, uuid)
  from public, anon, authenticated, service_role;

-- C2's base draft validator has an exact top-level key check.  Strip only the
-- pending Form intents for that structural check, then validate the intents
-- with the bounded grammar above.  This keeps autosave/CAS behaviour shared
-- with C2 and leaves incomplete Forms recoverable.
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
begin
  perform private.assert_site_draft_v1(
    private.site_strip_forms_v3(
      private.site_strip_filter_draft_v2(
        private.site_strip_incomplete_detail_bindings_v2(draft)
      )
    )
  );
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

revoke all on function private.site_assert_form_draft_shape_v3(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.site_form_choice_options_v3(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.site_strip_forms_v3(jsonb)
  from public, anon, authenticated, service_role;

-- Strict Form configuration is used both by the ordinary configuration
-- candidate validator and by the canonical Form trigger.  `hidden` remains
-- the trusted-default mechanism for legacy Forms; a conditional field may
-- never also be hidden.
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
      config, array['fields', 'submit_label']
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

create or replace function private.site_assert_form_draft_ready_v3(
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
  question jsonb;
  source_question jsonb;
  source_field jsonb;
  field_value jsonb;
  object_value jsonb;
  view_value jsonb;
  condition jsonb;
  object_key_value text := btrim(form_value ->> 'object_key');
  question_key_value text;
  source_type text;
  source_options jsonb;
  question_index bigint;
  source_index bigint;
  question_required boolean;
  question_type text;
  question_field_mode text;
  effective_existing_object boolean := false;
  effective_existing_view boolean := false;
  site_id_value uuid;
  settings_value jsonb;
  choice_options jsonb;
  configured_form jsonb;
begin
  perform private.site_assert_form_draft_shape_v3(form_value);
  site_id_value := nullif(base_snapshot ->> '_c3_site_id', '')::uuid;
  if not private.experience_string_is_valid(form_value ->> 'key', 80)
    or not private.experience_string_is_valid(form_value ->> 'name', 120)
    or not private.experience_string_is_valid(form_value ->> 'object_key', 80)
  then
    raise exception 'site_form_not_ready' using errcode = '23514';
  end if;

  -- A canonical Form key may only be continued when the same Site's earlier
  -- immutable action proves that Form identity.  This prevents a new draft
  -- from silently taking over an unrelated same-key Form.
  select value into configured_form
  from jsonb_array_elements(base_snapshot -> 'forms') as item(value)
  where value ->> 'key' = form_value ->> 'key';
  if configured_form is not null then
    if not coalesce((configured_form ->> 'is_active')::boolean, false)
      or configured_form ->> 'mode' <> 'create'
      or configured_form ->> 'audience' <> 'public'
      or site_id_value is null
      or not private.site_form_created_form_proven_v3(
        target_business_id, site_id_value, form_value ->> 'key',
        (configured_form ->> 'id')::uuid
      )
    then
      raise exception 'site_form_destination_conflict' using errcode = '23505';
    end if;
    if configured_form ->> 'object_key' <> object_key_value then
      raise exception 'site_form_destination_conflict' using errcode = '23505';
    end if;
  end if;

  select value into object_value
  from jsonb_array_elements(base_snapshot -> 'object_definitions') as item(value)
  where value ->> 'key' = object_key_value;
  if form_value ->> 'object_mode' = 'existing' then
    if object_value is null or not coalesce((object_value ->> 'is_active')::boolean, false) then
      raise exception 'site_form_destination_invalid' using errcode = '23514';
    end if;
    effective_existing_object := true;
  elsif object_value is not null then
    if not coalesce((object_value ->> 'is_active')::boolean, false)
      or site_id_value is null
      or not private.site_form_created_object_proven_v3(
        target_business_id, site_id_value, form_value ->> 'key',
        (object_value ->> 'id')::uuid
      )
    then
      raise exception 'site_form_destination_conflict' using errcode = '23505';
    end if;
    effective_existing_object := true;
  end if;

  if form_value ->> 'object_mode' = 'new'
    and not effective_existing_object
    and (
      not private.experience_string_is_valid(form_value ->> 'singular_label', 120)
      or not private.experience_string_is_valid(form_value ->> 'plural_label', 120)
    )
  then
    raise exception 'site_form_destination_not_ready' using errcode = '23514';
  end if;

  if jsonb_array_length(form_value -> 'questions') < 1 then
    raise exception 'site_form_questions_not_ready' using errcode = '23514';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(form_value -> 'questions') as item(value)
    where not coalesce((value ->> 'hidden')::boolean, false)
  ) then
    raise exception 'site_form_questions_not_ready' using errcode = '23514';
  end if;

  for question, question_index in
    select value, ordinality
    from jsonb_array_elements(form_value -> 'questions') with ordinality
  loop
    question_key_value := btrim(question ->> 'key');
    question_type := question ->> 'field_type';
    question_field_mode := coalesce(
      question ->> 'field_mode',
      case when effective_existing_object then 'existing' else 'new' end
    );
    if not private.experience_string_is_valid(question_key_value, 80)
      or not private.experience_string_is_valid(question ->> 'label', 120)
    then
      raise exception 'site_form_question_not_ready' using errcode = '23514';
    end if;

    field_value := private.configuration_candidate_field_v1(
      base_snapshot, object_key_value, question_key_value
    );
    if question_field_mode = 'existing' then
      if field_value is null or not coalesce((field_value ->> 'is_active')::boolean, false)
        or field_value ->> 'field_type' <> question_type
      then
        raise exception 'site_form_field_invalid' using errcode = '23514';
      end if;
      settings_value := field_value -> 'settings_json';
    else
      if field_value is not null then
        raise exception 'site_form_field_conflict' using errcode = '23505';
      end if;
      settings_value := case
        when question_type in ('select', 'multi_select', 'status')
          then jsonb_build_object(
            'options', private.site_form_choice_options_v3(
              question -> 'options'
            )
          )
        else '{}'::jsonb
      end;
    end if;

    choice_options := private.site_form_choice_options_v3(
      case when question ? 'options'
        then question -> 'options'
        else settings_value -> 'options'
      end
    );

    if question_type in ('select', 'multi_select', 'status') then
      if jsonb_array_length(choice_options) < 1
        or (
          select count(*) from jsonb_array_elements(choice_options)
        ) <> (
          select count(distinct option.value)
          from jsonb_array_elements(choice_options) as option(value)
        )
      then
        raise exception 'site_form_choices_not_ready' using errcode = '23514';
      end if;
    end if;

    if question_field_mode = 'existing'
      and question ? 'options'
      and choice_options <> settings_value -> 'options'
    then
      raise exception 'site_form_field_domain_changed' using errcode = '23514';
    end if;

    if question_type = 'file'
      and (
        not (question ? 'upload_kind')
        or question ->> 'upload_kind' is null
        or question ->> 'upload_kind' not in ('image', 'pdf')
        or (question ? 'upload_count'
          and (
            question ->> 'upload_count' is null
            or (question ->> 'upload_count')::integer not between 1 and 5
          ))
      )
    then
      raise exception 'site_form_upload_not_ready' using errcode = '23514';
    end if;
    if question_type <> 'file'
      and (question ? 'upload_kind' or question ? 'upload_count')
    then
      raise exception 'site_form_upload_invalid' using errcode = '23514';
    end if;

    if question ? 'default_value'
      and not private.graph_field_value_is_valid(
        question -> 'default_value', question_type::public.graph_field_type, settings_value
      )
    then
      raise exception 'site_form_default_invalid' using errcode = '23514';
    end if;

    if question ? 'visible_when' then
      condition := question -> 'visible_when';
      select prior.value, prior.ordinality
      into source_question, source_index
      from jsonb_array_elements(form_value -> 'questions') with ordinality as prior(value, ordinality)
      where prior.value ->> 'key' = condition ->> 'field'
        and prior.ordinality < question_index
      order by prior.ordinality desc limit 1;
      if source_question is null then
        raise exception 'site_form_condition_invalid' using errcode = '23514';
      end if;
      if coalesce((source_question ->> 'hidden')::boolean, false) then
        raise exception 'site_form_condition_invalid' using errcode = '23514';
      end if;
      source_type := source_question ->> 'field_type';
      source_options := source_question -> 'options';
      if coalesce(source_question ->> 'field_mode',
        case when effective_existing_object then 'existing' else 'new' end
      ) = 'existing' then
        source_field := private.configuration_candidate_field_v1(
          base_snapshot, object_key_value, source_question ->> 'key'
        );
        if source_field is null then
          raise exception 'site_form_condition_invalid' using errcode = '23514';
        end if;
        source_options := source_field -> 'settings_json' -> 'options';
      else
        source_options := source_question -> 'options';
      end if;
      source_options := private.site_form_choice_options_v3(source_options);
      if source_type not in ('select', 'multi_select', 'boolean', 'status')
        or (source_type = 'multi_select' and condition ->> 'operator' <> 'includes')
        or (source_type <> 'multi_select' and condition ->> 'operator' not in ('equals', 'not_equals'))
        or (source_type = 'boolean'
          and jsonb_typeof(condition -> 'value') is distinct from 'boolean')
        or (source_type <> 'boolean'
          and (jsonb_typeof(condition -> 'value') is distinct from 'string'
            or not exists (
              select 1 from jsonb_array_elements(coalesce(source_options, '[]'::jsonb)) as option(value)
              where option.value #>> '{}' = condition ->> 'value'
            )))
      then
        raise exception 'site_form_condition_invalid' using errcode = '23514';
      end if;
    end if;
  end loop;

  -- A canonical required Field cannot disappear behind a conditional.  A
  -- trusted canonical default is the one safe exception for an omitted or
  -- hidden legacy Field.
  for field_value in
    select value
    from jsonb_array_elements(base_snapshot -> 'field_definitions') as item(value)
    where value ->> 'object_key' = object_key_value
      and coalesce((value ->> 'is_active')::boolean, false)
      and coalesce((value ->> 'required')::boolean, false)
      and (
        value -> 'default_value' is null
        or value -> 'default_value' = 'null'::jsonb
        or not private.graph_value_is_present(value -> 'default_value')
        or not private.graph_field_value_is_valid(
          value -> 'default_value',
          (value ->> 'field_type')::public.graph_field_type,
          value -> 'settings_json'
        )
      )
  loop
    if not exists (
      select 1
      from jsonb_array_elements(form_value -> 'questions') as item(value)
      where value ->> 'key' = field_value ->> 'key'
    ) then
      raise exception 'site_form_required_field_missing' using errcode = '23514';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(form_value -> 'questions') as item(value)
      where value ->> 'key' = field_value ->> 'key'
        and value ? 'visible_when'
    ) then
      raise exception 'site_form_required_field_conditional' using errcode = '23514';
    end if;
  end loop;

  if form_value ->> 'view_mode' = 'new' then
    if not private.experience_string_is_valid(form_value ->> 'view_key', 80)
      or not private.experience_string_is_valid(form_value ->> 'view_name', 120)
    then
      raise exception 'site_form_view_not_ready' using errcode = '23514';
    end if;
    select value into view_value
    from jsonb_array_elements(base_snapshot -> 'views') as item(value)
    where value ->> 'key' = form_value ->> 'view_key';
    if view_value is not null then
      if not coalesce((view_value ->> 'is_active')::boolean, false)
        or site_id_value is null
        or not private.site_form_created_view_proven_v3(
          target_business_id, site_id_value, form_value ->> 'key',
          (view_value ->> 'id')::uuid
        )
      then
        raise exception 'site_form_view_conflict' using errcode = '23505';
      end if;
      effective_existing_view := true;
    end if;
  else
    select value into view_value
    from jsonb_array_elements(base_snapshot -> 'views') as item(value)
    where value ->> 'key' = form_value ->> 'view_key';
    if view_value is null
      or not coalesce((view_value ->> 'is_active')::boolean, false)
      or view_value ->> 'object_key' <> object_key_value
    then
      raise exception 'site_form_view_invalid' using errcode = '23514';
    end if;
    effective_existing_view := true;
  end if;
end;
$$;

create or replace function private.site_assert_site_forms_publication_ready_v3(
  target_business_id uuid,
  draft jsonb,
  base_snapshot jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  form_value jsonb;
  site_block record;
  reachable_form_key text;
  reachable_count integer := 0;
begin
  -- Only Forms reachable from included Pages participate in this release.
  -- Other bounded intents stay durably in the draft until their Page is
  -- included; an ordinary Page-only Site may therefore have zero actions.
  select count(*) into reachable_count
  from private.site_draft_blocks_v1(draft) as block_value
  join jsonb_array_elements(draft -> 'pages') as page_value(value)
    on (page_value.value ->> 'id')::uuid = block_value.page_id
  where coalesce((page_value.value ->> 'is_included')::boolean, false)
    and block_value.block ->> 'type' = 'public_form';
  if reachable_count > 0 and (
    not (draft ? 'forms')
    or jsonb_typeof(draft -> 'forms') is distinct from 'array'
  ) then
    raise exception 'site_form_not_ready' using errcode = '23514';
  end if;
  if exists (
    select form_id
    from (
      select nullif(value ->> 'id', '') as form_id
      from jsonb_array_elements(draft -> 'forms') as item(value)
    ) as ids
    group by form_id
    having count(*) > 1
  ) or exists (
    select form_key
    from (
      select nullif(value ->> 'key', '') as form_key
      from jsonb_array_elements(draft -> 'forms') as item(value)
    ) as keys
    where form_key is not null
    group by form_key
    having count(*) > 1
  ) then
    raise exception 'site_form_duplicate' using errcode = '23505';
  end if;
  for form_value in select value from jsonb_array_elements(
    coalesce(draft -> 'forms', '[]'::jsonb)
  ) where value ->> 'key' in (
    select block_value.block ->> 'form_key'
    from private.site_draft_blocks_v1(draft) as block_value
    join jsonb_array_elements(draft -> 'pages') as page_value(value)
      on (page_value.value ->> 'id')::uuid = block_value.page_id
    where coalesce((page_value.value ->> 'is_included')::boolean, false)
      and block_value.block ->> 'type' = 'public_form'
  ) loop
    perform private.site_assert_form_draft_ready_v3(
      target_business_id, form_value, base_snapshot
    );
    if not exists (
      select 1
      from private.site_draft_blocks_v1(draft) as form_block
      join jsonb_array_elements(draft -> 'pages') as page_value(value)
        on (page_value.value ->> 'id')::uuid = form_block.page_id
      where page_value.value ->> 'is_included' = 'true'
        and form_block.block ->> 'type' = 'public_form'
        and form_block.block ->> 'form_key' = form_value ->> 'key'
    ) then
      raise exception 'site_form_page_missing' using errcode = '23514';
    end if;
  end loop;
  for site_block in
    select block_value.*
    from private.site_draft_blocks_v1(draft) as block_value
    join jsonb_array_elements(draft -> 'pages') as page_value(value)
      on (page_value.value ->> 'id')::uuid = block_value.page_id
    where page_value.value ->> 'is_included' = 'true'
      and block_value.block ->> 'type' in ('form', 'booking', 'preorder', 'view')
  loop
    raise exception 'site_unsupported_content' using
      errcode = '23514',
      detail = format('The %s block needs a supported C3 representation before publication.', site_block.block ->> 'type');
  end loop;
  for site_block in
    select block_value.*
    from private.site_draft_blocks_v1(draft) as block_value
    join jsonb_array_elements(draft -> 'pages') as page_value(value)
      on (page_value.value ->> 'id')::uuid = block_value.page_id
    where page_value.value ->> 'is_included' = 'true'
      and block_value.block ->> 'type' = 'public_form'
      and not exists (
        select 1 from jsonb_array_elements(
          coalesce(draft -> 'forms', '[]'::jsonb)
        ) as form_item(value)
        where form_item.value ->> 'key' = block_value.block ->> 'form_key'
      )
  loop
    raise exception 'site_form_page_missing' using errcode = '23514';
  end loop;
end;
$$;

create or replace function private.site_reachable_form_keys_v3(
  draft jsonb
)
returns table(form_key text)
language sql
stable
set search_path = ''
as $$
  select distinct block_value.block ->> 'form_key'
  from private.site_draft_blocks_v1(draft) as block_value
  join jsonb_array_elements(draft -> 'pages') as page_value(value)
    on (page_value.value ->> 'id')::uuid = block_value.page_id
  where coalesce((page_value.value ->> 'is_included')::boolean, false)
    and block_value.block ->> 'type' = 'public_form'
    and block_value.block ->> 'form_key' is not null;
$$;

revoke all on function private.site_assert_form_draft_ready_v3(uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.site_assert_site_forms_publication_ready_v3(uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.site_reachable_form_keys_v3(jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.site_assert_site_forms_publication_ready_for_site_v3(
  target_business_id uuid,
  target_site_id uuid,
  draft jsonb,
  base_snapshot jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.site_assert_site_forms_publication_ready_v3(
    target_business_id,
    draft,
    base_snapshot || jsonb_build_object('_c3_site_id', target_site_id::text)
  );
end;
$$;

revoke all on function private.site_assert_site_forms_publication_ready_for_site_v3(
  uuid, uuid, jsonb, jsonb
) from public, anon, authenticated, service_role;

create or replace function private.assert_valid_experience_form(
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
  source_config jsonb;
  condition jsonb;
  referenced_field public.field_definitions;
  source_field public.field_definitions;
  source_options jsonb;
  source_type text;
  config_index bigint;
  source_index bigint;
begin
  perform private.assert_valid_form_config_shape(config);
  if not requested_is_active then return; end if;

  perform 1
  from public.object_definitions as object_definition
  where object_definition.business_id = target_business_id
    and object_definition.id = target_object_definition_id
    and object_definition.is_active
  for share;
  if not found then
    raise exception 'Active Forms require an active Object' using errcode = '23514';
  end if;

  for field_config, config_index in
    select value, ordinality
    from jsonb_array_elements(config -> 'fields') with ordinality
  loop
    select field_definition.* into referenced_field
    from public.field_definitions as field_definition
    where field_definition.business_id = target_business_id
      and field_definition.object_definition_id = target_object_definition_id
      and field_definition.key = field_config ->> 'field'
      and field_definition.is_active;
    if not found then
      raise exception 'Form references an unknown or archived Field: %',
        field_config ->> 'field' using errcode = '23514';
    end if;

    if field_config ? 'default_value'
      and not private.graph_field_value_is_valid(
        field_config -> 'default_value', referenced_field.field_type,
        referenced_field.settings_json
      )
    then
      raise exception 'Form Field default value is invalid: %',
        field_config ->> 'field' using errcode = '23514';
    end if;

    if field_config ? 'upload_kind'
      and referenced_field.field_type <> 'file'
    then
      raise exception 'Only file Fields can define upload settings'
        using errcode = '23514';
    end if;
    if referenced_field.field_type = 'file'
      and (field_config ? 'upload_kind'
        or field_config ? 'upload_count')
      and (not field_config ? 'upload_kind'
        or field_config ->> 'upload_kind' not in ('image', 'pdf'))
    then
      raise exception 'File Fields require a supported upload kind'
        using errcode = '23514';
    end if;

    if field_config ? 'visible_when' then
      condition := field_config -> 'visible_when';
      select prior.value, prior.ordinality
      into source_config, source_index
      from jsonb_array_elements(config -> 'fields') with ordinality as prior(value, ordinality)
      where prior.value ->> 'field' = condition ->> 'field'
        and prior.ordinality < config_index
      order by prior.ordinality desc limit 1;
      if source_config is null
        or coalesce((source_config ->> 'hidden')::boolean, false)
      then
        raise exception 'Form visibility condition must use an earlier visible Field'
          using errcode = '23514';
      end if;
      select field_definition.* into source_field
      from public.field_definitions as field_definition
      where field_definition.business_id = target_business_id
        and field_definition.object_definition_id = target_object_definition_id
        and field_definition.key = source_config ->> 'field'
        and field_definition.is_active;
      if not found then
        raise exception 'Form visibility condition references an unknown Field'
          using errcode = '23514';
      end if;
      source_type := source_field.field_type::text;
      source_options := source_field.settings_json -> 'options';
      if source_type not in ('select', 'multi_select', 'boolean', 'status')
        or (source_type = 'multi_select' and condition ->> 'operator' <> 'includes')
        or (source_type <> 'multi_select' and condition ->> 'operator' not in ('equals', 'not_equals'))
        or (source_type = 'boolean'
          and jsonb_typeof(condition -> 'value') is distinct from 'boolean')
        or (source_type <> 'boolean'
          and (jsonb_typeof(condition -> 'value') is distinct from 'string'
            or not exists (
              select 1 from jsonb_array_elements(coalesce(source_options, '[]'::jsonb)) as option(value)
              where option.value #>> '{}' = condition ->> 'value'
            )))
      then
        raise exception 'Form visibility condition is not valid for its source Field'
          using errcode = '23514';
      end if;
      if referenced_field.required
        and (
          referenced_field.default_value is null
          or not private.graph_value_is_present(referenced_field.default_value)
          or not private.graph_field_value_is_valid(
            referenced_field.default_value,
            referenced_field.field_type,
            referenced_field.settings_json
          )
        )
      then
        raise exception 'Conditionally hidden Fields cannot be required'
          using errcode = '23514';
      end if;
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
    )
  then
    raise exception 'Create Forms must cover every required Field'
      using errcode = '23514';
  end if;
end;
$$;

revoke all on function private.assert_valid_form_config_shape(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.assert_valid_experience_form(
  uuid, uuid, public.experience_form_mode, jsonb, boolean
) from public, anon, authenticated, service_role;

-- Convert complete Form intents into ordinary configuration operations.  The
-- operation list is the only input to the existing five-argument candidate
-- materializer, so Prepare obtains normal Object/Field/View/Form IDs and the
-- same semantic diff, validation sandbox and CAS behaviour as every other
-- configuration change.
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
      end loop;
      if view_fields <> coalesce(
        view_value -> 'config_json' -> view_field_property, '[]'::jsonb
      ) then
        config_value := coalesce(view_value -> 'config_json', '{}'::jsonb)
          || jsonb_build_object(view_field_property, view_fields);
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

revoke all on function private.site_form_configuration_operations_v3(uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;

-- Canonical Page rows keep the ordinary Page grammar.  A public_form atom is
-- retained in the Site release projection, while the derived Page operation
-- uses the C2-compatible layout with that atom removed.
create or replace function private.site_strip_public_form_block_v3(
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
  if block is null or block ->> 'type' = 'public_form' then
    return null;
  end if;
  if block ->> 'type' = 'collapsible' then
    for child in select value from jsonb_array_elements(
      coalesce(block -> 'blocks', '[]'::jsonb)
    ) loop
      child := private.site_strip_public_form_block_v3(child);
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
        child := private.site_strip_public_form_block_v3(child);
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

create or replace function private.site_strip_public_forms_from_draft_v3(
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
      block := private.site_strip_public_form_block_v3(block);
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
  return (draft - 'forms' - '_c3_site_id') || jsonb_build_object(
    'pages', pages_value
  );
end;
$$;

create or replace function private.site_normalize_published_form_intents_v3(
  draft jsonb,
  action_bundles jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  form_value jsonb;
  question jsonb;
  questions_value jsonb;
  forms_value jsonb := '[]'::jsonb;
begin
  for form_value in select value from jsonb_array_elements(
    coalesce(draft -> 'forms', '[]'::jsonb)
  ) loop
    if not exists (
      select 1
      from jsonb_array_elements(coalesce(action_bundles, '[]'::jsonb)) as item(value)
      where item.value ->> 'form_key' = form_value ->> 'key'
    ) then
      forms_value := forms_value || jsonb_build_array(form_value);
      continue;
    end if;
    questions_value := '[]'::jsonb;
    for question in select value from jsonb_array_elements(
      coalesce(form_value -> 'questions', '[]'::jsonb)
    ) loop
      questions_value := questions_value || jsonb_build_array(
        question || jsonb_build_object('field_mode', 'existing')
      );
    end loop;
    forms_value := forms_value || jsonb_build_array(
      form_value || jsonb_build_object(
        'object_mode', 'existing',
        'view_mode', 'existing',
        'questions', questions_value
      )
    );
  end loop;
  return draft || jsonb_build_object('forms', forms_value);
end;
$$;

revoke all on function private.site_strip_public_form_block_v3(jsonb),
  private.site_strip_public_forms_from_draft_v3(jsonb),
  private.site_normalize_published_form_intents_v3(jsonb, jsonb)
  from public, anon, authenticated, service_role;

-- Build the public action and its private canonical binding from the reviewed
-- candidate snapshot.  The bundle is retained in the prepared release's
-- private review metadata and copied to site_release_actions_v3 only after
-- Publish has applied the candidate rows and their immediate FKs exist.
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
    'bindings', field_bindings
  );
end;
$$;

revoke all on function private.site_build_form_action_bundle_v3(uuid, uuid, text, jsonb, text, text)
  from public, anon, authenticated, service_role;

create or replace function private.site_canonicalize_submission_answers_v3(
  frozen_action jsonb,
  bindings jsonb,
  supplied_answers jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  binding jsonb;
  supplied_key text;
  field_key_value text;
  value jsonb;
  visible_answers jsonb := '{}'::jsonb;
  canonical_answers jsonb := '{}'::jsonb;
  visible boolean;
  required boolean;
  hidden boolean;
begin
  if jsonb_typeof(frozen_action) is distinct from 'object'
    or jsonb_typeof(bindings) is distinct from 'array'
    or jsonb_typeof(supplied_answers) is distinct from 'object'
    or jsonb_array_length(bindings) not between 1 and 50
    or octet_length(supplied_answers::text) > 65536
    or (
      select count(*) from jsonb_object_keys(supplied_answers)
    ) > 50
  then
    raise exception 'site_submission_invalid' using errcode = '22023';
  end if;

  -- Reject keys outside the frozen action. Conditional answers are known
  -- keys and are intentionally omitted when their source is not visible.
  for supplied_key in
    select answer_key.key
    from jsonb_object_keys(supplied_answers) as answer_key(key)
  loop
    if not exists (
      select 1
      from jsonb_array_elements(bindings) as item(value)
      where item.value ->> 'field_key' = supplied_key
    ) then
      raise exception 'site_submission_unknown_answer' using errcode = '22023';
    end if;
  end loop;

  for binding in
    select binding_item.value
    from jsonb_array_elements(bindings) as binding_item(value)
  loop
    field_key_value := binding ->> 'field_key';
    hidden := coalesce((binding ->> 'hidden')::boolean, false);

    -- Hidden fields are trusted configuration, rather than public answers.
    -- Preserve their configured/default value in the canonical receipt and
    -- Record, while keeping it out of visible_answers so it can never drive
    -- a later conditional question.
    if hidden then
      if binding ? 'form_default_value'
        and binding -> 'form_default_value' <> 'null'::jsonb
      then
        value := binding -> 'form_default_value';
      elsif binding ? 'default_value'
        and binding -> 'default_value' <> 'null'::jsonb
      then
        value := binding -> 'default_value';
      else
        value := null;
      end if;
      if value is not null then
        if not private.graph_field_value_is_valid(
          value, (binding ->> 'field_type')::public.graph_field_type,
          binding -> 'settings_json'
        ) then
          raise exception 'site_submission_answer_invalid' using errcode = '22023';
        end if;
        if private.graph_value_is_present(value) then
          canonical_answers := canonical_answers || jsonb_build_object(
            field_key_value, value
          );
        end if;
      end if;
      required := coalesce((binding ->> 'required')::boolean, false);
      if required and (
        not (canonical_answers ? field_key_value)
        or not private.graph_value_is_present(canonical_answers -> field_key_value)
      ) then
        raise exception 'site_submission_required_answer_missing'
          using errcode = '23514';
      end if;
      continue;
    end if;

    visible := not hidden and private.site_form_condition_satisfied_v3(
      nullif(binding -> 'visible_when', 'null'::jsonb), visible_answers
    );
    if not visible then
      continue;
    end if;

    required := coalesce((binding ->> 'required')::boolean, false);
    if binding ->> 'field_type' = 'file' then
      if supplied_answers ? field_key_value
        and private.site_form_answer_present_v3(
          supplied_answers -> field_key_value
        )
      then
        raise exception 'site_submission_file_value_invalid'
          using errcode = '22023';
      end if;
      -- File values are supplied only by the private grant consumer after
      -- this helper has applied the same visibility rules.
      continue;
    end if;

    if supplied_answers ? field_key_value
      and supplied_answers -> field_key_value <> 'null'::jsonb
    then
      value := supplied_answers -> field_key_value;
    elsif binding ? 'form_default_value'
      and binding -> 'form_default_value' <> 'null'::jsonb
    then
      value := binding -> 'form_default_value';
    elsif binding ? 'default_value'
      and binding -> 'default_value' <> 'null'::jsonb
    then
      value := binding -> 'default_value';
    else
      value := null;
    end if;

    if value is not null then
      if not private.graph_field_value_is_valid(
        value, (binding ->> 'field_type')::public.graph_field_type,
        binding -> 'settings_json'
      ) then
        raise exception 'site_submission_answer_invalid' using errcode = '22023';
      end if;
      if private.graph_value_is_present(value) then
        canonical_answers := canonical_answers || jsonb_build_object(
          field_key_value, value
        );
        visible_answers := visible_answers || jsonb_build_object(
          field_key_value, value
        );
      end if;
    end if;
    if required and (
      not (canonical_answers ? field_key_value)
      or not private.graph_value_is_present(canonical_answers -> field_key_value)
    ) then
      raise exception 'site_submission_required_answer_missing'
        using errcode = '23514';
    end if;
  end loop;
  return canonical_answers;
end;
$$;

revoke all on function private.site_canonicalize_submission_answers_v3(
  jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;

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

create or replace function private.build_site_projection_v3(
  target_business_id uuid,
  target_site_id uuid,
  draft jsonb,
  action_bundles jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  base_projection jsonb;
  page_value jsonb;
  base_page jsonb;
  projected_page jsonb;
  block jsonb;
  projected_block jsonb;
  blocks_projection jsonb;
  pages_projection jsonb := '[]'::jsonb;
begin
  -- C2 remains the authority for opaque Page, Record and media projection.
  -- This adapter replaces only the public_form atom and recursively retains
  -- the C2 delivery-safe tree for every other block.
  base_projection := private.build_site_projection_v2(
    target_business_id, target_site_id, draft
  );
  for page_value in
    select value
    from jsonb_array_elements(draft -> 'pages')
    where coalesce((value ->> 'is_included')::boolean, false)
  loop
    select value into base_page
    from jsonb_array_elements(base_projection -> 'pages') as item(value)
    where value ->> 'slug' = page_value ->> 'slug'
    limit 1;
    if base_page is null then continue; end if;
    blocks_projection := '[]'::jsonb;
    for block in select value from jsonb_array_elements(page_value -> 'layout' -> 'blocks') loop
      projected_block := private.site_public_project_block_v3(
        target_business_id, target_site_id, block, action_bundles
      );
      if projected_block is not null then
        blocks_projection := blocks_projection || jsonb_build_array(projected_block);
      end if;
    end loop;
    projected_page := (base_page - 'layout') || jsonb_build_object(
      'layout', jsonb_build_object('blocks', blocks_projection)
    );
    pages_projection := pages_projection || jsonb_build_array(projected_page);
  end loop;
  return (base_projection - 'schema_version' - 'pages') || jsonb_build_object(
    'schema_version', 3,
    'pages', pages_projection
  );
end;
$$;

revoke all on function private.site_public_project_block_v3(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.build_site_projection_v3(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;

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

-- A later canonical configuration change may add a required Property to the
-- Form's Object after this release was published.  Keep the action closed
-- until that Property is represented by the frozen binding, or has a valid
-- canonical default that can satisfy the Record graph on every submission.
create or replace function private.site_public_form_required_fields_available_v3(
  target_business_id uuid,
  target_object_definition_id uuid,
  frozen_bindings jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.field_definitions as field_definition
    where field_definition.business_id = target_business_id
      and field_definition.object_definition_id = target_object_definition_id
      and field_definition.is_active
      and field_definition.required
      and (
        field_definition.default_value is null
        or not private.graph_value_is_present(field_definition.default_value)
        or not private.graph_field_value_is_valid(
          field_definition.default_value,
          field_definition.field_type,
          field_definition.settings_json
        )
      )
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(frozen_bindings, '[]'::jsonb))
          as binding(value)
        where (binding.value ->> 'field_id')::uuid = field_definition.id
      )
  );
$$;

revoke all on function private.site_public_form_required_fields_available_v3(
  uuid, uuid, jsonb
) from public, anon, authenticated, service_role;

-- Authoritative action resolver.  `for_write` is an internal argument and is
-- always supplied as the literal true by grant/finalisation/submit callers;
-- no public endpoint can select a weaker authority path.  A read result is
-- sanitised by public.resolve_public_site_form_v3 below.
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
    and projection_schema_version = 3
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
    or release_row.projection_schema_version <> 3
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
    'bindings', action_row.field_bindings_json
  );
end;
$$;

revoke all on function private.site_projection_contains_action_v3(jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function private.resolve_site_public_form_action_v3(text, text, text, text, boolean)
  from public, anon, authenticated, service_role;

-- C3 Prepare compiles Form intents and derived Site Pages into one ordinary
-- configuration candidate.  The immutable action bundle is kept in the
-- prepared release review metadata until Publish has applied the canonical
-- rows, because NEW Object/Form/View identities do not exist during Prepare.
create or replace function public.prepare_site_release_v3(
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
  projection jsonb;
  review_metadata jsonb;
  action_bundles jsonb := '[]'::jsonb;
  form_value jsonb;
  prepared_release_id uuid;
  release_token_value text;
  draft_checksum text;
  projection_checksum text;
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
    expected_business_id, requested_site_id, selected_state.draft_json,
    active_version.snapshot_json
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
    and projection_schema_version = 3
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
  perform private.site_assert_publication_draft_c2(
    expected_business_id, form_stripped_draft
  );
  perform private.site_assert_publication_ready_v1(
    private.site_strip_filter_draft_v2(form_stripped_draft)
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
  projection := private.build_site_projection_v3(
    expected_business_id, requested_site_id, selected_state.draft_json,
    action_bundles
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
    '_c3_form_actions', action_bundles
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
    3, projection, review_metadata, projection_checksum,
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

-- Publish applies the ordinary candidate under the existing Site release
-- authority, then creates the action index once canonical Form/Object/View
-- rows exist.  Both steps and active pointer movement share this transaction.
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
      action_json, field_bindings_json
    ) values (
      expected_business_id, selected_release.id, requested_site_id,
      (action_bundle ->> 'form_id')::uuid,
      (action_bundle ->> 'object_definition_id')::uuid,
      action_bundle ->> 'form_key', (action_bundle ->> 'view_id')::uuid,
      action_bundle ->> 'view_key', action_bundle ->> 'action_key',
      action_bundle ->> 'release_token', action_bundle -> 'action',
      action_bundle -> 'bindings'
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

revoke all on function public.prepare_site_release_v3(uuid, uuid, uuid, bigint, uuid, bigint),
  public.publish_site_release_v3(uuid, uuid, uuid, uuid, bigint, uuid, bigint)
  from public, anon, service_role;
grant execute on function public.prepare_site_release_v3(uuid, uuid, uuid, bigint, uuid, bigint),
  public.publish_site_release_v3(uuid, uuid, uuid, uuid, bigint, uuid, bigint)
  to authenticated;

create or replace function private.site_public_form_block_available_v3(
  target_business_id uuid,
  target_site_id uuid,
  target_release_id uuid,
  target_release_revision bigint,
  block jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  action_row public.site_release_actions_v3;
  form_row public.forms;
  object_row public.object_definitions;
  view_row public.views;
  field_row public.field_definitions;
  binding jsonb;
  configured_field jsonb;
  action_value jsonb := block -> 'action';
  effective_required boolean;
  binding_count integer;
  configured_count integer;
begin
  if block ->> 'type' <> 'form'
    or jsonb_typeof(action_value) is distinct from 'object'
    or action_value ->> 'action_key' is null
    or action_value ->> 'release_token' is null
  then
    return false;
  end if;
  select * into action_row
  from public.site_release_actions_v3
  where business_id = target_business_id
    and site_id = target_site_id
    and release_id = target_release_id
    and action_key = action_value ->> 'action_key'
    and release_token = action_value ->> 'release_token';
  if action_row.action_key is null then return false; end if;
  select * into form_row
  from public.forms
  where business_id = target_business_id
    and id = action_row.form_id
    and object_definition_id = action_row.object_definition_id
    and key = action_row.form_key
    and mode = 'create'
    and audience = 'public'
    and is_active;
  select * into object_row
  from public.object_definitions
  where business_id = target_business_id
    and id = action_row.object_definition_id
    and is_active;
  select * into view_row
  from public.views
  where business_id = target_business_id
    and id = action_row.view_id
    and key = action_row.view_key
    and object_definition_id = action_row.object_definition_id
    and is_active;
  if form_row.id is null or object_row.id is null or view_row.id is null then
    return false;
  end if;
  if not private.site_public_form_required_fields_available_v3(
    target_business_id, action_row.object_definition_id,
    action_row.field_bindings_json
  ) then
    return false;
  end if;

  for binding in select value from jsonb_array_elements(
    action_row.field_bindings_json
  ) loop
    select * into field_row
    from public.field_definitions
    where business_id = target_business_id
      and id = (binding ->> 'field_id')::uuid
      and object_definition_id = action_row.object_definition_id
      and key = binding ->> 'field_key'
      and is_active;
    if field_row.id is null
      or field_row.field_type::text <> binding ->> 'field_type'
      or field_row.required is distinct from coalesce(
        (binding ->> 'canonical_required')::boolean, false
      )
      or (field_row.field_type in ('select', 'multi_select', 'status')
        and field_row.settings_json -> 'options'
          is distinct from binding -> 'settings_json' -> 'options')
      or coalesce(field_row.default_value, 'null'::jsonb)
          is distinct from coalesce(binding -> 'default_value', 'null'::jsonb)
    then
      return false;
    end if;
    select value into configured_field
    from jsonb_array_elements(form_row.config_json -> 'fields') as item(value)
    where value ->> 'field' = binding ->> 'field_key';
    if configured_field is null then return false; end if;
    effective_required := field_row.required
      or coalesce((configured_field ->> 'required')::boolean, false);
    if effective_required is distinct from coalesce(
      (binding ->> 'required')::boolean, false
    )
      or coalesce((configured_field ->> 'hidden')::boolean, false)
          is distinct from coalesce((binding ->> 'hidden')::boolean, false)
      or coalesce(configured_field -> 'visible_when', 'null'::jsonb)
          is distinct from coalesce(binding -> 'visible_when', 'null'::jsonb)
      or coalesce(configured_field -> 'upload_kind', 'null'::jsonb)
          is distinct from coalesce(binding -> 'upload_kind', 'null'::jsonb)
      or coalesce(configured_field -> 'upload_count', 'null'::jsonb)
          is distinct from coalesce(binding -> 'upload_count', 'null'::jsonb)
      or coalesce(configured_field -> 'default_value', 'null'::jsonb)
          is distinct from coalesce(binding -> 'form_default_value', 'null'::jsonb)
    then
      return false;
    end if;
  end loop;
  select count(*) into binding_count
  from jsonb_array_elements(action_row.field_bindings_json);
  select count(*) into configured_count
  from jsonb_array_elements(form_row.config_json -> 'fields');
  return binding_count = configured_count;
end;
$$;

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

create or replace function private.site_public_delivery_page_v3(
  target_business_id uuid,
  target_site_id uuid,
  target_release_id uuid,
  target_release_revision bigint,
  page_value jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  block jsonb;
  projected jsonb;
  blocks_value jsonb := '[]'::jsonb;
begin
  for block in select value from jsonb_array_elements(
    coalesce(page_value -> 'layout' -> 'blocks', '[]'::jsonb)
  ) loop
    projected := private.site_public_delivery_block_v3(
      target_business_id, target_site_id, target_release_id,
      target_release_revision, block
    );
    if projected is not null then
      blocks_value := blocks_value || jsonb_build_array(projected);
    end if;
  end loop;
  return page_value || jsonb_build_object(
    'layout', jsonb_build_object('blocks', blocks_value)
  );
end;
$$;

revoke all on function private.site_public_form_block_available_v3(uuid, uuid, uuid, bigint, jsonb),
  private.site_public_delivery_block_v3(uuid, uuid, uuid, bigint, jsonb),
  private.site_public_delivery_page_v3(uuid, uuid, uuid, bigint, jsonb)
  from public, anon, authenticated, service_role;

alter function public.resolve_public_site_page(text, text)
  rename to resolve_public_site_page_v2;

create function public.resolve_public_site_page(
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
    and projection_schema_version in (2, 3);
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
      'schema_version', 3,
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

create or replace function public.resolve_public_page(
  requested_business_slug text,
  requested_page_slug text
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select case when not private.site_lock_legacy_authority_v2(
    requested_business_slug
  ) then public.resolve_public_site_page(
    requested_business_slug, requested_page_slug
  ) else public.resolve_public_page_legacy_v1(
    requested_business_slug, requested_page_slug
  ) end;
$$;

revoke all on function public.resolve_public_site_page_v2(text, text),
  public.resolve_public_site_page(text, text),
  public.resolve_public_page(text, text)
  from public;
grant execute on function public.resolve_public_site_page(text, text),
  public.resolve_public_page(text, text)
  to anon, authenticated;

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
    'bindings', resolved -> 'bindings'
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

  -- Preserve the legacy receipt uniqueness boundary when a token was used by
  -- an older public Form before this Site action became authoritative.
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
  insert into public.public_form_submissions (
    id, business_id, page_id, form_id, idempotency_token, record_id,
    release_id, action_key, release_token, submission_attempt_id,
    request_digest, canonical_answers, action_json, grant_ids
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
    requested_grant_ids
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

revoke all on function public.submit_public_site_form_v3(
  text, text, text, text, uuid, uuid, jsonb, uuid[], text
) from public, anon, authenticated;
grant execute on function public.submit_public_site_form_v3(
  text, text, text, text, uuid, uuid, jsonb, uuid[], text
) to service_role;
