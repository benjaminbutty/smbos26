# Unified Lenni Product Experience Redesign v1 — C5 checkpoint

## Checkpoint record

- Checkpoint: C5 — Pages and embedded Views
- Branch: `redesign/c5-pages-dashboard`
- Feature implementation SHA: `9a3a2842b187f693a96a6bfdbd28ece0c4a30d7a`
- PR, final exact-head SHA, merge SHA and CI run: recorded in the checkpoint
  ledger after publication
- Authority: Sections 8, 9 and 13 of the Unified Lenni Product Experience
  Redesign v1 execution prompt, the Design System and UX Constitution v2,
  the Stitch Reference Manifest, and the existing Page/editor-kernel contracts

## Scope delivered

- Kept the existing bounded `PageEditor`, strict Page grammar, persisted
  `move_page_block` / `remove_page_block` / `add_page_block` actions, currentness
  checks and `PageRenderer` read-only branch as the source of truth.
- Added direct keyboard-accessible editing for supported Heading and Text
  blocks while retaining the existing explicit Edit action and form adapter.
- Added a visible `/` insertion affordance, `aria-keyshortcuts`, labelled add
  menu, expanded-state relationship and polite save-state live region.
- Added native drag-to-reorder affordance backed by repeated existing adjacent
  move actions, with the existing Up/Down controls retained as the keyboard and
  touch fallback. Remove remains the existing confirmed action.
- Reframed the owner Page as a calm readable canvas: compact title hierarchy,
  quiet currentness state, transparent canvas, clear block boundaries and a
  deliberate Saved View panel with the existing production Table renderer and
  Open Table path.
- Kept embedded Table overflow local to the embedded grid shell at mobile
  widths. The existing Table empty state and action path remain the renderer's
  responsibility.
- Added the focused Page contract to the existing unified UI test suite and
  reduced-motion treatment to the Page presentation.
- Added no route, schema, dependency, state framework, renderer or capability.

## Browser evidence

Evidence uses the real local Lenni Connections Demo Owner fixture and the
existing `C5 Evidence Page` configuration. The temporary Text block and empty
Customers View used during interaction checks were removed afterwards; the
fixture was restored to Heading → Text → Appointments Saved View.

### Before

- Empty Page, desktop:
  `/private/tmp/lenni-c5-before-empty-page-1440x900.png`
- Populated Page, desktop:
  `/private/tmp/lenni-c5-before-populated-page-1440x900.png`
- Populated Page, 1024px:
  `/private/tmp/lenni-c5-before-populated-page-1024x768.png`
- Populated Page, mobile:
  `/private/tmp/lenni-c5-before-populated-page-390x844.png`

### After — Owner/manual operation

- Populated Page, desktop:
  `/private/tmp/lenni-c5-after-populated-page-1440x900.png`
- Populated Page, 1024px:
  `/private/tmp/lenni-c5-after-populated-page-1024x768.png`
- Populated Page, mobile:
  `/private/tmp/lenni-c5-after-populated-page-390x844.png`
- Empty Page, desktop:
  `/private/tmp/lenni-c5-after-empty-page-1440x900.png`
- Empty Page, mobile:
  `/private/tmp/lenni-c5-after-empty-page-390x844.png`
- Empty Customers Saved View with its existing Open Table path, mobile:
  `/private/tmp/lenni-c5-after-empty-embedded-view-390x844.png`

Observed acceptance points:

- `/` opens the existing Add block menu from the focused Page canvas; the
  menu is labelled and the Add button exposes its expanded relationship.
- Activating a Heading or Text block enters the existing bounded form with
  initial focus in the input/textarea. Cancel leaves persisted content intact.
- Blocks expose a drag handle, keyboard/touch-safe Up/Down controls and the
  existing confirmed Remove action. The drag path uses the same currentness-
  checked adjacent move action rather than a second persistence path.
- Save, stale and failure language stays in the existing Page action flow; the
  save state is a polite live region and stale/error feedback remains an alert.
- The embedded Appointments View retains real Milo data, its production Table
  actions, Saved View framing and Open Table route. The Customers View check
  exercised the real empty embedded Table surface without mock records.
- At 1440×900, 1024×768 and 390×844, `document.body` and
  `document.documentElement` widths matched the viewport. At 390px the
  embedded grid shell measured 332px wide with a 576px internal scroll width,
  keeping horizontal overflow local to the embedded View.
- The browser console contained only expected React DevTools/HMR informational
  messages; no runtime error was recorded.
- The live fixture is Owner/manual. Admin uses the same `manage_configuration`
  capability projection; Staff is routed through `PageRenderer` with no
  structural editor controls. The current local Staff identity has no seeded
  Business membership, so no synthetic Staff Page screenshot was created.
  AI is not involved in Page editing; manual operation remains available.

## Verification

- Focused C5 suites: 3 files, 23 tests passed.
- Next route type generation and TypeScript passed.
- ESLint passed with zero warnings.
- Prettier check passed.
- Full unit/contract suite: 77 files, 823 tests passed.
- Clean Supabase integration suite: 25 files, 257 tests passed, 5 intentional
  skips; the local database was stop/start/reset and reseeded before this run.
- Local Supabase schema lint passed with no schema errors.
- Production Next build passed with the documented CI-only
  `ACQUISITION_RATE_LIMIT_SECRET` fixture.
- The local image has no `npm` executable, so `npm audit` could not be run here;
  exact-head GitHub CI includes the authoritative production audit step.

## Decisions, exclusions and carried debt

- Decision: reuse the current Page action adapter and the production embedded
  Table renderer; C5 adds presentation and direct manipulation at that seam
  rather than introducing a second renderer or document model.
- Decision: preserve the strict supported grammar. Historical unsupported
  blocks continue through the existing safe fallback/renderer paths; C5 does
  not expand rich text.
- Excluded: general CMS behaviour, media uploads, comments/collaboration,
  custom code, website builder, new Page block types, new Record behaviour,
  AI changes, migrations and dependencies.
- Carried debt: a live Staff/Admin Page screenshot requires a seeded membership
  fixture that is not present in the current local Staff account. The
  server-authoritative route and renderer contracts remain covered by source
  and repository tests; C8 should repeat this check if the fixture is present.
