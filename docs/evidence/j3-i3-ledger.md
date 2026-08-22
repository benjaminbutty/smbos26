# J3-I3 Internal Pages evidence ledger

Date: 22 August 2026

Branch: `codex/j3-i3-internal-pages`

Base: `43e45536d354942ec8f544a1436632c8ba14586e`

## Product-acceptance correction

The first PR #65 screenshots were not accepted as the Journey 3 Page product.
They showed the supported operations, but the surface still read as a form-like
editor. Those screenshots are superseded by the evidence in this ledger.

The revised implementation keeps the existing Direct Page architecture and
recomposes it as the bounded Notion-style canvas required by the brief:

- a quiet document rail with title, content and the live exact-View embed;
- an Editing/Reading switch for Owner/Admin and no authoring chrome for Staff;
- contextual `+` and grip controls in the block gutter;
- one finite insert menu shared by `/` and the contextual `+`;
- local Heading/Text drafts that create the finished block in one action;
- selection plus explicit move/remove actions on touch; and
- a clean reading state that leaves the embedded Table operational.

The Claude reference informed the content rail, gutter, insertion menu and
reading-state hierarchy. Its universal Review/Apply bar, arbitrary document
grammar and durable batching assumptions were deliberately not adopted.

## Owner journey

Browser proof route:
`/app/phase-13a-085514d6-56fa-43c8-bfbe-09b77cd2cd7b/pages/orders`

Using an existing generic proof Business, the Owner opened the exact Orders
Page and shaped it in place:

1. renamed the Page to **This week**;
2. edited the existing Heading to **Priorities** and selected the owner-readable
   **Medium** size;
3. opened the shared insert menu from the Heading's contextual gutter `+`;
4. inserted finished Text immediately after that Heading in one coherent action;
5. retained the exact **Orders** Saved View as a live embedded workspace;
6. used **Open Table** to retain the bounded path to the source Table; and
7. switched to **Reading**, which removed the authoring chrome while keeping the
   exact embedded workspace live.

The authoritative Page layout after those actions was ordered as Heading, Text,
exact Saved View. The embedded workspace exposed Record operation but no Table,
Property, Connection or Saved View structural controls.

## Configuration and operational lanes

The browser proof began at Business head revision `4` and finished at revision
`9`, with `9` configuration Versions and `9` applied Change rows. The five
completed Page actions were Page rename, Heading text update, coherent Text
insertion, Heading text refinement and Heading size update. Each action advanced
the head by exactly one and created exactly one immutable Version.

The insertion proof is material: the browser submitted only the bounded new
block and an expected existing `afterBlockId`; the server resolved and
validated that insertion point from the authoritative stable layout and created
the finished Text block in one Version. There was no placeholder block,
follow-up edit Version or client-owned operation list.

The focused Direct Page integration test separately moves the first block across
three positions with one final `save_page_layout` action and proves exactly `+1`
Change, `+1` Version and `+1` head revision. The Experience and public capability
regressions prove that ordinary embedded Record operations remain operational
and create no configuration Version.

## Roles

- Owner: title/content authoring, insertion-point menus, bounded block
  insertion, reorder/remove controls, Reading mode and live embedded Record
  operation were present.
- Admin: the focused integration suite proves the same bounded Direct Page
  authoring authority.
- Staff: `/app/bedford-bakery-demo/pages/orders` rendered as a clean
  reading/operating Page. Create Page, Rename, Editing/Reading and block-gutter
  controls were absent; the exact embed and **Open Table** remained present.

## Responsive and accessibility evidence

The owner canvas was rendered at each required viewport. Measurements use the
child browsing context's `innerWidth`/`innerHeight`; `scrollWidth === clientWidth`
proved no page-level horizontal overflow.

| Viewport | Page width | Horizontal overflow | Page-specific result |
| --- | ---: | --- | --- |
| 1440x900 | 1440 | none (`1440 === 1440`) | insertion menu at the selected Heading, document rail and live exact-View embed |
| 1024x768 | 1024 | none (`1024 === 1024`) | quiet resting canvas with complete embed and Open Table path |
| 390x844 | 390 | none (`390 === 390`) | selected Text block with explicit Edit, Move up, Move down and Remove touch actions |

Keyboard/touch seams are covered by the shared `/` shortcut, keyboard-reachable
gutter and menu controls, visible focus/selection states, explicit mobile move
actions, touch-sized targets and reduced-motion CSS. The final checked routes
showed no product runtime error or warning. During implementation, browser proof
did expose an event-lifetime crash in the local draft path; it was repaired
before these screenshots and covered by the final unit/build gates.

The independent stale-conflict review remains valid. If the latest Page no
longer contains a compatible block for an open Heading/Text draft, the draft
stays visibly selectable with an explicit `Discard draft` action and remains
covered by the navigation-loss warning. It cannot save against the removed block
or silently recreate it.

Durable screenshots:

- `docs/evidence/j3-i3-page-1440x900.png` — Owner editing, contextual insert menu
- `docs/evidence/j3-i3-page-1024x768.png` — Owner editing, resting laptop canvas
- `docs/evidence/j3-i3-page-390x844.png` — Owner editing, selected mobile block
- `docs/evidence/j3-i3-page-reading-1440x900.png` — Owner clean Reading state
- `docs/evidence/j3-i3-page-staff-1440x900.png` — Staff clean operating state

## Focused verification

Passed locally:

- `npm run check` — formatting, generated route types, TypeScript, ESLint and
  962/962 unit tests
- `npm run build` — production build passed
- `npm run check:migration-immutability` — 42 historical migrations unchanged
- `npm run supabase:reset` — clean local replay passed
- `npm run supabase:lint` — no schema errors
- `npx vitest run --config vitest.integration.config.ts --reporter=dot tests/integration/direct-page-workspace.test.ts tests/integration/experience.test.ts tests/integration/initial-preorder.test.ts tests/integration/journey-1-public-capabilities.test.ts`
  — 32/32
- `npx vitest run --config vitest.integration.config.ts --reporter=dot tests/integration/rls.test.ts`
  — 19/19

The final exact-head verification is recorded in the checkpoint handoff after
the clean PR-diff review.

## Exact changed files

- `docs/lenni-journey-3-product-architecture-brief.md`
- `docs/evidence/j3-i3-ledger.md`
- `docs/evidence/j3-i3-page-1440x900.png`
- `docs/evidence/j3-i3-page-1024x768.png`
- `docs/evidence/j3-i3-page-390x844.png`
- `docs/evidence/j3-i3-page-reading-1440x900.png`
- `docs/evidence/j3-i3-page-staff-1440x900.png`
- `src/app/app/[businessSlug]/pages/[pageSlug]/page.tsx`
- `src/app/globals.css`
- `src/core/configuration/direct-pages/composer.ts`
- `src/core/configuration/direct-pages/schemas.ts`
- `src/runtime/page-editor/page-editor.tsx`
- `tests/direct-page-workspace.test.ts`
- `tests/integration/direct-page-workspace.test.ts`
- `tests/lenni-unified-ui.test.ts`

Migrations: none.

## Exclusions

No migration, Page primitive, block type, editor document, persistent draft,
collaboration system, Page-level query builder, Site publication behavior or
Journey 4 work was added.
