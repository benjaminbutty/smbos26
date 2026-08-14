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

## Current checkpoint

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
- Feature SHA: pending implementation
- PR: pending publication
- Merge SHA: pending normal merge
- Surfaces: Connection picker/cells, Record drawer, full Record detail and
  generic create/edit Forms
- Browser evidence: `/private/tmp/lenni-c4-*`; full index in
  `docs/lenni-redesign-c4-report.md` at 1440×900, 1024×768 and 390×844,
  including Owner/manual and Staff/read-only evidence
- Tests/CI: pending C4 verification
- Decisions: reuse the existing Record/Form/Connection abstractions; add
  discoverable one/several connection states, explicit unlink, grouped Record
  detail, responsive drawer behavior and generic Form consequence/help/action
  presentation; keep role and persistence boundaries unchanged
- Exclusions/debt: preserve operational link/unlink services, relationship
  configuration boundaries, Record write services and current authorization;
  no universal Location, notes/timeline/payment/order widgets, AI insight
  panels, new relationship semantics, history/undo or public editing
