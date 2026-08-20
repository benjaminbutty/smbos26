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
the dedicated `acquisition_required_identity_correction_v1` subject and its
separate `acquisition_required_identity_correction_v1` policy identity. It receives the
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
cannot recurse. Each execution uses the selected one-attempt policy with one provider
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
preserve scope and use Connections for connected identity. The provider policy
boundary now carries closed server-owned model, reasoning-effort and service-tier
fields; unrelated Terra-medium Builder policies retain their effective profile.
This material orchestration change invalidates prior live
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

The final changed subject at
`babf8855044905e1670b3848e4911ec9b554ea95` improved to 23/24 combined passes
while deterministic safety remained 24/24. Its one miss was `milk_round`,
repetition 1, with `required_concepts` and the missing Product-to-Item
one-to-many relationship. The subject was not rerun. Under the accepted stop
condition, the full acquisition qualification, reliability, 96-execution corpus
and exact-head CI were not started. The subsequent candidate-profile evaluation
also stopped at the correction gate: Luna Max Standard reached 2/24 hard passes
with 22 timeouts; Luna Max Fast reached 2/24 with 22 provider-incomplete
responses while its two successes reported effective `priority`; and Sol Medium
reached 20/24 with three repeated `quality_cross_object_field_leakage` results
and one timeout. No candidate cleared 24/24, so further work is
**PRODUCT DECISION REQUIRED**. This branch adds no third execution, validator
or requiredness change, required-Connection semantics, prompt tuning or
timeout/output-bound change.

J1-R4a then characterised Luna Max Fast and Sol Medium once each with the
unchanged correction workload and a temporary 45-second diagnostic ceiling.
All 48 calls returned the finite `provider_transport_rate_limited` failure;
none reached a provider completion, timeout, effective tier, token usage or
cost sample. Luna's rate-limit response times were
`455/565/906/1,638/1,969/720 ms` (min/median/p90/p95/max/average), and Sol's
were `448/579/815/921/1,025/610 ms`. These are operational failure-response
times, not model-latency evidence. Successful latency statistics and an
evidence-based timeout are unavailable, so production timeout and all
qualification gates remain unchanged. The diagnostic subjects were not
rerun in the rate-limited run.

## J1-R4a quota-cleared rerun and correction qualification

The provider allowance was restored, so the invalidated rate-limit diagnostic
was rerun once per candidate at `dc3ff31b96007417f52d4a8b8ae87a0753f41cd3`.
The same eight scenarios, three repetitions, tasks, instructions, schemas,
validators, 2,500-token output cap and temporary 45-second ceiling were used.

Luna Max Fast verified effective `priority` on 24/24 requests, but only 1/24
responses completed; 23 were `provider_incomplete`. Its one successful latency
was 21,124 ms, giving the mechanical 30-second recommendation, but it is not
completion-viable. It used 31,683 input and 59,747 output tokens and cost
78,042 microusd.

Sol Medium completed 24/24 at effective `default`. Its latency was
min/median/p90/p95/max `4,002/14,308/19,690/20,704/26,733 ms`, average 14,203
ms, giving the evidence-based 35-second recommendation. It used 31,683 input
and 25,768 output tokens and cost 931,455 microusd. Two diagnostic executions
on `unusual_other` showed `quality_cross_object_field_leakage`.

The provisional Sol correction-timeout subject was frozen at
`f0dd3a82c652cbf092d1a382abdd26ac9ffa1182`; only the correction policy moved
to 35 seconds, while initial planning remains 25 seconds. Its one correction
qualification ran all 24 provider executions with effective `default` and no
timeouts, but passed only 21/24 hard executions. All three `unusual_other`
repetitions repeated `quality_cross_object_field_leakage`, so the gate failed.
The 8/8 acquisition gate, 24/24 reliability gate and 96-case corpus were not
run. Further work is **PRODUCT DECISION REQUIRED**.

## J1-R5 structured acquisition guardrails and scoped correction

J1-R5 replaces the previous complete-correction replan with a sanitised,
server-owned repair manifest. The owner request and initial acquisition task
remain unchanged. A separate Lenni planning contract now requires explicit
reusable concepts to be preserved, connected identity to stay on its owning
business area, reusable concepts to use Connections, varying transaction
quantity to use an item/line structure, unsupported actions to remain
unsupported, and the smallest coherent workspace to be returned. The contract
is not owner text.

Only the exact `cross_object_field_leakage` plus `required_field` refusal can
construct a correction manifest. It is derived from the composed candidate and
contains bounded business-area, Connection/cardinality, unsupported-requirement
and affected-Field metadata plus finite server-owned reason codes. It excludes
the owner request, rejected model output/reasoning, operational data,
credentials and unrestricted configuration. The dedicated correction model
returns only existing Field references to remove. The deterministic server
locks business areas, Connections/cardinality, unsupported requirements, owner
scope, richer Fields and requiredness; applies only an allow-listed Field-layer
repair; and runs the complete authoritative validator and capability pipeline.
Invalid output remains a truthful fallback. The two-execution maximum and one
owner-facing reservation are unchanged.

The new correction subject is Luna xhigh/Fast with an 8,192 output cap and
45-second timeout. Its one correction qualification ran 24 executions (eight
scenarios × three repetitions): 24/24 provider complete, 24/24 hard-valid,
24/24 quality-valid, no timeout/provider failure, and effective `priority` on
24/24. Latency min/median/p90/p95/max/average was
`1,074/1,314/1,951/2,214/2,247/1,429 ms`; usage was 15,390 input and 2,413
output tokens at 5,991 microusd. The initial planner remains Sol Medium/auto;
this correction qualification does not claim the later acquisition gates.

## J1-R5 frozen hard gates and product corpus

The exact frozen implementation after deterministic verification is
`4ee7fdd88023b0cc4b303bae036ada72be8e5043`. Acquisition qualification passed
8/8 hard and reliability passed 24/24 hard. One qualification and two
reliability submissions used the exact trigger; all three Luna xhigh/Fast
corrections completed with effective `priority`. The correction rate was 1/8
and 2/24 respectively. Non-hard quality results are retained separately:
7/8 qualification and 20/24 reliability quality passes.

The required 96-case product corpus ran once with its existing acceptance
thresholds (≥94 final tailored, ≤2 fallback, zero execution failures). It
produced:

| outcome | count |
| --- | ---: |
| raw first-pass tailored | 58 |
| pre-composition canonicalised tailored | 2 |
| post-composition recovered tailored | 0 |
| scoped correction-plan tailored | 18 |
| final tailored | 78 |
| fallback | 18 |
| execution failure | 0 |

All 18 correction plans were valid and used Luna effective `priority`. The 18
fallbacks were initial Sol Medium calls that hit the unchanged 25-second
provider timeout. Total usage was 106,728 input and 121,935 output tokens at
4,028,851 microusd (Sol initial 4,022,050; Luna correction 6,801). Initial
latency min/median/p90/p95/max/average was
`9,966/19,761/24,137/24,734/30,330/19,783 ms`; correction latency was
`1,244/1,549/3,887/6,569/6,569/2,062 ms`. Effective tiers were default 78
and priority 18.

The product corpus therefore failed its unchanged threshold (78/96 tailored,
18/96 fallback). This is an initial Sol timeout/profile issue, not a scoped
repair, requiredness or validator failure. No timeout, prompt, model, schema,
validator, third-call or corpus rerun is being introduced. The hard gates and
trust boundaries remain intact, but the acquisition profile cannot be called
fully qualified; resolving the initial-path reliability/cost trade-off is
**PRODUCT DECISION REQUIRED**.
