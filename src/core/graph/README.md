# Graph engine

This module is the generic server boundary for SMBOS graph configuration and
operational data. Callers provide an authenticated Supabase client and a
server-resolved Business ID; the service never accepts `business_id` or
`created_by` in record input.

PostgreSQL is authoritative for tenant consistency, record validation,
`created_by` derivation, relationship type checks and cardinality. The Zod
schemas here validate operation shapes early, while database triggers protect
the same invariants from direct PostgREST callers.

Business concepts belong in object, field and relationship definitions. Do not
add concept-specific service functions or persistence models.
