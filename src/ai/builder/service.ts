import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  SupabaseAiAccountingService,
  type AiAccountingStore,
} from "../accounting/service";
import { createBusinessAiExecutionOrchestrator } from "../business-execution";
import {
  projectAiBusinessModelContext,
  serializeAiBusinessModelContext,
} from "../context/projector";
import {
  builderConfigurationDraftTaskInputSchema,
  builderConfigurationDraftTaskV1,
} from "../configuration-drafting/task";
import {
  builderConfigurationDraftOutputSchema,
  type BuilderConfigurationDraftOutput,
} from "../configuration-drafting/schemas";
import {
  builderPreorderAmendmentOutputSchema,
  builderPreorderAmendmentTaskInputBaseSchema,
} from "../preorder-amendment/schemas";
import { builderPreorderAmendmentTaskV1 } from "../preorder-amendment/task";
import { builderConfigurationProposalService } from "../configuration-proposal/service";
import {
  builderConfigurationProposalResultSchema,
  type BuilderConfigurationProposalRequest,
  type BuilderConfigurationProposalResult,
} from "../configuration-proposal/contracts";
import {
  builderPreorderAmendmentProposalResultSchema,
  type BuilderPreorderAmendmentProposalRequest,
  type BuilderPreorderAmendmentProposalResult,
} from "../preorder-amendment/contracts";
import { builderPreorderAmendmentProposalService } from "../preorder-amendment/proposal-service";
import {
  resolvePreorderTarget,
  type PreorderTargetScope,
} from "../preorder-amendment/targeting";
import {
  builderPlanOutputSchema,
  type BuilderPlanOutput,
} from "../planning/schemas";
import {
  builderLocationCreationIntentOutputSchema,
  builderLocationCreationIntentTaskInputSchema,
} from "../location-creation-intent/schemas";
import {
  builderRecordCreationIntentOutputSchema,
  builderRecordCreationIntentTaskInputSchema,
} from "../record-creation-intent/schemas";
import { builderRecordCreationIntentTaskV1 } from "../record-creation-intent/task";
import { composeRecordCreationPresentation } from "../../core/graph/record-creation/composer";
import { type RecordCreationState } from "../../core/graph/record-creation/schemas";
import { createConfirmedRecordCreationService } from "../../core/graph/record-creation/service";
import { createLocationService } from "../../core/locations/service";
import {
  normalizeLocationName,
  type LocationCreationState,
} from "../../core/locations/schemas";
import { AiBusinessContextError } from "../context/errors";
import type { Database } from "../../db/supabase/database.types";
import {
  BUILDER_ORCHESTRATION_MAX_OWNER_REQUEST_BYTES,
  BUILDER_UNSUPPORTED_MESSAGES,
  builderOrchestrationRequestSchema,
  builderOrchestrationResultSchema,
  type BuilderOrchestrationRequest,
  type BuilderOrchestrationResult,
  type BuilderReadyPlanningOutput,
} from "./contracts";
import { AiBuilderError } from "./errors";
import {
  createBuilderAiRuntime,
  createBuilderExecutionCore,
  type BuilderAiRuntime,
  type BuilderExecutionCore,
} from "./runtime";
import type { AuthoritativeAiBusinessContext } from "../../core/configuration/builder-context-source";
import { loadAuthoritativeAiBusinessContext } from "../../core/configuration/builder-context-source";

type SessionClient = SupabaseClient<Database>;

interface BuilderProposalService {
  propose(
    client: SessionClient,
    input: unknown,
  ): Promise<BuilderConfigurationProposalResult>;
}

interface BuilderPreorderAmendmentProposalService {
  propose(
    client: SessionClient,
    input: unknown,
  ): Promise<BuilderPreorderAmendmentProposalResult>;
}

interface BuilderOrchestrationDependencies {
  loadContext(
    client: SessionClient,
    input: { businessId: string },
  ): Promise<AuthoritativeAiBusinessContext>;
  createRuntime(): BuilderAiRuntime;
  createExecution(runtime: BuilderAiRuntime): BuilderExecutionCore;
  createAccounting(
    client: SessionClient,
    context: { businessId: string; actorId: string },
  ): AiAccountingStore;
  proposalService: BuilderProposalService;
  preorderAmendmentProposalService: BuilderPreorderAmendmentProposalService;
  readLocationCreationState(
    client: SessionClient,
    context: { businessId: string; actorId: string },
  ): Promise<LocationCreationState>;
  readRecordCreationState(
    client: SessionClient,
    context: { businessId: string; actorId: string },
    objectKey: string,
  ): Promise<RecordCreationState>;
  generateExecutionId(): string;
}

function parseRequest(input: unknown): BuilderOrchestrationRequest {
  const parsed = builderOrchestrationRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new AiBuilderError("ai_builder_request_invalid", {
      cause: parsed.error,
    });
  }
  const byteLength = new TextEncoder().encode(
    parsed.data.ownerRequest,
  ).byteLength;
  if (byteLength > BUILDER_ORCHESTRATION_MAX_OWNER_REQUEST_BYTES) {
    throw new AiBuilderError("ai_builder_request_invalid");
  }
  return parsed.data;
}

function projectContext(authoritative: AuthoritativeAiBusinessContext) {
  const projection = projectAiBusinessModelContext(authoritative.source);
  return Object.freeze({
    ...projection,
    serialized: serializeAiBusinessModelContext(projection.modelContext),
  });
}

function assertInitialContext(
  context: AuthoritativeAiBusinessContext,
  businessId: string,
): void {
  if (context.executionContext.businessId !== businessId) {
    throw new AiBusinessContextError("ai_context_inconsistent");
  }
}

function contextMatches(
  first: AuthoritativeAiBusinessContext,
  firstSerialized: string,
  second: AuthoritativeAiBusinessContext,
  secondSerialized: string,
): boolean {
  return (
    first.executionContext.businessId === second.executionContext.businessId &&
    first.executionContext.actorId === second.executionContext.actorId &&
    first.currentness.baseVersionId === second.currentness.baseVersionId &&
    first.currentness.headRevision === second.currentness.headRevision &&
    firstSerialized === secondSerialized
  );
}

function builderContextStale(): never {
  throw new AiBuilderError("ai_builder_context_stale");
}

function unsupportedResult(
  reasonCode:
    | "operational_plan_unavailable"
    | "mixed_plan_unavailable"
    | "configuration_category_unavailable",
): BuilderOrchestrationResult {
  return builderOrchestrationResultSchema.parse({
    schema_version: 1,
    state: "unsupported",
    reason_code: reasonCode,
    message: BUILDER_UNSUPPORTED_MESSAGES[reasonCode],
  });
}

function preorderAmbiguityClarification(): BuilderOrchestrationResult {
  return builderOrchestrationResultSchema.parse({
    schema_version: 1,
    state: "needs_clarification",
    clarification: builderPlanOutputSchema.parse({
      schema_version: 1,
      state: "needs_clarification",
      understanding: "The request changes a preorder collection experience.",
      known_requirements: [],
      assumptions: [],
      questions: [
        {
          reference: "question_1",
          question: "Which collection experience should this change?",
          reason:
            "More than one active collection experience is available, so the request needs one clear choice.",
          response_style: "free_text",
        },
      ],
      unsupported_requirements: [],
    }),
  });
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function locationDuplicate(
  state: LocationCreationState,
  locationName: string,
): "active" | "inactive" | null {
  const normalized = normalizeLocationName(locationName);
  const location = state.locations.find(
    (candidate) => candidate.normalized_name === normalized,
  );
  if (!location) {
    return null;
  }
  return location.is_active ? "active" : "inactive";
}

function locationStateMatches(
  first: LocationCreationState,
  second: LocationCreationState,
): boolean {
  return (
    first.schema_version === second.schema_version &&
    first.business_id === second.business_id &&
    first.actor_id === second.actor_id &&
    first.business_timezone === second.business_timezone &&
    first.location_state_digest === second.location_state_digest
  );
}

function recordCreationStateMatches(
  first: RecordCreationState,
  second: RecordCreationState,
): boolean {
  return (
    first.schema_version === second.schema_version &&
    first.business_id === second.business_id &&
    first.actor_id === second.actor_id &&
    first.base_version_id === second.base_version_id &&
    first.head_revision === second.head_revision &&
    first.object_definition_id === second.object_definition_id &&
    first.object_key === second.object_key &&
    first.is_active === second.is_active &&
    first.eligibility.eligible === second.eligibility.eligible &&
    first.eligibility.reason_codes.join(",") ===
      second.eligibility.reason_codes.join(",") &&
    first.object_schema_digest === second.object_schema_digest &&
    first.record_state_digest === second.record_state_digest
  );
}

function recordIntentClarification(
  output: Extract<
    z.infer<typeof builderRecordCreationIntentOutputSchema>,
    { state: "needs_clarification" }
  >,
): BuilderOrchestrationResult {
  return builderOrchestrationResultSchema.parse({
    schema_version: 1,
    state: "needs_clarification",
    clarification: builderPlanOutputSchema.parse({
      schema_version: 1,
      state: "needs_clarification",
      understanding: output.understanding,
      known_requirements: [],
      assumptions: [],
      questions: [
        {
          reference: "question_1",
          question: output.question,
          reason: output.reason,
          response_style: "free_text",
        },
      ],
      unsupported_requirements: [],
    }),
  });
}

function locationIntentClarification(
  output: Extract<
    z.infer<typeof builderLocationCreationIntentOutputSchema>,
    { state: "needs_clarification" }
  >,
): BuilderOrchestrationResult {
  return builderOrchestrationResultSchema.parse({
    schema_version: 1,
    state: "needs_clarification",
    clarification: builderPlanOutputSchema.parse({
      schema_version: 1,
      state: "needs_clarification",
      understanding: output.understanding,
      known_requirements: [],
      assumptions: [],
      questions: [
        {
          reference: "question_1",
          question: output.question,
          reason: output.reason,
          response_style: "free_text",
        },
      ],
      unsupported_requirements: [],
    }),
  });
}

function locationConflictResult(
  locationName: string,
  duplicateKind: "active" | "inactive",
): BuilderOrchestrationResult {
  return builderOrchestrationResultSchema.parse({
    schema_version: 1,
    state: "location_conflict",
    location_name: locationName,
    duplicate_kind: duplicateKind,
  });
}

function classifyReadyPlan(
  plan: BuilderReadyPlanningOutput,
  context: ReturnType<typeof projectContext>["modelContext"],
  ownerRequest: string,
):
  | "configuration_draft"
  | { kind: "preorder_amendment"; scope: PreorderTargetScope }
  | { kind: "location_creation" }
  | { kind: "record_creation"; objectKey: string }
  | BuilderOrchestrationResult {
  const steps = plan.plan.steps;
  const hasOperational = steps.some((step) => step.lane === "operational");
  const hasConfiguration = steps.some((step) => step.lane === "configuration");
  if (hasOperational && hasConfiguration) {
    return unsupportedResult("mixed_plan_unavailable");
  }
  if (hasOperational) {
    const [step] = steps;
    const existingConcept =
      plan.plan.concepts.length === 1 &&
      plan.plan.concepts[0]?.disposition === "existing"
        ? plan.plan.concepts[0]
        : undefined;
    if (
      steps.length === 1 &&
      step?.lane === "operational" &&
      step.category === "create_initial_record" &&
      existingConcept !== undefined &&
      step.dependencies.length === 0 &&
      step.affected_concepts.length === 1 &&
      step.affected_concepts[0] === existingConcept.reference &&
      step.existing_object_keys.length === 1 &&
      step.existing_object_keys[0] === existingConcept.existing_object_key &&
      step.location_references.length === 0 &&
      step.requires_owner_confirmation &&
      plan.unsupported_requirements.length === 0 &&
      context.objects.some(
        (object) => object.key === existingConcept.existing_object_key,
      )
    ) {
      return {
        kind: "record_creation",
        objectKey: existingConcept.existing_object_key,
      };
    }
    if (
      step &&
      steps.length === 1 &&
      step.lane === "operational" &&
      step.category === "create_location"
    ) {
      return { kind: "location_creation" };
    }
    return unsupportedResult("operational_plan_unavailable");
  }

  const preorderCategories = new Set(["configure_preorder", "define_field"]);
  if (steps.some((step) => step.category === "configure_preorder")) {
    if (
      steps.some(
        (step) =>
          step.lane !== "configuration" ||
          !preorderCategories.has(step.category),
      )
    ) {
      return unsupportedResult("configuration_category_unavailable");
    }
    const target = resolvePreorderTarget(context, ownerRequest);
    if (target.state === "ambiguous") {
      return preorderAmbiguityClarification();
    }
    if (target.state === "unknown") {
      return unsupportedResult("configuration_category_unavailable");
    }
    return { kind: "preorder_amendment", scope: target.scope };
  }

  const acceptedCategories = new Set([
    "define_object",
    "define_field",
    "define_relationship",
    "configure_view",
    "configure_form",
    "configure_page",
  ]);
  if (
    steps.some(
      (step) =>
        step.lane !== "configuration" || !acceptedCategories.has(step.category),
    )
  ) {
    return unsupportedResult("configuration_category_unavailable");
  }
  return "configuration_draft";
}

function planningOutput(output: unknown): BuilderPlanOutput {
  return builderPlanOutputSchema.parse(output);
}

function draftOutput(output: unknown): BuilderConfigurationDraftOutput {
  return builderConfigurationDraftOutputSchema.parse(output);
}

export function createBuilderOrchestrationService(
  overrides: Partial<BuilderOrchestrationDependencies> = {},
) {
  const dependencies: BuilderOrchestrationDependencies = {
    loadContext: overrides.loadContext ?? loadAuthoritativeAiBusinessContext,
    createRuntime:
      overrides.createRuntime ??
      (() =>
        createBuilderAiRuntime({
          AI_PROVIDER: process.env.AI_PROVIDER,
          OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        })),
    createExecution: overrides.createExecution ?? createBuilderExecutionCore,
    createAccounting:
      overrides.createAccounting ??
      ((client, context) => new SupabaseAiAccountingService(client, context)),
    proposalService:
      overrides.proposalService ?? builderConfigurationProposalService,
    preorderAmendmentProposalService:
      overrides.preorderAmendmentProposalService ??
      builderPreorderAmendmentProposalService,
    readLocationCreationState:
      overrides.readLocationCreationState ??
      ((client, context) =>
        createLocationService(client, context).readCreationState()),
    readRecordCreationState:
      overrides.readRecordCreationState ??
      ((client, context, objectKey) =>
        createConfirmedRecordCreationService(client, context).readState(
          objectKey,
        )),
    generateExecutionId:
      overrides.generateExecutionId ?? (() => crypto.randomUUID()),
  };

  return Object.freeze({
    async run(
      client: SessionClient,
      input: unknown,
    ): Promise<BuilderOrchestrationResult> {
      const request = parseRequest(input);
      const initial = await dependencies.loadContext(client, {
        businessId: request.businessId,
      });
      assertInitialContext(initial, request.businessId);
      const initialProjection = projectContext(initial);
      const planningInput = {
        schema_version: 1 as const,
        owner_request: request.ownerRequest,
        business_context: initialProjection.modelContext,
      };

      const runtime = dependencies.createRuntime();
      const execution = dependencies.createExecution(runtime);
      const accounting = dependencies.createAccounting(
        client,
        initial.executionContext,
      );
      const orchestrator = createBusinessAiExecutionOrchestrator({
        accounting,
        execution,
        generateExecutionId: dependencies.generateExecutionId,
      });

      const planningExecution = await orchestrator.execute(
        "builder_plan_v1",
        planningInput,
      );
      const plan = planningOutput(planningExecution.output);

      const afterPlanning = await dependencies.loadContext(client, {
        businessId: request.businessId,
      });
      const afterPlanningProjection = projectContext(afterPlanning);
      if (
        !contextMatches(
          initial,
          initialProjection.serialized,
          afterPlanning,
          afterPlanningProjection.serialized,
        )
      ) {
        builderContextStale();
      }

      if (plan.state === "needs_clarification") {
        return deepFreeze(
          builderOrchestrationResultSchema.parse({
            schema_version: 1,
            state: "needs_clarification",
            clarification: plan,
          }),
        );
      }

      const route = classifyReadyPlan(
        plan,
        initialProjection.modelContext,
        request.ownerRequest,
      );
      if (typeof route !== "string") {
        if ("kind" in route && route.kind === "location_creation") {
          const firstLocationState =
            await dependencies.readLocationCreationState(
              client,
              initial.executionContext,
            );
          if (
            firstLocationState.business_id !== request.businessId ||
            firstLocationState.actor_id !== initial.executionContext.actorId ||
            firstLocationState.business_timezone !==
              afterPlanningProjection.modelContext.business.timezone
          ) {
            builderContextStale();
          }

          const intentInput =
            builderLocationCreationIntentTaskInputSchema.parse({
              schema_version: 1,
              owner_request: request.ownerRequest,
              business_context: afterPlanningProjection.modelContext,
              ready_plan: plan,
            });
          const intentExecution = await orchestrator.execute(
            "builder_location_creation_intent_v1",
            intentInput,
          );
          const intent = builderLocationCreationIntentOutputSchema.parse(
            intentExecution.output,
          );
          if (intent.state === "needs_clarification") {
            return deepFreeze(locationIntentClarification(intent));
          }

          const secondLocationState =
            await dependencies.readLocationCreationState(
              client,
              initial.executionContext,
            );
          if (!locationStateMatches(firstLocationState, secondLocationState)) {
            builderContextStale();
          }

          const timezone =
            intent.timezone_intent.kind === "explicit_timezone"
              ? intent.timezone_intent.timezone
              : secondLocationState.business_timezone;
          if (!timezone) {
            builderContextStale();
          }
          const duplicate = locationDuplicate(
            secondLocationState,
            intent.location_name,
          );
          if (duplicate) {
            return deepFreeze(
              locationConflictResult(intent.location_name, duplicate),
            );
          }

          return deepFreeze(
            builderOrchestrationResultSchema.parse({
              schema_version: 1,
              state: "location_confirmation",
              intent_schema_version: 1,
              location_name: intent.location_name,
              timezone,
              timezone_source:
                intent.timezone_intent.kind === "explicit_timezone"
                  ? "explicit_timezone"
                  : "business_timezone",
              business_timezone: secondLocationState.business_timezone,
              location_state_digest: secondLocationState.location_state_digest,
            }),
          );
        }
        if ("kind" in route && route.kind === "record_creation") {
          const firstRecordState = await dependencies.readRecordCreationState(
            client,
            initial.executionContext,
            route.objectKey,
          );
          if (
            firstRecordState.business_id !== request.businessId ||
            firstRecordState.actor_id !== initial.executionContext.actorId ||
            firstRecordState.base_version_id !==
              afterPlanning.currentness.baseVersionId ||
            firstRecordState.head_revision !==
              afterPlanning.currentness.headRevision ||
            firstRecordState.object_key !== route.objectKey
          ) {
            builderContextStale();
          }
          if (
            !firstRecordState.is_active ||
            !firstRecordState.eligibility.eligible
          ) {
            return deepFreeze(
              unsupportedResult("operational_plan_unavailable"),
            );
          }

          const intentInput = builderRecordCreationIntentTaskInputSchema.parse({
            schema_version: 1,
            owner_request: request.ownerRequest,
            business_context: afterPlanningProjection.modelContext,
            ready_plan: plan,
          });
          const intentExecution = await orchestrator.execute(
            "builder_record_creation_intent_v1",
            intentInput,
          );
          const parsedIntent = builderRecordCreationIntentOutputSchema.parse(
            intentExecution.output,
          );
          const intent = builderRecordCreationIntentTaskV1.validateOutput
            ? builderRecordCreationIntentTaskV1.validateOutput(
                intentInput,
                parsedIntent,
              )
            : parsedIntent;
          if (intent.state === "needs_clarification") {
            return deepFreeze(recordIntentClarification(intent));
          }

          const secondRecordState = await dependencies.readRecordCreationState(
            client,
            initial.executionContext,
            route.objectKey,
          );
          if (
            !recordCreationStateMatches(firstRecordState, secondRecordState)
          ) {
            builderContextStale();
          }
          const composition = composeRecordCreationPresentation(
            secondRecordState,
            intent.field_values,
          );
          return deepFreeze(
            builderOrchestrationResultSchema.parse({
              schema_version: 1,
              state: "record_confirmation",
              intent_schema_version: 1,
              object_key: composition.object_key,
              object_label: composition.object_label,
              explicit_fields: composition.explicit_fields,
              default_fields: composition.default_fields,
              field_values: composition.field_values,
              base_version_id: secondRecordState.base_version_id,
              head_revision: secondRecordState.head_revision,
              object_schema_digest: secondRecordState.object_schema_digest,
              record_state_digest: secondRecordState.record_state_digest,
            }),
          );
        }
        if ("kind" in route) {
          const taskInput = builderPreorderAmendmentTaskInputBaseSchema.parse({
            schema_version: 1,
            owner_request: request.ownerRequest,
            business_context: initialProjection.modelContext,
            ready_plan: plan,
            preorder_scope: route.scope,
          });
          const amendmentExecution = await orchestrator.execute(
            "builder_preorder_amendment_v1",
            taskInput,
          );
          const draft = builderPreorderAmendmentOutputSchema.parse(
            amendmentExecution.output,
          );
          const validatedDraft = builderPreorderAmendmentTaskV1.validateOutput
            ? builderPreorderAmendmentTaskV1.validateOutput(taskInput, draft)
            : draft;
          const proposalInput: BuilderPreorderAmendmentProposalRequest = {
            businessId: request.businessId,
            expectedCurrentness: initial.currentness,
            taskInput,
            draft: validatedDraft,
          };
          const proposal = builderPreorderAmendmentProposalResultSchema.parse(
            await dependencies.preorderAmendmentProposalService.propose(
              client,
              proposalInput,
            ),
          );
          return deepFreeze(
            builderOrchestrationResultSchema.parse({
              schema_version: 1,
              state: "proposed",
              proposal_id: proposal.proposal_id,
              status: proposal.status,
              base_version_id: proposal.base_version_id,
              base_head_revision: proposal.base_head_revision,
              operation_count: proposal.operation_count,
              summary: proposal.summary,
            }),
          );
        }
        return deepFreeze(builderOrchestrationResultSchema.parse(route));
      }

      const taskInput = builderConfigurationDraftTaskInputSchema.parse({
        schema_version: 1,
        owner_request: request.ownerRequest,
        business_context: initialProjection.modelContext,
        ready_plan: plan,
      });
      const draftExecution = await orchestrator.execute(
        "builder_configuration_draft_v1",
        taskInput,
      );
      const draft = draftOutput(draftExecution.output);
      const validatedDraft = builderConfigurationDraftTaskV1.validateOutput
        ? builderConfigurationDraftTaskV1.validateOutput(taskInput, draft)
        : draft;

      const proposalInput: BuilderConfigurationProposalRequest = {
        businessId: request.businessId,
        expectedCurrentness: initial.currentness,
        taskInput,
        draft: validatedDraft,
      };
      const proposal = builderConfigurationProposalResultSchema.parse(
        await dependencies.proposalService.propose(client, proposalInput),
      );
      return deepFreeze(
        builderOrchestrationResultSchema.parse({
          schema_version: 1,
          state: "proposed",
          proposal_id: proposal.proposal_id,
          status: proposal.status,
          base_version_id: proposal.base_version_id,
          base_head_revision: proposal.base_head_revision,
          operation_count: proposal.operation_count,
          summary: validatedDraft.summary,
        }),
      );
    },
  });
}

export const builderOrchestrationService = createBuilderOrchestrationService();
