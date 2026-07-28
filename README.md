# SMBOS

SMBOS is an AI-native operating system for small physical businesses. The
repository currently contains the Milestone 4 vertical slice: a multi-location
bakery preorder capability over the tenant-safe graph and experience runtime.

The product and architecture sources of truth are:

- [`docs/SMBOS-v0.1-Build-Spec.md`](docs/SMBOS-v0.1-Build-Spec.md)
- [`docs/architecture-decisions.md`](docs/architecture-decisions.md)
- [`AGENTS.md`](AGENTS.md)

## Milestone 4 scope

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
- PostgreSQL validation and RLS for every tenant-owned table
- real PostgreSQL/RLS/integrity integration tests

Not included:

- online payment, deposits, refunds or inventory deduction
- AI provider calls or builder behavior
- arbitrary public Record queries or generic public Form submissions
- relationship Form controls
- configuration versioning, change sets, or publishing versions
- workflow/rule execution

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
local `127.0.0.1:5532x` stack.

```bash
npm run supabase:start
npm run supabase:reset
npm run demo:seed
npm run dev
```

Sign in at [http://localhost:3000/sign-in](http://localhost:3000/sign-in):

- Staff email: `staff@smbos.local`
- Password: `Local-demo-2026!`

Open the public
[Bedford Bakery preorder](http://localhost:3000/p/bedford-bakery-demo/preorder),
choose products, Bedford or Milton Keynes, an available collection slot and
customer details, then submit. The safe confirmation appears immediately. The
local confirmation email is printed in the terminal running `npm run dev`.

Then sign in as Staff and open the generic
[Orders workspace](http://localhost:3000/app/bedford-bakery-demo/workspace/orders).
Open the Order detail and use the generated edit Form to change its status.
Products, Customers, Orders and Order Items are generic graph Records; the
internal screens are generic Views and Forms.

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

| Command                    | Purpose                                          |
| -------------------------- | ------------------------------------------------ |
| `npm test`                 | Run fast unit and component tests                |
| `npm run test:integration` | Run the full real Supabase/PostgreSQL suite      |
| `npm run test:rls`         | Run the Milestone 1 tenancy/RLS suite            |
| `npm run test:graph`       | Run the Milestone 2 graph integrity suite        |
| `npm run test:experience`  | Run the Milestone 3 experience suite             |
| `npm run test:preorder`    | Run the Milestone 4 preorder/concurrency suite   |
| `npm run test:watch`       | Run unit tests in watch mode                     |
| `npm run typecheck`        | Generate route types and run TypeScript          |
| `npm run lint`             | Run ESLint                                       |
| `npm run format`           | Format supported files with Prettier             |
| `npm run format:check`     | Verify formatting without changing files         |
| `npm run build`            | Create a production Next.js build                |
| `npm run check`            | Run formatting, types, linting, and unit tests   |
| `npm run supabase:start`   | Start the local Supabase stack                   |
| `npm run supabase:status`  | Show local Supabase service details              |
| `npm run supabase:reset`   | Recreate and migrate the local database          |
| `npm run supabase:lint`    | Run PostgreSQL lint against the local database   |
| `npm run supabase:stop`    | Stop the local Supabase stack                    |
| `npm run demo:seed`        | Seed the local-only Bedford Bakery demonstration |

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

## Repository structure

```text
src/
├── ai/providers/       Future structured AI provider adapters
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
