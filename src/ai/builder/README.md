# Authenticated Builder orchestration

Milestone 8 Phase 8B is a server-only composition boundary for one
authenticated owner request. It is intentionally not a route, Server Action,
chat history store or owner-facing Builder UI.

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

Only a ready configuration-only plan using the six supported configuration
categories can draft. Clarification, operational, mixed and unsupported
configuration-category plans stop after planning. The existing
`builderConfigurationDraftTaskV1` input schema and semantic output validator
remain the defence-in-depth boundary.

The existing `builderConfigurationProposalService` is called once. It owns
its pre-compiler and post-compiler context reads, the one pure compiler call
and the one ordinary M5 `proposeChangeSet()` call. Therefore the successful
path has four authoritative context loads in total; clarification and
unsupported paths have two.

## Private runtime and accounting

The global production drafting task remains mapped to
`builder_configuration_drafting_disabled_v1`. OpenAI mode creates a private
frozen clone whose only changed property is the qualified
`builder_configuration_drafting_terra_medium_v1` policy key. The clone reuses
the production task key, version, purpose label, instruction, schemas and
semantic validator. The private registry contains only the unchanged planning
task, that clone, the exact qualified policies and the validated configured
provider. Disabled mode preserves the existing disabled behavior.

Planning and drafting use independent execution IDs, reservations, audit rows
and settlements, sequentially. The existing bounded retry policy remains
unchanged, drafting retains its 60-second timeout, and the Builder workflow is
not retried. Raw request/context/plan/draft/provider data remains transient;
durable state is limited to the existing accounting metadata and the ordinary
proposed M5 change. No validation, application, publication, operational
mutation or migration occurs in this phase. Phase 8C is next.
