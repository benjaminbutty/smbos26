# Builder planning boundary

`builder_plan_v1` turns one bounded owner request plus the exact Phase 3A
model-facing Business context into either one to five clarification questions
or an owner-readable proposed plan. The registered input, server-owned
instruction, strict output schema, semantic validator and trusted execution
policy are fixed in production.

Planning categories describe possible later configuration or operational work.
They are not tools, Milestone 5 operations or mutation authority. Planning does
not create a proposal, validate, apply, publish, change a Record or Location, or
persist the request or result.

The server-owned instruction treats the owner's explicit request as the scope
boundary and chooses the smallest coherent plan. It excludes adjacent or merely
useful work, keeps Location-only requests operational and concept-free, uses
trusted Object/Location references exactly as supplied, and requires prior-step
dependencies for any explicitly combined entity-plus-configuration request.
Changing an existing capability configures that capability rather than adding
unrelated definitions.

Domain concepts appear only when a plan concerns generic Business concepts.
Platform-only operational plans, such as creating or renaming a Location, keep
the required `concepts` property as an explicit empty array and use empty
`affected_concepts`. Location remains a first-class platform entity; planning
does not invent or imply a generic Location Object. Such a plan is still
descriptive and non-executing. Every ready step also supplies
`existing_object_keys` and `location_references` as required arrays, using
empty arrays when no reference applies.

The authenticated loader derives actor and Business identity for accounting and
keeps both outside task input. Exact configuration currentness also remains
outside model input. After a metered execution, the service reloads and
canonically projects context again; any version, revision or projected-context
change discards the plan as stale. The metadata-only execution audit still
records usage incurred by that discarded execution.

There is an unavoidable race after the final read. Future operation generation
and proposal creation must rebuild context and retain expected-head protection.

Phase 4A enables only an opt-in server-side OpenAI adapter. The task input uses
the URL-minimised context shape; raw configured image/button destinations never
reach the provider. Planning remains in-memory, descriptive and non-executing,
with no route, proposal or mutation surface.

Phase 4B evaluates this production task, instruction, schemas and semantic
validator through the fixed model path. Phase 4B.1 adds finite internal
diagnostics: structural contract failures are `output_contract_invalid`,
semantic validator failures use one code-owned diagnostic, and unclassified
invalid output is `unknown_output_invalid`. The engineering-only harness
supplies one deterministic strict synthetic Business context and eight fixed
owner requests through the provider-neutral execution core. Deterministic hard
gates check result state, configuration/operational lanes, categories,
unsupported-capability honesty, reference validation and compound
Location/preorder ordering.

The evaluator receives only an already strict and semantically validated plan
plus bounded execution metadata. Its report excludes owner requests, model
prose, context, labels and references. The live harness is not imported by the
application and does not persist output or invoke any configuration or
operational service. Diagnostic stage/reason metadata is emitted only for
`ai_output_invalid`; public errors and metadata-only accounting remain the
existing bounded contracts. Operation generation remains blocked until the
explicit live gate succeeds and is reviewed.

Phase 4B.2 aligns the server-owned instruction with the existing assumption
invariant. An assumption is an owner-unknown fact not already established by
Business context; an explicit owner request and its direct requested effect are
not assumptions; unnecessary assumptions are omitted; and every high-impact
assumption in a ready plan must require owner confirmation. The deterministic
validator still rejects `impact: "high"` with
`requires_owner_confirmation: false`, accepts the confirmed form, and never
converts this semantic failure into a retry. The second live run had seven of
eight scenarios pass, with the remaining
`high_impact_assumption_unconfirmed` diagnostic on the preorder schedule
scenario. Public errors and accounting remain metadata-only and contain no
diagnostic or assumption content.

Phase 4C freezes that approved instruction, input/output schemas, semantic
validator, diagnostics, synthetic context, owner requests and evaluator gates.
The `builder_plan_v1` task keeps version 1 because this structured contract is
unchanged, while its code-owned policy identity is now
`builder_planning_terra_medium_v1` to record the material Terra-medium
execution profile. The supplied reviewed redacted live evidence passes
qualification 8/8 and reliability 24/24 (every scenario 3/3), clearing the
planning gate for this frozen profile. This is bounded engineering evidence,
not universal model perfection; deterministic schemas, semantic validation and
scenario gates remain authoritative and the model has no mutation authority.
Operation generation, proposal creation, validation/application automation and
publication remain unimplemented and outside this milestone. A future
milestone may begin bounded change drafting only with exact-head protection and
the separate configuration/operational lanes. Any material model-alias,
prompt, schema, validator, context or provider-transport change invalidates
the evidence and requires both gates to be rerun.
