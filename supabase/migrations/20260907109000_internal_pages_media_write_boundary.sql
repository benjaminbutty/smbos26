-- Private Page media is written only by the authenticated, decoded upload
-- endpoint. Direct table and Storage object writes would allow a caller to
-- register arbitrary bytes or metadata outside that boundary.

drop policy if exists "Owners and admins can register private media"
  on public.media_assets;

drop policy if exists "Owners and admins can upload private Page assets"
  on storage.objects;
