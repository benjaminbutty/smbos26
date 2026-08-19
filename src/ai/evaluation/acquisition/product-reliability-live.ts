import type { AiExecutionResult } from "../../execution";
import { AiExecutionError } from "../../errors";
import { calculateAiTokenCostMicrousd } from "../../accounting/cost";
import { openAiAcquisitionPlanningPolicy } from "../../policies";
import { createAcquisitionAiRuntime } from "../../acquisition-planning/runtime";
import {
  classifyAcquisitionCandidateDiagnostic,
  type AcquisitionCandidateDiagnostic,
} from "../../../core/acquisition/diagnostics";
import type {
  AcquisitionEventMetadata,
  AcquisitionEventName,
} from "../../../core/acquisition/events";
import { isAcquisitionRecoveryFailureCode } from "../../../core/acquisition/recovery";
import { generateCandidate } from "../../../core/acquisition/service";
import { ACQUISITION_MAX_WORKFLOW_COST_MICROUSD } from "../../../core/acquisition/interpreter";
import { evaluateAcquisitionScenario } from "./evaluator";
import type { AcquisitionEvaluationScenario } from "./scenarios";
import {
  acquisitionProductReliabilityScenarios,
  ACQUISITION_PRODUCT_RELIABILITY_REPETITIONS,
} from "./product-reliability";

export const ACQUISITION_PRODUCT_RELIABILITY_SCENARIO_COUNT =
  acquisitionProductReliabilityScenarios.length;
export const ACQUISITION_PRODUCT_RELIABILITY_EXECUTIONS =
  ACQUISITION_PRODUCT_RELIABILITY_SCENARIO_COUNT *
  ACQUISITION_PRODUCT_RELIABILITY_REPETITIONS;

const productQualityScenario = {
  requiredConcepts: [],
} as const;

export type AcquisitionProductReliabilityEnvironment = Readonly<{
  RUN_LIVE_OPENAI_ACQUISITION_PRODUCT_RELIABILITY?: string | undefined;
  AI_PROVIDER?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
}>;

type ProductOutcome =
  | "first_pass_tailored"
  | "recovered_tailored"
  | "final_fallback"
  | "execution_failed";

type ProductReport = Readonly<{
  scenario_id: string;
  repetition: number;
  outcome: ProductOutcome;
  hard_contract_passed: boolean;
  hard_findings: readonly string[];
  diagnostic_codes: readonly string[];
  attempts: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_microusd: number;
  elapsed_ms: number;
}>;

function activated(
  environment: AcquisitionProductReliabilityEnvironment,
): boolean {
  return (
    environment.RUN_LIVE_OPENAI_ACQUISITION_PRODUCT_RELIABILITY === "1" &&
    environment.AI_PROVIDER?.trim() === "openai" &&
    Boolean(environment.OPENAI_API_KEY?.trim())
  );
}

function safeErrorCode(error: unknown): string {
  return error instanceof AiExecutionError ? error.code : "unclassified";
}

function failureUsage(error: unknown): {
  inputTokens: number;
  outputTokens: number;
  attempts: number;
} {
  if (!(error instanceof AiExecutionError) || !error.accounting) {
    return { inputTokens: 0, outputTokens: 0, attempts: 0 };
  }
  return {
    inputTokens: error.accounting.inputTokens,
    outputTokens: error.accounting.outputTokens,
    attempts: error.accounting.attemptsStarted,
  };
}

function diagnosticCode(diagnostic: AcquisitionCandidateDiagnostic): string {
  return diagnostic.code;
}

function actualCost(inputTokens: number, outputTokens: number): number {
  return calculateAiTokenCostMicrousd({
    inputTokens,
    outputTokens,
    inputMicrousdPerMillion:
      openAiAcquisitionPlanningPolicy.inputMicrousdPerMillion,
    outputMicrousdPerMillion:
      openAiAcquisitionPlanningPolicy.outputMicrousdPerMillion,
  });
}

function addCount(counts: Map<string, number>, key: string, amount = 1): void {
  counts.set(key, (counts.get(key) ?? 0) + amount);
}

export async function runLiveAcquisitionProductReliability(
  environment: AcquisitionProductReliabilityEnvironment,
) {
  if (!activated(environment)) {
    return { ran: false, passed: false } as const;
  }

  if (
    ACQUISITION_PRODUCT_RELIABILITY_SCENARIO_COUNT < 30 ||
    new Set(acquisitionProductReliabilityScenarios.map(({ id }) => id)).size !==
      ACQUISITION_PRODUCT_RELIABILITY_SCENARIO_COUNT ||
    ACQUISITION_PRODUCT_RELIABILITY_REPETITIONS < 2
  ) {
    throw new Error("Acquisition product-reliability corpus preflight failed.");
  }

  const runtime = createAcquisitionAiRuntime({
    AI_PROVIDER: "openai",
    OPENAI_API_KEY: environment.OPENAI_API_KEY!,
  });
  const hardCeiling =
    ACQUISITION_PRODUCT_RELIABILITY_EXECUTIONS *
    ACQUISITION_MAX_WORKFLOW_COST_MICROUSD;
  let totalCost = 0;
  let totalElapsed = 0;
  let totalAttempts = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const counts = new Map<string, number>();
  const diagnosticCounts = new Map<string, number>();
  const reports: ProductReport[] = [];

  for (
    let repetition = 1;
    repetition <= ACQUISITION_PRODUCT_RELIABILITY_REPETITIONS;
    repetition += 1
  ) {
    for (const scenario of acquisitionProductReliabilityScenarios) {
      const startedAt = performance.now();
      const eventNames: AcquisitionEventName[] = [];
      const diagnostics: string[] = [];
      let providerAttempts = 0;
      let scenarioInputTokens = 0;
      let scenarioOutputTokens = 0;
      let scenarioCost = 0;
      const trackedExecution = {
        async execute(
          taskKey: Parameters<typeof runtime.execution.execute>[0],
          input: unknown,
        ): Promise<AiExecutionResult> {
          providerAttempts += 1;
          totalAttempts += 1;
          try {
            const result = await runtime.execution.execute(taskKey, input);
            const cost = actualCost(
              result.metadata.usage.inputTokens,
              result.metadata.usage.outputTokens,
            );
            scenarioInputTokens += result.metadata.usage.inputTokens;
            scenarioOutputTokens += result.metadata.usage.outputTokens;
            scenarioCost += cost;
            inputTokens += result.metadata.usage.inputTokens;
            outputTokens += result.metadata.usage.outputTokens;
            totalCost += cost;
            if (totalCost > hardCeiling) {
              throw new Error(
                "Acquisition product-reliability cost ceiling exceeded.",
              );
            }
            return result;
          } catch (error) {
            const usage = failureUsage(error);
            scenarioInputTokens += usage.inputTokens;
            scenarioOutputTokens += usage.outputTokens;
            const cost = actualCost(usage.inputTokens, usage.outputTokens);
            scenarioCost += cost;
            inputTokens += usage.inputTokens;
            outputTokens += usage.outputTokens;
            totalCost += cost;
            throw error;
          }
        },
      };

      const emitEvent = (
        name: AcquisitionEventName,
        metadata: AcquisitionEventMetadata = {},
      ) => {
        eventNames.push(name);
        const failureCode = metadata.recovery_failure_code;
        if (
          name === "repair_failed" &&
          typeof failureCode === "string" &&
          isAcquisitionRecoveryFailureCode(failureCode)
        ) {
          diagnostics.push(failureCode);
        }
      };
      const emitDiagnostic = (
        error: unknown,
        stage:
          | "candidate_generation"
          | "candidate_quality"
          | "capability_enhancement",
        context: Pick<AcquisitionCandidateDiagnostic, "category" | "source">,
      ) => {
        diagnostics.push(
          diagnosticCode(
            classifyAcquisitionCandidateDiagnostic(error, stage, context),
          ),
        );
      };

      let outcome: ProductOutcome;
      let hardPassed: boolean;
      let hardFindings: readonly string[];
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
            execution: trackedExecution,
            emitEvent,
            emitDiagnostic,
          },
        );
        const evaluated = evaluateAcquisitionScenario(
          {
            ...scenario,
            ...productQualityScenario,
          } as AcquisitionEvaluationScenario,
          payload,
        );
        hardPassed = evaluated.hard_passed;
        hardFindings = evaluated.hard_findings;
        outcome =
          payload.proposal.source === "fallback"
            ? "final_fallback"
            : eventNames.includes("repair_succeeded")
              ? "recovered_tailored"
              : "first_pass_tailored";
      } catch (error) {
        const usage = failureUsage(error);
        outcome = "execution_failed";
        hardPassed = false;
        hardFindings = [`provider_failure:${safeErrorCode(error)}`];
        if (usage.attempts === 0 && providerAttempts === 0) {
          addCount(diagnosticCounts, safeErrorCode(error));
        }
      }

      if (diagnostics.length > 0) {
        for (const code of diagnostics) addCount(diagnosticCounts, code);
      }
      addCount(counts, outcome);
      const elapsed = Math.max(0, Math.round(performance.now() - startedAt));
      totalElapsed += elapsed;
      reports.push({
        scenario_id: scenario.id,
        repetition,
        outcome,
        hard_contract_passed: hardPassed,
        hard_findings: hardFindings,
        diagnostic_codes: diagnostics,
        attempts: providerAttempts,
        input_tokens: scenarioInputTokens,
        output_tokens: scenarioOutputTokens,
        estimated_cost_microusd: scenarioCost,
        elapsed_ms: elapsed,
      });
    }
  }

  const hardContractFailureCount = reports.filter(
    (report) => !report.hard_contract_passed,
  ).length;
  const summary = {
    gate: "product_reliability",
    passed: hardContractFailureCount === 0,
    scenario_count: ACQUISITION_PRODUCT_RELIABILITY_SCENARIO_COUNT,
    execution_count: reports.length,
    first_pass_tailored_success_count: counts.get("first_pass_tailored") ?? 0,
    recovered_tailored_success_count: counts.get("recovered_tailored") ?? 0,
    final_fallback_count: counts.get("final_fallback") ?? 0,
    execution_failure_count: counts.get("execution_failed") ?? 0,
    hard_contract_failure_count: hardContractFailureCount,
    diagnostic_code_distribution: Object.fromEntries(
      [...diagnosticCounts.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    attempts: totalAttempts,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    estimated_cost_microusd: totalCost,
    elapsed_ms: totalElapsed,
    reports,
  };
  console.log(JSON.stringify(summary));
  return { ran: true, passed: summary.passed, summary } as const;
}
