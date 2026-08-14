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

The live evidence shows the current authenticated shell is usable on desktop,
but the mobile breakpoint exposes the desktop sidebar as a horizontal block
above the content. The current shell also presents Tables, Pages, and direct
non-table Views as separate top-level sections rather than the required Home /
Work hierarchy. The public route is operational but retains the existing SMBOS
brand and acquisition presentation, which is intentionally deferred to C2.

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
  and utility visibility. It currently renders a separate direct `Views`
  section for non-table views.
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
framework/build changes. No hidden schema, primitive, runtime, or state change
is required by the C1 plan.

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

## Next checkpoint

Proceed with C1 foundation, shell, navigation, and responsive/accessibility
implementation on this branch. Stop after focused verification and a bounded
draft PR/report. Do not start C2 in the same run.
