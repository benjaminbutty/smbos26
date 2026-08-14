# Unified Lenni Product Experience Redesign v1 — C7 checkpoint

## Checkpoint record

- Checkpoint: C7 — Settings, entry and public preorder
- Branch: `redesign/c7-settings-entry-public`
- Feature implementation SHA: `1faa5d156a9bc6e909303853591202c713818004`
- PR, final exact-head SHA, merge SHA and CI run: recorded in the checkpoint
  ledger after publication
- Authority: Sections 8, 9 and 15 of the Unified Lenni Product Experience
  Redesign v1 execution prompt, the Programme Brief, Design System and UX
  Constitution v2, the Stitch Reference Manifest, and the existing
  authentication, Location, configuration and preorder contracts

## Scope delivered

- Reframed the existing Settings / Locations route as the bounded Settings
  surface. It now presents Business context, Locations and Team & permissions
  without inventing a member-management route or write action.
- Reused the existing `hasCapability` projection and Location Server Actions.
  Owner/Admin retain the existing manage-location controls; Staff sees the
  same route as an explicit read-only surface. Membership role counts are read
  only and no member identifiers are exposed.
- Reused the existing timezone selection model through a shared human-readable
  IANA timezone option module. Existing acquisition timezone presentation now
  consumes that same module; no competing timezone values were introduced.
- Added Settings context navigation to the existing bounded setup page. The
  existing proposal, Validate, Apply and publication actions remain unchanged;
  live customer configuration is still protected by the existing currentness
  and capability boundaries.
- Applied the same restrained presentation to the existing sign-in and
  sign-up screens. Their Server Actions, return-to handling and validation are
  unchanged.
- Added a neutral public experience header with merchant identity and subtle
  `Powered by Lenni` provenance. Public preorder uses the existing resolver,
  catalogue, form fields, capacity/cutoff checks, idempotency token and API
  transaction; the update is presentation and accessibility-only.
- Added live-region/busy/error framing to the existing preorder form and
  confirmation state. Preview remains explicitly submission-disabled and
  read-only.
- Added scoped C7 presentation using the canonical C1 token source for Settings,
  account entry and public preorder. The existing reduced-motion foundation is
  reused; no route-wide styling migration was attempted.

## Browser evidence

Evidence uses the real local fixtures. No synthetic business or transaction was
created during browser review, and the public journey was not submitted.

### Before — existing C7 routes

- Settings / Locations, 1440×900:
  `/private/tmp/lenni-c7-before-settings-1440x900.png`
- Setup, 1440×900:
  `/private/tmp/lenni-c7-before-setup-1440x900.png`
- Bedford Bakery public preorder, 1440×900:
  `/private/tmp/lenni-c7-before-public-preorder-1440x900.png`
- Sign in and sign up, 1440×900:
  `/private/tmp/lenni-c7-before-sign-in-1440x900.png` and
  `/private/tmp/lenni-c7-before-sign-up-1440x900.png`

### After — Owner and public journey

- Settings / Locations:
  `/private/tmp/lenni-c7-after-settings-1440x900.png`,
  `/private/tmp/lenni-c7-after-settings-1024x768.png`,
  `/private/tmp/lenni-c7-after-settings-390x844.png`
- Setup:
  `/private/tmp/lenni-c7-after-setup-1440x900.png`,
  `/private/tmp/lenni-c7-after-setup-1024x768.png`,
  `/private/tmp/lenni-c7-after-setup-390x844.png`
- Bedford Bakery public preorder:
  `/private/tmp/lenni-c7-after-public-preorder-1440x900.png`,
  `/private/tmp/lenni-c7-after-public-preorder-1024x768.png`,
  `/private/tmp/lenni-c7-after-public-preorder-390x844.png`
- Sign in:
  `/private/tmp/lenni-c7-after-sign-in-1440x900.png`,
  `/private/tmp/lenni-c7-after-sign-in-1024x768.png`,
  `/private/tmp/lenni-c7-after-sign-in-390x844.png`
- Sign up:
  `/private/tmp/lenni-c7-after-sign-up-1440x900.png` and
  `/private/tmp/lenni-c7-after-sign-up-390x844.png`

### Role and responsive observations

- Owner: live `Lenni Connections Demo` Settings and Setup routes at all target
  sizes; the existing Owner controls remain present.
- Staff: live `Bedford Bakery` Settings at 390×844:
  `/private/tmp/lenni-c7-after-staff-settings-390x844.png`. The route shows
  Staff, hides Add / Save / Deactivate, and hides Setup and Changes. This is
  server-authoritative, not CSS-only hiding.
- Admin: the role presentation and capability projection are covered by the
  source contract and authorization tests; no local Admin membership is seeded,
  so no fabricated Admin browser session was created.
- Settings, Setup, public preorder and account-entry routes reported equal body
  and document widths to the viewport at 1440×900, 1024×768 and 390×844. No
  accidental horizontal page overflow was observed.
- Mobile Work and More sheets opened from the real 390×844 shell. Initial focus
  entered each sheet’s close control; Shift+Tab wrapped to the final action;
  Escape closed the sheet; focus returned to the invoking control; body
  overflow was hidden while open and restored after close.

## Verification

- Focused C7/UI and preserved preorder/auth/authorization contracts: 5 files,
  39 tests passed.
- Full unit/contract suite: 77 files, 826 tests passed.
- Configured Supabase integration suite: 25 files, 257 tests passed, 5
  intentional skips. The expected local no-provider confirmation-email warning
  was observed while the authoritative order path remained green.
- Next route type generation and non-incremental TypeScript passed.
- ESLint passed with zero warnings; Prettier check passed.
- Local Supabase schema lint passed with no schema errors.
- Historical migration immutability check passed for all 32 migrations.
- Production Next build passed with the documented non-production local
  `ACQUISITION_RATE_LIMIT_SECRET` verification value. Exact-head GitHub CI is
  the final publication gate.

## Decisions, exclusions and carried debt

- Decision: use one shared human-readable timezone option source for acquisition
  and Settings rather than duplicate lists.
- Decision: present role boundaries and counts without exposing membership
  identifiers or adding an unapproved membership-management UI.
- Decision: keep authentication limited to the existing sign-in/sign-up
  Server Actions. The repository has no recovery route or recovery action, so
  C7 does not invent a non-functional password-reset capability.
- Excluded: merchant theming, logo/colour settings, custom CSS, public website
  builder, payments, preorder feature work, richer Location/timezone capability,
  transaction/runtime changes, new capabilities, new state or route redesign.
- Carried debt: a live Admin browser fixture and an existing recovery flow are
  not present in the repository fixture/capability set; C8 should recheck role
  and auth coverage if those fixtures become available. Before captures were
  available for the principal routes at 1440×900; after captures cover all
  three target sizes.
