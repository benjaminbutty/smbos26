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
rules. Exact cross-object identity Fields are canonicalised at the ready-plan
boundary, before dependent Forms and Views are compiled; this is the earliest
point where a model-marked required Field can be removed without mutating
requiredness or repairing an already-composed surface. The existing
post-composition recovery remains responsible for the other allow-listed
mechanical defects and updates dependent Forms, Views, and owner-readable
tracked information. Neither path changes a Relationship, invents a
replacement Field, changes a required Field, or broadens the request. If the
candidate cannot remain valid after the exact removal, recovery stops and the
existing deterministic fallback is used.

## Evidence-backed correction

The diagnostic-only subject at
`cffc584b570f300bc35e30234d31f860bc0ae649` preserved production behaviour and
added a finite recovery-refusal code to the hard-gate report. Its single live
qualification run passed 7/8. The `milk_round` failure remained
`quality_cross_object_field_leakage`, and the recovery refusal was precisely
`required_field`.

That result rules out an absent mechanical match, a broken Form/View rewrite,
and a second quality failure for this case. The planner had produced an exact
connected-object identity scalar but marked it required. Composition then
compiled dependent surfaces, after which the deliberately conservative
recovery could not remove the required Field. The smallest generic correction
is therefore earlier plan canonicalisation using the same mechanical predicate
as recovery. Richer related information such as a preferred contact name is
not mechanically exact, remains in the candidate, and is still rejected by the
unchanged authoritative validator. The canonicaliser also preserves the
original Fields if removal would leave a business area with no Fields.

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

Recovery refusal is reported only through a safe finite diagnostic code:
`no_mechanical_repair_fields`, `required_field`, `form_would_be_invalid`,
`view_would_be_invalid`, `repaired_candidate_invalid`, or
`second_quality_failure:<allow-listed quality code>`. Model prose, prompts,
provider bodies, and raw errors are not emitted.

The first-pass instruction is strengthened with generic graph guidance about
keeping identity/contact data on the business area it belongs to and using a
Connection for the relationship. That instruction change invalidates prior
live acquisition subject evidence; the existing qualification and reliability
gates must be rerun against the frozen implementation before launch claims are
made. A broader redacted product-reliability corpus is separate evidence and
does not replace the eight-scenario hard contract.
