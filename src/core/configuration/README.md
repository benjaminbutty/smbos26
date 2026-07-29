# Versioned configuration

The configuration engine is the only normal production boundary for changing
Objects, Fields, Relationships, Views, Forms, Pages and preorder configuration.
The AI and future owner controls may plan or request allow-listed operations;
PostgreSQL materialises, validates and applies them deterministically.

## Read model

Milestone 5 Phase 5A exposes a read-only Owner/Admin presentation over the
existing authenticated service:

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
never accepted from the browser.

The UI treats stored `semantic_diff_json` and `validation_result_json` as
immutable engine outputs. A non-baseline version reuses its source proposal
diff. Snapshot detail shows bounded collection counts and does not create
another snapshot or diff algorithm.

## Phase 5A routes

- `/app/[businessSlug]/changes`
- `/app/[businessSlug]/changes/[changeSetId]`
- `/app/[businessSlug]/changes/versions/[versionId]`

They are dynamic, no-store server routes protected by authenticated membership
and `manage_configuration`. Staff, anonymous callers, malformed identifiers
and cross-Business identifiers receive controlled denial/not-found handling.

Phase 5A contains no lifecycle or configuration mutation controls. Phase 5B is
responsible for explicit validate, apply, abandon and rollback-preparation
actions through trusted server actions; it must not introduce direct table DML.
