# SMBOS

SMBOS is an AI-native operating system for small physical businesses. This
repository currently contains the Milestone 0 engineering foundation only.

The product and architecture sources of truth are:

- [`docs/SMBOS-v0.1-Build-Spec.md`](docs/SMBOS-v0.1-Build-Spec.md)
- [`docs/architecture-decisions.md`](docs/architecture-decisions.md)
- [`AGENTS.md`](AGENTS.md)

## Milestone 0 scope

Included:

- Next.js App Router application with strict TypeScript
- minimal responsive application shell
- JSON health endpoint at `/health`
- validated environment configuration
- ESLint and Prettier
- Vitest test setup
- pinned Supabase CLI configuration for Docker-based local development and CI
- reserved Supabase and AI provider integration boundaries

Not included:

- authentication or multi-tenancy
- SMBOS database schema, application migrations, or Supabase clients
- the configurable object/graph system
- preorder functionality
- AI provider calls or builder behavior

## Requirements

- Node.js 20.19+, 22.13+, or 24+ (the latest active LTS is recommended)
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

2. Create a local environment file:

   ```bash
   cp .env.example .env.local
   ```

   The default values are sufficient for Milestone 0. Supabase and AI values
   may remain empty.

3. Start the development server:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000). The health endpoint is
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

Milestone 0 contains no SMBOS application schema. The reset command is kept as
the standard migration workflow now so the same entry point can run real
PostgreSQL/RLS integration tests locally and in CI from Milestone 1 onward.

## Quality commands

| Command                   | Purpose                                   |
| ------------------------- | ----------------------------------------- |
| `npm test`                | Run the automated test suite once         |
| `npm run test:watch`      | Run tests in watch mode                   |
| `npm run typecheck`       | Generate route types and run TypeScript   |
| `npm run lint`            | Run ESLint                                |
| `npm run format`          | Format supported files with Prettier      |
| `npm run format:check`    | Verify formatting without changing files  |
| `npm run build`           | Create a production Next.js build         |
| `npm run check`           | Run formatting, types, linting, and tests |
| `npm run supabase:start`  | Start the local Supabase stack            |
| `npm run supabase:status` | Show local Supabase service details       |
| `npm run supabase:reset`  | Recreate and migrate the local database   |
| `npm run supabase:stop`   | Stop the local Supabase stack             |

To verify the production server locally:

```bash
npm run build
npm start
```

## Environment variables

Environment values are parsed in `src/env.ts`. Empty optional integration
values are normalized to `undefined`; partially configured integrations fail
validation.

| Variable                               | Required now | Visibility  |
| -------------------------------------- | ------------ | ----------- |
| `NEXT_PUBLIC_APP_URL`                  | No           | Browser     |
| `NEXT_PUBLIC_SUPABASE_URL`             | No           | Browser     |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | No           | Browser     |
| `AI_PROVIDER`                          | No           | Server only |
| `AI_PROVIDER_API_KEY`                  | No           | Server only |

Never expose a Supabase service-role credential or an AI provider API key
through a `NEXT_PUBLIC_` variable.

## Repository structure

```text
src/
├── ai/providers/       Future structured AI provider adapters
├── app/                Next.js App Router routes and global styles
├── auth/               Future authentication and authorization boundary
├── components/         Shared user-interface components
├── core/               Future metadata-driven business graph
├── db/supabase/        Future Supabase application integration
├── lib/                Shared application utilities
├── runtime/            Future deterministic experience runtime
└── env.ts              Environment schema and parser
supabase/
├── config.toml         Local Supabase CLI configuration
├── migrations/        Reserved for Milestone 1 database migrations
└── seed.sql            Empty Milestone 0 reset hook
tests/                  Automated tests
```

The future graph engine and experience runtime should be added under the
boundaries defined in the build specification when their milestones begin.

## Integration boundaries

The Supabase and AI directories intentionally contain documentation rather
than placeholder clients. This keeps Milestone 0 free of unused provider
dependencies and prevents accidental production calls before authentication,
tenant scoping, RLS, and structured tool contracts exist.

## Confirmed Milestone 1 guardrails

These decisions are documented here for the next milestone but are not
implemented in this scaffold:

- Tenant routes use `/app/[businessSlug]/...`. The slug is for routing and
  display only; server code must resolve it to a stable business ID and verify
  the authenticated user's membership before tenant access.
- Authorization starts with fixed Owner, Admin, and Staff role defaults.
  `permissions_json` remains available in the future schema, but v0.1 will not
  support custom permission expansion or narrowing.
- Tenant isolation requires real PostgreSQL RLS integration tests against the
  Docker-based local Supabase environment, using the same workflow in CI.
