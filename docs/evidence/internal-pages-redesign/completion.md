# READY FOR PRE-MERGE REVIEW

Parent review 4's caret, checklist slash insertion and chooser placement
corrections are complete and verified locally and at the exact pushed head.
The chooser now retains the captured insertion placement through both create →
existing and existing → create mode switches. See `parent-review-4.md` for the
original production-route reproduction and the parent-controlled browser
recheck boundary.

The second and third parent-review implementation corrections are complete and
their local and exact-head checks are green. The coordinating agent's final
browser acceptance remains an independent pre-merge review step; this marker
records that the implementation is ready for it.

Date: 8 September 2026

PR: [#75](https://github.com/benjaminbutty/smbos26/pull/75) — open and
unmerged.

The current implementation and evidence head is commit
`a25783007621117477711fefd808804d18ada52b`. Its exact-head CI
[34196558706](https://github.com/benjaminbutty/smbos26/actions/runs/34196558706)
completed successfully in 22m29s. Earlier green exact-head runs for the
opaque request-token and documentation corrections remain listed below.

## Requirement and implementation checklist

| Stage | Completed implementation and evidence |
| --- | --- |
| 1. Architecture and boundaries | [ADR-052](../../ADR-052.md) records the approved save timing, finite recursive Page grammar, exact committed-Version acknowledgement, bounded checklist composition, Page-aware operational writes and private media boundary. The architecture index is amended. Additive migrations preserve historical snapshots, rollback, Sites, Forms, Booking and preorder. |
| 2. Document shell and product quality | The compact Page toolbar, inline title, breadcrumb, save state, Reading/Edit control, overflow actions, contextual block controls and calm document canvas are implemented. Desktop title sizing, compact operational content, 44 px touch targets and zero document overflow were checked in the [browser ledger](./browser-journeys.md) and [role/viewport matrix](./responsive-role-matrix.json), with durable Owner, Administrator and Staff captures. |
| 3. Autosave and recovery | A serial coordinator provides a 1.5 second quiet debounce, ten-second continuous-typing checkpoint, no-op suppression, queued revisions, one candidate/revision identity for title and body, exact acknowledgements, deliberate retry, unrelated-head revalidation, target conflict recovery, Reading preservation and save-before-navigation/lifecycle operations. Behavioural deferred-request, draft acknowledgement, currentness and action-shape tests cover later edits during an in-flight request, failure/conflict recovery and no-op/version semantics. |
| 4. Finite writing and composition | Paragraphs, headings 1–3, safe links and Page picker, lists, divider, callout, collapsible sections, slash/gutter insertion, contextual formatting, duplicate/move/remove/undo and stable block identities translate to the canonical grammar. Recursive validators, dependency/reference walkers, renderer, preview/public eligibility checks and historical snapshot projection traverse contained blocks and enforce the 100-block limit. |
| 5. Private images | Authenticated Owner/Admin upload and asset routes validate tenant membership before bounded request buffering, accept JPEG/PNG/WebP within the 3 MiB/20 MP limits, decode/re-encode with metadata removal and encoded-size checks, and use private Storage. Placeholder progress, cancel, retry, replace, remove, presentation and failure states are implemented. Cleanup retains historical-Version references and removes only eligible old failed/unreferenced assets. |
| 6. Workbench Views and checklists | Embedded Views reuse `ProductionTableWorkspace` with tenant, currentness, query/search/paging/counts, Connections, connected Record panels, contextual creation, permitted bulk/lifecycle actions and independent block-instance state. Checklist blocks use normal Record data, support create/use-existing source selection, text/boolean mapping, placement, paging/search, label edits and Page-aware role/read-only validation; ticks create zero Page Versions. |
| 7. Page lifecycle and roles | Create opens a uniquely named untitled Page with selected title; rename preserves slug; duplicate creates fresh block IDs while sharing operational references; archive/restore preserves Page identity and references. Owner and Administrator edit/read/archive/restore; Staff receives shared read/operate content with permitted checklist writes and no document mutations. |
| 8. Verification and evidence | The full local checks and exact-head CI below are green. The browser ledger records the direct role journeys and durable screenshots for the executed Page workflows, while explicitly identifying controlled behavioural coverage for delayed-save and competing-save cases and the automated screenshot-paste boundary. It also records the later Table/checklist state reconciliation. The implementation is READY FOR PRE-MERGE REVIEW; the coordinating agent's final browser recheck is retained as an independent review step. No production reset or live AI evaluation was used. |

## Parent-review-1 correction checklist

1. Autosave uses last-edit quiet timing and first-dirty/max-wait state, serial
   requests and explicit stop/retry after failures or conflicts. Controlled
   deferred-request tests verify queued revisions and failure recovery.
2. Currentness refresh preserves dirty title/body candidates. Unrelated heads
   revalidate once; target changes stop with Use latest or deliberate Keep my
   version, with no silent rebase or title loss.
3. Reading flushes safely, renders the local/acknowledged candidate through
   the shared `PageRenderer`, preserves editor state and does not offer a
   discard workflow.
4. Successful actions reconcile canonical layout and IDs without replacing a
   newer candidate, caret or undo history. Semantic no-op comparison is
   covered after undo and does not create a Version.
5. Cmd/Ctrl+S, intentional internal navigation and lifecycle actions drain the
   coordinator; leave handling retains work and reports recovery state when a
   write cannot complete.
6. Page View embeds forward complete Workbench context and currentness, and
   stable block-instance IDs isolate duplicate View state and DOM identifiers.
7. Checklist source/field chooser, mapping, query/paging, label/completion
   controls and Page-aware tenant/role/read-only boundary are implemented and
   covered by integration/RLS tests plus the Staff browser journey.
8. Composition controls include headings 1–3, grouped View/checklist choices,
   contextual existing-embed controls, duplicate/move/remove/undo, keyboard
   and touch focus paths, and one-action empty-Page title creation.
9. Media routes enforce the authenticated narrow write lane, bounded input,
   decoded/re-encoded output and private Storage policy; cleanup and
   historical-reference tests cover registry/storage failure and retention
   behaviour. Browser evidence covers file upload, cancel, retry, replacement,
   removal and the bounded rejection state; screenshot-paste uses the same
   tested upload boundary.
10. Evidence is behavioural and durable: the ledger names the executed role
    journeys and supporting suites, and does not use source-string assertions
    as acceptance evidence.

## Parent-review-2 correction status

- Title-only, title-plus-body and later-in-flight edits now share the save
  coordinator's candidate envelope and revision identity. Acknowledging a
  committed title always advances the title baseline while preserving a newer
  local draft. Reading and lifecycle assertions are covered in
  `tests/page-editor-draft-integration.test.ts`.
- `noteCandidate` no longer overwrites a coordinator-resolved `Saved` state
  after an edit returns to the acknowledged semantic baseline. The same suite
  covers edit/undo before debounce and edit/rejected-save/undo recovery.
- The coordinator lifetime effect is keyed only to the editor instance, so a
  route layout object cannot dispose and recreate it. `flush()` now loops until
  all revisions queued during an in-flight request are acknowledged; deferred
  success, error and conflict refresh scenarios verify no overlap or automatic
  retry of blocked work.
- A request token invalidates editor acknowledgement side effects when a
  conflict, replacement baseline, disposal or coordinator replacement occurs
  while the server action is settling. The deferred conflict regression keeps
  the blocked local candidate intact.

This section records code and behavioural checks only. The parent-controlled
browser recheck is retained as an independent pre-merge review step.

## Parent-review-3 correction status

- The existing-checklist chooser snapshots the selected View and field values
  before deferred React state updates, including the name, label field,
  completion field and read-only controls. Link and slash-menu search inputs
  use the same event-value boundary.
- Active slash-menu Arrow, Enter and Escape keys run through the document
  capture handler before Tiptap. Normal editor keys continue through when the
  menu is closed.
- Stale recovery is one compact surface with one Use latest/Keep my version
  action pair. It renders bounded local and latest title/body previews through
  the shared safe Page renderer and states the replacement consequence without
  exposing JSON.
- tests/page-conflict-panel.test.ts covers the action count, readable
  comparison, no-JSON surface and bounded layout preview. The exact
  production-route chooser, keyboard and conflict journeys remain the
  coordinating agent's browser evidence.

## Parent-review-4 correction status

- Canonical route refreshes now preserve the live Tiptap document, selection and
  undo history when the latest Page matches both the acknowledged draft and
  the editor's current canonical layout. A server action that adds a new block
  still refreshes the editor because its live document is deliberately not yet
  equal to the returned canonical Page.
- Checklist slash insertion resolves the captured menu range rather than the
  selection after the chooser takes focus. It removes only the slash command
  while retaining surrounding prose, removes a command-only paragraph as one
  block, and derives the action placement from that captured block. Empty
  fallback paragraphs remain transient so a sole command can be removed safely.
- Switching between the create and existing checklist chooser modes retains the
  captured `afterBlockId` and `containerBlockId` placement while resetting
  mode-specific fields. Both directions are covered by a behavioral state
  transition regression in `tests/page-editor-draft-integration.test.ts`.
- Collapsible sections retain their closed state through the canonical editor
  round-trip, preventing a semantically equal refresh from reopening content.
- `tests/page-editor-draft-integration.test.ts` now covers the canonical
  refresh preservation decision, and `tests/page-editor-translator.test.ts`
  covers closed-section round-tripping. The parent-controlled production-route
  Alpha → quiet-save → Beta, undo and slash placement captures remain an
  independent browser acceptance step; this document makes no unexecuted
  browser claim.

## Exact verification results

Local verification on implementation/evidence head
`a25783007621117477711fefd808804d18ada52b`:

- `npm test`: **103 files, 1063 tests passed**.
- Focused editor/translator/conflict suites: **4 files, 29 tests passed**.
- `npm run format:check`: **passed**.
- `npm run typecheck`: **passed**.
- `npm run lint`: **passed with zero warnings/errors**.
- `npm run check:migration-immutability`: **50 historical migrations passed**.
- `npm run build` with local dummy service credentials: **passed**.
- `SUPABASE_TELEMETRY_DISABLED=1 npm run supabase:lint`: **passed; no schema
  errors found**.
- `git diff --check`: **passed**.
- `SUPABASE_TELEMETRY_DISABLED=1 npm run test:integration`: **21 files passed,
  191 tests passed, 96 skipped**. Seven suites were blocked by the deliberate
  local fixture guard because the already-populated Connection demo has
  configuration history beyond Version 2; the populated database was not
   reset. Clean seeded integration and RLS runs passed in the exact-head CI.

Exact-head CI for the final implementation/evidence head
a25783007621117477711fefd808804d18ada52b:

- [CI run 34196558706](https://github.com/benjaminbutty/smbos26/actions/runs/34196558706): **green, validate completed in 22m29s**.
- Formatting, typecheck, lint, unit tests, application build, migration
  immutability, clean migration application, all configured deterministic and
  authenticated acceptance suites, full PostgreSQL integration, PostgreSQL
  RLS integration and production dependency audit all completed successfully.

Exact-head CI for `ca0d6c9a8dd2d09dd1ae01eed0ff10d542a7aecf`:

- [CI run 34179416413](https://github.com/benjaminbutty/smbos26/actions/runs/34179416413): **green, validate completed in 18m36s**.
- Formatting, typecheck, lint, unit tests, application build, migration
  immutability, clean migration application, all configured deterministic and
  authenticated acceptance suites, full PostgreSQL integration, PostgreSQL
  RLS integration and production dependency audit all completed successfully.

Exact-head CI for correction commit
`9124e7b14fa4a519f6ca87cfdb622d1a4942c13f`:

- [CI run 34182312578](https://github.com/benjaminbutty/smbos26/actions/runs/34182312578): **green, validate completed in 21m23s**.
- Formatting, typecheck, lint, unit tests, application build, migration
  immutability, clean migration application, all configured deterministic and
  authenticated acceptance suites, full PostgreSQL integration, PostgreSQL
  RLS integration and production dependency audit all completed successfully.

Exact-head CI for the invalidated-response correction head
`c24227672db676a58839a856711502e23203c4b7`:

- [CI run 34185501471](https://github.com/benjaminbutty/smbos26/actions/runs/34185501471): **green, validate completed**.

Exact-head CI for the opaque request-token head
`e63432ad34d373048b901c55c3f2c9aff7e4293a`:

- [CI run 34185959239](https://github.com/benjaminbutty/smbos26/actions/runs/34185959239): **green, validate completed**.

Exact-head CI for the current documentation head
`6625a1e5bfad3f40ed4f852cc0d925b9b586301f`:

- [CI run 34186044557](https://github.com/benjaminbutty/smbos26/actions/runs/34186044557): **green, validate completed**.

## Browser evidence

The production route exercised in Google Chrome against the disposable local
Connection demo was
`http://localhost:3000/app/lenni-connections-demo/pages/daily-operations`.
The seeded Owner, Administrator and Staff accounts from
`scripts/demo-seed.mjs` executed the direct role journeys. Durable captures and
the role/viewport matrix are listed in [browser-journeys.md](./browser-journeys.md).
That ledger distinguishes direct browser workflows from controlled tests for
delayed/competing saves and automated coverage of the screenshot-paste upload
boundary:

- Owner: `1440×900`, `1024×768`, `390×844`, editing and Reading.
- Administrator: `1440×900`, `1024×768`, `390×844`, editing, Reading,
  archive and restore.
- Staff: `1440×900`, `1024×768`, `390×844`, shared reading, checklist tick and
  source Table return.

All nine matrix runs reported document scroll width equal to viewport width.
The final clean Owner reload had no observed application `error` or `warn`
console entries and remained `Saved`.

The ledger's state-reconciliation note records that its earlier checklist
capture and a later read-only parent inspection observed different
`Weekly opening tasks` presentations. No claim is made that the current
`daily-operations` route presents the block as a checklist until that
discrepancy is independently accepted.

## Architecture and scope boundaries

ADR-052 supersedes ADR-046 only for internal automatic-save timing and the
expanded bounded grammar; the Tiptap adapter and canonical persistence
boundary remain. The implementation adds the reusable private media registry,
the bounded Page-aware checklist action and additive validation/RLS policy.
Public Site, preview, acquisition, Forms, Booking, preorder, historical
configuration snapshots and rollback remain covered by their existing
contracts. No production database was reset, no public Site behaviour was
changed, and no live AI evaluation was run.

The only local verification limitation is the populated disposable Connection
fixture guard described above; clean CI reset/seed runs cover those suites.

**PR #75 remains open and unmerged for the coordinating agent's independent
pre-merge review.**
