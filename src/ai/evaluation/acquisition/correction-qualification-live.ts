import { aiServiceTierRequiresPriority } from "../../contracts";
import type { AiExecutionResult } from "../../execution";
import { AiExecutionError } from "../../errors";
import { calculateAiTokenCostMicrousd } from "../../accounting/cost";
import {
  createAcquisitionAiRuntime,
  type AcquisitionExecutionCore,
} from "../../acquisition-planning/runtime";
import {
  ACQUISITION_REQUIRED_IDENTITY_CORRECTION_POLICY_KEY,
  openAiAcquisitionRequiredIdentityCorrectionPolicy,
} from "../../policies";
import { enhanceAcquisitionPayload } from "../../../core/acquisition/capabilities";
import {
  ACQUISITION_MAX_PLANNING_EXECUTION_COST_MICROUSD,
  interpretAcquisitionRequiredIdentityCorrection,
} from "../../../core/acquisition/interpreter";
import { validateAcquisitionCandidate } from "../../../core/acquisition/quality";
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
} from "./evaluator";

export const ACQUISITION_CORRECTION_TASK_KEY =
  "acquisition_required_identity_correction_v1" as const;
export const ACQUISITION_CORRECTION_QUALIFICATION_REPETITIONS =
  ACQUISITION_RELIABILITY_REPETITIONS;
export const ACQUISITION_CORRECTION_QUALIFICATION_EXECUTIONS =
  ACQUISITION_RELIABILITY_EXECUTIONS;

export type AcquisitionCorrectionQualificationEnvironment = Readonly<{
  RUN_LIVE_OPENAI_ACQUISITION_CORRECTION_QUALIFICATION?: string | undefined;
  AI_PROVIDER?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
}>;

function activated(
  environment: AcquisitionCorrectionQualificationEnvironment,
): boolean {
  return (
    environment.RUN_LIVE_OPENAI_ACQUISITION_CORRECTION_QUALIFICATION === "1" &&
    environment.AI_PROVIDER?.trim() === "openai" &&
    Boolean(environment.OPENAI_API_KEY?.trim())
  );
}

export function assertAcquisitionCorrectionQualificationSubject(): void {
  if (
    acquisitionEvaluationScenarios.length !==
      ACQUISITION_EVALUATION_SCENARIO_COUNT ||
    ACQUISITION_EVALUATION_SCENARIO_COUNT !== 8 ||
    ACQUISITION_CORRECTION_QUALIFICATION_REPETITIONS !== 3 ||
    ACQUISITION_CORRECTION_QUALIFICATION_EXECUTIONS !== 24 ||
    new Set(acquisitionEvaluationScenarios.map(({ id }) => id)).size !== 8
  ) {
    throw new Error("Acquisition correction qualification preflight failed.");
  }
}

export async function runAcquisitionCorrectionQualificationScenario(
  scenario: AcquisitionEvaluationScenario,
  execution: AcquisitionExecutionCore,
) {
  try {
    const composed = await interpretAcquisitionRequiredIdentityCorrection(
      scenario.category,
      scenario.request,
      execution,
      { validate: false },
    );
    const enhanced = enhanceAcquisitionPayload(
      composed,
      {
        onlineBooking: null,
        usesServices: null,
        capacityPerSlot: 1,
        publicEnquiry: null,
      },
      scenario.request,
    );
    const payload = validateAcquisitionCandidate(enhanced);
    return evaluateAcquisitionScenario(scenario, payload);
  } catch (error) {
    return productionCompositionFailureResult(error);
  }
}

export async function runLiveAcquisitionCorrectionQualification(
  environment: AcquisitionCorrectionQualificationEnvironment,
) {
  if (!activated(environment)) {
    return { ran: false, passed: false } as const;
  }
  assertAcquisitionCorrectionQualificationSubject();

  const runtime = createAcquisitionAiRuntime({
    AI_PROVIDER: "openai",
    OPENAI_API_KEY: environment.OPENAI_API_KEY!,
  });
  const hardCeiling =
    ACQUISITION_CORRECTION_QUALIFICATION_EXECUTIONS *
    ACQUISITION_MAX_PLANNING_EXECUTION_COST_MICROUSD;
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedCostMicrousd = 0;
  let elapsedMs = 0;
  let providerExecutions = 0;
  const effectiveServiceTierCounts = new Map<string, number>();
  const reports: Array<{
    scenario_id: string;
    repetition: number;
    passed: boolean;
    hard_passed: boolean;
    hard_findings: string[];
    quality_passed: boolean;
    quality_findings: string[];
    diagnostic_code: string | null;
    input_tokens: number;
    output_tokens: number;
    estimated_cost_microusd: number;
    elapsed_ms: number;
    effective_service_tier: string | null;
  }> = [];

  for (
    let repetition = 1;
    repetition <= ACQUISITION_CORRECTION_QUALIFICATION_REPETITIONS;
    repetition += 1
  ) {
    for (const scenario of acquisitionEvaluationScenarios) {
      let scenarioInputTokens = 0;
      let scenarioOutputTokens = 0;
      let scenarioEffectiveServiceTier: string | null = null;
      const startedAt = performance.now();
      const tracked: AcquisitionExecutionCore = {
        async execute(taskKey, input): Promise<AiExecutionResult> {
          if (taskKey !== ACQUISITION_CORRECTION_TASK_KEY) {
            throw new Error("Correction qualification used the wrong task.");
          }
          providerExecutions += 1;
          try {
            const result = await runtime.execution.execute(taskKey, input);
            scenarioInputTokens += result.metadata.usage.inputTokens;
            scenarioOutputTokens += result.metadata.usage.outputTokens;
            const effectiveServiceTier =
              result.metadata.requestMetadata?.service_tier;
            if (typeof effectiveServiceTier === "string") {
              scenarioEffectiveServiceTier = effectiveServiceTier;
              effectiveServiceTierCounts.set(
                effectiveServiceTier,
                (effectiveServiceTierCounts.get(effectiveServiceTier) ?? 0) + 1,
              );
            }
            return result;
          } catch (error) {
            if (error instanceof AiExecutionError && error.accounting) {
              scenarioInputTokens += error.accounting.inputTokens;
              scenarioOutputTokens += error.accounting.outputTokens;
            }
            throw error;
          }
        },
      };
      const result = await runAcquisitionCorrectionQualificationScenario(
        scenario,
        tracked,
      );
      const scenarioCost = calculateAiTokenCostMicrousd({
        inputTokens: scenarioInputTokens,
        outputTokens: scenarioOutputTokens,
        inputMicrousdPerMillion:
          openAiAcquisitionRequiredIdentityCorrectionPolicy.inputMicrousdPerMillion,
        outputMicrousdPerMillion:
          openAiAcquisitionRequiredIdentityCorrectionPolicy.outputMicrousdPerMillion,
      });
      inputTokens += scenarioInputTokens;
      outputTokens += scenarioOutputTokens;
      estimatedCostMicrousd += scenarioCost;
      if (estimatedCostMicrousd > hardCeiling) {
        throw new Error(
          "Acquisition correction qualification cost ceiling exceeded.",
        );
      }
      const scenarioElapsedMs = Math.max(
        0,
        Math.round(performance.now() - startedAt),
      );
      elapsedMs += scenarioElapsedMs;
      reports.push({
        scenario_id: scenario.id,
        repetition,
        passed: result.hard_passed && result.quality_passed,
        hard_passed: result.hard_passed,
        hard_findings: result.hard_findings,
        quality_passed: result.quality_passed,
        quality_findings: result.quality_findings,
        diagnostic_code: result.diagnostic_code ?? null,
        input_tokens: scenarioInputTokens,
        output_tokens: scenarioOutputTokens,
        estimated_cost_microusd: scenarioCost,
        elapsed_ms: scenarioElapsedMs,
        effective_service_tier: scenarioEffectiveServiceTier,
      });
    }
  }

  const passed =
    providerExecutions === ACQUISITION_CORRECTION_QUALIFICATION_EXECUTIONS &&
    reports.length === ACQUISITION_CORRECTION_QUALIFICATION_EXECUTIONS &&
    reports.every(
      (report) =>
        report.passed &&
        (!aiServiceTierRequiresPriority(
          openAiAcquisitionRequiredIdentityCorrectionPolicy.serviceTier,
        ) ||
          report.effective_service_tier === "priority"),
    );
  const summary = {
    gate: "acquisition_required_identity_correction_qualification",
    passed,
    task_key: ACQUISITION_CORRECTION_TASK_KEY,
    policy_key: ACQUISITION_REQUIRED_IDENTITY_CORRECTION_POLICY_KEY,
    model_key: openAiAcquisitionRequiredIdentityCorrectionPolicy.modelKey,
    reasoning_effort:
      openAiAcquisitionRequiredIdentityCorrectionPolicy.reasoningEffort,
    requested_service_tier:
      openAiAcquisitionRequiredIdentityCorrectionPolicy.serviceTier,
    effective_service_tier_distribution: Object.fromEntries(
      [...effectiveServiceTierCounts.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    effective_service_tier_verified:
      !aiServiceTierRequiresPriority(
        openAiAcquisitionRequiredIdentityCorrectionPolicy.serviceTier,
      ) ||
      reports.every((report) => report.effective_service_tier === "priority"),
    scenario_count: ACQUISITION_EVALUATION_SCENARIO_COUNT,
    repetitions: ACQUISITION_CORRECTION_QUALIFICATION_REPETITIONS,
    execution_count: reports.length,
    provider_execution_count: providerExecutions,
    passed_executions: reports.filter((report) => report.passed).length,
    hard_passed_executions: reports.filter((report) => report.hard_passed)
      .length,
    quality_passed_executions: reports.filter((report) => report.quality_passed)
      .length,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    estimated_cost_microusd: estimatedCostMicrousd,
    elapsed_ms: elapsedMs,
    average_elapsed_ms:
      reports.length === 0 ? 0 : Math.round(elapsedMs / reports.length),
    reports,
  };
  console.log(JSON.stringify(summary));
  return { ran: true, passed, summary } as const;
}
