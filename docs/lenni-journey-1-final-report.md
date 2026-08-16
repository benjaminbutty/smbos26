# Lenni Journey 1 — Final Report

Date: 16 August 2026  
Status: Complete; J1-E merged normally
Scope: Journey 1 only

## Verdict

Journey 1 is implemented and passes the owner-facing acceptance path on a
clean local database. The journey now runs from ordinary-language description
through bounded clarification, interactive read-only preview, deliberate
acceptance, authentication, Business basics, workspace creation, Home and a
draft customer Site.

The final browser pass also published the draft through the existing trusted
configuration boundary and completed a real Booking transaction. PostgreSQL
contained exactly one Customer, one Pet and one Appointment, plus the three
configured generic Relationship edges. No preview Records or Connections were
copied into the Business.

## Baselines and merge ledger

Post-hygiene baseline: `5079100f653ae8e8ecf378b32eb444d42e2e9ea3`  
Final main SHA for the Journey 1 implementation: `161ba9d5e3f2f1a46d11a48275d23a357e3e6a47`

| Checkpoint | PR | Normal merge commit | Result |
| --- | --- | --- | --- |
| J1-0 hygiene | #49 | `5079100f653ae8e8ecf378b32eb444d42e2e9ea3` | Exact approved head, green CI, hygiene scope preserved |
| J1-A public capability foundation | #50 | `55c7300` | Merged; exact-head CI green |
| J1-B acquisition conversation | #51 | `21c29bf9ca0b91fd18c86c8afbb7ca2ba9ec868a` | Merged; exact-head CI green |
| J1-C interactive preview | #52 | `b2744b0b3e932a621d56c639e0b174ec5decdff5` | Merged; exact-head CI green |
| J1-D claim, Home and Sites | #53 | `af4b0579a687339a3e409d1b818b477c765cfae4` | Merged; corrected exact-head CI green |
| J1-E final acceptance | #54 | `161ba9d5e3f2f1a46d11a48275d23a357e3e6a47` | Merged; exact-head run `31932152134` green |

## Durable changes

Accepted architecture decision: ADR-041 in `docs/architecture-decisions.md`.

Journey 1 migrations:

- `20260815100000_journey_1_public_capabilities.sql` — generic public Form,
  reusable Booking configuration, slot counters, replay state, rate safety and
  narrow public RPCs.
- `20260815110000_journey_1_bounded_acquisition_conversation.sql` — bounded
  clarification state and retention-safe session support.
- `20260815120000_journey_1_candidate_acceptance.sql` — candidate checksum and
  deliberate owner acceptance marker.
- `20260815130000_journey_1_claim_requires_acceptance.sql` — claim RPC requires
  the accepted current candidate before creating a Business.
- `20260816100000_journey_1_public_runtime_resolver.sql` — tenant-bound public
  Page/Form resolution through a narrow public RPC rather than raw metadata
  reads.
- `20260816110000_journey_1_booking_derived_fields.sql` — server-derived
  date/time Field hardening for generic Booking constructability. The existing
  trusted transaction remains the authority; the browser cannot choose these
  derived values.

No concept-specific business table, dog-grooming module, payment path or new
customer-created primitive was added.

## Capability summary

### Acquisition and AI

The existing opaque HttpOnly acquisition session now holds structured bounded
clarification entries. The normal path asks at most three material questions
over at most two rounds, preserves the original request, and supports a same-
session refinement loop. Candidate identity is frozen by checksum only after
`Use this setup`.

The provider-unavailable path was exercised repeatedly and produced an honest
deterministic starter with the Booking Site. No new provider-backed production
task or live flag was enabled in this closeout, so no new 8/8 and 24/24 live
qualification claim is made. Existing acquisition evaluation policy and
provider boundaries remain intact.

### Public Forms

The public create boundary resolves Business, published Page, active Form,
Object and allow-listed Fields on the server. It creates exactly one generic
Record, has bounded body/rate/replay controls and a honeypot, and does not
allow generic public reads, updates or arbitrary Relationship creation.
Preview has no submission endpoint.

### Scheduling and Booking

Booking is a reusable capability over generic Customer, Booking/Appointment,
optional Subject and optional Service Objects. The public runtime derives
slots and PostgreSQL revalidates tenant, Page publication, timezone, allowed
day, interval, notice, horizon, capacity and idempotency before atomically
creating Records and configured Relationships. There is no payment path.

For the final dog-grooming proof, the published Site created:

- Customer: `Jordan Test`
- Subject: `Biscuit Test`
- Appointment: `2026-08-17T08:00:00+00:00`, status `Booked`
- Relationships: `customer_has_subjects`, `subject_has_bookings`,
  `customer_has_bookings`

### Preview

The candidate preview uses the live Table, Record, Connection, Page and public
Site anatomy through explicit read-only adapters. Synthetic values are
deterministic, bounded and server-owned. The preview overlay persists across
navigation; `Back to Lenni`, refinement and stale candidate rejection were
verified. `Use this setup` performs no Business or operational write.

### Sites and Home

Public Pages appear under authenticated Sites; internal Pages remain under
Work. Accepted public Pages enter the Business as draft. Home uses real state,
surfaces the draft Site as the first review action, and contains no fake
metrics or copied preview Records.

## Verification evidence

- Final focused unit suites: 54 tests green, including acquisition,
  clarification, preview, renderer, public publication, policy and Booking
  contracts.
- Full local unit run: 850/850 tests green across 82 test files.
- Final PostgreSQL integration suites: 61/61 green across acquisition,
  Experience, Bedford preorder and Journey 1 public capabilities.
- Existing acquisition regression requiring appointment direct-row creation to
  remain unavailable stayed green after Booking constructability was fixed in
  the additive migration.
- Final browser journey: thin dog-grooming prompt, three material questions,
  four-table preview with Customers/Pets/Appointments/Services, connected
  synthetic examples, draft Booking Site, accepted candidate, signup, only
  Business name/timezone, Home, Sites, publication review/validate/apply and a
  real public booking.
- Final browser sizes: 1440×900, 1024×768 and 390×844. At the latter two sizes
  `document.body.clientWidth` equalled `document.documentElement.scrollWidth`
  (1024 and 390 respectively), with no horizontal overflow.
- TypeScript, focused formatting and `git diff --check` passed on the final
  branch. Exact-head CI for J1-A through J1-D was green; J1-E exact-head CI is
  the required closeout gate for the final PR.
- Migration immutability passed for all 36 historical migrations, and Supabase
  schema lint reported no schema errors.

## Owner review routes

- Public start: `/start`
- Candidate preview: `/start/preview/home`
- Candidate Booking Site: `/start/preview/booking_site`
- Authenticated Home: `/app/milo-mobile-grooming`
- Authenticated Sites review: `/app/milo-mobile-grooming/sites/book`
- Published public Booking Site: `/p/milo-mobile-grooming/book`

See `docs/lenni-journey-1-screenshot-index.md` for captured visual evidence.

## Explicitly deferred

Payments, permanent Lenni chat/history, authenticated Builder/Changes UX
reset, arbitrary public graph mutation, generic public Record reads, customer
portals, advanced staff/resource scheduling, travel routing, variable-duration
optimisation, recurring bookings, waitlists, workflows, theming, website
builder work and all Journey 2–6 experience reset work remain deferred.

Journey 2 has not started.
