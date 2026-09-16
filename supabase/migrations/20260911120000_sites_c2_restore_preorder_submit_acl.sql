-- C2 keeps the legacy preorder action behind its existing trusted server
-- boundary.  The release-authority migration recreated this wrapper after
-- renaming the C1 implementation and accidentally granted it to anonymous
-- callers.  Restore the M4/M5 contract: only the trusted service role may
-- invoke the public submission wrapper.
revoke all on function public.submit_public_preorder(
  text,
  text,
  text,
  jsonb,
  text
) from public, anon, authenticated, service_role;

grant execute on function public.submit_public_preorder(
  text,
  text,
  text,
  jsonb,
  text
) to service_role;
