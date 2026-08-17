# Lenni Journey 1 Owner-Acceptance Correction Resolution

## Scope

This note records the R0 baseline for the Journey 1 owner-acceptance corrections.
It is intentionally limited to acquisition refinement, candidate quality, the
shared Site/Page boundary, public Booking/Form UX, and the small shared-shell
interactions named by the execution prompt. Journey 2, the authenticated
Tell Lenni/Changes redesign, and the Tiptap/Notion Page editor remain out of
scope.

## Baseline

- Repository baseline: `04032655abca38e97ab95d0814fb8024f1ea1b35`
- Branch: `codex/journey1-owner-correction-r0`
- Local Supabase fixture: Bedford Bakery demo, Version 2, seeded with
  `npm run demo:seed`
- Local acceptance server: Next.js on `http://localhost:3001`
- Focused baseline checks: acquisition (29 tests), public capability/publication
  (14 tests), editor kernel/table workspace (24 tests), and public form/preorder
  (13 tests) all passed.

## Reproduced owner-visible seams

### Refinement is not conservative and leaks implementation wording

The authenticated-free acquisition screen at `/start` displayed the persisted
request with the literal text `Owner refinement: customers should be linked to
repair jobs`. This comes from `refineAcquisitionProposal` concatenating the
original request and refinement before asking for a fresh candidate. The
current implementation therefore gives the model a new full request rather
than a bounded delta over the reviewed candidate, and the owner sees the
internal marker in the editable request.

Relevant seams: `src/core/acquisition/service.ts` and the acquisition request
editor in `src/app/start/page.tsx`.

### Generic acquisition still claims an automatic Overview Page

The `/start` plan reported `Pages: 1`, named the starting page `Overview`, and
described it as an internal starting page. The preview sidebar also exposed
`Overview`. The composer and interpreter currently synthesize this Page for
otherwise valid candidates. This is not required for a valid zero-Page
candidate and makes the generic result look like a template rather than the
owner's configured work.

Relevant seams: `src/core/acquisition/composer.ts`,
`src/core/acquisition/interpreter.ts`, and the acquisition plan/preview model.

### Site review is not yet a coherent owner-editable artifact

The authenticated Bedford Site route at
`/app/bedford-bakery-demo/sites/preorder` rendered a `Read-only Site preview`
and a public link, but no `Edit Site` affordance or bounded owner controls for
title, blocks, ordering, or Booking/Form configuration. The route resolves
public Forms but does not resolve Booking blocks for the authenticated draft
surface. The public route and candidate preview use the shared PageRenderer,
but the authenticated Site route does not yet supply the same runtime
capabilities.

Relevant seams: `src/app/app/[businessSlug]/sites/[pageSlug]/page.tsx`,
`src/app/app/[businessSlug]/sites/actions.ts`, and the public/candidate
PageRenderer adapters.

### The public customer form exposes the honeypot

The public preorder page at
`/p/bedford-bakery-demo/preorder` visibly rendered `Website` and an unlabeled
textbox alongside customer fields. The current honeypot is only removed from
tab order; it is not hidden from the customer-facing layout/accessibility tree.
The server-side rejection boundary already checks that the submitted honeypot
value is empty and must be retained.

Relevant seams: `src/runtime/booking/booking-experience.tsx`, the shared public
form renderer, and the public booking/preorder API boundaries.

## Resolution approach

1. Add a deterministic current-candidate refinement/reconciliation boundary.
   Preserve unrelated reviewed concepts and relationships, permit only explicit
   owner-authorized removals, and produce an owner-readable diff without
   persisting internal prompt markers.
2. Add generic candidate quality validation for duplicate labels, invalid
   cross-object mappings, unusable required forms, empty choice/status options,
   and relationship/scalar duplication. Keep the validator independent of
   dog-grooming or Bedford-specific names.
3. Make zero Pages a valid acquisition result and stop synthesizing a generic
   Overview Page by default.
4. Make candidate, authenticated draft, and published Site use the same bounded
   PageRenderer capability model, then add the minimum owner Site controls and
   the existing proposal/publication boundary.
5. Hide the public honeypot without removing it from submitted FormData, map
   all known Booking result codes to calm customer copy, and verify the real
   Booking transaction remains trusted and payment-free.
6. Repair shared dismissal/shell affordances and either implement reliable
   column drag or remove the misleading drag affordance while retaining the
   explicit Move left/Move right action.

## Architecture and AI boundary

No new AI subject is introduced by R0. The existing acquisition planning path
remains the only model boundary; deterministic validation, preservation, diff,
proposal, validation, apply, and publication continue to own the authoritative
decisions. External AI qualification/reliability gates remain disabled and
network-free CI remains the default.

## Checkpoint plan

- R0: this baseline and resolution note.
- R1: conservative refinement and generic candidate quality validation.
- R2: coherent Sites/Page capability and Booking boundary.
- R3: Overview removal, shared shell/menu/column corrections, and responsive
  owner/customer polish.
- R4: browser acceptance at 1440x900, 1024x768, and 390x844; database/RLS,
  migration immutability, typecheck/lint/build, security checks, exact-head CI,
  and final owner handoff.

## R1 implementation checkpoint

R1 implements the bounded acquisition correction without adding an AI subject:

- `src/core/acquisition/refinement.ts` reconciles a generated suggestion against
  the current candidate, preserves unrelated operations, limits deletion to
  explicit owner selectors, and emits an owner-readable change summary.
- `src/core/acquisition/quality.ts` validates generic Object/Field/Connection,
  View/Form/Page, and Booking mapping invariants before a candidate is written.
- `src/core/acquisition/capabilities.ts` now keeps relationship direction
  explicit when adding reusable Booking Connections.
- Acquisition tests cover zero-Page candidates, quality rejection cases,
  valid Booking mappings, preservation, explicit removal, and refinement
  feedback without prompt-marker leakage.

R1 local evidence: the focused acquisition suite passes 67 tests and
`npm run typecheck` passes. The checkpoint is still pending remote PR/CI
publication because the configured local GitHub CLI token is invalid.
