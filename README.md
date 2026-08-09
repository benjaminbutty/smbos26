# SMBOS

SMBOS is an AI-native operating system for small physical businesses. The
repository currently contains the Milestone 4 vertical slice, the Milestone 5
Phase 5B explicit Changes lifecycle interface, the Milestone 6 Phase 4C
Terra-medium planning qualification and reliability gate, and the engineering-
only Milestone 8 Phase 8A drafting qualification/reliability gates after
bounded real-model
planning diagnostics, deterministic manual setup amendments,
data-minimised Business context and strict non-executing Business-request
planning, plus Milestone 8 Phase 8B authenticated server-only Builder
orchestration, the minimal Milestone 8 Phase 8C authenticated Owner/Admin
Builder surface, and bounded Milestone 9 Phase 9A Builder-generated preorder
amendments: a
multi-location bakery preorder capability over the tenant-safe graph and
experience runtime whose configuration is installed, previewed and explained
through immutable change sets and forward-only versions, with deliberate
Owner/Admin validation, application, abandonment and rollback preparation.
Milestone 9 is complete and merged at the current repository head. Milestones
10, 12 and 13, together with Milestone 14 Phase 14A, are also merged at the
current repository head. Milestone 15 Phase 15A is the current unmerged direct
Table Workspace foundation work on this branch.
The AI execution boundary is server-only and per-Business accounting is
disabled by default. OpenAI Responses is the first external adapter, but it is
also server-disabled by default; the Phase 8C route does not invoke providers
unless the existing server-side gates allow the request.

The product and architecture sources of truth are:

- [`docs/SMBOS-v0.1-Build-Spec.md`](docs/SMBOS-v0.1-Build-Spec.md)
- [`docs/architecture-decisions.md`](docs/architecture-decisions.md)
- [`docs/configuration-mutation-boundary.md`](docs/configuration-mutation-boundary.md)
- [`AGENTS.md`](AGENTS.md)

Milestone 12 is complete and merged at the current repository head. Phase 12A
generic Record creation is merged through PR #17. Phase 12B adds one bounded
generic Builder path for an exact-selector Record update, and Phase 12C adds
one deterministic manual and bounded Builder path for linking or unlinking an
eligible generic Record at an existing Location. Both preserve the operational
boundary: PostgreSQL resolves targets, the final writes are AI-free, and no
configuration Version, Change, history or undo is created. Their qualified
private Builder mappings remain isolated from the global/default task registry;
the earlier failed Phase 12C qualification remains historical evidence.

Milestone 13, including Phase 13B, is complete and merged. Phase 13A adds an
Owner/Admin-triggered initial preorder starter
to the existing Edit setup surface. A clean Business with active Locations
can supply only collection Locations and schedule values, review one ordinary
M5 proposed Change, then deliberately Validate and Apply it. The deterministic
production composer creates neutral Customer, Product, Order and Order Item
configuration, useful Product and Order surfaces, the trusted preorder
experience and a draft public Page. It creates no Product Records or
availability links; after Apply, the owner can add the first Product through
the normal generic Record-create surface. Product availability and publication
remain separate, and Product v0 remains in progress.

Phase 13B adds the deliberate Owner/Admin
publication handoff to the same Edit setup surface. SMBOS reloads the current
public preorder Page, composes one complete `set_page` operation that changes
only its availability, and prepares one ordinary M5 proposed Change titled
`Publish preorder`. The existing Preview, Validate and Apply lifecycle remains
authoritative: the existing public URL stays unavailable until Apply. No AI is
involved and publication changes no Product, availability, Customer, Order,
submission or other operational data.

Milestone 15 Phase 15A is the current unmerged direct Table Workspace feature
work on this branch. It adds a deterministic Owner/Admin Tables sidebar and
bounded structural Table actions over the existing configuration primitives.

## Current scope

Included:

- Supabase email/password authentication using cookie-based SSR
- globally addressable businesses with fixed Owner, Admin, and Staff roles
- metadata-driven Objects, Fields, Relationships, and generic Records
- tenant-safe View, Form, and Page configuration
- generic Table, List, Cards, Detail, Field, Form, and Page renderers
- generated internal workspace navigation and normal create/edit Record flows
- authenticated draft Page preview and static published public Pages
- a trusted public preorder Page block and narrow allow-listed catalogue
- configurable safe public Customer and Order Fields
- authoritative, atomic Customer/Order/Order Item graph creation
- tenant-safe generic Record-to-Location links
- one-record/one-location availability controls in the generated Record UI
- Location-timezone slot generation, cutoff and booking horizon enforcement
- transactionally locked per-Location Order capacity
- idempotent public references and database-backed abuse throttling
- post-commit confirmation email through a local console adapter
- Bedford Bakery Orders operated through generic Table/Detail Views and an
  edit Form
- immutable configuration versions and one active revisioned head per Business
- structured Owner/Admin configuration proposals with deterministic semantic
  diffs, rollback-only compatibility validation, and atomic application
- mandatory propose → validate → apply boundary for reviewed configuration
  work, plus the separately allow-listed atomic direct Table facade
- forward-only rollback proposals and rollback version provenance
- deterministic Builder-assisted undo of the latest active ordinary change
- Builder-assisted preparation and explicit confirmation for one ordinary
  operational Location creation; Location intent is enabled only in the
  private authenticated OpenAI Builder mapping after its separate live gates
  passed, while global/default registration remains disabled
- atomic expected-source/head comparison at rollback preparation
- authenticated verified candidate preview for internal and public Pages
- read-only Owner/Admin Changes, proposal detail, and Version history routes
- authenticated POST-only lifecycle Server Actions and read-only confirmation
  routes for validate, apply, abandon and rollback preparation
- authenticated Owner/Admin Edit setup routes for deterministic preorder
  collection schedule proposals
- clean-Business Owner/Admin initial preorder starter that prepares one ordinary
  proposed Change with generic Product and Order surfaces and a draft public
  Page
- deliberate Owner/Admin publication preparation for the existing public
  preorder Page through one ordinary M5 proposed Change
- bounded Owner/Admin manual internal list creation through one ordinary M5
  proposal, with generic Forms, a Table View, and a draft wrapper Page
- direct Owner/Admin Table Workspace creation and finite structural actions
  through atomic M5-backed RPC facades, including bounded column widths
- generic direct Table cell/row editing and `?record=` side-panel navigation
  without configuration-history writes
- bounded preorder-question controls for editing public wording, help and
  requiredness or adding one short/long-answer generic Order Field
- exact active-version and head-revision proposal currentness enforced
  atomically in PostgreSQL
- server-composed complete preorder operations from the active immutable
  snapshot, with owner-readable metadata and no-op rejection
- server-derived Business and actor context with status rechecks before every
  lifecycle mutation
- explicit pending state, bounded notices and authoritative
  idempotency/concurrency in PostgreSQL
- owner-safe stored semantic-diff and strict validation-result presentation
- bounded latest-50 proposal and version history loading
- direct projection-table mutation closed to anonymous, authenticated, and
  service-role clients
- registered strict structured AI task contracts and one trusted execution
  policy registry
- provider-neutral schema-constrained generation request/response contracts
- bounded structured input, output tokens, attempts, retry delay and actual
  aborting timeout behavior
- stable owner-safe AI errors with internal causes retained for observability
- default-disabled finite per-Business daily request, input-token,
  output-token, and integer-microusd controls
- atomic worst-case reservations, idempotent settlement, and conservative
  unknown-usage charging across every provider attempt
- Owner/Admin-only settings, UTC-day summary, and metadata-only latest-50
  execution audit reads
- one server-only OpenAI Responses adapter behind a default-disabled runtime
  gate, fixed model/pricing, strict Structured Outputs, `store: false` and no
  tools or conversation state
- two engineering-only, separately activated Terra-medium planning gates over
  synthetic configuration: an eight-scenario qualification run and three
  sequential repetitions (24 executions) for reliability, with frozen hard
  gates, redacted metadata-only output and ceilings of 3,700,000 and
  11,000,000 microusd
- two engineering-only, separately activated Terra-medium configuration-
  drafting gates over exactly two frozen synthetic contexts and eight fixed
  scenarios: one qualification pass (8 executions) and three sequential
  reliability rounds (24 executions), with redacted metadata-only output and
  ceilings of 6,000,000 and 18,000,000 microusd; production drafting remains
  disabled
- one authenticated Owner/Admin-only Business context loader over ordinary
  session/RLS reads, the active immutable configuration version and current
  Locations
- one strict schema-v1 pure model-facing projector with deterministic ordering,
  explicit Field-setting allow-lists and a 128 KiB hard limit
- explicit AI-safe Page blocks that retain structural purpose while excluding
  raw image/button destinations, credentials, hosts, paths, queries, fragments,
  email addresses and telephone numbers
- trusted active-version/head currentness kept outside model-facing context
- configuration UUID, actor, checksum, timestamp, operational Record, PII,
  proposal, validation and AI audit exclusion from model-facing context
- one registered `builder_plan_v1` task over a bounded owner request and the
  exact Phase 3A model context
- strict clarification-or-ready planning output with owner-readable bounds,
  plan-local references, explicit unsupported capabilities and separate
  configuration/operational planning lanes
- server-owned least-change and assumption-classification rules that keep the
  owner's explicit request as the scope boundary, reject adjacent unasked work,
  and require owner confirmation for every high-impact assumption in a ready
  plan
- pure server-owned semantic output validation for references, dependencies,
  category/lane compatibility and current platform capability compatibility,
  with finite internal diagnostics that never enter public errors or accounting
- authenticated planning orchestration with session-derived accounting
  identity, metadata-only usage settlement and post-execution context
  comparison before a plan is returned
- in-memory-only planning owner requests and plans, with no validation,
  application, publication, Record or Location mutation
- one registered `builder_configuration_draft_v1` task that turns a validated
  ready configuration plan into bounded additive, untrusted, transient intent
  for Objects, Fields, Relationships, Views, Forms and Pages only
- pure semantic validation that binds each draft Object to one new plan
  concept, checks exact per-step Object scope, local draft references, exact
  active context references, source-step coverage, typed experience
  dependencies and required create Form coverage
- strict structural contracts with explicit `null` for absent optional design
  values and `[]` for empty collections; singular/plural Object labels may
  match within one Object but use a normalized duplicate namespace across
  Objects
- globally production-disabled configuration drafting in both disabled and
  OpenAI registries; Phase 8B privately qualifies the same task only during
  authenticated orchestration, while the separate Phase 1B compiler performs
  no provider request
- authenticated, server-only Phase 2 handoff from a completed draft through
  exact-currentness checks to one ordinary M5 proposed configuration change
- authenticated server-only Phase 8B Builder orchestration that reuses one
  authoritative context for qualified planning and private qualified drafting,
  returns bounded clarification/unsupported outcomes, and hands one ready
  configuration draft to the existing proposal-only boundary
- minimal authenticated Owner/Admin Builder at
  `/app/[businessSlug]/builder` with ephemeral revise-and-resubmit
  clarification, fixed safe result states and a deliberate handoff to the
  existing Changes review
- bounded `builder_preorder_amendment_v1` support for schedule, existing public
  question and new Order question amendments, including combined requests
- one shared trusted manual/AI preorder batch composer that preserves complete
  snapshots and creates one ordinary proposal through Changes
- sequential independent planning and drafting accounting, with no drafting
  reservation on clarification or unsupported plans and no raw AI request,
  context, plan or draft durability
- Bedford Bakery installed as empty Version 1 followed by configured Version 2
- PostgreSQL validation and RLS for every tenant-owned table
- real PostgreSQL/RLS/integrity integration tests

## Milestone 10 Phase 10A - Builder-assisted Location creation

Phase 10A adds the first bounded operational Builder journey. An authenticated
Owner/Admin may request one new Location, receive a separately generated and
deterministically validated Location intent, review a signed 15-minute
confirmation, and then create one ordinary `public.locations` row through the
shared server-only Location service. Preparation and GET requests create no
Location; the final confirmation performs no AI call or AI accounting.

Location is a first-class platform concept, not a metadata Object or Record.
The operation is outside the M5 proposal/version/Changes lifecycle, and no
operational undo or generic operational action registry exists. Manual Location
creation remains available and shares the same canonical
NFKC/trim/locale-neutral-lower name, timezone and server-derived slug boundary.
Active and inactive names are reserved; an exact IANA timezone may be copied
from the request, otherwise the Business timezone is shown as the default.
Generic local/different-timezone wording clarifies without an exact IANA value;
no geographic inference is used. Mixed configuration/operational requests,
Product work and Location updates remain
unsupported in Builder.

The separate `builder_location_creation_intent_v1` task remains globally and
default-disabled. Its exact 8-scenario qualification and 24-execution
reliability evidence has passed; only the private authenticated OpenAI Builder
runtime maps it to `builder_location_creation_intent_terra_medium_v1`.
Product v0 remains in progress.

## Milestone 12 Phase 12A - Builder-assisted generic Record creation

Phase 12A is complete and merged through PR #17. It adds one bounded generic
`create_record` path for any eligible metadata
Object, including concepts such as Equipment and Catering Enquiry. The path
uses the existing Object/Field/Record primitives and runtime: strict typed
intent, deterministic validation, explicit Owner/Admin confirmation, and one
atomic server-checked Record insert. Product remains generic and receives no
Product-specific production path.

The model receives the unchanged AI-safe Business context and ready plan only.
It may return only exact existing Object and Field keys present in the supplied
configuration context. It may not invent new keys, UUIDs, IDs, defaults,
Records, relationships or mutation authority. The server reads defaults and
currentness outside the model boundary, signs a 15-minute Business/actor-bound
confirmation, rechecks a PII-free state digest, and calls the narrow
confirmed-create RPC once. The final action performs no AI, accounting,
provider or configuration work and opens the existing internal View selected
by the server. The global/default task remains disabled; the private
authenticated Builder runtime uses the accepted Terra evidence. Live
evaluation is never run implicitly.

An Object is eligible only when it exists and is active, has at least one
active non-file writable Field, has no active required incoming Relationship
that makes standalone creation incomplete, is not an active preorder Order or
Order Item Object, and has no required File Field without a usable default.

Not included:

- online payment, deposits, refunds or inventory deduction
- general-purpose user-facing AI execution, chat history or conversational
  editing
- owner/provider/model/API-key selection and multiple external providers
- provider-backed AI proposal/operation generation outside the bounded Phase
  9A preorder-amendment Builder boundary
- automatic proposal lifecycle orchestration, validation/application
  automation, or automatic publication
- billing, subscriptions, customer invoicing, tax, or currency conversion
- arbitrary public Record queries or generic public Form submissions
- relationship Form controls
- general-purpose owner-facing operation editing or raw configuration editing
- automatic rebase/merge or AI/LLM integration
- Location or operational Record versioning
- workflow/rule execution
- arbitrary historical natural-language rollback and operational undo

## Milestone 6 change boundaries

AI is the primary system-building interface, not the only control surface and
not a runtime dependency. Manual deterministic configuration and operational
controls arrive before AI operation generation.

Configuration changes use strict operations and the existing immutable
proposal → candidate → preview → validation → deliberate Owner/Admin
application → immutable version lifecycle. Neither AI nor manual UI may mutate
the eight versioned configuration tables directly, and the model never
validates or applies its own proposal.

Operational changes such as Product price, Order status, Location creation and
Product-to-Location availability use separate narrow operational services and
normal generated UI. They are not configuration versions. Compound requests
are decomposed into correctly ordered operational and configuration steps.

Phase 1B wraps the Phase 1A structured execution core in a separate
Business-aware accounting service. Each Business starts disabled with finite
limits. PostgreSQL locks that Business's settings row and reserves the trusted
worst-case envelope before an attempt; known usage settles to aggregate actuals
and the network-free disabled provider reports zero usage. Genuine incomplete
or unknown usage retains at least the reservation. Limits reset by the UTC date
captured from database statement time. Money is integer micro-US-dollars
(`1 USD = 1,000,000 microusd`).

The execution audit stores only bounded identity, policy, status, token/cost,
attempt, completeness and timestamp fields. It stores no prompt, task input,
instruction, model output, raw response, header, credential, provider metadata
or stack trace, and Owner/Admin reads are limited to the latest 50 rows.

Production remains network-free unless `AI_PROVIDER=openai` and a server-only
key are both configured. Even then, the current Business must separately have
AI enabled before reservation or provider invocation. Phase 8B keeps Builder
orchestration server-only and passes only a completed transient draft to the
existing M5 proposal path. Phase 8C adds the authenticated Owner/Admin
presentation and action wrapper without adding a second proposal or lifecycle
path.

Phase 2A.1 adds the first non-AI configuration control at
`/app/[businessSlug]/setup`. Owner/Admin users can edit preorder collection
days, times, interval, capacity, notice and booking horizon. The server reloads
the immutable active version, preserves every non-schedule property, composes
one strict `set_preorder_experience` operation and creates only an ordinary M5
proposal. Saving does not validate, apply, publish, invoke AI or create an AI
execution/accounting row. Stale rendered forms fail against the exact expected
active version and head revision instead of being rebased.

Phase 2A.2 adds a second bounded control under the same Edit setup entry.
Owner/Admin users can edit an existing preorder question’s public wording,
optional help and journey-level requiredness, or add one short- or long-answer
question. Existing questions preserve their generic Field definitions unless a
global required constraint must be relaxed. New questions are globally
optional generic Order Fields with hidden server-derived keys; preorder
requiredness remains independent. Submission still creates only a proposed M5
change for preview, deliberate validation and deliberate application.

Phase 3A adds a read-only AI-safe Business context foundation. One server-only
loader derives the actor from the ordinary authenticated session, requires the
fixed `manage_configuration` capability, reads the Business and current active
and inactive Locations through RLS, then parses only the active immutable
configuration version. A separate pure projector emits an explicit strict
schema-v1 contract for Business/access summaries, configuration definitions,
preorder setup and implemented platform capabilities.

Trusted `baseVersionId` and `headRevision` remain outside the model-facing
context. Location UUIDs are the sole opaque database references in model-facing
data and remain untrusted if returned later. Configuration UUIDs, actors,
timestamps, checksums, operational Records/PII, proposals, validation results
and AI audit are excluded. Canonical serialization is deterministically ordered
and fails without truncation above 128 KiB. The Bedford acceptance context,
including one inactive Location fixture, is 11,189 bytes. Phase 3A persists
nothing, invokes no provider, reserves no budget and creates no proposal.

Phase 3B registers `builder_plan_v1`. Its input is one trimmed owner request of
at most 4,000 characters plus the exact strict Phase 3A `modelContext`.
Session-derived actor/Business identity and exact base-version/head currentness
remain server-only. The fixed instruction and strict schema allow either one to
five clarification questions or a bounded owner-readable ready plan; the plan
contains descriptive configuration/operational categories, not tools or M5
operations.

Domain concepts are present only when a plan concerns generic Business
concepts. Platform-only operational plans such as creating or renaming a
Location keep the required `concepts` property as `[]`; they do not invent a
generic Location Object and remain descriptive rather than executable.

The provider-neutral core now runs an optional pure task semantic validator
after strict output parsing and before success. Invalid Object, Location,
concept or dependency references therefore settle as `ai_output_invalid` with
reported usage retained. The planning service reloads and canonically projects
Business context after execution and discards a plan when its version,
revision or projected content changed. Metered execution remains in the
metadata-only audit even when the plan is discarded as stale. A later
operation/proposal phase must still rebuild context and enforce expected-head
protection because a final read cannot remove every race.

Phase 4A classifies Page image sources as `external_web` and button
destinations as `internal_path`, `external_web`, `email` or `telephone`.
Raw destinations never enter model context. The fixed
Responses adapter receives deterministic structured input and a strict adapted
JSON Schema, sets `store: false`, and receives no tools, identity metadata or
conversation state. SMBOS persists neither request nor response. `store: false`
disables Responses application-state storage for the request; it is not a Zero
Data Retention claim, and production activation requires review of the OpenAI
project/organization data controls.

Phase 4B.1 evaluates that unchanged production planning path independently and
adds bounded diagnostics around structural versus semantic output failures. The
engineering-only harness uses one strict synthetic local-food Business context,
the registered `builder_plan_v1` task, production OpenAI adapter and production
planning policy through the provider-neutral execution service. It runs exactly
eight scenarios sequentially and emits only bounded pass/fail, state,
lane/category, unsupported-reason, count, usage, integer-cost and elapsed-time
metadata. Structural failures emit only `output_contract_invalid`; semantic
failures emit one approved diagnostic code; unclassified failures emit only
`unknown_output_invalid`. It has no application import, database client, tenant
row, accounting row, persistence, route, Server Action or UI.

Phase 4C replaces the unstable historical mini candidate with the code-owned
`gpt-5.6-terra` alias and non-overridable `medium` reasoning. The planning
instruction, schemas, semantic validator, synthetic context, owner requests and
hard gates are frozen. The alias may advance independently, so qualification
evidence is invalid whenever its identity or material execution/planning subject
changes. Operation generation remains blocked.

GPT-5.6 otherwise uses implicit prompt caching. The first Terra planner
explicitly disables it with provider-owned
`prompt_cache_options: { mode: "explicit" }` and sends no explicit cache
breakpoint, key or retention option. This preserves the trusted ordinary
$2.50/M input reservation rate; cache pricing and cache-token accounting need
a separate future review.

`npm run test:builder-evaluation`, `npm run test:terra-provider-profile`,
`npm run test:builder-terra-qualification` and
`npm run test:builder-terra-reliability` use injected providers and run in CI.
The external gates are deliberately separate:

```bash
RUN_LIVE_OPENAI_TERRA_QUALIFICATION=1 \
AI_PROVIDER=openai \
OPENAI_API_KEY=... \
npm run eval:builder-planning-terra-qualification-live
```

Only after an 8/8 qualification review may an operator deliberately run:

```bash
RUN_LIVE_OPENAI_TERRA_RELIABILITY=1 \
AI_PROVIDER=openai \
OPENAI_API_KEY=... \
npm run eval:builder-planning-terra-reliability-live
```

A key alone is not permission to run either gate. Qualification reserves at
most 3,543,040 microusd beneath a 3,700,000 ceiling; reliability reserves at
most 10,629,120 microusd beneath an 11,000,000 ceiling. Operation generation
remains outside this milestone and is not implemented until a later bounded
change-drafting phase.

### Milestone 6 Phase 4C closeout

The supplied redacted live evidence clears the planning gate for the frozen
`gpt-5.6-terra` / `builder_planning_terra_medium_v1` profile. Qualification ran
the eight unchanged scenarios once, with 8/8 passing: structural failures 0,
semantic failures 0, scenario-gate failures 0, provider failures 0; 34,949
input tokens, 3,476 output tokens, 139,515 estimated microusd and 47,157 ms.
Reliability ran the same eight scenarios in three sequential repetitions (24
executions), with 24/24 passing, every scenario 3/3, one provider attempt per
execution and failures 0: structural 0, semantic 0, scenario-gate 0, provider
0; 104,847 input tokens, 8,764 output tokens, 393,585 estimated microusd and
108,779 ms.

This is bounded engineering evidence, not a claim of universal model
perfection. Deterministic schemas, semantic validation and scenario gates
remain authoritative; the model has no mutation authority. Operation
generation, proposals, validation/application automation and publication are
not implemented here. A future milestone may begin bounded change drafting,
but must preserve currentness protection, deterministic validation and the
separate configuration/operational lanes. Any material model-alias, prompt,
schema, validator, context or provider-transport change invalidates this
evidence and requires both gates to be rerun.

### Milestone 7 Phase 1A - bounded additive configuration drafting

Phase 1A adds only the untrusted, transient
`builder_configuration_draft_v1` boundary. It accepts a validated ready
`builder_plan_v1` result, the bounded owner request and the exact model-facing
Business context, then describes additive intent for Objects, Fields,
Relationships, Views, Forms and Pages. Every new definition uses a plan-local
reference such as `draft_object_1`; every existing definition uses an exact
active key from the supplied context. The output contains no UUIDs, new stable
keys, positions, defaults, active or publication state, slugs, arbitrary JSON,
M5 operations, candidate, proposal or currentness values.

The pure validator proves configuration-only ready input, compatible source
planning steps, exact concept mapping and per-step Object scope, global
local-reference uniqueness, exact active context dependencies, Field/Object
ownership, typed View/Form/Page references, audience compatibility, required
create-Form coverage, duplicate new intent and the 128 KiB serialized output
limit. The strict schema uses explicit `null` for absent optional design
values. The registered schema also adapts to the OpenAI strict-object boundary
without enabling a provider request. The task is mapped to the separate
zero-priced `builder_configuration_drafting_disabled_v1` policy in both
disabled and OpenAI runtime modes. Planning remains on the unchanged
`builder_planning_terra_medium_v1` profile; its qualification/reliability
evidence is not reused, and any material drafting schema or validator change
does not inherit or revive that evidence.

The draft is not compiled inside the AI boundary and does not create a
proposal. Milestone 7 Phase 1B now provides a separate pure trusted compiler
under `src/core/configuration/draft-compiler/`. It consumes the validated draft
and a server-supplied immutable configuration snapshot, revalidates existing
references, reserves active and archived identities, derives collision-safe
keys, Page slugs, Field positions, complete defaults/active state and strict
M5 operations. It produces no UUIDs, expected-head values, candidate,
proposal or lifecycle state; M5 later allocates trusted IDs while materialising
a candidate. Milestone 7 Phase 2 supplies authentication, exact currentness and
fixed proposal metadata in a separate server-only handoff.

Public Form/Page intent remains design intent only. PostgreSQL currently
allows only the static published public Page resolver, and the public renderer
does not provide generic public Form submission. Generic Form submission
currently creates or updates one internal Record and has no Relationship
controls. A later reusable public Form capability is required before the full
Corporate Catering Enquiry acceptance flow; no catering-specific production
code was added in Phase 1A. The acceptance fixture remains exactly Company
name, Event date, Number of guests, Budget and Notes, with no implicit status.

### Milestone 7 Phase 1B - deterministic configuration draft compilation

Phase 1B is a synchronous, pure server-owned compiler. Its strict input is the
Phase 1A task input, draft and one authoritative immutable `ConfigurationSnapshotV1`.
It re-runs Phase 1A validation, rejects inconsistent or ambiguous snapshots,
resolves existing references against fresh active/archived snapshot state and
compiles only complete `set_object`, `set_field`, `set_relationship`,
`set_form`, `set_view` and `set_page` operations. Canonical operation order is
Object, Field, Relationship, Form, View, Page; Pages are always draft and public
Form/Page intent remains non-executable. The compiler has no database/provider,
UUID, currentness, proposal, route, UI or mutation dependency. Phase 2 later
adds authenticated currentness and proposal orchestration.

### Milestone 7 Phase 2 - authenticated proposal-only orchestration

Phase 2 is a server-only handoff for a completed Phase 1A draft and Phase 1B
compiler input. Its strict request contains only the tenant, expected active
version/head, the Phase 1A task-input base contract and the validated Phase 1A
draft. The server first loads the authenticated Owner/Admin context, compares
the supplied currentness and canonical serialized model context exactly, and
compiles once against that first immutable configuration snapshot. It then
loads and projects context again, requires the second currentness and canonical
context to match, and calls exactly one existing M5
`ConfigurationChangeService.proposeChangeSet`.

M5 remains responsible for trusted IDs, candidate materialisation and the
operation diff. Phase 2 supplies only the fixed title `Proposed configuration
changes` and a `null` description, and returns a frozen six-field result:
schema version, proposal ID, `proposed` status, base version ID, base head
revision and operation count. Stale context, compiler failures and M5 errors
map to finite safe errors; there is no retry, rebase, validate, apply, publish,
provider execution, raw handoff persistence, route or UI.

The authenticated Catering Enquiry acceptance fixture produces one ordinary
proposal with the expected Object, Fields, Relationship, Form, View and draft
Page intent through existing primitives. It does not add a status field,
change live configuration, enable generic public Form submission or claim a
complete public submission flow; those remain later reusable capabilities.

### Milestone 8 Phase 8A - configuration-drafting qualification gates

Phase 8A qualifies the corrected `builder_configuration_draft_v1` contract in
an isolated engineering harness. It reuses the exact production instruction,
input/output schemas and semantic validator, but gives the unregistered
evaluation task its separate `builder_configuration_drafting_terra_medium_v1`
policy identity: `gpt-5.6-terra`, explicit `medium` reasoning, 256 KiB input,
96,000 billable input tokens, 8,192 output tokens, two attempts, a 60-second
timeout and the existing integer $2.50/M input and $15/M output rates. Its
one-execution reservation is 725,760 microusd.

The harness uses exactly two frozen, schema-validated synthetic contexts
(`rich_existing_business` and `empty_new_business`) and eight code-owned
ready-plan scenarios: Catering Enquiry full stack, Customer marketing
consent, Customer Directory, public Customer contact page, Equipment and
Maintenance workspace, Supplier Quote field types, Staff Profile cards and
Order detail workspace. Qualification runs them once (8 executions) under a
5,806,080 reservation and 6,000,000 hard ceiling. Reliability runs the same
ordered set in three sequential rounds (24 executions) under a 17,418,240
reservation and 18,000,000 hard ceiling. Both gates require exact opt-in flags,
`AI_PROVIDER=openai` and a non-blank server-only key; the live evidence is
recorded in the Phase 8A closeout below for the frozen code subject
`acc9eecf652dfcd393c63ee4b9517316a00cdf90`.

The deterministic evaluator emits only strict bounded counts, usage, integer
cost, timing, repetition and finite failure codes. Provider failures expose
only safe execution codes; output failures are classified as structural,
semantic or unknown through bounded cause traversal. No request, context,
model output, provider response, proposal, compiler output, database state,
route, UI or public Form runtime claim is involved. Planning evidence is not
drafting evidence. Any material model/policy/transport, drafting subject,
synthetic context, ready plan, scenario order, evaluator or report-classifier
change invalidates both gates and requires them to be rerun. Milestone 8 Phase
8A is complete for this frozen profile. At that closeout, the next product
phase was Milestone 8 Phase 8B authenticated end-to-end Builder orchestration;
Phase 8B is documented below and is not another evaluation or mutation surface.

### Milestone 8 Phase 8A closeout evidence

The final successful qualification was executed exactly once against code SHA
`acc9eecf652dfcd393c63ee4b9517316a00cdf90` using task
`builder_configuration_draft_v1`, model `gpt-5.6-terra`, explicit `medium`
reasoning and policy `builder_configuration_drafting_terra_medium_v1`. All
eight scenarios passed: 8/8, 8 attempts, 53,719 input tokens, 4,647 output
tokens, 204,005 estimated microusd, 41,615 ms elapsed, usage complete, and
zero structural, semantic, unknown-output, deterministic scenario-gate or
provider/execution failures.

The first reliability run at the same SHA is retained as bounded historical
evidence: 23/24 executions passed, with one 60-second `ai_timeout` for
`equipment_maintenance_workspace` at repetition 2; provider/execution
failures were 1 and all other finite failure counts were 0. It used 155,672
input tokens, 13,059 output tokens, 585,072 estimated microusd and 172,058 ms,
with exit code 1. No model, policy or source change was made in response. A
single controlled complete rerun then passed 24/24, every scenario 3/3, with
161,157 input tokens, 13,463 output tokens, 604,845 estimated microusd and
112,191 ms, usage complete and all finite failure counts 0.

This is bounded, redacted evidence for one frozen profile, not generic AI
correctness. Production drafting remains disabled; no raw requests, contexts,
plans, model outputs, provider responses or credentials are recorded. Any
material change to the model, policy, provider transport, drafting task,
schemas, semantic validator, contexts, scenarios or evaluator invalidates the
evidence. At this closeout, the next phase connected authenticated owner
request → Business context → qualified planning → bounded clarification or
ready plan → qualified configuration drafting → deterministic compiler →
authenticated ordinary M5 proposal. Phase 8B now implements that server-only
composition; the Builder UI and generic public Form submission remain
unimplemented.

### Milestone 8 Phase 8B - authenticated Builder orchestration

Phase 8B adds the server-only `src/ai/builder/` boundary. It accepts only a
Business UUID and a trimmed bounded owner request, loads the authenticated
Owner/Admin AI-safe context, and reuses the first canonical projected context
for both the unchanged `builder_plan_v1` task and the private qualified
`builder_configuration_draft_v1` clone. Planning remains on
`gpt-5.6-terra`, explicit `medium` reasoning and
`builder_planning_terra_medium_v1`. The global drafting registration remains
mapped to `builder_configuration_drafting_disabled_v1`; only this closed
Builder runtime may use the exact qualified drafting policy.

The successful path performs four authoritative context loads: Builder initial,
Builder post-planning, existing proposal pre-compiler and existing proposal
post-compiler. The second Builder read must match Business ID, actor ID, base
version, head revision and canonical serialized model context exactly. A
clarification or unsupported ready plan returns a bounded frozen result after
planning and consumes no drafting reservation. A ready configuration-only plan
is limited to `define_object`, `define_field`, `define_relationship`,
`configure_view`, `configure_form` and `configure_page`; operational, mixed and
`configure_preorder` plans stop before drafting.

Planning and drafting use sequential independent accounting executions. The
existing execution core retains its bounded provider-attempt retry policy;
drafting uses the existing 60-second timeout and is not workflow-retried. The
existing proposal service remains responsible for its own currentness checks,
one deterministic compiler call and exactly one ordinary M5 `change` proposal
with `status: proposed`, the fixed title and `description: null`. No Builder
request, context, plan, raw draft, provider body or model metadata is stored;
no Validate, Apply or Publish action is invoked, and no operational mutation is
performed.

Phase 8B proves authenticated server orchestration and proposal-only handoff.
The minimal owner-facing wrapper is documented in Phase 8C below; generic
public Form submission, operational AI actions, conversational editing and
automatic application remain outside the phase.

### Milestone 8 Phase 8C - minimal authenticated Owner/Admin Builder

Phase 8C adds the narrow owner-facing wrapper at
`/app/[businessSlug]/builder`. The dynamic, no-store route creates an ordinary
session Supabase client, resolves the route slug to the authenticated tenant,
requires the existing `manage_configuration` capability and ends in a
controlled not-found result for Staff or non-members. The capability-gated
workspace navigation exposes Builder next to Edit setup and Changes only to
Owner/Admin users.

The route binds the trusted slug into one Server Action. The action accepts
only the `ownerRequest` form field, trims and bounds it to the existing 4,000
character planning contract and 16 KiB UTF-8 limit, derives Business and actor
identity from the session, then calls `builderOrchestrationService.run()` once.
The browser cannot supply Business, actor, proposal, operation, lifecycle or
provider data. Invalid input returns one fixed owner-safe message; known
failures map to finite unavailable/stale outcomes, while unexpected trusted
errors still fail loudly.

The UI uses React 19 `useActionState` with a controlled ephemeral textarea.
Clarifications expose only bounded owner-facing understanding, assumptions,
questions and choices; local references, impact and reason codes are removed.
The owner revises the same request and resubmits. Unsupported requests use a
fixed configuration-only explanation. A proposed result exposes only the
proposal UUID, summary and operation count, then links to the existing Changes
review with `notice=builder_prepared`. Nothing in Builder validates, applies,
publishes, stores a transcript, writes client storage or creates a new
mutation surface. No migration or change to the Phase 8B core or global
production drafting registration is introduced.

### Milestone 9 Phase 9B - deterministic Builder-assisted forward undo

Phase 9A is complete and merged. The Phase 9B implementation adds a bounded
contextual route at
`/app/[businessSlug]/builder?undoVersion=[activeVersionId]`. Owner/Admin users
can enter it from an applied ordinary Change or an eligible active Version.
Builder verifies the active source and derives its immediate parent on the
server, presents `Undo that.`, and creates only a normal proposed rollback
through the existing Changes engine. Builder does not invoke a model, reserve
AI usage, validate or apply.

The rollback preparation boundary atomically checks the expected source
Version and head revision under the existing head lock; the manual historical
rollback journey supplies the same currentness. Superseded, baseline, active
rollback, malformed and cross-Business contexts fail closed. The rollback is
forward-only and affects configuration only; operational data is untouched.
The normal Builder phrase without trusted context returns fixed guidance rather
than searching history. Phase 9B is implemented and merged, so Milestone 9 is
complete. Phase 10A is implemented and merged, and Product v0 remains in
progress. Milestone 15 Phase 15A is the current unmerged direct Table
Workspace foundation.

## Requirements

- Node.js 22.13+ or 24+ (the latest active LTS is recommended)
- npm 10 or newer
- Docker Desktop, Docker Engine, or another Docker-compatible runtime

Docker must be running before using the local Supabase commands. The Supabase
CLI is installed with the project dependencies; a global CLI installation is
not required. SMBOS uses the `5532x` local port range so it can run alongside a
Supabase project using the CLI defaults.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the local Supabase stack:

   ```bash
   npm run supabase:start
   npm run supabase:reset
   ```

3. Create a local environment file:

   ```bash
   cp .env.example .env.local
   ```

   The checked-in public values target the local stack. Copy the
   `SERVICE_ROLE_KEY` value reported by `npm run supabase:status` into the
   server-only `SUPABASE_SERVICE_ROLE_KEY` variable. Never expose that value
   through a `NEXT_PUBLIC_` variable. Leave `AI_PROVIDER` and `OPENAI_API_KEY`
   empty to keep external execution disabled. For local Builder Location
   confirmation tests, set `BUILDER_OPERATIONAL_CONFIRMATION_SECRET` to at least
   32 random bytes; it is server-only and never belongs in a public variable.

4. Start the development server:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000). The health endpoint is
   available at [http://localhost:3000/health](http://localhost:3000/health).

## Bedford Bakery local demonstration

The demo bootstrap is deliberately local-only. It reads credentials from the
running Supabase CLI and refuses any host/port other than this repository's
local `127.0.0.1:5532x` stack. It creates Bedford Bakery with an empty immutable
Version 1, authenticates the demo Owner, and proposes, validates, and applies
`Install Bedford Bakery configuration` as Version 2. Only then does it create
Product Records and availability.

```bash
npm run supabase:start
npm run supabase:reset
npm run demo:seed
npm run dev
```

Running `npm run demo:seed` again is safe: it verifies the existing Version 2,
head, projection, users, memberships, Locations, and Products without creating
Version 3 or duplicates.

Sign in at [http://localhost:3000/sign-in](http://localhost:3000/sign-in):

- Owner email: `demo@smbos.local`
- Staff email: `staff@smbos.local`
- Password: `Local-demo-2026!`

Open the public
[Bedford Bakery preorder](http://localhost:3000/p/bedford-bakery-demo/preorder),
choose products, Bedford or Milton Keynes, an available collection slot and
customer details, then submit. The safe confirmation appears immediately. The
local-only confirmation email adapter prints the message in the terminal
running `npm run dev`. Production fails delivery closed unless a real adapter
is configured; Milestone 4 intentionally does not include one.

Then sign in as Staff and open the generic
[Orders workspace](http://localhost:3000/app/bedford-bakery-demo/workspace/orders).
Open the Order detail and use the generated edit Form to change its status.
Products, Customers, Orders and Order Items are generic graph Records; the
internal screens are generic Views and Forms.

Sign in as the Owner to open
[Changes and Version history](http://localhost:3000/app/bedford-bakery-demo/changes).
The configured Version 2 appears as the active head. Lifecycle controls appear
only when an existing proposal's authoritative status permits them. The local
demo does not seed permanent proposals; Phase 5B does not introduce
demonstration-only history or proposal creation.

Open [Edit setup](http://localhost:3000/app/bedford-bakery-demo/setup) to
prepare a preorder collection settings proposal. Review its stored diff and
candidate preview in Changes, then validate and apply it deliberately.

## Local Supabase

Start the Docker-based local stack:

```bash
npm run supabase:start
```

The first start downloads the required container images. Inspect the local
service URLs and credentials with:

```bash
npm run supabase:status
```

Apply the repository migration set and seed file from a clean database:

```bash
npm run supabase:reset
```

Stop the local stack when finished:

```bash
npm run supabase:stop
```

The reset command destroys local data, recreates the database, applies every
migration, and runs `supabase/seed.sql`. Use it before the RLS suite when
validating from a clean state.

## Quality commands

| Command                                       | Purpose                                             |
| --------------------------------------------- | --------------------------------------------------- |
| `npm test`                                    | Run fast unit and component tests                   |
| `npm run test:integration`                    | Run the full real Supabase/PostgreSQL suite         |
| `npm run test:ai-context`                     | Run AI-safe Business context tests                  |
| `npm run test:ai-accounting`                  | Run durable AI usage-control/accounting tests       |
| `npm run test:builder-planning`               | Run strict non-executing builder planning tests     |
| `npm run test:builder-configuration-proposal` | Run authenticated proposal-only orchestration tests |
| `npm run test:manual-lists`                   | Run manual list and shared navigation tests         |
| `npm run test:manual-list-integration`        | Run the Phase 14B local Supabase acceptance test    |
| `npm run test:builder-orchestration`          | Run authenticated Builder orchestration tests       |
| `npm run test:builder-location-creation`      | Run the Builder Location creation boundary tests    |
| `npm run test:location-service`               | Run transient Location confirmation boundary tests  |
| `npm run test:location-creation-intent`       | Run Location intent contract and validator tests    |
| `npm run test:location-creation-evaluation`   | Run deterministic Location evaluation tests         |
| `npm run test:record-creation-intent`         | Run generic Record intent contract tests            |
| `npm run test:record-creation-evaluation`     | Run deterministic generic Record evaluation tests   |
| `npm run test:record-creation-service`        | Run generic Record Supabase boundary tests          |
| `npm run test:builder-record-creation`        | Run all Phase 12A Builder Record tests              |
| `npm run test:builder-ui`                     | Run Builder UI and action-boundary tests            |
| `npm run test:manual-amendments`              | Run deterministic schedule amendment tests          |
| `npm run test:manual-questions`               | Run deterministic preorder question tests           |
| `npm run test:rls`                            | Run the Milestone 1 tenancy/RLS suite               |
| `npm run test:graph`                          | Run the Milestone 2 graph integrity suite           |
| `npm run test:experience`                     | Run the Milestone 3 experience suite                |
| `npm run test:preorder`                       | Run the Milestone 4 preorder/concurrency suite      |
| `npm run test:configuration`                  | Run immutable baseline/version tests                |
| `npm run test:changes`                        | Run structured proposal and semantic-diff tests     |
| `npm run test:validation`                     | Run rollback-only compatibility validation tests    |
| `npm run test:application`                    | Run atomic configuration application tests          |
| `npm run test:configuration-boundary`         | Run Phase 3B closure/demo tests                     |
| `npm run test:rollback`                       | Run forward-only rollback tests                     |
| `npm run test:preview-foundation`             | Run authenticated candidate foundation tests        |
| `npm run test:preview`                        | Run authenticated rendered preview tests            |
| `npm run test:changes-ui-read`                | Run read-only Changes/History and no-write tests    |
| `npm run test:changes-ui-actions`             | Run lifecycle action/security/concurrency tests     |
| `npm run test:watch`                          | Run unit tests in watch mode                        |
| `npm run typecheck`                           | Generate route types and run TypeScript             |
| `npm run lint`                                | Run ESLint                                          |
| `npm run format`                              | Format supported files with Prettier                |
| `npm run format:check`                        | Verify formatting without changing files            |
| `npm run build`                               | Create a production Next.js build                   |
| `npm run check`                               | Run formatting, types, linting, and unit tests      |
| `npm run supabase:start`                      | Start the local Supabase stack                      |
| `npm run supabase:status`                     | Show local Supabase service details                 |
| `npm run supabase:reset`                      | Recreate and migrate the local database             |
| `npm run supabase:lint`                       | Run PostgreSQL lint against the local database      |
| `npm run supabase:stop`                       | Stop the local Supabase stack                       |
| `npm run demo:seed`                           | Seed the local-only Bedford Bakery demonstration    |

For an authoritative clean integration run, use the same isolation boundary as
CI. The stop/start/reset sequence matters: running the suite against a locally
mutated database can produce failures that are not reproducible from a clean
checkout.

```bash
npm run supabase:stop
npm run supabase:start
npm run supabase:reset
npm run supabase:auth:ready
npm run demo:seed
npm run test:integration
npm run test:rls
```

To verify the production server locally:

```bash
npm run build
npm start
```

## Environment variables

Shared application environment values are parsed in `src/env.ts`. The
server-only AI runtime parses its own closed provider configuration so its API
key cannot enter client source. Deployment builds require both public Supabase
values. Trusted preorder writes also require the server-only service-role key
at runtime.

| Variable                               | Required now    | Visibility  |
| -------------------------------------- | --------------- | ----------- |
| `NEXT_PUBLIC_APP_URL`                  | No              | Browser     |
| `NEXT_PUBLIC_SUPABASE_URL`             | Yes             | Browser     |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes             | Browser     |
| `SUPABASE_SERVICE_ROLE_KEY`            | For preorder    | Server only |
| `PREORDER_RATE_LIMIT_SECRET`           | Production      | Server only |
| `AI_PROVIDER`                          | No (`disabled`) | Server only |
| `OPENAI_API_KEY`                       | When `openai`   | Server only |

The publishable key is designed for browser use; PostgreSQL RLS is the
authorization boundary. The preorder server uses the service role only to call
three narrow, schema-validated transaction/email RPCs. The browser never
receives it and cannot execute the write RPC directly.

`AI_PROVIDER` accepts only blank/`disabled` or `openai`. OpenAI mode requires
`OPENAI_API_KEY`; provider, endpoint, model, attempts, timeout, token maximum,
pricing, storage behavior and schema remain code-owned. There is no
`NEXT_PUBLIC_` AI variable or arbitrary base-URL/model override.

## Repository structure

```text
src/
├── ai/                 Server-only structured task/policy/provider contracts
├── app/                Next.js App Router routes and global styles
├── auth/               Authentication actions and authorization helpers
├── components/         Shared user-interface components
├── core/               Graph, experience and preorder boundaries
├── db/supabase/        SSR/browser clients and generated database types
├── lib/                Shared application utilities
├── runtime/            Deterministic generic and trusted runtimes
└── env.ts              Environment schema and parser
supabase/
├── config.toml         Local Supabase CLI configuration
├── migrations/        Versioned PostgreSQL schema and RLS policies
└── seed.sql            Local reset hook
tests/
├── integration/       Real Supabase Auth and PostgreSQL RLS tests
└── *.test.ts          Fast unit and route tests
```

## Security model

- Protected requests authenticate on the server.
- A route slug is resolved through RLS, then membership is explicitly verified
  against the stable business UUID.
- Fixed capabilities are centralized in `src/auth/capabilities.ts`.
- Database policies independently restrict every tenant read and mutation.
- The eight versioned configuration tables are read-only to authenticated
  runtime clients and inaccessible to anonymous clients. Neither normal
  sessions nor the service role can mutate them directly.
- Reviewed Owner/Admin configuration changes use the structured propose,
  validate, apply, and abandon RPC lifecycle; routine direct Table actions use
  only the separately allow-listed atomic Table RPC facades. Legacy
  configuration RPCs and private engine helpers are not executable by
  application roles.
- AI execution resolves only registered server tasks and trusted policies. It
  has no configuration or operational mutation dependency. A separate
  server-only accounting module verifies the authenticated Owner/Admin through
  narrow RPCs and alone may invoke service-role-only reserve/settle RPCs.
  Direct access to both accounting tables is denied to all application roles,
  including `service_role`. The disabled provider performs no network request.
- Database-owner configuration fixtures exist only under `tests/`; they are not
  production services, credentials, routes, or RPCs.
- Public catalogue reads return an explicit allow-list; generic graph and
  experience tables remain inaccessible anonymously.
- Public preorder writes pass through the server endpoint. PostgreSQL resolves
  the Business from the published Page and configured key, revalidates every
  Field/Product/Location/slot/price, locks capacity and creates the complete
  graph bundle in one transaction.
- Business creation derives the user from `auth.uid()` and atomically creates
  the business and its first Owner membership.
- Business slugs are generated by PostgreSQL, globally unique, and immutable.

`permissions_json` is reserved and ignored in v0.1. Owner/Admin may manage
locations; Staff may read them. Admin cannot change ownership.

Owner-facing team provisioning is explicitly deferred beyond Milestone 1.
Future membership UI must use a controlled invitation/account-resolution flow;
it must never ask for or expose raw authentication user IDs as the membership
mechanism.

## Route model

Tenant routes use `/app/[businessSlug]/...`. The slug is a routing/display
identifier only. It is never accepted as authorization and is resolved
server-side to the permanent business UUID before access.
