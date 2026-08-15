# Unified Lenni Product Experience Redesign v1 — C8 whole-product acceptance

## Checkpoint record

- Checkpoint: C8 — whole-product acceptance and bounded corrections
- Branch: `redesign/c8-whole-product-acceptance`
- Base: merged C7 `c478b5062ffb7de851963dddefe50c9cb34f9671`
- Product correction: none; one bounded acceptance-test correction canonicalizes
  set-valued preorder `location_ids` before comparing the current and retained
  Milestone 4 compatibility resolver
- PR: [#48](https://github.com/benjaminbutty/smbos26/pull/48)
- Final exact-head SHA: `ae5bf3103cfedffeca9892d4df374afc45dc927e`
- Merge SHA: `52fdee589c7fd3399b340777c2157a0c4827856b`
- Exact-head CI: [run 31857182305](https://github.com/benjaminbutty/smbos26/actions/runs/31857182305)
- Authority: Sections 8, 9, 16, 17 and 18 of the Unified Lenni Product
  Experience Redesign v1 execution prompt, the Programme Brief, Design System
  and UX Constitution v2, the Stitch Reference Manifest, and the existing
  application/runtime contracts

## Outcome

C8 ran the redesigned product as a system across the available real fixtures,
target sizes and role boundaries. The C7 baseline remains coherent across
acquisition, the authenticated shell, operational work, configuration history,
Settings, authentication entry and public preorder. No product correction was
justified by the acceptance evidence. The only code change is the focused
integration-test normalization above: preorder `location_ids` are a set for
this compatibility assertion, while the current resolver deliberately emits a
canonical order. No product code, capability, route, state, schema,
dependency or AI behavior changed in C8.

The only material evidence limits are fixture limits already recorded in C0:
trades/jobs has no persisted local Business route, and the Bedford fixture has
Owner and Staff memberships but no Bedford Admin membership. Both boundaries
remain covered by the existing source, authorization and integration contracts;
no synthetic production route or role was introduced to manufacture evidence.

## Required journey matrix

| Journey | Result | Evidence |
| --- | --- | --- |
| Public description → proposal → signup → confirmation → creation → Home | Pass; existing C2 acquisition/proposal flow and deterministic proposal contracts remain green | C2 report evidence and acquisition/integration suites |
| Manual empty workspace → New Table/New Page/Tell Lenni | Pass; existing empty Home/Table states keep manual creation and Builder-disabled continuity | C1/C2/C3 evidence, `tests/lenni-unified-ui.test.ts`, current live Builder-off route |
| Table work → direct edit → property/View query controls | Pass; live populated tables across Connections and proof Businesses; structural contracts remain green | C3 report, C8 proof Home/Table captures, direct-table/View/property suites |
| Connection → drawer → full Record → Form edit | Pass; live Owner drawer/full Record plus prior live Form evidence; shared Record/Form contracts remain green | `/private/tmp/lenni-c8-final-record-drawer-390x844.png`, `/private/tmp/lenni-c8-final-full-record-390x844.png`, C4 evidence and tests |
| Page edit → embedded exact View → Record operation → Open Table | Pass; prior live Page/editor evidence and Page renderer/editor contracts remain green | C5 evidence, `/private/tmp/lenni-c5-after-populated-page-1440x900.png`, Page suites |
| Tell Lenni proposal → Changes → Check/Preview/Apply | Pass; existing bounded Builder/Changes state machine and deliberate actions remain unchanged | C6/C7 evidence and configuration preview/history suites |
| Operational confirmation without configuration-history misrepresentation | Pass; applied/live, proposed, checked, preview and stale distinctions remain explicit | C6 evidence and configuration lifecycle suites |
| AI unavailable → manual operation and editing | Pass; live Connections Builder-off state points to the existing usable system; manual Home/Table routes remain available | `/private/tmp/lenni-c8-final-ai-disabled-manual-390x844.png`, C6/C7 disabled-state evidence and contracts |
| Staff operation without Owner controls | Pass; Bedford Staff Settings is read-only and Staff Home has no Tell Lenni, Setup or Changes | `/private/tmp/lenni-c8-final-staff-settings-390x844.png`, `/private/tmp/lenni-c8-final-staff-home-390x844.png`, server capability tests |
| Public preorder → valid submission → confirmation | Pass; live Bedford submission returned a confirmation reference, collection location/date/slot, order and total | `/private/tmp/lenni-c8-final-bedford-preorder-confirmed-390x844.png`, preorder integration suite |

## Cross-business acceptance

| Golden business | Existing fixture exercised | Result |
| --- | --- | --- |
| Recurring milk delivery | `Proof — Milk round` at `/app/proof-milk-round`; populated Home and Products Table at 1440×900 and 390×844 | Pass; Products, Standing Orders, Standing Order Lines and Customers retain the same generic workspace grammar; no horizontal overflow |
| Mobile dog grooming | `Proof — Mobile dog groomer` at `/app/proof-mobile-dog-groomer`; populated Home and Pets Table at 1440×900 and 390×844 | Pass; Customers, Pets, Appointments and Services retain the same Home/Table/connection grammar; no horizontal overflow |
| Trades / jobs | Existing `jobsDefinition`, `trades_jobs` acquisition scenario and generic acquisition/integration contracts | Source/integration pass; no persisted local golden Business route exists in the approved fixture map, so no fabricated browser route was created |
| Enquiry-led service | `Proof — Catering enquiry` at `/app/proof-catering-enquiry`; populated Home and Enquiries Table at 1440×900 and 390×844 | Pass; Contacts, Enquiries, Events and Quotes retain the same generic workspace grammar; no horizontal overflow |
| Bedford Bakery preorder | Existing `bedford-bakery-demo`; Owner/Staff internal routes and public `/p/bedford-bakery-demo/preorder` at 1440×900, 1024×768 and 390×844 | Pass; neutral public identity, collection flow, valid transaction and confirmation remain coherent; Staff controls remain server-authoritative |

The Connections demo (`lenni-connections-demo`) was also used as the principal
Owner/manual fixture for Home, Tables, Changes, Settings, Builder-off state,
Record drawer and full Record evidence.

## Role, AI and state results

- Owner: live Owner evidence covers the Connections demo and generated proof
  Businesses; Tell Lenni, Setup, Changes and Settings controls are present only
  where the existing capability projection grants them.
- Admin: the existing generated preview Admin fixture was used live at
  `/app/preview-foundation-configured-4708d6b9/locations`. Add/save location
  controls and Setup remained available; no membership write was performed.
- Staff: live Bedford Staff evidence shows Settings as read-only, no Add/Save/
  Deactivate location controls, and no Builder/Setup/Changes navigation.
- AI available: the existing Owner Tell Lenni route and C2 proposal flow remain
  available; C8 did not invoke a live provider or change prompts/models.
- AI unavailable: the Connections demo Builder explicitly states it is off and
  points back to the existing business system; manual Home/Table operation was
  verified.
- Empty and populated: C3 empty Orders evidence and C1/C2 empty-workspace
  contracts remain valid; C8 populated milk, dog, enquiry, Connections and
  Bedford states were exercised.
- Read-only and stale/currentness: Staff Settings, Page read-only rendering,
  Preview read-only behavior, stale save/history states and currentness checks
  remain covered by the existing focused and integration contracts.
- Loading/saving/error/unavailable: shared status, alert, live-region, preorder
  busy/error and Builder-unavailable presentations remain covered by the C1–C7
  contracts; no duplicate state abstraction was needed.

## Responsive and accessibility findings

- Target sizes exercised: 1440×900, 1024×768 and 390×844.
- New C8 route captures reported `document.body.scrollWidth` and
  `document.documentElement.scrollWidth` equal to the viewport at every tested
  size. Vertical scrolling remains intentional on long Settings, Changes and
  public-form content.
- Mobile Work and More were opened on the live Staff shell. Initial focus
  entered each sheet's close control; repeated Tab remained within the dialog;
  Shift+Tab wrapped to the final action; Escape closed the sheet; focus returned
  to the invoking control; body overflow was hidden while open and restored on
  close.
- Labels, role names, accessible action names, focus-visible foundations,
  reduced-motion handling and important status/live-region behavior remain
  provided by the existing C1 foundation and later scoped contracts.
- Browser diagnostics contained only expected React DevTools/HMR messages and
  no error-level console entries during the C8 journeys.
- No menu, sheet, drawer or sticky mobile action clipped content or introduced
  horizontal page overflow in the tested states.

## Screenshot index

### C8 baseline / final principal surfaces

- Before Owner Home: `/private/tmp/lenni-c8-before-owner-home-1440x900.png`
- Before cached Bedford Staff Settings: `/private/tmp/lenni-c8-before-bedford-settings-390x844.png`
- Connections Owner Home: `/private/tmp/lenni-c8-final-owner-home-1440x900.png`, `-1024x768.png`, `-390x844.png`
- Connections Owner Customers Table: `/private/tmp/lenni-c8-final-owner-table-1440x900.png`, `-1024x768.png`, `-390x844.png`
- Connections Owner Changes: `/private/tmp/lenni-c8-final-owner-changes-1440x900.png`, `-390x844.png`
- Connections Owner Settings: `/private/tmp/lenni-c8-final-owner-settings-1440x900.png`, `-390x844.png`
- Connections Record drawer/full Record: `/private/tmp/lenni-c8-final-record-drawer-390x844.png`, `/private/tmp/lenni-c8-final-full-record-390x844.png`
- AI-disabled/manual: `/private/tmp/lenni-c8-final-ai-disabled-manual-390x844.png`
- Bedford public preorder: `/private/tmp/lenni-c8-final-bedford-public-1440x900.png`, `-1024x768.png`, `-390x844.png`
- Bedford confirmed preorder: `/private/tmp/lenni-c8-final-bedford-preorder-confirmed-390x844.png`

### Cross-business and role captures

- Milk Home/Products: `/private/tmp/lenni-c8-final-milk-home-1440x900.png`, `-390x844.png`, `/private/tmp/lenni-c8-final-milk-table-1440x900.png`, `-390x844.png`
- Dog Home/Pets: `/private/tmp/lenni-c8-final-dog-home-1440x900.png`, `-390x844.png`, `/private/tmp/lenni-c8-final-dog-table-1440x900.png`, `-390x844.png`
- Enquiry Home/Enquiries: `/private/tmp/lenni-c8-final-enquiry-home-1440x900.png`, `-390x844.png`, `/private/tmp/lenni-c8-final-enquiry-table-1440x900.png`, `-390x844.png`
- Admin Settings: `/private/tmp/lenni-c8-final-admin-settings-1440x900.png`, `-1024x768.png`, `-390x844.png`
- Staff Settings/Home/Orders: `/private/tmp/lenni-c8-final-staff-settings-1440x900.png`, `-1024x768.png`, `-390x844.png`, `/private/tmp/lenni-c8-final-staff-home-390x844.png`, `/private/tmp/lenni-c8-final-staff-orders-390x844.png`

Earlier checkpoint screenshots remain the before/after evidence for acquisition,
proposal/signup, Pages, connected Records/Forms, Changes/History and empty
states; they are indexed in the C2–C7 checkpoint reports and were rechecked as
part of this acceptance review.

## Correctness, security and readiness

- No C8 product correction was required. The single bounded test-only change
  makes the existing set semantics explicit and leaves both resolver
  implementations unchanged.
- No schema, migration, dependency, capability, route, state framework,
  prompt, model, provider or transaction change was made.
- Existing server-authoritative membership/capability boundaries remain the
  source of truth; CSS or client visibility is not used to grant access.
- Existing preorder resolver, capacity/cutoff/pricing/idempotency and
  submission validation remain unchanged; the live valid submission confirmed
  the trusted transaction path.
- Final local verification included 14 focused files with
  85 tests passed, the full unit/contract suite with 77 files and 826 tests
  passed, Prettier, route type generation, TypeScript, ESLint, production
  build, schema lint and migration immutability. The focused configuration
  changes rerun passed 25/25 tests; the focused preview rerun passed 3 tests
  with 5 intentional skips after the bounded normalization. Two earlier full
  integration attempts each exposed one pre-existing local fixture/order
  sensitivity (256 passed, 5 skipped, one failed); exact-head CI is the clean
  repository gate. Exact-head CI run 31857182305 passed in 18m13s, including
  the clean full PostgreSQL integration suite, separate RLS suite, production
  dependency audit and all required static/build checks.

## Residual product-quality issues and MLP/v0 recommendation

- Trades/jobs remains source/integration-backed rather than a persisted local
  golden Business fixture. This is an evidence limitation, not a redesign gap;
  the generic acquisition composition and contracts cover the route pattern.
- Bedford has no seeded Admin membership. Admin presentation was verified on
  the existing generated preview fixture and capability tests.
- Authentication recovery is not implemented in the existing repository, so
  C7 correctly did not invent a non-functional recovery screen.
- The proof seed creates local-only named Businesses for this acceptance run;
  they are not application code or committed product data.

Recommendation: the redesigned product is ready for the owner-review handoff
and bounded MLP/v0 evaluation across the implemented product surface. Treat the
fixture limitations and existing recovery-scope debt as explicit follow-up
inputs; do not interpret them as authorization to add future capability during
this redesign.
