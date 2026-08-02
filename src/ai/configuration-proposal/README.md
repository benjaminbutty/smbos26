# Authenticated configuration proposal orchestration

Milestone 7 Phase 2 is the server-only bridge from a completed transient
Phase 1A/Phase 1B handoff into the existing Milestone 5 proposal lifecycle.
It does not execute planning or drafting AI. A later qualified server flow
passes a strict handoff containing the Business identifier, server-owned exact
active configuration currentness, the Phase 1A task input and the Phase 1A
draft.

The service loads the Business through the ordinary authenticated Owner/Admin
context source, compares the supplied model context byte-for-byte with a fresh
canonical projection, and compiles against the first immutable snapshot. It
then loads the same context again and requires exact Business, actor,
currentness and canonical model-context equality before calling only
`ConfigurationChangeService.proposeChangeSet()` once. M5 remains the final
atomic expected-head guard.

Proposal metadata is code-owned: the title is `Proposed configuration changes`
and the description is `null`. M5 allocates proposal-scoped IDs and owns the
candidate snapshot, checksum, display context and semantic diff. The service
returns only the proposal identifier, proposed status, base currentness and
operation count. It never validates, applies, publishes, rebases or retries a
stale handoff.

The owner request, model context, ready plan, raw draft, provider data and AI
accounting metadata remain transient and are not persisted by this boundary.
The drafting provider remains disabled, and Phase 2 adds no route, Server
Action, UI, migration, operational mutation or public Form submission.
