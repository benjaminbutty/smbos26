# Owner review — Tables and internal Pages interaction quality reset

Date: 2026-08-24

Review branch: `codex/interaction-quality-reset-tables-pages`

Baseline: `cda5e921180cc2895133088e57dfb4e193675747`

## What changed

Internal Pages are now one bounded Tiptap canvas with natural rich text,
slash/gutter insertion, exact Saved View NodeViews, local history, Reading
mode and one explicit Page commit. The renderer and editor share the same
Lenni-owned, schema-validated Page grammar; raw Tiptap JSON and HTML are not
authoritative. Public Sites remain on the established Site path.

Tables now use a calmer grid-first desktop surface and a record-first mobile
surface. Choice and Connection editors are searchable, Property creation has
a real live preview and deterministic placement, Saved View creation previews
the real grid, failures provide Retry/Cancel, and focus is restored after
record/property/view flows.

The trusted backend was retained: existing primitives, RLS, tenant isolation,
allow-listed direct actions, currentness, immutable configuration history and
the operational/configuration separation remain in place.

## Review seams

- Architecture resolution: [ADR-046](ADR-046.md)
- Implementation boundary and defect ledger:
  [interaction quality reset](interaction-quality-reset-tables-pages.md)
- Durable browser evidence:
  [role/viewport matrix](evidence/interaction-quality-reset/README.md)
- Database change:
  `supabase/migrations/20260824120000_interaction_quality_page_rich_text.sql`

## Owner judgement prompts

Please judge the branch on the actual tasks, not isolated components:

1. Does `Customers` feel like one direct working surface from cell edit,
   Property creation and Saved View creation through Record return?
2. Does `This week` feel like a continuous document while its exact embedded
   Saved View remains operational?
3. At 390px, is the working-property record surface a credible mobile
   continuation rather than a compressed desktop grid?
4. Is Staff clearly operational without being offered structural controls?
5. Do the 1024px layouts preserve calm document framing while confining wide
   Table content to its own scroll surface?

## Local owner review route

Generate a fresh four-business proof workspace and synthetic role accounts:

```sh
npm run workspace:proof:seed
```

The command prints a JSON object containing `ownerEmail`, `adminEmail`,
`staffEmail`, the shared synthetic password, and the generated businesses.
For the current proof seed, use these production routes after signing in:

- `/app/proof-mobile-dog-groomer/workspace/customers`
- `/app/proof-mobile-dog-groomer/pages/this-week`

Re-running the command intentionally creates fresh account identifiers; use
the values printed by that exact run rather than copying an earlier email.

## Deliberate exclusions

- no public Site editor reset;
- no persistent Page draft store or collaborative cursors;
- no arbitrary HTML, code, SQL or generic HTTP execution;
- no new business primitive or customer-specific condition;
- no queue, cache, microservice or unrelated infrastructure;
- no merge as part of this delivery.

## Verification

The exact verification commands and exact-head CI result are recorded in the
pull request. Local verification includes the full unit/check pipeline (90
files, 970 tests), the production build, clean Supabase reset and lint, RLS
integration (19 tests), focused Page/Table/internal-workspace integration (21
tests), Experience integration (21 tests), migration immutability, and the
browser matrix above.
