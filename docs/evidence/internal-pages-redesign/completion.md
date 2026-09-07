# READY FOR PRE-MERGE REVIEW

Date: 7 September 2026

PR: [#75 — Internal Pages document workspace redesign](https://github.com/benjaminbutty/smbos26/pull/75)

Branch: `codex/internal-pages-redesign`

Baseline: `bd8b13304b0aef6837e937ad20da37c4a9bee60f`

Tested implementation commit: `5320f1dc8d3db937a8cc2ef275699919b731198c`

The PR is pushed and intentionally unmerged for the coordinating agent's
independent pre-merge review.

## Approved implementation checklist

| Requirement | Evidence |
| --- | --- |
| Stage 1 — architecture and security boundaries | ADR-052; additive migrations; tenant checked private media registry/Storage policies; no production reset or live AI evaluation. |
| Stage 2 — polished document shell | Internal Page shell in `internal-page-editor.tsx`; contextual toolbar, title, save state, Reading mode, empty hints, responsive CSS; CUA captures at 1440x900, 1024x768 and 390x844. |
| Stage 3 — serial autosave and recovery | 1.5s debounce/10s continuous checkpoint, Cmd/Ctrl+S flush, no-op suppression, queued revisions, stale/error recovery and exact committed Version currentness in the Page service. |
| Stage 4 — bounded writing grammar | Rich text marks/lists/links, slash/plus insertion, safe Page picker, movement/removal/undo, one-level collapsible sections, canonical translator and recursive walkers. |
| Stage 5 — private media | `media_assets`, private `page-assets` bucket/RLS, authenticated upload/download routes, MIME/3 MiB/20 megapixel validation, cancel/retry/caption/alt/presentation UI and historical reference retention. |
| Stage 6 — live Tables and checklists | Existing ProductionTableWorkspace/adapters with full query/action context; checklist UI over normal Records; exact five-operation composite shape and no Page Version for item ticks. |
| Stage 7 — Page lifecycle/navigation | Create, inline rename, duplicate with fresh IDs/shared references, archive and same-identity restore; active/archived sidebar and mobile navigation. |
| Stage 8 — verification and handoff | This evidence pack, full local gates, clean CI workflow, PR #75 and browser journey ledger. |
| Snapshot/rollback compatibility | `configurationSnapshotV1Schema` continues to embed the expanded `pageLayoutSchema`; historical external images remain valid; database candidate materialization/projection preserves layouts. |
| Public eligibility containment | TypeScript and SQL public/form/booking/preorder/preview/acquisition/refinement walkers use contained blocks; managed assets and internal Views/Forms cannot be hidden inside a public collapsible section. |
| Narrow direct action boundary | PostgreSQL accepts the exact one `set_page` lifecycle/save shape and the exact `[set_object,set_field,set_field,set_view,set_page]` checklist shape; non-Page collections are explicitly unchanged. |
| Exact acknowledgement | The Page service reads the `applied_version_id` returned by the action and derives currentness from that committed change set; it does not reread a later concurrent head. |

## Acceptance journeys

The full mapping and candid role notes are in
[`browser-journeys.md`](./browser-journeys.md).

| Journey | Status |
| --- | --- |
| 1. Create/rename/write/format/reload | Browser verified on the authenticated Owner Page; direct Page integration covers atomic title/body persistence. |
| 2. Insert/move/remove/undo | Browser inserted and edited sections/checklists; translator and direct Page tests cover stable IDs and undoable document edits. |
| 3. Paste formatted content and screenshot | Finite rich text/image paste paths implemented and schema/translator/media boundary tested. |
| 4. Upload/caption/replace/failure recovery | Upload UI and retry states implemented; media decode/limit tests and tenant database validation pass. |
| 5. Collapsible pointer/keyboard operation | Browser inserted, edited, collapsed and expanded `Opening routine`; nested sections rejected by grammar. |
| 6. Two saved Views/search/edit | Production Table query/action wiring and integration suites cover complete View operation and independent embeds. |
| 7. Connected Record/return | Existing Workbench connection and focus-return context retained; Experience integration covers the route boundary. |
| 8. Checklist/add/tick as Staff/underlying Table | Owner browser created the normal Table, added and ticked a Record; integration/RLS suites cover Staff permissions and shared state. |
| 9. Duplicate/shared references | Browser verified duplicate content and shared checklist Table; direct integration proves fresh IDs and shared refs. |
| 10. Archive/restore | Browser verified active removal, Archived Pages dialog, restore and same slug/content after reload. |
| 11. Type during delayed save | Serial save coordinator and acknowledgement ordering tests cover queued subsequent edits. |
| 12. Rejected/competing save recovery | Currentness/action-shape integration covers stale competing Page edits, unrelated changes and retained recovery candidates. |

## Verification results

Local checks on the tested implementation commit:

- `npm run format:check` — passed.
- `npm run typecheck` — passed; Next route types generated successfully.
- `npm run lint` — passed with zero warnings/errors.
- `npm test -- --reporter=dot` — **96 files, 1,019 tests passed**.
- `npm run build` with CI-only dummy secrets — passed; all application/API routes compiled.
- `npm run check:migration-immutability` — passed; 50 historical migrations unchanged.
- `SUPABASE_TELEMETRY_DISABLED=1 npm run supabase:lint` — passed; no schema errors.
- `npm run test:acquisition` — **3 files, 40 tests passed**.
- `SUPABASE_TELEMETRY_DISABLED=1 npm run test:integration -- tests/integration/direct-page-workspace.test.ts` — **10 tests passed**.
- `SUPABASE_TELEMETRY_DISABLED=1 npm run test:integration -- tests/integration/experience.test.ts` — **21 tests passed**.
- CUA final browser console — empty `error`/`warn` log set on the clean Page tab; 390px document width exactly matched the viewport.

GitHub Actions CI run [34134842637](https://github.com/benjaminbutty/smbos26/actions/runs/34134842637) ran against
`5320f1dc8d3db937a8cc2ef275699919b731198c` and completed **success** in
19m28s. All 89 workflow steps passed, including clean migration replay,
OpenAI provider safety tests, AI-safe context tests, configuration/rollback/
preview suites, full PostgreSQL integration, RLS and dependency audit.

The local AI-context rerun could not reuse the browser-polluted demo fixture
because `scripts/demo-seed.mjs` correctly refuses a Connection demo beyond
Version 2. A whole local reset was rejected by the automatic destructive-action
review, so the local fixture was preserved. CI's clean reset, seed and AI-safe
context steps passed. No production database was reset.

## Browser evidence

The CUA browser journey was run against the local authenticated route with the
Owner identity. The transcript contains the final screenshot artifacts for:

- 1440x900 desktop document surface with title, save state, collapsible section
  and live checklist Table.
- 1024x768 medium desktop surface after the responsive title fix; the toolbar
  stacks before the title clips.
- 390x844 mobile surface with fitted title, touch controls, fixed navigation,
  disclosure section and checklist.

The durable interaction ledger is
[`browser-journeys.md`](./browser-journeys.md). The existing local demo Page
was used for the interaction proof; no synthetic Staff screenshot was claimed.
Staff/anonymous/public boundaries are covered by the clean integration and RLS
CI suites.

## Residual issues

No known product or CI defect remains. The local AI-context fixture limitation
is environmental and is covered by the green clean CI run above. Browser image
captures are retained in the CUA implementation transcript and described in the
durable ledger; no production media was created.
