# Supabase project

This directory contains the local Supabase CLI configuration, schema
migrations, and reset hook used by developers and CI.

- `config.toml` configures the Docker-based local Supabase stack.
- `migrations/` contains forward-only versioned database changes.
- `seed.sql` is an intentionally empty reset hook. The Bedford fixture is
  installed explicitly with `npm run demo:seed` through the M5 lifecycle.

Use the npm scripts documented in the repository README rather than relying on
a globally installed Supabase CLI. This keeps local development and CI on the
same CLI version.

Normal application roles, including `service_role`, cannot directly mutate the
eight versioned configuration projection tables. Do not add fixture grants or
public setup RPCs to work around that boundary; integration setup belongs in
the test-only database-owner helper.

Phase 10A's forward migration keeps Location creation outside the M5
configuration lifecycle. It validates existing timezone/name data before
installing the `private.normalize_location_name(name)` index (NFKC, trim,
locale-neutral lower case) and fails clearly rather than rewriting conflicts.
The authenticated state-read and strict expected-state
`create_location` RPCs are the only normal application creation boundary.
