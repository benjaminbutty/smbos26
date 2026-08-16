-- Journey 1: workspace creation must follow the owner's explicit preview decision.
-- The accepted marker is temporary session state; configuration and operational
-- data are still created only inside the existing trusted claim transaction.

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
  if selected_session.accepted_candidate_checksum is null
    or selected_session.accepted_at is null
  then
    raise exception 'anonymous_build_setup_not_accepted' using errcode = '42501';
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

comment on function public.claim_anonymous_build_session(text, text, text) is
  'Claims an owner-accepted temporary Lenni candidate through the trusted configuration boundary.';
