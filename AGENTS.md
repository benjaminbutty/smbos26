# SMBOS repository instructions

## Source of truth

Before implementing any feature, read:

1. `docs/PRODUCT-NORTH-STAR.md`
2. `docs/LENNI-DESIGN-GUIDANCE-V2.md` for any owner-facing visual or interaction work
3. `docs/SMBOS-v0.1-Build-Spec.md`
4. `docs/architecture-decisions.md` and relevant ADRs
5. relevant existing tests

`docs/LENNI-DESIGN-GUIDANCE-V2.md` is the current visual authority. Historical
Lenni redesign documents are evidence and implementation history unless that
guide explicitly preserves one of their boundaries.

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
3. Reconcile the checked-out SHA, merged baseline and local preview before
   treating prior work as a new review target.
4. Implement the smallest complete change.
5. Add or update tests.
6. Run typecheck, lint and tests.
7. For owner-facing visual or interaction changes, capture browser-rendered
   desktop, tablet and mobile states and execute the affected keyboard/focus
   journeys. Source assertions, unit tests and coordinator tests do not alone
   establish product acceptance.
8. For every transient menu, popover or sheet changed, verify an outside
   pointer/tap dismisses it without preventing the intended target action or
   stealing its focus, Escape closes it with the appropriate focus return, and
   keyboard access remains usable.
9. Summarise changes, commands run and any architectural tension discovered.

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
