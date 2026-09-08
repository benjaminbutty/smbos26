# READY FOR PRE-MERGE REVIEW

Date: 8 September 2026

PR: [#75](https://github.com/benjaminbutty/smbos26/pull/75) — open and
unmerged.

The implementation code tested for this review is commit
`ca0d6c9a8dd2d09dd1ae01eed0ff10d542a7aecf`. Its exact-head GitHub Actions run
is [34179416413](https://github.com/benjaminbutty/smbos26/actions/runs/34179416413)
and completed successfully. The commit following this record contains only
this final evidence update; the final PR head and its check run are reported
with the handoff so the parent can verify the immutable final head directly.

## Requirement and implementation checklist

| Stage | Completed implementation and evidence |
| --- | --- |
| 1. Architecture and boundaries | [ADR-052](../../ADR-052.md) records the approved save timing, finite recursive Page grammar, exact committed-Version acknowledgement, bounded checklist composition, Page-aware operational writes and private media boundary. The architecture index is amended. Additive migrations preserve historical snapshots, rollback, Sites, Forms, Booking and preorder. |
| 2. Document shell and product quality | The compact Page toolbar, inline title, breadcrumb, save state, Reading/Edit control, overflow actions, contextual block controls and calm document canvas are implemented. Desktop title sizing, compact operational content, 44 px touch targets and zero document overflow were checked in the [browser ledger](./browser-journeys.md) and [role/viewport matrix](./responsive-role-matrix.json), with durable Owner, Administrator and Staff captures. |
| 3. Autosave and recovery | A serial coordinator provides a 1.5 second quiet debounce, ten-second continuous-typing checkpoint, no-op suppression, queued revisions, exact acknowledgements, deliberate retry, unrelated-head revalidation, target conflict recovery, Reading preservation and save-before-navigation/lifecycle operations. Behavioural deferred-request, currentness and action-shape tests cover later edits during an in-flight request, failure/conflict recovery and no-op/version semantics. |
| 4. Finite writing and composition | Paragraphs, headings 1–3, safe links and Page picker, lists, divider, callout, collapsible sections, slash/gutter insertion, contextual formatting, duplicate/move/remove/undo and stable block identities translate to the canonical grammar. Recursive validators, dependency/reference walkers, renderer, preview/public eligibility checks and historical snapshot projection traverse contained blocks and enforce the 100-block limit. |
| 5. Private images | Authenticated Owner/Admin upload and asset routes validate tenant membership before bounded request buffering, accept JPEG/PNG/WebP within the 3 MiB/20 MP limits, decode/re-encode with metadata removal and encoded-size checks, and use private Storage. Placeholder progress, cancel, retry, replace, remove, presentation and failure states are implemented. Cleanup retains historical-Version references and removes only eligible old failed/unreferenced assets. |
| 6. Workbench Views and checklists | Embedded Views reuse `ProductionTableWorkspace` with tenant, currentness, query/search/paging/counts, Connections, connected Record panels, contextual creation, permitted bulk/lifecycle actions and independent block-instance state. Checklist blocks use normal Record data, support create/use-existing source selection, text/boolean mapping, placement, paging/search, label edits and Page-aware role/read-only validation; ticks create zero Page Versions. |
| 7. Page lifecycle and roles | Create opens a uniquely named untitled Page with selected title; rename preserves slug; duplicate creates fresh block IDs while sharing operational references; archive/restore preserves Page identity and references. Owner and Administrator edit/read/archive/restore; Staff receives shared read/operate content with permitted checklist writes and no document mutations. |
| 8. Verification and evidence | The full local checks and exact-head CI below are green. The twelve required interaction journeys, including Owner, Administrator and Staff role coverage, are recorded with durable screenshots and responsive observations in [browser-journeys.md](./browser-journeys.md). No production reset or live AI evaluation was used. |

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

## Exact verification results

Local verification on the tested implementation commit:

- `npm test -- --reporter=dot`: **101 files, 1050 tests passed**.
- Focused Page/editor suites: **4 files, 67 tests passed**.
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

Exact-head CI for `ca0d6c9a8dd2d09dd1ae01eed0ff10d542a7aecf`:

- [CI run 34179416413](https://github.com/benjaminbutty/smbos26/actions/runs/34179416413): **green, validate completed in 18m36s**.
- Formatting, typecheck, lint, unit tests, application build, migration
  immutability, clean migration application, all configured deterministic and
  authenticated acceptance suites, full PostgreSQL integration, PostgreSQL
  RLS integration and production dependency audit all completed successfully.

## Browser evidence

The production route exercised in Google Chrome against the disposable local
Connection demo was
`http://localhost:3000/app/lenni-connections-demo/pages/daily-operations`.
The seeded Owner, Administrator and Staff accounts from
`scripts/demo-seed.mjs` completed the twelve journeys. Durable captures and
the role/viewport matrix are listed in [browser-journeys.md](./browser-journeys.md):

- Owner: `1440×900`, `1024×768`, `390×844`, editing and Reading.
- Administrator: `1440×900`, `1024×768`, `390×844`, editing, Reading,
  archive and restore.
- Staff: `1440×900`, `1024×768`, `390×844`, shared reading, checklist tick and
  source Table return.

All nine matrix runs reported document scroll width equal to viewport width.
The final clean Owner reload had no observed application `error` or `warn`
console entries and remained `Saved`.

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
