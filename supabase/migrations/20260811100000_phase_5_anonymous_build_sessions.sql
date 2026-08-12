-- Phase 5: temporary server-owned state for the pre-signup Lenni journey.
-- No Business exists yet. Raw prompts and authoritative operations are never
-- exposed through PostgREST and are scrubbed on claim or expiry.

create table public.anonymous_build_sessions (
  id uuid primary key default gen_random_uuid(),
  session_token_hash text not null unique check (
    session_token_hash ~ '^[a-f0-9]{64}$'
  ),
  requested_category text not null check (
    requested_category in (
      'appointments', 'delivery', 'jobs', 'enquiries', 'products', 'other'
    )
  ),
  request_text text null check (
    request_text is null
    or char_length(trim(request_text)) between 12 and 4000
  ),
  proposal_json jsonb null check (
    proposal_json is null
    or (
      jsonb_typeof(proposal_json) = 'object'
      and octet_length(proposal_json::text) <= 524288
    )
  ),
  attempt_count integer not null default 0 check (attempt_count between 0 and 2),
  proposal_count integer not null default 0 check (proposal_count between 0 and 2),
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
      and request_text is null
      and proposal_json is null
    )
    or (
      claim_status <> 'claimed'
      and claimed_business_id is null
      and claimed_user_id is null
      and claimed_at is null
    )
  )
);

-- This distinct row prevents concurrent/new-cookie requests from bypassing the
-- daily public-AI ceiling. The key is a server HMAC; no raw network address is
-- persisted. It is acquisition allowance state, not billing infrastructure.
create table public.anonymous_build_daily_quotas (
  rate_key text not null check (rate_key ~ '^[a-f0-9]{64}$'),
  attempt_day date not null,
  attempt_count integer not null check (attempt_count between 1 and 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (rate_key, attempt_day)
);

create index anonymous_build_sessions_expiry_idx
  on public.anonymous_build_sessions (expires_at, claim_status);

create trigger anonymous_build_sessions_set_updated_at
before update on public.anonymous_build_sessions
for each row execute function private.set_updated_at();

create trigger anonymous_build_daily_quotas_set_updated_at
before update on public.anonymous_build_daily_quotas
for each row execute function private.set_updated_at();

alter table public.anonymous_build_sessions enable row level security;
alter table public.anonymous_build_daily_quotas enable row level security;

revoke all on table public.anonymous_build_sessions from public, anon, authenticated;
revoke all on table public.anonymous_build_daily_quotas from public, anon, authenticated;
grant all on table public.anonymous_build_sessions to service_role;
grant all on table public.anonymous_build_daily_quotas to service_role;

comment on table public.anonymous_build_sessions is
  'Temporary platform-owned pre-signup acquisition state; not Business, configuration, or operational data.';
comment on table public.anonymous_build_daily_quotas is
  'Short-lived HMAC-keyed public acquisition attempt ceiling; contains no raw network address or Business data.';

create function public.reserve_anonymous_build_attempt(
  requested_session_token_hash text,
  requested_rate_key text,
  requested_category_value text,
  requested_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_session public.anonymous_build_sessions;
  quota_attempt_count integer;
  next_attempt integer;
begin
  if requested_session_token_hash !~ '^[a-f0-9]{64}$'
    or requested_rate_key !~ '^[a-f0-9]{64}$'
    or requested_category_value not in (
      'appointments', 'delivery', 'jobs', 'enquiries', 'products', 'other'
    )
    or requested_expires_at <= statement_timestamp()
    or requested_expires_at > statement_timestamp() + interval '25 hours'
  then
    raise exception 'anonymous_build_reservation_invalid' using errcode = '22023';
  end if;

  -- Bounded opportunistic retention; no worker/queue is needed for this MVP.
  update public.anonymous_build_sessions
  set claim_status = 'expired', request_text = null, proposal_json = null
  where claim_status = 'active' and expires_at <= statement_timestamp();
  delete from public.anonymous_build_sessions
  where claim_status = 'expired' and updated_at < statement_timestamp() - interval '2 days';
  delete from public.anonymous_build_daily_quotas
  where attempt_day < current_date - 2;

  select session.* into selected_session
  from public.anonymous_build_sessions as session
  where session.session_token_hash = requested_session_token_hash
  for update;

  if found and (
    selected_session.claim_status <> 'active'
    or selected_session.expires_at <= statement_timestamp()
  ) then
    return jsonb_build_object('ok', false, 'code', 'session_unavailable');
  end if;
  if found and selected_session.attempt_count >= 2 then
    return jsonb_build_object('ok', false, 'code', 'session_limit_reached');
  end if;

  insert into public.anonymous_build_daily_quotas (
    rate_key, attempt_day, attempt_count
  ) values (
    requested_rate_key, current_date, 1
  )
  on conflict (rate_key, attempt_day) do update
  set attempt_count = public.anonymous_build_daily_quotas.attempt_count + 1
  where public.anonymous_build_daily_quotas.attempt_count < 6
  returning attempt_count into quota_attempt_count;

  if quota_attempt_count is null then
    return jsonb_build_object('ok', false, 'code', 'daily_limit_reached');
  end if;

  if selected_session.id is null then
    insert into public.anonymous_build_sessions (
      session_token_hash,
      requested_category,
      expires_at,
      attempt_count
    ) values (
      requested_session_token_hash,
      requested_category_value,
      requested_expires_at,
      1
    ) returning * into selected_session;
    next_attempt := 1;
  else
    next_attempt := selected_session.attempt_count + 1;
    update public.anonymous_build_sessions
    set
      attempt_count = next_attempt,
      requested_category = requested_category_value,
      expires_at = requested_expires_at
    where id = selected_session.id
    returning * into selected_session;
  end if;

  return jsonb_build_object(
    'ok', true,
    'session_id', selected_session.id,
    'attempt_number', next_attempt,
    'daily_attempt_number', quota_attempt_count
  );
end;
$$;

revoke all on function public.reserve_anonymous_build_attempt(text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.reserve_anonymous_build_attempt(text, text, text, timestamptz)
  to service_role;

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
    raise exception 'anonymous_build_authentication_required' using errcode = '42501';
  end if;
  if char_length(coalesce(requested_session_token, '')) < 32
    or char_length(coalesce(requested_session_token, '')) > 256
  then
    raise exception 'anonymous_build_session_invalid' using errcode = '22023';
  end if;

  token_hash := encode(
    extensions.digest(convert_to(requested_session_token, 'UTF8'), 'sha256'),
    'hex'
  );
  select session.* into selected_session
  from public.anonymous_build_sessions as session
  where session.session_token_hash = token_hash
  for update;
  if not found then
    raise exception 'anonymous_build_session_not_found' using errcode = 'P0002';
  end if;

  if selected_session.claim_status = 'claimed' then
    if selected_session.claimed_user_id is distinct from current_user_id
      or selected_session.claimed_business_id is null
    then
      raise exception 'anonymous_build_session_already_claimed' using errcode = '42501';
    end if;
    select business.* into created_business
    from public.businesses as business
    where business.id = selected_session.claimed_business_id;
    if not found then
      raise exception 'anonymous_build_claimed_business_missing' using errcode = 'P0001';
    end if;
    return created_business;
  end if;

  if selected_session.claim_status <> 'active'
    or selected_session.expires_at <= statement_timestamp()
  then
    raise exception 'anonymous_build_session_expired' using errcode = 'P0001';
  end if;
  if char_length(trim(coalesce(requested_business_name, ''))) not between 1 and 120
    or char_length(trim(coalesce(requested_timezone, ''))) not between 1 and 80
  then
    raise exception 'anonymous_build_business_details_invalid' using errcode = '22023';
  end if;

  payload := selected_session.proposal_json;
  if payload is null
    or payload ? 'operations' = false
    or jsonb_typeof(payload -> 'operations') <> 'array'
  then
    raise exception 'anonymous_build_proposal_invalid' using errcode = '22023';
  end if;
  perform private.assert_configuration_operations_v1(payload -> 'operations');

  created_business := public.create_business(
    trim(requested_business_name),
    selected_session.requested_category,
    trim(requested_timezone)
  );
  select head.* into current_head
  from public.business_configuration_heads as head
  where head.business_id = created_business.id
  for share;
  if not found then
    raise exception 'anonymous_build_configuration_head_missing' using errcode = 'P0001';
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
    created_business.id, current_user_id, proposed_change.id
  );
  if validated_change.status <> 'validated' then
    raise exception 'anonymous_build_configuration_invalid' using errcode = 'P0001';
  end if;
  applied_change := public.apply_configuration_change(
    created_business.id, current_user_id, validated_change.id
  );
  if applied_change.status <> 'applied' then
    raise exception 'anonymous_build_configuration_not_applied' using errcode = 'P0001';
  end if;

  update public.anonymous_build_sessions
  set
    claim_status = 'claimed',
    claimed_business_id = created_business.id,
    claimed_user_id = current_user_id,
    claimed_at = statement_timestamp(),
    request_text = null,
    proposal_json = null
  where id = selected_session.id;
  return created_business;
end;
$$;

revoke all on function public.claim_anonymous_build_session(text, text, text)
  from public, anon, service_role;
grant execute on function public.claim_anonymous_build_session(text, text, text)
  to authenticated;

comment on function public.reserve_anonymous_build_attempt(text, text, text, timestamptz) is
  'Atomically enforces the two-attempt session allowance and six-attempt HMAC-keyed daily acquisition ceiling before provider execution.';
comment on function public.claim_anonymous_build_session(text, text, text) is
  'Atomically claims one temporary Lenni session, applies its owner-approved configuration through M5, and scrubs temporary prompt/payload data.';
