create table public.marketing_waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (
    email = lower(trim(email))
    and char_length(email) between 3 and 320
  ),
  business_type text null check (
    business_type is null
    or char_length(trim(business_type)) between 1 and 120
  ),
  created_at timestamptz not null default now()
);

comment on table public.marketing_waitlist_signups is
  'Marketing-only early-access interest. This is not tenant Business data.';

alter table public.marketing_waitlist_signups enable row level security;

revoke all on table public.marketing_waitlist_signups from anon, authenticated;
grant insert on table public.marketing_waitlist_signups to service_role;
