# Lenni Interaction Quality Reset — Tables and internal Pages

**Status:** Active implementation boundary
**Date:** 24 August 2026

## Verified repository start

- Repository: `benjaminbutty/smbos26`
- Branch: `codex/interaction-quality-reset-tables-pages`
- Starting `HEAD`: `cda5e921180cc2895133088e57dfb4e193675747`
- Starting `origin/main`: `cda5e921180cc2895133088e57dfb4e193675747`
- Worktree at branch creation: clean

## Owner-experience defects

### Internal Pages

Tiptap is installed and a bounded translator/extensions layer exists, but the
production owner experience is still rendered by `PageEditor` as a stack of
React block frames, textareas, forms and per-block save/cancel actions. Tiptap
is therefore not the live document surface. Paragraph entry, formatting,
lists, slash insertion, selection, movement and saving do not form one coherent
editing session.

The component is also shared with authenticated Site editing. Replacing it
indiscriminately would risk changing the separate draft/published Site contract.
The internal authoring presentation must be isolated while reusing the same
grammar, renderer and trusted action boundary.

### Tables

The production Table already has the correct reusable kernel and server
adapters: cell selection/editing, bounded clipboard work, direct row creation,
Property actions, Connections, Saved Views and Record panels. The owner review
defect is presentation and interaction convergence. Resting chrome consumes
working area, structural actions feel detached from the grid, picker/failure
states need stronger focus continuity, and the responsive surface needs one
predictable desktop-grid/mobile-record model.

## Reused runtime and backend boundaries

- canonical Objects, Fields, Relationships, Records, Views, Forms and Pages;
- `EditorKernel` and `ProductionTableAdapter` for ordinary and embedded Tables;
- typed Direct Table and Direct Page actions and their server-derived Business
  and actor identity;
- PostgreSQL Page grammar checks, configuration action-shape checks and RLS;
- currentness and fail-closed stale behavior;
- immutable applied Changes and Versions for structural configuration;
- operational Record and Connection writes with no configuration Version;
- exact Saved View keys for Page embeds;
- the single `PageRenderer` runtime for reading, preview and public rendering.

No new tenant table, runtime, renderer, action lifecycle or platform primitive
is needed.

## Presentation code to replace or recompose

- the internal branch of `src/runtime/page-editor/page-editor.tsx`;
- Page Tiptap extensions, translator, menus and internal editor styling;
- Table workspace/kernel chrome, contextual Property and Saved View surfaces,
  picker/failure focus handling and responsive styling;
- markup-coupled tests that describe the rejected form/card presentation.

The Site branch of the current Page editor may be extracted or retained, but
its draft and published behavior is a regression boundary, not reset scope.

## Bounded Page grammar extension

[ADR-046](./ADR-046.md) amends ADR-037. One additive `rich_text` Page block
stores exactly one of:

- paragraph;
- heading level 1, 2 or 3;
- flat bulleted list;
- flat numbered list.

Inline content contains bounded text plus only bold, italic and safe-link
marks. Safe links use the repository's existing web, relative, email or
telephone schemes. Lists are finite and non-nested. Existing Heading, Text,
Divider, Callout, View and legacy/capability blocks remain valid. Translation
normalises supported paste into this grammar and rejects unknown persisted
nodes or marks. Raw editor JSON and HTML never cross the persistence boundary.

An additive migration updates the existing PostgreSQL Page shape validator. It
adds no storage or privileges. Sites and public publication remain unchanged.

## Exact exclusions

- second Table/Page runtime, renderer or configuration lifecycle;
- persistent drafts, browser storage, collaboration or comments;
- arbitrary HTML, CSS, marks, nodes, nested lists, widgets or dashboard grids;
- Sites/publication behavior, media, branding, domains or SEO;
- Property removal/requiredness, formulas, rollups, workflows or automation;
- private Views or Connection deletion/cardinality changes;
- Tell Lenni, Builder, AI tasks/providers/accounting or Journey 4.

## Automated acceptance seams

- Page grammar and Tiptap round-trip, legacy compatibility and unknown-node
  rejection;
- one body save equals one Change/Version and local edits mutate nothing;
- stale/error candidate retention and Staff authoring-control absence;
- Site/publication regression over the unchanged trusted Page boundary;
- Table keyboard navigation/edit helpers, retry/cancel and focus restoration;
- Choice/Status and Connection pickers, inline row creation and responsive
  state;
- one Property/Saved View change equals one Version;
- operational cell/Connection/embed work creates no Version;
- existing tenant, RLS, currentness and migration-immutability suites.

## Browser acceptance seams

Use seeded production routes and record the complete owner tasks—not only
screenshots—at 1440×900, 1024×768 and 390×844 for Owner/Admin/Staff. Evidence
lives under `docs/evidence/interaction-quality-reset/` and covers continuous
Page editing/reading, exact Saved View operation, Table keyboard/row/Property/
Saved View work, focus return, app-owned console errors or React warnings, and
page-level overflow.

