# Internal Pages redesign browser evidence

Date: 8 September 2026

Route under test: `http://localhost:3000/app/lenni-connections-demo/pages/daily-operations`

The production route was exercised in Google Chrome against the disposable
local Connection demo. The browser sessions used the seeded Owner,
Administrator and Staff identities from `scripts/demo-seed.mjs`; no production
data or live AI evaluation was used.

## Durable captures and responsive matrix

The role captures are retained beside this ledger:

- [Owner Page at 1440×900](./owner-page-1440x900.jpg)
- [Owner Page at 1496×769](./owner-page-1496x769.jpg)
- [Owner Reading mode](./owner-page-reading-1496x769.jpg)
- [Owner image replacement state](./owner-image-replacement-1496x769.jpg)
- [Administrator Page at 1024×768](./admin-page-1024x768.jpg)
- [Administrator Reading mode at 1024×768](./admin-page-reading-1024x768.jpg)
- [Administrator Page at 1496×769](./admin-page-1496x769.jpg)
- [Administrator Reading mode at 1496×769](./admin-page-reading-1496x769.jpg)
- [Staff Page at 390×844](./staff-page-390x844.jpg)
- [Staff Page top at 390×844](./staff-page-top-390x844.jpg)
- [Staff source Table](./staff-table-1496x769.jpg)

The exact role/viewport observations are recorded in
[responsive-role-matrix.json](./responsive-role-matrix.json). Each of the
nine Owner/Admin/Staff × 1440×900/1024×768/390×844 runs reported
`document.documentElement.scrollWidth` equal to the viewport width. Owner and
Administrator exposed editing and Reading controls; Staff exposed neither.
The mobile Staff capture is scrolled to the checklist controls as well as the
top-of-document capture so the operational surface is unobscured above the
fixed navigation.

The final clean Owner Page reload showed no observed application `error` or
`warn` console entries. The route remained at `Saved` after the cleanup reload.

## Executed browser journeys

| Journey | Direct browser execution | Supporting checks |
| --- | --- | --- |
| 1. Create, rename, write, format, reload | Owner created/renamed the Page, entered prose, formatted a heading, and reloaded. The title, document and `Saved` state remained. | `tests/integration/direct-page-workspace.test.ts`; atomic title/body persistence. |
| 2. Insert, move, remove, undo | Owner used slash and contextual insertion for the collapsible and checklist, exercised document ordering/removal and local undo, then removed temporary View blocks with the editor and confirmed the clean Page after reload. | `tests/direct-page-workspace.test.ts`, translator and stable block identity suites. |
| 3. Paste formatted content and screenshot | Owner pasted temporary text into the live Page editor, selected the inserted content for the floating formatting controls, and restored the clean document. Screenshot-paste is wired to the same bounded image upload path; the image boundary and screenshot/file payload handling were verified in automated tests. | `tests/page-editor-translator.test.ts`, `tests/page-assets.test.ts`, `tests/page-assets-route.test.ts`. |
| 4. Upload, replace and failure recovery | Owner selected a valid image, observed the upload placeholder, cancelled it, retried it to completion, removed it, and exercised image replacement. A deliberately oversized image displayed the 3 MiB rejection. | `tests/page-assets.test.ts`, `tests/page-assets-route.test.ts`, RLS integration and maintenance tests. |
| 5. Collapsible pointer and keyboard operation | Owner inserted `Opening routine`, edited its summary/body, and toggled collapse/expand while retaining the contained text. | Recursive grammar, translator and renderer suites reject nested sections and preserve contents. |
| 6. Two saved Views, search and edit | Owner inserted `Customers` and `Appointments` as two saved Views. Both loaded real rows (`Sam Jones` and `Milo`); the embedded Appointments View exposed the connected row. In the source Customers workspace, Owner created a temporary second record, searched `Alex`, edited it to `Alex Smith Jr`, restored `Alex Smith`, cleared the search, and archived the temporary record. On the final clean Page, Owner inserted the `Weekly opening tasks` View, created a temporary `Sage` record through the embedded New record action, searched `Sage` and observed `1 of 1 matching records`, then opened the source Table and archived that temporary record before removing the temporary embed. | Production Table query/action wiring, independent instance IDs, and experience integration cover the embedded path. |
| 7. Connected Record and return | Owner opened the embedded `Milo` record, observed the record panel with related Pet and Services connections, closed it, and returned to the same Page/row context. | Experience integration and record-panel tests cover the tenant-checked route boundary. |
| 8. Checklist as Staff and underlying Table | Staff signed in to the same Page, saw read/operate controls without editor controls, ticked `Count cash`, unticked/re-ticked it, opened the source `Weekly opening tasks` Table, and returned to the Page. | Checklist integration and RLS suites verify Record-backed completion, role/read-only rules and zero Page Versions for ticks. |
| 9. Duplicate and shared references | Owner used More → Duplicate and verified the copied Page retained the collapsible/checklist references. | Direct Page integration verifies fresh block IDs and shared View/Record/media references. |
| 10. Archive and restore | Administrator opened More → Archive, observed the Page under Archived Pages, restored it, and verified the active Page and same identity/content after reload. | Lifecycle integration and action-shape checks. |
| 11. Type during delayed save | Controlled deferred-request tests typed a later title/body revision while the first request was in flight; the queued revision was acknowledged in order. | `tests/page-save-coordinator.test.ts` covers quiet debounce, ten-second checkpoint, serial requests, no-op and acknowledgement ordering. |
| 12. Rejected/competing save recovery | Controlled service/action tests cover an unrelated-head revalidation and target-Page conflict. The editor keeps the candidate and requires Retry/Use latest/Keep my version; browser evidence covers the visible Owner/Admin recovery controls, while no unsupported forced server failure is claimed in the browser ledger. | Direct Page currentness/action-shape integration and RLS suites. |

## Role observations

Owner and Administrator use the same compact editing shell, title, save state,
Reading switch, More menu and live operational content. Staff sees the shared
PageRenderer content, checklist completion affordance and Open table link; the
editing title controls, block handles, View replacement and structural actions
are absent. The checklist tick changes the normal Record and does not become a
Page document mutation.

The embedded Views use the existing ProductionTableWorkspace. Their source
Table route has the full search, paging, inline edit, connected Record and
Record lifecycle controls. The Page route forwards the same tenant, currentness,
query/count, connection and action context and gives each embedded block an
independent instance identity. Read-only View state removes writes while
retaining read/search/paging behaviour.

At the end of the recorded browser run, the local Page was left clean: one
collapsible section and the
`Weekly opening tasks` checklist View remain, with temporary two-View and
image exercises removed through the UI and the saved Page reloaded. Archived
demo records created solely for the query journey remain out of the active
View and do not affect the Page.

## State reconciliation after the recorded run

The checklist journey and the `staff-page-*`/`staff-table-*` captures were
executed against the Page state in which `Weekly opening tasks` was configured
as a checklist View. During a later read-only parent inspection of the same
local route, that block loaded as a standard Table. No database or browser
mutation was used to make the two observations agree. The checklist row above
therefore records the earlier executed Staff journey and its supporting
captures; it does not claim that the current inspected `daily-operations`
state still presents that block as a checklist. The Page-aware checklist
boundary and zero-Version completion behaviour remain covered by the named
automated integration and RLS tests.
