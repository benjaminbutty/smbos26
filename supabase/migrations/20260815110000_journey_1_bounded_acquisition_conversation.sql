-- Journey 1: bounded, temporary clarification state for public acquisition.
-- This is not a chat transcript. It is a small structured decision record that
-- is scrubbed with the original request and candidate payload.

alter table public.anonymous_build_sessions
  add column clarification_json jsonb null check (
    clarification_json is null
    or (
      jsonb_typeof(clarification_json) = 'object'
      and octet_length(clarification_json::text) <= 32768
    )
  );

alter table public.anonymous_build_sessions
  drop constraint anonymous_build_sessions_claim_shape;

alter table public.anonymous_build_sessions
  add constraint anonymous_build_sessions_claim_shape check (
    (
      claim_status = 'claimed'
      and claimed_business_id is not null
      and claimed_user_id is not null
      and claimed_at is not null
      and request_text is null
      and proposal_json is null
      and clarification_json is null
    )
    or (
      claim_status <> 'claimed'
      and claimed_business_id is null
      and claimed_user_id is null
      and claimed_at is null
    )
  );

comment on column public.anonymous_build_sessions.clarification_json is
  'Temporary bounded structured acquisition answers; never a permanent transcript and scrubbed on expiry or claim.';

create or replace function public.reserve_anonymous_build_attempt(
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

  update public.anonymous_build_sessions
  set
    claim_status = 'expired',
    request_text = null,
    proposal_json = null,
    clarification_json = null
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
      expires_at = requested_expires_at,
      request_text = null,
      proposal_json = null,
      clarification_json = null
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

create or replace function public.claim_anonymous_build_session(
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
    proposal_json = null,
    clarification_json = null
  where id = selected_session.id;
  return created_business;
end;
$$;

