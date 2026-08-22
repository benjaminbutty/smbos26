# J3-I3 Internal Pages evidence ledger

Date: 22 August 2026

Branch: `codex/j3-i3-internal-pages`

Base: `43e45536d354942ec8f544a1436632c8ba14586e`

## Owner journey

Route: `/app/proof-milk-round/pages/this-week`

Using the generic Milk round proof Business, the Owner created **This week**, then:

1. added and edited a Heading (`Milk round priorities`);
2. added and edited Text;
3. inserted a Divider;
4. selected the exact **Standing Orders → Active Orders updated** Saved View;
5. operated the `Workspace flag` Record value inside the embedded View; and
6. retained the bounded `Open Table` route to the exact Saved View.

The embedded workspace exposed Record operation but no Table, Property, Connection or Saved View structural controls.

## Configuration and operational lanes

The proof Business configuration history for the Page was:

| Completed action | Base revision | Version |
| --- | ---: | ---: |
| Create Page | 20 | 21 |
| Add Heading | 21 | 22 |
| Edit Heading | 22 | 23 |
| Add Text | 23 | 24 |
| Edit Text | 24 | 25 |
| Add Divider | 25 | 26 |
| Add exact Saved View | 26 | 27 |

Every completed Page action produced one applied Change and one immutable Version. The focused integration test separately moves the first block across three positions with one `save_page_layout` action and proves exactly `+1` Change, `+1` Version and `+1` head revision.

Immediately before the embedded Record edit, the Business was at head revision `27`, with `27` configuration Versions and `26` Change rows. After checking `Workspace flag` inside the embedded View, the Record contained `"workspace_flag": true` and those three configuration counts remained `27`, `27`, and `26` respectively.

## Roles

- Owner: title/content authoring, bounded block insertion, exact Saved View insertion, reorder/remove controls and live embedded Record operation were present.
- Staff: the same Page rendered as a clean reading/operating surface. `Add block` and `Rename Page` counts were both zero; `Open Table` and the operational checkbox were both present.

## Responsive and accessibility evidence

The Page was rendered against the same authenticated route at each required viewport. Measurements are the child browsing context's `innerWidth`/`innerHeight`; `scrollWidth === clientWidth` proved no page-level horizontal overflow.

| Viewport | Page width | Horizontal overflow | Page-specific result |
| --- | ---: | --- | --- |
| 1440×900 | 1440 | none (`1440 === 1440`) | full Owner canvas and live embedded Table |
| 1024×768 | 1024 | none (`1024 === 1024`) | deliberate laptop canvas, exact embed and Open Table path |
| 390×844 | 390 | none (`390 === 390`) | mobile navigation, 44px move/remove actions, drag handle hidden |

Keyboard/touch seams are covered by the `/` shortcut, keyboard-reachable inline title/content controls, visible focus styles, explicit mobile move/remove buttons, and reduced-motion CSS. The checked routes exposed no visible runtime error or non-empty alert.

The independent exact-PR review additionally exercised the stale-conflict
design. When the latest Page no longer contains a compatible block for an open
Heading/Text draft, the draft stays visibly selectable with an explicit
`Discard draft` action and remains covered by the navigation-loss warning. It
cannot be saved against the removed block or silently recreated.

Durable screenshots:

- `docs/evidence/j3-i3-page-1440x900.png`
- `docs/evidence/j3-i3-page-1024x768.png`
- `docs/evidence/j3-i3-page-390x844.png`
- `docs/evidence/j3-i3-page-staff-1440x900.png`

## Focused verification

Passed locally:

- `npm run check` — formatting, generated route types, TypeScript, ESLint and 961/961 unit tests
- `npm run build` — production build passed
- `npm run check:migration-immutability` — 42 historical migrations unchanged
- `npm run supabase:reset` — clean local replay passed
- `npm run supabase:lint` — no schema errors
- `vitest run --config vitest.integration.config.ts tests/integration/direct-page-workspace.test.ts tests/integration/experience.test.ts tests/integration/initial-preorder.test.ts tests/integration/journey-1-public-capabilities.test.ts` — 32/32 (including the focused 7/7 Direct Page rerun with Admin authoring)
- `vitest run --config vitest.integration.config.ts tests/integration/rls.test.ts` — 19/19

The final exact-head verification is recorded in the checkpoint handoff after the clean PR-diff review.

## Exact changed files

- `docs/lenni-journey-3-product-architecture-brief.md`
- `docs/evidence/j3-i3-ledger.md`
- `docs/evidence/j3-i3-page-1440x900.png`
- `docs/evidence/j3-i3-page-1024x768.png`
- `docs/evidence/j3-i3-page-390x844.png`
- `docs/evidence/j3-i3-page-staff-1440x900.png`
- `src/app/app/[businessSlug]/pages/[pageSlug]/page.tsx`
- `src/app/globals.css`
- `src/runtime/page-editor/page-editor.tsx`
- `tests/direct-page-workspace.test.ts`
- `tests/integration/direct-page-workspace.test.ts`
- `tests/lenni-unified-ui.test.ts`

Migrations: none.

## Exclusions

No migration, Page primitive, block type, editor document, persistent draft, collaboration system, Page-level query builder, Site publication behavior or Journey 4 work was added.
