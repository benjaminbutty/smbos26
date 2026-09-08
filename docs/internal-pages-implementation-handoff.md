# Internal Pages redesign — implementation handoff

Date: 7 September 2026. Baseline: `bd8b13304b0aef6837e937ad20da37c4a9bee60f`.

## Outcome and authority

Build internal Pages into a polished document workspace for non-technical business operators. Owners should write instructions, add images, organise sections and operate live business information without feeling they are configuring software. Product experience is a release criterion: functionality and passing tests alone are insufficient.

The user approved this scope and explicitly requested implementation by GPT-5.6 Luna with Max reasoning and Fast/priority processing. The implementing agent must complete the entire scope, UI refinement, evidence, tests and PR checks before returning for the coordinating agent's independent pre-merge review. Do not merge. Report earlier only for a genuine blocker that cannot be resolved autonomously.

Read AGENTS.md, docs/PRODUCT-NORTH-STAR.md, docs/SMBOS-v0.1-Build-Spec.md, docs/architecture-decisions.md and relevant tests before implementation. Record minimal architecture amendments before coding around conflicts. The approved decisions below authorise the described bounded amendments; do not ask again about already settled product choices.

## Confirmed decisions

| Area | Decision |
| --- | --- |
| Primary experience | Document workspace with contextual controls and live operational content |
| Owner/Admin opening | Ready to edit immediately; optional Reading mode |
| Saving | Automatic, debounced immutable configuration Versions |
| Rich content | Uploaded images, collapsible sections, checklists, internal Page links |
| Checklists | Normal business Records; Staff can tick permitted items |
| Image input | File selection, drag/drop and screenshot paste |
| Page management | Create, rename, duplicate, archive and restore |
| Navigation | Flat Pages navigation |
| Public Sites | Existing behaviour is a regression boundary |

Exclude dashboard grids, nested Pages, collaboration, comments, AI authoring, arbitrary HTML/CSS, formulas, public media publication and a separate document-revision store.

## Verified starting implementation

- Tiptap 3.29.2 and canonical translator already exist.
- Strict Page grammar, persisted stable block IDs, PostgreSQL validation and Direct Page configuration actions already exist.
- Production Table embeds, saved View references and operational Record actions already exist.
- PageRenderer is shared for reading/preview; Owner/Admin authors and Staff reads.
- ADR-046 specifies explicit save, but current internal editor and UI tests expect 600 ms autosave. Resolve deliberately in a new ADR.
- Owner editor embeds omit context props already provided by the route, including connected-Record support, and lack complete Workbench search/paging wiring.
- Authoring currently loads Record bundles for all eligible Table Views, even unreferenced ones.
- Links and deletion use native prompt/confirmation dialogs.
- UI tests substantially use source-string assertions.
- Existing image blocks use external URLs; private uploads need a reusable media boundary.
- Focused baseline: 60 tests passed in direct-page-workspace, page-editor-translator, page-view-chooser, runtime-renderers and lenni-unified-ui. This is not fresh browser acceptance.

## UI and interaction contract

### Page composition

Use existing Lenni typography, warm surfaces, coral accent, spacing, focus and trust-state tokens. Provide one compact toolbar with breadcrumb, stable save status, Reading/Edit control and overflow menu. Show one prominent editable title, no duplicate breadcrumbs or nested Page headers. Use a calm document surface without a dashboard-card wrapper.

Prose: approximately 720 px maximum width, 16 px body, 1.6 line height. Tables and wide images may expand to approximately 1,120 px within available workspace. Titles approximately 40 px desktop and 30 px mobile. Use generous section spacing without oversized empty embed containers. Coral marks focus/selection/important actions; ordinary content remains neutral.

Mobile: 16 px horizontal padding, 44 px touch targets, existing navigation, zero document-level horizontal overflow. Tables use the existing mobile Record-card presentation.

### Creation/navigation/lifecycle

New page creates a uniquely named untitled Page, opens it and selects its title. Empty body shows a quiet writing hint plus secondary Add a table and Add a checklist shortcuts, removed after meaningful content exists.

Sidebar shows active Pages and selected state. Contextual management:

- Rename inline, preserving slug.
- Duplicate with fresh block IDs and unique title, sharing referenced Tables, checklist Records and media. Explain that shared information stays shared.
- Archive removes from active navigation and retains content/referenced data.
- Archived Pages dialog allows Owner/Admin to restore the same identity/slug.

Removing an embed or archiving a Page never archives its Records. Flush document work before lifecycle operations.

### Writing/blocks

Support paragraphs; headings 1–3; bold/italic/safe links; flat numbered/bulleted lists; divider; callout; image; collapsible section; exact saved Table View; live checklist.

- Clicking blank space places caret predictably. Enter, Backspace, selection and arrows behave consistently around blocks.
- Slash menu searches insertions at caret. Contextual plus offers pointer/touch equivalent.
- Arrows/Enter/Escape operate menus with correct focus return.
- Handles appear on hover/focus and are discoverable on touch. Block menu offers move up/down, duplicate and remove.
- Drag shows source treatment and insertion position before release.
- Remove uses local undo and brief Undo affordance rather than browser confirmation.
- Formatting floats beside selection, preserving selection through popovers.
- Replace window.prompt with accessible URL/Page-link popover, including same-business Page picker.
- Paste preserves meaningful text and supported formatting; normalises unsupported formatting into finite grammar. Screenshot paste invokes upload.
- Local undo/redo survives autosave acknowledgements. Table/checklist operations must not enter document undo history.

### Images

File select/drop/paste inserts a positioned upload placeholder with progress, cancel and retry. Completed image preserves aspect ratio and offers contextual Replace, Caption, Image description and Remove. Offer document-width/wide presentation. Empty description produces empty alt, not a filename. Loading failure preserves a stable placeholder. Replacing/removing never destroys assets needed by historical Versions.

Initial limits: JPEG/PNG/WebP, 3 MiB input, 20 megapixels. Show limits in errors rather than permanent chrome.

### Collapsible sections

Disclosure, editable summary and contained authorable blocks including images/live embeds. One level only: no nested collapsible sections. Open/close is local reading state, no Version. Editing summary/content/position autosaves. Keyboard expansion/collapse/content entry works. Closing must not discard operational edits or hide unresolved write errors.

### Live Tables

Use existing ProductionTableWorkspace and adapters, never a second Table runtime. Searchable insertion chooser groups exact saved Views by Table. Owner can replace the View or mark that embed read-only. One compact header: name, source Table, Open table. No stacked titles/toolbars.

Include complete-View server search/paging, grouping, loaded/total counts, permitted cell edits/Record creation, Connections, connected-Record navigation, Record panels/focus return, existing bounded bulk work where supported, and role-permitted Record archive/restore. Table structure and saved-View configuration stay in full Table workspace.

Each block instance has independent search/query/selection/loading/error state even when referencing the same View twice. Operational refresh preserves document caret, pending writing, scroll and sibling embeds. Read-only allows searching/paging/reading but suppresses writes.

### Checklists

Compact presentation of normal business Records, not Page-local tick state. Add checklist offers Create a checklist or Use an existing table. Creation asks for name and composes a normal Table with Name and Completed Properties plus a checklist presentation. Existing-table chooser selects eligible saved View, text Property and boolean completion Property.

Show checkbox and label; completed items remain in place subdued/struck through. Staff ticks use existing editable Record permissions. Item creation/label edits follow operational permissions. Owner/Admin chooses source/placement. Ticks/item writes create no Page Versions. Failures stay beside item with retry. Same Record completion is shared everywhere. Read-only disables writes. No assignees, deadlines, reminders or separate task subsystem.

### Autosave/recovery

Quiet stable Saving… / Saved / Couldn’t save indicator. Saved means latest meaningful candidate acknowledged.

- 1.5 second editing debounce; continuous typing checkpoint at most every 10 seconds.
- Flush on Cmd/Ctrl+S and intentional internal navigation.
- Keep typing responsive while in flight; serialise title/body/lifecycle configuration mutations; never overlapping writes or old acknowledgement clearing newer edits.
- No-op suppression. Preserve caret, undo, block identities and pending edits after acknowledgement.
- Keep failed work in component memory; explicit retry; pause automatic retries after error/genuine conflict.
- Warn before browser unload for any unacknowledged edits/uploads, including in-flight requests.
- If workspace head changed but authoritative target Page still equals acknowledged baseline, revalidate at new head and retry once. Retain atomic currentness guard.
- If target Page changed, preserve local candidate, stop and show comparison/recovery with Use latest and deliberate Keep my version. Explain replacement consequence. No silent overwrite/merge.
- Reading uses shared renderer. Switching mode preserves local state and does not misreport pending save.

## Engineering boundaries

### Editor/rendering

Recompose internal editor into shell, serial save coordinator, contextual controls and finite extensions. Primary seams: src/runtime/page-editor/, src/core/configuration/direct-pages/, src/runtime/pages/. Also internal route, navigation, experience schemas, configuration validators, styles, migrations and tests.

Tiptap remains an adapter; canonical grammar is persistence truth. Share embed construction and complete operational props across editing/reading. Different presentation components must not create a second business runtime.

### Grammar

- Add managed-asset image reference mutually exclusive with historical external src; preserve historical shapes.
- Add bounded collapsible section.
- Extend View block with optional checklist presentation referencing text and boolean Field keys. Existing exact-View semantics unchanged when absent.
- Retain max 100 blocks counting contained blocks and existing text limits.
- Fresh stable IDs on insert/duplicate.
- Update every dependency walker, reference validator, renderer, preview, translator and snapshot validator for contained blocks; flat-only traversal is unacceptable.
- New authoring forms/managed private assets are internal-only; reject at public Site mutation/publication boundaries.

### Configuration/API

Finite existing-lifecycle actions:

1. Save internal Page document: atomically update title and layout for one internal Page.
2. Duplicate internal Page: new Page, fresh block IDs, shared references.
3. Archive/restore internal Page: change active state only.
4. Create checklist and embed: atomically compose bounded generic Object/Fields/View definitions and one Page reference; validate this exact permitted mutation shape in PostgreSQL.

Preserve existing caller compatibility. One successful configuration action = one immutable Version; identical document = no Version. Return Page and revision actually committed, not a later unrelated head. Flush current document before duplicate/archive/checklist creation. Failed composite operations leave no half-created definitions.

Write ADR superseding ADR-046 explicit save and documenting richer grammar, atomic title/body autosave, bounded checklist composition and reusable private media.

### Private media

One reusable tenant-owned registry plus private Supabase Storage bucket. Registry carries business_id, asset identity, storage key, MIME, size, dimensions, creator and timestamps.

Narrow authenticated upload endpoint resolves session membership, requires Owner/Admin, validates bytes/pixels, decodes/re-encodes supported images server-side stripping metadata, allocates immutable names, persists stable IDs and returns bounded safe errors.

Authenticated asset endpoint checks membership and returns private non-shared-cache responses. No persisted temporary URLs. Use private Storage and RLS; no service credentials in browser. Any privileged server storage operation stays inside authenticated narrow media code.

Retain assets referenced by historical Versions. Explicit maintenance command may remove failed/unreferenced uploads after 24h only after checking historical references; no queue/background infrastructure.

### Embeds/permissions

Separate chooser metadata from Record bundles. Initially load only referenced Views, with tenant-checked on-demand resolution for new selections. Supply full Workbench props (query/paging/records/connections/counts/actions). Introduce block-instance identity where DOM/state depends only on View key.

Checklist uses existing typed Record writes. Server validates referenced View, Field mappings, membership, editability, and Page read-only constraint via narrow Page-aware wrapper if necessary. No Records in layout_json and no checklist-state SQL table/new primitive.

### Migrations/compatibility

Additive migrations only for grammar/recursive validation, finite action shapes, media registry/Storage/RLS. Preserve history/rollback/legacy blocks and draft/published Sites, public Forms, Booking/preorder. Never reset a populated local DB for convenience; test migrations on a disposable instance.

## Implementation stages

1. Record ADR amendments and map interfaces/security boundaries.
2. Establish polished shell/contextual controls with representative populated and error states; validate desktop/mobile composition early.
3. Implement serial autosave, exact acknowledgement, conflict/navigation recovery.
4. Complete blocks, links, paste, movement, collapse and translator.
5. Implement private image upload/display/recovery.
6. Complete Workbench embeds and live checklists.
7. Complete Page lifecycle/navigation.
8. Run full verification, browser journeys, refine product quality, prepare PR and green checks.

Do not postpone UI refinement until backend completion. Use synthetic opening guide, weekly work Page with live orders and procedure Page with images/sections; no business-specific production conditions.

## Acceptance and evidence

Run complete production-route journeys, not screenshots alone:

1. Create/rename/write/format/reload.
2. Insert between blocks, move section, remove and undo.
3. Paste formatted content and screenshot.
4. Upload/caption/replace image and recover failure.
5. Operate collapsible section with pointer and keyboard.
6. Insert two saved Views, search beyond initial Records, edit result.
7. Open connected Record and return to exact originating embed.
8. Create checklist/add items/tick as Staff; verify underlying Table.
9. Duplicate Page and verify shared references.
10. Archive and restore.
11. Type during delayed save and retain subsequent edits.
12. Reject save, change unrelated configuration and produce competing Page edit; verify recovery.

Exercise Owner/Admin/Staff at 1440×900, 1024×768, 390×844. Record interactions and screenshots under docs/evidence/internal-pages-redesign/. Inspect fresh console for app errors/React warnings.

Reject if: duplicate headings; persistent management forms; small Table in huge empty container; clipped menus/mobile keyboard issues; hover-only actions; caret/scroll/query lost on save; checkbox moves/selects document; premature Saved; unexplained errors/dead ends/native prompt dialogs; document overflow; tiny touch controls/missing focus/inaccessible menus.

Behavioural tests: debounce/max-wait/serialisation/no-op/ack ordering/retry/conflicts; atomic title/body and stable IDs; recursive grammar/reference limits/paste/rejection; undo across saves; independent duplicated embeds; query/refresh without remount; checklist mapping/role/read-only/zero Versions; media validation/tenant/anonymous/history; lifecycle/shared data; rollback and Site regressions. Real DB tests for transactional shape, Version counts, RLS. Actual browser interaction coverage; source assertions alone are not acceptance.

Required checks:

```text
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
npm run check:migration-immutability
npm run supabase:lint
npm run test:integration
```

No live AI evaluations required. Deliver implementation, ADRs, requirement/evidence checklist, browser artifacts, exact tested SHA, check results and candid residual defects. Open/update PR with clear behaviour and validation description, wait for required checks, resolve actionable failures, leave unmerged for parent review. Do not describe partial work as ready to merge.
