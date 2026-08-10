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
history, queue, receipt or configuration tables. PostgreSQL owns the exact
zero/one/multiple match result, returns no candidate rows, and the final call
rechecks the Business head and target `updated_at` before writing through the
existing graph validation trigger. The migration file is
`20260806100000_milestone_12_phase_12b_record_update.sql`.

The workspace-foundation migration
`20260809110000_workspace_foundation_pages.sql` extends the existing Page
grammar and adds one authenticated direct Page configuration facade. It uses
the existing versioned configuration projections and M5 lifecycle; it adds no
editor document table, custom business table, queue, cache, or raw operation
endpoint. Empty Pages, stable block IDs, Callouts, and read-only embedded View
metadata are validated in PostgreSQL as well as in TypeScript.

The Lenni Table migration
`20260810120000_lenni_table_experience.sql` extends the same boundary without
adding a domain table or primitive. `apply_lenni_direct_configuration_change`
handles only `insert_column` and `change_column_type` for Owner/Admin users,
preserving Field identity and rejecting incompatible active or archived Record
values without conversion. `apply_direct_table_record_batch` handles bounded
operational paste and range clearing for one live internal Table View, with
100-row and 500-cell limits, server-side tenant/Field/Record re-resolution,
typed and required validation, and per-Record atomicity. Neither action adds
operational data to configuration history; embedded Tables keep structural
controls disabled.
