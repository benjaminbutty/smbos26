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
import {
  builderRecordUpdateIntentOutputSchema,
  builderRecordUpdateIntentTaskInputSchema,
} from "../record-update-intent/schemas";
import { builderRecordUpdateIntentTaskV1 } from "../record-update-intent/task";
import {
  builderRecordLocationLinkIntentOutputSchema,
  builderRecordLocationLinkIntentTaskInputSchema,
} from "../record-location-link-intent/schemas";
import { builderRecordLocationLinkIntentTaskV1 } from "../record-location-link-intent/task";
import { composeRecordCreationPresentation } from "../../core/graph/record-creation/composer";
import { type RecordCreationState } from "../../core/graph/record-creation/schemas";
import { createConfirmedRecordCreationService } from "../../core/graph/record-creation/service";
import {
  composeConfirmedGraphRecordUpdate,
  RecordUpdateCompositionError,
} from "../../core/graph/record-update/composer";
import {
  type RecordUpdateReadyState,
  type RecordUpdateSelector,
  type RecordUpdateTargetState,
} from "../../core/graph/record-update/schemas";
import { createConfirmedRecordUpdateService } from "../../core/graph/record-update/service";
import { createLocationService } from "../../core/locations/service";
import { createRecordLocationLinkService } from "../../core/graph/location-links";
import type {
  RecordLocationLinkReadyState,
  RecordLocationLinkTargetState,
} from "../../core/graph/record-location-availability/schemas";
import {
  normalizeLocationName,
  type LocationCreationState,
} from "../../core/locations/schemas";
import { AiBusinessContextError } from "../context/errors";
import type { Database } from "../../db/supabase/database.types";
import {
  BUILDER_ORCHESTRATION_MAX_OWNER_REQUEST_BYTES,
  BUILDER_RECORD_LOCATION_MESSAGES,
  BUILDER_RECORD_UPDATE_MESSAGES,
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
  readRecordUpdateState(
    client: SessionClient,
    context: { businessId: string; actorId: string },
    input: {
      objectKey: string;
      selector: RecordUpdateSelector;
      updateFieldKeys: readonly string[];
    },
  ): Promise<RecordUpdateTargetState>;
  readRecordLocationLinkState(
    client: SessionClient,
    context: { businessId: string; actorId: string },
    input: {
      objectKey: string;
      selector: RecordUpdateSelector;
      locationId: string;
      action: "link" | "unlink";
    },
  ): Promise<RecordLocationLinkTargetState>;
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

function recordUpdateStateMatchesContext(
  state: RecordUpdateReadyState,
  context: AuthoritativeAiBusinessContext,
  objectKey: string,
): boolean {
  return (
    state.business_id === context.executionContext.businessId &&
    state.actor_id === context.executionContext.actorId &&
    state.base_version_id === context.currentness.baseVersionId &&
    state.head_revision === context.currentness.headRevision &&
    state.object_key === objectKey
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

function recordUpdateIntentClarification(
  output: Extract<
    z.infer<typeof builderRecordUpdateIntentOutputSchema>,
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

function recordUpdateTerminalResult(
  state:
    | "record_update_not_found"
    | "record_update_ambiguous"
    | "record_update_ineligible"
    | "record_update_no_change",
  objectLabel: string,
): BuilderOrchestrationResult {
  return builderOrchestrationResultSchema.parse({
    schema_version: 1,
    state,
    object_label: objectLabel,
    message:
      state === "record_update_not_found"
        ? BUILDER_RECORD_UPDATE_MESSAGES.not_found
        : state === "record_update_ambiguous"
          ? BUILDER_RECORD_UPDATE_MESSAGES.ambiguous
          : state === "record_update_ineligible"
            ? BUILDER_RECORD_UPDATE_MESSAGES.ineligible
            : BUILDER_RECORD_UPDATE_MESSAGES.no_change,
  });
}

function recordLocationLinkIntentClarification(
  output: Extract<
    z.infer<typeof builderRecordLocationLinkIntentOutputSchema>,
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

function recordLocationLinkTerminalResult(
  reasonCode:
    | "record_not_found"
    | "record_ambiguous"
    | "record_ineligible"
    | "location_not_found"
    | "location_inactive"
    | "already_linked"
    | "already_unlinked",
  objectLabel: string,
): BuilderOrchestrationResult {
  return builderOrchestrationResultSchema.parse({
    schema_version: 1,
    state: "record_location_unavailable",
    object_label: objectLabel,
    reason_code: reasonCode,
    message: BUILDER_RECORD_LOCATION_MESSAGES[reasonCode],
  });
}

function recordLocationSelectorPresentation(
  context: ReturnType<typeof projectContext>["modelContext"],
  objectKey: string,
  selector: RecordUpdateSelector,
): { label: string; formatted_value: string } {
  const object = context.objects.find(
    (candidate) => candidate.key === objectKey,
  );
  const field = object?.fields.find(
    (candidate) => candidate.key === selector.field_key,
  );
  const formattedValue =
    "string_value" in selector
      ? selector.string_value
      : "option_value" in selector
        ? selector.option_value
        : "number_value" in selector
          ? String(selector.number_value)
          : "boolean_value" in selector
            ? selector.boolean_value
              ? "Yes"
              : "No"
            : "date_value" in selector
              ? selector.date_value
              : selector.datetime_value;
  return {
    label: field?.label ?? selector.field_key,
    formatted_value: formattedValue,
  };
}

function contextRecordUpdateEligibility(
  context: ReturnType<typeof projectContext>["modelContext"],
  objectKey: string,
): { eligible: boolean; objectLabel: string } {
  const object = context.objects.find(
    (candidate) => candidate.key === objectKey,
  );
  if (!object) return { eligible: false, objectLabel: "Record" };
  const excluded = context.preorder_experiences.some(
    (preorder) =>
      preorder.is_active &&
      (preorder.customer_object_key === objectKey ||
        preorder.order_object_key === objectKey ||
        preorder.order_item_object_key === objectKey),
  );
  const hasSelectorField = object.fields.some(
    (field) =>
      field.is_active &&
      [
        "short_text",
        "email",
        "phone",
        "url",
        "number",
        "currency",
        "boolean",
        "date",
        "datetime",
        "select",
        "status",
      ].includes(field.field_type),
  );
  const hasUpdateField = object.fields.some(
    (field) => field.is_active && field.field_type !== "file",
  );
  return {
    eligible:
      object.is_active && !excluded && hasSelectorField && hasUpdateField,
    objectLabel: object.singular_label,
  };
}

function contextRecordLocationEligibility(
  context: ReturnType<typeof projectContext>["modelContext"],
  objectKey: string,
): { eligible: boolean; objectLabel: string } {
  const object = context.objects.find(
    (candidate) => candidate.key === objectKey,
  );
  if (!object) return { eligible: false, objectLabel: "Record" };
  const protectedByPreorder = context.preorder_experiences.some(
    (preorder) =>
      preorder.is_active &&
      (preorder.order_object_key === objectKey ||
        preorder.order_item_object_key === objectKey),
  );
  return {
    eligible: object.is_active && !protectedByPreorder,
    objectLabel: object.singular_label,
  };
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
  | { kind: "record_update"; objectKey: string }
  | { kind: "record_update_ineligible"; objectKey: string; objectLabel: string }
  | {
      kind: "record_location_link";
      objectKey: string;
      locationId: string;
    }
  | {
      kind: "record_location_link_ineligible";
      objectKey: string;
      objectLabel: string;
    }
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
      steps.length === 1 &&
      step?.lane === "operational" &&
      step.category === "link_record_to_location" &&
      existingConcept !== undefined &&
      step.dependencies.length === 0 &&
      step.affected_concepts.length === 1 &&
      step.affected_concepts[0] === existingConcept.reference &&
      step.existing_object_keys.length === 1 &&
      step.existing_object_keys[0] === existingConcept.existing_object_key &&
      step.location_references.length === 1 &&
      step.requires_owner_confirmation &&
      plan.unsupported_requirements.length === 0 &&
      context.locations.some(
        (location) => location.reference === step.location_references[0],
      ) &&
      context.objects.some(
        (object) => object.key === existingConcept.existing_object_key,
      )
    ) {
      const eligibility = contextRecordLocationEligibility(
        context,
        existingConcept.existing_object_key,
      );
      return eligibility.eligible
        ? {
            kind: "record_location_link",
            objectKey: existingConcept.existing_object_key,
            locationId: step.location_references[0]!,
          }
        : {
            kind: "record_location_link_ineligible",
            objectKey: existingConcept.existing_object_key,
            objectLabel: eligibility.objectLabel,
          };
    }
    if (
      steps.length === 1 &&
      step?.lane === "operational" &&
      step.category === "update_record" &&
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
      const eligibility = contextRecordUpdateEligibility(
        context,
        existingConcept.existing_object_key,
      );
      return eligibility.eligible
        ? {
            kind: "record_update",
            objectKey: existingConcept.existing_object_key,
          }
        : {
            kind: "record_update_ineligible",
            objectKey: existingConcept.existing_object_key,
            objectLabel: eligibility.objectLabel,
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
    readRecordUpdateState:
      overrides.readRecordUpdateState ??
      ((client, context, input) =>
        createConfirmedRecordUpdateService(client, context).readState({
          objectKey: input.objectKey,
          selector: input.selector,
          updateFieldKeys: input.updateFieldKeys,
        })),
    readRecordLocationLinkState:
      overrides.readRecordLocationLinkState ??
      ((client, context, input) =>
        createRecordLocationLinkService(client, context).readBuilderState({
          objectKey: input.objectKey,
          selector: input.selector,
          locationId: input.locationId,
          action: input.action,
        })),
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
        if ("kind" in route && route.kind === "record_update_ineligible") {
          return deepFreeze(
            recordUpdateTerminalResult(
              "record_update_ineligible",
              route.objectLabel,
            ),
          );
        }
        if ("kind" in route && route.kind === "record_update") {
          const intentInput = builderRecordUpdateIntentTaskInputSchema.parse({
            schema_version: 1,
            owner_request: request.ownerRequest,
            business_context: afterPlanningProjection.modelContext,
            ready_plan: plan,
          });
          const intentExecution = await orchestrator.execute(
            "builder_record_update_intent_v1",
            intentInput,
          );
          const parsedIntent = builderRecordUpdateIntentOutputSchema.parse(
            intentExecution.output,
          );
          const intent = builderRecordUpdateIntentTaskV1.validateOutput
            ? builderRecordUpdateIntentTaskV1.validateOutput(
                intentInput,
                parsedIntent,
              )
            : parsedIntent;
          if (intent.state === "needs_clarification") {
            return deepFreeze(recordUpdateIntentClarification(intent));
          }

          const targetState = await dependencies.readRecordUpdateState(
            client,
            initial.executionContext,
            {
              objectKey: route.objectKey,
              selector: intent.selector,
              updateFieldKeys: intent.field_updates.map(
                (value) => value.field_key,
              ),
            },
          );
          if (targetState.state === "not_found") {
            return deepFreeze(
              recordUpdateTerminalResult(
                "record_update_not_found",
                targetState.singular_label,
              ),
            );
          }
          if (targetState.state === "ambiguous") {
            return deepFreeze(
              recordUpdateTerminalResult(
                "record_update_ambiguous",
                targetState.singular_label,
              ),
            );
          }
          if (targetState.state === "ineligible") {
            return deepFreeze(
              recordUpdateTerminalResult(
                "record_update_ineligible",
                targetState.singular_label,
              ),
            );
          }
          if (
            !recordUpdateStateMatchesContext(
              targetState,
              afterPlanning,
              route.objectKey,
            )
          ) {
            builderContextStale();
          }
          let composition;
          try {
            composition = composeConfirmedGraphRecordUpdate(
              targetState,
              intent,
            );
          } catch (cause) {
            if (
              cause instanceof RecordUpdateCompositionError &&
              cause.code === "no_change"
            ) {
              return deepFreeze(
                recordUpdateTerminalResult(
                  "record_update_no_change",
                  targetState.singular_label,
                ),
              );
            }
            throw cause;
          }
          return deepFreeze(
            builderOrchestrationResultSchema.parse({
              schema_version: 1,
              state: "record_update_confirmation",
              object_label: composition.object_label,
              selector_presentation: composition.selector,
              change_rows: composition.changes,
              base_version_id: targetState.base_version_id,
              head_revision: targetState.head_revision,
              object_definition_id: targetState.object_definition_id,
              object_key: targetState.object_key,
              target_record_id: targetState.target_record_id,
              expected_updated_at: targetState.expected_updated_at,
              data_patch: composition.data_patch,
              destination_view_key: composition.destination_view_key,
            }),
          );
        }
        if (
          "kind" in route &&
          route.kind === "record_location_link_ineligible"
        ) {
          return deepFreeze(
            recordLocationLinkTerminalResult(
              "record_ineligible",
              route.objectLabel,
            ),
          );
        }
        if ("kind" in route && route.kind === "record_location_link") {
          const intentInput =
            builderRecordLocationLinkIntentTaskInputSchema.parse({
              schema_version: 1,
              owner_request: request.ownerRequest,
              business_context: afterPlanningProjection.modelContext,
              ready_plan: plan,
            });
          const intentExecution = await orchestrator.execute(
            "builder_record_location_link_intent_v1",
            intentInput,
          );
          const parsedIntent =
            builderRecordLocationLinkIntentOutputSchema.parse(
              intentExecution.output,
            );
          const intent = builderRecordLocationLinkIntentTaskV1.validateOutput
            ? builderRecordLocationLinkIntentTaskV1.validateOutput(
                intentInput,
                parsedIntent,
              )
            : parsedIntent;
          if (intent.state === "needs_clarification") {
            return deepFreeze(recordLocationLinkIntentClarification(intent));
          }

          const targetState = await dependencies.readRecordLocationLinkState(
            client,
            initial.executionContext,
            {
              objectKey: route.objectKey,
              selector: intent.selector,
              locationId: intent.location_reference,
              action: intent.action,
            },
          );
          if (targetState.state === "not_found") {
            return deepFreeze(
              recordLocationLinkTerminalResult(
                "record_not_found",
                targetState.singular_label,
              ),
            );
          }
          if (targetState.state === "ambiguous") {
            return deepFreeze(
              recordLocationLinkTerminalResult(
                "record_ambiguous",
                targetState.singular_label,
              ),
            );
          }
          if (targetState.state === "ineligible") {
            return deepFreeze(
              recordLocationLinkTerminalResult(
                "record_ineligible",
                targetState.singular_label,
              ),
            );
          }
          if (targetState.state === "location_not_found") {
            return deepFreeze(
              recordLocationLinkTerminalResult(
                "location_not_found",
                targetState.singular_label,
              ),
            );
          }
          if (targetState.state === "location_inactive") {
            return deepFreeze(
              recordLocationLinkTerminalResult(
                "location_inactive",
                targetState.singular_label,
              ),
            );
          }
          if (targetState.state === "already_linked") {
            return deepFreeze(
              recordLocationLinkTerminalResult(
                "already_linked",
                targetState.singular_label,
              ),
            );
          }
          if (targetState.state === "already_unlinked") {
            return deepFreeze(
              recordLocationLinkTerminalResult(
                "already_unlinked",
                targetState.singular_label,
              ),
            );
          }
          const readyState = targetState as RecordLocationLinkReadyState;
          if (
            readyState.business_id !==
              afterPlanning.executionContext.businessId ||
            readyState.actor_id !== afterPlanning.executionContext.actorId ||
            readyState.object_key !== route.objectKey ||
            readyState.target_location_id !== route.locationId ||
            readyState.action !== intent.action
          ) {
            builderContextStale();
          }
          return deepFreeze(
            builderOrchestrationResultSchema.parse({
              schema_version: 1,
              state: "record_location_confirmation",
              intent_schema_version: 1,
              action: readyState.action,
              object_label: readyState.singular_label,
              location_name: readyState.location_name,
              selector_presentation: recordLocationSelectorPresentation(
                afterPlanningProjection.modelContext,
                readyState.object_key,
                readyState.selector,
              ),
              object_definition_id: readyState.object_definition_id,
              object_key: readyState.object_key,
              target_record_id: readyState.target_record_id,
              target_location_id: readyState.target_location_id,
              expected_pair_state: readyState.expected_pair_state,
              destination_view_key: readyState.destination_view_key,
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
