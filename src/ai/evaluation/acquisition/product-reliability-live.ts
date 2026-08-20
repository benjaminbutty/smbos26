import type { AiExecutionResult } from "../../execution";
import { AiExecutionError } from "../../errors";
import { calculateAiTokenCostMicrousd } from "../../accounting/cost";
import {
  openAiAcquisitionPlanningPolicy,
  openAiAcquisitionRequiredIdentityCorrectionPolicy,
} from "../../policies";
import {
  createAcquisitionAiRuntime,
  type AcquisitionExecutionCore,
} from "../../acquisition-planning/runtime";
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
  type AcquisitionProductReliabilityScenario,
} from "./product-reliability";

export const ACQUISITION_PRODUCT_RELIABILITY_SCENARIO_COUNT =
  acquisitionProductReliabilityScenarios.length;
export const ACQUISITION_PRODUCT_RELIABILITY_EXECUTIONS =
  ACQUISITION_PRODUCT_RELIABILITY_SCENARIO_COUNT *
  ACQUISITION_PRODUCT_RELIABILITY_REPETITIONS;
export const ACQUISITION_PRODUCT_RELIABILITY_MIN_TAILORED = 94;
export const ACQUISITION_PRODUCT_RELIABILITY_MAX_FALLBACK = 2;

const productQualityScenario = {
  requiredConcepts: [],
} as const;

export type AcquisitionProductReliabilityEnvironment = Readonly<{
  RUN_LIVE_OPENAI_ACQUISITION_PRODUCT_RELIABILITY?: string | undefined;
  AI_PROVIDER?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
}>;

export type AcquisitionProductOutcome =
  | "raw_first_pass_tailored"
  | "precomposition_canonicalised_tailored"
  | "postcomposition_recovered_tailored"
  | "precomposition_canonicalised_and_postcomposition_recovered_tailored"
  | "correction_plan_tailored"
  | "final_fallback"
  | "execution_failed";

type ProductReport = Readonly<{
  scenario_id: string;
  repetition: number;
  outcome: AcquisitionProductOutcome;
  hard_contract_passed: boolean;
  hard_findings: readonly string[];
  diagnostic_codes: readonly string[];
  attempts: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_microusd: number;
  elapsed_ms: number;
  correction_plan_input_tokens: number;
  correction_plan_output_tokens: number;
  correction_plan_estimated_cost_microusd: number;
  correction_plan_elapsed_ms: number;
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

function actualCost(
  taskKey: Parameters<AcquisitionExecutionCore["execute"]>[0],
  inputTokens: number,
  outputTokens: number,
): number {
  const policy =
    taskKey === "acquisition_required_identity_correction_v1"
      ? openAiAcquisitionRequiredIdentityCorrectionPolicy
      : openAiAcquisitionPlanningPolicy;
  return calculateAiTokenCostMicrousd({
    inputTokens,
    outputTokens,
    inputMicrousdPerMillion: policy.inputMicrousdPerMillion,
    outputMicrousdPerMillion: policy.outputMicrousdPerMillion,
  });
}

function addCount(counts: Map<string, number>, key: string, amount = 1): void {
  counts.set(key, (counts.get(key) ?? 0) + amount);
}

export function acquisitionProductHardFindings(
  findings: readonly string[],
): string[] {
  return findings.filter((finding) => finding !== "not_tailored");
}

export function acquisitionProductReliabilityPassed(input: {
  tailored: number;
  fallback: number;
  executionFailures: number;
  hardContractFailures: number;
  systematicFailureScenarios: number;
}): boolean {
  return (
    input.tailored >= ACQUISITION_PRODUCT_RELIABILITY_MIN_TAILORED &&
    input.fallback <= ACQUISITION_PRODUCT_RELIABILITY_MAX_FALLBACK &&
    input.executionFailures === 0 &&
    input.hardContractFailures === 0 &&
    input.systematicFailureScenarios === 0
  );
}

function normaliseCorpusRequest(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en");
}

export function assertAcquisitionProductReliabilityCorpus(
  scenarios: readonly AcquisitionProductReliabilityScenario[] = acquisitionProductReliabilityScenarios,
  repetitions: number = ACQUISITION_PRODUCT_RELIABILITY_REPETITIONS,
): void {
  if (
    scenarios.length !== 32 ||
    new Set(scenarios.map(({ id }) => id)).size !== scenarios.length ||
    new Set(scenarios.map(({ request }) => normaliseCorpusRequest(request)))
      .size !== scenarios.length ||
    repetitions !== 3 ||
    scenarios.length * repetitions !== 96
  ) {
    throw new Error("Acquisition product-reliability corpus preflight failed.");
  }
}

export function acquisitionProductOutcome(
  source: "tailored" | "fallback",
  eventNames: readonly AcquisitionEventName[],
): Exclude<AcquisitionProductOutcome, "execution_failed"> {
  if (source === "fallback") return "final_fallback";
  if (eventNames.includes("correction_plan_tailored_success")) {
    return "correction_plan_tailored";
  }
  const canonicalised = eventNames.includes(
    "precomposition_canonicalisation_applied",
  );
  const recovered = eventNames.includes("repair_succeeded");
  if (canonicalised && recovered) {
    return "precomposition_canonicalised_and_postcomposition_recovered_tailored";
  }
  if (canonicalised) return "precomposition_canonicalised_tailored";
  if (recovered) return "postcomposition_recovered_tailored";
  return "raw_first_pass_tailored";
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : Number((count / total).toFixed(6));
}

export async function runLiveAcquisitionProductReliability(
  environment: AcquisitionProductReliabilityEnvironment,
) {
  if (!activated(environment)) {
    return { ran: false, passed: false } as const;
  }

  assertAcquisitionProductReliabilityCorpus();

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
  let secondPlanExecutions = 0;
  let secondPlanInputTokens = 0;
  let secondPlanOutputTokens = 0;
  let secondPlanCost = 0;
  let secondPlanElapsed = 0;
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
      let scenarioSecondPlanInputTokens = 0;
      let scenarioSecondPlanOutputTokens = 0;
      let scenarioSecondPlanCost = 0;
      let scenarioSecondPlanElapsed = 0;
      const trackedExecution = {
        async execute(
          taskKey: Parameters<typeof runtime.execution.execute>[0],
          input: unknown,
        ): Promise<AiExecutionResult> {
          providerAttempts += 1;
          const isSecondPlan =
            taskKey === "acquisition_required_identity_correction_v1";
          const executionStartedAt = performance.now();
          if (isSecondPlan) secondPlanExecutions += 1;
          totalAttempts += 1;
          try {
            const result = await runtime.execution.execute(taskKey, input);
            const cost = actualCost(
              taskKey,
              result.metadata.usage.inputTokens,
              result.metadata.usage.outputTokens,
            );
            scenarioInputTokens += result.metadata.usage.inputTokens;
            scenarioOutputTokens += result.metadata.usage.outputTokens;
            scenarioCost += cost;
            inputTokens += result.metadata.usage.inputTokens;
            outputTokens += result.metadata.usage.outputTokens;
            totalCost += cost;
            if (isSecondPlan) {
              scenarioSecondPlanInputTokens +=
                result.metadata.usage.inputTokens;
              scenarioSecondPlanOutputTokens +=
                result.metadata.usage.outputTokens;
              scenarioSecondPlanCost += cost;
              secondPlanInputTokens += result.metadata.usage.inputTokens;
              secondPlanOutputTokens += result.metadata.usage.outputTokens;
              secondPlanCost += cost;
            }
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
            const cost = actualCost(
              taskKey,
              usage.inputTokens,
              usage.outputTokens,
            );
            scenarioCost += cost;
            inputTokens += usage.inputTokens;
            outputTokens += usage.outputTokens;
            totalCost += cost;
            if (isSecondPlan) {
              scenarioSecondPlanInputTokens += usage.inputTokens;
              scenarioSecondPlanOutputTokens += usage.outputTokens;
              scenarioSecondPlanCost += cost;
              secondPlanInputTokens += usage.inputTokens;
              secondPlanOutputTokens += usage.outputTokens;
              secondPlanCost += cost;
            }
            throw error;
          } finally {
            if (isSecondPlan) {
              const executionElapsed = Math.max(
                0,
                Math.round(performance.now() - executionStartedAt),
              );
              scenarioSecondPlanElapsed += executionElapsed;
              secondPlanElapsed += executionElapsed;
            }
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

      let outcome: AcquisitionProductOutcome;
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
        hardFindings = acquisitionProductHardFindings(evaluated.hard_findings);
        hardPassed = hardFindings.length === 0;
        outcome = acquisitionProductOutcome(
          payload.proposal.source,
          eventNames,
        );
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
        correction_plan_input_tokens: scenarioSecondPlanInputTokens,
        correction_plan_output_tokens: scenarioSecondPlanOutputTokens,
        correction_plan_estimated_cost_microusd: scenarioSecondPlanCost,
        correction_plan_elapsed_ms: scenarioSecondPlanElapsed,
      });
    }
  }

  const hardContractFailureCount = reports.filter(
    (report) => !report.hard_contract_passed,
  ).length;
  const rawFirstPassTailoredCount = counts.get("raw_first_pass_tailored") ?? 0;
  const precompositionCanonicalisedOnlyTailoredCount =
    counts.get("precomposition_canonicalised_tailored") ?? 0;
  const postcompositionRecoveredOnlyTailoredCount =
    counts.get("postcomposition_recovered_tailored") ?? 0;
  const combinedCanonicalisedAndRecoveredTailoredCount =
    counts.get(
      "precomposition_canonicalised_and_postcomposition_recovered_tailored",
    ) ?? 0;
  const secondPlanTailoredCount = counts.get("correction_plan_tailored") ?? 0;
  const precompositionCanonicalisedTailoredCount =
    precompositionCanonicalisedOnlyTailoredCount +
    combinedCanonicalisedAndRecoveredTailoredCount;
  const postcompositionRecoveredTailoredCount =
    postcompositionRecoveredOnlyTailoredCount +
    combinedCanonicalisedAndRecoveredTailoredCount;
  const finalFallbackCount = counts.get("final_fallback") ?? 0;
  const executionFailureCount = counts.get("execution_failed") ?? 0;
  const tailoredCount =
    rawFirstPassTailoredCount +
    precompositionCanonicalisedOnlyTailoredCount +
    postcompositionRecoveredOnlyTailoredCount +
    combinedCanonicalisedAndRecoveredTailoredCount +
    secondPlanTailoredCount;
  const systematicFailureScenarioIds = acquisitionProductReliabilityScenarios
    .filter((scenario) => {
      const scenarioReports = reports.filter(
        (report) => report.scenario_id === scenario.id,
      );
      return (
        scenarioReports.length ===
          ACQUISITION_PRODUCT_RELIABILITY_REPETITIONS &&
        scenarioReports.every(
          (report) =>
            !report.hard_contract_passed ||
            report.outcome === "final_fallback" ||
            report.outcome === "execution_failed",
        )
      );
    })
    .map(({ id }) => id);
  const passed = acquisitionProductReliabilityPassed({
    tailored: tailoredCount,
    fallback: finalFallbackCount,
    executionFailures: executionFailureCount,
    hardContractFailures: hardContractFailureCount,
    systematicFailureScenarios: systematicFailureScenarioIds.length,
  });
  const summary = {
    gate: "product_reliability",
    passed,
    scenario_count: ACQUISITION_PRODUCT_RELIABILITY_SCENARIO_COUNT,
    execution_count: reports.length,
    raw_first_pass_tailored_success_count: rawFirstPassTailoredCount,
    raw_first_pass_tailored_success_rate: rate(
      rawFirstPassTailoredCount,
      reports.length,
    ),
    precomposition_canonicalised_tailored_success_count:
      precompositionCanonicalisedTailoredCount,
    precomposition_canonicalised_tailored_success_rate: rate(
      precompositionCanonicalisedTailoredCount,
      reports.length,
    ),
    precomposition_canonicalised_only_tailored_success_count:
      precompositionCanonicalisedOnlyTailoredCount,
    precomposition_canonicalised_only_tailored_success_rate: rate(
      precompositionCanonicalisedOnlyTailoredCount,
      reports.length,
    ),
    postcomposition_recovered_tailored_success_count:
      postcompositionRecoveredTailoredCount,
    postcomposition_recovered_tailored_success_rate: rate(
      postcompositionRecoveredTailoredCount,
      reports.length,
    ),
    postcomposition_recovered_only_tailored_success_count:
      postcompositionRecoveredOnlyTailoredCount,
    postcomposition_recovered_only_tailored_success_rate: rate(
      postcompositionRecoveredOnlyTailoredCount,
      reports.length,
    ),
    combined_canonicalised_and_recovered_tailored_success_count:
      combinedCanonicalisedAndRecoveredTailoredCount,
    combined_canonicalised_and_recovered_tailored_success_rate: rate(
      combinedCanonicalisedAndRecoveredTailoredCount,
      reports.length,
    ),
    correction_plan_tailored_success_count: secondPlanTailoredCount,
    correction_plan_tailored_success_rate: rate(
      secondPlanTailoredCount,
      reports.length,
    ),
    correction_plan_execution_count: secondPlanExecutions,
    correction_plan_execution_rate: rate(secondPlanExecutions, reports.length),
    correction_plan_input_tokens: secondPlanInputTokens,
    correction_plan_output_tokens: secondPlanOutputTokens,
    correction_plan_estimated_cost_microusd: secondPlanCost,
    correction_plan_elapsed_ms: secondPlanElapsed,
    correction_plan_average_elapsed_ms:
      secondPlanExecutions === 0
        ? 0
        : Math.round(secondPlanElapsed / secondPlanExecutions),
    final_tailored_success_count: tailoredCount,
    final_tailored_success_rate: rate(tailoredCount, reports.length),
    final_fallback_count: finalFallbackCount,
    final_fallback_rate: rate(finalFallbackCount, reports.length),
    execution_failure_count: executionFailureCount,
    hard_contract_failure_count: hardContractFailureCount,
    systematic_failure_scenario_ids: systematicFailureScenarioIds,
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
