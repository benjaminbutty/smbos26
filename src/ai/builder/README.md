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

At Phase 10A the Builder runtime contained exactly five private tasks:
planning, generic
configuration drafting, preorder amendment,
`builder_location_creation_intent_v1` and
`builder_record_creation_intent_v1`. The Location and Record tasks remain
globally and
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

## Phase 12A generic Record creation

The fifth task is the frozen `builder_record_creation_intent_v1` task. The
production and default OpenAI runtimes deliberately keep the registered task
disabled; the private authenticated OpenAI Builder runtime uses a frozen clone
whose only changed property is the qualified policy key
`builder_record_creation_intent_terra_medium_v1`. The Terra policy and
evaluation harness remain engineering-only artifacts outside the global
registry.
The task receives the unchanged AI-safe Business context and one validated
ready `create_record` plan. Its strict output is a typed, transient set of
owner-supplied Field values and may return only exact existing Object and Field
keys present in the supplied configuration context. It may not invent new
keys, UUIDs, IDs, defaults, Records, relationships or mutation authority.

The authenticated service allows only one eligible generic Object. It must
exist and be active, have at least one active non-file writable Field, have no
active required incoming Relationship that makes standalone creation
incomplete, not be an active preorder Order or Order Item Object, and have no
required File Field without a usable default. It reads defaults only after
intent validation, returns an explicit Owner/Admin confirmation, and signs a
Business/actor-bound 15-minute token. The final action rechecks the PII-free
schema/state digests and calls the narrow confirmed-create RPC once; the
existing graph trigger applies normal Record validation. The result opens the
existing internal View selected by the server. The final confirmation performs
no AI, accounting, configuration mutation, file upload, relationship creation
or Record update/delete.

The accepted compatibility, qualification and reliability evidence is against
exact head SHA `99988cc7950bb009f290f9f23f84f61dbbef4d0e`: compatibility
completed with 20/20 probes accepted and the exact schema accepted (0 rejected,
exit code 0, 29,976 microusd); qualification passed 8/8 scenarios (8 attempts,
17,265 input tokens, 937 output tokens, 57,220 microusd, exit code 0); and
reliability passed 24/24 executions across 8/8 scenarios with three repetitions
each (24 attempts, 51,795 input tokens, 2,831 output tokens, 171,960
microusd, exit code 0). No failure, error, validation or provider reason codes
were reported. A live rerun is not required unless the frozen subject changes.

At Phase 12A, the private Builder registry contained exactly five tasks and five
policies. Planning precedes intent generation, and only a ready one-step
`create_initial_record` plan reaches this task; unsupported or mixed plans do
not. Final confirmation is deterministic and AI-free, with no provider call,
task/accounting reservation, planning, configuration mutation or provider
version change.

## Phase 12B generic Record update

The global/default registry and disabled private Builder keep
`builder_record_update_intent_v1` mapped to
`builder_record_update_intent_disabled_v1`. The authenticated private OpenAI
Builder uses a frozen task clone mapped to
`builder_record_update_intent_terra_medium_v1`, backed by
`openAiBuilderRecordUpdateIntentPolicy`, model `gpt-5.6-terra` and medium
reasoning. The qualified subject is exact SHA
`30dbab41d4f63a160370287a2411f8fbd254e95a`.

Compatibility, qualification and reliability evidence is recorded in
`evaluations/README.md`. This private enablement does not make the task
globally available or alter Phase 12A's frozen task, policy or evidence.

The update route accepts exactly one operational `update_record` plan. The
intent task sees only the unchanged AI-safe configuration context and returns
one exact selector over a supported scalar Field plus one to three explicit
absolute Field values. It sees no Records, current values or identifiers. The
server asks PostgreSQL to resolve zero, one or multiple active matches; it
returns only a bounded owner-safe state and never exposes candidate rows.
Owner/Admin confirmation shows the actual current values and the proposed
changes for the one target.

The final `recordUpdateConfirmationToken` action performs no AI or accounting
work. It carries only the server-selected target ID, its `updated_at`
currentness and the typed patch, then calls the confirmed generic graph update
boundary once. PostgreSQL rechecks the head, target Object and currentness,
locks the target Record once, and relies on the existing graph validation and
timestamp triggers. The write is operational only: it creates no
configuration Version, Change, history entry or undo state. The server selects
the existing internal View after success.

## Phase 12C generic Record-to-Location availability

Phase 12C adds a bounded operational `link_record_to_location` route for one
active eligible generic Record and one existing Location. The model receives
the same configuration-only Business context as earlier phases and returns
only one exact Object key, one existing Location reference, one exact Record
selector and a link/unlink action. It receives no Record rows, current values,
candidate Records, Record IDs or link rows. PostgreSQL remains the sole
selector and pair-state authority.

The generated Record detail route offers the same deterministic pair service
to Owner/Admin users. Active Locations can be newly linked; inactive existing
links remain visible and are not silently removed. The Builder confirmation is
bound to the authenticated Business and actor and carries only the
server-selected Object/Record/Location identity, expected pair state, safe
destination and timestamps. It signs neither the display name nor a link-row
ID. Final confirmation is AI-free: it revalidates the pair, derives the
current link row for unlink, calls one existing trusted pair operation and
reloads the authoritative Location name. Its result contract has one finite
unavailable reason enum and one success state; it creates no proposal,
configuration Version, Change, history or operational undo.

The new intent task and policy are registered globally/default and in the
private Builder as disabled for this implementation pass. No live Phase 12C
qualification or reliability evidence is claimed. Bulk work, fuzzy matching,
candidate selection, multiple Records or Locations, Record Relationships,
Location lifecycle changes, mixed sequencing, publication, clean-Business
bootstrap, operational undo and Milestone 13 remain out of scope.
