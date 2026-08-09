# Supabase boundary

`client.ts` creates the browser client, `server.ts` creates the cookie-aware
server client, and `proxy.ts` refreshes authentication cookies using the
official SSR adapter.

`database.types.ts` is generated from the local migration set:

```bash
supabase gen types typescript --local
```

On 2026-08-05, the repository's installed Supabase CLI (`v2.109.1`) was
also run against the local stack with that command. It stopped before querying
the schema because the checked-in `config.toml` contains newer CLI keys
(`local_smtp`, `auth.oauth_server`, `auth.rate_limit`, `auth.web3`,
`auth.external.apple.email_optional`, `auth.third_party.clerk`,
`db.health_timeout`, `db.network_restrictions`, `db.migrations.enabled`,
`edge_runtime.deno_version`, `experimental.pgdelta`, and storage analytics/S3
keys). No generated file was overwritten. The Phase 12A RPC typings are kept
in the checked-in type surface and are covered by the migration and
authenticated integration tests; re-run generation after the CLI/config
version mismatch is resolved.

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

The Phase 12A migration adds the narrow authenticated
`get_confirmed_graph_record_creation_state` and
`create_confirmed_graph_record` RPCs. They derive tenant and actor checks from
the ordinary session, expose only a bounded PII-free Object/Field state, and
recheck the expected schema/state digest before inserting one Record. The
confirmed RPC locks the Business head for share, the Object definition for
update, and relies on the existing graph trigger for Field/default/status and
`created_by` invariants. Application code must not bypass it with direct
Record inserts for the Builder flow.

The Phase 12B migration adds only the narrow authenticated
`get_confirmed_graph_record_update_state` and
`update_confirmed_graph_record` RPCs plus private eligibility and selector
helpers. PostgreSQL resolves one exact selector with zero/one/multiple
outcomes, returns bounded state with actual current values, and does not expose
candidate rows or full Records. The final RPC checks the head, locks the target
Record once, verifies its `updated_at` currentness and writes through the
existing graph validation/timestamp triggers. It adds no domain table, index,
history, queue, receipt or configuration-version path. Generated type
definitions include the two JSON/Record RPC contracts; a fresh CLI generation
attempt remains required after the installed CLI/config parser mismatch is
resolved.

The Milestone 15 Phase 15A migration adds the authenticated
`apply_direct_configuration_change` and `undo_direct_configuration_change`
RPCs. They are Owner/Admin-only atomic facades over the existing M5
propose/validate/apply and rollback functions; PostgreSQL verifies the finite
Table action shape and direct provenance. The checked-in type surface includes
both configuration-change-set contracts. Direct cell and row writes continue
to use the existing generic GraphService RPCs.
