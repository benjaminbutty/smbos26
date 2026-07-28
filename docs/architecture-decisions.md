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
- Every operational graph RPC requires the server-resolved Business ID and
  resolves its supplied Object, Record, Relationship definition or edge using
  both that Business ID and the supplied UUID. An identifier can never select
  a different tenant, including when one user belongs to both Businesses.
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

## ADR-004 - Constrained experience grammar with a static Milestone 3 public boundary

**Status:** Accepted for v0.1

**Date:** 27 July 2026

### Context

Milestone 3 must turn graph metadata into ordinary operating software without
allowing experience JSON to become executable or leaving direct PostgREST
writes as a validation bypass. It must also establish a draft/public Page
distinction without prematurely building Milestone 4 public Record operations
or the Milestone 5 version engine.

### Decision

- Views support only `table`, `list`, `cards` and `detail` grammars with an
  exact allow-list of configuration properties.
- Forms contain an ordered, unique list of Object Field keys plus optional
  business labels, help text, safe defaults and hidden state. A create Form
  must cover every active required Field that lacks a Field default.
- Pages contain only `heading`, `text`, `image`, `button`, `view`, `form` and
  `divider` blocks. Text is rendered as text; image/button URLs use constrained
  safe schemes; no block accepts HTML, CSS or JavaScript.
- Zod validates normal server operations and PostgreSQL triggers repeat the
  grammar and reference checks. Active definitions may reference only active
  same-tenant Objects, Fields, Forms and Views.
- Experience validation shares the Milestone 2 Object lock boundary with Field
  mutations. Archiving or changing graph/configuration that would invalidate
  active experience configuration is rejected explicitly.
- `pages.status` provides the minimum `draft | published` distinction for this
  milestone. It does not claim versioned configuration publishing.
- Anonymous access uses one narrow security-definer resolver that returns only
  a matching `public` + `published` static Page. Published public Pages
  containing View or Form blocks are rejected in Milestone 3. Anonymous users
  receive no table access to Pages, experience configuration or generic
  Records.

### Consequences

- The runtime remains deterministic and can render every configuration the
  supported mutation boundary can activate.
- Owner/Admin configuration writes and Staff operational reads remain governed
  by RLS even when PostgREST is used directly.
- Public read-only Record Views and public Form submissions remain deferred
  until narrow server resolvers and the later preorder transaction boundary
  are implemented.
- Full draft configuration versions, publish pointers and rollback remain
  Milestone 5 work; Milestone 3 Page status is intentionally smaller.

## ADR-005 - Trusted preorder capability over graph and experience primitives

**Status:** Accepted for v0.1

**Date:** 28 July 2026

### Context

The first complete business application must accept multi-location bakery
preorders publicly while preserving the metadata graph as the logical domain
model. Anonymous callers cannot receive generic Record, View, Form or
configuration access. Submission must also calculate prices, enforce
Location-timezone collection rules, prevent capacity overselling and create
the complete Order graph atomically.

Generic single-Record operations are insufficient for a transaction that must
create Customer, Order and Order Item Records, three kinds of Relationships, a
Location link and a capacity reservation together.

### Decision

- Customer, Product, Order and Order Item remain graph Objects stored in
  `records`; their connections use `record_relationships`. No domain SQL table
  or Order-specific internal runtime is introduced.
- `record_location_links` is a reusable platform primitive connecting generic
  Records to first-class Locations. Composite `(business_id, id)` foreign keys
  structurally prevent cross-tenant links.
- `preorder_experiences` is tenant-owned trusted-capability configuration. It
  references four Objects and three Relationships with composite tenant foreign
  keys and stores a strict allow-listed configuration for Field mappings, safe
  public Fields and schedule values. PostgreSQL and TypeScript enforce the same
  grammar.
- A Page may contain `{ "type": "preorder", "preorder_key": "..." }` only
  for a same-tenant active configuration on a public Page. Generic View and Form
  blocks remain forbidden on published public Pages.
- Anonymous catalogue access uses a narrow security-definer resolver returning
  only safe business, active Location, Product, price, availability, public
  Field and slot data. Its public signature has no clock argument and always
  uses database statement time; deterministic time injection is confined to a
  private integration-test helper.
- Browser submissions use a server-controlled HTTP endpoint. Submission and
  email-state RPCs are executable only by the server's service role; the
  credential never enters browser code. The transaction resolves the Business
  from the published Page and preorder key and never accepts a caller-supplied
  tenant UUID.
- PostgreSQL is the authoritative write boundary. It revalidates the complete
  public grammar, graph Fields, active Products, Product-to-Location links,
  selected Location and collection slot, then inserts ordinary graph rows so
  ADR-003 triggers remain authoritative.
- Product prices are re-read as PostgreSQL `numeric`. Unit price, line total
  and Order total snapshots are calculated in the transaction; browser totals
  are not accepted.
- `preorder_slot_counters` stores one tenant/experience/Location/timestamp row.
  `INSERT ... ON CONFLICT DO UPDATE ... WHERE reservation_count < capacity`
  takes the PostgreSQL row lock and increments in the same transaction as graph
  creation. Any later failure rolls the increment back.
- A cryptographically random client token is unique per
  tenant/preorder experience in `preorder_submissions`. A retry returns the
  stored safe confirmation and neither recreates graph rows nor consumes
  capacity. Human-facing references use a separate database-unique
  `PO-XXXXXXXX` value.
- Collection wall times are interpreted in each allowed Location's IANA
  timezone. Day, interval, cutoff and booking horizon are rechecked at
  submission; catalogue availability is advisory. Orders also store immutable
  local-display and timezone snapshots for generic staff Views while retaining
  the authoritative `collection_at` timestamp.
- Active configuration validation proves all required Customer, Order and
  Order Item Fields are constructable from authoritative runtime values,
  required public Fields, or defaults applied by the generic Record trigger.
  Field and configuration mutations that break this invariant roll back.
- Confirmation email is an adapter invoked after transaction commit. Delivery
  state/error is persisted separately, and provider failure never removes the
  Order. The console adapter is restricted to development/test; production
  without a provider records and returns a controlled delivery failure.

### Consequences

Positive:

- Bedford Bakery is configuration and graph data over reusable platform
  primitives.
- Staff can operate resulting Orders immediately through the Milestone 3
  generic Table, Detail and edit Form runtime.
- Capacity cannot oversell under coordinated concurrency, and public retries
  are safe.
- Public callers cannot turn the capability into arbitrary graph reads or
  writes.

Trade-offs and deliberate limits:

- The capability transaction is intentionally private and specialized in its
  orchestration, while all persisted business data and validation remain
  generic.
- A new Customer Record is currently created for every successful preorder.
  Exact normalized-email reuse may be added later; immutable Order snapshots
  already protect history.
- Capacity counts Orders and is not released by later status changes in
  Milestone 4.
- The development/test email adapter logs safe confirmation data. Production
  has no live provider in Milestone 4 and therefore fails delivery closed;
  workflow and queue infrastructure remain deferred.
- The narrow database-backed hash throttle, honeypot, size limits and
  idempotency are proportionate abuse controls, not complete anti-fraud
  protection.

## ADR-006 - Immutable configuration baselines and active heads

**Status:** Accepted for v0.1 (Milestone 5 Phase 1)

**Date:** 28 July 2026

### Context

Future owner-facing and AI-generated configuration changes need an immutable
base and one serialized active head per Business. The existing normalized
graph, experience and preorder tables remain the runtime projection. Phase 1
establishes history and identity without implementing proposals, candidate
validation, projection application, preview or rollback.

### Decision

- `configuration_versions` stores tenant-owned immutable snapshots with a
  per-Business version number, parent/provenance fields, schema version,
  canonical JSON, SHA-256 checksum, actor and timestamp. Phase 1 creates only
  system baseline Version 1 rows, whose parent, rollback target, change set and
  actor are null.
- `business_configuration_heads` stores exactly one active version pointer and
  monotonic revision per Business. Composite tenant foreign keys prevent a
  head, parent or rollback provenance reference from crossing Businesses.
- `private.configuration_snapshot_v1(uuid)` is the sole canonical reader.
  It explicitly orders identity-bearing graph, experience and preorder
  configuration and excludes Business/Location details, membership,
  operational Records and Relationships, Record-to-Location links,
  submissions, counters, rate limits, timestamps and actors.
- Canonical JSON contains stable configuration IDs and keys but no
  `business_id`; tenant ownership belongs to the version row. PostgreSQL hashes
  the canonical `jsonb` text with SHA-256. TypeScript does not implement a
  second checksum algorithm.
- Existing Businesses are backfilled from their current projection. A Business
  insertion synchronously creates an empty canonical baseline and head in the
  same transaction.
- Pages and preorder allowed-Location associations gain independent
  `is_active` archival state. Runtime/public resolvers and compatibility checks
  ignore inactive rows. Page draft/published status remains separate from
  archival state.
- Individual version updates and deletes are rejected. Business deletion still
  cascades its version history and head. Owner/Admin may read history and the
  head; Staff and anonymous callers may not; authenticated callers have no
  direct write grants.
- Phase 1 deliberately leaves existing configuration mutation paths open.
  Therefore it does not yet assert that the active normalized projection always
  equals the active immutable snapshot.

### Locked follow-up boundaries

- Phase 2 change sets require an owner-facing title, an optional owner-facing
  description, and distinct `rejected`, `conflicted` and `abandoned` terminal
  states.
- Ordinary owner/AI operations may create only `custom` Objects. Existing
  Object `kind` and `semantic_type` cannot change silently. Template
  installation requires a separate trusted system-owned boundary.
- A later rollback may retain configuration introduced after its historical
  target in an archived state. `restored_from_version_id` therefore records
  semantic provenance and does not promise checksum equality with that target.

### Consequences

- Every Business has a durable base for later stale-base and concurrency
  protection without introducing parallel draft/production graphs.
- The same stable configuration identity produces deterministic snapshot JSON
  and checksum. Independently recreated Businesses may differ because their
  configuration UUIDs differ.
- Bedford Bakery remains on the temporary direct fixture path in Phase 1. Its
  eventual configured Version 2 and proposal conversion belong to later
  Milestone 5 phases.
