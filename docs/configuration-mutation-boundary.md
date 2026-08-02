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
| `propose_configuration_change`, `prepare_configuration_rollback`, `validate_configuration_change`, `apply_configuration_change`, `abandon_configuration_change_set` | Sole authenticated Owner/Admin configuration mutation lifecycle. Ordinary proposal creation requires the exact expected active version and head revision. |
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
| `src/core/configuration/builder-context-source.ts` | Authenticated read-only Business context source; session-derived actor, current membership/capability, tenant Business/Location rows and active immutable version only |
| `src/ai/context/` | Pure strict model-facing projection and safe errors; no database client, provider, execution/accounting service, configuration mutation service or I/O |
| `src/ai/planning/` | Strict non-executing planning schemas, instruction, semantic validation and authenticated composition; may read authoritative context and use AI accounting/execution, but exposes no configuration lifecycle or operational mutation method |
| `src/ai/configuration-drafting/` | Pure server-owned untrusted additive configuration-intent schemas, fixed instruction, semantic validation and production-disabled task registration; no database/provider/accounting/lifecycle dependency and no M5 operation generation |
| `src/core/configuration/draft-compiler/` | Pure server-owned Phase 1B compiler from a validated draft plus immutable snapshot to strict additive M5 operations; revalidates existing references and derives deterministic keys/slugs/positions; no UUID/currentness/proposal, database/provider/route/UI or mutation dependency |
| `src/ai/configuration-proposal/` | Authenticated server-only Phase 2 handoff with first/second exact-currentness and canonical-context checks, one pure compiler call and exactly one M5 `proposeChangeSet`; no lifecycle, provider, persistence, route/UI or operational DML |
| `src/core/configuration/rendered-preview.ts` | Server-only composition of a verified snapshot with existing experience/preorder reads; no mutation methods |
| `src/app/app/[businessSlug]/changes/actions.ts` | Sole UI lifecycle action boundary; session-derived Business/actor context, identifier/status rechecks, calls only `ConfigurationChangeService`, bounded notices and POST/redirect/GET |
| `src/core/configuration/manual-amendments/` | Server-only bounded owner-intent parsing and complete strict operation composition from an immutable active snapshot; no direct DML, lifecycle progression, AI or operational mutation |
| `src/app/app/[businessSlug]/setup` | Dynamic no-store Owner/Admin schedule and preorder-question setup reads with narrowly named proposal-preparation Server Actions; proposed-only and no mutation on GET |
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

Milestone 7 Phase 1A adds no mutation surface to this boundary. Its
`builder_configuration_draft_v1` result is transient, untrusted additive
intent only. It contains plan-local references for new definitions and exact
active context keys for existing definitions, but no trusted IDs, stable-key
allocations, positions, defaults, active/publication state, M5 operations,
candidate, proposal or currentness. The task remains mapped to the disabled
provider even in OpenAI server mode. Phase 1B is the separate pure compiler
boundary: it consumes a server-supplied immutable snapshot, revalidates
existing references, reserves active and archived identities and emits only
strict additive M5 operations. It creates no UUID, expected-head metadata,
candidate, proposal or lifecycle transition. M5 later allocates trusted IDs
while materialising a proposal candidate. Phase 2 now supplies the
authenticated, exact-currentness handoff and fixed proposal metadata, but only
calls the ordinary M5 proposal method once. It reloads and canonically compares
context before compilation and again before proposal creation, persists no raw
handoff data, and adds no lifecycle, provider, route or UI surface.

Public Form/Page intent in this draft is not a public runtime capability. The
current PostgreSQL resolver remains limited to static published Pages, the
public renderer does not expose generic public Form submission, and generic
Form submission currently creates or updates one internal Record without
Relationship controls. No migration, route, UI, DML or operational mutation
was added for Phase 1A.

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

Milestone 6 Phase 2A.1 replaces the old five-argument ordinary proposal RPC
with one seven-argument signature. After authentication, actor and current
Owner/Admin membership checks, PostgreSQL takes the existing shared Business
head lock and compares both `active_version_id` and `head_revision` with the
caller-supplied currentness values. A mismatch raises
`configuration_proposal_stale` before loading or materialising the base and
inserts nothing. The old overload is revoked and dropped.

The manual preorder editor accepts only the tenant-scoped preorder stable key,
expected-head comparison values and schedule controls. It resolves Business and
actor from the authenticated session, reloads and parses the expected immutable
version, preserves graph keys, mappings, public Fields, Location associations
and activation from that snapshot, validates the complete existing operation
schema, rejects semantic no-ops and calls only `proposeChangeSet()`. Browser
values for Business/actor identity, metadata, operations, mappings, Fields,
Locations, activation, candidate, checksum, diff, validation or status are not
read. The result remains `proposed`; preview, validation and application are
the existing M5 implementations.

Milestone 6 Phase 2A.2 adds `update_preorder_question` and
`add_preorder_question` to the same manual boundary. Existing-question actions
bind preorder, target and Field key from the route and accept only expected
head, wording, optional help and journey-level requiredness from the form. New
question actions bind the preorder from the route and accept only expected
head, wording, optional help, short/long answer style and journey-level
requiredness. They never accept an Object or Field key.

Both composers reload the immutable active snapshot. Existing questions must
resolve uniquely through the preorder public mapping to one active configured
Object and Field. Public wording is changed only in preorder channel
configuration. Making a question optional emits a complete `set_field` only
when an underlying Field constraint must be relaxed; making it required for
one preorder never makes the generic Field globally required. New questions
become globally optional short/long-text Fields on the configured Order Object,
with a deterministic server-derived non-colliding key and next position, plus
one preserved complete preorder operation that appends the public question.
Archived keys are collision inputs and are never restored.

No-op edits, duplicate public labels, invalid identities and stale forms create
no proposal. A successful submission creates one ordinary proposed change set
only. Candidate preview, validation and deliberate application remain M5;
operational Records and Relationships change only through their existing
runtime boundaries, including when a later public preorder stores a new answer
on an ordinary Order Record.

Milestone 6 Phase 3A adds no configuration mutation surface. Its authenticated
source loader uses only ordinary session/RLS reads for the current Business,
membership, active and inactive Locations, configuration head and active
immutable version. It does not read normalized live configuration tables
independently. The pure projector receives the parsed snapshot in memory and
has no mutation, provider, accounting or database dependency.

The server-only result keeps exact active-version/head currentness outside the
strict schema-v1 model context. Configuration UUIDs, actors, checksums,
timestamps, operational Records/Relationships/Location links, PII, proposals,
candidates, diffs, validation and AI audit are excluded. Location UUIDs are the
only opaque model-facing database references. Canonical ordering and a 128 KiB
hard limit apply before any future provider boundary; Phase 3A makes no
provider call, reservation, audit row, proposal or lifecycle transition.

Milestone 6 Phase 3B adds no configuration mutation surface. Its registered
task receives only a bounded owner request and the exact Phase 3A model
context. Planning steps use descriptive category enums and are neither tools
nor M5 operations. The planning service imports no
`ConfigurationChangeService`, graph/preorder mutation service or Location
mutation boundary and cannot propose, validate, apply, abandon, roll back,
publish or mutate operational data.

The generic execution core invokes a pure server-owned semantic validator after
strict output parsing and before successful settlement. The planning validator
checks plan-local identity, current Object/Location references, ordered
dependencies, change lanes and the supplied capability registry. The service
then reloads authoritative context and discards a known-stale result without
creating a proposal. Owner requests, context and plans remain in memory; only
the existing metadata-only execution reservation and settlement are durable.

Milestone 6 Phase 4A preserves that boundary while adding the first opt-in
external provider. The OpenAI adapter receives only the registered planning
instruction, deterministic URL-minimised task input, strict adapted output
schema, fixed model/token limit and abort signal. It receives no configuration
or operational service, tool, actor/Business/version identity, conversation
state or mutation authority.

Server mode defaults to disabled; `openai` additionally requires a server-only
key, and the existing per-Business `is_enabled` check still occurs before
reservation/invocation. Responses use `store: false`; SMBOS stores no request
or response, while the existing metadata-only reservation/audit remains the
sole durable provider-adjacent state. Refusal and incomplete responses settle
failed with reported usage. No route, Server Action, UI, proposal, lifecycle
progression, projection write, operational mutation, migration, table or
primitive is added.

Milestone 6 Phase 4B.1 keeps the engineering evaluation harness around the
unchanged provider-neutral planning execution path and adds only bounded
structural/semantic diagnostics plus least-change instruction rules. It uses a
code-owned strict synthetic context and fixed in-memory owner requests,
imports no database or configuration/operational service, and creates no
Business accounting row, proposal, candidate, validation/application action,
configuration projection, Record, Relationship or Location. Source-boundary
tests keep evaluation code out of application routes, Server Actions and
client modules. The harness prints only bounded redacted metadata and persists
no result; public errors and accounting remain unchanged.

Milestone 6 Phase 4C replaces only the trusted execution profile with the
code-owned `gpt-5.6-terra` alias, explicit medium reasoning and
`builder_planning_terra_medium_v1` audit-policy identity. Planning instruction,
schemas, semantic validation, diagnostics, synthetic context, owner requests
and deterministic gates remain frozen. The two engineering-only live gates use
only synthetic in-memory configuration and the existing provider-neutral
execution core; they import no database client, accounting/orchestration,
configuration or operational service, and create no tenant state. They have no
route, Server Action, UI or client import. Their bounded redacted output is
ephemeral and includes no request/context/plan/reasoning content. The first
eight-call qualification and deliberate three-round reliability gate are not
configuration mutations; operation generation remains blocked until reviewed
24/24 reliability evidence exists.

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
