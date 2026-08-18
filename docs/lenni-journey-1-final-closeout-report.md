# Lenni Journey 1 Final First-User Experience Closeout

## Repository

- Branch: `journey1/final-closeout`.
- Base SHA: `babd0b6f66d1f9f107767c466f83199a351b0e1d`.
- Accepted implementation SHA used for the real-provider/browser run:
  `fd61cbe1306b182e9ce0de92a832aa80858948f3`.
- Scope: Journey 1 only. Journey 2 and Journey 4 were not implemented.
- The handoff preflight confirmed a clean branch, a matching remote head before
  closeout work, an open and unmerged PR #57, and no Journey 2/Journey 4
  implementation.

## Provider and environment preflight

Redacted checks confirmed `AI_PROVIDER=openai`, non-empty OpenAI and Supabase
service-role configuration, `.env.local` loaded by the running Next.js process,
healthy local Supabase REST, and the intended local application environment.
No secret values, cookies, credentials or provider response bodies were
printed or persisted.

## Real-provider acceptance

### Musical-instrument acquisition and refinement

The fresh exact musical-instrument scenario produced `proposal_source=tailored`
with a coherent candidate containing Customers, Instruments and a
Repairs/Repair-jobs concept. No fallback was counted.

The first approved refinement succeeded through the real provider. Customers,
Instruments and Repair jobs remained; a direct Customer ↔ Repair job Connection
was added; the owner-readable delta and updated preview were present; and the
owner UI showed one successful refinement remaining.

The second approved refinement also succeeded through the real provider. The
direct Connection remained, Priority was added to Repair jobs, the candidate
remained coherent, the updated retained Repair-jobs View included Priority, and
the owner UI showed zero successful refinements remaining. The session recorded
two successful refinements. Rejected, unsupported and provider-failed paths do
not increment that allowance, as covered by the refinement boundary tests; the
current candidate is preserved on those paths.

The smallest generic cause found in the fresh run was that a selected new Field
could be retained in the configuration without being surfaced by the retained
View for the same Object. The deterministic reconciliation now adds selected
new Fields to the appropriate retained table/list/cards/detail View shape. It
does not change prompts, models, policies, validators or fallback behaviour.
The focused regression test covers the retained View and owner-readable delta.

### Dog-grooming acquisition, preview and claim

The fresh exact dog-grooming scenario produced `proposal_source=tailored` with
Customers, Dogs, Grooming services and Appointments, sensible Connections, and
a trusted online Booking Site. The Dog subject was retained as a reusable
concept; Services did not replace it; and no dog-specific primitive or module
was introduced.

The candidate preview was read-only and synthetic/example-only. Deliberate
`Use this setup` completed signup continuity and created the real Business.
The claim landed on the authenticated Home with the generated Site in Draft
under Sites. Immediately after claim, redacted local aggregates were
`records=0|relationships=0`, proving preview/example operational data and
Connections were not copied into the Business.

## Site editing, publication and live editing

On the claimed draft Booking Site, the owner acceptance passed for:

- Site title rename;
- existing Heading edit;
- existing Text edit;
- supported block reorder;
- supported block removal; and
- supported Text block addition and edit.

The edits persisted after reload, the Site remained Draft, and every mutation
advanced the existing trusted configuration boundary. The local head advanced
through immutable forward configuration history; no direct Page DML or AI was
used.

One deliberate `Publish Site` action moved the same Site to Published through
the existing proposal → deterministic validation → deliberate apply → immutable
Version lifecycle. The published owner view showed `Open live Site ↗` and no
second publication lifecycle. No model call or AI accounting entry was used by
publication.

The published editor clearly stated that changes go live when saved. A small
supported Text edit saved directly while the Site remained Published; the
published editor had no `Publish Site` button, and the public Site reflected the
edit immediately. The owner URL remained in its original tab. `Open live Site
↗` used a separate customer-context tab with `target="_blank"` and
`rel="noopener noreferrer"`. The public page contained no owner-only `Back to
Lenni` control.

Redacted configuration aggregates after the browser run were
`head=11|versions=11|changes=10|published_page=11`, proving the draft edits,
publication and published save each used the forward history boundary.

## Public Booking acceptance

The published Booking Site passed the visual and interaction checks:

- one dominant page heading and no duplicate `Book online` heading;
- Customer and Dog fields clearly grouped and disambiguated;
- date selection and accessible time-slot radios grouped under the Booking
  experience;
- explicit selected-slot state and text labels such as Available/Full;
- honeypot off-screen and non-focusable (`aria-hidden`, `tabIndex=-1`);
- no payment capability; and
- no horizontal overflow at 1440×900, 1024×768 or 390×844.

One legitimate synthetic booking returned confirmation. Redacted database
evidence was exactly:

```text
records=3|relationships=3|submissions=1
appointment|Appointments|1
customer|Customers|1
dog|Dogs|1
customer_appointments_appointment|customer->appointment|1
customer_dogs_dog|customer->dog|1
dog_appointments_appointment|dog->appointment|1
```

The configured service concept remained present with no operational preview
records. A repeated request returned `ok=true|idempotent=true` and did not add
records or relationships. Forged field and capability checks returned HTTP 400
and 404 respectively. Anonymous direct generic Record access was denied with
HTTP 401.

## Provider/accounting truthfulness

The tailored musical and dog-grooming acquisition/refinement calls were real
OpenAI-provider calls and were recorded as tailored provider-backed outcomes.
Fallback was not counted as acceptance. The successful-refinement allowance
ended at two successful refinements, and the dedicated AI-accounting gate passed
58/58 tests. Direct Site editing and publication used deterministic trusted
boundaries and did not invoke AI or consume AI accounting.

## Verification

Passed checks on the accepted implementation:

- `npm test` — 85 files, 885 tests;
- `npm run typecheck`;
- `npm run lint`;
- `npm run format:check`;
- `npm run build`;
- `npm run check:migration-immutability` — 38 historical migrations;
- `git diff --check`;
- clean `npm run supabase:reset`;
- `npm run supabase:lint` — no schema errors;
- `npm run test:rls` — 19/19;
- `npm run test:ai-accounting` — 58/58;
- focused acquisition unit suites — 10 files, 87 tests;
- acquisition integration — 13/13;
- Journey 1 public capability plus direct Site integration — 2 files, 7 tests;
- Experience plus initial-preorder integration — 2 files, 23 tests;
- complete integration — 26 files, 265 passed and 5 skipped;
- explicit Bedford preorder regression — 26/26; and
- requested browser responsive acceptance — 3/3 viewports, no horizontal
  overflow.

The final pushed head must retain green exact-head GitHub Actions before this PR
is considered merge-ready. No merge was performed.

## Scope

Journey 2 was not implemented. Journey 4 was not implemented. No new ADR,
primitive, dog-specific architecture, payment capability, or production
deployment was added during closeout.
