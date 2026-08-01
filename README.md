# SMBOS

SMBOS is an AI-native operating system for small physical businesses. The
repository currently contains the Milestone 4 vertical slice, the Milestone 5
Phase 5B explicit Changes lifecycle interface and the Milestone 6 Phase 4C
Terra-medium qualification and reliability gate after bounded real-model
planning diagnostics, deterministic manual setup amendments,
data-minimised Business context and strict non-executing Business-request
planning: a
multi-location bakery preorder capability over the tenant-safe graph and
experience runtime whose configuration is installed, previewed and explained
through immutable change sets and forward-only versions, with deliberate
Owner/Admin validation, application, abandonment and rollback preparation.
The AI execution boundary is server-only and per-Business accounting is
disabled by default. OpenAI Responses is the first external adapter, but it is
also server-disabled by default and has no user-facing invocation surface.

The product and architecture sources of truth are:

- [`docs/SMBOS-v0.1-Build-Spec.md`](docs/SMBOS-v0.1-Build-Spec.md)
- [`docs/architecture-decisions.md`](docs/architecture-decisions.md)
- [`docs/configuration-mutation-boundary.md`](docs/configuration-mutation-boundary.md)
- [`AGENTS.md`](AGENTS.md)

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
- Location-timezone slot generation, cutoff and booking horizon enforcement
- transactionally locked per-Location Order capacity
- idempotent public references and database-backed abuse throttling
- post-commit confirmation email through a local console adapter
- Bedford Bakery Orders operated through generic Table/Detail Views and an
  edit Form
- immutable configuration versions and one active revisioned head per Business
- structured Owner/Admin configuration proposals with deterministic semantic
  diffs, rollback-only compatibility validation, and atomic application
- mandatory propose → validate → apply configuration mutation boundary
- forward-only rollback proposals and rollback version provenance
- authenticated verified candidate preview for internal and public Pages
- read-only Owner/Admin Changes, proposal detail, and Version history routes
- authenticated POST-only lifecycle Server Actions and read-only confirmation
  routes for validate, apply, abandon and rollback preparation
- authenticated Owner/Admin Edit setup routes for deterministic preorder
  collection schedule proposals
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
- in-memory-only owner requests and plans with no proposal, validation,
  application, publication, Record or Location mutation
- one registered `builder_configuration_draft_v1` task that turns a validated
  ready configuration plan into bounded additive, untrusted, transient intent
  for Objects, Fields, Relationships, Views, Forms and Pages only
- pure semantic validation that binds each draft Object to one new plan
  concept, checks exact per-step Object scope, local draft references, exact
  active context references, source-step coverage, typed experience
  dependencies and required create Form coverage
- strict structural contracts with explicit `null` for absent optional design
  values and `[]` for empty collections; singular/plural Object labels use one
  normalized duplicate namespace
- production-disabled configuration drafting in both disabled and OpenAI server
  modes; no compiler, proposal, operation generation or provider request
- Bedford Bakery installed as empty Version 1 followed by configured Version 2
- PostgreSQL validation and RLS for every tenant-owned table
- real PostgreSQL/RLS/integrity integration tests

Not included:

- online payment, deposits, refunds or inventory deduction
- user-facing AI execution or executable builder behavior
- owner/provider/model/API-key selection and multiple external providers
- AI proposal/operation generation, builder routes or chat UI
- configuration-draft compilation, Milestone 5 operation generation and
  proposal creation from `builder_configuration_draft_v1`
- billing, subscriptions, customer invoicing, tax, or currency conversion
- arbitrary public Record queries or generic public Form submissions
- relationship Form controls
- general-purpose owner-facing operation editing or raw configuration editing
- automatic rebase/merge or AI/LLM integration
- Location or operational Record versioning
- workflow/rule execution

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
and incomplete usage retains at least the reservation. Limits reset by the UTC
date captured from database statement time. Money is integer micro-US-dollars
(`1 USD = 1,000,000 microusd`).

The execution audit stores only bounded identity, policy, status, token/cost,
attempt, completeness and timestamp fields. It stores no prompt, task input,
instruction, model output, raw response, header, credential, provider metadata
or stack trace, and Owner/Admin reads are limited to the latest 50 rows.

Production remains network-free unless `AI_PROVIDER=openai` and a server-only
key are both configured. Even then, the current Business must separately have
AI enabled before reservation or provider invocation. Operation generation and
builder UI remain later work.

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

The draft is not compiled and does not create an M5 operation or proposal. A
future trusted server compiler must derive collision-safe keys, IDs, positions,
complete definitions, operations, defaults, active state, publication state
and exact expected-head metadata before the existing propose -> validate ->
apply lifecycle can be used.

Public Form/Page intent remains design intent only. PostgreSQL currently
allows only the static published public Page resolver, and the public renderer
does not provide generic public Form submission. Generic Form submission
currently creates or updates one internal Record and has no Relationship
controls. A later reusable public Form capability is required before the full
Corporate Catering Enquiry acceptance flow; no catering-specific production
code was added in Phase 1A. The acceptance fixture remains exactly Company
name, Event date, Number of guests, Budget and Notes, with no implicit status.

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
   empty to keep external execution disabled.

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

| Command                               | Purpose                                          |
| ------------------------------------- | ------------------------------------------------ |
| `npm test`                            | Run fast unit and component tests                |
| `npm run test:integration`            | Run the full real Supabase/PostgreSQL suite      |
| `npm run test:ai-context`             | Run AI-safe Business context tests               |
| `npm run test:ai-accounting`          | Run durable AI usage-control/accounting tests    |
| `npm run test:builder-planning`       | Run strict non-executing builder planning tests  |
| `npm run test:manual-amendments`      | Run deterministic schedule amendment tests       |
| `npm run test:manual-questions`       | Run deterministic preorder question tests        |
| `npm run test:rls`                    | Run the Milestone 1 tenancy/RLS suite            |
| `npm run test:graph`                  | Run the Milestone 2 graph integrity suite        |
| `npm run test:experience`             | Run the Milestone 3 experience suite             |
| `npm run test:preorder`               | Run the Milestone 4 preorder/concurrency suite   |
| `npm run test:configuration`          | Run immutable baseline/version tests             |
| `npm run test:changes`                | Run structured proposal and semantic-diff tests  |
| `npm run test:validation`             | Run rollback-only compatibility validation tests |
| `npm run test:application`            | Run atomic configuration application tests       |
| `npm run test:configuration-boundary` | Run Phase 3B closure/demo tests                  |
| `npm run test:rollback`               | Run forward-only rollback tests                  |
| `npm run test:preview-foundation`     | Run authenticated candidate foundation tests     |
| `npm run test:preview`                | Run authenticated rendered preview tests         |
| `npm run test:changes-ui-read`        | Run read-only Changes/History and no-write tests |
| `npm run test:changes-ui-actions`     | Run lifecycle action/security/concurrency tests  |
| `npm run test:watch`                  | Run unit tests in watch mode                     |
| `npm run typecheck`                   | Generate route types and run TypeScript          |
| `npm run lint`                        | Run ESLint                                       |
| `npm run format`                      | Format supported files with Prettier             |
| `npm run format:check`                | Verify formatting without changing files         |
| `npm run build`                       | Create a production Next.js build                |
| `npm run check`                       | Run formatting, types, linting, and unit tests   |
| `npm run supabase:start`              | Start the local Supabase stack                   |
| `npm run supabase:status`             | Show local Supabase service details              |
| `npm run supabase:reset`              | Recreate and migrate the local database          |
| `npm run supabase:lint`               | Run PostgreSQL lint against the local database   |
| `npm run supabase:stop`               | Stop the local Supabase stack                    |
| `npm run demo:seed`                   | Seed the local-only Bedford Bakery demonstration |

Run the integration suite after Supabase is started and reset:

```bash
npm run supabase:start
npm run supabase:reset
npm run test:integration
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
- Owner/Admin configuration changes use only the structured propose, validate,
  apply, and abandon RPC lifecycle. Legacy configuration RPCs and private
  engine helpers are not executable by application roles.
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
