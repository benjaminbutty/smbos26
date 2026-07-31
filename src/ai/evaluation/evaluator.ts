import { calculateAiTokenCostMicrousd } from "../accounting/cost";
import { openAiBuilderPlanningPolicy } from "../policies";
import type { BuilderPlanOutput } from "../planning/schemas";
import {
  builderEvaluationReportSchema,
  type BuilderEvaluationFailedGateCode,
  type BuilderEvaluationReport,
  type BuilderEvaluationScenario,
} from "./schemas";

export interface BuilderEvaluationExecutionMetadata {
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  elapsedMs: number;
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

export function evaluateBuilderPlan(
  scenario: BuilderEvaluationScenario,
  output: BuilderPlanOutput,
  metadata: BuilderEvaluationExecutionMetadata,
): BuilderEvaluationReport {
  const failures = new Set<BuilderEvaluationFailedGateCode>();
  const steps = output.state === "ready" ? output.plan.steps : [];
  const configurationSteps = steps.filter(
    ({ lane }) => lane === "configuration",
  );
  const operationalSteps = steps.filter(({ lane }) => lane === "operational");
  const categories = uniqueSorted(steps.map(({ category }) => category));
  const unsupportedReasonCodes = uniqueSorted(
    output.unsupported_requirements.map(({ reason_code }) => reason_code),
  );

  const requireReady = ():
    Extract<BuilderPlanOutput, { state: "ready" }> | undefined => {
    if (output.state !== "ready") {
      failures.add("ready_required");
      return undefined;
    }
    return output;
  };
  const requireClarification = ():
    | Extract<BuilderPlanOutput, { state: "needs_clarification" }>
    | undefined => {
    if (output.state !== "needs_clarification") {
      failures.add("clarification_required");
      return undefined;
    }
    return output;
  };
  const requireCategory = (
    category: (typeof categories)[number],
    code: BuilderEvaluationFailedGateCode,
  ) => {
    if (!categories.includes(category)) failures.add(code);
  };

  if (!scenario.allowed_result_states.includes(output.state)) {
    failures.add("result_state_not_allowed");
  }

  switch (scenario.id) {
    case "preorder_phone_optional":
    case "preorder_schedule_change": {
      const readyOutput = requireReady();
      if (readyOutput) {
        if (configurationSteps.length === 0) {
          failures.add("configuration_step_required");
        }
        if (operationalSteps.length !== 0) {
          failures.add("operational_step_forbidden");
        }
        requireCategory("configure_preorder", "configure_preorder_required");
        if (readyOutput.unsupported_requirements.length !== 0) {
          failures.add("unsupported_requirement_forbidden");
        }
      }
      break;
    }
    case "corporate_catering_enquiries": {
      const readyOutput = requireReady();
      if (readyOutput) {
        if (configurationSteps.length === 0) {
          failures.add("configuration_step_required");
        }
        if (operationalSteps.length !== 0) {
          failures.add("operational_step_forbidden");
        }
        if (
          !readyOutput.plan.concepts.some(
            ({ disposition }) => disposition === "new",
          )
        ) {
          failures.add("new_concept_required");
        }
        requireCategory("define_object", "define_object_required");
        requireCategory("define_field", "define_field_required");
        requireCategory("configure_form", "configure_form_required");
        requireCategory("configure_view", "configure_view_required");
        requireCategory("configure_page", "configure_page_required");
        if (readyOutput.unsupported_requirements.length !== 0) {
          failures.add("unsupported_requirement_forbidden");
        }
      }
      break;
    }
    case "create_cambridge_location": {
      const readyOutput = requireReady();
      if (readyOutput) {
        if (configurationSteps.length !== 0) {
          failures.add("configuration_step_forbidden");
        }
        if (readyOutput.plan.concepts.length !== 0) {
          failures.add("concepts_must_be_empty");
        }
        const createSteps = operationalSteps.filter(
          ({ category }) => category === "create_location",
        );
        if (createSteps.length === 0) {
          failures.add("create_location_required");
        }
        if (
          createSteps.some(({ affected_concepts }) => affected_concepts.length)
        ) {
          failures.add("location_affected_concepts_forbidden");
        }
        if (
          createSteps.some(
            ({ location_references }) => location_references.length,
          )
        ) {
          failures.add("location_existing_reference_forbidden");
        }
        if (readyOutput.unsupported_requirements.length !== 0) {
          failures.add("unsupported_requirement_forbidden");
        }
      }
      break;
    }
    case "add_cambridge_preorder_collection":
      if (output.state === "needs_clarification") {
        if (output.questions.length === 0) failures.add("question_required");
      } else {
        if (output.plan.concepts.length !== 0) {
          failures.add("concepts_must_be_empty");
        }
        const createStep = output.plan.steps.find(
          ({ category }) => category === "create_location",
        );
        const configureStep = output.plan.steps.find(
          ({ category }) => category === "configure_preorder",
        );
        if (!createStep) failures.add("create_location_required");
        if (!configureStep) {
          failures.add("configure_preorder_required");
        }
        if (
          createStep &&
          (createStep.affected_concepts.length !== 0 ||
            createStep.location_references.length !== 0)
        ) {
          failures.add("location_existing_reference_forbidden");
        }
        if (
          createStep &&
          configureStep &&
          createStep.sequence >= configureStep.sequence
        ) {
          failures.add("compound_order_invalid");
        }
        if (
          createStep &&
          configureStep &&
          !configureStep.dependencies.includes(createStep.reference)
        ) {
          failures.add("compound_dependency_required");
        }
      }
      break;
    case "automated_weekly_customer_email": {
      const clarificationOutput = requireClarification();
      if (clarificationOutput) {
        if (
          !unsupportedReasonCodes.some((code) =>
            [
              "workflow_unavailable",
              "rule_engine_unavailable",
              "external_integration_required",
            ].includes(code),
          )
        ) {
          failures.add("unsupported_automation_reason_required");
        }
      }
      break;
    }
    case "card_payment_at_checkout": {
      const clarificationOutput = requireClarification();
      if (clarificationOutput) {
        if (
          !unsupportedReasonCodes.includes("payment_capability_unavailable")
        ) {
          failures.add("unsupported_payment_reason_required");
        }
      }
      break;
    }
    case "ambiguous_bookings": {
      const clarificationOutput = requireClarification();
      if (clarificationOutput && clarificationOutput.questions.length === 0) {
        failures.add("question_required");
      }
      break;
    }
  }

  const estimatedCostMicrousd = calculateAiTokenCostMicrousd({
    inputTokens: metadata.inputTokens,
    outputTokens: metadata.outputTokens,
    inputMicrousdPerMillion:
      openAiBuilderPlanningPolicy.inputMicrousdPerMillion,
    outputMicrousdPerMillion:
      openAiBuilderPlanningPolicy.outputMicrousdPerMillion,
  });

  return Object.freeze(
    builderEvaluationReportSchema.parse({
      scenario_id: scenario.id,
      passed: failures.size === 0,
      result_state: output.state,
      lanes: uniqueSorted(steps.map(({ lane }) => lane)),
      categories,
      unsupported_reason_codes: unsupportedReasonCodes,
      question_count:
        output.state === "needs_clarification" ? output.questions.length : 0,
      assumption_count: output.assumptions.length,
      high_impact_assumption_count: output.assumptions.filter(
        ({ impact }) => impact === "high",
      ).length,
      attempts: metadata.attempts,
      input_tokens: metadata.inputTokens,
      output_tokens: metadata.outputTokens,
      estimated_cost_microusd: estimatedCostMicrousd,
      elapsed_ms: Math.max(0, Math.round(metadata.elapsedMs)),
      failed_gate_codes: [...failures].sort(),
    }),
  );
}
