# Unified Lenni Product Experience Redesign v1 — C3 checkpoint

## Checkpoint record

- Checkpoint: C3 — Tables, Saved Views and structural controls
- Branch: `redesign/c3-tables-views-properties`
- Feature SHA: recorded after the final checkpoint commit
- PR: recorded after publication
- Merge SHA: recorded after the normal merge
- Authority: Sections 8 and 9 of the Unified Lenni Product Experience
  Redesign v1 execution prompt, the Design System and UX Constitution v2, and
  the existing Table kernel contracts

## Scope delivered

- Reused the production Table kernel, React Data Grid editing and selection,
  existing Saved View query actions, column menus, structural actions, and
  current direct/configured-form creation boundaries.
- Added an explicit `Table` context marker to the workspace Table title
  hierarchy.
- Added a visible first-record action that focuses the existing direct-create
  draft row, plus the existing configured-form fallback when a safe route is
  available. No new creation or persistence path was introduced.
- Added an honest empty Table state that distinguishes direct creation,
  configured-form creation, and unavailable creation.
- Tightened the scoped Table presentation for title/save status, View tabs,
  Saved View query controls, grid metadata, status surfaces, column menus and
  narrow-screen layout. Empty header-content wrappers are suppressed so
  primary Tables do not acquire decorative blank separators.
- Kept the existing save-state taxonomy (`Saving…`, `Saved`, `Could not save`),
  structural errors, read-only guards, currentness checks and role-authoritative
  server actions unchanged.

## Browser evidence

Evidence was captured against the local Bedford Bakery and Lenni Connections
demo fixtures after the C3 implementation was rendered by the local Next
server.

### Before

- Populated Appointments: `/private/tmp/lenni-c3-before-populated-appointments-1440x900.png`
- Populated Appointments: `/private/tmp/lenni-c3-before-populated-appointments-1024x768.png`
- Populated Appointments: `/private/tmp/lenni-c3-before-populated-appointments-390x844.png`
- Empty Orders: `/private/tmp/lenni-c3-before-orders-1440x900.png`
- Empty Orders: `/private/tmp/lenni-c3-before-orders-390x844.png`

### After

- Populated Appointments: `/private/tmp/lenni-c3-after-populated-appointments-1440x900.png`
- Populated Appointments: `/private/tmp/lenni-c3-after-populated-appointments-1024x768.png`
- Populated Appointments: `/private/tmp/lenni-c3-after-populated-appointments-390x844.png`
- Empty Orders: `/private/tmp/lenni-c3-after-empty-orders-1440x900.png`
- Empty Orders: `/private/tmp/lenni-c3-after-empty-orders-1024x768.png`
- Empty Orders: `/private/tmp/lenni-c3-after-empty-orders-390x844.png`

Observed acceptance points:

- The populated Appointments table retains the Name, Pet, Date, Services and
  Status columns, visible data, active `Saved` state, add-column control and
  property menu affordances.
- The empty Orders table presents a centered empty state and preserves the
  configured creation guidance without inventing a direct row path.
- At 390×844, the document and body widths remain 390px; the table remains a
  controlled matrix surface rather than causing page overflow.
- At 390×844, property menu affordances remain visible on touch-sized headers.
- On the direct Customers fixture, activating `New customer` moves focus into
  the existing draft grid cell. No record was submitted during evidence
  capture.
- The existing mobile shell remains present with Home, Work, Tell Lenni and
  More navigation; C3 did not alter its role or focus behavior.

## Verification

- Focused C3 suite: 5 files, 41 tests passed.
- Complete unit/contract suite: 77 files, 822 tests passed.
- Next route type generation passed.
- TypeScript passed with `--incremental false` (the sandbox cannot write the
  repository `tsconfig.tsbuildinfo` cache).
- ESLint passed with zero warnings.
- Prettier check passed.
- Production Next build passed.
- PostgreSQL integration suite: 24 files passed, 256 tests passed, 5 skipped;
  one isolated configuration-preview assertion initially differed only in
  array ordering for two `location_ids` during the parallel suite. The exact
  file was rerun in isolation and passed (3 executed, 5 skipped). This C3
  change does not touch configuration or preview logic.
- RLS coverage passed as part of the integration run.
- Local Supabase schema lint passed with no schema errors.

## Decisions, exclusions and carried debt

- Decision: keep the existing kernel as the only Table primitive and make the
  new action/empty-state presentation consume its existing callbacks and
  capability discriminant.
- Decision: keep the visual treatment scoped under `.workspace-table-page`; no
  broad route migration or token duplication was added.
- Excluded: new Field types, formulas/rollups, query language, bulk engine,
  persistence model, Saved View semantics, AI/provider changes, migrations,
  dependencies, routes and future-checkpoint surface redesign.
- Carried debt: final high-fidelity polish of connected Record detail and
  later checkpoint surfaces remains deferred to C4+; this checkpoint only
  strengthens the shared Table workspace foundation and its existing routes.
