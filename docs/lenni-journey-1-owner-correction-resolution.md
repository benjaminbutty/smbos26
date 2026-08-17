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

## R2 implementation checkpoint

R2 closes the Site/Booking boundary without introducing a second Site model:

- `src/core/booking/preview.ts` resolves a draft Booking catalogue from the
  active business graph, configured schedule, business/location timezone, and
  service Records. It supplies the same `BookingExperience` used by the
  published public route, with preview submissions disabled.
- The authenticated Site route now resolves Booking blocks for both draft and
  published Sites, exposes an obvious `Edit Site` / `Preview Site` path, and
  renders bounded title/content/order edits through the existing direct Page
  configuration RPC and currentness boundary.
- Public and Booking honeypots remain submitted but are visually removed from
  normal customer interaction; Booking results use calm customer copy for all
  known failure codes.

R2 local evidence: the public Dogs fixture renders real future slots and
  configured customer/dog fields at `/p/dogs/book`; the Booking honeypot is
  positioned off-screen at `left: -10000`, `1x1`, with `tabIndex=-1`; the local
  public Form/Booking integration suite passes 2/2; and focused renderer/Page
  tests pass 20/20.

## R3 implementation checkpoint

R3 removes the remaining generic Overview instruction from the acquisition
  planning prompt and closes shared interaction seams:

- acquisition planning now explicitly forbids inventing an Overview Page or
  generic schema documentation;
- Page, Site, Table query, and sidebar creation menus close on Escape and
  outside pointer interaction where they remain open;
- direct Page mutation supports both internal Pages and public Sites while
  keeping saved View insertion internal-only; table column reorder remains
  wired to the existing `onColumnsReorder` adapter boundary.

R3 local evidence: the focused acquisition/Page/renderer suite passes 61 tests,
`npm run typecheck`, `npm run lint`, and `git diff --check` pass.

## R4 verification checkpoint

The final verification pass covers the shared runtime and the required owner and
customer surfaces:

- `npm test`: 84 test files and 860 tests pass.
- The Journey 1 public capability integration remains green: the anonymous
  public Form creates one generic Record idempotently, the public Booking
  resolves real slots and creates the configured graph data idempotently, and
  forged capability keys plus direct Record reads are rejected.
- The focused PostgreSQL integration set passes 37 tests across acquisition,
  Experience, initial preorder/publication, and public capabilities; the RLS
  suite passes 19 tests.
- `npm run typecheck`, `npm run lint`, `npm run format:check`,
  `npm run check:migration-immutability`, local Supabase schema lint, and the
  production build pass.
- At 1440x900, 1024x768, and 390x844, authenticated Site editing, the Table
  workspace, and the public Dogs Booking page render without horizontal
  overflow. Mobile visual checks retain the bounded Site editor, `Preview
  Site`, `Add block`, Booking fields, and `Request booking`.
- The public Dogs Booking honeypot remains in the submitted form boundary but is
  off-screen, non-focusable, and hidden from the accessibility tree.

The initial local full integration run was affected by dirty fixture state:
25 of 26 files passed, 260 of 266 tests passed, 1 failed, and 5 were skipped.
After the repository-supported clean Supabase reset, the exact
`ai-accounting.test.ts` command passed 18/18 on both current `main` and this
feature head. Exact-head CI run `32039549568` then passed the clean full
PostgreSQL suite with 26/26 files and 261/266 tests passed (5 skipped), plus
the separate RLS suite with 19/19 tests passed. The fixture failure did not
reproduce after a clean reset and is not a Journey 1 regression.
