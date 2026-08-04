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

**Status:** Accepted for v0.1 (Milestone 5 Phase 3B)

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
- Location identity and current eligibility remain outside canonical
  configuration snapshots. A change set stores a bounded immutable schema-v1
  display context containing proposal-time names for referenced same-Business
  Location IDs. Those names are owner-readable display metadata only: they do
  not affect candidate checksums, version content or Location eligibility, and
  may intentionally differ from a later renamed Location.
- Existing Businesses are backfilled from their current projection. A Business
  insertion synchronously creates an empty canonical baseline and head in the
  same transaction.
- Pages and preorder allowed-Location associations gain independent
  `is_active` archival state. Runtime/public resolvers and compatibility checks
  ignore inactive rows. Page draft/published status remains separate from
  archival state.
- Public preorder submission locks and rechecks the active published Page,
  active preorder experience, active allowed-Location association and active
  Location in that fixed order before entering the retained atomic M4
  transaction. Concurrent archival therefore cannot admit a submission from a
  stale pre-archive check.
- Page archival blocks new public activity but does not cancel operational work
  already committed. Confirmation email claiming uses immutable Business and
  preorder identity plus the submission idempotency token; it does not depend
  on the Page remaining active, published, at the same slug or configured with
  the preorder block.
- Individual version updates and deletes are rejected. Business deletion still
  cascades its version history and head. Owner/Admin may read history and the
  head; Staff and anonymous callers may not; authenticated callers have no
  direct write grants.
- Phase 1 deliberately left existing configuration mutation paths open, and
  Phase 2B therefore failed closed when an unversioned write made the
  projection diverge from the active version.
- Phase 3A adds one authenticated Owner/Admin application transaction for
  already validated proposals. It locks the Business head and proposal,
  verifies their immutable base and replay, runs the existing static projector
  as the final authoritative compatibility check, creates one immutable
  `change` version, advances the head once and marks the proposal applied.
  Recognised compatibility failures roll back projector writes and close the
  proposal as rejected; stale bases close as conflicted; unexpected failures
  roll back the complete transaction and leave the proposal validated.
- At every successful application commit, the canonical normalized
  projection, applied change-set candidate, new immutable version and active
  head are exactly equal in both JSON and checksum.
- Phase 3B makes the change-set engine the mandatory normal production
  configuration mutation boundary. `anon`, `authenticated` and `service_role`
  have no direct `INSERT`, `UPDATE` or `DELETE` privilege on the eight
  versioned projection tables. Authenticated members retain tenant-scoped
  runtime `SELECT`; anonymous runtime reads continue only through narrow
  public resolvers.
- Legacy preorder configuration RPCs remain only as inaccessible historical
  implementations. Application roles cannot execute them, and private
  materialisation, diff, projector, sandbox, assertion and lifecycle helpers
  cannot be invoked directly. The authenticated mutation allow-list is
  propose, validate, apply and abandon.
- Production graph, experience and preorder TypeScript services expose
  runtime reads and operational mutations only. Local integration setup may
  use a database-owner fixture helper outside `src/`; this is not an
  application credential, public RPC or production capability.
- Operational Records, Record Relationships and Record-to-Location links are
  deliberately outside configuration versioning. Location creation, updates
  and archival also remain a first-class operational lifecycle; individual
  Location deletion stays unavailable.
- Existing Object locks serialize application against Record writes: Record
  validation holds the Object row in shared mode while Field projection takes
  the conflicting Object update lock. Public preorder submission similarly
  retains its ordered shared locks while application parks Page and preorder
  rows. No Business-wide advisory lock is added to production.

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
- Bedford Bakery starts with the same immutable empty Version 1 as every new
  Business. The local demo authenticates its Owner, proposes, validates and
  applies `Install Bedford Bakery configuration`, producing configured Version
  2 before any Product Records are created. Re-running the seed verifies that
  state instead of creating Version 3.
- Bedford's Product, Customer, Order and Order Item definitions use the normal
  `set_object` rule: `kind = custom` and `semantic_type = null`. The runtime
  has no dependency on template classification.
- Future AI configuration work must submit the same allow-listed structured
  operations through this lifecycle. It receives no direct SQL, table mutation
  or private projector capability.

## ADR-007 - Structured configuration proposals and canonical candidates

**Status:** Accepted for v0.1 (Milestone 5 Phase 2A)

**Date:** 28 July 2026

### Context

Owner-facing and future AI-generated configuration changes need a narrow draft
boundary before authoritative operational compatibility validation and live
application exist. A proposal must be reviewable and reproducible without
creating a second live graph, mutating normalized configuration or advancing a
Business head.

### Decision

- `configuration_change_sets` stores the immutable proposal base, exact
  key-based operations, trusted stable-ID allocations, complete schema-v1
  candidate, PostgreSQL checksum and deterministic semantic diff. Phase 2A
  creates only `change` / `proposed` rows and implements only the irreversible
  `proposed` to `abandoned` transition.
- Proposal creation locks the Business head for a consistent base read, loads
  its active immutable version and recomputes the live canonical snapshot.
  `configuration_projection_out_of_sync` is returned unless both JSON and
  checksum equal the active version. The candidate is always materialized from
  that immutable version, never from live rows.
- PostgreSQL is authoritative for the exact operation grammar, complete
  candidate materialization, structural candidate checks, stable-ID allocation,
  canonical ordering, checksum and semantic diff. Zod mirrors the caller
  grammar for early application feedback but cannot authorize acceptance.
- Operations are complete desired states addressed by stable keys:
  `set_object`, `set_field`, `set_relationship`, `set_view`, `set_form`,
  `set_page` and `set_preorder_experience`. Unknown properties, caller-selected
  configuration IDs, duplicate targets, unrestricted patches and hard deletion
  are rejected. Allowed Location IDs are the sole caller-supplied UUIDs and are
  checked against active same-Business Locations.
- New semantic identities are sorted before UUID allocation. The immutable
  allocation map is replayed for later validation attempts, so retries cannot
  create new identities. Existing entity and preorder-association IDs remain
  stable.
- Candidate checks prove graph/configuration structure only: references,
  active dependencies, View/Form Fields, create Form coverage, Page/public
  safety, preorder mappings/constructability and current Location eligibility.
  They do not claim compatibility with operational Records.
- The stored diff classifies `created`, `updated`, `archived` and `restored`
  changes and includes deterministic entity-specific properties and
  owner-readable labels. Location labels are display snapshots in the diff;
  canonical configuration retains only Location UUIDs.
- `ConfigurationChangeService` is server-only and uses authenticated session
  RPCs for propose/list/get/abandon. Every RPC resolves `auth.uid()` and
  independently checks Owner/Admin membership and tenant ownership. Direct
  authenticated change-set writes are not granted.

### Deliberate Phase 2A limits

- Proposals remain `proposed`; there is no validation sandbox or `validated`
  transition.
- No live projection materializer, application transaction, head advancement,
  change version, stale-apply conflict handling or direct configuration
  mutation closure is introduced.
- Rollback proposals, preview, owner Changes UI, Bedford configured Version 2,
  seeded acceptance proposals and AI/LLM integration remain later work.

### Consequences

- Proposal creation and abandonment are read-only with respect to the active
  normalized configuration and Business head.
- Bedford Bakery’s direct demo projection intentionally fails the consistency
  precondition until a later phase creates its configured Version 2.
- Snapshot/projection compatibility with existing operational Records remains
  the critical Phase 2B boundary; Phase 2A structural checks must not be
  presented as that proof.

## ADR-008 - Authoritative compatibility validation in a rollback-only projection sandbox

**Status:** Accepted for v0.1 (Milestone 5 Phase 2B)

**Date:** 28 July 2026

### Context

A structurally valid Phase 2A candidate can still be incompatible with live
operational data. Examples include changing a populated Field type, adding a
required Field that existing Records cannot satisfy, removing a selected
option, or changing the cardinality of a Relationship that already has edges.
The M2-M4 PostgreSQL triggers are already the authoritative integrity boundary;
reimplementing them in TypeScript or in a second weaker validator would create
divergent rules.

Validation must exercise those constraints without exposing or committing a
parallel draft graph.

### Decision

- Every mutating configuration RPC accepts an `expected_actor_id` and verifies
  `auth.uid()`, exact actor-context equality and current Owner/Admin membership
  before writing. A complete proposal that produces no semantic or canonical
  change is rejected before insertion.
- `validate_configuration_change` locks the Business head and then its change
  set, verifies the base version/revision, replays immutable operations and
  trusted allocations, checks every stored engine output, and proves the live
  projection still equals the active immutable version.
- One private static table-specific projector materialises complete candidates.
  It parks Pages, preorder experiences, Views, Forms and Relationships before
  graph changes; inserts new Objects inactive; applies Fields; restores target
  Objects and Relationships; restores Forms, Views, preorder associations and
  experiences; and restores Pages last. It never hard-deletes configuration.
- The projector runs inside a PL/pgSQL exception block. A distinct success
  sentinel deliberately raises after final deferred constraints and canonical
  projection equality succeed. Both the sentinel and authoritative integrity
  errors roll the subtransaction back. The outer transaction commits only a
  structured lifecycle result.
- `validated` stores a strict valid result plus actor/time. Deterministic
  incompatibility becomes `rejected` with a bounded owner-safe error and closure
  metadata. A stale base becomes `conflicted`. Unexpected engine or transient
  failures leave the proposal unchanged. Revalidating an already validated row
  returns its stored result without changing timestamps.
- Owner-facing validation results contain only allow-listed codes and plain
  language. PostgreSQL diagnostics are captured only for internal
  classification; raw SQL, table/function names, stack traces and internal
  identifiers are not persisted in the result.
- Candidate Location eligibility is rechecked immediately before and inside
  projection. A Location becoming inactive after proposal is an operational
  incompatibility and cannot be recreated or reactivated by validation.
- Canonical materialisation and immutable replay validate only Location UUID
  shape and candidate-internal preorder-association identity/reference rules.
  They do not query mutable Location existence or activation. Current active
  same-Business Location eligibility is a distinct assertion at proposal
  creation and inside authoritative projection validation. Replay failure is
  therefore always an engine-integrity failure; an eligibility change is an
  owner-safe `location_ineligible` rejection from the sandbox.
- Individual Locations use `is_active` archival in v0.1. Authenticated roles
  have no `DELETE` grant or RLS delete policy on `locations`, and no production
  RPC hard-deletes one. Whole-Business deletion may continue cascading the
  Business, its Locations, configuration projection, versions and head.

### Consequences

- Current M2-M4 triggers validate the exact candidate projection against live
  Records, edges, Locations and preorder constructability without duplicating
  those rules in TypeScript.
- MVCC prevents other sessions from observing parked rows, and rollback removes
  every temporary projection write and lock. The active head, versions and
  operational Records remain unchanged.
- Validation takes an exclusive Business-head lock and temporarily writes and
  locks the Business's active configuration rows. Rolled-back writes still
  generate WAL. This is proportionate for v0.1 configuration sizes but is a
  deliberate scaling limit to measure before supporting large tenants or
  frequent automated validation.
- Immutable proposal replay performs no Location write, including temporary
  reactivation. Location lifecycle changes after proposal creation affect only
  the current-eligibility result and never the stored candidate, checksum,
  allocations or semantic diff.
- At the Phase 2B checkpoint, direct authenticated configuration mutation
  remained open, so projection divergence was an explicit engine-state
  failure, not an owner rejection. Phase 3B now closes that path.
- Phase 2B itself did not apply candidates, create versions, advance heads,
  close direct mutation, implement rollback/preview/UI, or convert the Bedford
  demo; later Phase 3 work supplies application and closure.

## ADR-009 - Forward-only configuration rollback

**Status:** Accepted for v0.1 (Milestone 5 Phase 4A)

**Date:** 29 July 2026

### Context

Owners need to restore an earlier immutable configuration without rewinding
history or operational data. A historical snapshot cannot be projected
directly because configuration introduced after that snapshot must retain its
stable identity and remain available for later history, while current Records,
Relationship edges, Location links, preorder submissions and Orders must never
be restored or removed by configuration rollback.

### Decision

- `prepare_configuration_rollback` is the only rollback-proposal creation
  boundary. It verifies authenticated actor context and current Owner/Admin
  membership, locks a consistent active head, proves live projection/version
  equality and accepts only an earlier same-Business version ID plus
  owner-facing title and optional description.
- Rollback proposals store exactly one trusted
  `restore_configuration_version` schema-v1 descriptor. Ordinary proposal
  grammar does not accept this discriminator. The authoritative target remains
  `rollback_target_version_id`, allocations are exactly `{}`, and rollback
  creates no configuration IDs.
- One private deterministic derivation helper validates current and historical
  snapshots, matches all eight projection collections by stable semantic
  identity, restores complete historical rows, and retains every current-only
  row with `is_active = false`. Historical identity loss, stable-ID changes or
  immutable parent/endpoint changes are engine-integrity failures.
- Rollback Location display context covers the union referenced by current,
  historical and resulting candidate snapshots. It uses current same-Business
  names even for inactive Locations and never treats activation as
  preparation-time eligibility.
- One private replay dispatcher is shared by validation and application.
  Ordinary changes replay the existing operation materializer; rollback loads
  its same-Business target and derives the union/archive candidate. Both paths
  must exactly reproduce stored candidate, checksum, allocations and semantic
  diff.
- Rollbacks use the existing rollback-only validation sandbox and existing
  static projector. Current Records, Relationship edges, dependencies and
  Location eligibility can reject a rollback with the same owner-safe results
  as an ordinary change.
- Successful rollback application uses the existing atomic application
  transaction and creates a new `rollback` version whose parent is the
  immediately previous active version and whose `restored_from_version_id`
  records historical provenance. The active head advances exactly once.
- Operational tables and Location lifecycle remain outside configuration
  rollback. No rollback path updates Records, Record Relationships,
  Record-to-Location links, preorder submissions, Orders, Customers, Products,
  counters, email state or Location rows.
- Phase 4A adds Owner/Admin version reads to the server-only configuration
  service but introduces no preview runtime, Changes UI, version-history UI,
  AI integration or automatic rebase.

### Consequences

- Configuration history remains a forward chain: a V2 restoration after V3 is
  a new V4, never a head rewind.
- A rollback candidate can intentionally have a different checksum from its
  historical target because later configuration identities remain archived.
- Competing proposals may share a base, but after one advances the head every
  other proposal from that base conflicts; applied retries remain idempotent.
- Rollback compatibility inherits the existing projector's locking, integrity
  and WAL trade-offs. Phase 4A adds no second projection implementation or
  infrastructure.

## ADR-010 - Authenticated read-only candidate preview foundation

**Status:** Accepted for v0.1 (Milestone 5 Phase 4B.1)

**Date:** 29 July 2026

### Context

Owner/Admin users need to inspect an ordinary or rollback proposal before any
later Changes UI offers lifecycle controls. A candidate is not trustworthy
merely because JSON is supplied by a browser or stored on a change-set row:
preview must prove that the proposal still belongs to the active head and that
the Phase 4A replay engine reproduces its snapshot, checksum, allocations and
semantic diff. The preview runtime must also remain the existing Page, View,
Form and preorder runtime rather than becoming a second implementation.

### Decision

- `load_configuration_preview` accepts only a change-set identifier and derives
  Business and actor identity from the authenticated session. It permits current
  Owner/Admin members, proposed or validated status, and a base version equal
  to the current active head.
- A private assertion function loads the immutable base, invokes the shared
  Phase 4A replay dispatcher for both ordinary and rollback proposals, and
  rejects any mismatch in candidate snapshot, checksum, allocations or
  semantic diff. Neither function performs projection, head, version,
  lifecycle, Record or operational writes.
- A configuration-definition source exposes one typed read-only contract for
  active normalized tables and verified candidate snapshots. The experience
  service and existing Page, View and Form renderers consume that contract.
  Snapshot warnings are limited to operational Records that are incompatible
  with candidate definitions; new candidate Objects naturally have no current
  Records.
- Live list/navigation reads batch Object-definition resolution and cache
  request-scoped lookups. Candidate lookups remain in-memory.
- Form and preorder renderer props are discriminated unions. Live mode requires
  an action or endpoint; preview mode cannot receive one, suppresses navigation
  and mutation links, disables controls and renders a persistent Preview
  warning.
- One private preorder catalogue assembler joins either live or candidate
  configuration to current operational Products, prices, Product-to-Location
  links, Locations and counters. The existing public resolver and the
  authenticated preview resolver both delegate to it, avoiding a second
  preorder algorithm.
- Public preview functions grant execution only to `authenticated`; `anon` and
  `service_role` are explicitly revoked. Every private helper remains
  inaccessible to application roles.
- Phase 4B.1 deliberately adds no preview route, Changes dashboard,
  version-history presentation, lifecycle controls, permanent demonstration
  proposals, AI integration or automatic merge/rebase.

### Consequences

- Preview always represents an authoritative, current, reproducible candidate;
  stale and closed proposals fail with stable owner-safe errors.
- Operational data makes preview realistic but is never copied into the
  immutable configuration snapshot and is never mutated by preview.
- The Phase 3B mandatory mutation boundary remains unchanged: all configuration
  writes still flow through the versioned proposal lifecycle.
- Phase 4B.2 can add an authenticated stable-Page-key route and owner-facing
  presentation by composing this foundation, without changing its trust or
  rendering boundaries.

## ADR-011 - Authenticated rendered candidate preview

**Status:** Accepted for v0.1 (Milestone 5 Phase 4B.2)

**Date:** 29 July 2026

### Context

The Phase 4B.1 foundation proves and exposes a trusted candidate but does not
give an Owner/Admin a route through which to inspect the configured
experience. Rendering must not introduce a second candidate runtime, let a
candidate slug affect routing, expose a mutation boundary, or return a
formerly current candidate after application wins a race.

### Decision

- Each preview assertion takes shared locks in the same head, change-set and
  base-version order used by validation and application. Those locks linearize
  that assertion's database transaction only. The assertion verifies the
  current normalized projection and checksum against the locked base before
  replaying and comparing every stored output. Preview never changes lifecycle
  state.
- Rendered preview performs one identifier-only assertion before candidate
  assembly and another immediately before returning. The final assertion must
  identify the same proposal, Business, candidate checksum and kind. Status may
  remain unchanged or progress from proposed to validated; the final status is
  shown in the returned preview. A proposal that becomes applied, rejected,
  conflicted, abandoned or stale during assembly causes the assembled
  candidate to be discarded.
- The authenticated route is
  `/app/[businessSlug]/changes/[changeSetId]/preview/[pageKey]`. It is dynamic
  and no-store, resolves the immutable Business slug through authenticated
  membership, derives the actor from the session and permits only Owner/Admin.
  Candidate Page slugs never participate in preview routing.
- Candidate Page navigation is built only from active Pages in the verified
  snapshot. Internal Pages and the currently inspected public Page link only
  to stable-key preview routes. The existing live application navigation and
  anonymous public slug resolvers remain unchanged.
- A reusable preview shell shows proposal kind/status, an abbreviated
  candidate checksum, a persistent not-live/no-save warning and an Exit link
  to the existing Business home. No Changes or version-history interface is
  introduced.
- The route composes the snapshot `ConfigurationDefinitionSource`,
  `ExperienceService`, `PageRenderer`, `ViewRenderer`, `FormRenderer` and
  `PreorderExperience`. There is no candidate-specific renderer tree.
- Generic preview Forms receive no server action and render disabled controls.
  Preview Views read current compatible operational Records but suppress
  mutation and detail navigation. Missing or incompatible data uses existing
  controlled empty/warning presentation.
- Candidate preorder uses only the authenticated
  `resolve_configuration_preview_preorder` resolver. Its schedule and public
  Fields come from the candidate while Products, prices, Location
  availability, Locations and counters remain authoritative operational
  reads. Browser state may explore quantities, Location, date, slot and
  customer Fields, but preview receives no endpoint or idempotency token and
  its final submission is disabled.
- The application proxy rejects POST, PUT, PATCH and DELETE for the exact
  preview route before route rendering. Anonymous public submission retains
  only its live Business-slug/Page-slug endpoint and accepts no change-set or
  preview parameter.
- Phase 4B.2 adds no Changes dashboard, diff or history screen, lifecycle
  controls, permanent demonstration proposal, AI integration, automatic
  rebase/merge or operational Record rollback.

### Consequences

- Owner/Admin can inspect both internal and public candidate Pages inside the
  authenticated shell without changing the active version or public runtime.
- Application is not blocked for the entire render or HTTP response. Each
  assertion serializes with lifecycle changes independently, and the final
  assertion prevents a candidate closed during assembly from being returned.
  The small race after that final point-in-time read is ordinary request
  currentness rather than a transaction lock spanning the response.
- Interactive preorder exploration is intentionally ephemeral client state.
  Reloading reconstructs it from authoritative reads and persists nothing.
- Rendering remains limited to the existing Page grammar and deterministic
  platform components, preserving the AI/runtime and configuration-mutation
  boundaries.

## ADR-012 - Read-only Owner/Admin configuration Changes and History

**Status:** Accepted for v0.1 (Milestone 5 Phase 5A)

**Date:** 29 July 2026

### Context

The version engine now stores immutable proposals, strict validation results,
semantic diffs, forward-only versions and rollback provenance. Owner/Admin
users need an ordinary authenticated interface for understanding those engine
outputs and entering the Phase 4B verified candidate preview. Phase 5A must not
turn presentation work into a second lifecycle or configuration mutation
boundary.

History loading also needs an explicit v0.1 bound. Returning an ever-growing
tenant history to a server-rendered route would defer a known pagination
problem and make response size depend on Business age.

### Decision

- `/app/[businessSlug]/changes`,
  `/app/[businessSlug]/changes/[changeSetId]` and
  `/app/[businessSlug]/changes/versions/[versionId]` are dynamic, no-store,
  authenticated server-rendered routes. They resolve the Business and actor
  through the existing session tenant context and require
  `manage_configuration`; Staff and cross-Business identifiers receive the
  same controlled denial/not-found boundary.
- Changes is platform-shell navigation shown only to Owner/Admin. Generated
  tenant Page navigation stored in configuration is unchanged.
- Phase 5A presents the stored semantic diff and strict validation result as
  immutable authoritative engine outputs. It does not reconstruct validation
  or invent a second diff algorithm. Non-baseline version detail reuses its
  source proposal diff.
- Candidate preview is attempted only for a proposed or validated proposal on
  its detail route, using `ConfigurationChangeService.loadPreview`. Links use
  active candidate Page stable keys and remain inside authenticated preview.
  Stale currentness has an owner-safe state; unexpected replay, database or
  rendering errors remain observable.
- The list RPCs return at most the latest 50 proposals and latest 50 versions.
  Ordering is stable: proposals use `created_at DESC, id DESC`; versions use
  `version_number DESC, id DESC`. Detail RPCs remain identifier-specific.
- Actor UUIDs are not primary owner-facing labels. Until a safe profile display
  source exists, the interface uses neutral Owner/Admin and SMBOS labels.
- The route and presentation source contains no lifecycle server action,
  proposal creation, validation, application, abandonment, rollback
  preparation, direct configuration DML or operational Record write.
- Phase 5B may add explicit lifecycle controls only through trusted,
  schema-validated server actions over the existing authenticated service.

### Consequences

- Owners and Admins can understand attention states, completed history,
  validation outcomes, candidate Pages, immutable versions and forward-only
  rollback provenance without exposing raw JSON as the primary interface.
- The latest-50 bound is sufficient for v0.1 and deliberately omits pagination
  UI. A later cursor uses the already stable proposal ordering; versions use
  their monotonic number.
- Route reads and preview loading do not change proposal lifecycle, active
  projection, head, version history or operational data.
- Validate, apply, abandon, rollback preparation, proposal creation,
  natural-language building, automatic rebase and AI integration remain
  outside Phase 5A.

## ADR-013 - Authenticated explicit configuration lifecycle controls

**Status:** Accepted for v0.1 (Milestone 5 Phase 5B)

**Date:** 29 July 2026

### Context

Phase 5A lets Owner/Admin users read authoritative proposals, stored semantic
diffs, validation results and immutable version history, but it deliberately
offers no way to advance the already-proven lifecycle. Explicit controls must
not create a second configuration-write path, trust browser-owned tenant or
actor context, or mutate merely because a confirmation route was loaded.

Rollback preparation also needs a narrow stale-confirmation check: a user who
reviewed history under one active head must not silently prepare a proposal
after another actor materially advances that head.

### Decision

- Lifecycle mutations are exposed only through one authenticated Server Action
  module. Its narrowly named validate, apply, abandon and rollback-preparation
  actions call only `ConfigurationChangeService`; they do not use direct table
  DML, generic RPC invocation, service-role credentials or auth-admin APIs.
- Every action creates a session client, resolves the immutable Business slug
  through current membership, requires `manage_configuration`, and derives the
  Business UUID and actor UUID server-side. Proposal/version identifiers remain
  untrusted route inputs and are strictly parsed and tenant-scoped again.
- Forms never supply Business/actor UUIDs, candidate content, operations,
  checksums, allocations, semantic diffs, validation results, desired status or
  applied version identity. Rollback preparation accepts only a bounded title
  and optional description.
- Proposal detail navigation is status-dependent: proposed offers Preview,
  Validate and Abandon; validated offers Preview and Apply; applied links to
  its resulting Version; rejected, conflicted and abandoned offer no mutation.
  Historical versions offer Prepare rollback; the active Version does not.
  Every action independently re-reads and enforces current availability.
- Validate, apply, abandon and rollback confirmation routes are dynamic,
  no-store authenticated GETs. Rendering them performs only reads. A lifecycle
  transition requires a genuine POST through its Server Action followed by a
  redirect.
- Validation never applies automatically. Apply remains one atomic,
  idempotent, forward-only version operation. Abandonment is final under the
  existing database lifecycle. Rollback preparation creates an ordinary
  proposed rollback; applying it later creates a new future Version rather than
  rewinding the head.
- Rollback confirmation binds the rendered active version and revision as
  untrusted comparison values. Immediately before preparation the action
  reloads the target and active head; any movement returns a bounded
  `state_changed` notice and creates no proposal.
- Notices use a strict enum and are cosmetic. Detail routes always re-read
  authoritative database state. Known closed/conflicted/rejected/currentness
  outcomes receive owner-safe notices; unexpected database, replay, projection
  or trusted-output failures remain observable.
- A reusable submit button exposes an announced pending state and disables the
  in-flight browser control. PostgreSQL lifecycle locking and idempotency remain
  authoritative for duplicate and concurrent submissions.
- Successful application revalidates Changes, version, authenticated runtime
  and affected public Page paths. Cache invalidation is an optimisation;
  database reads remain authoritative.
- Operational Records, Record Relationships, Record-to-Location links,
  preorder submissions, capacity counters, email state and Locations remain
  outside configuration lifecycle mutation.
- Phase 5B introduces no proposal-creation UI, operation editor,
  natural-language builder, AI/LLM integration, automatic rebase/merge or
  permanent demonstration proposal.

### Consequences

- Owner/Admin users can deliberately advance every existing legal lifecycle
  edge without receiving direct configuration-write capability.
- Staff, anonymous, malformed and cross-Business submissions fail before a
  lifecycle service can mutate another tenant; forged form-owned identity or
  candidate data has no effect.
- Duplicate validation/application, validate-versus-abandon,
  competing-application and stale-confirmation races resolve to legal database
  lifecycle states. UI pending state improves feedback but makes no idempotency
  claim.
- Apply and rollback remain immutable forward history, while operational
  business data stays live and untouched.

## ADR-014 - Separate trusted lanes for AI-assisted system and operational changes

**Status:** Accepted for v0.1 (Milestone 6 Phase 1A)

**Date:** 29 July 2026

### Context

AI is intended to be the primary system-building interface for non-technical
operators, but not every business change is versioned configuration. Treating
Product prices, Order status or Location creation as configuration would make
ordinary operations appear in configuration history and give rollback
misleading semantics. Conversely, allowing either AI or a manual editor to
write configuration projections directly would bypass the Milestone 5
proposal, preview, validation and immutable-version boundary.

The first AI milestone also needs a provider contract before a real model,
browser surface, context loader, proposal generator or durable accounting is
introduced. The contract must fail safely while no provider is configured and
must not make the deterministic runtime depend on AI availability.

### Decision

- AI is the primary system-building interface, but it is not the only control
  surface. Manual deterministic controls are established before AI operation
  generation and use the same trusted application boundaries.
- Configuration changes—including Objects, Fields, Relationships, Views,
  Forms, Pages and preorder experience settings—must enter the existing
  Milestone 5 lifecycle as strict operations, an immutable proposal, candidate,
  preview, deterministic validation, deliberate Owner/Admin application and an
  immutable version.
- Neither AI nor a manual UI may directly mutate `object_definitions`,
  `field_definitions`, `relationship_definitions`, `views`, `forms`, `pages`,
  `preorder_experiences` or `preorder_experience_locations`.
- Operational changes—including Product Record names/prices, Order status,
  Locations and Product-to-Location availability—use ordinary narrow
  operational services and generated UI. They are not configuration versions
  and are never presented as configuration rollback. A future operational undo
  is an explicit inverse edit using a captured previous value.
- Compound requests are decomposed into explicit ordered steps. Adding a new
  preorder collection Location first creates the Location through the
  operational boundary, then creates, previews, validates and deliberately
  applies an M5 proposal that references it.
- The model may plan and propose. It never validates or applies its own
  configuration proposal, and the runtime remains deterministic when AI is
  unavailable.
- Phase 1A defines registered strict Zod task contracts, a provider-neutral
  structured provider interface, trusted server-owned policies, actual
  timeouts, bounded retry behavior, normalised metadata and owner-safe errors.
  Provider output is unknown until the execution service parses it through the
  registered strict output schema.
- The sole Phase 1A production provider is disabled and performs no network
  request. There is no provider SDK or API-key use, so Phase 1A cannot incur an
  AI API charge.
- Durable per-Business budgets, usage accounting and audit persistence are
  Phase 1B. Context assembly, builder operations, proposal creation, browser
  surfaces and live provider integration remain later work.

### Consequences

- Configuration history continues to describe system design, while operational
  data remains live business state with honest edit/undo semantics.
- AI and manual surfaces cannot become alternative configuration-write
  boundaries or bypass Owner/Admin deliberation.
- Future provider adapters have one bounded, schema-constrained interface and
  cannot receive arbitrary tools, URLs, credentials, database clients or
  mutation services.
- Phase 1A proves failure, timeout, retry and strict-output behavior without
  claiming that the AI builder or a live provider is complete.

## ADR-015 - Durable per-Business AI reservation and metadata-only audit

**Status:** Accepted for v0.1 (Milestone 6 Phase 1B)

**Date:** 29 July 2026

### Context

The provider-neutral Phase 1A core can validate a registered task and execute a
bounded provider policy, but a future provider call must not begin without
durable tenant-level spend control. Browser-side limit checks cannot prevent
concurrent overspend, final-attempt-only metering can undercount retries, and a
failed post-provider audit write must not be presented as an ordinary success.

Accounting also has a different lifecycle from versioned system configuration.
Limits and execution usage are platform/account state; putting them into M5
proposals would make concurrency enforcement depend on configuration history
and give rollback misleading spend semantics.

### Decision

- Each Business has one `business_ai_settings` row, synchronously created with
  the Business and backfilled for existing Businesses. AI starts disabled and
  every request, input-token, output-token and microusd limit is finite,
  positive and capped by PostgreSQL. The documented values are conservative
  safety defaults and ceilings, not commercial plans.
- `ai_execution_runs` is one bounded reservation/audit row per trusted
  server-generated UUID. It stores only allow-listed identity, lifecycle,
  outcome, reserved/actual/charged usage, attempts, completeness and timestamps.
  It stores no prompt, task input, instruction, candidate, model output, raw
  provider response, header, credential, arbitrary provider metadata or stack
  trace.
- Reservation is one PostgreSQL transaction. It verifies `service_role`,
  rechecks the supplied actor's current Owner/Admin membership, locks that
  Business's settings row, derives the UTC day from database statement time,
  totals charged terminal runs plus active reservations, checks all four
  limits, and inserts the immutable reservation. Another Business locks a
  different row, and no transaction remains open during provider execution.
- The trusted policy registry supplies maximum billable input, maximum output,
  maximum attempts and integer microusd-per-million rates. The reservation
  covers every attempt. Input and output cost components are each rounded up
  using integer arithmetic and then added.
- The execution core exposes bounded internal accounting: attempts started,
  aggregate reported input/output tokens, usage completeness and whether
  provider invocation began. Public error serialization remains only a safe
  code and message.
- Complete usage settles to aggregate actuals. Incomplete or unknown usage
  charges at least the reservation; actual overrun is stored and charged
  without clamping. Pre-provider failure cancels and releases the reservation.
  Identical reserve/settle retries are idempotent and conflicting replays fail
  closed. Settlement is retried once; persistent failure retains the
  conservative reservation and prevents output from being returned as success.
- Unsettled reservations consume their captured UTC day's worst-case allowance.
  They naturally stop affecting a later UTC day; Phase 1B adds no expiry worker,
  queue, cron or early-reclamation mechanism.
- Direct access to both tables is revoked from anonymous, authenticated and
  service-role clients. Authenticated Owner/Admin settings, summary and
  deterministic latest-50 audit reads use narrow security-definer RPCs. Only a
  server-only AI accounting module can create a service-role client and invoke
  reserve/settle RPCs, which independently validate their trusted context.
- AI accounting is outside M5 configuration mutation. The eight configuration
  tables receive no new grant, and this phase invokes no proposal, validation,
  application, rollback or operational Record mutation.
- The sole production provider remains disabled and network-free. Phase 1B adds
  no provider SDK, API-key use, route, Server Action or UI, so it cannot incur
  an external AI API charge.

### Consequences

- Per-Business daily controls are durable and safe against concurrent requests,
  while provider execution remains independent of database, tenant and
  authorization concerns.
- Unknown outcomes fail financially conservative; known usage releases unused
  reservation capacity, and retries are charged from all metered attempts.
- Audit reads are useful for owners without becoming prompt/conversation
  storage or exposing raw provider material.
- A reservation that never settles can consume capacity for the rest of its
  captured UTC day. This deliberate v0.1 trade-off avoids premature reuse and
  background infrastructure; later reclamation requires an equally
  concurrency-safe design.
- Billing, subscriptions, customer invoicing, live providers, builder context,
  operation generation and manual configuration amendment controls remain
  outside Phase 1B.

## ADR-016 - Deterministic manual amendments share the M5 lifecycle

**Status:** Accepted for v0.1 (Milestone 6 Phase 2A.1)

**Date:** 29 July 2026

### Context

AI is intended to become the primary system-building interface, but it must not
be the only editing surface or a dependency for safe configuration changes.
The first bounded manual control edits preorder scheduling. Because the editor
renders one immutable active version and submits later, it must not silently
overwrite, merge or rebase across a newer applied version.

A manual editor also must not become a second configuration engine. Accepting
complete preorder configuration or operations from the browser would let a
forged request replace mappings, public questions, allowed Locations or
activation while appearing to change only the schedule.

### Decision

- Manual controls express bounded owner intents. The first supported intent is
  `update_preorder_schedule`: preorder stable key, collection days,
  first/last time, slot interval, capacity, cutoff hours and booking horizon.
- Owner/Admin users access dynamic no-store Edit setup routes through the
  existing `manage_configuration` capability. Staff, anonymous and
  cross-Business requests receive the controlled authorization boundary.
- The server reloads the active head and immutable version, parses
  `snapshot_json`, resolves one active preorder and its active Location
  associations, and composes one complete strict
  `set_preorder_experience` operation.
- Product, Customer, Order and Order Item keys, all Relationship keys, field
  mappings, public Fields and their labels/required/help/autocomplete settings,
  allowed Location IDs, activation and every other non-schedule property come
  from that snapshot. The browser cannot supply them authoritatively.
- Semantic no-ops create no proposal, version, head movement or audit row.
  Bounded title and owner-readable description are server-generated proposal
  context; the M5 semantic diff remains authoritative.
- Ordinary proposal creation requires both the exact expected active version
  and head revision. PostgreSQL authenticates, rechecks Owner/Admin membership,
  takes the existing Business head lock, compares both values atomically with
  NULL-safe equality and raises `configuration_proposal_stale` with no insert
  when either value is missing or mismatched.
- The obsolete five-argument `propose_configuration_change` overload is
  revoked and dropped. Its seven-argument expected-head replacement is the
  sole ordinary proposal RPC. Rollback preparation retains its separate
  trusted path and current-head controls.
- Manual submission creates only an immutable `proposed` M5 change set. Stored
  candidate, allocation, checksum, display context and semantic diff remain
  database-derived. Candidate preview, deliberate validation, deliberate
  Owner/Admin application and immutable version creation remain the existing
  M5 lifecycle.
- Manual UI performs no direct projection-table DML, operational Record or
  Location mutation, AI invocation, network request, budget reservation or AI
  execution/accounting write.
- Broader Form, View and Page controls, general manual building and AI
  operation generation remain later phases.

### Consequences

- AI is visibly not the only configuration control surface, while the runtime
  and configuration lifecycle remain deterministic when AI is disabled.
- A stale editor fails safely and asks the owner to reload; proposals are never
  silently rebased or merged.
- The manual UI stays in owner language and cannot expose or accept raw
  configuration grammar.
- Competing proposals may share one unchanged base under existing M5 semantics.
  Applying one leaves the other subject to the existing stale-base validation
  and application conflict behavior.
- The M5 proposal, preview, validation, application and version engine remains
  the sole normal production configuration mutation boundary.

## ADR-017 - Bounded question controls compose generic Fields

**Status:** Accepted for v0.1 (Milestone 6 Phase 2A.2)

**Date:** 30 July 2026

### Context

Preorder proves the platform only if an owner can safely change and extend the
questions customers answer without a question-specific table, raw schema
editor or second configuration engine. Public wording and journey-level
requiredness are channel presentation concerns, while generic Field
requiredness constrains every Record and operating journey using that Object.
Conflating them could invalidate historical or non-preorder Records.

### Decision

- `update_preorder_question` and `add_preorder_question` are bounded
  owner-intent contracts, not complete Field, preorder or operation inputs.
- Existing-question identity is route-bound as preorder key, target and Field
  key. The server reloads the active immutable snapshot and resolves exactly
  one active preorder, public mapping, configured Object and active Field.
  Missing, archived, duplicated, ambiguous, inconsistent or no-longer-public
  targets fail closed.
- Public wording, help text and requiredness live in preorder
  `public_fields`. Editing them preserves Field type, label, default, settings,
  position, activation and every other preorder property.
- Making a public question optional also emits a complete `set_field` with
  `required = false` only when its generic Field is globally required. Making a
  question required for one preorder never globally tightens the Field.
- New short and long answers map to `short_text` and `long_text` on the
  preorder’s configured Order Object. New Fields are globally optional,
  active, have a null default, empty supported settings and deterministic next
  position. The public question may independently be required.
- New Field keys are hidden and derived server-side from the owner label plus
  every active and archived key on that Object. Keys conform to the graph
  grammar, use bounded deterministic numeric suffixes and never restore or
  repurpose archived Fields.
- Equivalent empty help and identical edits are semantic no-ops. New labels
  that duplicate an active public question case-insensitively fail before
  proposal creation. Titles and descriptions are fixed, deterministic and
  owner-readable.
- Both controls compose only existing strict `set_field` and
  `set_preorder_experience` operations and call
  `ConfigurationChangeService.proposeChangeSet` with the exact active version
  and revision used for composition. PostgreSQL’s NULL-safe expected-head check
  remains the final race boundary.
- Submission creates one ordinary proposed change set only. Existing candidate
  preview, deliberate validation and deliberate application create the later
  immutable version. Live projection, public runtime, operational Records and
  Relationships remain unchanged before application; AI is never invoked or
  accounted.
- No new primitive, domain table, database migration, service-role manual
  editor, direct configuration DML, provider request or alternate mutation path
  is introduced. Broader Form, View, Page and generic schema editing remain
  later work.

### Consequences

- Owners can make Phone optional, change public question wording/help, or add a
  Gift message without seeing Objects, Fields, keys or operation grammar.
- Existing Records stay compatible because preorder requiredness is separate
  from global Record requiredness, and new Order Fields start optional.
- Manual controls and future AI authors share the same strict operation grammar
  and immutable M5 lifecycle, including no-op, stale, preview, validation,
  deliberate application and forward history behavior.

## ADR-018 - Model context is a data-minimised projection of the active Business

**Status:** Accepted for v0.1 (Milestone 6 Phase 3A)

**Date:** 30 July 2026

### Context

A future registered planning task needs a deterministic answer to “What is this
Business currently configured to do?” Supplying raw tenant rows would expose
configuration identities, audit metadata and operational PII, while reading
live normalized configuration tables independently could combine different
configuration states. Context assembly must also remain separate from provider
execution/accounting and from the M5 proposal lifecycle.

### Decision

- One server-only loader receives an ordinary authenticated Supabase session
  client and a server-selected Business UUID. It derives the actor from session
  claims, verifies current membership and requires the fixed
  `manage_configuration` capability. Owner and Admin qualify; Staff,
  anonymous and cross-Business callers do not.
- The loader reads the tenant-scoped Business and current active and inactive
  Locations through authenticated RLS, then reads the Business configuration
  head and its active immutable configuration version. The strict
  `configurationSnapshotV1Schema` parses that snapshot. It does not assemble
  configuration by independently reading normalized live projection tables.
- Locations remain current operational/platform state because configuration
  snapshots intentionally retain only their opaque associations. A snapshot
  association that does not resolve to a current same-Business Location makes
  context inconsistent; it is never silently dropped or invented.
- A separate pure projector has no Supabase/database client, configuration
  mutation service, provider, execution/accounting service, I/O or mutation.
  It emits one strict schema-v1 allow-listed model context containing Business
  summary, current role/configuration capability, active version number and
  revision, Locations, Objects and grouped Fields, Relationships, Views, Forms,
  Pages, preorder experiences and a versioned registry of implemented platform
  capabilities.
- Active and archived configuration identities remain represented by stable
  keys and active flags. Field settings expose only validated options for
  select/multi-select/status and a three-letter currency code for currency.
  Raw Field and Form default values are replaced by `has_default`.
- Configuration UUIDs, Business/actor/version identity, actors, timestamps and
  checksums are excluded. Location UUIDs are the sole opaque database
  references in model-facing context because current preorder operations
  require them. They remain untrusted and must be tenant- and
  eligibility-checked if later model output returns them.
- Operational Records and their values, Record Relationships,
  Record-to-Location links, submissions, counters, rate limits, email state,
  memberships/profiles, AI settings/audit, prompts/output, proposals,
  candidates, diffs and validation data are never loaded into model context.
- Exact active-version and head-revision currentness is returned as trusted
  server metadata outside `modelContext`. Later proposal creation must use that
  expected-head protection; model output never supplies trusted currentness.
- Every collection and serialized JSON object is deterministically ordered.
  The complete model context has a 128 KiB hard limit, fails without truncation
  and is neither persisted nor logged. The Bedford Version 2 acceptance
  context, including one inactive Location fixture, is 11,189 bytes.
- Phase 3A makes no provider/network request, invokes no AI execution service,
  reserves no budget, creates no AI execution row, proposal, route, Server
  Action or UI, and performs no lifecycle transition.

### Consequences

- Future registered planning tasks receive one stable provider-neutral data
  contract without coupling provider adapters or accounting to tenant reads.
- Business configuration text and safe Page URLs remain available for useful
  planning, while operational customer/order/product values and audit
  identities remain outside the model boundary.
- A context above the conservative v0.1 bound fails before any future provider
  or accounting action. Relevance filtering or scoped contexts require a later
  explicit design rather than silent truncation.
- Later model output remains untrusted and can enter configuration only as
  strict allow-listed M5 operations with expected-head protection, preview,
  deterministic validation and deliberate Owner/Admin application.

## ADR-019 - Builder planning is structured, reviewable and non-executing

**Status:** Accepted for v0.1 (Milestone 6 Phase 3B)

**Date:** 30 July 2026

### Context

The first real builder task must translate one owner request and the Phase 3A
Business context into useful clarification or a reviewable plan without
prematurely creating configuration operations, proposals or a conversational
surface. Static output shape validation alone cannot prevent a model from
inventing existing Object keys, Location references or incoherent step
dependencies.

Planning also uses the Business-aware execution boundary, whose accounting
requires trusted actor and Business identity. Those identities and exact
configuration currentness must not become model input merely because the
planning service composes context and accounting.

### Decision

- `builder_plan_v1` is one registered server-owned task. Its strict input is a
  schema-v1 object containing one trimmed 1–4,000 character owner request and
  the exact Phase 3A `AiBusinessModelContextV1`.
- The authoritative context loader additionally returns session-derived
  `actorId` and tenant-checked `businessId` in a server-only execution envelope.
  Neither identity, the active version UUID nor trusted head currentness enters
  registered task input. `buildAiBusinessContext` retains its existing public
  bundle shape.
- The strict versioned output is either one to five bounded clarification
  questions or a bounded owner-readable ready plan. Assumptions, concepts,
  journeys, steps and unsupported requirements use plan-local references and
  conservative string/array limits.
- Domain concepts are included only when a plan concerns generic Business
  concepts. A platform-only operational plan keeps the required `concepts`
  property as an explicit empty array and its steps use empty
  `affected_concepts`. In particular, Location planning neither creates nor
  pretends there is a generic Location Object.
- Ready steps distinguish configuration and operational lanes with fixed
  descriptive categories. Categories are planning vocabulary, not provider
  tools, M5 operations, candidates or mutation authority. Every ready step
  requires later owner confirmation.
- Unsupported workflows, rules, payment, inventory, integrations, arbitrary
  code and other unavailable capabilities are surfaced explicitly. A ready
  plan contains no unresolved unsupported requirement, and high-impact
  assumptions require owner confirmation.
- Registered tasks may define an optional pure server-owned semantic output
  validator. The provider-neutral core invokes it after strict parsing and
  usage aggregation but before success. Failure becomes `ai_output_invalid`
  with accounting retained. `contract_probe_v1` continues without a hook.
- The planning validator performs no I/O. It checks unique references,
  state-specific invariants, context-resolved Object and Location references,
  concept consistency, lane/category compatibility, contiguous ordered
  dependencies and compatibility with the supplied capability registry.
- `builder_planning_v1` permits at most 160 KiB input, 64,000 billable input
  tokens and 4,096 output tokens per attempt, a 30-second timeout and two
  attempts with bounded rate-limit/transient retries. Zero pricing and the
  disabled network-free production provider remain unchanged. Its worst-case
  128,000 input-token and 8,192 output-token reservation fits the default
  Business limits.
- The authenticated service accepts only an ordinary session client,
  server-selected Business UUID and bounded owner request. It loads
  authoritative context, prepares/executes through existing Business-aware
  accounting, reloads context and compares base version, head revision and
  canonical serialized model context.
- A detected configuration or Location change discards the plan with
  `ai_plan_context_stale`. The metadata-only audit still records usage incurred
  by the completed model execution. There remains an unavoidable race after
  the final read; future operation generation and proposal creation must
  rebuild context and enforce expected-head protection.
- Owner requests, task input, Business context, questions, assumptions, plans,
  instruction and provider output remain in memory and are never persisted.
  Phase 3B creates no proposal, candidate, validation, application, publication,
  Record/Location mutation, route, Server Action, chat surface or migration.
- Phase 3A retains configured URLs accepted by the Page grammar. Before any live
  provider is enabled, SMBOS must decide and test treatment of HTTPS query
  strings/fragments and `mailto:`/`tel:` links: full values, normalized origins
  or redacted representations.

### Consequences

- The first builder task is useful and owner-readable without becoming an
  execution or configuration-write boundary.
- Hallucinated references and incoherent plans fail before successful
  settlement, while genuine provider usage remains conservatively accounted.
- Production still makes no external model request and the deterministic
  business runtime remains independent of AI availability.
- Clarification answers, operation generation, proposal creation, live-provider
  integration and builder UI remain later work.

## ADR-020 - External model execution is opt-in, minimised and schema-constrained

**Status:** Accepted for v0.1 (Milestone 6 Phase 4A)

**Date:** 31 July 2026

### Context

The provider-neutral execution, Business accounting, model context and
non-executing planning boundaries are ready for their first external model.
Enabling one without a separate server gate, code-owned model/pricing or a
provider-compatible strict schema would let deployment or model behavior
weaken trusted policy. Raw Page image/button URLs also contain destination
details the planning model does not need, including credentials, paths, query
values, fragments, email addresses and telephone numbers.

Responses application-state storage and provider account retention are
different concerns. SMBOS can prevent its own prompt/output persistence and
request `store: false`, but cannot infer Zero Data Retention for a provider
organization from repository code.

### Decision

- OpenAI Responses is the first and only external adapter behind the existing
  provider-neutral `StructuredAiProvider` interface. The official server SDK
  is pinned and constructed with `logLevel: "off"`. Ambient `OPENAI_LOG`
  values cannot enable SDK request or response payload logging for SMBOS
  calls. No browser module imports it.
- External execution is disabled when `AI_PROVIDER` is missing, blank or
  `disabled`. The only other accepted mode is `openai`, which requires
  `OPENAI_API_KEY` in server-only runtime code. The API key never enters the
  database, browser, request metadata, public errors, logs or AI execution
  audit.
- Server activation and `business_ai_settings.is_enabled` are independent
  gates. A disabled Business fails before reservation and provider invocation.
- Provider, API endpoint, model, instruction, reasoning behavior, storage,
  schema, token bounds, timeout, attempts and pricing are code-owned. OpenAI
  mode routes `builder_planning_v1` only to
  `gpt-5.4-mini-2026-03-17`; future providers/models require new reviewed
  registry entries. The disabled provider remains registered alongside
  OpenAI so `contract_probe_v1` returns controlled `ai_disabled` without an
  external request. Production runtime construction validates every complete
  task → policy → provider chain and fails closed before returning if registry
  identities or references do not match.
- Standard pricing is 750,000 input and 4,500,000 output microusd per million
  tokens. Cached input receives no discount. Existing integer ceiling
  arithmetic reserves 128,000 input plus 8,192 output tokens across two
  attempts for exactly 132,864 microusd. Pricing must be reviewed whenever the
  fixed model changes.
- Unreleased model-context schema v1 is hardened in place. It no longer embeds
  the runtime Page-block union. Heading, text, View, Form, preorder and divider
  structure is preserved. Images expose alt/caption and
  `source_kind: external_web`; buttons expose label/style and an
  `internal_path`, `external_web`, `email` or `telephone` destination kind.
  Raw destinations and their credentials, hosts, paths, queries, fragments,
  email addresses and telephone numbers are excluded. Runtime Page
  configuration and rendering are unchanged.
- The existing registered Zod output schema and pure semantic validator remain
  authoritative. A deterministic adapter adds one required object transport
  wrapper, requires every object property, forces
  `additionalProperties: false`, preserves names/types/enums/discriminators
  and supported bounds, explicitly converts `oneOf` to `anyOf`, and removes
  only the provider-incompatible `$schema` dialect declaration. Supported
  format constraints are preserved and Zod remains authoritative. Any other unsupported
  keyword or optional object property fails before network invocation.
- The request contains one separate server instruction and one
  deterministically serialized structured user input, the fixed model and
  output maximum, strict `text.format` JSON Schema, `store: false` and the
  existing abort signal. It supplies no tools, function calling, web/file
  search, code/computer execution, MCP, previous response, conversation,
  background mode, identity, arbitrary metadata, headers or base URL.
- The adapter accepts exactly one assistant message with one structured text
  result, rejects refusal/missing/multiple/malformed output, unwraps the
  transport and returns no raw response. Registered Zod parsing and semantic
  validation then run as before.
- Refusal, content filtering and max-output incompleteness are non-retryable
  and settle failed with reported usage. Only rate limiting and transient
  network/5xx failures use the existing bounded retry policy. Authentication
  fails unavailable, invalid request/schema fails safely, and no provider
  body, header, refusal text, credential or stack trace reaches public errors
  or audit. Missing usage remains conservatively charged; retry usage
  aggregates across attempts.
- SMBOS keeps request, instruction, context, response and raw provider content
  in memory only. `store: false` disables Responses application-state storage
  for the request; it is not a claim of Zero Data Retention. Provider
  abuse-monitoring and organization-level retention remain governed by the
  deployed OpenAI project/organization data controls and require review before
  production launch.
- Phase 4A adds no route, Server Action, UI, chat/conversation persistence,
  operation generation, proposal, validation, application, lifecycle
  progression, Record/Relationship/Location mutation, migration, table or new
  platform primitive.

### Consequences

- A deployment and a Business must both deliberately enable external planning;
  default builds and CI remain network-free and require no API key.
- The model sees Page-block purpose without receiving configured destination
  secrets. Arbitrary Business-authored page text remains intended content and
  is not claimed to be redacted.
- Provider schema enforcement supplements rather than replaces SMBOS parsing,
  semantic validation, reservation, settlement and stale-context checks.
- The deterministic runtime and existing configuration/operational mutation
  boundaries remain independent of AI availability.

## ADR-021 - Real-model planning must pass a bounded synthetic evaluation gate

**Status:** Accepted for v0.1 (Milestone 6 Phase 4B)

**Date:** 31 July 2026

### Context

Injected-client and unit coverage prove SMBOS request construction, strict
schema transport, structural parsing, semantic validation and safe failure
mapping deterministically. They do not prove that the fixed external model can
coherently satisfy representative Business-owner planning requests. Operation
generation must not begin on that assumption.

A useful compatibility gate must exercise the approved production planning path
without becoming a production endpoint, tenant-data export, persistence
surface, benchmark service or prompt-tuning loop.

### Decision

- One engineering-only harness evaluates the production `builder_plan_v1`
  task, instruction, strict input/output schemas, semantic validator, Phase 3A
  model-context contract, OpenAI Responses adapter,
  `gpt-5.4-mini-2026-03-17` model and `builder_planning_v1` policy unchanged.
  A failure is recorded as bounded diagnostics and requires a separate focused
  correction; this phase does not silently tune the subject under test.
- The harness uses one code-owned deterministic synthetic local-food Business
  context that passes the exact `AiBusinessModelContextV1` schema and remains
  below 128 KiB. It includes representative Objects, Fields, Relationships,
  internal Views, public Form/Page, preorder configuration/questions and two
  RFC-valid synthetic Location references. It includes no tenant row,
  membership, operational Record, customer/order data, personal name, contact
  value, credential or destination secret.
- Exactly eight stable scenarios cover optional preorder phone, preorder
  schedule, fully specified corporate catering enquiries, Location creation,
  compound Location/preorder configuration, unsupported weekly email
  automation, unsupported card payment and ambiguous bookings. Calls are
  sequential and each scenario runs once, subject only to the production
  policy's existing maximum of two attempts.
- Strict parsing and the production semantic validator run before one pure
  deterministic evaluator. Hard gates cover ready/clarification state,
  configuration/operational lanes, required/forbidden categories, unsupported
  capability honesty, plan-local/current references and compound step
  ordering/dependency. No second model or model-as-judge is used.
- Evaluation output is limited to stable scenario identity, pass/fail, result
  state, lane/category and unsupported-reason enums, bounded counts, attempts,
  input/output tokens, integer estimated microusd, elapsed milliseconds and
  failed-gate enums, plus bounded aggregate totals. Owner requests, Business
  context/name, model prose, questions, assumptions, outcomes, summaries,
  labels, UUIDs, response IDs, raw provider material and credentials are not
  printed, logged or persisted. Provider failures expose only scenario ID and
  a safe SMBOS error code.
- Existing trusted integer accounting derives 132,864 microusd per scenario
  and exactly 1,062,912 microusd for eight scenarios. A separate code-owned
  1,100,000 microusd hard ceiling is verified before provider construction or
  request. Environment input cannot change scenario count, repetitions,
  attempts, model, output limit or ceiling.
- Live execution requires all of `RUN_LIVE_OPENAI_EVAL=1`,
  `AI_PROVIDER=openai` and a non-blank server-only `OPENAI_API_KEY`. A key
  alone grants no permission. Missing or incorrect activation constructs no
  provider and makes no request. Normal tests, CI, builds and demo seed never
  invoke the live command; CI exercises the complete scenario → registered
  task → structural parsing → semantic validation → evaluator path with
  injected fake providers.
- Evaluation code is unreachable from application routes, Server Actions and
  browser modules. It has no database client, Business accounting,
  file-writing, telemetry, analytics, mutation or configuration-lifecycle
  dependency and writes no result file. It creates no `ai_execution_runs` row,
  proposal, configuration change, Record, Relationship or Location.
- The live gate must be rerun when the fixed model, planning instruction,
  planning output schema, semantic validator or provider schema transport
  materially changes.
- Operation generation remains blocked until a successful explicit live
  evaluation has been completed and reviewed.

### Consequences

- Live provider compatibility becomes explicit evidence separate from
  deterministic adapter and injected-provider coverage.
- Evaluation API usage is bounded and deliberate, while CI and normal
  development remain network-free.
- A quality or compatibility failure stops progression to operation generation
  without leaking model content or creating production state.
- Phase 4B adds no route, Server Action, UI, operation generation, proposal,
  validation/application action, operational mutation, migration, table or
  platform primitive.

### Phase 4B.1 amendment - bounded diagnostics and least-change precision

**Date:** 31 July 2026

The first explicit real-model evaluation was run once with the fixed
`gpt-5.4-mini-2026-03-17` model:

- scenarios: 8
- passed: 4
- failed: 4
- input tokens: 31,413
- output tokens: 3,993
- estimated cost: 41,535 microusd
- elapsed: 32,327 ms

The focused correction preserves the Phase 4B model, provider, pricing, token,
retry, output schema, scenarios, context and evaluator gates. Semantic
validation now throws one code-owned `BuilderPlanValidationError` diagnostic;
structural and unclassified output failures are classified as
`output_contract_invalid` and `unknown_output_invalid`. Evaluation output may
include only the bounded validation stage and diagnostic enum for
`ai_output_invalid`. Public errors, `toJSON`, `toPublicError`, settlement and
metadata-only audit remain unchanged.

The server-owned instruction now enforces the explicit request as the scope
boundary, smallest coherent plans, no adjacent work, concept-free
Location-only plans, exact trusted references, globally unique plan-local
references, prior-step dependencies and explicit ordering for combined Location
and later configuration requests. No operation generation or mutation surface
is introduced.

### Phase 4B.2 amendment - high-impact assumption contract alignment

**Date:** 31 July 2026

The second explicit real-model evaluation was run once against the unchanged
`gpt-5.4-mini-2026-03-17` planning path:

- scenarios: 8
- passed: 7
- failed: 1
- input tokens: 33,453
- output tokens: 3,194
- estimated cost: 39,468 microusd
- elapsed: 29,322 ms

The remaining diagnostic was
`high_impact_assumption_unconfirmed` for `preorder_schedule_change`. The
earlier reference and least-change failures are resolved. This focused
correction aligns the server-owned instruction with the existing deterministic
assumption invariant: an assumption is an owner-unknown fact not already
established by Business context; explicit owner instructions and their direct
requested effects are not assumptions; unnecessary assumptions should be
omitted; and every high-impact assumption in a ready plan must require owner
confirmation. Low- and medium-impact assumptions must still be classified
honestly.

The `builderPlanAssumptionSchema`, ready-plan validator, diagnostic taxonomy,
`high_impact_assumption_unconfirmed` failure, scenario definitions and evaluator
gate are unchanged. High-impact assumptions without confirmation remain
rejected, confirmed high-impact assumptions remain accepted, and semantic
invalid output is not retried automatically. Public `AiExecutionError` JSON and
metadata-only accounting settlement continue to exclude diagnostics and
assumption content. Operation generation remains blocked. The same eight
scenarios must run once more after exact-head CI; implementation and CI remain
non-live.

## ADR-022 - Current-generation planning uses Terra medium and repeated reliability gates

**Status:** Accepted for v0.1 (Milestone 6 Phase 4C)

**Date:** 31 July 2026

### Context

The historical `gpt-5.4-mini-2026-03-17` candidate was evaluated three times
against the approved planning subject: 4/8 (31,413 input tokens, 3,993 output
tokens, 41,535 microusd, 32,327 ms), 7/8 (33,453 input tokens, 3,194 output
tokens, 39,468 microusd, 29,322 ms), and 4/8 (30,587 input tokens, 2,303
output tokens, 33,308 microusd, 22,514 ms). The varying failures show that a
single favourable run—or one further scenario-specific prompt sentence—is not
reliability evidence.

Planning needs a current balanced candidate without weakening the deterministic
contract or creating a production-facing evaluation surface. An advancing model
alias cannot promise snapshot-level reproducibility, so qualification evidence
needs clear invalidation rules.

GPT-5.6 otherwise uses implicit prompt caching. An implicit breakpoint could
write cache tokens at a higher rate than ordinary uncached input, while the
current provider usage normalization and trusted reservation price only cover
standard input and output tokens.

### Decision

- `builder_plan_v1` uses code-owned `gpt-5.6-terra` with explicit,
  non-overridable `reasoning: { effort: "medium" }`. It has no fallback, owner
  selection or environment/model-response override. The OpenAI request retains
  `store: false`, fixed base URL, `logLevel: "off"`, `maxRetries: 0`, strict
  schema transport, no tools, no conversation state and the existing abort
  signal. It also owns `prompt_cache_options: { mode: "explicit" }` inside the
  provider, sends no prompt-cache breakpoint, key or retention option, and
  accepts no cache-mode input from callers, Business settings, environment or
  model output. Reasoning summaries and reasoning content are neither requested
  nor persisted.
- The task's structured contract remains version 1, but its metadata-only
  policy identity is `builder_planning_terra_medium_v1`. Disabled runtime maps
  it to the disabled provider and zero pricing; OpenAI maps it to Terra medium.
  The policy retains the 160 KiB, 64,000-input-token, 4,096-output-token,
  30-second, two-attempt, 250-ms, rate-limit/transient-only bounds.
- Trusted pricing is 2,500,000 input and 15,000,000 output microusd per
  million tokens. Explicit mode with no explicit breakpoint means this profile
  does not use provider prompt caching, so the ordinary $2.50/M input rate is
  the trusted reservation rate. Standard integer ceiling accounting charges all
  reported input and output tokens without cached-input discounts. One execution
  reserves exactly 442,880 microusd, within the existing 5,000,000 default daily
  limit. Prompt caching requires a separate future review with detailed
  cache-token accounting.
- The Phase 4B.2 instruction, schemas, semantic validator, diagnostic
  taxonomy, synthetic Business context, eight owner requests, deterministic
  gates and provider schema transport are frozen. Regression tests enforce the
  instruction exactly and pin the other frozen source contracts.
- Gate A runs the eight unchanged scenarios exactly once and sequentially only
  when `RUN_LIVE_OPENAI_TERRA_QUALIFICATION=1`, `AI_PROVIDER=openai` and a
  non-blank server-only key are all present. Before provider construction it
  verifies the exact 3,543,040 microusd envelope against a 3,700,000 ceiling.
  It requires 8/8 successful structural, semantic and deterministic-gate
  results, no fabricated references, no provider failure and aggregate cost
  below the ceiling.
- Gate B is separate and never starts automatically. It deliberately runs the
  same eight scenarios in three sequential rounds (24 executions) only when
  `RUN_LIVE_OPENAI_TERRA_RELIABILITY=1` is set with the same server gates.
  Before provider construction it verifies the exact 10,629,120 microusd
  envelope against an 11,000,000 ceiling. It requires 24/24 and three passes
  for every scenario. The historical `RUN_LIVE_OPENAI_EVAL` flag is inert and
  the superseded command is a safe deprecation message.
- Both gates remain engineering-only: no route, Server Action, UI, client
  import, tenant row, membership, accounting row, proposal, configuration or
  operational mutation, database client, file writing, telemetry or analytics.
  Their only output is bounded redacted metadata; model prose, request/context,
  reasoning content, labels/references, provider data and credentials are not
  emitted or persisted.
- Alias advancement invalidates evidence, as do changes to model identifier,
  reasoning effort, instruction, schemas, semantic validation, material context
  projection or provider schema transport. A failed qualification or reliability
  result stops progression without automatic rerun or prompt tuning; the next
  reviewed comparison candidate is GPT-5.6 Sol medium.

### Consequences

- The supplied reviewed redacted live evidence clears the planning gate for the
  frozen Terra-medium profile: qualification passed 8/8 (34,949 input tokens,
  3,476 output tokens, 139,515 estimated microusd, 47,157 ms; structural,
  semantic, scenario-gate and provider failures all zero), and reliability
  passed 24/24 over three sequential repetitions, every scenario 3/3 with one
  provider attempt per execution (104,847 input tokens, 8,764 output tokens,
  393,585 estimated microusd, 108,779 ms; all four failure counters zero).
  This is bounded engineering evidence, not a universal model-perfection
  claim.
- CI remains network-free by exercising only injected providers. The live gates
  are explicit, bounded operator actions and create no durable state.
- Deterministic schemas, semantic validation and scenario gates remain
  authoritative; the model has no mutation authority. Operation generation,
  proposal creation, validation/application automation and publication remain
  unimplemented and outside this milestone. A later milestone may begin
  bounded change drafting only with exact-head protection and the separate
  configuration/operational lanes.
- Any material model-alias, prompt, schema, semantic-validator, context or
  provider-transport change invalidates this evidence and requires both gates
  to be rerun.

## ADR-023 - Bounded additive configuration drafting remains untrusted and disabled

**Status:** Accepted for v0.1 (Milestone 7 Phase 1A)

**Date:** 1 August 2026

### Context

Milestone 6 can produce a validated ready plan but deliberately stops before
configuration operations. The next boundary must express enough generic design
intent for a future deterministic compiler without allowing the model to
choose trusted identities, currentness, complete definitions or lifecycle
actions. The adjacent Corporate Catering Enquiry case must be representable
using the existing Object, Field, Relationship, View, Form and Page primitives,
not a catering-specific module or new database table.

The current public Page and Form runtime is also intentionally incomplete:
PostgreSQL resolves only static published public Pages, the public renderer has
no generic public Form action, and the existing generic Form submission path
creates or updates one internal Record without Relationship controls. Public
Form/Page design intent must therefore not imply executable publication.

### Decision

- Register one server-only `builder_configuration_draft_v1` task at schema
  version 1 with a strict owner request, exact `AiBusinessModelContextV1` and
  existing ready-plan result as input.
- Allow only additive intent for Objects, Fields, Relationships, Views, Forms
  and Pages. Reject `configure_preorder`, operational categories, updates,
  archive/restore/delete intent, Field type changes, Locations, Records,
  Relationship edges, workflows, rules, payments, integrations, code, SQL,
  HTTP and arbitrary executable instructions.
- Give each new entity a globally unique plan-local reference and require
  exact `step_N` source references. Each draft Object must bind to one exact
  ready-plan `concept_N` with disposition `new`; duplicate concept bindings
  fail, and every new concept affected by a `define_object` step must be
  represented. Existing dependencies resolve only through exact active
  context keys. The contract contains no new stable keys, UUIDs, positions,
  defaults, active state, slugs, publication state or currentness.
- Use typed View/Form/Page grammars and strict Field settings rather than
  arbitrary JSON. A pure synchronous validator proves the ready planning
  boundary, source-step coverage, exact per-step Object scope, reference
  resolution and activity, ownership, audience/mode compatibility, required
  create-Form coverage, deterministic duplicate intent and the 128 KiB
  serialized bound. Existing scope comes only from exact Object keys or
  existing concepts' exact Object keys; draft scope comes only from affected
  new concepts. Page steps must authorize the Objects behind referenced
  View/Form blocks. All structurally optional design properties are required
  and use explicit `null` when absent; empty collections remain `[]`.
  Singular and plural labels may normalize to the same value within one new
  Object, while labels across different new Objects share one normalized
  duplicate set.
- Register the output validator through the existing optional execution hook.
  Input semantic checks run during the normal task schema parse, before any
  provider invocation. Validation diagnostics are finite, code-owned and never
  appear in public AI errors or accounting.
- Use the separate
  `builder_configuration_drafting_disabled_v1` policy with the bounded
  256 KiB/96,000-token/8,192-token/30-second/two-attempt envelope and zero
  pricing. Keep it mapped to the disabled provider in both disabled and OpenAI
  registries. The existing OpenAI schema adapter is covered by a non-live test
  over the actual drafting schema, but no drafting provider request is enabled.
  Do not add an OpenAI drafting profile or alter the Terra planning
  profile/evidence; planning evidence is not reused for this drafting boundary,
  and any material drafting schema or validator change invalidates such reuse.
- Keep the result transient. Do not load Business state from the database,
  persist requests/plans/drafts, create operations/candidates/proposals,
  invoke the configuration lifecycle, add a route/UI, add a migration or
  mutate configuration or operational data.

### Consequences

The model can describe a bounded generic Catering Enquiry design using the
existing platform grammar, while trusted key allocation, complete M5
definitions, operations, ordering, preservation, defaults, active/publication
state, IDs, proposal metadata and expected-head protection remain future
server-owned compiler work. The existing planning task and Terra qualification
and reliability evidence remain unchanged and cannot be reused as evidence for
drafting. The public Form/Page gap remains explicit and requires a later
reusable capability before end-to-end public Catering Enquiry acceptance.

## ADR-024 - Deterministic configuration draft compilation is a pure snapshot boundary

**Status:** Accepted for v0.1 (Milestone 7 Phase 1B)

**Date:** 1 August 2026

### Context

ADR-023 deliberately stops at a validated, untrusted additive configuration
draft. The next safe boundary must turn that bounded blueprint into complete
M5 operation intent without allowing the model to choose trusted IDs,
currentness, lifecycle state or database behavior. Existing configuration may
also have changed since model context was assembled, and archived identities
must remain unavailable for accidental reuse.

### Decision

- Keep `src/ai/configuration-drafting/` as the untrusted Phase 1A contract and
  place the trusted compiler under `src/core/configuration/draft-compiler/`.
- Make `compileConfigurationDraft()` synchronous and pure. It accepts only the
  Phase 1A task input, draft and one server-supplied immutable
  `ConfigurationSnapshotV1`; it performs no database, network, provider,
  Business, actor or lifecycle access.
- Re-run the Phase 1A semantic validator and parse the authoritative snapshot,
  then resolve every existing Object, Field, Form and View reference against
  that fresh snapshot. Missing, inactive, incompatible, duplicate or
  inconsistent identities fail with finite code-owned safe diagnostics.
- Reserve active and archived Object, Field, Relationship, View, Form and Page
  keys plus Page slugs. Derive new keys and slugs through deterministic
  normalized bases and finite numeric suffixes. Derive Field positions from
  canonical source-step/base/local-reference order, starting new Objects at
  zero and appending Fields on existing Objects after the greatest historical
  position.
- Emit only complete strict `set_object`, `set_field`, `set_relationship`,
  `set_form`, `set_view` and `set_page` operations. Preserve nested design
  order, return canonical operation group order, parse every operation through
  the existing M5 schemas and fail closed on M5 count/size/grammar limits.
- Compile all new Pages as `draft`. Public Form/Page intent remains design
  configuration, and Relationship operations create no operational edges.

The compiler never derives UUIDs, expected-head values, candidate snapshots, ID
allocations or proposal metadata. M5 later allocates trusted IDs while
materialising a proposal candidate. Phase 2 supplies authentication, exact
currentness and proposal orchestration.

### Consequences

The model can express the generic Catering Enquiry blueprint while the trusted
platform controls identity allocation, snapshot drift, defaults, active state,
experience grammar and operation ordering. Active and archived definitions are
not silently reused, and the compiler remains testable without Supabase reset
or provider calls. Terra planning evidence remains unchanged and is not
evidence for drafting or compilation. Generic public Form submission and
publication remain deferred to a later reusable runtime capability.

## ADR-025 - Authenticated configuration proposal orchestration is an exact-currentness server handoff

**Status:** Accepted for v0.1 (Milestone 7 Phase 2)

**Date:** 1 August 2026

### Context

ADR-024 deliberately stops at pure compilation. The next boundary must let an
authenticated Owner/Admin turn a completed transient draft into one ordinary
M5 proposal without allowing the browser, model or orchestration layer to
choose actor identity, trusted IDs, lifecycle state or stale configuration.
The handoff must also prevent a snapshot from changing between compilation and
proposal creation, while keeping Phase 1A/1B artifacts out of durable storage.

### Decision

- Keep Phase 2 under the server-only
  `src/ai/configuration-proposal/` boundary. Its strict request contains only
  the verified `businessId`, expected active version/head, Phase 1A task-input
  base contract and Phase 1A draft. Actor identity, proposal metadata and
  operations are server/compiler-owned; no route or browser contract exposes
  them.
- Load the existing authoritative context source first. Require authenticated
  Owner/Admin membership, compare expected currentness exactly and compare the
  supplied model context with the canonical projection exactly. Compile once
  against that first immutable snapshot.
- Load the authoritative context a second time. Require the same
  session-derived Business/actor identity, currentness and canonical model
  context as both the expected handoff and the first read. Treat any mismatch
  as stale and do not retry, rebase or substitute context.
- Make exactly one existing M5 `ConfigurationChangeService.proposeChangeSet`
  call with the compiler's strict operations, expected version/head, fixed
  title `Proposed configuration changes` and `description: null`. M5 remains
  the source of trusted IDs, candidate materialisation and the operation diff.
- Return only a frozen bounded result containing schema version, proposal ID,
  proposed status, base version ID, base head revision and operation count.
  Map stale, compiler, no-change and other failures to finite safe errors;
  never expose raw request/context/plan/draft/provider/database data.
- Do not validate, apply, publish, abandon, rollback, retry, call a provider,
  persist the handoff, add AI execution/accounting, change planning or drafting
  registries, add routes/UI/migrations, or mutate operational data. The
  Catering Enquiry proof uses only existing primitives and remains design
  intent for a draft Page and metadata-only Relationship; it adds no
  catering-specific production path and no generic public Form runtime.

### Consequences

The completed Phase 1A/1B artifact can cross one auditable server boundary to
an ordinary proposed M5 change while currentness is checked before and after
compilation and again atomically by M5. Live configuration is unchanged until
the existing deliberate lifecycle, and no raw AI handoff is stored. Preview,
validation/application, provider activation and reusable public Form
submission remain separate future capabilities.

## ADR-026 - Provider-backed configuration drafting is qualified as a frozen evaluation profile

**Status:** Accepted for v0.1 (Milestone 8 Phase 8A)

**Date:** 2 August 2026

### Context

The existing `builder_configuration_draft_v1` contract is a bounded,
untrusted design boundary and remains production-disabled. Planning Terra
evidence cannot establish drafting reliability because drafting has a separate
instruction subject, schema, semantic validator and deterministic acceptance
surface. A provider-backed drafting candidate therefore needs its own finite
engineering evidence without introducing a production mutation path.

### Decision

- Qualify the exact drafting subject through an unregistered evaluation task
  profile that reuses the production task key/version, instruction, input and
  output schemas, and semantic validator while changing only the policy key to
  `builder_configuration_drafting_terra_medium_v1`.
- Fix the candidate to `gpt-5.6-terra` with explicit `medium` reasoning and
  code-owned token, timeout, retry and pricing bounds. Derive all reservations
  with the existing integer accounting functions: 725,760 microusd per
  execution, 5,806,080 for qualification (8) and 17,418,240 for reliability
  (24), with hard ceilings of 6,000,000 and 18,000,000.
- Use exactly two frozen, schema-validated synthetic contexts and eight fixed
  code-owned ready plans. Run qualification once sequentially and reliability
  three sequential rounds, with strict structural, semantic, unknown,
  provider and deterministic scenario-gate failure classification.
- Emit only strict redacted metadata and bounded safe error codes. Keep the
  live commands exact-opt-in and out of CI. Do not persist requests,
  responses, reports or model prose.
- Keep `builder_configuration_draft_v1` registered against
  `builder_configuration_drafting_disabled_v1` in both disabled and OpenAI
  production modes. During Phase 8A, the evaluation loader alone constructed
  the provider-backed task service; Phase 8B adds a separate authenticated
  private runtime for that composition without changing this global registry.
  No Phase 8A database, Business accounting, compiler, proposal, lifecycle,
  route, UI or public Form runtime is added.

### Consequences

Phase 8A supplies bounded evidence for one frozen drafting profile rather than
generic model correctness. Planning evidence remains separate. Any material
model/policy/transport, drafting subject, synthetic context, ready plan,
scenario order, evaluator or report-classification change invalidates both
gates and requires them to be rerun.

The reviewed closeout evidence applies to the exact frozen code subject
`acc9eecf652dfcd393c63ee4b9517316a00cdf90`, using task
`builder_configuration_draft_v1`, model `gpt-5.6-terra`, explicit `medium`
reasoning and policy `builder_configuration_drafting_terra_medium_v1`.
Qualification ran once and passed 8/8: 8 attempts, 53,719 input tokens, 4,647
output tokens, 204,005 estimated microusd, 41,615 ms elapsed, usage complete,
exit code 0 and zero structural, semantic, unknown-output,
deterministic-scenario-gate or provider/execution failures.

The first reliability run remains bounded historical evidence at the same SHA:
23/24 passed, with one 60-second `ai_timeout` for
`equipment_maintenance_workspace` at repetition 2, provider/execution
failures 1, all other finite failure counts 0, 155,672 input tokens, 13,059
output tokens, 585,072 estimated microusd, 172,058 ms and exit code 1. No
model, policy or source change followed. A single controlled complete rerun
passed 24/24, every scenario 3/3, with 161,157 input tokens, 13,463 output
tokens, 604,845 estimated microusd, 112,191 ms, usage complete, exit code 0
and all finite failure counts 0.

Reports remained bounded and redacted, and production drafting remains
disabled. Milestone 8 Phase 8A is complete for this frozen profile rather than
generic AI correctness. At this closeout, Phase 8B authenticated Builder
orchestration through the existing proposal boundary was the next product
phase; the Builder UI and generic public Form submission remain unimplemented.

## ADR-027 - Qualified planning and drafting are composed through one authenticated proposal-only Builder service

**Status:** Accepted for v0.1 (Milestone 8 Phase 8B)

**Date:** 3 August 2026

### Context

The planning, drafting, compiler and proposal phases now have separate strict
server boundaries. The next composition must accept an authenticated owner's
ordinary Business request without allowing the browser or model to supply
actor identity, context, model/policy identity, trusted IDs, operations or
lifecycle instructions. It must also preserve exact currentness while keeping
the existing global production drafting registration disabled and preserving
the independent accounting model.

### Decision

- Add `src/ai/builder/` as a server-only orchestration boundary with a strict
  `{ businessId, ownerRequest }` request and frozen strict clarification,
  unsupported or proposed result variants. Request validation happens before
  context or accounting access, and public errors expose only finite
  `code`/`message` pairs.
- Load `loadAuthoritativeAiBusinessContext()` once before execution, project and
  canonically serialize the AI-safe context, and reuse that exact model value
  for both the unchanged `builder_plan_v1` input and the eligible drafting
  input. Create one authenticated `SupabaseAiAccountingService` and compose
  one `createBusinessAiExecutionOrchestrator()` with the closed Builder
  execution core.
- Execute planning once, then perform a second authoritative read. Require
  exact Business ID, actor ID, base version ID, head revision and canonical
  serialized model-context equality. A mismatch raises the Builder stale
  error, never drafts, never compiles and never retries or rebases.
- Return clarification after settled planning without drafting. Classify all
  operational, mixed and unsupported configuration-category ready plans before
  drafting. Permit only `define_object`, `define_field`,
  `define_relationship`, `configure_view`, `configure_form` and
  `configure_page` for the drafting handoff.
- Keep the global `builder_configuration_draft_v1` task mapped to
  `builder_configuration_drafting_disabled_v1`. In OpenAI mode, the private
  Builder runtime uses an unchanged planning task and a frozen drafting clone
  whose only changed property is
  `BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY`; it uses the exact
  qualified planning/drafting policies and validated configured provider. No
  evaluation code or generic registry constructor enters production.
- Reserve and settle planning and drafting as sequential independent AI
  executions. Clarification and unsupported plans create no drafting row;
  planning failures do not start drafting; drafting failures do not retry the
  full workflow. Existing timeout, bounded provider-attempt retry and
  conservative incomplete-usage behavior remain unchanged.
- Call `builderConfigurationProposalService.propose()` exactly once for an
  eligible draft. That existing service remains responsible for its two
  authoritative reads, exact supplied-context/currentness checks, one pure
  compiler call and one ordinary M5 `proposeChangeSet()` call. A successful
  Builder path therefore has exactly four authoritative context loads and
  creates only a normal `kind: change`, `status: proposed` proposal with the
  fixed title and `description: null`.
- Keep raw request, context, plan, draft, provider body and model metadata
  transient. Durable state is limited to existing metadata-only accounting rows
  and the ordinary proposal. No route, UI, migration, operational mutation or
  Validate/Apply/Publish action is added.

### Consequences

Phase 8B proves authenticated server orchestration and a proposal-only handoff
through existing primitives. It does not provide an owner-facing Builder UI,
chat history, conversational editing, generic public Form submission,
operational AI actions or automatic application. The global drafting registry
and Phase 8A qualification evidence remain unchanged; the private runtime is
the only production composition that may use the qualified drafting policy.
Phase 8C is the separate presentation and action wrapper recorded below.

## ADR-028 - Phase 8C uses an ephemeral revise-and-resubmit Builder wrapper

**Status:** Accepted for v0.1 (Milestone 8 Phase 8C)

**Date:** 3 August 2026

### Context

Phase 8B proves the authenticated planning, drafting and proposal-only
composition but intentionally leaves invocation outside the core. The first
owner-facing surface must let a non-technical Owner/Admin describe a setup in
ordinary language and recover from ambiguity without becoming a general chat
system, accepting browser-owned tenant data or introducing another mutation
boundary. Existing Changes remains the authoritative review and lifecycle
surface.

### Decision

- Add the dynamic, no-store route
  `/app/[businessSlug]/builder`, resolving the slug through the ordinary
  session client and requiring `manage_configuration`. Staff and non-members
  receive a controlled not-found result; the layout link is capability-gated.
- Bind the trusted slug into one Server Action that accepts only a trimmed,
  schema-validated `ownerRequest` within the existing 4,000-character and
  16 KiB UTF-8 limits. The action derives Business and actor identity from the
  authenticated tenant and calls `builderOrchestrationService.run()` exactly
  once. It never accepts or trusts browser Business, actor, proposal,
  operation, provider or lifecycle fields.
- Map the existing strict Phase 8B result and error contracts into a separate
  owner-facing state contract: idle, fixed invalid input, bounded
  clarification, fixed unsupported, bounded proposal summary and finite
  unavailable/stale outcomes. Strip model-local references, impact and reason
  codes at this boundary. Unknown trusted errors are rethrown.
- Keep the interaction ephemeral and controlled: one textarea, React 19
  `useActionState`, revise-and-resubmit clarification and no transcript,
  clarification persistence, client storage, query-string request state or
  request logging. GET performs no AI call or side effect.
- Expose a proposed result as only proposal UUID, summary and operation count,
  then link to the existing Changes review with `notice=builder_prepared`.
  Builder has no Validate, Apply, Publish or operational action; the existing
  Changes lifecycle remains the sole deliberate mutation boundary.
- Add no migration, table, primitive, provider registration or replacement for
  the Phase 8B core. Production drafting stays globally disabled and the
  existing proposal service remains the only proposal creation path.

### Consequences

Owners and Admins have a small safe entry point for the first Builder proof,
while Staff and non-members cannot invoke it. Clarification is intentionally
less conversational than a chat transcript: the owner edits the original
request and submits again. The route/action/UI adds presentation and invokes
the existing proposal-producing orchestration, but it does not add lifecycle
authority or durable conversational state. Future richer conversation or
automatic lifecycle behavior requires a separate architecture decision.

## ADR-029 - Builder preorder amendments use bounded model intents and trusted snapshot composition

**Status:** Accepted for v0.1 (Milestone 9 Phase 9A)

**Date:** 3 August 2026

### Context

Milestone 8 is complete through Phase 8C: an authenticated Owner/Admin can
submit an ordinary Builder request and review a proposal, while Changes remains
the deliberate Validate/Apply/Publish lifecycle. The next bounded proof is the
six required preorder amendments and the existing manual amendment families.
The generic additive drafting task and compiler must remain unchanged, and the
model must not receive configuration mutation authority.

### Decision

- Register a separate server-only `builder_preorder_amendment_v1` contract.
  Its strict input contains only the schema version, owner request, existing
  AI-safe model context, validated ready plan and server-provided preorder
  target scope. Its strict output contains one exact preorder key, a bounded list of source-referenced schedule, existing
  public-question or new Order-question intents, and an owner-readable summary.
  It contains no IDs, allocations, Field keys or positions for new Fields,
  complete configuration, operations or lifecycle instructions.
- Accept a ready plan only when it is configuration-only, contains
  `configure_preorder`, and uses only `configure_preorder` plus optional
  `define_field`. Revalidate the existing planning contract, require exact
  source-step coverage and resolve either the sole active preorder or one exact
  active stable key from the current request before checking active public
  question identity. Multiple active preorders without one exact key return
  bounded clarification. Unknown, inactive, duplicated, forged, switched,
  out-of-scope, duplicate-label and semantic no-op requests fail closed with
  finite internal diagnostics; fuzzy or best-match selection is not allowed.
- Extend the existing manual amendment boundary with one bounded batch
  composer. Manual single-intent controls and Builder intents use the same
  immutable `ConfigurationSnapshotV1` composition rules: complete preservation,
  server-derived keys and positions, independent public/global requiredness,
  deterministic append order, unique operation targets, at most one preorder
  operation and one complete Field operation per Field.
- Add a narrow server-only preorder proposal service. It derives actor and
  Business identity from the authenticated context, compares exact currentness
  and canonical AI-safe context, composes once against the first snapshot,
  reloads and compares the authoritative context again, and calls the existing
  Milestone 5 `ConfigurationChangeService.proposeChangeSet()` exactly once.
  The fixed title is `Proposed preorder changes`; the description is generated
  by the trusted composer. No validation, application, publication, abandon,
  undo or rollback preparation occurs.
- Extend the private Builder runtime with three tasks (planning, unchanged
  generic drafting and preorder amendment) and separate accounting executions.
  The global/default registry keeps the new task disabled. After the exact
  qualification and reliability gates pass, the authenticated private OpenAI
  runtime may map only its frozen amendment clone to the qualified policy. The
  qualified profile uses `gpt-5.6-terra` with explicit medium reasoning and
  policy `builder_preorder_amendment_terra_medium_v1`.
- Freeze exactly eight synthetic evaluation scenarios. The task envelope is
  256 KiB input, 80,000 billable input tokens per attempt, 4,096 output tokens,
  30 seconds and two attempts. Its one-execution reservation is 522,880
  microusd; qualification reserves 4,183,040 under a 4,300,000 ceiling, and
  reliability reserves 12,549,120 under a 12,700,000 ceiling. Live gates are
  exact opt-in, OpenAI/key-gated, database/accounting/file-free and emit only
  redacted metadata. The reviewed closeout evidence below records the exact
  successful gates.

### Phase 9A qualification closeout

The exact qualified implementation SHA was
`10e2dfe9859fa289bc5949fa5825fc6700a883a3`. The reviewed task was
`builder_preorder_amendment_v1`, using model `gpt-5.6-terra`, policy
`builder_preorder_amendment_terra_medium_v1` and explicit `medium` reasoning.

Qualification completed with 8 scenarios, 8/8 passed, 0 failed and exit code
0. It used 8 provider attempts, exactly one per scenario, with 29,948 input
tokens, 874 output tokens, 87,982 estimated microusd and 20,758 ms elapsed.
The scenarios were `phone_optional`, `remove_sunday`, `cutoff_to_72`,
`remove_sunday_cutoff_72`, `occasion_optional_short`,
`gift_message_optional_long`, `existing_question_wording_help` and
`phone_optional_and_occasion`.

Reliability completed with 8 scenarios × 3 repetitions, 24/24 passed, 0
failed and exit code 0. It used 24 provider attempts, exactly one per
execution, with 89,844 input tokens, 2,535 output tokens, 262,641 estimated
microusd and 42,174 ms elapsed. Each of the same eight scenarios passed 3/3.

Combined reviewed evidence was 32/32 live executions passed, 119,792 input
tokens, 3,409 output tokens, 350,623 estimated microusd and one provider
attempt per execution. Reports were bounded/redacted metadata only; no owner
request, Business context, model output, provider body or ID, reasoning,
credential or raw provider data was persisted. Any material change to the
model alias, policy, provider transport, task instruction, schemas, validator,
contexts, scenarios or evaluator invalidates this evidence and requires both
gates to be rerun.

The global/default registry remains disabled. The authenticated private OpenAI
Builder runtime is now enabled only for the qualified amendment mapping
`builder_preorder_amendment_v1` →
`builder_preorder_amendment_terra_medium_v1`; planning and generic drafting
mappings remain unchanged. Phase 9A still does not complete Milestone 9.

### Consequences

Phase 9A produces one ordinary proposed Change and leaves the live preorder,
Records, Locations and all runtime operation unchanged until the existing
Changes lifecycle is deliberately used. Generic configuration drafting,
planning subjects and context projection remain unchanged. Phase 9A does not
implement undo, operational AI actions, generic configuration editing, clean
Business bootstrap or public Form work. Milestone 9 is not complete.

## ADR-030 - Builder-assisted latest configuration undo uses trusted version context and deterministic parent derivation

**Status:** Accepted for v0.1 (Milestone 9 Phase 9B implementation)

### Context

After an Owner/Admin applies an ordinary configuration change, the product
needs a bounded way to ask for the immediately preceding setup without turning
Builder into a history search or giving a model rollback authority. The
existing Changes lifecycle and forward-only rollback engine already provide
the required proposal, preview, validation, application and provenance
semantics. The missing boundary is a trusted contextual handoff from the
latest applied result into that engine.

### Decision

- The contextual Builder URL is
  `/app/[businessSlug]/builder?undoVersion=[activeVersionId]`. The query value
  is untrusted routing context and is always reloaded through the authenticated
  Business-scoped configuration service.
- “That” means the ordinary `change` Version represented by the contextual
  active head. The server proves the source Version ID and version number equal
  the active head, requires an eligible immediate parent, and derives the
  rollback target only from `parent_version_id`. The browser supplies no target,
  parent, Business, actor, head revision, metadata, candidate or lifecycle
  value.
- Active baseline, active rollback, missing-parent, historical/superseded,
  malformed, cross-Business and inconsistent sources cannot prepare a
  contextual proposal. Deliberate historical `Prepare rollback` remains
  available in Changes.
- The contextual panel displays the source Version, safely verified source
  proposal title when available, `Undo that.`, the operational-data boundary
  and the proposal-only lifecycle warning. Its dedicated deterministic action
  calls the existing `ConfigurationChangeService.prepareRollback()` boundary;
  it does not call Builder orchestration, a model, a provider registry or AI
  accounting.
- The sole rollback preparation RPC now requires the expected active source
  Version ID and expected head revision. It compares both under the existing
  Business-head lock, using the existing stale/state-changed taxonomy, and the
  weaker overload is revoked and dropped. Manual Changes rollback passes the
  same expected currentness values.
- A successful contextual action creates exactly one ordinary
  `kind: rollback`, `status: proposed` Change. Builder redirects to the
  existing Changes proposal detail. Validate and Apply remain deliberate
  Changes actions; applying later creates a new forward rollback Version whose
  parent is the previously active source Version and whose provenance points
  to the server-derived historical target.
- A normal Builder submission matching only `Undo that`, with no trusted
  contextual source, returns fixed guidance to open the latest applied Change
  or active Version. It does not search history, invoke a model or guess a
  Version.
- Configuration rollback remains configuration-lane only. Orders, Customers,
  Products, Locations, Records, Relationships, preorder submissions, counters,
  email state, AI settings and audit are not restored or mutated.

### Consequences

Phase 9A remains frozen: its `builder_preorder_amendment_v1` subject, qualified
policy, schemas, validator, runtime mapping, evaluation contexts and evidence
are unchanged. Phase 9B introduces no model task, provider profile,
qualification scenario, table, primitive, conversation persistence or history
search. Configuration-lane Builder work still prepares proposals only and the
existing Changes lifecycle remains the sole deliberate configuration
validation/application boundary; Phase 10A is the separately documented
operational Location path.

Phase 9B is implemented and merged, so Milestone 9 is complete. Product v0
remains in progress; Phase 10A is the next independently reviewable operational
Builder slice.

## ADR-031 — Builder-assisted Location creation uses bounded operational intent and explicit deterministic confirmation

Milestone 9 is complete and merged. Milestone 10 begins with Phase 10A,
which remains independently reviewable and is not claimed as merged until its
implementation is reviewed. Location is a first-class platform primitive;
business-created concepts continue to use metadata graph Objects and Records.

Planning remains non-executing. An exact one-step operational
`create_location` plan enters the separate
`builder_location_creation_intent_v1` task. Its output is pure transient intent
with no IDs, slugs, lifecycle instructions or mutation authority. The server
revalidates the plan, applies the explicit-IANA or authoritative
Business-timezone rule, reads a canonical operational currentness digest and
requires explicit owner confirmation before calling the trusted Location
service.

The confirmation is a versioned, 15-minute HMAC-SHA-256 token bound to the
authenticated Business and actor. It contains the interpreted name, resolved
timezone, timezone source, Business timezone, state digest and issued/expiry
times, but no UUID or slug. The final confirmation performs no AI call,
provider invocation or accounting reservation. The shared server-only Location
service is used by both manual and Builder creation; manual update and
deactivation remain manual-only.

PostgreSQL is authoritative for Location identity through one immutable
`private.normalize_location_name(value)` function: NFKC normalization,
surrounding whitespace trim, then lower casing with the explicit locale-neutral
`und-x-icu` collation. The same function is used by migration preflight, the
tenant-scoped unique index, bounded state summaries and duplicate lookup; the
application helper is parity-tested against the database-derived normalized
value. Active and inactive identities remain reserved. PostgreSQL also remains
authoritative for exact IANA timezone validity, server-derived slugs and
Business-row serialization of Location writes. The digest covers the Business
timezone and complete deterministically ordered Location collection. There is
no M5 proposal/version, Changes entry, configuration rollback or operational
undo for this action. Mixed configuration/operational requests, Product/Record
work and generic operational actions remain unsupported; no generic operational
action registry is introduced.

The timezone policy is neutral rather than geographic: an exact valid IANA
value copied from the owner request may be selected; otherwise the current
Business timezone may be used. Generic local/different-timezone wording without
an exact IANA value requires clarification. No city/country/region list,
geocoding, timezone lookup or external API is used.

The Location-intent task has an independent disabled policy and a
private-runtime-qualified Terra policy. Its provider-backed qualification is frozen to exactly eight
task-valid scenarios (including exact active/inactive duplicates, generic
timezone clarification and a multi-word identity such as New York with an
existing York Location). Mixed Location/preorder plans, Location updates and
deactivation are deterministic pre-provider routing cases: they must not invoke
the intent task or reserve intent accounting. The live harness validates the
task/policy/model/reasoning/envelope before provider construction, uses actual
reported usage for aggregate cost, preserves bounded failure usage and stops on
the first failure. It reports finite failure classes and remains separately
gated. The private Builder mapping was disabled until deterministic tests,
exact-head non-live CI, 8/8 qualification and 24/24 reliability evidence were
reviewed; the accepted closeout below records the resulting private-runtime
enablement. Product v0 remains in progress.

The first reviewed qualification attempt was run once against exact candidate
SHA `27f2c122f08ddc52f417bc60861f164bc96f8edd`. It passed
`explicit_timezone`, `business_timezone` and `alternate_wording`, then stopped
on `active_duplicate`: 3 passed, 1 failed, 4 attempts, 12,737 input tokens, 263
output tokens, 35,788 estimated microusd, 7,703 ms and exit code 1. The bounded
failure was `ai_output_invalid`. Because raw model output is intentionally
unavailable, the diagnosis is limited to the clear contract mismatch: the
validator required exact active/inactive duplicates to clarify, while the
server-owned instruction did not state that rule. The correction explicitly
requires clarification for exact normalized active or inactive duplicates and
forbids ready, rename, numeric-suffix, update or reactivation behavior, while
retaining exact rather than fuzzy or substring identity. The validator and
Location-intent input/output schemas remain unchanged; only the evaluation
report schema gains a finite redacted invalid-output reason. Reliability was
not run after this first failed qualification, and every production runtime
mapping remained disabled.

Qualification was later run against exact SHA
`372bff1276ec430124bab546d33488c4c63b6250` and passed all 8/8 scenarios in the
frozen order: 8 provider attempts, 26,387 input tokens, 703 output tokens,
76,515 estimated microusd, 29,411 ms and exit code 0. Reliability then ran
against the same SHA. Its first 15 executions passed before
`multi_word_identity`, repetition 2, failed with output state `ready`, timezone
intent `use_business_timezone`, failure class `scenario_expectation`, failed
gate code `expected_name`, one attempt, complete usage, 3,319 input tokens, 134
output tokens, 10,308 estimated microusd, 2,660 ms, no execution error code and
no semantic-validation reason code. The stopped reliability aggregate had 15
passed executions and 1 failed execution, 52,774 input tokens, 1,551 output
tokens, 155,205 estimated microusd, 38,728 ms and exit code 1. It correctly
reported no scenario at 3/3 because execution stopped during repetition 2.

Raw model output was intentionally not retained, so the hidden returned name
is unknown and is not claimed. The frozen owner request
`Open a New York Location.` admitted more than one plausible request-contained
name boundary, including `New York` and `New York Location`, while the exact
expected name remained `New York`. Exact-name evaluation remains unchanged.
The eighth `multi_word_identity` fixture retains the active `York` context,
expected `New York` name, Business-timezone intent and frozen position, but now
uses the explicit request `Create a new Location called New York.`

The corrected subject was then run without changing its task, instruction,
schemas, validator, scenarios, evaluator, model, policy parameters, limits,
pricing or provider transport. The first reliability attempt on this exact
subject passed 16 executions before execution 17 failed at
`explicit_timezone`, repetition 3, with `provider_execution` / `ai_timeout`,
30,030 ms elapsed, incomplete usage and zero input/output tokens. Its stopped
aggregate was 52,778 input tokens, 1,488 output tokens, 154,270 estimated
microusd, 77,651 ms and exit code 1. This remains historical evidence.

The final accepted qualification ran against exact SHA
`0598068617f25e541ef49cde50aea307dc98047e` and passed 8/8: 8 attempts,
26,389 input tokens, 700 output tokens, 76,475 estimated microusd, 23,479 ms
and exit code 0. The final accepted reliability rerun against the same exact
SHA passed all 24 executions: 8/8 scenarios, every scenario 3/3, 24 attempts,
79,167 input tokens, 2,145 output tokens, 230,100 estimated microusd, 48,334
ms and exit code 0. Every successful report had complete usage, one attempt,
no failure class, no failed gate codes, no execution error and no semantic
validation reason.

The successful reliability rerun supersedes the isolated timeout for
acceptance; the timeout remains recorded as historical evidence. The
`builder_location_creation_intent_v1` task, instruction, schemas, validator,
scenarios, evaluator, model, reasoning effort, policy parameters, token
limits, timeout, retries, pricing and provider transport were unchanged
between qualification and reliability. After exact-head CI passed, the
private authenticated OpenAI Builder runtime is enabled only through
`builder_location_creation_intent_terra_medium_v1`; the global/default task
and disabled runtime remain on
`builder_location_creation_intent_disabled_v1`. This enablement commit changes
only that private runtime binding, its assertions, and evidence documentation;
it is not itself live-qualified. Phase 10A is implemented, qualified and
enabled in the private runtime, but remains unmerged pending final review.
