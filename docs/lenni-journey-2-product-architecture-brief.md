# Lenni Journey 2 Product & Architecture Brief

**Checkpoint:** J2-I0 — repository/UI resolution  
**Date:** 21 August 2026  
**Status:** Execution baseline for the approved Journey 2 implementation

## Purpose

Journey 2 makes Lenni useful for ordinary day-to-day business operation. This
brief reconciles the approved Claude design references with the current
generic SMBOS runtime before product code changes begin. The uploaded DC/HTML
files are visual and interaction references; they are not production code,
route authority, data authority, permission authority, or permission to copy
generated markup into the application.

The implementation starts from the verified Journey 1 merge on `origin/main`:
`be9eff12456b4575592908c0fe086fb9cb565258`.

## Authority and evidence

The effective order for this implementation is:

1. the current Journey 2 execution decisions;
2. the 21 August Journey 1 → Journey 2 handoff and current-state addendum;
3. the verified merged repository and CI evidence;
4. accepted ADR-041 and ADR-044;
5. the Product North Star, Build Specification and architecture decisions;
6. the Lenni UX Constitution v2 and the approved Journey 2 design package.

The following materials were inspected for this checkpoint:

- `docs/PRODUCT-NORTH-STAR.md`
- `docs/SMBOS-v0.1-Build-Spec.md`
- `docs/architecture-decisions.md`
- `docs/lenni-journey-1-final-closeout-report.md`
- `docs/lenni-journey-1-acquisition-reliability-resolution.md`
- `/Users/ben/Downloads/lenni-j1-j2-product-roadmap-handoff-2026-08-21.md`
- `/Users/ben/Downloads/lenni-j1-j2-current-state-addendum-2026-08-21.md`
- the 14 August baseline, current-state handover and Lenni UX Constitution v2
- the Journey 2 `Run the business`, `Handoff notes`, `ApptTable`,
  `LenniSidebar` and `CapNote` design references.

## Product and architecture resolution

### Home and navigation

- Home is the fixed authenticated landing and orientation surface.
- There is no reserved Today destination, second dashboard, or Page that can
  replace Home.
- The shell presents Home, Tables, Pages, permitted Tell Lenni, Changes and
  Settings. Each Table and internal Page appears once.
- Saved Views are reached as tabs inside their Table. Forms are contextual.
- Existing public Sites remain a Journey 1 public capability boundary. They
  are not copied into internal Pages or exposed as generic public Record
  reads.
- Structural controls are capability-driven. Owner/Admin may create and
  change configuration where the existing capability permits it. Staff sees
  the operating product without broken or disabled structural controls and
  receives clear read-only state where appropriate.
- No global search or `⌘K` is introduced. Search belongs to the Table that
  owns the data.

### Home data contract

Home may use authoritative navigation and operational state already exposed by
the tenant-scoped services. It must not invent importance, recommendation,
ranking, analytics, KPI, activity, or “what matters” metadata. Where the
current runtime cannot support an attention model, the UI will show useful
configured destinations and honest empty/unavailable states rather than fake
priority.

### Tables and Saved Views

Tables remain the main operating workspace and reuse the existing production
table/editor kernel. J2 adds or refines:

- table-local search with a clear no-match and clear-search path;
- Saved View tabs inside the Table;
- plain-language filter, sort and group summaries;
- direct cell editing and a safe last-row creation action;
- configured Form fallback when direct creation is unsafe;
- property-header actions and structural trust/currentness states;
- responsive prioritisation at 1024px and decision-first list behaviour at
  390px.

No second table runtime, table-specific persistence, or vertical module is
allowed.

### Records

- A Record opens in context first.
- Desktop uses a bounded drawer over the originating Table or Page, preserving
  the underlying scroll position and active Saved View.
- Compact layouts use a full-screen Record surface.
- The drawer leads with human identity, key properties and meaningful
  Connections. Full Record earns its larger surface through grouped details
  and related work, not technical metadata or an audit feed.
- A few significant related Records use compact rich references/cards. Larger
  related sets use an embedded live View/table composition where the existing
  generic View runtime supports it.
- Location remains contextual and appears only when authoritative configuration
  and data support it.

### Forms and Connections

Existing schema-validated Form rendering and tenant-scoped operational actions
remain the boundary for creation and editing. The UI will make Forms feel
contextual without creating a new Form primitive or persistence model.

Connection language is business language: connect to, selected Records, remove
or clear, and open the related Record. Where the existing target schema is
safe, bounded quick creation follows this contract:

```text
picker → target Record Form → explicit Add → normal operational write
       → return to the original task with the new Record selected
```

It creates one deliberate permanent Record at a time. It does not add nested
transactions, chained creation, operational undo, arbitrary graph mutation,
or a second server boundary.

### Pages

Internal Pages remain calm business canvases composed from supported blocks and
exact live Saved Views. J2 prioritises Heading, Text, Saved View and Divider
composition, while preserving existing Journey 1 capability blocks and the
current PageRenderer where their capability remains in scope. Owner/Admin
structural editing continues through the forward-only configuration lane;
Staff receives the existing read-only rendering behaviour.

## Screen and state inventory

The approved design package is reconciled into these implementation surfaces:

| Reference | Surface | Runtime analogue | J2 treatment |
| --- | --- | --- | --- |
| B1–B3 | desktop shell, Staff shell, mobile account/navigation sheet | authenticated tenant layout and mobile nav | refactor IA and role visibility |
| C1–C4 | Home empty, populated, responsive and state variants | `WorkspaceHome` and tenant home route | use real navigation/operational data; no fake ranking |
| D1–D4 | Table, Saved View, filters and responsive table/list | production Table workspace, View controls and editor kernel | add local search, summaries and reflow |
| E1–E4 | Record context, full Record and bounded picker | record panel, full Record route and ConnectionPicker | drawer/full-screen context and consistent language |
| F1–F3 | contextual create/edit Forms | generic Form renderer/actions | reuse schema and operational boundary |
| G1–G2 | internal Page editor and live Saved View | PageEditor/PageRenderer | preserve exact View identity and read-only rules |
| H | loading, saving, error, stale, empty, unavailable, read-only and widths | existing component state plus shared CSS | converge exact owner-readable state grammar |
| J | milk, dog grooming, trades/jobs, enquiry service and Bedford regression | proof fixtures, seeded businesses and preorder routes | add acceptance coverage; no vertical source modules |

Required state vocabulary is:

```text
Saving…
Saved
Could not save
Needs reload
```

The surfaces also need honest empty, loading, no-match, unavailable,
read-only, not-permitted and stale/currentness communication. State meaning is
never conveyed by colour alone.

## Current source mapping

The reusable implementation seams are:

- shell and tenant capability resolution:
  `src/app/app/[businessSlug]/layout.tsx`;
- Home composition:
  `src/app/app/[businessSlug]/page.tsx` and
  `src/components/workspace-home.tsx`;
- desktop/mobile shell controls:
  `src/components/workspace-topbar.tsx` and
  `src/components/workspace-mobile-nav.tsx`;
- Table route and production workspace:
  `src/app/app/[businessSlug]/workspace/[screenSlug]/page.tsx` and
  `src/runtime/editor-kernel/production/production-table-workspace.tsx`;
- generic grid, direct edits and structural controls:
  `src/runtime/editor-kernel/editor-kernel.tsx` and
  `src/runtime/editor-kernel/editor-lab.tsx`;
- Saved View query controls and persistence:
  `src/runtime/views/table-view-controls.tsx`,
  `src/runtime/views/table-view-navigation.tsx` and
  `src/core/experience/table-query.ts`;
- contextual Record and full Record:
  `src/runtime/editor-kernel/record-panel.tsx`,
  `src/app/app/[businessSlug]/workspace/[screenSlug]/[recordId]/page.tsx` and
  `src/runtime/views/view-renderer.tsx`;
- generic Forms and operational writes:
  `src/runtime/forms/form-renderer.tsx`,
  `src/runtime/forms/actions.ts`,
  `src/core/graph/record-creation/service.ts` and
  `src/core/graph/record-update/service.ts`;
- Connections and bounded target creation:
  `src/runtime/editor-kernel/cell-editors/index.tsx` and
  `src/runtime/editor-kernel/production/production-table-actions.ts`;
- internal Pages and exact live Views:
  `src/runtime/page-editor/page-editor.tsx`,
  `src/runtime/pages/page-renderer.tsx` and
  `src/app/app/[businessSlug]/pages/[pageSlug]/page.tsx`;
- design tokens and responsive product surfaces:
  `src/app/globals.css`.

These are composition/refinement seams. No new primitive, tenant table,
vertical module, second renderer, framework migration, queue, cache or
service is justified by the J2 contract.

## Checkpoint boundaries

### J2-I1 — shell, capability navigation and Home

Deliver the one-destination shell, mobile account/navigation surface, fixed
Home, role visibility and honest empty/populated/unavailable states. Preserve
J1 public Sites and utility routes.

### J2-I2 — Tables, Saved Views, responsive table and Record drawer

Deliver table-local search, Saved View tabs, plain-language query summary,
responsive prioritisation, direct edits/creation, no-match states and the
context-preserving Record drawer.

### J2-I3 — full Record, Forms, Connections and quick-create

Deliver grouped full Record presentation, consistent connection picker and
bounded one-record quick-create through the existing Form/write boundary.

### J2-I4 — internal Pages and live Saved Views

Deliver the supported Page anatomy, exact View embedding, Open Table handoff,
Owner/Admin structural controls and Staff read-only behaviour.

### J2-I5 — cross-business, accessibility and regression closeout

Run the cross-business matrix, widths, roles, AI-unavailable/manual parity,
state grammar, keyboard/focus checks, repository checks and exact-head CI.

## Acceptance matrix

The implementation must prove the applicable path for:

- milk round: Customers, Products, Deliveries and related Records;
- mobile dog grooming: Customers, Dogs, Appointments and Services;
- trades/jobs: Customers, Jobs, Tasks and operational edits;
- enquiry-led service: Contacts, Enquiries, Events, Quotes and follow-ups;
- Bedford Bakery preorder as the preserved J1 public regression.

For each supported business, verify Owner/Admin and Staff where the fixture
supports both, plus empty/populated/loading/saving/error/stale/read-only and
AI unavailable where the surface offers AI assistance. Verify 1440×900,
1024×768 and 390×844. The mobile path must remain usable without permanent
matrix scrolling, and the 1024 path must disclose omitted Properties when the
configured set does not fit.

## Explicit exclusions

This checkpoint and all J2 implementation checkpoints exclude:

- J1 acquisition retuning or reliability changes;
- Journey 4 Tell Lenni/Changes redesign, permanent chat or memory;
- workflows, formulas, analytics, AI insights, global search, import/OCR;
- payments, messaging, advanced scheduling/routing/capacity;
- public website builder or generic public Record reads;
- arbitrary public graph mutation, merchant theming or media/analytics;
- new vertical modules, primitives, persistence models, runtimes or lifecycle;
- copying DC-generated markup or code into production.

## Verification obligations

Each implementation checkpoint must add or update focused tests, run the
repository-required checks, exercise the relevant browser states and widths,
record routes/fixtures/screenshots, push a bounded branch and obtain exact-head
CI before it is merged or carried forward as a stacked lineage.
