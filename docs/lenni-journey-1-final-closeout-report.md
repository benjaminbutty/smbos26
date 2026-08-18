# Lenni Journey 1 Final First-User Experience Closeout

## Repository

- Starting `main`: `babd0b6f66d1f9f107767c466f83199a351b0e1d`
- Branch: `journey1/final-closeout`
- Feature implementation commit: `f1418f10c112f23075ea5dbd5ea44938dfe081bd`
- Public-Site editing checkpoint: `e542f7152a360e1f48be80776237b9000e14cdd5`
- Acquisition/public-booking hardening commit: `ca988bc`
- Changed files in the Site checkpoint: seven; hardening commit: 13
- Scope: Journey 1 only. Journey 2 and Journey 4 were not started.

The branch was created from clean current `origin/main`; the final fetch before
handoff still reported `origin/main` at the starting SHA. The merge base is the
starting SHA.

## Acquisition correction

### Finite dog-scenario diagnosis and generic correction

The exact dog-grooming scenario was exercised through the real configured
provider before the final browser rerun. The tailored candidate reached four
Objects, three Connections and one public Booking Site, with the expected
Customer, Dog/Pet and Appointment/Booking shape. The first finite failures were
not provider-output failures: one candidate repeated a generic identity Field
alongside a more specific subject name, and a later candidate selected a
Booking status default that was not valid for its configured options. The
generic interpreter canonicalises redundant identity Fields before Forms and
Views are compiled, and the Booking capability now selects an existing valid
status option.

The first real public submission then returned a redacted `rejected` result.
Finite local evidence showed all configured Objects, Relationships and public
Fields resolved, and all four supplied synthetic Field values were valid. The
booking Object nevertheless contained two required provider-shaped datetime or
status Fields that were not the mapped Booking Fields; the transaction supplied
the capability mappings, so no Record or Booking submission was created. The
smallest generic cause was the semantic reuse matcher: it only recognised an
exact status name and a single separator in appointment date/time names. It now
recognises multi-word appointment start/date/time and status/state names, with a
regression fixture covering provider-shaped names. No dog-specific condition or
new primitive was added.

The clean browser plumbing rerun then passed draft Site editing, publication,
published-Site live editing, separate public-tab rendering and one successful
synthetic Booking. Aggregate evidence was one Customer Record, one Dog/Pet
Record, one Appointment/Booking Record, three Relationships, one slot counter
reservation and one idempotency token. The public capability integration also
passes its idempotency and forged-field/RLS denial coverage.

Four subsequent exact provider retries on the clean local path were classified
only as the finite redacted diagnostic
`stage=provider_transport, code=provider_transport_rate_limited`. No provider
body, candidate JSON, prompt, credentials or personal data was logged or
persisted. The fallback was used only to exercise the deterministic runtime
plumbing and is not counted as a tailored-provider pass; the external provider
rate limit is the remaining hard stop for a fresh tailored rerun.

Before closeout, the anonymous session treated every provider-backed attempt as
one of the two owner-facing refinement opportunities. Reservation happened
before generation, and fallback/deterministic rejection could therefore make a
failed refinement look like a completed attempt.

The closeout keeps provider/accounting reservations and the existing daily
anti-abuse ceiling truthful, widens the still-bounded session retry ceiling to
six provider reservations, and adds `successful_refinement_count` to the
existing session row. Only a validated, reconciled, successfully written
refinement increments that counter. The owner-facing product allowance is:

```text
one initial candidate + two successful refinements
```

Rejected, unsupported, failed-generation, deterministic-validation and failed-
write paths do not increment it. The current candidate remains in the session
while a retry is reserved. The internal request no longer exposes prompt-
concatenation language to the owner.

The conservative reconciliation test covers the exact additive request
`Customers should also be linked directly to repair jobs.`: existing Customer
and Repair job concepts remain, the new Connection is added, and unrelated
objects remain unchanged. The service path disables fallback for refinements,
so a provider failure is reported as a safe refinement failure rather than a
synthetic success.

### Real provider-backed refinement closeout

The first exact provider-backed owner-acceptance run reached a tailored musical
instrument repair candidate, then safely rejected `Customers should also be
linked directly to repair jobs.` The candidate and both successful-refinement
allowances remained available.

A narrow internal-only diagnostic classified the deterministic failures without
logging or persisting the owner request, provider output, candidate JSON, model
prose, PII, credentials or arbitrary error bodies. The finite diagnostics were:

1. `stage=reconciliation`, `code=quality_required_form_field_missing`;
2. after closing that invariant, `stage=reconciliation`,
   `code=quality_object_reference_missing`.

The generic reconciliation correction now keeps retained Forms valid when a
selected required Field arrives through a regenerated/re-keyed Form set, and
includes endpoint Objects required by selected Connections and other
object-bound surfaces. The architecture remains unchanged:

```text
current reviewed candidate
+ model suggestion
+ owner refinement
→ conservative deterministic reconciliation
→ full candidate-quality validation
→ updated candidate
```

The clean real-provider rerun passed. The initial candidate contained Customers,
Instruments and Repair jobs. The exact first refinement added a direct Customer
↔ Repair job Connection, retained all three concepts, displayed an owner-readable
delta and opened the updated preview. The UI then showed one successful
refinement remaining, proving the earlier failed attempts had not consumed the
product allowance.

The same session accepted `Also add a priority to each repair job.` The updated
preview exposed Priority on a Repair job while the first direct Customer ↔ Repair
job result remained in the candidate. The session then showed zero refinements
remaining: two successful refinements used, failed attempts not counted. No AI
task, prompt, model, schema or policy was changed for this acceptance.

## Site editor correction

Sites continue to use the existing Page layout, PageRenderer and direct Page
configuration actions. The bounded editor now exposes:

- current Site/Page title editing;
- existing Heading and Text editing;
- existing block move, remove and add controls;
- visible Booking/Form capability frames with an `Edit settings` action to the
  existing trusted Tell Lenni boundary;
- no rich-text editor, arbitrary layout, or second Page model.

Historical seeded layouts without block UUIDs now use a validated
position-scoped legacy alias for the first mutation; the existing composer
immediately persists real UUIDs through the same M5-backed change boundary.

## Publication correction

Draft Site publication is one explicit owner `Publish Site` action. The server
action reloads authoritative Site/currentness, composes exactly one bounded
`set_page` publication operation, calls the existing
`ConfigurationChangeService`, requires deterministic validation, and deliberately
applies only because of that owner POST. Success creates the normal immutable
Version and Published Site state. Stale, validation and application failures
remain Draft and fail closed.

There is no model call, AI accounting, browser-supplied operation, direct Page
DML, or global automatic-apply capability. Existing Changes and Version history
remain available as evidence of the underlying lifecycle.

## Public Booking and Form correction

The public Booking runtime now:

- avoids a duplicate dominant Page-title/Booking H1;
- groups Customer, Subject and Booking details using trusted configured labels;
- disambiguates repeated fields such as Name without exposing graph keys;
- uses compact accessible slot controls with selected state and Available/Full
  status rather than raw `1 left` capacity language;
- keeps the trusted resolver, server-derived identity, RLS, schedule/current-time
  checks, capacity, idempotency, honeypot and no-payment boundary unchanged.

The real public capability integration creates and idempotently retries one
generic Form Record and one configured Booking graph submission, including its
Relationship data and forged-key/RLS denial checks. Bedford preorder integration
continues to pass without changing its trusted operational transaction.

## Navigation and responsive evidence

Authenticated Site management keeps the owner workspace in the original tab;
the public runtime has no owner-only shell or Back-to-Lenni control. The local
browser evidence used the Milo's Grooming workspace created with synthetic
credentials and covered `/start`, the authenticated draft Site, its published
Site, the published Site editor, and `/p/milo-s-grooming/book` in a separate
public tab. The latest tailored-provider attempt was rate-limited, so the Site
and Booking browser evidence is explicitly recorded as deterministic plumbing
evidence rather than a tailored-provider claim.

The public Site was checked at 1440x900, 1024x768 and 390x844. Each viewport
kept the form present with no horizontal overflow; at 390px the form remained
366px wide within the viewport. No personal information was captured in
screenshots.

## Verification

Passed checks:

- `npm test` — 85 files, 884 tests;
- `npm run typecheck`;
- `npm run lint`;
- `npm run format:check`;
- `npm run build`;
- `npm run check:migration-immutability` — 38 historical migrations;
- `git diff --check`;
- `npm run supabase:reset` from the closeout branch;
- `npm run supabase:lint` — no schema errors;
- `npm run test:rls` — 19/19;
- `npm run test:ai-accounting` — 18/18 integration tests plus the two unit
-  suites (58 tests total);
- focused acquisition suites — 8 files, 68 tests;
- acquisition integration — 13/13;
- public Form/Booking, acquisition and direct Site integration — 20/20;
- full closeout integration — 26/26 files, 265 passed and 5 skipped;
- responsive public Site checks — 3/3 requested viewports, no horizontal
  overflow;
- exact provider retry diagnostics — four finite rate-limit classifications;
  no tailored rerun could complete during the configured provider rate-limit
  window.

### Local fixture failure classification

The earlier dirty local full-integration run reported one failure against a
seeded Workers Business AI-accounting expectation (25/26 files passed; 5 tests
were skipped). This failure was not hidden or waived. After the repository-
supported clean reset it did not reproduce on the closeout branch: the exact
full integration command passed, and the dedicated AI-accounting integration
command passed 18/18. The same clean reset and exact commands also passed on
current `main`. It is classified as pre-existing dirty/local fixture debt, not
a Journey 1 regression. No Journey 1 production behaviour was changed to
satisfy that stale expectation.

No new ADR was required: the one-action Site publication is a narrow owner-
triggered orchestration over the existing proposal/validation/application/
Version lifecycle, not a new generic auto-apply path.

## Deferred scope

Journey 2 was not started: no full Notion/Tiptap editor, rich text, expanded
Page catalogue, Record redesign, broad Forms/Tables redesign, operating Home
redesign, nested Connection creation, or identity-type redesign.

Journey 4 was not started: no authenticated Tell Lenni conversation reset,
general automatic Changes orchestration, global lifecycle-screen replacement,
generic Builder site/page synonym handling, authenticated orphan-Form fix, or
permanent conversation history.
