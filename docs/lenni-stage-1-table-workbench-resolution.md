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

