# Lenni Journey 1 Final Closeout — Resolution Note

## Scope

This note records the smallest implementation seams for the five final
Journey 1 first-user experience blockers. It is intentionally limited to
Journey 1 closeout; Journey 2 and Journey 4 are not part of this work.

## Root causes and bounded resolution

### 1. Acquisition refinement allowance

The current anonymous acquisition RPC treats every provider-backed attempt as
one of the two session attempts. The refinement service reserves that attempt
before model generation, and fallback or deterministic validation paths can
still return a starter candidate after the requested change failed. That makes
the owner-facing allowance track provider reservations instead of successful
refinements.

The smallest safe seam is to keep provider reservations and the existing daily
rate limit as anti-abuse truth, widen the per-session retry ceiling to a still
bounded value, and add a `successful_refinement_count` on the existing session
row. Only a validated, reconciled refinement increments that count. The owner
gets two successful refinements; rejected, unsupported, failed-generation and
failed-write paths do not spend that product allowance.

### 2. Site editing

The existing Site editor already uses a bounded page-layout editor with title,
Heading and Text edits plus explicit block add, reorder and remove controls.
Some seeded historical layouts predate stable block IDs, which made those
controls disappear for existing content. The closeout adds a position-scoped
legacy alias that the existing direct Page composer resolves and converts to
real UUIDs on the first mutation. It also adds capability-block guidance only
at the trusted boundary available in this repository; it does not introduce a
rich text or general-purpose builder.

### 3. Site publication

The current Site route prepares a proposal and sends the owner to the generic
Changes lifecycle. That is safe but does not meet the final closeout’s single
owner action. The smallest seam is a Site-only server action that reloads the
authoritative current snapshot/currentness, composes the exact one `set_page`
publication operation, then calls the existing `ConfigurationChangeService`
validation and application lifecycle. Stale, invalid and failed lifecycle
states fail closed; the generic Changes/History surface remains intact.

### 4. Public Booking presentation

The public Booking catalogue currently returns configured field labels but not
the configured Customer/Subject object labels. The renderer therefore cannot
disambiguate repeated labels such as “Name”, and slot controls expose raw
capacity text such as “1 left”. The smallest seam is to add trusted object
labels to the narrow public catalogue and render grouped, labelled fields with
compact accessible slot states (`Available`/`Full`) while preserving the
existing validated endpoint, honeypot, idempotency and RLS boundary.

### 5. Opening the live Site

The owner management surface currently links to the public URL in the same
tab. The closeout adds an explicit `Open live Site ↗` link with a new-tab
target and safe `rel` attributes. The public runtime does not render owner
navigation, so the public page remains a customer surface and the workspace
tab is preserved.

## Verification intent

The implementation will be verified with focused acquisition, Site editor,
publication, Booking/Form and navigation checks, then the repository’s full
test/type/lint/format/build/database/security checks and the required
responsive owner/public evidence. Any remaining integration fixture failure
will be reproduced from a clean current `main` before classification.
