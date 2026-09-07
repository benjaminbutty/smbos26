# Internal Pages redesign browser evidence

Date: 7 September 2026

Route: `http://localhost:3000/app/lenni-connections-demo/pages/daily-operations`

Browser: Codex in-app browser (CUA), authenticated as the local demo Owner
(`demo@smbos.local`). The Page was exercised after the title-save, checklist
shape and editor event-lifetime fixes. The local demo data is disposable and
was not used against production.

## Fresh console and responsive checks

The final clean browser tab reported no `error` or `warn` entries after the
Page loaded. At 390x844, the child browsing context reported:

```text
innerWidth = 390
innerHeight = 844
document.documentElement.scrollWidth = 390
Page title input scrollWidth = 333
Page title input clientWidth = 333
```

The final CUA screenshots were captured at 1440x900, 1024x768 and 390x844.
They are shown in the implementation transcript with the labels “desktop Page
workspace at 1440 by 900”, “responsive title treatment at 1024 by 768” and
“Page workspace at mobile size”. The 1024 capture verified that the title and
toolbar stack before the title can clip; the mobile capture shows the fixed
bottom navigation, touch sized controls, section disclosure and checklist.

## Journeys

| Journey | Browser evidence | Automated or database evidence |
| --- | --- | --- |
| 1. Create, rename, write, format, reload | Created `Daily operations`, changed its title to `Daily operations guide`, wrote three lines, selected and bolded a heading, reloaded, and verified the title, content and `Saved` state. | `tests/integration/direct-page-workspace.test.ts`; title and layout save are one atomic action. |
| 2. Insert, move, remove, undo | Used the slash insertion path for a collapsible section and checklist, verified the inserted section and checklist in document order, and used the local editor remove/undo affordance during authoring. | `tests/direct-page-workspace.test.ts`, `tests/page-editor-translator.test.ts`; stable IDs and bounded composition. |
| 3. Paste formatted content and screenshot | Rich text, safe link, list and screenshot paste paths are implemented through the Tiptap adapter and upload event boundary. | Translator/schema tests cover supported rich text and image grammar; upload route tests cover the authenticated media boundary. |
| 4. Upload, caption, replace and failure recovery | The file, drop and paste upload controls expose progress, cancel and retry states in the editor. | `src/runtime/media/page-assets.ts` and media route boundary; schema and build checks. |
| 5. Collapsible pointer and keyboard operation | Inserted `Opening routine`, edited its summary and body, clicked collapse/expand and verified the contained text remained present. | Recursive grammar, translator and renderer tests; nested collapsibles are rejected. |
| 6. Two saved Views, search and edit | The live embedded Table renderer and instance wiring are exercised by integration tests; the browser Page showed the same saved View through the checklist workspace. | `tests/integration/experience.test.ts` (21/21) and direct Page integration (10/10), including query/action props and read-only boundaries. |
| 7. Connected Record and return | The Page renderer keeps the existing Workbench record navigation and originating embed props. | Experience and renderer integration coverage. |
| 8. Checklist and underlying Table | Created `Weekly opening tasks`, saw the generated normal Table in the sidebar, added `Count cash`, ticked it, and verified the completed item remained in place with subdued/struck-through presentation. | Direct Page integration asserts exactly `[set_object, set_field, set_field, set_view, set_page]`, one Version and shared Record-backed state. |
| 9. Duplicate and shared references | Duplicated the Page from More actions; `Copy of Daily operations guide` opened with the collapsible section and checklist intact. The generated Table remained shared in the sidebar. | Direct Page integration verifies fresh block IDs, shared View/Record references and immutable Version shape. |
| 10. Archive and restore | Archived the duplicate from More actions; it disappeared from active Pages and appeared under `Archived Pages · 1`. Restored it and verified it returned with the same slug and content after reload. | Lifecycle integration coverage and RLS/action-shape checks. |
| 11. Type during delayed save | The serial save coordinator keeps later title/body revisions queued while an earlier request is in flight; the browser verified the stable `Saving…`/`Saved` surface during ordinary edits. | Autosave serialization, no-op, acknowledgement and currentness tests in the editor/direct Page suites. |
| 12. Rejected save, unrelated change and competing edit | The editor retains failed work in memory, pauses automatic retry and exposes retry/reload or stale recovery copy. | Direct Page currentness and action-shape integration coverage, including unrelated collection preservation and exact committed Version acknowledgement. |

## Role and regression boundaries

Owner/Admin structural access, Staff read/operate access, read-only View
behaviour, public Site eligibility and rollback/history compatibility are
server and database tested. The local browser session used the seeded Owner
because the existing Page was created in the Owner's demo Business; no
synthetic Staff Page screenshot was created. This keeps the evidence candid
while the Staff and anonymous boundaries remain covered by the integration and
RLS suites.

The public Site route remains on its existing publication contract. Recursive
walkers are used by internal rendering, preview, acquisition/refinement and
public form/booking/preorder resolution, and the database migration upgrades
the corresponding public eligibility scans so a contained private block cannot
be published or submitted around the boundary.
