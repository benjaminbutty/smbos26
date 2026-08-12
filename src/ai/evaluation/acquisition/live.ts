import type { AiExecutionResult } from "../../execution";
import { createAcquisitionAiRuntime } from "../../acquisition-planning/runtime";
import { calculateAiTokenCostMicrousd } from "../../accounting/cost";
import { openAiAcquisitionPlanningPolicy } from "../../policies";
import {
  ACQUISITION_MAX_WORKFLOW_COST_MICROUSD,
  interpretAcquisitionRequest,
} from "../../../core/acquisition/interpreter";
import { composeStarterComposition } from "../../../core/acquisition/composer";
import {
  ACQUISITION_EVALUATION_SCENARIO_COUNT,
  ACQUISITION_RELIABILITY_EXECUTIONS,
  ACQUISITION_RELIABILITY_REPETITIONS,
  acquisitionEvaluationScenarios,
  type AcquisitionEvaluationScenario,
} from "./scenarios";

type Environment = {
  AI_PROVIDER?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
  RUN_LIVE_OPENAI_ACQUISITION_QUALIFICATION?: string | undefined;
  RUN_LIVE_OPENAI_ACQUISITION_RELIABILITY?: string | undefined;
};

type Gate = "qualification" | "reliability";

function activated(environment: Environment, gate: Gate): boolean {
  const flag =
    gate === "qualification"
      ? environment.RUN_LIVE_OPENAI_ACQUISITION_QUALIFICATION
      : environment.RUN_LIVE_OPENAI_ACQUISITION_RELIABILITY;
  return (
    flag === "1" &&
    environment.AI_PROVIDER === "openai" &&
    Boolean(environment.OPENAI_API_KEY?.trim())
  );
}

function includesEvery(
  haystack: string,
  needles: readonly (string | readonly string[])[],
): boolean {
  return needles.every((needle) =>
    typeof needle === "string"
      ? haystack.includes(needle)
      : needle.some((alternative) => haystack.includes(alternative)),
  );
}

function evaluate(
  scenario: AcquisitionEvaluationScenario,
  payload: Awaited<ReturnType<typeof interpretAcquisitionRequest>>,
): string[] {
  const failures: string[] = [];
  const conceptText = payload.proposal.concepts
    .map(({ name }) => name.toLocaleLowerCase("en"))
    .join(" ");
  const excludedText = payload.proposal.not_included
    .join(" ")
    .toLocaleLowerCase("en");
  if (payload.proposal.source !== "tailored") failures.push("not_tailored");
  if (!includesEvery(conceptText, scenario.requiredConcepts)) {
    failures.push("required_concepts");
  }
  if (
    scenario.forbiddenConcepts?.some((value) => conceptText.includes(value))
  ) {
    failures.push("forbidden_concept");
  }
  if (
    scenario.requiredUnsupported &&
    !scenario.requiredUnsupported.some((value) => excludedText.includes(value))
  ) {
    failures.push("unsupported_not_disclosed");
  }
  const proposalText = JSON.stringify(payload.proposal);
  if (
    /\b(?:schema|uuid|json|database|cardinality|foreign key)\b/i.test(
      proposalText,
    )
  ) {
    failures.push("technical_owner_language");
  }
  if (payload.proposal.landing_page_key !== "overview") {
    failures.push("landing_page_not_overview");
  }
  if (
    payload.operations.some((operation) =>
      JSON.stringify(operation).includes("location"),
    )
  ) {
    failures.push("location_added");
  }
  if (
    payload.operations.some(
      (operation) =>
        operation.op === "set_field" && operation.field_type === "currency",
    )
  ) {
    failures.push("currency_invented");
  }
  if (scenario.requiresLineItemQuantity) {
    const lineObjects = payload.operations
      .filter(
        (operation) =>
          operation.op === "set_object" &&
          /(?:item|line)/i.test(
            `${operation.singular_label} ${operation.plural_label}`,
          ),
      )
      .map(({ key }) => key);
    if (
      lineObjects.length === 0 ||
      !payload.operations.some(
        (operation) =>
          operation.op === "set_field" &&
          lineObjects.includes(operation.object_key) &&
          /quantity|amount/i.test(operation.label) &&
          operation.field_type === "number",
      )
    ) {
      failures.push("line_item_quantity_missing");
    }
  }
  return failures;
}

export async function runLiveAcquisitionGate(
  gate: Gate,
  environment: Environment,
) {
  if (!activated(environment, gate))
    return { ran: false, passed: false } as const;
  if (
    acquisitionEvaluationScenarios.length !==
      ACQUISITION_EVALUATION_SCENARIO_COUNT ||
    ACQUISITION_RELIABILITY_REPETITIONS !== 3 ||
    ACQUISITION_RELIABILITY_EXECUTIONS !== 24 ||
    composeStarterComposition(
      "appointments",
      acquisitionEvaluationScenarios[0].request,
    ).proposal.source !== "fallback"
  ) {
    throw new Error("Acquisition evaluation preflight failed.");
  }
  const executions =
    gate === "qualification"
      ? ACQUISITION_EVALUATION_SCENARIO_COUNT
      : ACQUISITION_RELIABILITY_EXECUTIONS;
  const hardCeiling = ACQUISITION_MAX_WORKFLOW_COST_MICROUSD * executions;
  const runtime = createAcquisitionAiRuntime({
    AI_PROVIDER: "openai",
    OPENAI_API_KEY: environment.OPENAI_API_KEY!,
  });
  let estimatedCostMicrousd = 0;
  const reports: Array<{
    scenario_id: string;
    repetition: number;
    passed: boolean;
    failed_gate_codes: string[];
  }> = [];
  const repetitions = gate === "qualification" ? 1 : 3;
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    for (const scenario of acquisitionEvaluationScenarios) {
      const tracked = {
        async execute(
          taskKey: Parameters<typeof runtime.execution.execute>[0],
          input: unknown,
        ) {
          const execution: AiExecutionResult = await runtime.execution.execute(
            taskKey,
            input,
          );
          const policy = openAiAcquisitionPlanningPolicy;
          estimatedCostMicrousd += calculateAiTokenCostMicrousd({
            inputTokens: execution.metadata.usage.inputTokens,
            outputTokens: execution.metadata.usage.outputTokens,
            inputMicrousdPerMillion: policy.inputMicrousdPerMillion,
            outputMicrousdPerMillion: policy.outputMicrousdPerMillion,
          });
          if (estimatedCostMicrousd > hardCeiling) {
            throw new Error("Acquisition evaluation cost ceiling exceeded.");
          }
          return execution;
        },
      };
      let failures: string[];
      try {
        const payload = await interpretAcquisitionRequest(
          scenario.category,
          scenario.request,
          tracked,
        );
        failures = evaluate(scenario, payload);
      } catch (error) {
        const name = error instanceof Error ? error.name : "unknown";
        const code =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          typeof error.code === "string"
            ? error.code
            : "unclassified";
        failures = [`production_composition_failed:${name}:${code}`];
      }
      reports.push({
        scenario_id: scenario.id,
        repetition,
        passed: failures.length === 0,
        failed_gate_codes: failures,
      });
    }
  }
  const passed = reports.every((report) => report.passed);
  const summary = {
    gate,
    passed,
    passed_executions: reports.filter((report) => report.passed).length,
    total_executions: reports.length,
    estimated_cost_microusd: estimatedCostMicrousd,
    reports,
  };
  console.log(JSON.stringify(summary));
  return { ran: true, passed, summary } as const;
}
