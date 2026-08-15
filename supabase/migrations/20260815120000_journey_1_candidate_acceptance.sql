alter table public.anonymous_build_sessions
  add column accepted_candidate_checksum text,
  add column accepted_at timestamptz;

alter table public.anonymous_build_sessions
  add constraint anonymous_build_sessions_accepted_candidate_checksum_check
  check (
    accepted_candidate_checksum is null
    or accepted_candidate_checksum ~ '^[a-f0-9]{64}$'
  );

comment on column public.anonymous_build_sessions.accepted_candidate_checksum is
  'The exact server-derived candidate selected by the owner for signup/claim; preview data is never stored here.';
comment on column public.anonymous_build_sessions.accepted_at is
  'When the owner deliberately selected Use this setup; this does not create a Business or apply configuration.';

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
      and accepted_candidate_checksum is null
      and accepted_at is null
    )
    or (
      claim_status <> 'claimed'
      and claimed_business_id is null
      and claimed_user_id is null
      and claimed_at is null
    )
  );

create or replace function public.scrub_anonymous_build_acceptance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.claim_status <> 'active'
     or new.attempt_count > old.attempt_count then
    new.accepted_candidate_checksum := null;
    new.accepted_at := null;
  end if;
  return new;
end;
$$;

create trigger anonymous_build_sessions_scrub_acceptance
before update on public.anonymous_build_sessions
for each row execute function public.scrub_anonymous_build_acceptance();
