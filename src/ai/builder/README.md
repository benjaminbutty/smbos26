# Authenticated Builder orchestration

Milestone 8 Phase 8B is the server-only composition boundary for one
authenticated owner request. It remains intentionally separate from the
owner-facing surface: Milestone 8 Phase 8C adds the route, Server Action and
ephemeral UI wrapper under `src/app/` and `src/components/`, while this module
continues to own only the trusted orchestration contract.

## Contract

The request is strict and contains only:

```ts
{
  businessId: string;
  ownerRequest: string;
}
```

The Business UUID is validated, the owner request is trimmed and bounded by
the existing 4,000-character planning contract and a 16,384-byte UTF-8 limit.
Actor identity, membership, role, context, model and policy are always derived
or selected on the server.

The result is a frozen strict discriminated value. Clarification wraps the
existing `needs_clarification` planning contract. Unsupported ready plans use
fixed owner-safe reason messages. A proposed result contains only the existing
proposal identity/currentness/count and the bounded draft summary.

## Workflow and currentness

`service.ts` first loads `loadAuthoritativeAiBusinessContext()` through the
ordinary session client. It projects and canonically serializes that source
once, then supplies the same model context to planning and, when eligible, to
drafting. Planning runs once through the existing
`createBusinessAiExecutionOrchestrator()` and the private Builder execution
core. A second authoritative read must match Business ID, actor ID, base
version, head revision and canonical serialized model context exactly.

Only a ready configuration-only plan using the six supported generic
configuration categories can use the additive drafting task. A ready plan
containing only `configure_preorder` and the optional `define_field` category
routes to the separate bounded preorder-amendment task. Clarification,
operational, mixed and unsupported configuration-category plans stop after
planning. The existing
`builderConfigurationDraftTaskV1` input schema and semantic output validator
remain the defence-in-depth boundary.

When more than one active preorder exists, routing proceeds only when the
current request identifies one exact active stable key. Otherwise Builder
returns the existing bounded clarification; unknown, inactive, duplicate and
scope-switched keys fail closed without amendment drafting or proposal
creation. The private OpenAI runtime keeps the amendment task on its disabled
policy until both exact live gates pass.

The existing `builderConfigurationProposalService` is called once for generic
drafts. Preorder amendments use their narrow parallel proposal boundary, which
shares the deterministic manual composer and fixed `Proposed preorder changes`
metadata. Both boundaries perform their own second currentness read and call
the ordinary M5 `proposeChangeSet()` exactly once. Therefore the successful
path has four authoritative context loads in total; clarification and
unsupported paths have two.

## Private runtime and accounting

The global production drafting task remains mapped to
`builder_configuration_drafting_disabled_v1`. OpenAI mode creates a private
frozen clone whose only changed property is the qualified
`builder_configuration_drafting_terra_medium_v1` policy key. The clone reuses
the production task key, version, purpose label, instruction, schemas and
semantic validator. The private registry contains only the unchanged planning
task, that clone, the disabled preorder-amendment task, the corresponding
policies and the validated configured providers. Disabled mode preserves the
existing disabled behavior.

Planning and drafting use independent execution IDs, reservations, audit rows
and settlements, sequentially. The existing bounded retry policy remains
unchanged, drafting retains its 60-second timeout, and the Builder workflow is
not retried. Raw request/context/plan/draft/provider data remains transient;
durable state is limited to the existing accounting metadata and the ordinary
proposed M5 change. No validation, application, publication, operational
mutation or migration occurs in this phase. Phase 8C may invoke this service
from its authenticated Server Action, but adds no second proposal or lifecycle
authority.
