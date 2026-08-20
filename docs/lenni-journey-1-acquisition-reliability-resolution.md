# Lenni Journey 1 acquisition reliability resolution

**Status:** J1-R2 implementation decision
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
boundary, before dependent Forms and Views are compiled, only when the Field is
optional. A required Field is not pre-deleted: it continues to the authoritative
validator and the existing recovery boundary, which refuses to remove it. The
existing
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
is earlier plan canonicalisation using the same mechanical predicate as
recovery only for optional Fields. Required leakage must still fail closed; it
cannot be made safe by silently discarding its requirement or making the
Connection required. Richer related information such as a preferred contact
name is not mechanically exact, remains in the candidate, and is still rejected
by the unchanged authoritative validator. The canonicaliser also preserves the
original Fields if removal would leave a business area with no Fields.

Every actual pre-composition removal is surfaced as a bounded internal event
containing only the removed-Field count. Product evidence reports raw
first-pass, pre-composition canonicalised, post-composition recovered, combined
canonicalised-and-recovered, fallback and execution-failure outcomes
separately.

The later exact-SHA qualification at
`9c1c969ac01165371676c84149f1452dea14e40b` again passed only 7/8 because an
`unusual_other` plan reached the same `cross_object_field_leakage` plus
`required_field` boundary. That result established a stochastic semantic
planning error rather than missing owner information. J1-R2 therefore permits
one correction execution only for that exact code pair. After later reliability
evidence showed the general task could repeat the defect, correction now uses
the dedicated `acquisition_required_identity_correction_v1` subject and policy
`acquisition_required_identity_correction_terra_medium_v1`. It receives the
original enriched owner request, category and grounded currency plus one finite
server-owned correction reason. It never receives the rejected model output.
The first acquisition task and instruction are unchanged.

## Bounds and lifecycle

One owner submission still calls `reserve_anonymous_build_attempt()` exactly
once. Recovery runs synchronously in memory after that reservation and never
calls the reservation RPC, creates persistent state, or increments
`attempt_count`, `proposal_count`, `regeneration_count`, or the successful
refinement allowance. The maximum semantic planning execution count is two;
deterministic recovery remains one bounded pass per composed candidate and
cannot recurse. Each execution uses the existing Terra policy with one provider
attempt, so the workflow ceiling is 50 seconds of provider time and 95,000
microusd of worst-case provider token cost. Successful first-pass requests
remain one-call requests.

Recovery and the exact J1-R2 trigger are enabled only for first
acquisition/regeneration orchestration. Provider authentication, transport,
rate-limit, timeout and refusal failures, other quality codes, and other
recovery refusal codes do not trigger the correction plan. The existing refinement
path continues to use `allowFallback: false` semantics without automatic
recovery or replanning, so successful refinement counting, failed repair
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

The first-pass instruction keeps its generic graph guidance about
keeping identity/contact data on the business area it belongs to and using a
Connection for the relationship. The dedicated correction task combines that
general bounded planning contract with a finite server-owned instruction to
preserve scope and use Connections for connected identity. The current provider
contract fixes Terra medium reasoning across tasks, so no provider abstraction
change was made solely to request a stronger correction profile. This material
orchestration change invalidates prior live
evidence; qualification and reliability must be rerun against the frozen
implementation before the 32 × 3 product corpus. The product corpus remains
separate evidence and does not replace the eight-scenario hard contract.

The first dedicated correction subject at
`f8645eff5362de4b1e788826cb2fda20811bea25` passed deterministic safety 24/24
but passed the combined correction qualification only 21/24. Every miss was the
same scope-retention finding on the unusual-business fixture, across all three
repetitions. The subject was not rerun. The correction instruction was clarified
generically so each distinct reusable person or organisation, resource and
operational event explicitly named by the owner remains a connected business
area, while an unavailable action remains unsupported. This changes neither the
scenario set nor any production validator or business-specific rule.

The next changed subject at
`7284491c42aad26b8fb0e2875add5444b74077ae` resolved the unusual-business
finding 3/3 but passed the combined qualification only 21/24 because every
milk-round correction omitted the minimal inferred recurring-order/item
structure. Deterministic safety again passed 24/24, and the subject was not
rerun. The instruction was clarified once more, generically: explicitly named
concepts are a floor rather than a ceiling, and minimal inferred linking
structures required for quantities, repeated activity and coherent Connections
remain in scope. Failure of that changed subject requires a further product
decision rather than continued prompt iteration.
