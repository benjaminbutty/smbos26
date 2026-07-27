# Supabase project

This directory contains the local Supabase CLI configuration used by
developers and CI. It intentionally defines no SMBOS application schema during
Milestone 0.

- `config.toml` configures the Docker-based local Supabase stack.
- `migrations/` will contain versioned database changes beginning in Milestone 1.
- `seed.sql` is an intentionally empty reset hook until development fixtures
  are required.

Use the npm scripts documented in the repository README rather than relying on
a globally installed Supabase CLI. This keeps local development and CI on the
same CLI version.
