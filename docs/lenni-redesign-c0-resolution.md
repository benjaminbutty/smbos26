# Lenni Unified Product Experience Redesign v1 — C0 Resolution

Date: 2026-08-14
Checkpoint: C0 — current-product UI inventory and before evidence
Working branch: `redesign/c1-foundation-shell`
Baseline: `main` and `origin/main` at `6ebdd8359f6ce1bca3df9d0a728f3dfc18b2e6c6`

## Resolution

C0 is resolved. The current product can be exercised against the local Supabase
fixtures and the existing routes are functional. No C0 stop condition was
triggered, so this run proceeds into C1 only: design foundation, authenticated
workspace shell, navigation hierarchy, and responsive/accessibility behavior.

C2 public acquisition/authentication redesign, C3 operational surfaces, and all
later checkpoints remain out of scope for this run.

## Evidence and environment

- Public acquisition: `http://localhost:3000/start`, using the existing
  proposal session.
- Owner fixture: `Lenni Connections Demo`, observed at
  `/app/lenni-connections-demo` and
  `/app/lenni-connections-demo/workspace/phase2-customers`.
- Staff fixture: `Bedford Bakery`, observed at `/app/bedford-bakery-demo`.
  Owner-only `Tell Lenni`, `Changes`, and `Setup` controls were absent from the
  Staff navigation; `Settings` remained available.
- Local Supabase was already running on repository ports 55321/55322. Docker
  server version was 29.7.2. The bundled workspace Node runtime is v24.19.0;
  `node` and `npm` are not on the shell PATH, so verification commands must use
  the bundled runtime path.
- Before screenshots, captured at exact requested viewport sizes:
  - `/private/tmp/lenni-c0-start-1440x900.png`
  - `/private/tmp/lenni-c0-start-390x844.png`
  - `/private/tmp/lenni-c0-home-1440x900.png`
  - `/private/tmp/lenni-c0-home-390x844.png`
  - `/private/tmp/lenni-c0-table-1440x900.png`
  - `/private/tmp/lenni-c0-table-390x844.png`
  - `/private/tmp/lenni-c0-staff-home-1440x900.png`
  - `/private/tmp/lenni-c0-table-1024x768.png` (added in the C0 correction
    pass from the archived pre-C1 parent revision)

The live evidence shows the current authenticated shell is usable on desktop,
but the mobile breakpoint exposes the desktop sidebar as a horizontal block
above the content. The current shell also presents Tables, Pages, and direct
non-table Views as separate top-level sections rather than the required Home /
Work hierarchy. The public route is operational but retains the existing SMBOS
brand and acquisition presentation, which is intentionally deferred to C2.

## C0 correction: role, availability and state matrix

The matrix below records the evidence that is live-observed, source-backed, or
not present in the current local seed. No fabricated records or screenshot-only
mock data were added.

| Contract surface/state | Owner | Admin | Staff | AI available / unavailable and manual fallback | Evidence and fixture boundary |
| --- | --- | --- | --- | --- | --- |
| Home shell and populated Tables | Visible | Visible | Visible | Manual Table/Page routes remain available | Live Owner `lenni-connections-demo`; live Staff `bedford-bakery-demo`; server `layout.tsx` navigation data |
| Empty Business starting point | Visible | Visible | Visible | `WorkspaceHome` keeps Tell Lenni and Create manually side by side for configuration-capable roles | `tests/lenni-unified-ui.test.ts`; empty `destinations: []` fixture; no fake live Business created |
| Tell Lenni / Builder | Visible when `manage_configuration` is granted | Visible when `manage_configuration` is granted | Not rendered | Available route is proposal-only; disabled/unavailable Builder states fail closed and manual Home actions remain usable | `hasCapability()` in `src/auth/capabilities.ts`, server-derived `layout.tsx`, `src/components/builder-ui-state.ts`; Admin is covered by authorization tests but is not seeded locally |
| Changes and Setup | Visible when `manage_configuration` is granted | Visible when `manage_configuration` is granted | Not rendered | Manual configuration remains behind the same server capability check | Live Owner/Staff navigation; `layout.tsx`; `tests/authorization.test.ts` |
| Saved Views and non-table Views | Inside their Table; non-table Views are Work destinations | Same | Same | No AI dependency | `TableViewTabs`, `experience.listNavigation()`, `layout.tsx`; `tests/lenni-unified-ui.test.ts` |
| Loading / saving | Shared status presentation | Shared status presentation | Shared status presentation | Manual operation remains usable while actions are pending | `PendingSubmitButton`, editor save states, `page-editor-save-*`; existing `role="status"` regions |
| Error / alert | Shared alert presentation | Shared alert presentation | Shared alert presentation | AI errors and action errors are surfaced without changing live configuration | `Notice`, `notice-error`, `history-notice-*`, `role="alert"` paths in Builder, editor and inline-table components |
| Stale | Shared stale presentation | Shared stale presentation | Read-only/operational paths do not gain configuration authority | Manual retry/edit boundary remains explicit | `page-editor-save-stale`, `configuration-history-ui.tsx`, `direct-actions.ts` stale result |
| Read-only | Page-embedded Views and preview surfaces are read-only where declared | Same | Staff cannot see configuration controls; operational routes retain their existing edit rules | No new route or permission is introduced | `page-editor-view-readonly`, `runtime/editor-kernel` read-only contracts |
| Unavailable | Builder/runtime unavailable states are explicit | Same | Owner-only Builder is unavailable by visibility | Home manual route remains the fallback | `runtime-unavailable`, `page-editor-unavailable-view`, `builder-ui-state.ts`; unavailable state is source/test-backed, not seeded as a live failure |

Admin therefore has a complete contract entry and automated capability evidence,
but no local demo membership was invented solely for screenshots. AI-disabled,
stale, read-only and unavailable states are likewise recorded from the existing
runtime fixtures and state contracts where a live failure fixture is not
present.

## C0 correction: five golden Business fixture map

These are the existing Businesses and generic product flows that later
checkpoints can exercise. The three proof Businesses deliberately receive
generated immutable slugs from `create_business`; the proof runner prints those
slugs when it persists them, so the route pattern is recorded rather than
inventing a fixed slug.

| Golden Business | Existing fixture/seed | Authenticated route(s) later checkpoints use | Populated flow |
| --- | --- | --- | --- |
| Recurring milk delivery | Existing local Business `milkwomanfran`; the generic proof analogue is `internalWorkspaceProofFixtures` entry `Milk round` | `/app/milkwomanfran`, `/app/milkwomanfran/workspace/milk-product-table`, `/app/milkwomanfran/pages/overview` | Live Milk products, Delivery runs, Weekly orders, Order items and Customers; proof fixture also covers saved filters, sort/group and Connections |
| Mobile dog grooming | `tests/support/internal-workspace-proof-fixtures.ts` entry `Dog groomer`; created by `tests/integration/internal-workspace-engine.test.ts` and `workspace:proof:seed` | `/app/<generated-proof-slug>/workspace/<table-view-key>` | Customers, Pets, Appointments and Services; connected Pet/Customer/Service records and saved Views |
| Trades / jobs | `src/core/acquisition/composer.ts` `jobsDefinition`; `src/ai/evaluation/acquisition/scenarios.ts` `trades_jobs`; integration coverage in `tests/integration/acquisition.test.ts` | No persisted golden Business route in the current local seed; generated work uses the existing `/app/<businessSlug>/workspace/<view-key>` route | Customers, Jobs, Quotes and Tasks through the existing generic acquisition composition; explicitly source/integration-backed, not fabricated as live evidence |
| Enquiry-led service | `tests/support/internal-workspace-proof-fixtures.ts` entry `Catering Enquiry`; the same generic path is covered by configuration/experience integration fixtures | `/app/<generated-proof-slug>/workspace/<table-view-key>` after `workspace:proof:seed` | Contacts, Enquiries, Events and Quotes; status fields, Connections and saved Views |
| Bedford Bakery preorder | `scripts/demo-seed.mjs`; `bedford-bakery-demo` | `/app/bedford-bakery-demo`, `/app/bedford-bakery-demo/workspace/orders`, `/p/bedford-bakery-demo/preorder` | Bakery Products, Customers, Orders and Order Items over the configured generic Table/record path; Owner and Staff local identities |

`lenni-connections-demo` remains a useful auxiliary populated acceptance
fixture for the C1 shell (`/app/lenni-connections-demo` and
`/workspace/phase2-customers`), but it is not substituted for one of the five
golden Business categories above. The proof fixture route is generic by design:
no scenario-specific production module, migration or static mock route is
required. The existing integration runner exercises the same Table, View,
Connection, Record and Page paths that later checkpoints will use.

## Route and surface inventory

| Surface | Current route/source | Current responsibility | C1 treatment |
| --- | --- | --- | --- |
| Public Lenni start | `src/app/start/page.tsx`, `src/app/start/actions.ts` | Pre-account proposal review and regenerate flow | Preserve behavior; visual redesign deferred to C2 |
| Sign in/sign up | `src/app/sign-in/page.tsx`, `src/app/sign-up/page.tsx` | Existing authentication entry points | Preserve behavior; visual redesign deferred to C2 |
| Tenant shell | `src/app/app/[businessSlug]/layout.tsx` | Tenant resolution, role capability check, business switcher, navigation, utilities, sign-out | C1 shell/IA presentation and responsive behavior |
| Home | `src/app/app/[businessSlug]/page.tsx`, `src/components/workspace-home.tsx` | Empty-workspace starting routes and populated destination orientation | Keep destination behavior; align shell hierarchy and responsive layout |
| Table workspace | `src/app/app/[businessSlug]/workspace/[screenSlug]/page.tsx`, `src/runtime/editor-kernel/*`, `src/runtime/views/*` | Generic direct Table editor, saved Views, records, structural controls | Preserve engine/actions; shell and shared presentation only |
| Page workspace | `src/app/app/[businessSlug]/pages/[pageSlug]/page.tsx`, `src/runtime/page-editor/*` | Generic Page renderer/editor | Preserve route and editor; expose through Work without duplicate navigation |
| Builder | `src/app/app/[businessSlug]/builder/*`, `src/ai/builder/*` | Proposal-only Lenni planning flow | Preserve and expose via role-aware Tell Lenni utility |
| Changes/setup/settings | `src/app/app/[businessSlug]/changes/*`, `setup/*`, `locations/*` | Configuration history, setup, and operational settings | Keep routes/permissions; consolidate presentation under Settings/utility affordances |
| Public business pages/preorder | `src/app/p/[businessSlug]/[pageSlug]/page.tsx`, `src/app/preorder/*` | Public-facing Page and preorder proof | Deferred to C7; no C1 changes |

## Ownership and dependency map

- `src/app/app/[businessSlug]/layout.tsx` owns the server-side shell tree,
  tenant/membership capability decision, Table/Page data passed to navigation,
  and utility visibility. Non-table Views are passed as Work destinations;
  there is no separate top-level Views section.
- `src/components/workspace-topbar.tsx` owns route-context labeling, the
  Owner/Admin Tell Lenni link, and the account/business link. It is the correct
  client boundary for mobile top-bar state, but must not own data or actions.
- `src/runtime/navigation/tables-sidebar.tsx` and
  `src/runtime/navigation/pages-sidebar.tsx` own the existing generic create
  affordances and links. Their action contracts, currentness checks, and route
  targets are preserved; C1 may wrap/relabel them inside Work.
- `src/components/workspace-nav-link.tsx` owns active-link semantics for shell
  links and remains the shared navigation primitive.
- `src/app/globals.css` contains the existing product tokens and the active
  Lenni presentation section, but also older workspace rules and duplicate
  selector layers. C1 will make the Lenni token layer canonical for the shell
  and add scoped responsive/focus/sheet rules without changing runtime styles
  outside the agreed boundary.
- `src/components/workspace-home.tsx` and the direct editor/page renderers own
  route content. They are downstream consumers of the shell and are not being
  reimplemented as part of C1.

## Target shell anatomy for C1

Desktop/laptop:

1. Persistent sidebar: Lenni brand, Business switcher, Home, one Work group,
   Table destinations, Page destinations, then Tell Lenni/Changes/Settings and
   account utility treatment.
2. Main region: route context top bar followed by the existing route content.
3. Tables and Pages appear once each under Work. Saved Views remain inside the
   active Table surface; no new top-level Views section is introduced.

Mobile:

1. Compact top bar: brand, business/account affordance, and current context.
2. Route content uses the full viewport width with no desktop sidebar block.
3. Fixed bottom navigation exposes Home, Work, Tell Lenni where permitted, and
   More. Work and More open accessible full-screen sheets with clear close,
   Escape, focus return, and focus-visible behavior.

Role behavior remains capability-driven: Staff does not receive configuration
or Builder controls; Owner/Admin controls stay visible only when the existing
`manage_configuration` capability allows them. AI-disabled work remains fully
usable through existing manual routes.

## Reference-to-real capability mapping

- References 01–02: acquisition orientation and responsive intent only; the
  existing public route is retained for C2 because C1 is authenticated-shell
  scope.
- References 03–05: planning/proposal review intent; no C1 route redesign.
- References 06–07: signup/business setup intent; no C1 route redesign.
- References 08–11: authenticated workspace shell, Home/Today orientation,
  and manual workspace intent. C1 adopts hierarchy, spacing, neutral canvas,
  Coral actions, and responsive shell behavior while preserving actual routes.
- Reference 12: record-detail information hierarchy only; unsupported Print,
  Archive, AI insight, payment, timeline, notes, and other invented controls
  are omitted.
- References 13–15: Home/Table hierarchy, compact shell, populated-table
  density, and responsive composition. C1 uses them as visual direction only;
  no generated Stitch/Tailwind code is imported.

Unsupported or deferred controls are deliberately not added: payment flows,
online booking, automated reminders, print/archive, analytics/totals, AI
insights, public publishing changes, and new domain-specific objects or fake
records.

## C1 foundation reconciliation

The C1 review found one remaining foundation discrepancy: the canonical root
token source was incomplete and several compatibility aliases still defined
parallel values. `src/app/globals.css` now matches the approved constitution
for Coral 50–900, warm surfaces/borders including `border-strong` and
`surface-dark`, spacing through `space-16`, the approved radius scale with
`radius-full`, and explicit text/surface pairs for every approved trust state:
Suggestion, Proposed, Checked, Preview, Live-Applied, Published,
Warning-needs-review, Destructive-error and Read-only. Legacy semantic,
radius, surface and action aliases now reference those canonical tokens. No
new component or design-system abstraction was added.

| Section 9 requirement | Reused current evidence | Correction result |
| --- | --- | --- |
| Canonical tokens | `:root` in `src/app/globals.css` | Reconciled the approved Coral 50–900, neutral, border, spacing, radius, elevation and trust-state families; compatibility aliases reference canonical values |
| Buttons | Global `button`/`.button`, `.button-secondary`, `.button-danger`, `.button-small`, `.button-link`; shell-specific existing action classes | Reused; no duplicate button primitive |
| Fields / textareas | Global `input`, `select`, `textarea`, focus rules, `.form-field`, `.field-help`, `.checkbox-control` | Reused; no duplicate field abstraction |
| Selects / pickers | Existing editor choice/date/Connection pickers and `.lenni-type-picker` / `.lenni-picker-options` | Reused; no route-specific picker styling added |
| Status chips and states | `.status`, `.status-muted`, `.editor-status-pill`, change status presentation | Reused; explicit trust text/surface pairs stay distinct from Coral, with legacy semantic aliases pointing to the relevant trust state |
| Cards / panels | `.panel`, `.runtime-card`, `.workspace-home-card`, route/editor panels and mobile sheet | Reused; C1 shell consumes tokenized radius/elevation values |
| Notices / alerts | `Notice`, `.notice-error`, `.notice-message`, `.history-notice-warning`, `.history-notice-success`, runtime preview warning | Reused; no duplicate notice component |
| Loading / saving / error / stale / read-only / unavailable | `PendingSubmitButton`, editor save states, `page-editor-save-*`, `page-editor-view-readonly`, `runtime-unavailable`, `page-editor-unavailable-view` | Reused and documented; no missing presentation component remained |
| Reduced motion | Existing `@media (prefers-reduced-motion: reduce)` rules in the current CSS, including the shell layer | Reused; no animation library or dependency added |
| Async live regions | Existing `role="status"`, `role="alert"` and `aria-live="polite"` in submit, Builder, editor, page-editor and inline-table paths | Reused; important asynchronous state already announces through current components |

The C1 product boundary remains `layout.tsx`, `workspace-topbar.tsx`,
`workspace-mobile-nav.tsx`, `globals.css` and focused tests. Runtime actions,
authorization, data shape, route resolution, AI policy and later-checkpoint
surfaces remain untouched.

## C1 exact file boundary and risk register

Expected product files:

- `src/app/app/[businessSlug]/layout.tsx`
- `src/components/workspace-topbar.tsx`
- `src/components/workspace-mobile-nav.tsx` (new, if needed for the mobile
  bottom bar/sheets)
- `src/runtime/navigation/tables-sidebar.tsx` and/or
  `src/runtime/navigation/pages-sidebar.tsx` only where required to preserve
  the existing action contracts inside Work
- `src/app/globals.css`
- focused UI/navigation tests under `tests/`

The C1 boundary explicitly excludes database migrations, schema/configuration
types, runtime/editor actions, auth/authorization logic, route shape changes,
new generic primitives, new dependencies, font binaries, fake data, and
framework/build changes. No hidden schema, runtime, or state change is
required by the C1 plan.

Risks to verify before handoff:

- Existing CSS has legacy and Lenni selector layers; accidental selector
  precedence changes could affect editor surfaces.
- Mobile sheets must remain keyboard-accessible and return focus to their
  trigger without introducing global navigation state or persistence.
- The sidebar create actions are live configuration/operational boundaries;
  presentation changes must not alter their server action payloads or
  `currentness` checks.
- Staff/Owner capability visibility must remain server-derived and must not be
  inferred from client pathname state.
- Existing Table/Page destinations must remain generic and must not be
  duplicated by a new Work index.

## Focused mobile-shell acceptance

The mobile contract is covered by the focused source contract test and live
local-browser evidence. Work and More are `button` controls with dialog
semantics; opening schedules focus onto the sheet close control; the document
keydown handler wraps forward and reverse Tab; Escape closes; the cleanup effect
restores body overflow; and the closed-sheet effect returns focus to the
invoking trigger. The server layout passes only the capability-derived
`canManageConfiguration` boolean, so Staff does not receive Tell Lenni,
Changes or Setup in the client tree.

At 390 × 844, the final browser checks also record equal body/document widths
and a fixed bottom nav rather than a horizontally exposed desktop sidebar.

## C1 after-evidence index

The token correction materially changes the approved radius values used by
the shell, so the principal evidence was recaptured at the exact feature
dimensions. It covers 1440 × 900, 1024 × 768 and 390 × 844, with the
populated Owner shell, Staff shell and mobile Work/More sheets.

### Captured evidence

All files below were captured from the running repository app at the exact
dimensions named in the prompt. Owner evidence uses the populated `lenni-connections-demo`
fixture; Staff evidence uses the populated `bedford-bakery-demo` fixture.

| Role / surface | 1440 × 900 | 1024 × 768 | 390 × 844 |
| --- | --- | --- | --- |
| Owner Home | `/private/tmp/lenni-c1-token-owner-home-1440x900.png` | `/private/tmp/lenni-c1-token-owner-home-1024x768.png` | `/private/tmp/lenni-c1-token-owner-home-390x844.png` |
| Owner populated Table | `/private/tmp/lenni-c1-token-owner-table-1440x900.png` | `/private/tmp/lenni-c1-token-owner-table-1024x768.png` | — |
| Owner Work / More sheets | — | — | `/private/tmp/lenni-c1-token-owner-work-sheet-390x844.png`, `/private/tmp/lenni-c1-token-owner-more-sheet-390x844.png` |
| Staff Home | `/private/tmp/lenni-c1-token-staff-home-1440x900.png` | `/private/tmp/lenni-c1-token-staff-home-1024x768.png` | `/private/tmp/lenni-c1-token-staff-home-390x844.png` |
| Staff Work / More sheets | — | — | `/private/tmp/lenni-c1-token-staff-work-sheet-390x844.png`, `/private/tmp/lenni-c1-token-staff-more-sheet-390x844.png` |

The browser checks recorded `body.scrollWidth === document.documentElement.scrollWidth`
at 390 × 844 for Owner and Staff (`390 === 390`), fixed bottom navigation,
`overflow: hidden` while a sheet is open, initial focus on the close control,
Escape close with focus returned to the invoking Work/More button, and Work/More
dialog labels. The sheet boundary checks also confirmed forward wrap from the
last link to Close and reverse wrap from Close to the last link. The browser
automation's native first-link Tab movement was not used as a substitute for
the source contract; the interaction guard remains enforced by the document
keydown handler and is covered by `tests/lenni-unified-ui.test.ts`.

Admin is not claimed as a live screenshot because the local seeded identities
are Owner and Staff only. The Admin row is verified through the same
server-side `manage_configuration` capability path and
`tests/authorization.test.ts`; no Admin membership was created for evidence.
The Owner Home captures show the AI-assisted and manual start choices, while
the AI-unavailable/manual fallback is source- and policy-test-backed as
documented in the state matrix.

## Checkpoint boundary

This correction closes the remaining foundation-only C1 token discrepancy and
updates the bounded C1 evidence. Stop here for review of draft PR #41; do not
start C2 in the same run.
