# Lenni Journey 1 acquisition reliability resolution

**Status:** Implementation decision for Journey 1 maintenance
**Date:** 19 August 2026

## Repository resolution

The initial quality failure becomes available in `generateCandidate()` after
the registered acquisition planning task has returned, the deterministic
interpreter has composed the untrusted configuration payload, and the
candidate quality boundary has rejected that payload. The implementation will
keep the composed payload available to that orchestration boundary so recovery
can inspect the code-owned quality error without exposing model output or
writing an invalid candidate.

The recovery allow-list is deliberately limited to:

- `cross_object_field_leakage`
- `relationship_scalar_duplication`
- `semantically_redundant_field`

For these failures, the validator already identifies the exact scalar Fields
that mechanically duplicate a connected business area's identity. The chosen
implementation is **A: deterministic normalization for mechanically redundant
graph output**. It removes only the Fields identified by the existing quality
rules and updates dependent Forms, Views, and owner-readable tracked
information. It never changes a Relationship, invents a replacement Field,
changes a required Field, or broadens the request. If the dependent candidate
cannot remain valid after that exact removal, recovery stops and the existing
deterministic fallback is used.

No dedicated model repair task is introduced. That avoids a second acquisition
subject, a second live qualification/reliability evidence track, and a second
provider call for a correction that is mechanical under the current validator.

## Bounds and lifecycle

One owner submission still calls `reserve_anonymous_build_attempt()` exactly
once. Recovery runs synchronously in memory after that reservation and never
calls the reservation RPC, creates persistent state, or increments
`attempt_count`, `proposal_count`, `regeneration_count`, or the successful
refinement allowance. The maximum provider-call count remains one; the
deterministic recovery itself is one bounded pass and cannot recurse. The
existing Terra-medium acquisition policy therefore remains the cost and
latency envelope: at most 25 seconds of provider time and at most 47,500
microusd of worst-case provider token cost for one execution. Successful first
pass requests remain one-call requests.

Recovery is enabled only for first acquisition/regeneration orchestration. The
existing refinement path continues to use `allowFallback: false` semantics
without automatic recovery, so successful refinement counting, failed repair
behaviour, and previous-candidate preservation remain unchanged.

The complete `validateAcquisitionCandidate()` boundary runs again after every
successful normalization. Non-quality errors, unclassified quality errors,
provider failures, `needs_more_detail`, unsupported-capability handling,
currency grounding, and Location exclusion retain their current behavior.

The first-pass instruction is strengthened with generic graph guidance about
keeping identity/contact data on the business area it belongs to and using a
Connection for the relationship. That instruction change invalidates prior
live acquisition subject evidence; the existing qualification and reliability
gates must be rerun against the frozen implementation before launch claims are
made. A broader redacted product-reliability corpus is separate evidence and
does not replace the eight-scenario hard contract.
