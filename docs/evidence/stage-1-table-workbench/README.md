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

- `http://localhost:3000/app/proof-milk-round/workspace/active_orders`
- `http://localhost:3000/app/proof-mobile-dog-groomer/workspace/appointments_this_week`
- `http://localhost:3000/app/proof-catering-enquiry/workspace/open_enquiries`
- `http://localhost:3000/app/proof-trades-and-jobs/workspace/scheduled_jobs`

The existing demo seed prints the Bedford preorder regression route when it
runs: `http://localhost:3000/app/bedford-bakery/workspace/orders`.

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
| Owner/Admin/Staff desktop and mobile experience | Requires authenticated browser review on the routes above | Pending approval |
| Screenshot, browser-console and configuration-history capture | Requires authenticated browser review | Pending approval |
| Clean reset proof | Requires permission to delete/recreate local development data | Pending approval |
| Production dependency audit | Requires permission to send dependency metadata to the npm audit endpoint | Pending approval |
| Draft PR and exact-head CI | Requires permission to create the external GitHub draft PR | Pending approval |

## Captured technical evidence

- focused unit tests: `tests/internal-workspace-engine.test.ts`,
  `tests/direct-table-workspace.test.ts`,
  `tests/editor-kernel-production.test.ts`;
- focused integration: `tests/integration/direct-table-workspace.test.ts`
  (14 tests, including the 1,250-Record paging/search fixture); and the existing four-business generic proof fixture
  `tests/integration/internal-workspace-engine.test.ts` (2 tests);
- full integration: 27 files, 275 passed and 5 intentionally skipped;
- transactional database validation of
  `20260901100000_stage_1_table_workbench.sql` against the existing local
  schema (the transaction is rolled back);
- the Stage 1 migration was also applied to the existing local development
  database and the browser route was checked through the normal Lenni
  sign-in boundary;
- a clean reset and authenticated browser screenshots remain pending explicit
  local-database reset authorisation because reset drops/recreates development
  data, plus immediate permission to enter a local proof account password in
  the browser; and
- the production dependency audit remains pending explicit permission to send
  the repository dependency metadata to the npm audit endpoint.
