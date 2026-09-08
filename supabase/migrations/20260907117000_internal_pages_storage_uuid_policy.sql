-- configuration_uuid_is_valid is intentionally executable only by trusted
-- database code. Storage policy evaluation runs as the authenticated role,
-- so validate the tenant folder shape locally before calling the granted
-- membership helpers.
drop policy if exists "Members can read private Page assets" on storage.objects;
create policy "Members can read private Page assets"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'page-assets'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and private.is_business_member(((storage.foldername(name))[1])::uuid)
);

-- Uploads stay inside the authenticated server route, which validates and
-- re-encodes the image before using the trusted Storage client. Do not
-- recreate an authenticated INSERT policy here: direct Storage uploads would
-- bypass that media boundary.
drop policy if exists "Owners and admins can upload private Page assets" on storage.objects;
