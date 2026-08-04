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

The Phase 10A Location migration adds the authoritative tenant-scoped
`private.normalize_location_name(name)` uniqueness rule: PostgreSQL NFKC
normalization, surrounding trim and lower casing under the explicit
locale-neutral `und-x-icu` collation. The rule reserves active and inactive
identities and is used by migration preflight, the unique index, bounded state
summaries and duplicate lookups. Exact IANA timezone triggers for Businesses
and Locations, parent-Business write serialization and the narrow authenticated
Location-state/create RPCs are also database-owned. Application code must not
bypass these RPCs with direct Location inserts. The Location state digest is an
operational currentness comparison, not a browser authorization token.
