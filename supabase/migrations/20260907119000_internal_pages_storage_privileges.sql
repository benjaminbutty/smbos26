-- Storage's default table grants are broader than the private Page asset
-- write lane.  The upload route uses the service role only after it has
-- authenticated the member, validated and re-encoded the image, and written
-- the tenant-prefixed immutable key.  Anonymous and authenticated clients
-- must not be able to bypass that boundary with direct Storage DML.
revoke insert, update, delete on table storage.objects from anon, authenticated;

-- The local Supabase Storage owner grants table DML to client roles as part
-- of its extension setup.  Keep an explicit deny policy as well: it closes
-- the write lane even when those extension grants are present, while the
-- service-role upload route remains able to write after validation.
drop policy if exists "Page assets direct client writes are disabled"
  on storage.objects;
create policy "Page assets direct client writes are disabled"
  on storage.objects
  for all
  to anon, authenticated
  using (false)
  with check (false);
