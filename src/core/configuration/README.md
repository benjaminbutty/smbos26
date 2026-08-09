# Versioned configuration

The configuration engine is the only normal production boundary for changing
Objects, Fields, Relationships, Views, Forms, Pages and preorder configuration.
The AI and future owner controls may plan or request allow-listed operations;
PostgreSQL materialises, validates and applies them deterministically.

## Read model and lifecycle actions

Milestone 5 Phase 5A established the read-only Owner/Admin presentation over
the existing authenticated service:

- `listChangeSets()` returns the latest 50 proposals in stable
  `created_at DESC, id DESC` order.
- `listVersions()` returns the latest 50 immutable versions in stable
  `version_number DESC, id DESC` order.
- `getChangeSet()` and `getVersion()` are tenant-scoped identifier reads.
- `getActiveHead()` reads the RLS-protected active version pointer.
- `loadPreview()` accepts only a proposal identifier and is used only for an
  open proposal detail. PostgreSQL replays and verifies the stored candidate
  before active candidate Pages are exposed.

All calls use an authenticated session client. The Business UUID and actor UUID
come from the resolved route tenant context; candidate or snapshot JSON is
never accepted from the browser. Ordinary proposal creation also requires the
exact active version ID and head revision against which its strict operations
were composed. PostgreSQL compares both while holding the Business head lock.

The UI treats stored `semantic_diff_json` and `validation_result_json` as
immutable engine outputs. A non-baseline version reuses its source proposal
diff. Snapshot detail shows bounded collection counts and does not create
another snapshot or diff algorithm.

## Manual internal lists

Owner/Admin Setup exposes `/app/[businessSlug]/setup/lists/new` as a bounded
configuration entry point for a simple internal list. The server reloads the
active immutable snapshot, composes only existing M5 operations, and creates
one ordinary proposed Change. Preview, Validate, and Apply remain deliberate
Changes actions; the form never writes projection tables or operational
Records directly.

The list composer is pure and independent of AI. It derives Object, Field,
Form, View, and Page identities with the shared deterministic allocator, and
emits no Relationships, preorder configuration, public Pages, or workflows.
After application, generic experience Forms, Table Views, and inline Record
editing provide the runtime surface. Those Record writes remain outside
configuration history.

Phase 5B adds one dedicated `actions.ts` module under the Changes route. Its
four narrowly named Server Actions resolve the session user and Business slug,
require `manage_configuration`, derive Business and actor UUIDs server-side,
parse and re-read route identifiers, call only `ConfigurationChangeService`,
inspect the returned lifecycle state, and revalidate affected paths before
POST/redirect/GET.

Forms never provide Business UUID, actor UUID, candidate snapshot, operations,
checksum, allocations, semantic diff, validation result, desired status or
applied version identity. Rollback preparation accepts only its bounded title
and optional description; the target version and render-time head identity are
server-bound untrusted arguments that are parsed and rechecked.

## Direct Table Workspace

Milestone 15 Phase 15A adds `direct-tables/` as a bounded owner-facing facade
over the existing M5 engine. It composes only finite Table actions and strict
existing configuration operations from an immutable snapshot. Its two public
RPCs are atomic wrappers around M5; they do not add a second projector,
operation language or persistence model. Direct Undo is limited to the active
direct change's immediate parent. `column_widths` is an optional validated
Table View layout map, not a new primitive.

## Owner/Admin routes

- `/app/[businessSlug]/changes`
- `/app/[businessSlug]/changes/[changeSetId]`
- `/app/[businessSlug]/changes/versions/[versionId]`
- `/app/[businessSlug]/changes/[changeSetId]/validate`
- `/app/[businessSlug]/changes/[changeSetId]/apply`
- `/app/[businessSlug]/changes/[changeSetId]/abandon`
- `/app/[businessSlug]/changes/versions/[versionId]/rollback`
- `/app/[businessSlug]/setup`
- `/app/[businessSlug]/setup/preorder/[preorderKey]`

They are dynamic, no-store server routes protected by authenticated membership
and `manage_configuration`. Staff, anonymous callers, malformed identifiers
and cross-Business identifiers receive controlled denial/not-found handling.

Every confirmation GET is read-only. Proposed supports Preview, Validate and
Abandon; validated supports Preview and Apply; applied links to its resulting
Version; rejected, conflicted and abandoned have no mutation control. Only
historical versions offer rollback preparation. The UI is advisory and every
Server Action repeats the same current-state check.

Phase 2A.1 adds one bounded proposal-creation UI for preorder schedule
amendments. Its server-only composer reads the active immutable snapshot,
preserves every non-schedule property and active Location association, rejects
no-ops and creates only an ordinary proposal. There is still no raw operation
editor, general manual builder, natural-language builder, AI integration,
automatic validation/application, automatic merge/rebase or permanent
demonstration proposal.

## Milestone 9 Phase 9B Builder-assisted undo

The configuration-owned Builder undo boundary is deterministic and
server-only. The contextual source is the untrusted active Version ID in
`/app/[businessSlug]/builder?undoVersion=[activeVersionId]`. The service
reloads the tenant-scoped active head and source Version, requires an ordinary
active `change`, loads its immediate parent, and verifies any applied source
Change provenance. It never accepts a browser-supplied target or parent.

The dedicated Builder action calls the existing rollback preparation method
with expected active-source and head-revision values. PostgreSQL compares those
values under the existing head lock, and a mismatch creates no proposal. A
successful request creates only a proposed forward rollback and hands it to
Changes; validation and application remain deliberate Changes actions.

Baseline, active rollback, historical/superseded, malformed and cross-Business
contexts are bounded ineligible/not-found states. `Undo that` without trusted
context is fixed guidance, not a history search. Configuration rollback leaves
operational Records, Relationships, Locations, Orders, Customers, Products,
preorder submissions, counters and email state untouched.
