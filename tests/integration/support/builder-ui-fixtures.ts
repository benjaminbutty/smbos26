import {
  StructuredAiProviderError,
  type StructuredAiProvider,
  type StructuredAiProviderRequest,
} from "../../../src/ai/contracts";
import {
  createBuilderAiRuntime,
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

function operationalStep(reference: string, sequence: number) {
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
    category: "create_location" as const,
  };
}

export function smallReadyPlan(
  kind: "configuration" | "operational" | "mixed" = "configuration",
): Extract<BuilderPlanOutput, { state: "ready" }> {
  const steps =
    kind === "configuration"
      ? [configurationStep("step_1", 1)]
      : kind === "operational"
        ? [operationalStep("step_1", 1)]
        : [configurationStep("step_1", 1), operationalStep("step_2", 2)];
  const parsed = builderPlanOutputSchema.parse({
    schema_version: 1,
    state: "ready",
    understanding: "The owner wants a bounded setup change.",
    assumptions: [],
    plan: {
      outcome: "The Business can review the proposed setup.",
      concepts:
        kind === "operational"
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

export interface DeterministicBuilderOptions {
  failure?: {
    taskKey?: BuilderTaskKey;
    error: StructuredAiProviderError;
  };
  amendmentOutput?: BuilderPreorderAmendmentOutput;
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
              ? (options.amendmentOutput ?? draftOutput)
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
  return {
    calls,
    provider,
    service: createBuilderOrchestrationService({
      createRuntime: () => runtime,
    }),
  };
}

export function providerUnavailableError(): StructuredAiProviderError {
  return new StructuredAiProviderError(
    "unavailable",
    "deterministic provider unavailable",
  );
}
