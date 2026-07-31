import type { StructuredAiProviderRequest } from "../../src/ai/contracts";
import { createAiExecutionService } from "../../src/ai/execution";
import { builderEvaluationScenarios } from "../../src/ai/evaluation/scenarios";
import {
  BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY,
  openAiBuilderPlanningPolicy,
} from "../../src/ai/policies";
import {
  builderPlanOutputSchema,
  builderPlanTaskInputSchema,
  type BuilderPlanOutput,
  type BuilderReadyPlanStep,
} from "../../src/ai/planning/schemas";
import { builderPlanTaskV1 } from "../../src/ai/planning/task";
import type { BuilderEvaluationScenarioId } from "../../src/ai/evaluation/schemas";

export function builderEvaluationStep(
  reference: string,
  sequence: number,
  lane: "configuration" | "operational",
  category: BuilderReadyPlanStep["category"],
  overrides: Partial<BuilderReadyPlanStep> = {},
): BuilderReadyPlanStep {
  return {
    reference,
    sequence,
    lane,
    category,
    summary: `Synthetic summary ${sequence}.`,
    dependencies: [],
    affected_concepts: [],
    existing_object_keys: [],
    location_references: [],
    materiality: "medium",
    requires_owner_confirmation: true,
    ...overrides,
  } as BuilderReadyPlanStep;
}

export function readyBuilderEvaluationOutput(
  steps: BuilderReadyPlanStep[],
  concepts: Extract<
    BuilderPlanOutput,
    { state: "ready" }
  >["plan"]["concepts"] = [],
): Extract<BuilderPlanOutput, { state: "ready" }> {
  return builderPlanOutputSchema.parse({
    schema_version: 1,
    state: "ready",
    understanding: "Synthetic understanding marker.",
    assumptions: [],
    plan: {
      outcome: "Synthetic outcome marker.",
      concepts,
      user_journeys: [],
      steps,
    },
    unsupported_requirements: [],
  }) as Extract<BuilderPlanOutput, { state: "ready" }>;
}

export function clarificationBuilderEvaluationOutput(
  reasonCode?:
    | "workflow_unavailable"
    | "rule_engine_unavailable"
    | "external_integration_required"
    | "payment_capability_unavailable",
): Extract<BuilderPlanOutput, { state: "needs_clarification" }> {
  return builderPlanOutputSchema.parse({
    schema_version: 1,
    state: "needs_clarification",
    understanding: "Synthetic clarification understanding marker.",
    known_requirements: [],
    assumptions: [],
    questions: [
      {
        reference: "question_1",
        question: "Synthetic question marker?",
        reason: "Synthetic question reason marker.",
        response_style: "free_text",
      },
    ],
    unsupported_requirements: reasonCode
      ? [
          {
            reference: "unsupported_1",
            requirement: "Synthetic unsupported requirement marker.",
            reason_code: reasonCode,
            explanation: "Synthetic unsupported explanation marker.",
          },
        ]
      : [],
  }) as Extract<BuilderPlanOutput, { state: "needs_clarification" }>;
}

export const compliantBuilderEvaluationOutputs: Readonly<
  Record<BuilderEvaluationScenarioId, BuilderPlanOutput>
> = Object.freeze({
  preorder_phone_optional: readyBuilderEvaluationOutput([
    builderEvaluationStep("step_1", 1, "configuration", "configure_preorder", {
      existing_object_keys: ["customer", "order"],
    }),
  ]),
  preorder_schedule_change: readyBuilderEvaluationOutput([
    builderEvaluationStep("step_1", 1, "configuration", "configure_preorder", {
      existing_object_keys: ["order"],
    }),
  ]),
  corporate_catering_enquiries: readyBuilderEvaluationOutput(
    [
      builderEvaluationStep("step_1", 1, "configuration", "define_object", {
        affected_concepts: ["concept_1"],
      }),
      builderEvaluationStep("step_2", 2, "configuration", "define_field", {
        dependencies: ["step_1"],
        affected_concepts: ["concept_1"],
      }),
      builderEvaluationStep("step_3", 3, "configuration", "configure_form", {
        dependencies: ["step_2"],
        affected_concepts: ["concept_1"],
      }),
      builderEvaluationStep("step_4", 4, "configuration", "configure_view", {
        dependencies: ["step_2"],
        affected_concepts: ["concept_1"],
      }),
      builderEvaluationStep("step_5", 5, "configuration", "configure_page", {
        dependencies: ["step_3"],
        affected_concepts: ["concept_1"],
      }),
    ],
    [
      {
        reference: "concept_1",
        label: "Synthetic Catering Enquiry",
        disposition: "new",
        purpose: "Synthetic concept purpose marker.",
      },
    ],
  ),
  create_cambridge_location: readyBuilderEvaluationOutput([
    builderEvaluationStep("step_1", 1, "operational", "create_location"),
  ]),
  add_cambridge_preorder_collection: readyBuilderEvaluationOutput([
    builderEvaluationStep("step_1", 1, "operational", "create_location"),
    builderEvaluationStep("step_2", 2, "configuration", "configure_preorder", {
      dependencies: ["step_1"],
      existing_object_keys: ["order"],
    }),
  ]),
  automated_weekly_customer_email: clarificationBuilderEvaluationOutput(
    "workflow_unavailable",
  ),
  card_payment_at_checkout: clarificationBuilderEvaluationOutput(
    "payment_capability_unavailable",
  ),
  ambiguous_bookings: clarificationBuilderEvaluationOutput(),
});

export function createInjectedBuilderEvaluationExecution(
  responseFor: (
    scenarioId: BuilderEvaluationScenarioId,
    invocation: number,
    request: StructuredAiProviderRequest,
  ) => Promise<{
    output: unknown;
    usage?: { inputTokens: number; outputTokens: number };
  }>,
) {
  let invocation = 0;
  return createAiExecutionService({
    tasks: { builder_plan_v1: builderPlanTaskV1 },
    policies: {
      [BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY]: openAiBuilderPlanningPolicy,
    },
    providers: {
      openai: {
        key: "openai",
        async generateStructured(request) {
          const input = builderPlanTaskInputSchema.parse(request.input);
          const scenario = builderEvaluationScenarios.find(
            ({ owner_request }) => owner_request === input.owner_request,
          );
          if (!scenario) throw new Error("Unknown synthetic builder scenario.");
          invocation += 1;
          return responseFor(scenario.id, invocation, request);
        },
      },
    },
    sleep: async () => undefined,
  });
}
