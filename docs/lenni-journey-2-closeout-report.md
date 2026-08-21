# Lenni Journey 2 — closeout ledger

Date: 2026-08-21

## Status

The Journey 2 implementation is locally complete through I5 and ready for final owner review. The remaining release gate is an exact-head GitHub pull-request CI run; the repository workflow runs on `pull_request` and `main`, not on ordinary Journey 2 feature-branch pushes.

## Checkpoint ledger

- **I0 — UI/repository resolution:** complete. The architecture brief records the locked information architecture, source mapping, acceptance boundaries, and explicit exclusions.
- **I1 — Shell and Home:** complete. Tables and Pages are direct workspace destinations; the obsolete Work grouping and duplicate utility navigation are removed; Home stays honest and role-aware.
- **I2 — Tables, Views, and Record entry:** complete. Table-local search, no-match state, Saved View tabs, filter/sort/group summaries, responsive Record-first mobile presentation, compact Properties disclosure, stale reload state, and an accessible Record drawer are covered.
- **I3 — Record, Forms, Connections, and quick-create:** complete. Configured form creation uses the existing validated submission and GraphService path, then revalidates; Record context links back to its Table; connection creation remains bounded to one Record.
- **I4 — Pages and live Views:** complete. Pages support Heading, Text, Divider, and exact configured Saved View blocks. The local Page proof persisted an `Operations overview` Page containing all four block types and a live Customers View.
- **I5 — Cross-business, responsive, access, and closeout:** locally complete. The proof now covers Milk round, Mobile dog groomer, Catering enquiry, and Trades / jobs using the same generic primitives; Owner, Admin, and Staff browser checks passed; the public Bedford route remains live; no browser error logs were observed.

## Generic proof coverage

The local proof seed creates four Businesses without a product-specific primitive or migration:

- `Proof — Milk round` — Customers, Products, Standing Orders, Standing Order Lines;
- `Proof — Mobile dog groomer` — Customers, Pets, Appointments, Services;
- `Proof — Catering enquiry` — Contacts, Enquiries, Events, Quotes;
- `Proof — Trades and jobs` — Customers, Jobs, Tasks.

The Trades / jobs proof includes Customer and Job connections, status/date fields, a Scheduled Jobs View, and a Tasks by Job View. It is evidence that the same configuration/runtime path works for a fourth business shape; it is not a new vertical module.

## Validation evidence

- `npm run check` — passed: 89 test files, 948 tests; formatting, typecheck, lint, and unit tests all passed.
- Focused local integration run — passed: 7 files, 95 tests, including internal workspace, Pages, Experience, Record creation/update, preorder, and RLS coverage.
- `npm run workspace:proof:seed` — passed: 2 integration tests against the four-business proof.
- `npm run demo:seed` — passed; Bedford Owner/Staff fixtures and the public preorder route were restored after integration cleanup.
- `git diff --check` — passed.
- Browser runtime error log — empty during final public-route/Page verification.

## Browser proof routes

- Bedford public preorder: `/p/bedford-bakery-demo/preorder` at 1440, 1024, and 390px; each viewport stayed within its width.
- Internal Page proof: `/app/lenni-connections-demo/pages/operations-overview` at 1440 and 390px; status reached Saved and the live Customers View rendered.
- Owner checks covered Home, Tables, Saved Views, Record drawer/full Record, Connections, internal Pages, Builder state, and the preserved public route.
- Staff checks covered Home, mobile More navigation, Orders, and read-only Settings; structural Create/Add controls were absent.
- The latest four-business proof set was also checked under Owner, Admin, and Staff memberships at 1440 and 390px. Owner/Admin retained structural controls and operating Tables; Staff retained read-only operating access with Create Table/Page, Tell Lenni, and Changes absent. The temporary local Admin/Staff memberships were added only for this browser audit and are not production configuration.

## Known release follow-ups

1. Open the I5 branch as a pull request and wait for the workflow’s exact-head CI run. No PR or CI run is claimed here because the environment blocked the earlier external-disclosure PR creation path.
2. The Builder remains in its existing local disabled/manual state; no AI provider or new Builder behavior was introduced by Journey 2.

Journey 2 intentionally does not add a primitive, migration, global search, permanent chat, payment flow, customer portal, or new business-specific runtime module.
