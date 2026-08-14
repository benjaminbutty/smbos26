# Lenni redesign C2 checkpoint report

## Checkpoint record

- Checkpoint: C2 — acquisition, activation and Home
- Branch: `redesign/c2-acquisition-home`
- Base: merged C1 `d8bd12357cbf88ed760a98d24d9d56105d2bdbdc`
- Feature SHA: recorded after the final checkpoint commit
- PR: recorded in the running ledger after publication
- Merge SHA: recorded in the running ledger after normal merge
- Exact-head CI: recorded in the running ledger after the PR head is verified

## Outcome

The first-value journey now reads as one Lenni product flow: describe the work,
receive a real proposal, review what will be created, create the workspace, and
land on a Home with one obvious next action. Existing server semantics,
temporary acquisition state, deterministic fallback and capability boundaries
remain unchanged.

## Surfaces changed

- Public acquisition frame and category/example hierarchy at `/start`.
- Purposeful acquisition input, honest processing state and bounded error/recovery
  presentation for detail, proposal limit, session expiry and unavailable states.
- Proposal review at `/start` using actual proposal tables, connections, views,
  pages and relationships, with explicit included and not-included sections.
- Signup/workspace confirmation continuity at `/start/business`.
- Lenni public framing for `/sign-in`, `/sign-up` and `/onboarding`.
- Empty Home with a manual-first path and existing New Table/New Page actions.
- Populated Home with actual configured Page/View destinations and a single
  “Start here” action.
- Scoped C2 responsive presentation for desktop, compact laptop and mobile.

## Browser evidence

Evidence uses the real local application and seeded/live fixtures; no static
mock records were introduced.

| State | Before | After |
| --- | --- | --- |
| Public start — 1440×900 | `/private/tmp/lenni-c2-before-public-1440x900.png` | `/private/tmp/lenni-c2-final-public-1440x900.png` |
| Public start/proposal — 1024×768 | `/private/tmp/lenni-c2-before-public-1024x768.png` | `/private/tmp/lenni-c2-final-public-1024x768.png` |
| Public start/proposal — 390×844 | `/private/tmp/lenni-c2-before-public-390x844.png` | `/private/tmp/lenni-c2-final-public-390x844.png` |
| Proposal review — desktop/mobile | — | `/private/tmp/lenni-c2-after-proposal-top-1440x900.png`, `/private/tmp/lenni-c2-after-proposal-top-390x844.png` |
| Workspace confirmation — desktop/mobile | — | `/private/tmp/lenni-c2-after-business-1440x900.png`, `/private/tmp/lenni-c2-after-business-390x844.png` |
| Owner populated Home — 1440×900 | `/private/tmp/lenni-c2-before-home-milkwoman-1440x900.png` | `/private/tmp/lenni-c2-final-owner-home-1440x900.png` |
| Owner populated Home — 1024×768 | `/private/tmp/lenni-c2-before-home-milkwoman-1024x768.png` | `/private/tmp/lenni-c2-final-owner-home-1024x768.png` |
| Owner populated Home — 390×844 | `/private/tmp/lenni-c2-before-home-milkwoman-390x844.png` | `/private/tmp/lenni-c2-final-owner-home-390x844.png` |
| Staff populated Home — all target sizes | — | `/private/tmp/lenni-c2-after-home-staff-1440x900.png`, `/private/tmp/lenni-c2-after-home-staff-1024x768.png`, `/private/tmp/lenni-c2-after-home-staff-390x844.png` |

Live browser checks covered the actual proposal flow, workspace confirmation,
Owner Home on `milkwomanfran`, Staff navigation on `bedford-bakery-demo`, and
the mobile Work/More sheet contract. The mobile check verified initial focus,
Tab/Shift+Tab wrapping, Escape close, trigger focus return, hidden page scroll
while open and no horizontal overflow. Staff did not receive Owner/Admin-only
Tell Lenni, Changes or Setup actions.

AI-available presentation is covered by the real generated proposal flow.
AI-unavailable, broad-request, proposal-limit and expired-session presentation
are exercised by the source contract and direct state presentations; the
fallback remains honest and routes the user to a usable manual/recovery action.

## Verification

- Focused C2/UI/acquisition contracts: 4 files, 40 tests passed.
- Full Vitest suite: 77 files, 821 tests passed.
- Clean Supabase integration suite: 25 files, 257 passed, 5 intentionally skipped.
- Explicit RLS integration gate: 19 tests passed.
- Local Supabase schema lint: no schema errors.
- Next route type generation and TypeScript no-emit: passed.
- ESLint with zero warnings: passed.
- Prettier repository check: passed.
- Production Next build: passed with the documented local-only
  `ACQUISITION_RATE_LIMIT_SECRET` from `.env.example`.
- `git diff --check`: passed.

## Material design decisions within existing authority

- Kept the public journey under the existing acquisition service and claim
  boundary; presentation now exposes the server-owned error categories without
  adding new state or capability.
- Used actual proposal data for counts, relationships, saved views and pages;
  no unsupported actions such as Print or Archive were invented.
- Made empty Home manual-first, reusing the existing New Table, New Page and
  builder routes.
- Chose the first configured Page as the populated Home attention destination;
  when no Page exists, the first existing View is used. This is deterministic,
  tied to live configuration and does not add planning semantics.
- Kept C2 visual rules scoped to acquisition and Home selectors; later route
  surfaces remain for their own checkpoints.

## Exclusions and carried debt

- No prompt, schema, evaluator, provider, AI policy or acquisition accounting
  changes.
- No new onboarding persistence, migration, dependency, route or state
  framework.
- No automatic Apply/Publish, fake progress, fake metrics or future capability.
- Empty Home does not invent an attention metric when no operational data is
  available; it provides the truthful manual setup route instead.
- Admin browser identity is not separately seeded locally; Admin behavior
  remains covered by the existing capability/server contract and tests, while
  live browser evidence uses the available Owner and Staff identities.
