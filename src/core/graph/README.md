# Graph engine

This module is the generic server boundary for SMBOS graph runtime reads and
operational data. Callers provide an authenticated Supabase client and a
server-resolved Business ID; the service never accepts `business_id` or
`created_by` in record input. Every operational RPC receives that resolved
Business ID explicitly and matches resource UUIDs within it, so an identifier
cannot switch a tenant-scoped service into another Business.

PostgreSQL is authoritative for tenant consistency, record validation,
`created_by` derivation, relationship type checks and cardinality. The Zod
schemas here validate operation shapes early, while database triggers protect
the same invariants from direct PostgREST callers.

Record validation and change-set projection serialize through locks on their
shared Object definition. Record writers use compatible shared locks, so
normal concurrent writes remain possible. Active Relationships likewise keep
their source and target Objects from being archived until the Relationship is
archived through an applied proposal.

`relationship_definitions.is_required` remains metadata for standalone generic
Record operations. The Milestone 4 trusted preorder transaction creates its
configured required Records, Relationships and Location link atomically using
the same graph triggers; it does not weaken or duplicate graph validation.

Business concepts belong in object, field and relationship definitions. Do not
add concept-specific service functions or persistence models.

Object, Field, and Relationship definitions are read-only through this service.
Owner/Admin changes must use `ConfigurationChangeService`; direct table DML is
unavailable to authenticated and service-role clients. Integration tests that
exercise lower-level graph constraints use the test-only database-owner helper
under `tests/integration/support`, never production code.

## Phase 12A confirmed generic Record creation

`src/core/graph/record-creation/` is a server-only, provider-neutral
composition boundary for one confirmed generic Record. It reads a bounded
Object/Field eligibility state, composes only typed owner-supplied values and
authoritative defaults, and calls the narrow Supabase RPC through the resolved
tenant client. The model may return only exact existing Object and Field keys
present in the supplied configuration context; it may not invent new keys,
UUIDs, IDs, defaults, Records, relationships or mutation authority. The
boundary accepts no browser-supplied Business ID, actor, UUID, relationship,
file or arbitrary data shape.

Eligibility requires an existing active target Object with at least one active
non-file writable Field, no active required incoming Relationship that makes
standalone creation incomplete, no active preorder Order or Order Item Object
mapping, and no required File Field without a usable default.

PostgreSQL is authoritative for the tenant, Object lock, schema/state digest,
Field validation, default application, `created_by` and atomic insert. The
confirmed-create RPC takes the expected state and rechecks it while locking
the Business head and Object definition; stale and replayed confirmations do
not create a second Record. The existing deterministic runtime then opens the
server-selected internal View. Record update/delete, relationships, files and
configuration versioning are outside this boundary.

## Phase 12B confirmed generic Record update

`src/core/graph/record-update/` is the separate provider-neutral update
boundary. It accepts one exact active target resolved by PostgreSQL, composes
one minimal typed patch and formats a bounded before/after diff. The confirmed
RPC checks the Business head, Object eligibility, target identity and
`updated_at` currentness, then locks the target Record once. The existing
`records_validate` and `set_updated_at` triggers remain authoritative for the
merged update; the final path does not re-query the selector or take a second
target/Object lock. No broad query, candidate list, domain path,
configuration version or operational history is added.

## Phase 12C Record-to-Location availability

The existing `record_location_links` boundary remains the only persistence and
mutation authority for availability. Phase 12C adds bounded server-side
preparation and final pair revalidation so manual Record detail controls and
the disabled Builder intent path can share exact selector matching, active
Record/Location checks, preorder Order and Order Item protection, and
already-linked/already-unlinked outcomes. Product and other eligible generic
Objects use the same service; no Product- or Equipment-specific code is
introduced.

Only one Record and one Location are supported. New links require an active
Location; an existing inactive link remains visible for explicit removal.
The final action reloads tenant-owned Record, Location and pair state directly
through the authenticated service boundary, compares the signed expected pair
state, derives the current link row only for unlink, then calls one existing
trusted create or remove RPC and reloads the authoritative Location name and
pair state. The unique pair boundary makes duplicate concurrent mutations
bounded; replays do not perform a second transition. Availability is
operational data: it creates no configuration Version, Change, history,
receipt or undo state.
