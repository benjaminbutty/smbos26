create or replace function public.submit_public_preorder(
  requested_business_slug text,
  requested_page_slug text,
  requested_preorder_key text,
  submission jsonb,
  requested_request_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  business_id_value uuid;
  experience_id_value uuid;
  requested_location_id uuid;
begin
  select business.id
  into business_id_value
  from public.businesses as business
  join public.pages as page
    on page.business_id = business.id
  where business.slug = requested_business_slug
    and page.slug = requested_page_slug
    and page.audience = 'public'
    and page.status = 'published'
    and page.is_active
    and exists (
      select 1
      from jsonb_array_elements(page.layout_json -> 'blocks') as block
      where block ->> 'type' = 'preorder'
        and block ->> 'preorder_key' = requested_preorder_key
    )
  for share of page;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select experience.id
  into experience_id_value
  from public.preorder_experiences as experience
  where experience.business_id = business_id_value
    and experience.key = requested_preorder_key
    and experience.is_active
  for share of experience;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  begin
    requested_location_id := (submission ->> 'location_id')::uuid;
  exception
    when invalid_text_representation then
      return private.submit_public_preorder_m4(
        requested_business_slug,
        requested_page_slug,
        requested_preorder_key,
        submission,
        requested_request_hash
      );
  end;

  if requested_location_id is not null then
    perform 1
    from public.preorder_experience_locations as allowed
    where allowed.business_id = business_id_value
      and allowed.preorder_experience_id = experience_id_value
      and allowed.location_id = requested_location_id
      and allowed.is_active
    for share of allowed;

    if not found then
      return jsonb_build_object('ok', false, 'code', 'invalid_location');
    end if;

    perform 1
    from public.locations as location
    where location.business_id = business_id_value
      and location.id = requested_location_id
      and location.is_active
    for share of location;

    if not found then
      return jsonb_build_object('ok', false, 'code', 'invalid_location');
    end if;
  end if;

  return private.submit_public_preorder_m4(
    requested_business_slug,
    requested_page_slug,
    requested_preorder_key,
    submission,
    requested_request_hash
  );
end;
$$;

revoke all on function public.claim_preorder_confirmation_email(
  text,
  text,
  text,
  uuid
) from public, anon, authenticated, service_role;

alter function public.claim_preorder_confirmation_email(
  text,
  text,
  text,
  uuid
) set schema private;

revoke all on function private.claim_preorder_confirmation_email(
  text,
  text,
  text,
  uuid
) from public, anon, authenticated, service_role;

create function public.claim_preorder_confirmation_email(
  requested_business_slug text,
  requested_preorder_key text,
  requested_idempotency_token uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  claimed_confirmation jsonb;
begin
  update public.preorder_submissions as submission
  set
    email_status = 'sending',
    email_error = null,
    email_attempted_at = now()
  from public.businesses as business
  join public.preorder_experiences as experience
    on experience.business_id = business.id
  where business.slug = requested_business_slug
    and experience.key = requested_preorder_key
    and submission.business_id = business.id
    and submission.preorder_experience_id = experience.id
    and submission.idempotency_token = requested_idempotency_token
    and submission.confirmation_json is not null
    and submission.email_status = 'pending'
  returning submission.confirmation_json into claimed_confirmation;

  return claimed_confirmation;
end;
$$;

revoke all on function public.claim_preorder_confirmation_email(
  text,
  text,
  uuid
) from public, anon, authenticated;

grant execute on function public.claim_preorder_confirmation_email(
  text,
  text,
  uuid
) to service_role;

comment on function public.submit_public_preorder(
  text,
  text,
  text,
  jsonb,
  text
) is
  'Locks and rechecks the active public Page, preorder experience, allowed association and Location before delegating to the retained atomic M4 implementation.';

comment on function public.claim_preorder_confirmation_email(
  text,
  text,
  uuid
) is
  'Service-role-only atomic email claim for an accepted submission; mutable Page state cannot strand committed operational follow-up.';

comment on function private.claim_preorder_confirmation_email(
  text,
  text,
  text,
  uuid
) is
  'Retained inaccessible Page-dependent Phase 1 implementation superseded by the operational submission identity boundary.';
