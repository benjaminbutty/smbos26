# SMBOS repository instructions

## Source of truth

Before implementing any feature, read:

1. `docs/PRODUCT-NORTH-STAR.md`
2. `docs/SMBOS-v0.1-Build-Spec.md`
3. `docs/architecture-decisions.md`
4. relevant existing tests

Do not silently diverge from these decisions. When implementation evidence conflicts with the spec, explain the conflict and propose the smallest architecture change before coding around it.

## Product rule

SMBOS is for non-technical small-business operators. Technical sophistication belongs in the platform, not the primary user interface.

Businesses may create domain concepts using SMBOS primitives. Only SMBOS creates new platform primitives.

## Architectural invariants

Do not:

- add customer-specific hard-coded conditions;
- create a new SQL table for every custom object;
- allow AI-generated arbitrary code, SQL or `eval` execution;
- bypass Row Level Security with client-side service credentials;
- duplicate Customer/Product/Order data into isolated feature modules;
- add a new primitive merely to solve one niche example;
- add queues, caches, microservices or other infrastructure without a demonstrated requirement;
- expose raw database/graph terminology in the default owner-facing UI.

## Preferred decision rule

When a new requirement appears, first ask:

> Can this be represented safely using the existing primitives and configuration?

Only propose a new reusable platform capability when the requirement cannot be represented safely with the current model and is likely to recur across businesses/use cases.

## Implementation discipline

For each task:

1. State the intended implementation approach.
2. Identify files, tables and interfaces affected.
3. Implement the smallest complete change.
4. Add or update tests.
5. Run typecheck, lint and tests.
6. Summarise changes, commands run and any architectural tension discovered.

## Security

- Every tenant-owned table carries `business_id`.
- Tenant isolation is enforced server-side and with PostgreSQL/Supabase RLS.
- Never trust `business_id` supplied by an LLM or browser without verifying it against the authenticated membership.
- AI can only invoke allow-listed, schema-validated server operations.
- Published public forms write through narrow validated server endpoints/RPCs.

## AI boundary

The AI plans and configures. The runtime executes deterministic platform code.

The AI must never receive a tool for arbitrary SQL, source-code modification, shell execution or unvalidated generic HTTP requests inside the production SMBOS application.

## v0 proof

Preorder is the first vertical slice, not the product category.

After preorder works, the next proof is to create a `Catering Enquiry` concept using existing primitives, without a source-code change or new database migration.
