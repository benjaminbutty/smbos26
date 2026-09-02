# Stage 1 Table Workbench v0 — evidence ledger

This directory records repeatable local review evidence for the Stage 1 Table
Workbench branch. No production credentials, personal data or customer data
belongs here.

## Owner correction pass — fresh browser capture complete

The original v0 evidence below is retained for traceability but was **owner
rejected and is superseded** for acceptance purposes. It recorded a capable
runtime whose visible Table hierarchy still used saved-View tabs, implicit grid
selection and an over-large candidate editor. It must not be used to claim
acceptance of the correction pass.

The replacement evidence uses only the local synthetic Milk round proof
Business. It records the current-View selector, toolbar search/control
composition, explicit bulk checkbox selection, one-action record entry,
Connection quick-create copy and pointer column reordering at the required
Owner/Admin/Staff viewports.

## Correction technical evidence — 2 September 2026

The following correction-head checks passed after a clean local database reset
and fresh proof seed:

- focused UI tests: 46/46 across `pre-reset-hygiene`, `lenni-unified-ui` and
  `editor-kernel`;
- full unit suite: 94 files, 1,004 tests passed;
- focused trusted-boundary integration: direct Table workspace 14/14 and
  Experience 21/21;
- fresh four-business persisted proof seed: 2/2, including the 20-record
  synthetic Milk round setup;
- TypeScript, ESLint, Prettier, migration immutability and `git diff --check`;
- production build, local Supabase schema lint and production dependency audit
  with 0 high-severity vulnerabilities.

These checks establish the generic runtime and trust boundaries. The
authenticated visual, overflow and configuration-history evidence is recorded
below.

## Correction browser evidence — 2 September 2026

All browser actions ran against `localhost` using only the persisted synthetic
proof accounts and data. No credentials, personal data or production service
was used.

| Owner finding | Local proof and result |
| --- | --- |
| Saved-View tabs competed with the Table | Owner desktop shows one closed **Current view** selector; its menu is primary-first, marks the current saved View and ends with **Create new view**. |
| Candidate controls were too large and no live preview was clear | A new `Open correction review` candidate used the compact Filter panel and changed the live preview to **16 of 16 matching Records** before creating one normal saved View. |
| Selection was ambiguous | Ten deliberate leading checkboxes showed **10 Records selected** and a scoped `Set Workspace flag for 10 Records` action; success cleared only that explicit selection. |
| New record entry required extra action | **New standing orders** opened a focused `Edit Name` cell immediately. Entering `Correction record 21` persisted the full name as the 21st local Record. |
| Connection quick-create was hidden or impersonal | The Customer picker displayed **+ Create new Customer** before typing, then **+ Create “Correction customer 21” as a new Customer** after typing. |
| Drag feedback/reorder was unusable | A real pointer drag moved `Workspace flag` after `Status`; the rendered header order changed and an ordinary `reorder_columns` Change was recorded. Keyboard move actions remain available in each header menu. |
| Tablet and phone could overflow or lose context | Admin at 1024×768 and Staff at 390×844 each had `documentElement.scrollWidth === innerWidth`; Staff saw concise cards and a full Record dialog without a Working-property selector. |

The owner Change history recorded the saved-View create as Version 21 and the
separate pointer reorder operations as Versions 22–25. The local bulk field
operation created no configuration Version. The final role/viewport reloads
added no console warnings or errors; the retained tab log includes one earlier
Fast Refresh dependency warning from development at 10:58 UTC, before the
final reloads, and is not treated as acceptance evidence.

### Correction screenshots

- [Owner Table at 1440×900](screenshots/correction-owner-standing-orders-1440.png)
- [Current-View selector](screenshots/correction-owner-view-selector-1440.png)
- [Unsaved candidate with live preview](screenshots/correction-owner-view-candidate-1440.png)
- [Explicit 10-record selection](screenshots/correction-owner-bulk-selection-1440.png)
- [Scoped bulk result](screenshots/correction-owner-bulk-result-1440.png)
- [Focused one-click record entry](screenshots/correction-owner-new-record-1440.png)
- [Connection picker quick-create](screenshots/correction-owner-connection-quick-create-1440.png)
- [Completed pointer reorder](screenshots/correction-owner-column-reordered-1440.png)
- [Owner configuration history](screenshots/correction-owner-changes-1440.png)
- [Admin Table at 1024×768](screenshots/correction-admin-standing-orders-1024.png)
- [Staff cards at 390×844](screenshots/correction-staff-standing-orders-390.png)
- [Staff full Record context](screenshots/correction-staff-record-context-390.png)

## Required review routes

After a clean local reset and the existing proof/demo seeds, review the
generic Tables for Milk round, dog groomer, catering enquiry, trades/jobs and
Bedford preorder regression. Exercise Owner, Admin and Staff at 1440×900,
1024×768 and 390×844.

The persisted generic proof seed exposes these local review starting points:

- `http://localhost:3000/app/proof-milk-round/workspace/active-orders`
- `http://localhost:3000/app/proof-mobile-dog-groomer/workspace/appointments-this-week`
- `http://localhost:3000/app/proof-catering-enquiry/workspace/open-enquiries`
- `http://localhost:3000/app/proof-trades-and-jobs/workspace/scheduled-jobs`

The existing demo seed prints the Bedford preorder regression route when it
runs: `http://localhost:3000/app/bedford-bakery-demo/workspace/orders`.

For each Table, confirm:

1. search counts the complete current View and Load more stays bounded;
2. typed editing, creation, Connection pickers and Record context retain the
   established capability boundary;
3. selected loaded Records can set or clear one eligible direct Property, and
   an intentionally stale marker leaves every selected Record unchanged;
4. a saved candidate previews multiple filters, all/any, ordered sorts, group,
   Property order/visibility/width and produces one normal configuration
   Version on Save;
5. a one-hop related Property is read-only, searchable and leads through the
   connected Record; and
6. mobile shows concise Record cards and a full-screen Record context, never a
   “Working property” selector.

The focused integration suite also creates a real 1,250-Record Table fixture.
It proves an accurate complete-View count, 50-Record first and final pages,
and a search match beyond the initial page. It does not replace the requested
authenticated browser review at the stated desktop and mobile widths.

## Original v0 acceptance audit — owner rejected / superseded

| Requirement | Current evidence | Status |
| --- | --- | --- |
| Generic runtime, typed editing, connections, record context and role boundary | Four-business proof plus direct-Table integration and unit suites | Historical; superseded for owner acceptance |
| Complete-View search, exact count and bounded paging | Direct-Table integration, including the 1,250-Record fixture | Historical; superseded for owner acceptance |
| Current, atomic bulk set/clear with no configuration Version | Direct-Table integration and the database RPC | Historical; superseded for owner acceptance |
| Saved View candidate and connected-property safety | Composer, mapper and integration coverage | Historical; superseded for owner acceptance |
| Owner/Admin/Staff desktop and mobile experience | Owner at 1440×900, Admin at 1024×768, and Staff at 390×844 across all five fixtures | Owner rejected; replace in correction pass |
| Screenshot, browser-console and configuration-history capture | Durable images below; local console had no warnings/errors; owner history rendered applied Changes and forward Versions | Owner rejected; replace in correction pass |
| Clean reset proof | `SUPABASE_TELEMETRY_DISABLED=1 npm run supabase:reset` applied all migrations through `20260901100000_stage_1_table_workbench.sql` | Historical; rerun before correction sign-off |
| Production dependency audit | `npm audit --omit=dev --audit-level=high` reported 0 vulnerabilities | Historical; rerun before correction sign-off |
| Draft PR and exact-head CI | Requires exact correction head | Pending correction head |

## Original v0 browser evidence — owner rejected / superseded

- [Owner desktop Table Workbench](screenshots/owner-milk-round-desktop-1440.png)
  shows the complete Table shell, transient search, the prior View tabs, saved-view
  summary, grid and quiet saved state at 1440×900.
- [Owner saved-View controls](screenshots/owner-saved-view-controls-1440.png)
  shows typed filter, all/any, sort, group, related Property and width controls
  before Save; it was discarded without a configuration change.
- [Owner record drawer](screenshots/owner-record-drawer-1440.png) confirms
  typed fields, Connection controls and connected-record navigation/back.
- [Admin tablet Table](screenshots/admin-trades-tablet-1024.png) confirms the
  same generic workbench at 1024×768.
- [Staff mobile cards](screenshots/staff-trades-mobile-cards-390.png) and the
  [full-screen Record context](screenshots/staff-trades-mobile-record-context-390.png)
  confirm the 390×844 mobile replacement for the legacy Working-property UI.
- [Owner empty Table](screenshots/owner-empty-table-mobile-390.png) confirms
  the first-Record empty state without replacing the Table surface.
- [Owner configuration history](screenshots/owner-milk-round-history-1440.png)
  records applied Table Changes and immutable forward Versions after the seed.

All browser checks ran against `localhost` after the clean reset and fixture
seeds. The captured console had no warnings or errors.

## Original v0 captured technical evidence — owner rejected / superseded

- focused unit tests: `tests/internal-workspace-engine.test.ts`,
  `tests/direct-table-workspace.test.ts`,
  `tests/editor-kernel-production.test.ts`;
- focused integration: `tests/integration/direct-table-workspace.test.ts`
  (14 tests, including the 1,250-Record paging/search fixture); and the existing four-business generic proof fixture
  `tests/integration/internal-workspace-engine.test.ts` (2 tests);
- full integration: 27 files, 275 passed and 5 intentionally skipped;
- clean reset applied every historical migration and the Stage 1 migration in
  order, followed by a schema lint with no errors;
- authenticated browser coverage of all five fixtures, one role at each
  required viewport, plus empty/populated Table states, saved View controls,
  connected drawer navigation, history and a clean browser console; and
- `npm audit --omit=dev --audit-level=high` reported 0 vulnerabilities.
