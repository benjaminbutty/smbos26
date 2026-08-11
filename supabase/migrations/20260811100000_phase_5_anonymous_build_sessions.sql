-- Phase 5: temporary acquisition state for the pre-signup Lenni journey.
--
-- This is platform-owned acquisition state, not tenant data. It intentionally
-- has no business_id because a Business does not exist until the claim
-- transaction creates one. The stored operations remain private until the
-- authenticated claim function hands them to the existing M5 lifecycle.

create table public.anonymous_build_sessions (
  id uuid primary key default gen_random_uuid(),
  session_token_hash text not null unique check (
    session_token_hash ~ '^[a-f0-9]{64}$'
  ),
  requested_category text not null check (
    requested_category in ('appointments', 'delivery', 'jobs', 'other')
  ),
  request_text text not null check (
    char_length(trim(request_text)) between 12 and 4000
  ),
  proposal_json jsonb not null check (
    jsonb_typeof(proposal_json) = 'object'
    and octet_length(proposal_json::text) <= 524288
  ),
  proposal_count integer not null default 1 check (proposal_count between 1 and 2),
  regeneration_count integer not null default 0 check (regeneration_count between 0 and 1),
  expires_at timestamptz not null,
  claim_status text not null default 'active' check (
    claim_status in ('active', 'expired', 'claimed')
  ),
  claimed_business_id uuid null references public.businesses(id) on delete cascade,
  claimed_user_id uuid null references auth.users(id) on delete cascade,
  claimed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint anonymous_build_sessions_claim_shape check (
    (
      claim_status = 'claimed'
      and claimed_business_id is not null
      and claimed_user_id is not null
      and claimed_at is not null
    )
    or (
      claim_status <> 'claimed'
      and claimed_business_id is null
      and claimed_user_id is null
      and claimed_at is null
    )
  )
);

create index anonymous_build_sessions_expiry_idx
  on public.anonymous_build_sessions (expires_at, claim_status);

create trigger anonymous_build_sessions_set_updated_at
before update on public.anonymous_build_sessions
for each row execute function private.set_updated_at();

alter table public.anonymous_build_sessions enable row level security;

revoke all on table public.anonymous_build_sessions from public, anon, authenticated;
grant all on table public.anonymous_build_sessions to service_role;

comment on table public.anonymous_build_sessions is
  'Temporary server-owned pre-signup acquisition state. It is not Business, configuration, or operational data.';

create function public.claim_anonymous_build_session(
  requested_session_token text,
  requested_business_name text,
  requested_timezone text
)
returns public.businesses
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  token_hash text;
  selected_session public.anonymous_build_sessions;
  payload jsonb;
  created_business public.businesses;
  current_head public.business_configuration_heads;
  proposed_change public.configuration_change_sets;
  validated_change public.configuration_change_sets;
  applied_change public.configuration_change_sets;
begin
  if current_user_id is null then
    raise exception 'anonymous_build_authentication_required'
      using errcode = '42501';
  end if;

  if char_length(coalesce(requested_session_token, '')) < 32
    or char_length(coalesce(requested_session_token, '')) > 256
  then
    raise exception 'anonymous_build_session_invalid'
      using errcode = '22023';
  end if;

  token_hash := encode(
    extensions.digest(
      convert_to(requested_session_token, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  select session.*
  into selected_session
  from public.anonymous_build_sessions as session
  where session.session_token_hash = token_hash
  for update;

  if not found then
    raise exception 'anonymous_build_session_not_found'
      using errcode = 'P0002';
  end if;

  if selected_session.claim_status = 'claimed' then
    if selected_session.claimed_user_id is distinct from current_user_id
      or selected_session.claimed_business_id is null
    then
      raise exception 'anonymous_build_session_already_claimed'
        using errcode = '42501';
    end if;

    select business.*
    into created_business
    from public.businesses as business
    where business.id = selected_session.claimed_business_id;
    if not found then
      raise exception 'anonymous_build_claimed_business_missing'
        using errcode = 'P0001';
    end if;
    return created_business;
  end if;

  if selected_session.claim_status <> 'active'
    or selected_session.expires_at <= statement_timestamp()
  then
    raise exception 'anonymous_build_session_expired'
      using errcode = 'P0001';
  end if;

  if char_length(trim(coalesce(requested_business_name, ''))) not between 1 and 120
    or char_length(trim(coalesce(requested_timezone, ''))) not between 1 and 80
  then
    raise exception 'anonymous_build_business_details_invalid'
      using errcode = '22023';
  end if;

  payload := selected_session.proposal_json;
  if payload ? 'operations' = false
    or jsonb_typeof(payload -> 'operations') <> 'array'
  then
    raise exception 'anonymous_build_proposal_invalid'
      using errcode = '22023';
  end if;

  -- The stored payload was created by the server, but the M5 grammar is still
  -- rechecked at the database boundary before any Business is created.
  perform private.assert_configuration_operations_v1(payload -> 'operations');

  -- create_business creates the membership and its empty configuration
  -- baseline. Every later step is in this same transaction, so an exception
  -- rolls back the Business, membership, proposal and configuration writes.
  created_business := public.create_business(
    trim(requested_business_name),
    selected_session.requested_category,
    trim(requested_timezone)
  );

  select head.*
  into current_head
  from public.business_configuration_heads as head
  where head.business_id = created_business.id
  for share;
  if not found then
    raise exception 'anonymous_build_configuration_head_missing'
      using errcode = 'P0001';
  end if;

  proposed_change := public.propose_configuration_change(
    created_business.id,
    current_user_id,
    current_head.active_version_id,
    current_head.head_revision,
    'Lenni starting workspace',
    payload -> 'proposal' ->> 'understanding',
    payload -> 'operations'
  );

  validated_change := public.validate_configuration_change(
    created_business.id,
    current_user_id,
    proposed_change.id
  );
  if validated_change.status <> 'validated' then
    raise exception 'anonymous_build_configuration_invalid'
      using errcode = 'P0001';
  end if;

  applied_change := public.apply_configuration_change(
    created_business.id,
    current_user_id,
    validated_change.id
  );
  if applied_change.status <> 'applied' then
    raise exception 'anonymous_build_configuration_not_applied'
      using errcode = 'P0001';
  end if;

  update public.anonymous_build_sessions as session
  set
    claim_status = 'claimed',
    claimed_business_id = created_business.id,
    claimed_user_id = current_user_id,
    claimed_at = statement_timestamp()
  where session.id = selected_session.id;

  return created_business;
end;
$$;

revoke all on function public.claim_anonymous_build_session(text, text, text)
  from public, anon, service_role;
grant execute on function public.claim_anonymous_build_session(text, text, text)
  to authenticated;

comment on function public.claim_anonymous_build_session(text, text, text) is
  'Atomically claims one temporary Lenni acquisition session, creates a Business, and applies its validated starter configuration through the existing M5 lifecycle.';
