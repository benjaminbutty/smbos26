# Lenni Journey 3 — The workspace is the builder

Status: J3-I0 resolved; J3-I1 implementation active  
Repository: `benjaminbutty/smbos26`  
Starting origin/main: `8a5598fa5e9e65991283421346e350d85a0a50ad`  
Feature branch: `codex/j3-i1-tables-properties`

## Purpose and authority

Journey 3 proves that an Owner/Admin can shape a working Lenni system by
interacting with the workspace itself. The current execution checkpoint is
limited to Tables and Properties. The accepted Journey 3 execution brief and
Capability Reconciliation and Product & Architecture Brief are the product
authority for this checkpoint; the Claude Journey 3 canvas is a visual
reference only.

The canvas assumptions that are not adopted include a universal internal
Review → Apply bar, a Property requiredness toggle, Property removal, and
editing unsupported Site capability blocks. Simple internal structural edits
remain one bounded, consequence-named direct action. Published Site
publication, Saved Views/Connections, Pages and later work remain in their
approved future checkpoints.

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

## Active checkpoint scope

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

J3-I2 Saved Views/Connections, J3-I3 Pages, J3-I4 deliberate published Site
changes and J3-I5 cross-business closeout require separate approval after
their predecessor is merged. No later checkpoint is active in this branch.
