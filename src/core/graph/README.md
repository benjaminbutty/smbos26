# Graph engine

This module is the generic server boundary for SMBOS graph configuration and
operational data. Callers provide an authenticated Supabase client and a
server-resolved Business ID; the service never accepts `business_id` or
`created_by` in record input. Every operational RPC receives that resolved
Business ID explicitly and matches resource UUIDs within it, so an identifier
cannot switch a tenant-scoped service into another Business.

PostgreSQL is authoritative for tenant consistency, record validation,
`created_by` derivation, relationship type checks and cardinality. The Zod
schemas here validate operation shapes early, while database triggers protect
the same invariants from direct PostgREST callers.

Record validation and Field configuration changes serialize through locks on
their shared Object definition. Record writers use compatible shared locks, so
normal concurrent writes remain possible. Active Relationships likewise keep
their source and target Objects from being archived until the Relationship is
archived explicitly.

`relationship_definitions.is_required` is metadata only in Milestone 2.
Storage enforcement is deferred until a future transactional operation can
create a Record and its required Relationships atomically.

Business concepts belong in object, field and relationship definitions. Do not
add concept-specific service functions or persistence models.
