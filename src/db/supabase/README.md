# Supabase boundary

`client.ts` creates the browser client, `server.ts` creates the cookie-aware
server client, and `proxy.ts` refreshes authentication cookies using the
official SSR adapter.

`database.types.ts` is generated from the local migration set:

```bash
supabase gen types typescript --local
```

Application code uses only the public URL and publishable key. A
secret/service-role credential must never be added to this directory or
exposed to browser code.

The service role is not a configuration bypass: it has no direct mutation
privileges on versioned projection tables. Production configuration changes
run through authenticated Owner/Admin Milestone 5 lifecycle RPCs. Local
integration fixtures that need database-owner access live under `tests/`, not
in this application adapter.
