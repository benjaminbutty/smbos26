-- Sites C3: finite private public-form uploads.
--
-- This migration is intentionally additive. The Form submit boundary remains
-- the owner of its outer transaction; its trusted submit RPC calls the private
-- grant-consume helper below after allocating the Record and receipt IDs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'submission-assets',
  'submission-assets',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Keep the legacy submit rate ledger and its existing arbiter intact. Upload
-- grants use a deterministic operation namespace inside request_hash, whose
-- established 64-hex contract keeps the two counters separate without
-- changing the unique target used by the existing submit RPC.

create table public.site_public_upload_grants (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  form_id uuid not null,
  release_id uuid not null,
  action_key text not null check (
    action_key ~ '^[a-z][a-z0-9_-]{0,79}$'
  ),
  submission_attempt_id uuid not null,
  question_key text not null check (
    question_key ~ '^[a-z][a-z0-9_]{0,79}$'
  ),
  field_key text not null check (
    field_key ~ '^[a-z][a-z0-9_]{0,79}$'
  ),
  object_definition_id uuid not null,
  field_definition_id uuid not null,
  file_ordinal smallint not null check (file_ordinal between 1 and 5),
  max_files smallint not null check (max_files between 1 and 5),
  client_subject_hash text not null check (client_subject_hash ~ '^[a-f0-9]{64}$'),
  storage_key text not null,
  attachment_kind text not null check (attachment_kind in ('image', 'pdf')),
  maximum_bytes integer not null check (maximum_bytes > 0),
  reserved_bytes integer not null default 10485760
    check (reserved_bytes = 10485760),
  issued_at timestamptz not null default timezone('utc', now()),
  application_expires_at timestamptz not null,
  provider_issued_at timestamptz,
  provider_expires_at timestamptz,
  reservation_expires_at timestamptz not null,
  reservation_state text not null default 'reserved'
    check (reservation_state in ('reserved', 'released')),
  reservation_released_at timestamptz,
  state text not null default 'reserved'
    check (state in (
      'reserved', 'issued', 'uploaded', 'finalizing', 'finalized',
      'committed', 'expired', 'rejected', 'cleaned'
    )),
  upload_observation jsonb,
  verified_storage_key text,
  finalization_claim_token uuid,
  finalization_claim_expires_at timestamptz,
  submission_attachment_id uuid,
  finalized_at timestamptz,
  cleanup_claim_token uuid,
  cleanup_claim_expires_at timestamptz,
  cleanup_next_at timestamptz,
  cleanup_verified_prefix text not null generated always as (
    'verified/' || business_id::text || '/' || id::text
  ) stored,
  cleaned_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (business_id, id),
  unique (business_id, storage_key),
  unique (business_id, submission_attempt_id, question_key, file_ordinal),
  constraint site_public_upload_grants_tenant_form_fkey
    foreign key (business_id, form_id)
    references public.forms(business_id, id)
    on delete restrict,
  constraint site_public_upload_grants_tenant_release_fkey
    foreign key (business_id, release_id)
    references public.site_releases(business_id, id)
    on delete restrict,
  constraint site_public_upload_grants_tenant_object_fkey
    foreign key (business_id, object_definition_id)
    references public.object_definitions(business_id, id)
    on delete restrict,
  constraint site_public_upload_grants_tenant_field_fkey
    foreign key (business_id, field_definition_id)
    references public.field_definitions(business_id, id)
    on delete restrict,
  constraint site_public_upload_grants_ordinal_limit_check
    check (file_ordinal <= max_files),
  constraint site_public_upload_grants_key_check
    check (storage_key = 'quarantine/' || business_id::text || '/' || id::text),
  constraint site_public_upload_grants_kind_limit_check
    check (
      (attachment_kind = 'pdf' and maximum_bytes <= 10485760)
      or (attachment_kind = 'image' and maximum_bytes <= 3145728)
    ),
  constraint site_public_upload_grants_application_window_check
    check (application_expires_at = issued_at + interval '15 minutes'),
  constraint site_public_upload_grants_reservation_window_check
    check (reservation_expires_at = issued_at + interval '2 hours 15 minutes'),
  constraint site_public_upload_grants_provider_window_check
    check (
      (provider_issued_at is null and provider_expires_at is null)
      or (
        provider_issued_at is not null
        and provider_expires_at = provider_issued_at + interval '2 hours'
        and provider_issued_at between issued_at and application_expires_at
      )
    ),
  constraint site_public_upload_grants_observation_shape_check
    check (
      upload_observation is null
      or (
        jsonb_typeof(upload_observation) = 'object'
        and upload_observation ?& array[
          'observed_at', 'observed_byte_size', 'detected_mime_type', 'sha256'
        ]
        and upload_observation ->> 'detected_mime_type' in (
          'application/pdf', 'image/jpeg', 'image/png', 'image/webp'
        )
        and upload_observation ->> 'sha256' ~ '^[a-f0-9]{64}$'
      )
    )
);

-- The legacy receipt table predates composite tenant foreign keys. This
-- additive index makes `(business_id, receipt_id)` a real tenant boundary for
-- committed attachment ownership without changing its existing arbiter.
create unique index if not exists public_form_submissions_business_id_id_idx
  on public.public_form_submissions (business_id, id);

create table public.site_public_submission_attachments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  grant_id uuid not null,
  receipt_id uuid not null,
  record_id uuid not null,
  release_id uuid not null,
  form_id uuid not null,
  action_key text not null check (action_key ~ '^[a-z][a-z0-9_-]{0,79}$'),
  submission_attempt_id uuid not null,
  question_key text not null check (question_key ~ '^[a-z][a-z0-9_]{0,79}$'),
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{0,79}$'),
  object_definition_id uuid not null,
  field_definition_id uuid not null,
  file_ordinal smallint not null check (file_ordinal between 1 and 5),
  verified_storage_key text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  byte_size integer not null check (byte_size between 1 and 10485760),
  mime_type text not null check (
    mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
  ),
  created_at timestamptz not null default timezone('utc', now()),
  unique (business_id, id),
  unique (business_id, grant_id),
  constraint site_public_submission_attachments_tenant_grant_fkey
    foreign key (business_id, grant_id)
    references public.site_public_upload_grants(business_id, id)
    on delete restrict
    deferrable initially deferred,
  constraint site_public_submission_attachments_tenant_receipt_fkey
    foreign key (business_id, receipt_id)
    references public.public_form_submissions(business_id, id)
    on delete restrict
    deferrable initially deferred,
  constraint site_public_submission_attachments_tenant_record_fkey
    foreign key (business_id, record_id)
    references public.records(business_id, id)
    on delete restrict
    deferrable initially deferred,
  constraint site_public_submission_attachments_tenant_release_fkey
    foreign key (business_id, release_id)
    references public.site_releases(business_id, id)
    on delete restrict
    deferrable initially deferred,
  constraint site_public_submission_attachments_tenant_form_fkey
    foreign key (business_id, form_id)
    references public.forms(business_id, id)
    on delete restrict
    deferrable initially deferred,
  constraint site_public_submission_attachments_tenant_object_fkey
    foreign key (business_id, object_definition_id)
    references public.object_definitions(business_id, id)
    on delete restrict
    deferrable initially deferred,
  constraint site_public_submission_attachments_tenant_field_fkey
    foreign key (business_id, field_definition_id)
    references public.field_definitions(business_id, id)
    on delete restrict
    deferrable initially deferred,
  constraint site_public_submission_attachments_key_check
    check (
      verified_storage_key =
        'verified/' || business_id::text || '/' || grant_id::text || '/' || sha256
    )
);

alter table public.site_public_upload_grants
  add constraint site_public_upload_grants_attachment_fkey
  foreign key (business_id, submission_attachment_id)
  references public.site_public_submission_attachments(business_id, id)
  on delete restrict
  deferrable initially deferred;

create index site_public_upload_grants_cleanup_idx
  on public.site_public_upload_grants (cleanup_next_at, reservation_expires_at, state)
  where state in ('reserved', 'issued', 'uploaded', 'finalizing', 'finalized', 'committed', 'expired', 'rejected', 'cleaned');
create index site_public_upload_grants_attempt_idx
  on public.site_public_upload_grants (business_id, submission_attempt_id, question_key, file_ordinal);
create index site_public_submission_attachments_record_idx
  on public.site_public_submission_attachments (business_id, record_id);
create index site_public_submission_attachments_receipt_idx
  on public.site_public_submission_attachments (business_id, receipt_id);

alter table public.site_public_upload_grants enable row level security;
alter table public.site_public_submission_attachments enable row level security;
revoke all on table public.site_public_upload_grants from anon, authenticated;
revoke all on table public.site_public_submission_attachments from anon, authenticated;
grant all on table public.site_public_upload_grants to service_role;
grant all on table public.site_public_submission_attachments to service_role;

create or replace function private.site_public_upload_attachment_immutable_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'site_upload_attachment_immutable' using errcode = '55000';
end;
$$;

drop trigger if exists site_public_submission_attachments_immutable_v1
  on public.site_public_submission_attachments;
create trigger site_public_submission_attachments_immutable_v1
before update or delete on public.site_public_submission_attachments
for each row execute function private.site_public_upload_attachment_immutable_v1();

revoke all on function private.site_public_upload_attachment_immutable_v1()
  from public, anon, authenticated, service_role;

-- The canonical graph validator remains responsible for ordinary field type
-- checks. This second deferred guard runs on every Record graph write and
-- validates any C3 attachment_ids value against the immutable registry.
create or replace function private.assert_site_public_attachment_graph_v1(
  target_business_id uuid,
  target_record_id uuid,
  target_object_definition_id uuid,
  proposed_data jsonb,
  allow_internal_media boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  field_value record;
  proposed_value jsonb;
  attachment_ids jsonb;
  attachment_id_value text;
  attachment_id uuid;
  seen_ids uuid[] := array[]::uuid[];
  key_count integer;
begin
  if proposed_data is null or jsonb_typeof(proposed_data) <> 'object' then
    raise exception 'site_upload_record_data_invalid' using errcode = '23514';
  end if;

  for field_value in
    select definition.id, definition.key
    from public.field_definitions as definition
    where definition.business_id = target_business_id
      and definition.object_definition_id = target_object_definition_id
      and definition.field_type = 'file'
  loop
    proposed_value := proposed_data -> field_value.key;
    if proposed_value is null then
      continue;
    end if;

    if jsonb_typeof(proposed_value) = 'object'
      and proposed_value ? 'attachment_ids'
    then
      select count(*) into key_count
      from jsonb_object_keys(proposed_value);
      attachment_ids := proposed_value -> 'attachment_ids';
      if key_count <> 1
        or jsonb_typeof(attachment_ids) <> 'array'
        or jsonb_array_length(attachment_ids) not between 1 and 5
      then
        raise exception 'site_upload_attachment_value_invalid'
          using errcode = '23514';
      end if;

      for attachment_id_value in
        select value from jsonb_array_elements_text(attachment_ids)
      loop
        if attachment_id_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then
          raise exception 'site_upload_attachment_id_invalid'
            using errcode = '23514';
        end if;
        attachment_id := attachment_id_value::uuid;
        if attachment_id = any(seen_ids) then
          raise exception 'site_upload_attachment_duplicate'
            using errcode = '23514';
        end if;
        seen_ids := array_append(seen_ids, attachment_id);
        if not exists (
          select 1
          from public.site_public_submission_attachments as attachment
          join public.site_public_upload_grants as grant_row
            on grant_row.business_id = attachment.business_id
           and grant_row.id = attachment.grant_id
          where attachment.business_id = target_business_id
            and attachment.id = attachment_id
            and attachment.record_id = target_record_id
            and attachment.object_definition_id = target_object_definition_id
            and attachment.field_definition_id = field_value.id
            and attachment.field_key = field_value.key
            and grant_row.state = 'committed'
            and grant_row.business_id = attachment.business_id
            and grant_row.release_id = attachment.release_id
            and grant_row.action_key = attachment.action_key
            and grant_row.submission_attempt_id = attachment.submission_attempt_id
            and grant_row.question_key = attachment.question_key
            and grant_row.field_definition_id = attachment.field_definition_id
            and grant_row.verified_storage_key = attachment.verified_storage_key
            and grant_row.upload_observation ->> 'sha256' = attachment.sha256
            and (grant_row.upload_observation ->> 'observed_byte_size')::integer = attachment.byte_size
        ) then
          raise exception 'site_upload_attachment_unavailable'
            using errcode = '23514';
        end if;
      end loop;
    elsif not allow_internal_media then
      -- Public Form submission is the only path allowed to introduce C3 file
      -- values. Owner edits may still clear or replace an existing value.
      raise exception 'site_upload_attachment_value_invalid'
        using errcode = '23514';
    end if;
  end loop;
end;
$$;

revoke all on function private.assert_site_public_attachment_graph_v1(
  uuid, uuid, uuid, jsonb, boolean
) from public, anon, authenticated, service_role;

create or replace function private.guard_site_public_attachment_record_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_site_public_attachment_graph_v1(
    new.business_id,
    new.id,
    new.object_definition_id,
    new.data_json,
    true
  );
  return new;
end;
$$;

drop trigger if exists records_validate_site_public_attachment_v1
  on public.records;
create constraint trigger records_validate_site_public_attachment_v1
after insert or update on public.records
deferrable initially deferred
for each row execute function private.guard_site_public_attachment_record_v1();

revoke all on function private.guard_site_public_attachment_record_v1()
  from public, anon, authenticated, service_role;

-- Public routes use this service-only adapter to obtain the same frozen
-- action context used by the grant and finalisation RPCs.  The browser never
-- receives this result; the route passes it through the server-only upload
-- service, which converts only the file bindings into its typed context.
create or replace function public.resolve_site_public_upload_context_v1(
  requested_business_slug text,
  requested_page_slug text,
  requested_action_key text,
  requested_release_token text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.resolve_site_public_form_action_v3(
    requested_business_slug,
    requested_page_slug,
    requested_action_key,
    requested_release_token,
    true
  );
$$;

revoke all on function public.resolve_site_public_upload_context_v1(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.resolve_site_public_upload_context_v1(text, text, text, text)
  to service_role;

create or replace function public.issue_site_public_upload_grants_v1(
  requested_business_slug text,
  requested_page_slug text,
  requested_release_token text,
  requested_business_id uuid,
  requested_form_id uuid,
  requested_release_id uuid,
  requested_action_key text,
  requested_submission_attempt_id uuid,
  requested_attempt_expires_at timestamptz,
  requested_client_subject_hash text,
  requested_questions jsonb,
  requested_files jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  question jsonb;
  file_request jsonb;
  question_key_value text;
  field_key_value text;
  object_id_value uuid;
  field_id_value uuid;
  attachment_kind_value text;
  max_files_value integer;
  count_value integer;
  total_count integer := 0;
  current_count integer;
  existing_grant_count integer := 0;
  existing_question_count integer;
  requested_question_count integer;
  business_reserved integer;
  form_reserved integer;
  client_reserved integer;
  existing_attempt_expiry timestamptz;
  existing_application_expiry timestamptz;
  rate_attempt integer;
  rate_request_hash text;
  file_ordinal_value integer;
  new_grant_id uuid;
  existing_grant public.site_public_upload_grants;
  new_grant public.site_public_upload_grants;
  created_grants jsonb := '[]'::jsonb;
  existing_grants jsonb := '[]'::jsonb;
  resolved_context jsonb;
begin
  if requested_business_slug is null
    or requested_business_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or requested_page_slug is null
    or requested_page_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or requested_release_token is null
    or requested_release_token !~ '^s_[a-f0-9]{64}$'
    or requested_action_key is null
    or requested_action_key !~ '^[a-z][a-z0-9_-]{0,79}$'
    or requested_client_subject_hash is null
    or requested_client_subject_hash !~ '^[a-f0-9]{64}$'
    or requested_questions is null
    or jsonb_typeof(requested_questions) <> 'array'
    or requested_files is null
    or jsonb_typeof(requested_files) <> 'array'
    or jsonb_array_length(requested_files) not between 1 and 5
    or requested_attempt_expires_at <= statement_timestamp()
    or requested_attempt_expires_at > statement_timestamp() + interval '2 hours 15 minutes'
  then
    raise exception 'site_upload_request_invalid' using errcode = '22023';
  end if;

  -- This resolver owns the active Site release, action, frozen Field
  -- mapping, attempt window, and public write availability. The IDs below
  -- are consistency checks against its returned context, never a substitute
  -- for the route-bound authority. The Forms migration creates this helper
  -- before C3 and its `true` flag selects the write-time lock/check path.
  resolved_context := private.resolve_site_public_form_action_v3(
    requested_business_slug,
    requested_page_slug,
    requested_action_key,
    requested_release_token,
    true
  );

  if resolved_context is null
    or resolved_context ->> 'business_id' <> requested_business_id::text
    or resolved_context ->> 'release_id' <> requested_release_id::text
    or resolved_context ->> 'form_id' <> requested_form_id::text
    or resolved_context ->> 'action_key' <> requested_action_key
    or resolved_context ->> 'release_token' <> requested_release_token
  then
    raise exception 'site_upload_action_context_mismatch' using errcode = '22023';
  end if;

  perform 1
  from public.businesses as business
  where business.id = requested_business_id
  for update;
  if not found then
    raise exception 'site_upload_not_found' using errcode = 'P0002';
  end if;

  -- The attempt UUID is the issuance idempotency key. Lock and retain the
  -- original rows before touching rate/quota accounting so a lost response
  -- can return the same grant set instead of appending new ordinals.
  for existing_grant in
    select *
    from public.site_public_upload_grants
    where business_id = requested_business_id
      and submission_attempt_id = requested_submission_attempt_id
    order by question_key, file_ordinal, id
    for update
  loop
    existing_grant_count := existing_grant_count + 1;
    existing_grants := existing_grants || jsonb_build_array(to_jsonb(existing_grant));
  end loop;

  select min(grant_row.reservation_expires_at)
    into existing_attempt_expiry
  from public.site_public_upload_grants as grant_row
  where grant_row.business_id = requested_business_id
    and grant_row.submission_attempt_id = requested_submission_attempt_id;
  if existing_attempt_expiry is not null
    and existing_attempt_expiry <= statement_timestamp()
  then
    raise exception 'site_upload_submission_attempt_expired' using errcode = '55000';
  end if;
  select min(grant_row.application_expires_at)
    into existing_application_expiry
  from public.site_public_upload_grants as grant_row
  where grant_row.business_id = requested_business_id
    and grant_row.submission_attempt_id = requested_submission_attempt_id;
  if existing_application_expiry is not null
    and existing_application_expiry <= statement_timestamp()
  then
    -- Provider capabilities may be reminted only during the original
    -- 15-minute application window; the two-hour-and-15-minute reservation
    -- remains available to the cleanup/finalization lifecycle.
    raise exception 'site_upload_application_expired' using errcode = '55000';
  end if;

  if not exists (
    select 1 from public.forms as form
    where form.business_id = requested_business_id
      and form.id = requested_form_id
      and form.audience = 'public'
      and form.mode = 'create'
      and form.is_active
  ) or not exists (
    select 1 from public.site_releases as release_row
    join public.site_states as state
      on state.business_id = release_row.business_id
     and state.active_release_id = release_row.id
    where release_row.business_id = requested_business_id
      and release_row.id = requested_release_id
      and release_row.status = 'published'
      and state.migration_state = 'adopted'
  ) then
    raise exception 'site_upload_action_unavailable' using errcode = 'P0002';
  end if;

  rate_request_hash := encode(
    extensions.digest(
      convert_to(
        'site-upload-grant:' || requested_action_key || ':' ||
          requested_client_subject_hash,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  insert into public.public_form_rate_limits (
    business_id, form_id, request_hash, window_started_at
  ) values (
    requested_business_id,
    requested_form_id,
    rate_request_hash,
    date_trunc('minute', statement_timestamp())
  )
  on conflict (
    business_id, form_id, request_hash, window_started_at
  ) do update set
    attempt_count = public.public_form_rate_limits.attempt_count + 1,
    updated_at = statement_timestamp()
  returning attempt_count into rate_attempt;
  if rate_attempt > 10 then
    -- Returning preserves the increment in this transaction. Raising here
    -- would roll back the ledger row and make the throttle ineffective.
    return jsonb_build_object('error', 'site_upload_rate_limited');
  end if;

  select coalesce(sum(grant_row.reserved_bytes), 0)
    into business_reserved
  from public.site_public_upload_grants as grant_row
  where grant_row.business_id = requested_business_id
    and grant_row.reservation_state = 'reserved';
  select coalesce(sum(grant_row.reserved_bytes), 0)
    into form_reserved
  from public.site_public_upload_grants as grant_row
  where grant_row.business_id = requested_business_id
    and grant_row.form_id = requested_form_id
    and grant_row.reservation_state = 'reserved';
  select coalesce(sum(grant_row.reserved_bytes), 0)
    into client_reserved
  from public.site_public_upload_grants as grant_row
  where grant_row.business_id = requested_business_id
    and grant_row.form_id = requested_form_id
    and grant_row.client_subject_hash = requested_client_subject_hash
    and grant_row.reservation_state = 'reserved';

  for file_request in
    select value from jsonb_array_elements(requested_files)
  loop
    question_key_value := file_request ->> 'question_key';
    count_value := (file_request ->> 'count')::integer;
    if question_key_value is null
      or question_key_value !~ '^[a-z][a-z0-9_]{0,79}$'
      or count_value is null
      or count_value not between 1 and 5
      or (
        select count(*)
        from jsonb_array_elements(requested_files) as duplicate_request(value)
        where duplicate_request.value ->> 'question_key' = question_key_value
      ) <> 1
    then
      raise exception 'site_upload_question_request_invalid'
        using errcode = '22023';
    end if;
    total_count := total_count + count_value;
    if total_count > 5 then
      raise exception 'site_upload_submission_file_limit' using errcode = '22023';
    end if;

    question := null;
    select question_value.value into question
    from jsonb_array_elements(requested_questions) as question_value(value)
    where coalesce(
      question_value.value ->> 'question_key',
      question_value.value ->> 'questionKey'
    ) = question_key_value;
    if question is null then
      raise exception 'site_upload_question_unavailable' using errcode = 'P0002';
    end if;
    field_key_value := coalesce(question ->> 'field_key', question ->> 'fieldKey');
    object_id_value := (coalesce(question ->> 'object_definition_id', question ->> 'objectDefinitionId'))::uuid;
    field_id_value := (coalesce(question ->> 'field_definition_id', question ->> 'fieldDefinitionId'))::uuid;
    attachment_kind_value := coalesce(question ->> 'attachment_kind', question ->> 'uploadKind');
    max_files_value := (coalesce(question ->> 'max_files', question ->> 'maxFiles'))::integer;
    if field_key_value !~ '^[a-z][a-z0-9_]{0,79}$'
      or attachment_kind_value not in ('image', 'pdf')
      or max_files_value not between 1 and 5
      or count_value > max_files_value
      or not exists (
        select 1
        from jsonb_array_elements(resolved_context -> 'bindings') as binding_value(value)
        where binding_value.value ->> 'question_key' = question_key_value
          and binding_value.value ->> 'field_key' = field_key_value
          and (binding_value.value ->> 'field_id')::uuid = field_id_value
          and (binding_value.value ->> 'object_id')::uuid = object_id_value
          and binding_value.value ->> 'field_type' = 'file'
          and binding_value.value ->> 'upload_kind' = attachment_kind_value
          and coalesce((binding_value.value ->> 'upload_count')::integer, 1) = max_files_value
      )
      or not exists (
        select 1 from public.field_definitions as field_definition
        where field_definition.business_id = requested_business_id
          and field_definition.id = field_id_value
          and field_definition.object_definition_id = object_id_value
          and field_definition.key = field_key_value
          and field_definition.field_type = 'file'
          and field_definition.is_active
      )
    then
      raise exception 'site_upload_question_unavailable' using errcode = 'P0002';
    end if;
  end loop;

  if exists (
    select 1
    from public.site_public_upload_grants as grant_row
    where grant_row.business_id = requested_business_id
      and grant_row.submission_attempt_id = requested_submission_attempt_id
      and (
        grant_row.client_subject_hash <> requested_client_subject_hash
        or grant_row.form_id <> requested_form_id
        or grant_row.release_id <> requested_release_id
        or grant_row.action_key <> requested_action_key
      )
  ) then
    raise exception 'site_upload_attempt_binding_invalid' using errcode = '22023';
  end if;

  if existing_grant_count > 0 then
    -- A replay must describe the complete original question/count manifest.
    -- It may not add files, change a question binding, or consume another
    -- reservation under the same attempt UUID.
    if existing_grant_count <> total_count
      or (
        select count(*) from jsonb_array_elements(requested_files)
      ) <> (
        select count(distinct grant_row.question_key)
        from public.site_public_upload_grants as grant_row
        where grant_row.business_id = requested_business_id
          and grant_row.submission_attempt_id = requested_submission_attempt_id
      )
    then
      raise exception 'site_upload_attempt_binding_invalid' using errcode = '22023';
    end if;

    -- Check every original row before returning the replay manifest.  A
    -- DISTINCT ON question check would inspect only the first ordinal and
    -- could expose a still-open capability alongside a closed grant.
    if exists (
      select 1
      from public.site_public_upload_grants as closed_grant
      where closed_grant.business_id = requested_business_id
        and closed_grant.submission_attempt_id = requested_submission_attempt_id
        and closed_grant.state in (
          'finalizing', 'finalized', 'expired', 'rejected', 'cleaned', 'committed'
        )
    ) then
      raise exception 'site_upload_attempt_closed' using errcode = '55000';
    end if;

    for existing_grant in
      select distinct on (question_key) *
      from public.site_public_upload_grants
      where business_id = requested_business_id
        and submission_attempt_id = requested_submission_attempt_id
      order by question_key, file_ordinal, id
    loop
      select count(*) into existing_question_count
      from public.site_public_upload_grants as grouped_grant
      where grouped_grant.business_id = requested_business_id
        and grouped_grant.submission_attempt_id = requested_submission_attempt_id
        and grouped_grant.question_key = existing_grant.question_key;
      select coalesce(sum((file.value ->> 'count')::integer), 0)
        into requested_question_count
      from jsonb_array_elements(requested_files) as file(value)
      where file.value ->> 'question_key' = existing_grant.question_key;
      if requested_question_count <> existing_question_count then
        raise exception 'site_upload_attempt_binding_invalid' using errcode = '22023';
      end if;
    end loop;

    return existing_grants;
  end if;

  if business_reserved + total_count * 10485760 > 536870912
    or form_reserved + total_count * 10485760 > 268435456
    or client_reserved + total_count * 10485760 > 104857600
  then
    raise exception 'site_upload_quota_exceeded' using errcode = '54000';
  end if;
  if (
    select count(*) from public.site_public_upload_grants as grant_row
    where grant_row.business_id = requested_business_id
      and grant_row.submission_attempt_id = requested_submission_attempt_id
  ) + total_count > 5 then
    raise exception 'site_upload_submission_file_limit' using errcode = '22023';
  end if;

  for file_request in
    select value from jsonb_array_elements(requested_files)
  loop
    question_key_value := file_request ->> 'question_key';
    count_value := (file_request ->> 'count')::integer;
    select count(*) into current_count
    from public.site_public_upload_grants as grant_row
    where grant_row.business_id = requested_business_id
      and grant_row.submission_attempt_id = requested_submission_attempt_id
      and grant_row.question_key = question_key_value;
    question := null;
    select question_value.value into question
    from jsonb_array_elements(requested_questions) as question_value(value)
    where coalesce(question_value.value ->> 'question_key', question_value.value ->> 'questionKey') = question_key_value;
    field_key_value := coalesce(question ->> 'field_key', question ->> 'fieldKey');
    object_id_value := (coalesce(question ->> 'object_definition_id', question ->> 'objectDefinitionId'))::uuid;
    field_id_value := (coalesce(question ->> 'field_definition_id', question ->> 'fieldDefinitionId'))::uuid;
    attachment_kind_value := coalesce(question ->> 'attachment_kind', question ->> 'uploadKind');
    max_files_value := (coalesce(question ->> 'max_files', question ->> 'maxFiles'))::integer;
    if current_count + count_value > max_files_value then
      raise exception 'site_upload_question_file_limit' using errcode = '22023';
    end if;
    for file_ordinal_value in (current_count + 1)..(current_count + count_value)
    loop
      new_grant_id := gen_random_uuid();
      insert into public.site_public_upload_grants (
        id, business_id, form_id, release_id, action_key, submission_attempt_id,
        question_key, field_key, object_definition_id, field_definition_id,
        file_ordinal, max_files, client_subject_hash, storage_key,
        attachment_kind, maximum_bytes, reserved_bytes, issued_at,
        application_expires_at, reservation_expires_at
      ) values (
        new_grant_id, requested_business_id, requested_form_id, requested_release_id,
        requested_action_key, requested_submission_attempt_id,
        question_key_value, field_key_value, object_id_value, field_id_value,
        file_ordinal_value, max_files_value, requested_client_subject_hash,
        'quarantine/' || requested_business_id::text || '/' || new_grant_id::text,
        attachment_kind_value,
        case when attachment_kind_value = 'pdf' then 10485760 else 3145728 end,
        10485760,
        statement_timestamp(),
        statement_timestamp() + interval '15 minutes',
        statement_timestamp() + interval '2 hours 15 minutes'
      ) returning * into new_grant;
      created_grants := created_grants || jsonb_build_array(to_jsonb(new_grant));
    end loop;
  end loop;
  return created_grants;
end;
$$;

revoke all on function public.issue_site_public_upload_grants_v1(
  text, text, text, uuid, uuid, uuid, text, uuid, timestamptz, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.issue_site_public_upload_grants_v1(
  text, text, text, uuid, uuid, uuid, text, uuid, timestamptz, text, jsonb, jsonb
) to service_role;

create or replace function public.mark_site_public_upload_issued_v1(
  requested_grant_id uuid,
  requested_provider_issued_at timestamptz,
  requested_provider_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_row public.site_public_upload_grants;
begin
  select * into grant_row
  from public.site_public_upload_grants
  where id = requested_grant_id
  for update;
  if not found then
    raise exception 'site_upload_not_found' using errcode = 'P0002';
  end if;
  if grant_row.state = 'issued' then
    return to_jsonb(grant_row);
  end if;
  if grant_row.state <> 'reserved'
    or statement_timestamp() > grant_row.application_expires_at
    or requested_provider_expires_at <> requested_provider_issued_at + interval '2 hours'
    or requested_provider_issued_at < grant_row.issued_at
    or requested_provider_issued_at > grant_row.application_expires_at
  then
    raise exception 'site_upload_issue_window_closed' using errcode = '55000';
  end if;
  update public.site_public_upload_grants
  set state = 'issued',
      provider_issued_at = requested_provider_issued_at,
      provider_expires_at = requested_provider_expires_at
  where business_id = grant_row.business_id and id = grant_row.id
  returning * into grant_row;
  return to_jsonb(grant_row);
end;
$$;

revoke all on function public.mark_site_public_upload_issued_v1(
  uuid, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.mark_site_public_upload_issued_v1(
  uuid, timestamptz, timestamptz
) to service_role;

create or replace function public.reject_site_public_upload_grant_v1(
  requested_grant_id uuid,
  requested_reason text,
  requested_claim_token uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_row public.site_public_upload_grants;
begin
  select * into grant_row
  from public.site_public_upload_grants
  where id = requested_grant_id
  for update;
  if not found then
    raise exception 'site_upload_not_found' using errcode = 'P0002';
  end if;
  if grant_row.state in ('committed', 'cleaned') then
    return to_jsonb(grant_row);
  end if;
  if grant_row.state not in ('reserved', 'issued', 'uploaded', 'finalizing') then
    raise exception 'site_upload_reject_invalid_state' using errcode = '55000';
  end if;
  if grant_row.state = 'finalizing'
    and grant_row.finalization_claim_token is distinct from requested_claim_token
  then
    raise exception 'site_upload_claim_lost' using errcode = '55000';
  end if;
  update public.site_public_upload_grants
  set state = 'rejected',
      upload_observation = null,
      verified_storage_key = null,
      finalization_claim_token = null,
      finalization_claim_expires_at = null,
      finalized_at = null
  where business_id = grant_row.business_id and id = grant_row.id
  returning * into grant_row;
  return to_jsonb(grant_row);
end;
$$;

revoke all on function public.reject_site_public_upload_grant_v1(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.reject_site_public_upload_grant_v1(uuid, text, uuid)
  to service_role;

create or replace function public.claim_site_public_upload_finalization_v1(
  requested_business_slug text,
  requested_page_slug text,
  requested_release_token text,
  requested_grant_id uuid,
  requested_submission_attempt_id uuid,
  requested_business_id uuid,
  requested_release_id uuid,
  requested_form_id uuid,
  requested_action_key text,
  requested_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_row public.site_public_upload_grants;
  grant_business_id uuid;
  claim_expiry timestamptz;
  resolved_context jsonb;
begin
  if requested_business_slug is null
    or requested_business_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or requested_page_slug is null
    or requested_page_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or requested_release_token is null
    or requested_release_token !~ '^s_[a-f0-9]{64}$'
    or requested_business_id is null
    or requested_release_id is null
    or requested_form_id is null
    or requested_action_key is null
  then
    raise exception 'site_upload_action_context_unavailable' using errcode = 'P0002';
  end if;

  -- A finalizer must acquire its claim during the 15-minute application
  -- window and prove the exact rendered action before any state mutation.
  -- The Forms resolver owns this write-time release/action/Field authority.
  resolved_context := private.resolve_site_public_form_action_v3(
    requested_business_slug,
    requested_page_slug,
    requested_action_key,
    requested_release_token,
    true
  );

  if resolved_context is null then
    raise exception 'site_upload_action_context_unavailable' using errcode = 'P0002';
  end if;

  select business_id into grant_business_id
  from public.site_public_upload_grants
  where id = requested_grant_id;
  if grant_business_id is null then
    raise exception 'site_upload_not_found' using errcode = 'P0002';
  end if;
  if resolved_context ->> 'business_id' <> requested_business_id::text
    or resolved_context ->> 'release_id' <> requested_release_id::text
    or resolved_context ->> 'form_id' <> requested_form_id::text
    or resolved_context ->> 'action_key' <> requested_action_key
    or resolved_context ->> 'release_token' <> requested_release_token
  then
    raise exception 'site_upload_action_context_mismatch' using errcode = '22023';
  end if;
  perform 1 from public.businesses where id = grant_business_id for update;
  select * into grant_row
  from public.site_public_upload_grants
  where id = requested_grant_id
  for update;
  if grant_row.submission_attempt_id <> requested_submission_attempt_id
    or grant_row.business_id <> requested_business_id
    or grant_row.release_id <> requested_release_id
    or grant_row.form_id <> requested_form_id
    or grant_row.action_key <> requested_action_key
  then
    raise exception 'site_upload_attempt_binding_invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(resolved_context -> 'bindings') as binding_value(value)
    where binding_value.value ->> 'question_key' = grant_row.question_key
      and binding_value.value ->> 'field_key' = grant_row.field_key
      and (binding_value.value ->> 'field_id')::uuid = grant_row.field_definition_id
      and (binding_value.value ->> 'object_id')::uuid = grant_row.object_definition_id
      and binding_value.value ->> 'field_type' = 'file'
      and binding_value.value ->> 'upload_kind' = grant_row.attachment_kind
      and coalesce((binding_value.value ->> 'upload_count')::integer, 1) = grant_row.max_files
  ) then
    raise exception 'site_upload_field_unavailable' using errcode = 'P0002';
  end if;
  if grant_row.state in ('finalized', 'committed') then
    return jsonb_build_object('outcome', 'already_finalized', 'grant', to_jsonb(grant_row));
  end if;
  if grant_row.state = 'finalizing'
    and grant_row.finalization_claim_expires_at > statement_timestamp()
  then
    raise exception 'site_upload_claim_busy' using errcode = '55000';
  end if;
  if grant_row.state not in ('issued', 'uploaded', 'finalizing')
    or statement_timestamp() > grant_row.application_expires_at
    or statement_timestamp() > grant_row.reservation_expires_at
    or not exists (
      select 1
      from public.site_releases as release_row
      join public.site_states as state
        on state.business_id = release_row.business_id
       and state.active_release_id = release_row.id
      where release_row.business_id = grant_row.business_id
        and release_row.id = grant_row.release_id
        and release_row.status = 'published'
        and state.migration_state = 'adopted'
    )
  then
    raise exception 'site_upload_application_expired' using errcode = '55000';
  end if;
  -- The issue-to-upload observation is internal to this same authoritative
  -- claim transaction. No separate caller can mutate an issued grant before
  -- its route/release/attempt binding has been checked.
  if grant_row.state = 'issued' then
    update public.site_public_upload_grants
    set state = 'uploaded'
    where business_id = grant_row.business_id and id = grant_row.id
    returning * into grant_row;
  end if;
  claim_expiry := statement_timestamp() + interval '5 minutes';
  update public.site_public_upload_grants
  set state = 'finalizing',
      finalization_claim_token = requested_claim_token,
      finalization_claim_expires_at = claim_expiry
  where business_id = grant_row.business_id and id = grant_row.id
  returning * into grant_row;
  return jsonb_build_object(
    'outcome', 'claimed',
    'claim_token', requested_claim_token,
    'claim_expires_at', claim_expiry,
    'grant', to_jsonb(grant_row)
  );
end;
$$;

revoke all on function public.claim_site_public_upload_finalization_v1(
  text, text, text, uuid, uuid, uuid, uuid, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.claim_site_public_upload_finalization_v1(
  text, text, text, uuid, uuid, uuid, uuid, uuid, text, uuid
) to service_role;

create or replace function public.assert_site_public_upload_finalization_claim_v1(
  requested_grant_id uuid,
  requested_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.site_public_upload_grants
    where id = requested_grant_id
      and state = 'finalizing'
      and finalization_claim_token = requested_claim_token
      and finalization_claim_expires_at > statement_timestamp()
  ) then
    raise exception 'site_upload_claim_lost' using errcode = '55000';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.assert_site_public_upload_finalization_claim_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.assert_site_public_upload_finalization_claim_v1(uuid, uuid)
  to service_role;

create or replace function public.complete_site_public_upload_finalization_v1(
  requested_grant_id uuid,
  requested_claim_token uuid,
  requested_verified_storage_key text,
  requested_observation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_row public.site_public_upload_grants;
  digest text;
begin
  select * into grant_row
  from public.site_public_upload_grants
  where id = requested_grant_id
  for update;
  if not found then
    raise exception 'site_upload_not_found' using errcode = 'P0002';
  end if;
  if grant_row.state in ('finalized', 'committed') then
    return jsonb_build_object('outcome', 'already_finalized', 'grant', to_jsonb(grant_row));
  end if;
  if grant_row.state <> 'finalizing'
    or grant_row.finalization_claim_token is distinct from requested_claim_token
    or grant_row.finalization_claim_expires_at <= statement_timestamp()
    or requested_observation is null
    or jsonb_typeof(requested_observation) <> 'object'
    or requested_observation ->> 'sha256' !~ '^[a-f0-9]{64}$'
    or (requested_observation ->> 'observed_byte_size')::integer not between 1 and grant_row.maximum_bytes
    or requested_observation ->> 'detected_mime_type' not in (
      'application/pdf', 'image/jpeg', 'image/png', 'image/webp'
    )
  then
    raise exception 'site_upload_finalization_invalid' using errcode = '23514';
  end if;
  if grant_row.attachment_kind = 'pdf'
    and requested_observation ->> 'detected_mime_type' <> 'application/pdf'
  then
    raise exception 'site_upload_content_type_invalid' using errcode = '23514';
  end if;
  if grant_row.attachment_kind = 'image'
    and requested_observation ->> 'detected_mime_type' = 'application/pdf'
  then
    raise exception 'site_upload_content_type_invalid' using errcode = '23514';
  end if;
  digest := requested_observation ->> 'sha256';
  if requested_verified_storage_key <> 'verified/' || grant_row.business_id::text
    || '/' || grant_row.id::text || '/' || digest
  then
    raise exception 'site_upload_verified_key_invalid' using errcode = '23514';
  end if;
  update public.site_public_upload_grants
  set state = 'finalized',
      upload_observation = requested_observation,
      verified_storage_key = requested_verified_storage_key,
      finalized_at = statement_timestamp(),
      finalization_claim_token = null,
      finalization_claim_expires_at = null
  where business_id = grant_row.business_id and id = grant_row.id
  returning * into grant_row;
  return jsonb_build_object('outcome', 'finalized', 'grant', to_jsonb(grant_row));
end;
$$;

revoke all on function public.complete_site_public_upload_finalization_v1(
  uuid, uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.complete_site_public_upload_finalization_v1(
  uuid, uuid, text, jsonb
) to service_role;

-- This helper is intentionally private. The owning Form submit RPC calls it
-- after allocating requested_record_id and requested_receipt_id and before it
-- inserts its Record/receipt rows. All tenant and attachment checks are
-- deferred until that outer transaction commits.
create or replace function private.consume_site_public_upload_grants_v1(
  requested_business_id uuid,
  requested_release_id uuid,
  requested_form_id uuid,
  requested_action_key text,
  requested_submission_attempt_id uuid,
  requested_attempt_expires_at timestamptz,
  requested_grant_ids uuid[],
  requested_record_id uuid,
  requested_receipt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_row public.site_public_upload_grants;
  created_attachment public.site_public_submission_attachments;
  attachment_id uuid;
  grant_count integer;
  committed_bytes bigint;
  incoming_bytes bigint;
  attachment_json jsonb := '[]'::jsonb;
  file_values jsonb := '{}'::jsonb;
  field_key_value text;
  attachment_ids_json jsonb;
  question_key_value text;
  attempt_expiry timestamptz;
begin
  if requested_grant_ids is null
    or cardinality(requested_grant_ids) not between 1 and 5
    or requested_attempt_expires_at <= statement_timestamp()
    or requested_action_key is null
  then
    raise exception 'site_upload_submit_invalid' using errcode = '22023';
  end if;
  perform 1 from public.businesses where id = requested_business_id for update;
  if not found then
    raise exception 'site_upload_not_found' using errcode = 'P0002';
  end if;
  select count(*) into grant_count
  from public.site_public_upload_grants as grant_item
  where grant_item.business_id = requested_business_id
    and grant_item.id = any(requested_grant_ids);
  if grant_count <> cardinality(requested_grant_ids) then
    raise exception 'site_upload_grant_unavailable' using errcode = 'P0002';
  end if;
  if exists (
    select 1
    from public.site_public_upload_grants as attempt_grant
    where attempt_grant.business_id = requested_business_id
      and attempt_grant.submission_attempt_id = requested_submission_attempt_id
      and (
        attempt_grant.form_id <> requested_form_id
        or attempt_grant.release_id <> requested_release_id
        or attempt_grant.action_key <> requested_action_key
      )
  ) then
    raise exception 'site_upload_attempt_binding_invalid' using errcode = '22023';
  end if;
  select min(attempt_grant.reservation_expires_at)
    into attempt_expiry
  from public.site_public_upload_grants as attempt_grant
  where attempt_grant.business_id = requested_business_id
    and attempt_grant.submission_attempt_id = requested_submission_attempt_id;
  if attempt_expiry is null
    or requested_attempt_expires_at <> attempt_expiry
    or attempt_expiry <= statement_timestamp()
  then
    raise exception 'site_upload_submission_attempt_expired' using errcode = '55000';
  end if;

  -- The Form action resolver supplies this frozen context. The release must
  -- still be the adopted active release at the lock boundary; expiry of the
  -- public release does not retroactively delete an already verified grant.
  if not exists (
    select 1
    from public.site_releases as release_row
    join public.site_states as state
      on state.business_id = release_row.business_id
     and state.active_release_id = release_row.id
    where release_row.business_id = requested_business_id
      and release_row.id = requested_release_id
      and release_row.status = 'published'
      and state.migration_state = 'adopted'
  ) then
    raise exception 'site_upload_action_unavailable' using errcode = 'P0002';
  end if;

  for grant_row in
    select *
    from public.site_public_upload_grants
    where business_id = requested_business_id
      and id = any(requested_grant_ids)
    order by id
    for update
  loop
    if grant_row.form_id <> requested_form_id
      or grant_row.release_id <> requested_release_id
      or grant_row.action_key <> requested_action_key
      or grant_row.submission_attempt_id <> requested_submission_attempt_id
      or grant_row.state <> 'finalized'
      or grant_row.submission_attachment_id is not null
      or grant_row.verified_storage_key is null
      or grant_row.upload_observation is null
      or grant_row.reservation_expires_at <= statement_timestamp()
    then
      raise exception 'site_upload_grant_unavailable' using errcode = '55000';
    end if;
    if not exists (
      select 1
      from public.field_definitions as field_definition
      where field_definition.business_id = requested_business_id
        and field_definition.id = grant_row.field_definition_id
        and field_definition.object_definition_id = grant_row.object_definition_id
        and field_definition.key = grant_row.field_key
        and field_definition.field_type = 'file'
        and field_definition.is_active
    ) then
      raise exception 'site_upload_field_unavailable' using errcode = 'P0002';
    end if;
    if exists (
      select 1
      from public.site_public_upload_grants as other_grant
      where other_grant.business_id = grant_row.business_id
        and other_grant.submission_attempt_id = grant_row.submission_attempt_id
        and other_grant.question_key = grant_row.question_key
        and other_grant.file_ordinal = grant_row.file_ordinal
        and other_grant.id <> grant_row.id
        and other_grant.id = any(requested_grant_ids)
    ) then
      raise exception 'site_upload_question_ordinal_duplicate'
        using errcode = '22023';
    end if;
  end loop;

  if exists (
    select 1
    from public.site_public_upload_grants as grant_item
    where grant_item.id = any(requested_grant_ids)
    group by grant_item.question_key, grant_item.max_files
    having count(*) > max(grant_item.max_files)
      or min(grant_item.file_ordinal) <> 1
      or max(grant_item.file_ordinal) <> count(*)
  ) then
    raise exception 'site_upload_question_file_limit' using errcode = '22023';
  end if;

  select coalesce(sum(attachment.byte_size), 0)
    into committed_bytes
  from public.site_public_submission_attachments as attachment
  where attachment.business_id = requested_business_id;
  select coalesce(sum((grant_item.upload_observation ->> 'observed_byte_size')::bigint), 0)
    into incoming_bytes
  from public.site_public_upload_grants as grant_item
  where grant_item.business_id = requested_business_id
    and grant_item.id = any(requested_grant_ids);
  if committed_bytes + incoming_bytes > 2147483648 then
    raise exception 'site_upload_committed_quota_exceeded' using errcode = '54000';
  end if;

  for grant_row in
    select *
    from public.site_public_upload_grants
    where business_id = requested_business_id
      and id = any(requested_grant_ids)
    order by question_key, file_ordinal, id
    for update
  loop
    attachment_id := gen_random_uuid();
    insert into public.site_public_submission_attachments (
      id, business_id, grant_id, receipt_id, record_id, release_id, form_id,
      action_key, submission_attempt_id, question_key, field_key,
      object_definition_id, field_definition_id, file_ordinal,
      verified_storage_key, sha256, byte_size, mime_type
    ) values (
      attachment_id,
      grant_row.business_id,
      grant_row.id,
      requested_receipt_id,
      requested_record_id,
      grant_row.release_id,
      grant_row.form_id,
      grant_row.action_key,
      grant_row.submission_attempt_id,
      grant_row.question_key,
      grant_row.field_key,
      grant_row.object_definition_id,
      grant_row.field_definition_id,
      grant_row.file_ordinal,
      grant_row.verified_storage_key,
      grant_row.upload_observation ->> 'sha256',
      (grant_row.upload_observation ->> 'observed_byte_size')::integer,
      grant_row.upload_observation ->> 'detected_mime_type'
    ) returning * into created_attachment;
    update public.site_public_upload_grants
    set state = 'committed',
        submission_attachment_id = attachment_id
    where business_id = grant_row.business_id and id = grant_row.id;
    attachment_json := attachment_json || jsonb_build_array(to_jsonb(created_attachment));
  end loop;

  for question_key_value, field_key_value in
    select distinct grant_item.question_key, grant_item.field_key
    from public.site_public_upload_grants as grant_item
    where grant_item.business_id = requested_business_id
      and grant_item.id = any(requested_grant_ids)
    order by grant_item.question_key
  loop
    select jsonb_agg(to_jsonb(attachment.id) order by attachment.file_ordinal)
      into attachment_ids_json
    from public.site_public_submission_attachments as attachment
    where attachment.business_id = requested_business_id
      and attachment.record_id = requested_record_id
      and attachment.receipt_id = requested_receipt_id
      and attachment.question_key = question_key_value;
    file_values := file_values || jsonb_build_object(
      field_key_value,
      jsonb_build_object('attachment_ids', attachment_ids_json)
    );
  end loop;
  return jsonb_build_object(
    'attachments', attachment_json,
    'file_values', file_values
  );
end;
$$;

revoke all on function private.consume_site_public_upload_grants_v1(
  uuid, uuid, uuid, text, uuid, timestamptz, uuid[], uuid, uuid
) from public, anon, authenticated, service_role;

create or replace function public.claim_site_public_upload_cleanup_v1(
  requested_grant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_row public.site_public_upload_grants;
  grant_business_id uuid;
  retained_key text;
  cleanup_token uuid := gen_random_uuid();
  cleanup_expiry timestamptz := statement_timestamp() + interval '5 minutes';
begin
  select business_id into grant_business_id
  from public.site_public_upload_grants
  where id = requested_grant_id;
  if grant_business_id is null then
    raise exception 'site_upload_not_found' using errcode = 'P0002';
  end if;
  perform 1 from public.businesses where id = grant_business_id for update;
  select * into grant_row
  from public.site_public_upload_grants
  where id = requested_grant_id
  for update;
  if grant_row.reservation_expires_at > statement_timestamp() then
    raise exception 'site_upload_cleanup_early' using errcode = '55000';
  end if;
  if grant_row.cleanup_claim_token is not null
    and grant_row.cleanup_claim_expires_at > statement_timestamp()
  then
    raise exception 'site_upload_cleanup_busy' using errcode = '55000';
  end if;
  select attachment.verified_storage_key into retained_key
  from public.site_public_submission_attachments as attachment
  where attachment.business_id = grant_row.business_id
    and attachment.grant_id = grant_row.id;

  if retained_key is not null then
    -- Committed receipt ownership survives every release/Record lifecycle.
    update public.site_public_upload_grants
    set reservation_state = 'released',
        reservation_released_at = coalesce(reservation_released_at, statement_timestamp()),
        cleanup_claim_token = cleanup_token,
        cleanup_claim_expires_at = cleanup_expiry,
        cleanup_next_at = cleanup_expiry
    where business_id = grant_row.business_id and id = grant_row.id
    returning * into grant_row;
  else
    if grant_row.state = 'finalizing'
      and grant_row.finalization_claim_expires_at > statement_timestamp()
    then
      raise exception 'site_upload_cleanup_wait_for_finalizer' using errcode = '55000';
    end if;
    update public.site_public_upload_grants
    set state = case
          when state in ('expired', 'rejected', 'cleaned') then state
          else 'expired'
        end,
        upload_observation = null,
        verified_storage_key = null,
        finalized_at = null,
        finalization_claim_token = null,
        finalization_claim_expires_at = null,
        cleanup_claim_token = cleanup_token,
        cleanup_claim_expires_at = cleanup_expiry,
        cleanup_next_at = cleanup_expiry
    where business_id = grant_row.business_id and id = grant_row.id
    returning * into grant_row;
  end if;
  return jsonb_build_object(
    'state', grant_row.state,
    'cleanup_claim_token', cleanup_token,
    'verified_storage_key', retained_key,
    'quarantine_key', grant_row.storage_key,
    'quarantine_prefix', 'quarantine/' || grant_row.business_id::text || '/' || grant_row.id::text,
    'verified_prefix', grant_row.cleanup_verified_prefix
  );
end;
$$;

revoke all on function public.claim_site_public_upload_cleanup_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_site_public_upload_cleanup_v1(uuid)
  to service_role;

create or replace function public.finalize_site_public_upload_cleanup_v1(
  requested_grant_id uuid,
  requested_cleanup_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_row public.site_public_upload_grants;
begin
  select * into grant_row
  from public.site_public_upload_grants
  where id = requested_grant_id
  for update;
  if not found then
    raise exception 'site_upload_not_found' using errcode = 'P0002';
  end if;
  if grant_row.cleanup_claim_token is distinct from requested_cleanup_claim_token
    or grant_row.cleanup_claim_expires_at <= statement_timestamp()
  then
    raise exception 'site_upload_cleanup_claim_lost' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.site_public_submission_attachments as attachment
    where attachment.business_id = grant_row.business_id
      and attachment.grant_id = grant_row.id
  ) then
    update public.site_public_upload_grants
    set reservation_state = 'released',
        reservation_released_at = coalesce(reservation_released_at, statement_timestamp()),
        cleanup_claim_token = null,
        cleanup_claim_expires_at = null,
        cleanup_next_at = statement_timestamp() + interval '1 day'
    where business_id = grant_row.business_id and id = grant_row.id
    returning * into grant_row;
    return jsonb_build_object('state', grant_row.state);
  end if;
  if grant_row.state = 'cleaned' then
    update public.site_public_upload_grants
    set cleanup_claim_token = null,
        cleanup_claim_expires_at = null,
        cleanup_next_at = statement_timestamp() + interval '1 day'
    where business_id = grant_row.business_id and id = grant_row.id
    returning * into grant_row;
    return jsonb_build_object('state', grant_row.state);
  end if;
  if grant_row.state not in ('expired', 'rejected')
    or grant_row.reservation_expires_at > statement_timestamp()
  then
    raise exception 'site_upload_cleanup_incomplete' using errcode = '55000';
  end if;
  update public.site_public_upload_grants
  set state = 'cleaned',
      reservation_state = 'released',
      reservation_released_at = coalesce(reservation_released_at, statement_timestamp()),
      cleanup_claim_token = null,
      cleanup_claim_expires_at = null,
      cleanup_next_at = statement_timestamp() + interval '1 day',
      cleaned_at = coalesce(cleaned_at, statement_timestamp())
  where business_id = grant_row.business_id and id = grant_row.id
  returning * into grant_row;
  return jsonb_build_object('state', grant_row.state);
end;
$$;

revoke all on function public.finalize_site_public_upload_cleanup_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_site_public_upload_cleanup_v1(uuid, uuid)
  to service_role;

create or replace function public.list_site_public_upload_cleanup_candidates_v1(
  requested_limit integer default 100
)
returns table (id uuid)
language sql
security definer
set search_path = ''
as $$
  select grant_row.id
  from public.site_public_upload_grants as grant_row
  where (
    grant_row.reservation_expires_at <= statement_timestamp()
    and grant_row.state in (
      'reserved', 'issued', 'uploaded', 'finalizing', 'finalized', 'committed',
      'expired', 'rejected'
    )
    and (grant_row.cleanup_claim_token is null
      or grant_row.cleanup_claim_expires_at <= statement_timestamp())
    and (grant_row.cleanup_next_at is null
      or grant_row.cleanup_next_at <= statement_timestamp())
  )
  or (
    grant_row.state = 'cleaned'
    and grant_row.cleaned_at >= statement_timestamp() - interval '7 days'
    and (grant_row.cleanup_claim_token is null
      or grant_row.cleanup_claim_expires_at <= statement_timestamp())
    and (grant_row.cleanup_next_at is null
      or grant_row.cleanup_next_at <= statement_timestamp())
  )
  order by coalesce(grant_row.cleanup_next_at, grant_row.reservation_expires_at),
    grant_row.id
  limit greatest(1, least(coalesce(requested_limit, 100), 100));
$$;

revoke all on function public.list_site_public_upload_cleanup_candidates_v1(integer)
  from public, anon, authenticated;
grant execute on function public.list_site_public_upload_cleanup_candidates_v1(integer)
  to service_role;
