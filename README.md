# SMBOS

SMBOS is an AI-native operating system for small physical businesses. The
repository currently contains the Milestone 4 vertical slice, the Milestone 5
Phase 5B explicit Changes lifecycle interface and the Milestone 6 Phase 2A.2
provider-neutral AI foundation plus deterministic manual setup amendments: a
multi-location bakery preorder capability over the tenant-safe graph and
experience runtime whose configuration is installed, previewed and explained
through immutable change sets and forward-only versions, with deliberate
Owner/Admin validation, application, abandonment and rollback preparation.
The AI execution boundary is server-only, per-Business accounting is disabled
by default, and the sole production provider remains deliberately disabled.
There is no live provider or external model request.

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
- one disabled production AI provider that makes no network request
- Bedford Bakery installed as empty Version 1 followed by configured Version 2
- PostgreSQL validation and RLS for every tenant-owned table
- real PostgreSQL/RLS/integrity integration tests

Not included:

- online payment, deposits, refunds or inventory deduction
- live AI provider calls, API-key use or builder behavior
- AI proposal generation, context assembly, builder routes or chat UI
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

The production provider is still disabled, so it performs no external request
and cannot incur an AI API charge. Live provider integration, context assembly,
operation generation and builder UI remain later work.

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
   through a `NEXT_PUBLIC_` variable. Leave the future AI values empty.

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
| `npm run test:ai-accounting`          | Run durable AI usage-control/accounting tests    |
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

Environment values are parsed in `src/env.ts`. Deployment builds require both
public Supabase values. Trusted preorder writes also require the server-only
service-role key at runtime. Empty optional values are normalized to
`undefined`; partially configured AI integrations fail validation.

| Variable                               | Required now | Visibility  |
| -------------------------------------- | ------------ | ----------- |
| `NEXT_PUBLIC_APP_URL`                  | No           | Browser     |
| `NEXT_PUBLIC_SUPABASE_URL`             | Yes          | Browser     |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes          | Browser     |
| `SUPABASE_SERVICE_ROLE_KEY`            | For preorder | Server only |
| `PREORDER_RATE_LIMIT_SECRET`           | Production   | Server only |
| `AI_PROVIDER`                          | No           | Server only |
| `AI_PROVIDER_API_KEY`                  | No           | Server only |

The publishable key is designed for browser use; PostgreSQL RLS is the
authorization boundary. The preorder server uses the service role only to call
three narrow, schema-validated transaction/email RPCs. The browser never
receives it and cannot execute the write RPC directly.

`AI_PROVIDER` and `AI_PROVIDER_API_KEY` remain validated placeholders for a
future phase. Phase 1A does not read them during execution or send them to a
provider.

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
