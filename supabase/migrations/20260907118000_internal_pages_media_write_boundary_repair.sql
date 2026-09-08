-- Repair environments that already applied the first private media policy
-- migration. The authenticated browser can read through the member policy;
-- only the narrow server upload route may write validated media objects.
drop policy if exists "Owners and admins can upload private Page assets"
  on storage.objects;

revoke insert, update, delete on table public.media_assets from authenticated;
