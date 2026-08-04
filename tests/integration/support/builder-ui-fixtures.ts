import {
  StructuredAiProviderError,
  type StructuredAiProvider,
  type StructuredAiProviderRequest,
} from "../../../src/ai/contracts";
import {
  createBuilderAiRuntime,
  createBuilderExecutionCore,
  type BuilderAiRuntime,
  type BuilderTaskKey,
} from "../../../src/ai/builder/runtime";
import { createBuilderOrchestrationService } from "../../../src/ai/builder/service";
import {
  builderConfigurationDraftOutputSchema,
  type BuilderConfigurationDraftOutput,
} from "../../../src/ai/configuration-drafting/schemas";
import {
  builderPlanOutputSchema,
  type BuilderPlanOutput,
} from "../../../src/ai/planning/schemas";
import {
  builderPreorderAmendmentOutputSchema,
  type BuilderPreorderAmendmentOutput,
} from "../../../src/ai/preorder-amendment/schemas";
import { builderPreorderAmendmentTaskV1 } from "../../../src/ai/preorder-amendment/task";
import {
  builderLocationCreationIntentOutputSchema,
  type BuilderLocationCreationIntentOutput,
} from "../../../src/ai/location-creation-intent/schemas";
import { builderLocationCreationIntentTaskV1 } from "../../../src/ai/location-creation-intent/task";
import {
  BUILDER_LOCATION_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
  BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY,
  openAiBuilderLocationCreationPolicy,
  openAiBuilderPreorderAmendmentPolicy,
} from "../../../src/ai/policies";

export function smallClarificationOutput(): Extract<
  BuilderPlanOutput,
  { state: "needs_clarification" }
> {
  return builderPlanOutputSchema.parse({
    schema_version: 1,
    state: "needs_clarification",
    understanding: "A bounded clarification is needed.",
    known_requirements: ["The owner wants a new information type."],
    assumptions: [
      {
        reference: "assumption_1",
        statement: "The information type will be used by staff.",
        impact: "low",
        requires_owner_confirmation: false,
      },
    ],
    questions: [
      {
        reference: "question_1",
        question: "Which details should the information type collect?",
        reason: "This determines the fields in the prepared configuration.",
        response_style: "free_text",
      },
    ],
    unsupported_requirements: [
      {
        reference: "unsupported_1",
        requirement: "Run an external workflow.",
        reason_code: "external_integration_required",
        explanation: "External integrations are not part of this phase.",
      },
    ],
  }) as Extract<BuilderPlanOutput, { state: "needs_clarification" }>;
}

function configurationStep(
  reference: string,
  sequence: number,
  category: "define_object" | "configure_view" = "define_object",
) {
  return {
    reference,
    sequence,
    summary: "Prepare the bounded owner-reviewed configuration.",
    dependencies: [],
    affected_concepts: category === "define_object" ? ["concept_1"] : [],
    existing_object_keys: [],
    location_references: [],
    materiality: "low" as const,
    requires_owner_confirmation: true as const,
    lane: "configuration" as const,
    category,
  };
}

function operationalStep(
  reference: string,
  sequence: number,
  category: "create_location" | "update_location" = "create_location",
) {
  return {
    reference,
    sequence,
    summary: "Prepare the requested operational change.",
    dependencies: [],
    affected_concepts: [],
    existing_object_keys: [],
    location_references: [],
    materiality: "low" as const,
    requires_owner_confirmation: true as const,
    lane: "operational" as const,
    category,
  };
}

export function locationIntentOutput(
  locationName = "Cambridge",
): BuilderLocationCreationIntentOutput {
  return builderLocationCreationIntentOutputSchema.parse({
    schema_version: 1,
    state: "ready",
    summary: `Add ${locationName} as one new Location.`,
    location_name: locationName,
    timezone_intent: { kind: "use_business_timezone" },
    source_step_references: ["step_1"],
  });
}

export function smallReadyPlan(
  kind:
    | "configuration"
    | "operational"
    | "operational_update"
    | "mixed" = "configuration",
): Extract<BuilderPlanOutput, { state: "ready" }> {
  const steps =
    kind === "configuration"
      ? [configurationStep("step_1", 1)]
      : kind === "operational"
        ? [operationalStep("step_1", 1)]
        : kind === "operational_update"
          ? [operationalStep("step_1", 1, "update_location")]
          : [configurationStep("step_1", 1), operationalStep("step_2", 2)];
  const parsed = builderPlanOutputSchema.parse({
    schema_version: 1,
    state: "ready",
    understanding: "The owner wants a bounded setup change.",
    assumptions: [],
    plan: {
      outcome: "The Business can review the proposed setup.",
      concepts:
        kind === "operational" || kind === "operational_update"
          ? []
          : [
              {
                reference: "concept_1",
                label: "Equipment",
                disposition: "new",
                purpose: "Capture an equipment item.",
              },
            ],
      user_journeys: [],
      steps,
    },
    unsupported_requirements: [],
  });
  if (parsed.state !== "ready") {
    throw new Error("Expected a ready Builder plan.");
  }
  return parsed;
}

export function smallDraft(): BuilderConfigurationDraftOutput {
  return builderConfigurationDraftOutputSchema.parse({
    schema_version: 1,
    summary: "A small additive object proposal is ready for review.",
    objects: [
      {
        reference: "draft_object_1",
        concept_reference: "concept_1",
        source_step_references: ["step_1"],
        singular_label: "Equipment",
        plural_label: "Equipment",
        description: "A generic equipment item.",
      },
    ],
    fields: [],
    relationships: [],
    views: [],
    forms: [],
    pages: [],
  });
}

export function preorderReadyPlan(): Extract<
  BuilderPlanOutput,
  { state: "ready" }
> {
  const parsed = builderPlanOutputSchema.parse({
    schema_version: 1,
    state: "ready",
    understanding: "The owner wants a bounded preorder amendment.",
    assumptions: [],
    plan: {
      outcome: "The owner can review the proposed preorder changes.",
      concepts: [],
      user_journeys: [],
      steps: [
        {
          reference: "step_1",
          sequence: 1,
          summary: "Update the existing preorder collection settings.",
          dependencies: [],
          affected_concepts: [],
          existing_object_keys: ["order"],
          location_references: [],
          materiality: "low",
          requires_owner_confirmation: true,
          lane: "configuration",
          category: "configure_preorder",
        },
      ],
    },
    unsupported_requirements: [],
  });
  if (parsed.state !== "ready") {
    throw new Error("Expected a ready preorder plan.");
  }
  return parsed;
}

export function preorderAmendmentDraft(): BuilderPreorderAmendmentOutput {
  return builderPreorderAmendmentOutputSchema.parse({
    schema_version: 1,
    summary: "Remove Sunday collection and move the cutoff to 72 hours.",
    preorder_key: "bakery_preorder",
    amendments: [
      {
        type: "set_collection_days",
        days_of_week: [6],
        source_step_references: ["step_1"],
      },
      {
        type: "set_cutoff_hours",
        cutoff_hours: 72,
        source_step_references: ["step_1"],
      },
    ],
  });
}

export function preorderAmendmentDraftForRequest(
  request: string,
): BuilderPreorderAmendmentOutput {
  const source = { source_step_references: ["step_1"] };
  switch (request) {
    case "Make phone optional.":
      return preorderAmendmentDraft();
    case "Add an optional Occasion question.":
      return builderPreorderAmendmentOutputSchema.parse({
        schema_version: 1,
        summary: "Add an optional Occasion question.",
        preorder_key: "bakery_preorder",
        amendments: [
          {
            ...source,
            type: "add_preorder_question",
            label: "Occasion",
            help_text: null,
            required: false,
            answer_style: "short_answer",
          },
        ],
      });
    case "Remove Sunday collection.":
      return builderPreorderAmendmentOutputSchema.parse({
        schema_version: 1,
        summary: "Remove Sunday collection.",
        preorder_key: "bakery_preorder",
        amendments: [
          { ...source, type: "set_collection_days", days_of_week: [6] },
        ],
      });
    case "Change the cutoff from 48 to 72 hours.":
      return builderPreorderAmendmentOutputSchema.parse({
        schema_version: 1,
        summary: "Change the cutoff from 48 to 72 hours.",
        preorder_key: "bakery_preorder",
        amendments: [{ ...source, type: "set_cutoff_hours", cutoff_hours: 72 }],
      });
    case "Remove Sunday collection and require 72 hours’ notice.":
      return builderPreorderAmendmentOutputSchema.parse({
        schema_version: 1,
        summary: "Remove Sunday collection and require 72 hours' notice.",
        preorder_key: "bakery_preorder",
        amendments: [
          { ...source, type: "set_collection_days", days_of_week: [6] },
          { ...source, type: "set_cutoff_hours", cutoff_hours: 72 },
        ],
      });
    case "Make phone optional and add an optional Occasion question.":
      return builderPreorderAmendmentOutputSchema.parse({
        schema_version: 1,
        summary: "Make Phone optional and add an optional Occasion question.",
        preorder_key: "bakery_preorder",
        amendments: [
          {
            ...source,
            type: "set_existing_question_requiredness",
            target: "customer",
            field_key: "phone",
            required: false,
          },
          {
            ...source,
            type: "add_preorder_question",
            label: "Occasion",
            help_text: null,
            required: false,
            answer_style: "short_answer",
          },
        ],
      });
    default:
      throw new Error(`No deterministic preorder output for: ${request}`);
  }
}

export interface DeterministicBuilderOptions {
  failure?: {
    taskKey?: BuilderTaskKey;
    error: StructuredAiProviderError;
  };
  amendmentOutput?:
    | BuilderPreorderAmendmentOutput
    | ((input: unknown) => BuilderPreorderAmendmentOutput);
  locationIntentOutput?:
    | BuilderLocationCreationIntentOutput
    | ((input: unknown) => BuilderLocationCreationIntentOutput);
}

export function createDeterministicBuilder(
  planningOutput: BuilderPlanOutput,
  draftOutput: BuilderConfigurationDraftOutput = smallDraft(),
  options: DeterministicBuilderOptions = {},
) {
  const calls: StructuredAiProviderRequest[] = [];
  const provider: StructuredAiProvider = {
    key: "openai",
    async generateStructured(request) {
      calls.push(request);
      if (
        options.failure &&
        (!options.failure.taskKey ||
          options.failure.taskKey === request.outputContract.name)
      ) {
        throw options.failure.error;
      }
      return {
        output:
          request.outputContract.name === "builder_plan_v1"
            ? planningOutput
            : request.outputContract.name === "builder_preorder_amendment_v1"
              ? typeof options.amendmentOutput === "function"
                ? options.amendmentOutput(request.input)
                : (options.amendmentOutput ?? draftOutput)
              : request.outputContract.name ===
                  "builder_location_creation_intent_v1"
                ? typeof options.locationIntentOutput === "function"
                  ? options.locationIntentOutput(request.input)
                  : (options.locationIntentOutput ?? locationIntentOutput())
                : draftOutput,
        usage: { inputTokens: 120, outputTokens: 40 },
        requestMetadata: {
          provider_transient_marker: "BUILDER_PROVIDER_MARKER",
        },
      };
    },
  };
  const runtime = createBuilderAiRuntime(
    { AI_PROVIDER: "openai", OPENAI_API_KEY: "test-only" },
    { createOpenAiProvider: () => provider },
  );
  const deterministicRuntime: BuilderAiRuntime = {
    mode: runtime.mode,
    tasks: Object.freeze({
      ...runtime.tasks,
      builder_preorder_amendment_v1: Object.freeze({
        ...builderPreorderAmendmentTaskV1,
        policyKey: BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY,
      }),
      builder_location_creation_intent_v1: Object.freeze({
        ...builderLocationCreationIntentTaskV1,
        policyKey: BUILDER_LOCATION_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
      }),
    }),
    policies: Object.freeze({
      ...runtime.policies,
      [BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY]:
        openAiBuilderPreorderAmendmentPolicy,
      [BUILDER_LOCATION_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY]:
        openAiBuilderLocationCreationPolicy,
    }),
    providers: runtime.providers,
  };
  return {
    calls,
    provider,
    service: createBuilderOrchestrationService({
      createRuntime: () => deterministicRuntime,
      createExecution: createBuilderExecutionCore,
    }),
  };
}

export function providerUnavailableError(): StructuredAiProviderError {
  return new StructuredAiProviderError(
    "unavailable",
    "deterministic provider unavailable",
  );
}
