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

New definitions use local references such as `draft_object_1` and cite exact
`step_N` references from the ready plan. Existing definitions are addressed
only by exact active keys in the supplied context. The contract does not carry
UUIDs, stable keys for new definitions, positions, defaults, active state,
publication state, slugs, arbitrary JSON configuration or currentness values.

The synchronous validator performs no I/O and imports no database client,
provider, accounting, graph mutation, preorder mutation or configuration
lifecycle service. It verifies configuration-only ready plans, source-step
coverage, local reference resolution, active context dependencies, ownership
of Field references, typed View/Form/Page relationships, required create-Form
coverage, duplicate intent and the 128 KiB serialized output limit.

The task is registered with policy
`builder_configuration_drafting_disabled_v1`, which remains mapped to the
zero-priced disabled provider in both disabled and OpenAI server modes. Phase
1A therefore makes no provider request and persists no request, context, plan
or draft.

This module is not a compiler and does not create Milestone 5 operations,
proposals, candidates, validation results or application instructions. A later
trusted server compiler must derive collision-safe keys, IDs, positions,
complete definitions, operations, defaults, active/publication state and exact
expected-head metadata before anything can enter the existing M5 lifecycle.

Public Form/Page intent is design intent only. The current PostgreSQL boundary
and public renderer do not provide generic public Form submission, so a later
reusable public Form capability is required before a complete Corporate
Catering Enquiry acceptance flow exists. Relationship intent likewise defines
metadata only; it does not create operational Record Relationship edges.
