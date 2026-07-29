# Configuration mutation boundary

Milestone 5 Phase 3B makes the versioned change-set engine the only normal
production path for changing graph, experience, or preorder configuration.
This inventory records the repository paths examined and their final
classification.

## Versioned projection tables

The boundary covers:

- `object_definitions`
- `field_definitions`
- `relationship_definitions`
- `views`
- `forms`
- `pages`
- `preorder_experiences`
- `preorder_experience_locations`

For all eight tables, `anon`, `authenticated`, and `service_role` have no
direct `INSERT`, `UPDATE`, or `DELETE` privilege. The former Owner/Admin insert
and update policies, plus preorder allowed-Location insert/update/delete
policies, are removed. Authenticated users retain `SELECT`, constrained by the
existing membership RLS policies, because generated workspaces need the live
projection. Anonymous users retain no table access.

Classification: **close direct mutation; runtime read only**.

## Database functions

| Surface | Final classification |
| --- | --- |
| `propose_configuration_change`, `prepare_configuration_rollback`, `validate_configuration_change`, `apply_configuration_change`, `abandon_configuration_change_set` | Sole authenticated Owner/Admin configuration mutation lifecycle |
| `list_configuration_change_sets`, `get_configuration_change_set`, `list_configuration_versions`, `get_configuration_version` | Owner/Admin history reads |
| `load_configuration_preview` | Authenticated Owner/Admin identifier-only read; replays and verifies an open candidate against the current head without lifecycle or projection writes |
| `resolve_configuration_preview_preorder` | Authenticated Owner/Admin read of candidate configuration joined to current operational Product, price, Location-link and counter state |
| `create_preorder_experience`, `set_preorder_experience_locations` | Retained only for historical migration compatibility; execution revoked from `public`, `anon`, `authenticated`, and `service_role` |
| Candidate materialiser, rollback candidate derivation, replay dispatcher, semantic diff, projector, validation sandbox, preview assertion, preorder catalogue assembler, projection/head assertions, and change/version/head protection helpers in `private` | Engine internals; application-role execution revoked |
| `resolve_public_page`, `resolve_public_preorder` | Narrow anonymous runtime reads; no table access |
| Graph Record and Record Relationship RPCs | Operational and outside configuration versioning |
| Record-to-Location link RPCs | Operational and outside configuration versioning |
| Public preorder submission and confirmation-email state RPCs | Trusted operational transaction boundary; not configuration mutation |
| Business and Location lifecycle RPCs | Platform/operational lifecycle; Location versioning is out of scope |
| AI settings read/update, UTC-day summary and latest-50 audit RPCs | Owner/Admin platform-accounting boundary; not configuration mutation |
| AI budget reserve/settle RPCs | Service-role-only accounting lifecycle; no configuration-table access or grant |

No generic private-function proxy exists. The migration also revokes the
`public` default execute privilege for future functions created by `postgres`
in the `private` schema.

## Application and tooling paths

| Path | Final classification |
| --- | --- |
| `src/core/configuration/service.ts` | Structured M5 lifecycle, history and authenticated verified-candidate preview loading only |
| `src/core/configuration/definition-source.ts` | Read-only live/snapshot configuration lookup abstraction; no mutation methods |
| `src/core/graph/service.ts` | Configuration reads plus operational Record/edge writes |
| `src/core/experience/service.ts` | Configuration reads only |
| `src/core/preorder/service.ts` | Live runtime resolution/submission/email state plus authenticated identifier-only preview resolution; no configuration mutation |
| `src/ai/accounting/service.ts`, `src/ai/business-execution.ts` | Server-only per-Business accounting/orchestration; may reserve and settle only `business_ai_settings` and `ai_execution_runs`; imports no configuration mutation service |
| `src/core/configuration/rendered-preview.ts` | Server-only composition of a verified snapshot with existing experience/preorder reads; no mutation methods |
| `src/app/app/[businessSlug]/changes/actions.ts` | Sole UI lifecycle action boundary; session-derived Business/actor context, identifier/status rechecks, calls only `ConfigurationChangeService`, bounded notices and POST/redirect/GET |
| `src/components/configuration-history-ui.tsx`, `src/components/configuration-action-ui.tsx` | Owner-readable proposal, diff/validation, confirmation and immutable version presentation; links/forms only and no lifecycle service call |
| Confirmation routes under `src/app/app/[businessSlug]/changes` | Dynamic no-store Owner/Admin GETs that re-read authoritative proposal/version/head state and bind narrowly named Server Actions; rendering performs no mutation |
| Other server routes/actions under `src/app` | Operational preorder endpoint, live runtime reads, or authenticated read-only candidate preview; no configuration DML |
| `scripts/demo-seed.mjs` | Local-only; installs Bedford through propose → validate → apply, then seeds operational data |
| `tests/integration/support/configuration-fixtures.ts` | Local/test-only database-owner fixture for M1–M4 integrity setup |
| Explicit tamper/failure-injection tests | Test-only privileged diagnostics; never production setup |

The source regression test scans `src/` for direct DML against every versioned
table and calls to the two revoked legacy RPCs. Database tests separately
verify catalogue privileges, RLS policy removal, actual PostgREST denial for
all application roles, private/legacy function denial, and the exact public
configuration-function allow-list.

The Phase 5B source regression proves lifecycle calls occur only in the
dedicated action/service boundary; presentation and confirmation GETs contain
no lifecycle calls, direct DML, generic RPC or privileged client. Action tests
prove submitted Business/actor/candidate/operation/checksum/status values are
ignored, while database-backed tests exercise Owner/Admin, Staff, anonymous,
cross-Business, malformed, stale and concurrent submissions through the actual
Server Actions.

Milestone 6 Phase 1B treats AI limits and execution audit as platform/account
state, not versioned Business configuration. `business_ai_settings` and
`ai_execution_runs` are outside the eight projection tables and have no direct
application-role grants, including for `service_role`. Their narrow accounting
RPCs do not invoke proposal, validation, application, rollback or operational
Record mutation. The M5 direct-DML denials and mandatory
propose → validate → apply boundary are unchanged.

## Phase 5A read authorization

The Changes and Version history routes resolve the immutable Business slug
through the authenticated session, verify current membership, then require the
fixed `manage_configuration` capability. Owner and Admin have that capability;
Staff do not see the navigation entry and receive controlled not-found if they
address a route directly. Identifier RPCs always combine the route-derived
Business UUID with the requested proposal/version UUID, so another Business's
identifier cannot reveal whether a row exists.

Overview RPCs are bounded to the latest 50 rows. Proposals use stable
`created_at DESC, id DESC` ordering and versions use
`version_number DESC, id DESC`. Candidate/snapshot data is never accepted from
query parameters, request bodies or browser state.

## Phase 5B action authorization and write scope

Lifecycle forms submit genuine POST requests through Next Server Actions.
Loading an overview, detail, version, confirmation or preview route never
mutates state. The action module creates only a cookie/session Supabase client;
it contains no service-role/admin client, direct versioned-table DML or generic
RPC invocation.

Validation, application and abandonment accept no form-owned lifecycle data.
Rollback accepts only a schema-validated title and optional description. The
route slug, proposal/version identifier and rollback confirmation's expected
head are all treated as untrusted, parsed, re-resolved and compared with the
current database rows immediately before the trusted service call.

Known lifecycle outcomes become one bounded owner-safe notice. Stored
validation errors remain the authoritative owner-readable detail. Database
connectivity, malformed trusted output, replay mismatch, projection/head
inconsistency and programming defects are rethrown rather than hidden.

Validation, abandonment and rollback preparation change no active projection,
head, version or operational table. Application changes only the normalized
configuration projection, one immutable version, the active head and its
source proposal lifecycle. Records, Record Relationships,
Record-to-Location links, preorder submissions, capacity counters and email
state remain outside the configuration lifecycle. Database locks and
idempotent applied retries—not the disabled browser button—provide concurrency
correctness.
