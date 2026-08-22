# Lenni Journey 3 — The workspace is the builder

Status: J3-I1 and J3-I2 merged; J3-I3 implementation active
Repository: `benjaminbutty/smbos26`  
Starting origin/main: `8a5598fa5e9e65991283421346e350d85a0a50ad`  
J3-I2 starting origin/main: `8ca69e3c6b45ea30393b2ce5f1e5ac378d16cdbe`
Current feature branch: `codex/j3-i3-internal-pages`

## J3-I3 repository resolution

### Reused foundations

J3-I3 reuses the Direct Page schemas, composer and service, the strict
`PageLayout` grammar, stable block identities, the Page/Tiptap translator, the
existing internal Page canvas, exact Saved View chooser, and live production
Table embed. The current route already derives tenant and role server-side,
gives Owner/Admin the authoring canvas, and gives Staff the clean shared Page
renderer with operational embedded Table access and no structural controls.

### Bounded extensions

The repository audit found one architecture-level interaction defect: desktop
drag/drop calls `move_page_block` repeatedly until the source reaches the drop
index, creating one immutable Version per adjacent movement. J3-I3 replaces
that client loop with one complete bounded `save_page_layout` action containing
the final reordered layout. The server still reloads the active configuration,
checks currentness and Page grammar, and applies one trusted `set_page`
operation and one Version.

The product review also confirmed that the existing canvas still presented
permanent block-management rows rather than the accepted quiet Page grammar.
J3-I3 therefore recomposes the same renderer-backed surface into a bounded
content rail: title and Heading/Text edit in place, contextual `+` and grip
controls occupy the gutter, `/` and `+` open the same finite insert menu,
Heading/Text are composed locally before their one insert action, and a
Reading mode removes authoring chrome while live embedded Views remain
operable. This is presentation and component-memory state only, not an editor
document or Page draft lifecycle.

The existing finite `add_page_block` intent gains one optional
`afterBlockId`. The server resolves that stable or legacy block identity from
the authoritative Page and inserts the new code-owned block immediately after
it. The browser still cannot allocate block identity or submit operations, and
one completed insertion still produces one `set_page` operation and one
Version. Omitting placement retains the existing append behavior.

Stale Page recovery remains memory-only. A stale title or text draft stays in
component state while the route refreshes the latest authoritative Page and
currentness; the owner must review and deliberately save again. No silent
rebase, local storage, session storage or durable editing session is added.
If the edited block was removed or changed to an incompatible supported type,
the draft remains visibly selectable in a conflict panel but cannot be applied
or silently recreated; the owner may copy it and discard the unresolved draft.

### Migration decision and interfaces

No migration, dependency or new action kind is required.
`save_page_layout` is already accepted by the Direct Page boundary and the
database action-shape guard. J3-I3 exposes that existing action to the reorder
completion seam rather than adding a second reorder lifecycle. The optional
placement field extends only the existing strict `add_page_block` schema and
composer; it does not extend the database action allow-list.

Primary seams are:

- `src/core/configuration/direct-pages/{schemas,composer,service}.ts`;
- `src/runtime/page-editor/{page-editor,page-translator,view-chooser}.ts{x}`;
- `src/runtime/pages/direct-actions.ts` and the internal Page route;
- the production embedded Table capability boundary;
- focused Direct Page, translator, exact View chooser, integration and RLS
  tests.

### Exact exclusions

J3-I3 adds no Page draft table, arbitrary rich text/HTML, dashboard grid,
widgets, formulas, media, templates, collaboration, query builder, block type,
Site/publication behavior, AI/Builder work, dependency, primitive, renderer or
configuration lifecycle. J3-I4 and later work have not started.

## J3-I2 repository resolution

### Reused foundations

J3-I2 reuses canonical V2 mixed Table columns, the typed Table query grammar,
Saved View tabs and exact Page View keys, the Direct Table composer/service,
the atomic internal-workspace configuration RPC, currentness and immutable
Versions, the production Table kernel, and the existing Connection search,
selection and unlink RPCs. Connection edge writes remain operational and do
not advance configuration history.

### Bounded extensions

The repository audit confirmed two gaps described by the controlling brief:

- existing `create_saved_view` persisted an initially blank View and
  `update_view_query` required a second Version;
- `query_view_records` could read only a persisted View key and could not
  preview an unsaved typed query.

J3-I2 therefore adds one finite `configure_saved_view` intent that creates or
updates name, exact ordered mixed columns and the complete typed query through
one `set_view` operation and one applied Version. It also adds the narrow
Owner/Admin-only read boundary recorded in [ADR-044](./ADR-044.md). The read
uses authoritative current Records, writes nothing and is not available to
Staff or anonymous/public runtime.

Connection creation continues using the existing one-relationship plus one or
two affected-View operation composition. The J3 work is presentation and
productisation: both-side One/Several language, optional inverse naming,
proposed empty non-operable column, deterministic consequence copy and focus
recovery. No new relationship lifecycle is introduced.

### Migration decision and interfaces

One additive migration extends the internal-workspace action allow-list for
`configure_saved_view` and adds `preview_table_view_records`. It adds no table,
tenant draft row, query store, primitive, generic SQL authority or public read
surface. Browser actions submit only typed query/columns, route-bound View
identity and expected currentness; Business and actor remain server-derived.

Primary seams are:

- `src/core/configuration/direct-tables/{schemas,composer,service}.ts`;
- `src/core/experience/{schemas,table-query}.ts`;
- `src/runtime/views/table-view-{navigation,controls}.tsx`;
- the production Table action and editor-kernel Connection preview seams;
- `supabase/migrations/20260822120000_j3_i2_saved_view_boundary.sql`;
- focused unit, direct Table/Internal Workspace integration, RLS and Page
  exact-key regression tests.

### Exact exclusions

J3-I2 adds no personal Views, global View navigation, arbitrary query
language, formulas, aggregations, Connection deletion or cardinality changes,
required/self/public Connections, persistent drafts, Page authoring, Site
publication, AI/Builder changes, dependency, renderer, primitive or second
configuration lifecycle. J3-I3 and later work have not started.

## Purpose and authority

Journey 3 proves that an Owner/Admin can shape a working Lenni system by
interacting with the workspace itself. The accepted Journey 3 execution brief
and Capability Reconciliation and Product & Architecture Brief are the product
authority; the Claude Journey 3 canvas is a visual reference only. The J3-I1
material below records the merged Tables and Properties foundation, while the
resolution above governs the active J3-I2 Saved Views and Connections work.

The canvas assumptions that are not adopted include a universal internal
Review → Apply bar, a Property requiredness toggle, Property removal, and
editing unsupported Site capability blocks. Simple internal structural edits
remain one bounded, consequence-named direct action. Published Site
publication and Pages remain in their approved later checkpoints.

## J3-I0 repository resolution

### Preflight

The required preflight completed before source changes:

- worktree was clean;
- branch was `main` and was advanced with `git pull --ff-only origin main`;
- `git fetch origin` completed successfully;
- `HEAD` and `origin/main` both matched
  `8a5598fa5e9e65991283421346e350d85a0a50ad`;
- Node was `v22.23.2` and npm was `10.9.8`;
- implementation continues on `codex/j3-i1-tables-properties`.

The initial bare `git pull --ff-only` could not run because local `main` has no
tracking branch; the explicit `origin main` pull completed without changing
the required baseline. No reset, stash, discard or unrelated-work overwrite
was performed.

### Sources inspected

The repository and product authority inspected for this resolution were:

- `AGENTS.md`;
- `docs/PRODUCT-NORTH-STAR.md`;
- `docs/SMBOS-v0.1-Build-Spec.md`;
- `docs/architecture-decisions.md`;
- `docs/ADR-036.md`;
- `docs/ADR-039.md`;
- `docs/INTERNAL-WORKSPACE-ENGINE.md`;
- `docs/lenni-journey-2-product-architecture-brief.md`;
- `docs/lenni-journey-2-closeout-report.md`;
- `docs/lenni-pre-reset-hygiene-report.md`;
- `docs/configuration-mutation-boundary.md`;
- `src/app/app/[businessSlug]/workspace/[screenSlug]/page.tsx`;
- `src/runtime/editor-kernel/contracts.ts`;
- `src/runtime/editor-kernel/editor-kernel.tsx`;
- `src/runtime/editor-kernel/editor-lab.tsx`;
- `src/runtime/editor-kernel/table-columns.tsx`;
- `src/runtime/editor-kernel/lenni-ui.tsx`;
- `src/runtime/editor-kernel/production/production-table-workspace.tsx`;
- `src/runtime/editor-kernel/production/production-table-adapter.ts`;
- `src/runtime/editor-kernel/production/production-table-actions.ts`;
- `src/runtime/editor-kernel/production/action-types.ts`;
- `src/runtime/editor-kernel/production/table-mapper.ts`;
- `src/core/configuration/direct-tables/schemas.ts`;
- `src/core/configuration/direct-tables/composer.ts`;
- `src/auth/capabilities.ts`;
- relevant responsive/editor CSS in `src/app/globals.css`;
- `tests/direct-table-workspace.test.ts`;
- `tests/integration/direct-table-workspace.test.ts`;
- `tests/editor-kernel.test.ts`;
- `tests/editor-kernel-production.test.ts`;
- `tests/lenni-table-experience.test.ts`;
- `tests/lenni-unified-ui.test.ts`.

### Existing architecture path

J3-I1 is representable without a migration, new dependency, new primitive,
new renderer or second persistence lifecycle:

```text
Table workspace
→ EditorKernel and production adapter
→ bounded add/insert Table intent
→ production server action derives tenant and actor
→ direct Table composer and compatibility checks
→ ConfigurationChangeService / immutable applied Version
→ authoritative Table reload
```

The browser supplies only bounded property input and expected currentness.
The server reloads the immutable active configuration, checks Owner/Admin
capability and currentness, recomposes the complete trusted operations, and
uses the existing atomic direct configuration boundary. Table-owned create and
edit Forms remain coherent through the existing composer. Record values use
the operational lane and do not create configuration Versions.

The proposed-column experience is a presentation overlay over the current
`EditorTable`; it is not persisted, not writable, not a candidate runtime and
not trusted final-write input. The authoritative Table remains the only
runtime data source.

## Capability reconciliation

| J3-I1 interaction | Resolution |
| --- | --- |
| Resting populated Table and ordinary Record editing | Existing production Table kernel; recompose presentation only |
| Owner/Admin structural controls and Staff absence | Existing capability resolution; preserve and make contextual |
| Add/insert Property | Existing `add_column`/`insert_column` direct actions; add bounded editor and local overlay |
| Supported types | Existing direct type vocabulary; expose owner language, including existing currency support |
| Choice/Status options | Existing server validation and used-value compatibility checks; structured bounded option editor |
| Rename/type/options/reorder/resize | Existing one-action direct boundaries; improve contextual header controls |
| Property preview | New bounded client presentation contract over the existing Table kernel |
| Consequence copy | New finite, code-owned descriptor; browser result is never trusted by the server |
| Table-owned Forms | Existing trusted composer synchronization |
| Stale currentness | Existing server guard; retain in-memory editor input and require recheck/commit |
| Property removal, requiredness, defaults, uniqueness, formulas and workflows | Explicitly excluded |
| Saved Views, Connections, Pages and Sites | Explicitly deferred to J3-I2 through J3-I4 |

## Current behaviour being recomposed

The production workspace already has an edge Add column affordance, a compact
add-column popover, header property menus, the typed direct adapter, server
currentness checks, Table-owned Form synchronization, option compatibility
checks, and mobile Record-first rendering. It currently lacks a coherent
property draft/placement editor, a proposed column over authoritative rows,
finite consequence copy, explicit currency presentation in the picker, and
post-commit focus restoration. The existing production wrapper also remounts
the kernel on a successful currentness refresh, so J3-I1 must preserve the
editor’s working context while syncing the authoritative result.

These are UX and bounded presentation seams over the existing direct Table
engine. No server truth model or configuration lifecycle change is identified.

## J3-I1 checkpoint scope

J3-I1 only:

- discoverable Owner/Admin Property affordance in the production Table;
- contextual responsive Property editor;
- Text, Long text, Number, Money, Yes / No, Date, Email, Phone, Website,
  Choice and Status;
- structured Choice/Status option editing with existing finite server limits;
- end and bounded before/after placement;
- local non-editable proposed-column overlay;
- deterministic consequence summary;
- one direct Add property commit, authoritative reload and focus/context return;
- existing Property maintenance actions presented coherently;
- stale, error, keyboard, touch and responsive states;
- focused tests and real direct-configuration/operational lane assertions.

## Explicit exclusions

This checkpoint does not implement Saved View creation or redesign,
Connections, Pages, Sites, published publication changes, Property
removal/archive, requiredness, defaults, uniqueness, arbitrary validation,
formulas, rollups, workflows, automation, collaboration, durable drafts,
branding, website-builder behaviour, AI/Tell Lenni/Builder changes, new
vertical modules, new persistence, migrations, dependencies, platform
primitives, a second renderer or a second configuration lifecycle.

## Test seams

The focused test seams are the pure preview/descriptor and option validation
helpers, EditorKernel/property-editor presentation, production adapter
forwarding and mapper behaviour, existing direct Table composer tests, and the
local Supabase direct Table integration suite. The integration assertions must
cover one applied structural Version, Form coherence, stale/no-mutation,
permission failure, and subsequent operational Record edits with no
configuration Version. Existing migration immutability, repository check and
build commands remain the final verification gates.

## Conflict resolution

No material conflict was found between the accepted J3 decisions and the
post-J2 repository. The current implementation has the approved deterministic
direct Table boundary and supported action vocabulary. The only identified
gaps are the bounded J3-I1 editor, presentation overlay, consequence copy and
focus/context treatment described above. The Claude canvas is not used as
implementation authority where it conflicts with those decisions.

## Later checkpoint reminder

J3-I3 Pages, J3-I4 deliberate published Site changes and J3-I5 cross-business
closeout remain authorised only after their predecessor is merged and
post-merge main CI is green. No later checkpoint is active in this branch.
