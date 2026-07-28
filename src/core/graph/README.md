# Graph engine

This module is the generic server boundary for SMBOS graph runtime reads and
operational data. Callers provide an authenticated Supabase client and a
server-resolved Business ID; the service never accepts `business_id` or
`created_by` in record input. Every operational RPC receives that resolved
Business ID explicitly and matches resource UUIDs within it, so an identifier
cannot switch a tenant-scoped service into another Business.

PostgreSQL is authoritative for tenant consistency, record validation,
`created_by` derivation, relationship type checks and cardinality. The Zod
schemas here validate operation shapes early, while database triggers protect
the same invariants from direct PostgREST callers.

Record validation and change-set projection serialize through locks on their
shared Object definition. Record writers use compatible shared locks, so
normal concurrent writes remain possible. Active Relationships likewise keep
their source and target Objects from being archived until the Relationship is
archived through an applied proposal.

`relationship_definitions.is_required` remains metadata for standalone generic
Record operations. The Milestone 4 trusted preorder transaction creates its
configured required Records, Relationships and Location link atomically using
the same graph triggers; it does not weaken or duplicate graph validation.

Business concepts belong in object, field and relationship definitions. Do not
add concept-specific service functions or persistence models.

Object, Field, and Relationship definitions are read-only through this service.
Owner/Admin changes must use `ConfigurationChangeService`; direct table DML is
unavailable to authenticated and service-role clients. Integration tests that
exercise lower-level graph constraints use the test-only database-owner helper
under `tests/integration/support`, never production code.
