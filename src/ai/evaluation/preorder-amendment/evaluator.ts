import { calculateAiTokenCostMicrousd } from "../../accounting/cost";
import { openAiBuilderPreorderAmendmentPolicy } from "../../policies";
import {
  builderPreorderAmendmentOutputSchema,
  builderPreorderAmendmentTaskInputBaseSchema,
  type BuilderPreorderAmendmentOutput,
} from "../../preorder-amendment/schemas";
import { validateBuilderPreorderAmendmentOutput } from "../../preorder-amendment/validation";
import {
  builderPreorderAmendmentEvaluationReportSchema,
  type BuilderPreorderAmendmentEvaluationReport,
  type BuilderPreorderAmendmentEvaluationScenario,
} from "./schemas";
import { builderPreorderAmendmentEvaluationPlans } from "./scenarios";
import { syntheticBusinessContext } from "../../../../evaluations/fixtures/synthetic-business-context";

export interface BuilderPreorderAmendmentEvaluationExecutionMetadata {
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  elapsedMs: number;
}

function expectedWithoutSummary(output: BuilderPreorderAmendmentOutput) {
  return {
    schema_version: output.schema_version,
    preorder_key: output.preorder_key,
    amendments: output.amendments,
  };
}

export function evaluateBuilderPreorderAmendment(
  scenario: BuilderPreorderAmendmentEvaluationScenario,
  outputInput: unknown,
  metadata: BuilderPreorderAmendmentEvaluationExecutionMetadata,
): BuilderPreorderAmendmentEvaluationReport {
  const failures = new Set<
    | "output_contract_invalid"
    | "semantic_validation_failed"
    | "scenario_expectation_failed"
  >();
  let output: BuilderPreorderAmendmentOutput | undefined;
  try {
    output = builderPreorderAmendmentOutputSchema.parse(outputInput);
  } catch {
    failures.add("output_contract_invalid");
  }

  if (output) {
    try {
      const plan = builderPreorderAmendmentEvaluationPlans[scenario.id];
      const taskInput = builderPreorderAmendmentTaskInputBaseSchema.parse({
        schema_version: 1,
        owner_request: scenario.owner_request,
        business_context: syntheticBusinessContext,
        ready_plan: plan,
        preorder_scope: {
          preorder_key: "bakery_preorder",
          selection: "sole_active",
        },
      });
      validateBuilderPreorderAmendmentOutput(taskInput, output);
    } catch {
      failures.add("semantic_validation_failed");
    }
    if (
      JSON.stringify(expectedWithoutSummary(output)) !==
      JSON.stringify(expectedWithoutSummary(scenario.expected_output))
    ) {
      failures.add("scenario_expectation_failed");
    }
  }

  const estimatedCostMicrousd = calculateAiTokenCostMicrousd({
    inputTokens: metadata.inputTokens,
    outputTokens: metadata.outputTokens,
    inputMicrousdPerMillion:
      openAiBuilderPreorderAmendmentPolicy.inputMicrousdPerMillion,
    outputMicrousdPerMillion:
      openAiBuilderPreorderAmendmentPolicy.outputMicrousdPerMillion,
  });
  return Object.freeze(
    builderPreorderAmendmentEvaluationReportSchema.parse({
      scenario_id: scenario.id,
      passed: failures.size === 0,
      amendment_count: output?.amendments.length ?? 0,
      amendment_types: output?.amendments.map(({ type }) => type) ?? [],
      attempts: metadata.attempts,
      input_tokens: metadata.inputTokens,
      output_tokens: metadata.outputTokens,
      estimated_cost_microusd: estimatedCostMicrousd,
      elapsed_ms: Math.max(0, Math.round(metadata.elapsedMs)),
      failed_gate_codes: [...failures].sort(),
    }),
  );
}
