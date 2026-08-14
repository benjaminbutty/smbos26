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

## Current checkpoint

### C2 — acquisition, activation and Home

- Branch: `redesign/c2-acquisition-home`
- Feature SHA: recorded after the final checkpoint commit
- PR: pending publication
- Merge SHA: pending normal merge
- Surfaces: `/start`, proposal review, `/start/business`, public auth framing,
  empty Home and populated Home
- Browser evidence: `/private/tmp/lenni-c2-*`; full index in
  `docs/lenni-redesign-c2-report.md`
- Tests/CI: local verification complete; exact-head CI pending PR publication
- Decisions: live proposal data, honest state taxonomy, manual-first empty Home,
  deterministic actual Page/View next action, scoped C2 CSS
- Exclusions/debt: no AI/provider/prompt/schema changes; no later checkpoint
  styling; Admin live browser identity remains source/test-backed rather than
  fabricated
