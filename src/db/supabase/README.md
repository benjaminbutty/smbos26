# Supabase boundary

Supabase clients, generated database types, and tenant-scoped data access
functions belong here starting in Milestone 1.

The future implementation must enforce tenant isolation server-side and
through PostgreSQL Row Level Security. Browser code must never receive a
service-role credential.

No Supabase SDK or database client is part of Milestone 0.
