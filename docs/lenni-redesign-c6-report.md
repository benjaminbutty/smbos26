# Unified Lenni Product Experience Redesign v1 — C6 checkpoint

## Checkpoint record

- Checkpoint: C6 — Tell Lenni, Changes and History
- Branch: `redesign/c6-today-operational-dashboard`
- Feature implementation SHA: `0d39b79f3658e4971f7ca83b484fca8f290d3a84`
- PR, final exact-head SHA, merge SHA and CI run: recorded in the checkpoint
  ledger after publication
- Authority: Sections 8, 9 and 14 of the Unified Lenni Product Experience
  Redesign v1 execution prompt, the Design System and UX Constitution v2,
  the Stitch Reference Manifest, and the existing Builder/Changes action and
  currentness contracts

## Scope delivered

- Reused the existing Builder state machine, service actions and authorization
  boundaries. Existing unavailable, unsupported, clarification, proposed and
  operational-confirmation states now present a clear consequence and a
  manual path where one already exists.
- Made the Builder hierarchy explicit: clarification explains what Lenni
  understood; a proposal is visibly `Proposed`; an operational action is
  labelled as ready for deliberate confirmation; success remains separate
  from configuration planning.
- Reframed Changes and History around owner impact: visible labels distinguish
  `Proposed`, `Checked`, `Applied · Live`, currentness problems and closed
  proposals; detail pages lead with before/after/consequence language.
- Kept Check/Validate, Preview, Apply, Publish and forward-only rollback as
  the existing deliberate actions. Preview is explicitly read-only and not
  live; stale preview is an alert with a path back to affected work.
- Moved technical IDs, revisions and checksums behind native disclosure while
  retaining the underlying data for auditability.
- Added only scoped C6 presentation classes and focused UI contracts. No AI,
  provider, prompt, schema, dependency, state framework, route or capability
  change was introduced.

## Browser evidence

Evidence uses the real local Lenni Connections Demo Owner fixture and its
existing applied connection-acceptance change. No synthetic identity or
business data was introduced.

### Before

- Changes overview, 1440×900:
  `/private/tmp/lenni-c6-before-changes-1440x900.png`
- Changes overview, 1024×768:
  `/private/tmp/lenni-c6-before-changes-1024x768.png`
- Changes overview, 390×844:
  `/private/tmp/lenni-c6-before-changes-390x844.png`

### After — Owner/manual operation

- Changes overview, 1440×900:
  `/private/tmp/lenni-c6-after-changes-1440x900.png`
- Changes overview, 1024×768:
  `/private/tmp/lenni-c6-after-changes-1024x768.png`
- Changes overview, 390×844:
  `/private/tmp/lenni-c6-after-changes-390x844.png`
- Applied change detail, 1440×900 viewport/full-page evidence:
  `/private/tmp/lenni-c6-after-change-detail-1440x900-viewport.png` and
  `/private/tmp/lenni-c6-after-change-detail-1440x900.png`
- Builder-disabled continuity, 1440×900:
  `/private/tmp/lenni-c6-after-builder-ai-disabled-1440x900.png`

Observed acceptance points:

- The overview now tells an owner what is proposed, checked and live; the
  applied fixture is visibly `Applied · Live` and its technical details are
  disclosed rather than leading the page.
- The detail route exposes an owner-impact before/after panel, a deliberate
  next-action area, `Live as Version 2` consequence copy and technical details
  behind disclosure. The large applied diff remains the existing engine output
  rendered in the existing bounded detail route.
- The Builder-disabled fixture states that Builder is off while the existing
  business system continues to work. The existing manual workspace route and
  all returned AI-unavailable/manual states are covered by the focused UI and
  live integration contracts; the disabled Owner fixture was not enabled or
  mutated merely to manufacture an AI screenshot.
- At 1440×900, 1024×768 and 390×844, `document.body` and
  `document.documentElement` widths matched the viewport exactly. No page
  horizontal overflow was observed.
- The live fixture is Owner/manual. Admin uses the same existing
  `manage_configuration` capability projection; Staff restrictions remain
  server-authoritative and source/integration-tested. The local Staff identity
  has no seeded Business membership, so no synthetic Staff screenshot was
  created.

## Verification

- Focused C6 UI suites: 5 files, 39 tests passed.
- Full unit/contract suite: 77 files, 825 tests passed.
- Focused clean Supabase integration suites: 3 files, 15 tests passed, with 5
  intentional skips for unavailable optional setup paths.
- Next route type generation and non-incremental TypeScript passed.
- ESLint passed with zero warnings; Prettier check passed.
- Local Supabase schema lint passed with no schema errors.
- Production Next build passed with the documented CI-only
  `ACQUISITION_RATE_LIMIT_SECRET` fixture.
- The local image has no `npm` executable, so `npm audit` could not be run
  locally; exact-head GitHub CI includes the authoritative production audit
  step.

## Decisions, exclusions and carried debt

- Decision: reuse the existing Builder/Changes action and currentness seams;
  visible trust language is a presentation mapping over stored lifecycle
  states, not a second lifecycle or persistence model.
- Decision: `Checked` is the owner-facing label for the existing stored
  `validated` status, while `Applied · Live` is reserved for stored applied
  state. Rollback remains a new forward configuration change, with ordinary
  business records untouched.
- Excluded: prompt tuning, provider/model changes, new AI work, permanent
  chat, automatic validation/application/publication, operational rollback,
  new state or schema, capability changes and C7+ surface work.
- Carried debt: a live Admin/Staff browser screenshot requires seeded
  memberships that are not present in this local fixture set; C8 should repeat
  the cross-business role pass if those fixtures are available.
