# Bounded configuration drafting boundary

`builder_configuration_draft_v1` is the Milestone 7 Phase 1A untrusted,
transient configuration-intent boundary. It accepts a validated ready
`builder_plan_v1` result, the bounded owner request and the exact
`AiBusinessModelContextV1`, then returns only additive intent for:

- Objects
- Fields
- Relationships
- Views
- Forms
- Pages

New Objects use local references such as `draft_object_1`, bind to an exact
`concept_N` in the ready plan whose disposition is `new`, and cite exact
`step_N` references from the ready plan. Each new concept can have at most one
draft Object, and every new concept affected by a `define_object` step must be
represented. Existing definitions are addressed only by exact active keys in
the supplied context. The contract does not carry
UUIDs, stable keys for new definitions, positions, defaults, active state,
publication state, slugs, arbitrary JSON configuration or currentness values.

The synchronous validator performs no I/O and imports no database client,
provider, accounting, graph mutation, preorder mutation or configuration
lifecycle service. It verifies configuration-only ready plans, source-step
coverage, concept mapping, exact source-step Object scope, local reference
resolution, active context dependencies, ownership of Field references, typed
View/Form/Page relationships, required create-Form coverage, duplicate intent
and the 128 KiB serialized output limit. An Object or Field target is
authorized only when each cited step explicitly names its existing Object key
or affected concept; View, Form and Relationship targets follow the same rule,
and Page steps must authorize the Objects behind every referenced View/Form
block. No fuzzy or free-text scope comparison is used.

Every structurally optional design value is represented explicitly as `null`
when absent, while empty collections remain `[]`; omitted properties and
unknown properties fail the strict schema. Singular and plural new-Object
labels share one NFKC/case-normalized duplicate namespace.

The task is registered with policy
`builder_configuration_drafting_disabled_v1`, which remains mapped to the
zero-priced disabled provider in both disabled and OpenAI server modes. Phase
1A therefore makes no provider request and persists no request, context, plan
or draft.

This module remains the untrusted drafting boundary and does not create
Milestone 5 operations, proposals, candidates, validation results or
application instructions. Milestone 7 Phase 1B consumes its validated result
in `src/core/configuration/draft-compiler/`, together with a server-supplied
immutable configuration snapshot. That pure compiler derives collision-safe
keys, slugs, positions, complete definitions, defaults and active state, then
emits only strict M5 operations. It does not derive UUIDs or expected-head
metadata; M5 later allocates trusted IDs while materialising a candidate, and a
later orchestration phase supplies authentication, currentness and proposal
metadata.

Public Form/Page intent is design intent only. The current PostgreSQL boundary
and public renderer do not provide generic public Form submission, so a later
reusable public Form capability is required before a complete Corporate
Catering Enquiry acceptance flow exists. Relationship intent likewise defines
metadata only; it does not create operational Record Relationship edges.
