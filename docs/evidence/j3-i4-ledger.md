# J3-I4 Sites and deliberate publication evidence

Date: 22 August 2026
Branch: `codex/j3-i4-sites-publication`
Base: `52cf7c677c4b2aa5744fb78a7a803c1d960e6164`

## Owner journey

Fixture: Bedford Bakery (`bedford-bakery-demo`), existing published preorder
Page at `/p/bedford-bakery-demo/preorder`.

The Owner opened `/app/bedford-bakery-demo/sites/preorder?mode=edit`, changed
the Site title and Heading, switched the candidate preview between Desktop and
Mobile, and published once. Before publication, the authenticated canvas showed
the candidate title `Weekend preorder` and Heading `Fresh weekend boxes`, while
the separately loaded public URL still showed `Preorder for collection` and `A
little celebration, boxed and ready`.

The public Page changed only after the single `Publish changes` press. It then
showed `Weekend preorder` and `Fresh weekend boxes`; the existing preorder
capability remained present and operationally rendered. Fresh browser tabs after
the hydration repair reported no console warnings or runtime errors.

## Configuration evidence

Read-only counts for Bedford Bakery:

| State | Versions | Changes | Head revision |
| --- | ---: | ---: | ---: |
| Published baseline | 2 | 1 | 2 |
| After local title/content edits and preview | 2 | 1 | 2 |
| After one `Publish changes` action | 3 | 2 | 3 |

The candidate therefore created no configuration mutation. The final action
created exactly one applied Change, one immutable Version and one head-revision
advance. Focused integration coverage also proves that ordinary direct
rename/layout actions cannot bypass publication and that a malicious candidate
cannot remove or reconfigure a locked capability block.

## Roles and responsive presentation

- Owner: complete in-context editor, Desktop/Mobile candidate preview, Discard
  changes and Publish changes.
- Staff: published reading surface only; zero Edit Site or Publish changes
  controls even when `?mode=edit` is supplied.
- 1440×900: full Owner canvas and publication surface checked.
- 1024×768: Staff reading surface and unchanged public result checked.
- 390×844: exact-width iframe browsing context checked; inner document reported
  `clientWidth = 390`, `scrollWidth = 390`, mobile workspace navigation, mobile
  preview and touch-sized publication actions. No horizontal overflow.

The first browser pass exposed non-deterministic local IDs for historical Page
blocks, which caused a React hydration warning. The implementation was repaired
to allocate deterministic bounded placeholder UUIDs for legacy candidate blocks.
A fresh 390×844 run then produced no warnings or errors.

## Durable screenshots

- `j3-i4-owner-published-clean-1440x900.png`
- `j3-i4-owner-unpublished-candidate-390x844.png`
- `j3-i4-public-unchanged-before-publish.png`
- `j3-i4-public-after-one-publish-390x844.png`
- `j3-i4-staff-reading-1024x768.png`

The responsive proof harness was temporary and is not part of the product or
repository result.

## Automated verification

- `npm run check` — 90 files, 964 tests passed.
- `npm run build` — production build passed.
- `npm run check:migration-immutability` — 42 historical migrations unchanged.
- `npm run supabase:reset` — clean replay through
  `20260822223000_journey_3_published_site_changes.sql` passed.
- `npm run supabase:lint` — no schema errors.
- focused Direct Page, public capability, initial preorder and Experience
  integration suites — 32/32 passed.
- focused RLS suite — 19/19 passed.
- Direct Page unit suite after hydration repair — 17/17 passed.

## Exclusions confirmed

No persistent Site draft, second Page, new primitive, second renderer, public
runtime, Button editor, capability configuration, hide/show system, branding,
media, SEO, navigation builder, AI work or J3-I5 feature work was introduced.
