# Lenni Journey 3 — closeout report

Date: 23 August 2026

## Status

Journey 3 implementation checkpoints J3-I1 through J3-I4 are merged to
`main`, and every exact-head and post-merge CI run is green. J3-I5 is the
documentation and acceptance checkpoint on
`codex/j3-i5-closeout`, based on
`d3765780052aa484841d4f9d7cd40cd99cd51c0a`. It adds no feature or migration.
Its final PR head, exact-head CI, merge commit and post-merge CI are recorded in
the checkpoint handoff because a commit cannot contain its own resulting merge
identity.

The owner-visible Journey 3 promise is fulfilled:

> I can change how my workspace is organised by interacting with the Table,
> Saved View, Connection, Page or Site itself. I do not need Tell Lenni,
> Settings, schema knowledge or database terminology.

## Merged implementation ledger

| Checkpoint | Pull request | Feature head | Merge commit | Exact-head CI | Post-merge main CI |
| --- | --- | --- | --- | --- | --- |
| J3-I1 Tables and Properties | #63 | `87aebf1fcc79c2bdaf9a974498a2567d6faf16a9` | `8ca69e3c6b45ea30393b2ce5f1e5ac378d16cdbe` | `32562626883` passed | `32568411536` passed |
| J3-I2 Saved Views and Connections | #64 | `bb78f8aa1bf930c317d0137b72a5b6e1d731335e` | `43e45536d354942ec8f544a1436632c8ba14586e` | `32594334930` passed | `32595435411` passed |
| J3-I3 Internal Pages | #65 | `91193390fc7be25d2154ec57a8a0f8f34645ef95` | `52cf7c677c4b2aa5744fb78a7a803c1d960e6164` | `32600523415` passed | `32601348499` passed |
| J3-I4 Sites and publication | #66 | `a1f9aa143f8e7b80076080fb654e9ddc732ce9f7` | `d3765780052aa484841d4f9d7cd40cd99cd51c0a` | `32604046089` passed | `32605002317` passed |

All four were merged through the normal merge-commit path. PR #65's original
screenshots were not accepted as product evidence; implementation continued on
the same bounded branch until the corrected Notion-style Page canvas and
replacement evidence were complete.

## Owner-visible outcome

The merged workspace now uses one manual grammar:

```text
discover the control where the thing lives
→ edit in context
→ preview where useful
→ commit with one consequence-labelled action
→ continue ordinary work
```

- A Property is added or inserted from its Table edge, previewed as proposed,
  committed once and immediately available for ordinary Record values.
- A Business-shared Saved View is composed with name, typed query and exact
  mixed columns, previewed read-only and saved coherently as a Table tab.
- A Connection is described in owner language for both sides, previewed as an
  empty non-operable column, committed once and then operated quietly.
- An internal Page is a bounded document canvas with contextual insertion,
  inline Heading/Text work, exact Saved View embeds, one settled reorder save
  and a clean Reading/Staff state.
- A published Site keeps experiments in component memory, previews through the
  exact Page renderer and changes the public URL only after one deliberate
  **Publish changes** action.

## Architecture and trust evidence

Journey 3 reuses Objects, Fields, Relationships, Records, Views, Forms and
Pages. Direct Table and Direct Page services remain bounded facades over the
trusted atomic configuration lifecycle. Business, actor, relationship
orientation, current snapshot and complete operation composition are
server-owned.

Only two authorised narrow migrations were needed:

- `20260822120000_j3_i2_saved_view_boundary.sql` adds coherent Saved View
  action support and a typed, read-only, authenticated preview boundary;
- `20260822223000_journey_3_published_site_changes.sql` adds the atomic
  published-Page update boundary and database action-shape guard.

Neither adds a table, draft store, primitive, renderer, query language or
public generic Record surface. ADR-044 and ADR-045 record the decisions.

The configuration and operational lanes remain separate. Checkpoint evidence
proves one applied Change and one immutable Version for each completed bounded
configuration action. Record values, connected-Record selection/unlink,
search, View switching and embedded Record operation create no configuration
Version. The full PostgreSQL suite repeats tenant isolation, RLS, currentness,
atomic application, forward history and operational no-Version assertions.

## Cross-business and role acceptance

The final browser audit used the same generic runtime for:

- Milk round — Customers, Products, Standing Orders and Lines;
- Mobile dog groomer — Customers, Pets, Appointments and Services;
- Catering enquiry — Contacts, Enquiries, Events and Quotes;
- Trades/jobs — Customers, Jobs and Tasks;
- Bedford Bakery — public preorder regression.

Owner and Admin retained contextual structural controls. Staff retained the
complete authorised operating surface while Add property, Create saved view,
Create Table/Page, Changes and Tell Lenni were absent. The audit covered
1440x900, 1024x768 and 390x844; every checked document had equal scroll and
client widths and no browser warning/error logs.

The read-only cross-business browser pass did not advance configuration. Its
seeded configuration heads were Bedford `2 Versions / 1 Change / revision 2`,
Catering `18/17/18`, Milk round `20/19/20`, Dog groomer `16/15/16`, and
Trades/jobs `16/15/16`. Detailed mutation counts remain in each checkpoint
ledger so the closeout screenshots do not manufacture fresh configuration
history.

## Verification

- `npm run check` — 90 files and 964 tests passed.
- `npm run build` — production build passed.
- `npm run test:integration` — 26 files; 268 passed and 5 deliberately skipped,
  including the 19/19 RLS suite and four-business proof.
- `npm run workspace:proof:seed` — 2/2 passed and restored review fixtures.
- `npm run check:migration-immutability` — 43 historical migrations passed.
- clean `npm run supabase:reset` — replay through both Journey 3 migrations
  passed.
- `npm run supabase:lint` — no schema errors.
- Durable browser evidence: [Journey 3 closeout index](./evidence/j3-closeout/README.md).

No live provider evaluation ran. All Journey 3 owner outcomes are manual-first
and remain usable without AI.

## J3-I5 exact repository scope

J3-I5 changes only:

- `docs/lenni-journey-3-closeout-report.md`;
- `docs/lenni-journey-3-product-architecture-brief.md`;
- `docs/evidence/j3-closeout/README.md`;
- nine responsive JPEGs under `docs/evidence/j3-closeout/` covering Owner,
  Admin, Staff, four business shapes and Bedford public regression.

Migrations: none. Product/runtime/test source files: none. The existing tests
are the accepted repeatable seams and all passed unchanged.

## Deliberately excluded work and known limits

Journey 3 does not add Property removal or requiredness, personal Views,
Connection deletion/cardinality amendment, arbitrary Page/Site blocks,
Button/capability settings, branding/themes/media/domains/SEO, formulas,
workflows, collaboration, durable editing drafts, a website builder, AI
changes or Journey 4 work.

Drafts for Table/View/Connection and published-Site experiments remain
component-memory only. Browser refresh loses them after the required warning.
This is the accepted bounded model, not an unimplemented persistence promise.

## Final owner-review pack

1. Run `npm run supabase:reset`, `npm run workspace:proof:seed`, then
   `npm run demo:seed`. The seed commands print local-only review credentials;
   this report deliberately stores no password.
2. Start `npm run dev`.
3. Use the emitted proof Owner to review the four `/app/<proof-slug>`
   workspaces and their primary Tables/Saved Views.
4. Use Bedford Owner and Staff routes emitted by `demo:seed` to compare
   structural and operating roles.
5. Review `/app/lenni-connections-demo/workspace/phase2_appointments`, an
   internal Page under Pages, and
   `/app/bedford-bakery-demo/sites/preorder?mode=edit`.
6. Keep `/p/bedford-bakery-demo/preorder` open separately while editing the
   published Site; confirm it stays unchanged until **Publish changes**.
7. Compare the live routes with the durable evidence index and checkpoint
   ledgers.

Journey 3 stops after the J3-I5 merge and green post-merge main CI. Journey 4
has not begun.
