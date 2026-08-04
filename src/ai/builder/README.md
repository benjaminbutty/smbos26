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
creation. The global/default registration keeps the amendment task disabled.
The private OpenAI runtime maps only its authenticated private clone to the
qualified amendment policy after the reviewed live gates pass.

The existing `builderConfigurationProposalService` is called once for generic
drafts. Preorder amendments use their narrow parallel proposal boundary, which
shares the deterministic manual composer and fixed `Proposed preorder changes`
metadata. Both boundaries perform their own second currentness read and call
the ordinary M5 `proposeChangeSet()` exactly once. Therefore the successful
path has four authoritative context loads in total; clarification and
unsupported paths have two.

## Private runtime and accounting

The global production drafting, preorder-amendment and Location-intent tasks
remain mapped to their disabled policies. OpenAI mode creates private frozen
clones whose only changed property is the qualified policy key: generic
drafting uses `builder_configuration_drafting_terra_medium_v1`, preorder
amendment uses `builder_preorder_amendment_terra_medium_v1`, and Location
intent uses `builder_location_creation_intent_terra_medium_v1`. Each clone
reuses its production task key, version, purpose label, instruction, schemas
and semantic validator. The private registry contains the unchanged planning
task, all three private qualified clones, the corresponding policies and the
validated configured providers. Disabled mode preserves the existing disabled
behavior.

Planning, generic drafting and preorder amendment use independent execution
IDs, reservations, audit rows and settlements, sequentially. The existing
bounded retry policy remains unchanged, drafting retains its 60-second
timeout, and the Builder workflow is not retried. Raw request/context/plan/
draft/amendment/provider data remains transient; durable state is limited to
the existing accounting metadata and the ordinary proposed M5 change. No
validation, application, publication, operational mutation or migration occurs
in this phase. Phase 8C may invoke this service from its authenticated Server
Action, but adds no second proposal or lifecycle authority.

## Phase 9B contextual undo boundary

The Builder UI also has a deterministic contextual mode at
`/app/[businessSlug]/builder?undoVersion=[activeVersionId]`. This mode is not
part of `builderOrchestrationService.run()`, does not construct a task or
provider, and does not reserve or settle AI usage. A server-only configuration
boundary reloads the active head and contextual Version, requires an active
ordinary `change` with a valid immediate parent, verifies any applied source
proposal, and derives the rollback target from `parent_version_id`.

The dedicated action calls the existing `ConfigurationChangeService` rollback
preparation boundary with expected source/head currentness. It creates only a
proposed forward rollback and redirects to Changes; Builder still has no
Validate or Apply action. Baseline, active rollback, historical/superseded,
malformed and cross-Business contexts fail closed. A normal Builder request
matching `Undo that` without this trusted route context returns fixed guidance
and never searches history or invokes a model. Phase 9A's amendment task,
policy, runtime mapping and qualification evidence are unchanged.

## Phase 10A Location creation

The Builder runtime contains exactly four private tasks: planning, generic
configuration drafting, preorder amendment and
`builder_location_creation_intent_v1`. The fourth task remains globally and
default-disabled, while the private authenticated OpenAI runtime maps its
frozen clone to `builder_location_creation_intent_terra_medium_v1` after the
independent Terra qualification and reliability evidence passed. It is not a
configuration-draft substitute and is never given database, identity, digest,
token or mutation inputs.

Only a ready plan with exactly one operational `create_location` step enters
the Location path. The service reads the authoritative Location currentness
state before and after intent generation, then returns a confirmation-required
internal result. It never creates a Location during planning, intent generation
or GET. The Server Action signs the transient confirmation only after the
tenant and capability checks; the final POST verifies the token and calls the
shared Location service once without AI or accounting.

Location creation is ordinary operational data and does not go through M5,
Changes or configuration history. Mixed work, Product/Record work and Location
updates remain bounded unsupported results. No generic operational action
registry or operational undo is present. PostgreSQL owns the single
NFKC/trim/locale-neutral-lower Location identity rule across active and
inactive rows; the intent validator checks exact interpreted names after the
task runs, not owner-request substring matches. Exact IANA timezone text may be
copied from the request, otherwise Business timezone is the default unless
generic local/different-timezone wording requires clarification.
