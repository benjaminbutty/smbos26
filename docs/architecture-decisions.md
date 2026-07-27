# SMBOS architecture decisions

## ADR-001 - Metadata-driven business graph for custom domain concepts

**Status:** Accepted for v0.1  
**Date:** 27 July 2026

### Context

SMBOS must let a business owner say things such as:

> "We also hire catering equipment. I need to track the equipment, customer, hire dates, deposit and whether it has been returned."

That request must not require a developer, source-code deployment or a new database migration.

### Decision

Use stable platform tables for tenancy and platform capabilities, with customer-created domain concepts represented through metadata and generic graph storage:

- `object_definitions`
- `field_definitions`
- `relationship_definitions`
- `records` using validated JSONB data
- `record_relationships` using explicit graph edges

Business, Location and User/Permission remain platform-controlled concepts.

Experience and behaviour are also configuration-driven through Views, Forms, Pages, Rules and Workflows.

### Consequences

Positive:

- AI can create new business concepts transactionally.
- No DDL migration is required for each customer object.
- Definitions and configuration can be versioned and rolled back.
- Different business capabilities can share one persistent graph.

Trade-offs:

- JSONB queries require disciplined validation and indexing.
- Some future high-volume concepts may benefit from projections/materialised models.
- Referential and field-type validation must be implemented in the application/database boundary rather than relying solely on fixed table columns.

### Guardrail

Do not optimise by creating bespoke domain tables until real performance or integrity evidence requires it. If projections are introduced later, preserve the metadata graph as the logical source model.

## ADR-002 - Globally unique, immutable business slugs

**Status:** Accepted for v0.1

**Date:** 27 July 2026

### Context

Authenticated business routes use `/app/[businessSlug]/...`. The URL needs a
human-readable tenant identifier without making that identifier the tenant's
permanent identity or an authorization control. Display-name changes must not
silently break existing URLs.

### Decision

- Business slugs are globally unique.
- The business UUID is the permanent internal identity.
- The slug is a routing and display identifier only. It is never an
  authorization boundary.
- Slugs are generated automatically when a business is created.
- Slugs are immutable in v0.1.
- Changing the business display name does not change the slug.
- There is no normal owner-facing slug editor in v0.1.
- Future rename support should use slug aliases and redirects rather than
  changing historical identifiers without redirection.

Server-side tenant access must resolve the slug to the stable business UUID and
then verify the authenticated user's membership. Authorization and RLS remain
anchored to the UUID and membership, not to the slug.

### Consequences

- Milestone 1 must enforce global slug uniqueness while keeping UUIDs as
  foreign keys and tenant policy inputs.
- Display names can evolve independently without changing established URLs.
- Slug correction or rename is intentionally deferred until aliases and
  redirects can preserve historical links.

## ADR-003 - PostgreSQL is the authoritative graph integrity boundary

**Status:** Accepted for v0.1

**Date:** 27 July 2026

### Context

Graph records are exposed through authenticated Supabase/PostgREST access.
Application validation alone would leave a second mutation path able to persist
invalid JSON or cross-tenant references. Relationship cardinality must also
remain correct when two requests arrive concurrently.

### Decision

- Every graph table carries `business_id`.
- Tenant-owned references use composite foreign keys that include
  `business_id`, backed by tenant-and-ID unique constraints on their parents.
- A `BEFORE INSERT OR UPDATE` trigger validates complete `records.data_json`
  against active field definitions. It applies configured defaults, rejects
  unknown or archived writable fields, and derives `created_by` from
  `auth.uid()`.
- Server record updates use a narrow security-invoker RPC that merges a patch
  before the trigger validates the resulting complete record. Direct
  PostgREST updates remain safe because the same trigger validates them.
- Record validation takes a shared row lock on its parent Object definition.
  Field-definition mutations take an exclusive lock on the same Object row.
  Object archival uses its normal conflicting update lock. This serializes
  configuration and operational writes per Object while allowing concurrent
  Record writes that only hold compatible shared locks.
- Active relationship definitions take shared locks on their source and target
  Objects. An Object cannot be archived while an active relationship
  definition references it, and no configuration change silently cascades.
- Record-relationship inserts lock their relationship-definition row before
  checking record object types and cardinality. The lock deliberately
  serializes writes for one relationship definition so concurrent requests
  cannot both pass a stale cardinality check.
- Normal authenticated roles receive no Record delete permission. Archiving is
  represented by `record_status = 'archived'`.

### Archive behavior

- Archived objects reject new records and data changes, but their historical
  records remain readable and can be archived.
- Archived fields remain readable in historical JSON but cannot be added or
  changed.
- Archived relationship definitions reject new edges; existing edges remain
  readable and removable.

### Required relationship metadata

`relationship_definitions.is_required` is retained as graph metadata in
Milestone 2. Storage-level enforcement is deferred until SMBOS has a
transactional operation that can create a Record and all of its required
relationships atomically. Enforcing it on standalone Record insertion would
make valid creation impossible, while enforcing it later would expose a
temporarily invalid state.

### Consequences

- The database is the reusable deterministic validation service and protects
  callers that bypass the TypeScript service layer.
- Composite tenant keys add deliberate redundancy to every graph reference.
- Cardinality enforcement is coarse-grained per relationship definition. This
  is simple and safe for v0.1; finer advisory locks can replace it if measured
  write contention justifies the extra complexity.
- Configuration changes that would invalidate existing Records are rejected
  transactionally.
- Object-scoped locks are the integrity boundary between Field configuration,
  Object archival and Record validation; unrelated Objects do not contend.
