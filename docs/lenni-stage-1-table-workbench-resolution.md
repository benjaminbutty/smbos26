# Lenni Stage 1 — Table Workbench v0 resolution

Date: 1 September 2026

## Decision

Stage 1 closes the Table interaction gap by extending the existing Internal
Workspace Engine and React Data Grid adapter. It does not create a second
Table runtime, a vertical module or a platform primitive.

The implementation is deliberately split across two trusted lanes:

- configuration: one ordinary currentness-checked Change/Version for a
  related Property or saved-View candidate save;
- operation: server-owned paging/search, Record editing, Connection selection
  and all-or-none bounded bulk update with no configuration Version.

## Scope

- Complete-current-View server search and 50-Record paging;
- typed multi-filter/all-any, ordered-sort, group, visible Property order and
  width candidate controls with live preview and discard;
- loaded-record selection and a maximum-100 typed bulk set/clear boundary;
- one-hop, single-valued read-only related Properties with Record navigation;
- mobile Record cards and full-screen Record context in place of the prior
  “Working property” selector.

## Explicit non-goals

No Tiptap/Table coupling, Page or public work, AI evaluation, new SQL tables,
vertical business conditions, arbitrary SQL/query execution, spreadsheet
formula/rollup support, unbounded related traversal or grid replacement.

## Architecture tension resolved

The existing query RPC returned a bounded page but no search parameter, and
the old table search only filtered already loaded rows in the browser. The
smallest safe correction is an additive migration that replaces that weaker
function signature with an authenticated typed transient-search parameter.
It does not alter historical configuration snapshots or the view model.

## Owner correction pass — 2 September 2026

The original owner-facing candidate was rejected for interaction hierarchy, not
for a missing capability or a trusted-boundary defect. The smallest correction
keeps the Stage 1 runtime and RPC model intact while changing the client
composition:

- saved Views move from a horizontal tab strip to a current-View selector;
- Filter, Sort, Group and Properties move into the same Table toolbar as
  transient search, with a compact viewport-safe candidate editor;
- bulk work starts from an explicit loaded-Record checkbox column, never from
  ordinary cell focus or range selection;
- a direct `New record` action enters the primary cell editor in one action;
- the existing Connection picker makes the narrow create-and-connect path
  visible before typing and names the target Object plainly; and
- custom-column drag now exposes a grab state, source treatment and immediate
  insertion target before it commits on release. Keyboard moves remain in the
  header menu and reduced-motion users receive static feedback.

This correction creates no migration, new platform primitive, API surface,
configuration lifecycle or RLS exception. Search remains server-owned,
currentness and atomic maximum-100 bulk RPC behavior remain unchanged, and
saved candidates still become exactly one ordinary configuration Version only
when saved. The proof seed is expanded to 20 deterministic, synthetic Milk
round Records so the workbench can be reviewed as a populated operational
surface without personal data.

## Correction verification

Authenticated local proof on 2 September confirmed the corrected Owner,
Admin and Staff surfaces at 1440×900, 1024×768 and 390×844 respectively. The
owner created one filtered saved View, made a scoped 10-Record field update,
created a Record with its full primary name, used the Customer quick-create
path and completed pointer reordering of a non-primary column. The saved View
and pointer reorder appeared as ordinary forward configuration Versions;
the bulk operation did not. No migration, RLS, RPC or primitive change was
needed for the correction.
