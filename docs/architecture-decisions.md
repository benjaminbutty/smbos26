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
