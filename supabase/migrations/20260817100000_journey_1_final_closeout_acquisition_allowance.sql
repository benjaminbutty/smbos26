-- Journey 1 final closeout: distinguish bounded provider retries from the
-- owner-facing allowance of two successful refinements.

alter table public.anonymous_build_sessions
  drop constraint if exists anonymous_build_sessions_attempt_count_check,
  drop constraint if exists anonymous_build_sessions_proposal_count_check;

alter table public.anonymous_build_sessions
  add constraint anonymous_build_sessions_attempt_count_check
    check (attempt_count between 0 and 6),
  add constraint anonymous_build_sessions_proposal_count_check
    check (proposal_count between 0 and 6),
  add column successful_refinement_count integer not null default 0
    check (successful_refinement_count between 0 and 2);

comment on column public.anonymous_build_sessions.successful_refinement_count is
  'Owner-facing count of validated acquisition refinements; provider retries and failed attempts do not increment this value.';

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
  -- Six provider reservations share the existing six-attempt daily ceiling.
  -- The separate successful_refinement_count is the owner-facing allowance.
  if found and selected_session.attempt_count >= 6 then
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
