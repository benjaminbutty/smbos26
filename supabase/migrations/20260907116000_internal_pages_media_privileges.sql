-- The narrow media route uses the trusted server client for the object upload
-- and registry insert. New tables do not inherit the privileges required by
-- the Supabase service role, so grant only the operations used by that route.
grant select on table public.media_assets to authenticated;
grant select, insert, update, delete on table public.media_assets to service_role;
