import type { AiExecutionResult } from "../../execution";
import { AiExecutionError } from "../../errors";
import {
  createAcquisitionAiRuntime,
  type AcquisitionExecutionCore,
} from "../../acquisition-planning/runtime";
import { calculateAiTokenCostMicrousd } from "../../accounting/cost";
import { openAiAcquisitionPlanningPolicy } from "../../policies";
import { ACQUISITION_MAX_WORKFLOW_COST_MICROUSD } from "../../../core/acquisition/interpreter";
import type { AcquisitionCandidateDiagnosticCode } from "../../../core/acquisition/diagnostics";
import {
  isAcquisitionRecoveryFailureCode,
  type AcquisitionRecoveryFailureCode,
} from "../../../core/acquisition/recovery";
import { generateCandidate } from "../../../core/acquisition/service";
import { composeStarterComposition } from "../../../core/acquisition/composer";
import {
  ACQUISITION_EVALUATION_SCENARIO_COUNT,
  ACQUISITION_RELIABILITY_EXECUTIONS,
  ACQUISITION_RELIABILITY_REPETITIONS,
  acquisitionEvaluationScenarios,
  type AcquisitionEvaluationScenario,
} from "./scenarios";
import {
  evaluateAcquisitionScenario,
  productionCompositionFailureResult,
  type AcquisitionEvaluationResult,
} from "./evaluator";

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

export async function runAcquisitionHardGateScenario(
  scenario: AcquisitionEvaluationScenario,
  execution: AcquisitionExecutionCore,
): Promise<
  AcquisitionEvaluationResult & {
    recovery_failure_code: AcquisitionRecoveryFailureCode | null;
    second_plan_attempted: boolean;
    second_plan_succeeded: boolean;
  }
> {
  let recoveryFailureCode: AcquisitionRecoveryFailureCode | null = null;
  let secondPlanAttempted = false;
  let secondPlanSucceeded = false;
  try {
    const payload = await generateCandidate(
      scenario.category,
      scenario.request,
      {
        onlineBooking: null,
        usesServices: null,
        capacityPerSlot: 1,
        publicEnquiry: null,
      },
      {
        execution,
        allowFallback: false,
        allowRecovery: true,
        emitEvent: (name, metadata = {}) => {
          if (name === "second_plan_attempted") secondPlanAttempted = true;
          if (name === "second_plan_tailored_success") {
            secondPlanSucceeded = true;
          }
          const failureCode = metadata.recovery_failure_code;
          if (
            name === "repair_failed" &&
            typeof failureCode === "string" &&
            isAcquisitionRecoveryFailureCode(failureCode)
          ) {
            recoveryFailureCode = failureCode;
          }
        },
        emitDiagnostic: () => undefined,
      },
    );
    return {
      ...evaluateAcquisitionScenario(scenario, payload),
      recovery_failure_code: null,
      second_plan_attempted: secondPlanAttempted,
      second_plan_succeeded: secondPlanSucceeded,
    };
  } catch (error) {
    return {
      ...productionCompositionFailureResult(error),
      recovery_failure_code: recoveryFailureCode,
      second_plan_attempted: secondPlanAttempted,
      second_plan_succeeded: false,
    };
  }
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
  let inputTokens = 0;
  let outputTokens = 0;
  let planningExecutions = 0;
  let secondPlanExecutions = 0;
  let secondPlanInputTokens = 0;
  let secondPlanOutputTokens = 0;
  let secondPlanCostMicrousd = 0;
  let secondPlanElapsedMs = 0;
  const reports: Array<{
    scenario_id: string;
    repetition: number;
    passed: boolean;
    failed_gate_codes: string[];
    hard_passed: boolean;
    hard_findings: string[];
    quality_passed: boolean;
    quality_findings: string[];
    diagnostic_code: AcquisitionCandidateDiagnosticCode | null;
    recovery_failure_code: AcquisitionRecoveryFailureCode | null;
    planning_executions: number;
    second_plan_attempted: boolean;
    second_plan_succeeded: boolean;
    second_plan_elapsed_ms: number;
  }> = [];
  const repetitions = gate === "qualification" ? 1 : 3;
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    for (const scenario of acquisitionEvaluationScenarios) {
      let scenarioPlanningExecutions = 0;
      let scenarioSecondPlanElapsedMs = 0;
      const tracked = {
        async execute(
          taskKey: Parameters<typeof runtime.execution.execute>[0],
          input: unknown,
        ) {
          scenarioPlanningExecutions += 1;
          planningExecutions += 1;
          const isSecondPlan = scenarioPlanningExecutions === 2;
          const startedAt = performance.now();
          if (isSecondPlan) secondPlanExecutions += 1;
          try {
            const execution: AiExecutionResult =
              await runtime.execution.execute(taskKey, input);
            const policy = openAiAcquisitionPlanningPolicy;
            const cost = calculateAiTokenCostMicrousd({
              inputTokens: execution.metadata.usage.inputTokens,
              outputTokens: execution.metadata.usage.outputTokens,
              inputMicrousdPerMillion: policy.inputMicrousdPerMillion,
              outputMicrousdPerMillion: policy.outputMicrousdPerMillion,
            });
            estimatedCostMicrousd += cost;
            inputTokens += execution.metadata.usage.inputTokens;
            outputTokens += execution.metadata.usage.outputTokens;
            if (isSecondPlan) {
              secondPlanInputTokens += execution.metadata.usage.inputTokens;
              secondPlanOutputTokens += execution.metadata.usage.outputTokens;
              secondPlanCostMicrousd += cost;
            }
            if (estimatedCostMicrousd > hardCeiling) {
              throw new Error("Acquisition evaluation cost ceiling exceeded.");
            }
            return execution;
          } catch (error) {
            if (error instanceof AiExecutionError && error.accounting) {
              const policy = openAiAcquisitionPlanningPolicy;
              const cost = calculateAiTokenCostMicrousd({
                inputTokens: error.accounting.inputTokens,
                outputTokens: error.accounting.outputTokens,
                inputMicrousdPerMillion: policy.inputMicrousdPerMillion,
                outputMicrousdPerMillion: policy.outputMicrousdPerMillion,
              });
              estimatedCostMicrousd += cost;
              inputTokens += error.accounting.inputTokens;
              outputTokens += error.accounting.outputTokens;
              if (isSecondPlan) {
                secondPlanInputTokens += error.accounting.inputTokens;
                secondPlanOutputTokens += error.accounting.outputTokens;
                secondPlanCostMicrousd += cost;
              }
            }
            throw error;
          } finally {
            if (isSecondPlan) {
              const elapsed = Math.max(
                0,
                Math.round(performance.now() - startedAt),
              );
              scenarioSecondPlanElapsedMs += elapsed;
              secondPlanElapsedMs += elapsed;
            }
          }
        },
      };
      const result = await runAcquisitionHardGateScenario(scenario, tracked);
      reports.push({
        scenario_id: scenario.id,
        repetition,
        passed: result.hard_passed,
        failed_gate_codes: result.hard_findings,
        hard_passed: result.hard_passed,
        hard_findings: result.hard_findings,
        quality_passed: result.quality_passed,
        quality_findings: result.quality_findings,
        diagnostic_code: result.diagnostic_code ?? null,
        recovery_failure_code: result.recovery_failure_code,
        planning_executions: scenarioPlanningExecutions,
        second_plan_attempted: result.second_plan_attempted,
        second_plan_succeeded: result.second_plan_succeeded,
        second_plan_elapsed_ms: scenarioSecondPlanElapsedMs,
      });
    }
  }
  const passed = reports.every((report) => report.passed);
  const summary = {
    gate,
    passed,
    passed_executions: reports.filter((report) => report.passed).length,
    total_executions: reports.length,
    hard_passed_executions: reports.filter((report) => report.hard_passed)
      .length,
    hard_total_executions: reports.length,
    quality_passed_executions: reports.filter((report) => report.quality_passed)
      .length,
    quality_total_executions: reports.length,
    estimated_cost_microusd: estimatedCostMicrousd,
    planning_execution_count: planningExecutions,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    second_plan_execution_count: secondPlanExecutions,
    second_plan_success_count: reports.filter(
      (report) => report.second_plan_succeeded,
    ).length,
    second_plan_execution_rate:
      reports.length === 0
        ? 0
        : Number((secondPlanExecutions / reports.length).toFixed(6)),
    second_plan_input_tokens: secondPlanInputTokens,
    second_plan_output_tokens: secondPlanOutputTokens,
    second_plan_estimated_cost_microusd: secondPlanCostMicrousd,
    second_plan_elapsed_ms: secondPlanElapsedMs,
    second_plan_average_elapsed_ms:
      secondPlanExecutions === 0
        ? 0
        : Math.round(secondPlanElapsedMs / secondPlanExecutions),
    reports,
  };
  console.log(JSON.stringify(summary));
  return { ran: true, passed, summary } as const;
}
