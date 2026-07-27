# SMBOS

SMBOS is an AI-native operating system for small physical businesses. The
repository currently contains the Milestone 1 multi-tenant foundation:
email/password accounts, private business workspaces, and locations.

The product and architecture sources of truth are:

- [`docs/SMBOS-v0.1-Build-Spec.md`](docs/SMBOS-v0.1-Build-Spec.md)
- [`docs/architecture-decisions.md`](docs/architecture-decisions.md)
- [`AGENTS.md`](AGENTS.md)

## Milestone 1 scope

Included:

- Supabase email/password authentication using cookie-based SSR
- globally addressable businesses with fixed Owner, Admin, and Staff roles
- locations uniquely addressable within a business
- PostgreSQL Row Level Security for all tenant-owned tables
- server-side tenant resolution for `/app/[businessSlug]/...`
- transactional initial business and Owner membership creation
- authenticated PostgreSQL/RLS integration tests
- GitHub Actions CI using the same local Supabase workflow

Not included:

- the configurable object/graph system
- preorder functionality
- AI provider calls or builder behavior
- invitations, social authentication, magic links, or passwordless login
- custom expansion or narrowing of fixed role permissions

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

   The checked-in public values target the local stack. They are not secrets.
   Leave the future AI values empty.

4. Start the development server:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000). The health endpoint is
   available at [http://localhost:3000/health](http://localhost:3000/health).

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

| Command                    | Purpose                                        |
| -------------------------- | ---------------------------------------------- |
| `npm test`                 | Run fast unit and route tests                  |
| `npm run test:integration` | Exercise real auth identities and RLS          |
| `npm run test:watch`       | Run unit tests in watch mode                   |
| `npm run typecheck`        | Generate route types and run TypeScript        |
| `npm run lint`             | Run ESLint                                     |
| `npm run format`           | Format supported files with Prettier           |
| `npm run format:check`     | Verify formatting without changing files       |
| `npm run build`            | Create a production Next.js build              |
| `npm run check`            | Run formatting, types, linting, and unit tests |
| `npm run supabase:start`   | Start the local Supabase stack                 |
| `npm run supabase:status`  | Show local Supabase service details            |
| `npm run supabase:reset`   | Recreate and migrate the local database        |
| `npm run supabase:stop`    | Stop the local Supabase stack                  |

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
public Supabase values. Empty future AI values are normalized to `undefined`;
partially configured AI integrations fail validation.

| Variable                               | Required now | Visibility  |
| -------------------------------------- | ------------ | ----------- |
| `NEXT_PUBLIC_APP_URL`                  | No           | Browser     |
| `NEXT_PUBLIC_SUPABASE_URL`             | Yes          | Browser     |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes          | Browser     |
| `AI_PROVIDER`                          | No           | Server only |
| `AI_PROVIDER_API_KEY`                  | No           | Server only |

The publishable key is designed for browser use; PostgreSQL RLS is the
authorization boundary. Never expose a Supabase secret/service-role credential
or an AI provider API key through a `NEXT_PUBLIC_` variable. Service-role
credentials are used only by the test fixture to create and clean up isolated
test identities.

## Repository structure

```text
src/
├── ai/providers/       Future structured AI provider adapters
├── app/                Next.js App Router routes and global styles
├── auth/               Authentication actions and authorization helpers
├── components/         Shared user-interface components
├── core/               Future metadata-driven business graph
├── db/supabase/        SSR/browser clients and generated database types
├── lib/                Shared application utilities
├── runtime/            Future deterministic experience runtime
└── env.ts              Environment schema and parser
supabase/
├── config.toml         Local Supabase CLI configuration
├── migrations/        Versioned PostgreSQL schema and RLS policies
└── seed.sql            Local reset hook
tests/
├── integration/       Real Supabase Auth and PostgreSQL RLS tests
└── *.test.ts          Fast unit and route tests
```

The future graph engine and experience runtime should be added under the
boundaries defined in the build specification when their milestones begin.

## Security model

- Protected requests authenticate on the server.
- A route slug is resolved through RLS, then membership is explicitly verified
  against the stable business UUID.
- Fixed capabilities are centralized in `src/auth/capabilities.ts`.
- Database policies independently restrict every tenant read and mutation.
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
