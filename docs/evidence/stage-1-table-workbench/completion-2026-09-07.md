# Table completion review — 7 September 2026

The completion pass retains the existing production adapter and deterministic
configuration/operational boundaries. It includes the previously uncommitted
property-removal and interaction refinements.

## Browser observations

Local synthetic Milk round, Owner:

- The saved Active Orders view renders a real Open group with loaded/total
  counts. Collapse hides the members; expand restores them. Record names and
  open-record controls remain present in grouped rows.
- Searching for Standing order 02 gives one matching record. Editing its
  Workspace flag retains the search and the matching count.
- Archiving that record removes it from the matching search. The bounded
  Archived records dialog lists it; Restore returns it to the query and empties
  the archive. Its Customer connection remains available.
- Editing the filter value to Paused, clicking outside the popover, and opening
  Filter again retains Paused and the Unsaved changes indicator. Discard clears
  the candidate.
- At 390×844, grouped Record cards replace the grid and document scroll width is
  exactly 390px. New record opens a focused, labelled mobile name-entry form.

These are functional observations from the current local application, not a
claim of exhaustive end-user acceptance. Development hot reloads generated
hook-dependency-change warnings during implementation; those intermediate logs
are not production acceptance evidence.

## Automated checks

- Added deterministic write-order and post-failure continuation tests.
- Added grouping/count and collapsed-row focus mapping tests.
- Added adapter tests for persisted widths and successive currentness updates.
- Added real-database archive/restore, wrong-Table/tenant rejection, and
  operational-versus-configuration-history coverage.
- Focused Table/Experience/four-business integration checks passed. A broader
  concurrent local run encountered a failure during heavy machine/database
  load; the clean PR CI run is the authoritative full-suite merge gate.
- Typecheck, lint, formatting, migration immutability, unit tests and production
  build are checked as part of completion; final exact-head results are retained
  on [PR 74](https://github.com/benjaminbutty/smbos26/pull/74).

## Deliberate v0 limits

Grouped views support direct cell edits and explicit loaded-record bulk work;
rectangular paste uses an ungrouped view. Group counts distinguish loaded rows
from complete matching totals. Archive/restore is single-record Owner/Admin
work. Formulas, rollups, import, collaboration and new view types remain outside
this round.
