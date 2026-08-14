# Lenni redesign running checkpoint ledger

This ledger records each checkpoint boundary, its review artifact and the
evidence carried into the next checkpoint.

## Closed checkpoints

### C0 — audit and baseline

- Branch: audit/baseline record (pre-branch evidence)
- Feature SHA: baseline recorded in `docs/lenni-redesign-c0-resolution.md`
- PR: none
- Merge SHA: baseline before C1
- Surfaces: current-state audit, fixture/route map, role/state matrix and exact
  1024×768 evidence
- Browser evidence: indexed in `docs/lenni-redesign-c0-resolution.md`
- Tests/CI: C0 evidence and repository contract audit recorded in the C0 note
- Decisions: existing fixtures and server capability checks remain authoritative
- Exclusions/debt: no redesign implementation in C0

### C1 — foundation, shell and navigation

- Branch: `redesign/c1-foundation-shell`
- Feature SHA: `9d95c007d4186bdeaf656669042bfa6b68e4c8a2`
- PR: [#41](https://github.com/benjaminbutty/smbos26/pull/41)
- Merge SHA: `d8bd12357cbf88ed760a98d24d9d56105d2bdbdc`
- Surfaces: canonical tokens, Lenni shell, Work/More navigation, responsive
  mobile sheets and role-aware navigation visibility
- Browser evidence: C1 token/shell gallery indexed in the C0 resolution note
- Tests/CI: exact-head CI passed on the feature SHA; full validation recorded in
  PR #41
- Decisions: preserve existing route resolution, capability checks and runtime
  boundaries; use one unified shell
- Exclusions/debt: route-specific C2+ styling deferred

### C2 — acquisition, activation and Home

- Branch: `redesign/c2-acquisition-home`
- Feature SHA: `293fc5a9a0472a034ba576d4ed6b707ea9f9c4f4`
- PR: [#42](https://github.com/benjaminbutty/smbos26/pull/42)
- Merge SHA: `be901bdf753f4074faeb64e46f6c96aff41cfd20`
- Surfaces: `/start`, proposal review, `/start/business`, public auth framing,
  empty Home and populated Home
- Browser evidence: `/private/tmp/lenni-c2-*`; full index in
  `docs/lenni-redesign-c2-report.md`
- Tests/CI: exact-head CI passed in [run 31829634823](https://github.com/benjaminbutty/smbos26/actions/runs/31829634823); local verification included 821 unit/contract tests, 257 integration tests, 19 RLS tests and clean schema lint
- Decisions: live proposal data, honest state taxonomy, manual-first empty Home,
  deterministic actual Page/View next action, scoped C2 CSS
- Exclusions/debt: no AI/provider/prompt/schema changes; no later checkpoint
  styling; Admin live browser identity remains source/test-backed rather than
  fabricated

### C3 — Tables, Saved Views and structural controls

- Branch: `redesign/c3-tables-views-properties`
- Feature SHA: `176f164c81f26f435ac27ced6fb7218cf9619e5b`
- PR: [#43](https://github.com/benjaminbutty/smbos26/pull/43)
- Merge SHA: `3af64ba5ee973e2c778a23131da876ca2f5d415c`
- Surfaces: Table title/context hierarchy, View tabs, Saved View query
  controls, property menus, save-state trust presentation, direct first-record
  action, configured-form fallback and honest empty Table states
- Browser evidence: `/private/tmp/lenni-c3-*`; full index in
  `docs/lenni-redesign-c3-report.md` at 1440×900, 1024×768 and 390×844
- Tests/CI: focused C3 suite 41 passed; complete unit/contract suite 822
  passed; exact-head CI passed in [run 31833427857](https://github.com/benjaminbutty/smbos26/actions/runs/31833427857)
- Decisions: direct creation focuses the existing draft row; configured-form
  fallback remains an existing route; empty/loading/error and save states use
  the current kernel and canonical tokens with scoped C3 presentation
- Exclusions/debt: preserve the Table kernel and current structural/record
  boundaries; no new Field types, formulas, query language, bulk engine or
  persistence model

### C4 — Connections, Record experiences and Forms

- Branch: `redesign/c4-connections-record-forms`
- Feature SHA: `0ff72c846ef7a0d6acb88d116c223f828ee6549a`
- PR: [#44](https://github.com/benjaminbutty/smbos26/pull/44)
- Merge SHA: `df9fd6fb6cf4b524dae0a5302a7453478b55e415`
- Surfaces: Connection picker/cells, Record drawer, full Record detail and
  generic create/edit Forms
- Browser evidence: `/private/tmp/lenni-c4-*`; full index in
  `docs/lenni-redesign-c4-report.md` at 1440×900, 1024×768 and 390×844,
  including Owner/manual and Staff/read-only evidence
- Tests/CI: focused 56 passed; full unit/contract 822 passed; integration 257
  passed with 5 skipped; exact-head CI passed in [run
  31837725748](https://github.com/benjaminbutty/smbos26/actions/runs/31837725748)
- Decisions: reuse the existing Record/Form/Connection abstractions; add
  discoverable one/several connection states, explicit unlink, grouped Record
  detail, responsive drawer behavior and generic Form consequence/help/action
  presentation; keep role and persistence boundaries unchanged
- Exclusions/debt: preserve operational link/unlink services, relationship
  configuration boundaries, Record write services and current authorization;
  no universal Location, notes/timeline/payment/order widgets, AI insight
  panels, new relationship semantics, history/undo or public editing

### C5 — Pages and embedded Views

- Branch: `redesign/c5-pages-dashboard`
- Feature implementation SHA: `9a3a2842b187f693a96a6bfdbd28ece0c4a30d7a`
- PR: [#45](https://github.com/benjaminbutty/smbos26/pull/45)
- Final exact-head SHA: `d7c291ee2e03c32513e12fde2a9faa21fd688f5e`
- Merge SHA: `7eff04186f3726f037060c36b54bde8273c9f0ec`
- Surfaces: bounded Page route chrome, direct Heading/Text editing, `/` add
  menu, drag/Up/Down/remove controls, save/currentness state, calm Page canvas,
  exact Saved View embeds, local embedded-grid overflow and empty Page/View
  states
- Browser evidence: `/private/tmp/lenni-c5-*` at 1440×900, 1024×768 and
  390×844; Owner/manual live route, with Staff/Admin role behavior
  source/test-backed because the local Staff identity has no seeded Business
  membership
- Tests/CI: focused C5 suite 23 passed; full unit/contract 823 passed; clean
  integration 257 passed with 5 skipped; schema lint, build, type generation,
  TypeScript, lint and format passed; exact-head CI and the production audit
  are recorded after publication
- Decisions: reuse strict Page actions/currentness, the bounded Page editor,
  production Table renderer and server capability projection; native drag
  reorder repeats existing adjacent moves and retains keyboard/touch controls
- Exclusions/debt: no CMS, rich-text expansion, media, collaboration, custom
  code, website builder, second renderer, new capability or AI change; live
  Staff/Admin Page evidence remains a fixture debt for C8

### C6 — Tell Lenni, Changes and History

- Branch: `redesign/c6-today-operational-dashboard`
- Feature implementation SHA: `0d39b79f3658e4971f7ca83b484fca8f290d3a84`
- PR: [#46](https://github.com/benjaminbutty/smbos26/pull/46)
- Final exact-head SHA: `cbeef762156536e7eb0ae7d37d61c840123bd653`
- Merge SHA: `1edbb14f4f7bb803c53bbb2b3333b13d7cf277e7`
- Exact-head CI: [run 31848422193](https://github.com/benjaminbutty/smbos26/actions/runs/31848422193)
- Surfaces: Builder result trust hierarchy, operational confirmation
  distinction, Changes/History consequence centre, lifecycle labels, Preview
  not live, stale/currentness, technical disclosures and forward-only rollback
  language
- Browser evidence: `/private/tmp/lenni-c6-before-changes-*` and
  `/private/tmp/lenni-c6-after-changes-*` at 1440×900, 1024×768 and 390×844;
  `/private/tmp/lenni-c6-after-change-detail-1440x900.png` and
  `/private/tmp/lenni-c6-after-builder-ai-disabled-1440x900.png`; Owner/manual
  live route, with Staff/Admin behavior source- and test-backed
- Tests/CI: focused C6 UI suite 39 passed; full unit/contract suite 825
  passed; focused live integration 15 passed with 5 intentional skips; schema
  lint, type generation, non-incremental TypeScript, lint, format and
  production build passed; exact-head CI and audit are recorded after
  publication
- Decisions: reuse the existing bounded Builder states/actions, authorization,
  Changes actions, renderer and currentness checks; map stored `validated` to
  owner-visible `Checked`, reserve `Applied · Live` for stored applied state,
  move engine IDs/checksums behind disclosure and make rollback explicitly a
  new forward configuration change
- Exclusions/debt: no prompt/provider/model changes, new AI task, lifecycle,
  rollback engine, schema, dependency or route redesign; AI-disabled/manual
  continuity remains source/test-backed because the live Owner fixture has
  Builder disabled and the local Staff identity has no seeded Business
  membership
