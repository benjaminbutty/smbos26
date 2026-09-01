# Stage 1 Table Workbench v0 — evidence ledger

This directory records repeatable local review evidence for the Stage 1 Table
Workbench branch. No production credentials, personal data or customer data
belongs here.

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

## Acceptance audit

| Requirement | Current evidence | Status |
| --- | --- | --- |
| Generic runtime, typed editing, connections, record context and role boundary | Four-business proof plus direct-Table integration and unit suites | Verified locally |
| Complete-View search, exact count and bounded paging | Direct-Table integration, including the 1,250-Record fixture | Verified locally |
| Current, atomic bulk set/clear with no configuration Version | Direct-Table integration and the database RPC | Verified locally |
| Saved View candidate and connected-property safety | Composer, mapper and integration coverage | Verified locally |
| Owner/Admin/Staff desktop and mobile experience | Owner at 1440×900, Admin at 1024×768, and Staff at 390×844 across all five fixtures | Verified in browser |
| Screenshot, browser-console and configuration-history capture | Durable images below; local console had no warnings/errors; owner history rendered applied Changes and forward Versions | Verified in browser |
| Clean reset proof | `SUPABASE_TELEMETRY_DISABLED=1 npm run supabase:reset` applied all migrations through `20260901100000_stage_1_table_workbench.sql` | Verified locally |
| Production dependency audit | `npm audit --omit=dev --audit-level=high` reported 0 vulnerabilities | Verified locally |
| Draft PR and exact-head CI | Requires permission to create the external GitHub draft PR | Pending approval |

## Browser evidence

- [Owner desktop Table Workbench](screenshots/owner-milk-round-desktop-1440.png)
  shows the complete Table shell, transient search, View tabs, saved-view
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

## Captured technical evidence

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
