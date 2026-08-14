# Unified Lenni Product Experience Redesign v1 — C4 checkpoint

## Checkpoint record

- Checkpoint: C4 — Connections, Record experiences and Forms
- Branch: `redesign/c4-connections-record-forms`
- Feature SHA: `0ff72c846ef7a0d6acb88d116c223f828ee6549a`
- PR: [#44](https://github.com/benjaminbutty/smbos26/pull/44)
- Merge SHA: `df9fd6fb6cf4b524dae0a5302a7453478b55e415`
- Authority: Sections 8 and 9 of the Unified Lenni Product Experience
  Redesign v1 execution prompt, the Design System and UX Constitution v2,
  the Stitch Reference Manifest, and the existing Record/Form kernel contracts

## Scope delivered

- Reused the existing Record panel, Record detail renderer, Connection picker,
  server search/create callbacks, Record write services and role-authoritative
  route actions.
- Made Connection cells discoverable with `Connect to …` labels, explicit
  `One record` / `Several records` modes, searchable results, honest empty and
  unavailable states, selected-record chips, and explicit unlink controls.
- Kept connection edits operational and scoped: one-record replacement,
  several-record add/remove, existing relationship validation and existing
  authorization remain the source of truth.
- Strengthened the Record drawer hierarchy with `Related work` / `Connections`,
  mode context, empty/read-only presentation, and a clear `Open full record`
  route into the existing full Record surface.
- Strengthened the full Record surface with a Record eyebrow, grouped `Key
  information`, related Connections, contextual actions and responsive
  one-column behavior without introducing concept-specific widgets.
- Strengthened the generic create/edit Form anatomy with consequence copy,
  help-text relationships, required markers, stable Cancel/Save actions and
  preview/read-only treatment. The existing shared field controls and
  connection picker remain reused.
- Preserved Staff read-only structural behavior and operational Record edits;
  no new capability, route, state framework, dependency, persistence model or
  relationship semantics was added.

## Browser evidence

Evidence was captured against the local Lenni Connections demo and Bedford
Bakery fixtures after the C4 implementation was rendered by the local Next
server. The populated order used for Record/Form evidence was the existing
browser fixture `C4 Browser Fixture` (`PO-A100A7D1`); no product fixture or
schema capability was added.

### Before

- Full Record, mobile: `/private/tmp/lenni-c4-before-full-record-390x844.png`
- Record drawer, mobile: `/private/tmp/lenni-c4-before-drawer-390x844.png`
- Edit Form, mobile: `/private/tmp/lenni-c4-before-edit-form-390x844.png`

### After — Owner/manual operation

- Record drawer, desktop: `/private/tmp/lenni-c4-after-drawer-1440x900.png`
- Record drawer, 1024px: `/private/tmp/lenni-c4-after-drawer-1024x768-top.png`
- Record drawer panel, 1024px: `/private/tmp/lenni-c4-after-drawer-1024x768-panel.png`
- Record drawer, mobile: `/private/tmp/lenni-c4-after-drawer-390x844.png`
- Connection search empty state, mobile:
  `/private/tmp/lenni-c4-after-picker-empty-390x844.png`
- Full Record, desktop: `/private/tmp/lenni-c4-after-full-record-1440x900.png`
- Full Record, 1024px: `/private/tmp/lenni-c4-after-full-record-1024x768.png`
- Full Record, mobile: `/private/tmp/lenni-c4-after-full-record-390x844.png`
- Edit Form, desktop: `/private/tmp/lenni-c4-after-edit-form-1440x900.png`
- Edit Form, 1024px: `/private/tmp/lenni-c4-after-edit-form-1024x768.png`
- Edit Form, mobile: `/private/tmp/lenni-c4-after-edit-form-390x844.png`

### After — Staff/read-only operation

- Staff Home and role-filtered shell, mobile:
  `/private/tmp/lenni-c4-after-staff-home-390x844.png`
- Staff Record drawer with structural read-only controls, mobile:
  `/private/tmp/lenni-c4-after-staff-readonly-drawer-390x844.png`

Observed acceptance points:

- One-record and several-record Connection modes are visible in the picker;
  selected links show chips/rows and explicit Remove actions, while protected
  workflow-managed links remain read-only.
- Search results, no-match empty state, and unavailable/retry presentation are
  explicit and live-region labelled; Escape closes the picker without closing
  the Record drawer.
- The Record drawer is a coherent desktop side panel and a full-width stacked
  mobile surface. The full Record route groups key information and related
  work and remains usable at 1440×900, 1024×768 and 390×844.
- The generic edit Form exposes consequence copy, required state, help text,
  Cancel and Save actions. The action row remains usable on a 390px viewport.
- Staff evidence shows server-authoritative role filtering and structural
  read-only controls while the existing operational status edit remains
  available. No irrelevant Location widget is introduced.
- At the captured mobile and 1024px drawer states, `bodyScrollWidth` and
  `documentScrollWidth` equal the viewport width; no accidental page overflow
  was observed.
- AI-disabled/manual operation remains inherited from the C1/C2 contract; C4
  adds no AI surface or provider behavior.

## Verification

- Focused C4 suite: 7 files, 56 tests passed.
- Complete unit/contract suite: 77 files, 822 tests passed.
- Next route type generation and TypeScript passed.
- ESLint passed with zero warnings.
- Prettier check passed.
- Production Next build passed with the repository's documented CI-only
  `ACQUISITION_RATE_LIMIT_SECRET` build fixture.
- PostgreSQL integration and RLS coverage: 25 files passed, 257 tests passed,
  5 skipped.
- Local Supabase schema lint passed with no schema errors.
- Exact-head GitHub CI passed in [run 31837725748](https://github.com/benjaminbutty/smbos26/actions/runs/31837725748) on the feature SHA.

## Decisions, exclusions and carried debt

- Decision: keep the existing Record panel, Connection picker, full Record
  renderer, Form renderer and field controls as the shared abstractions; C4
  adds only the missing presentation and interaction states at those seams.
- Decision: keep Location contextual and capability-scoped. C4 does not make
  Location universal.
- Excluded: notes/timelines, payment/order widgets, AI insight panels, new
  relationship semantics, history/undo, public editing, concept-specific
  Record components, graph/configuration UI, migrations and dependencies.
- Carried debt: later checkpoints still own broader route-specific polish,
  richer operational views and cross-business responsive/accessibility
  acceptance. C4 does not redesign those surfaces.
