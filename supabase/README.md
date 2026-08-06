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

Phase 12A adds the authenticated generic Record state and confirmed-create
RPCs. They are intentionally narrow and disabled from anonymous/public use;
they lock the Business/Object in a fixed order, compare a PII-free expected
state, and insert through the existing graph trigger. The migration adds no
Record-specific table, receipt table, queue or configuration-version path.

Phase 12B keeps Record updates in the generic graph. Its one chronological
migration adds bounded exact-selector target resolution and the authenticated
confirmed update RPC; it does not add Product, Equipment, Catering Enquiry,
history, queue, receipt or configuration tables. PostgreSQL rechecks the
Business head, Object schema, selector uniqueness and target digest before
calling the existing graph update boundary. The migration file is
`20260806100000_milestone_12_phase_12b_record_update.sql`.
