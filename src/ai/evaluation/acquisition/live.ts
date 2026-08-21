import type { AiExecutionResult } from "../../execution";
import { aiServiceTierRequiresPriority } from "../../contracts";
import { AiExecutionError } from "../../errors";
import {
  createAcquisitionAiRuntime,
  type AcquisitionExecutionCore,
} from "../../acquisition-planning/runtime";
import { calculateAiTokenCostMicrousd } from "../../accounting/cost";
import {
  openAiAcquisitionPlanningPolicy,
  openAiAcquisitionRequiredIdentityCorrectionPolicy,
} from "../../policies";
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
    correction_plan_attempted: boolean;
    correction_plan_succeeded: boolean;
    quality_flagged_field_count: number;
    mechanical_repair_field_count: number;
    related_field_equivalence_match_count: number;
    related_field_equivalence_recovered: boolean;
  }
> {
  let recoveryFailureCode: AcquisitionRecoveryFailureCode | null = null;
  let secondPlanAttempted = false;
  let secondPlanSucceeded = false;
  let qualityFlaggedFieldCount = 0;
  let mechanicalRepairFieldCount = 0;
  let relatedFieldEquivalenceMatchCount = 0;
  let relatedFieldEquivalenceRecovered = false;
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
          const boundedCount = (key: string): number => {
            const value = metadata[key];
            return typeof value === "number" && Number.isSafeInteger(value)
              ? Math.max(0, value)
              : 0;
          };
          qualityFlaggedFieldCount = Math.max(
            qualityFlaggedFieldCount,
            boundedCount("quality_flagged_field_count"),
          );
          mechanicalRepairFieldCount = Math.max(
            mechanicalRepairFieldCount,
            boundedCount("mechanical_repair_field_count"),
          );
          relatedFieldEquivalenceMatchCount = Math.max(
            relatedFieldEquivalenceMatchCount,
            boundedCount("related_field_equivalence_match_count"),
          );
          if (
            name === "repair_succeeded" &&
            boundedCount("related_field_equivalence_match_count") > 0
          ) {
            relatedFieldEquivalenceRecovered = true;
          }
          if (name === "correction_plan_attempted") secondPlanAttempted = true;
          if (name === "correction_plan_tailored_success") {
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
      correction_plan_attempted: secondPlanAttempted,
      correction_plan_succeeded: secondPlanSucceeded,
      quality_flagged_field_count: qualityFlaggedFieldCount,
      mechanical_repair_field_count: mechanicalRepairFieldCount,
      related_field_equivalence_match_count: relatedFieldEquivalenceMatchCount,
      related_field_equivalence_recovered: relatedFieldEquivalenceRecovered,
    };
  } catch (error) {
    return {
      ...productionCompositionFailureResult(error),
      recovery_failure_code: recoveryFailureCode,
      correction_plan_attempted: secondPlanAttempted,
      correction_plan_succeeded: false,
      quality_flagged_field_count: qualityFlaggedFieldCount,
      mechanical_repair_field_count: mechanicalRepairFieldCount,
      related_field_equivalence_match_count: relatedFieldEquivalenceMatchCount,
      related_field_equivalence_recovered: false,
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
  const effectiveServiceTierCounts = new Map<string, number>();
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
    correction_plan_attempted: boolean;
    correction_plan_succeeded: boolean;
    correction_plan_elapsed_ms: number;
    effective_service_tiers: string[];
    quality_flagged_field_count: number;
    mechanical_repair_field_count: number;
    related_field_equivalence_match_count: number;
    related_field_equivalence_recovered: boolean;
  }> = [];
  const repetitions = gate === "qualification" ? 1 : 3;
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    for (const scenario of acquisitionEvaluationScenarios) {
      let scenarioPlanningExecutions = 0;
      let scenarioSecondPlanElapsedMs = 0;
      const scenarioEffectiveServiceTiers: string[] = [];
      const tracked = {
        async execute(
          taskKey: Parameters<typeof runtime.execution.execute>[0],
          input: unknown,
        ) {
          scenarioPlanningExecutions += 1;
          planningExecutions += 1;
          const isSecondPlan =
            taskKey === "acquisition_required_identity_correction_v1";
          const startedAt = performance.now();
          if (isSecondPlan) secondPlanExecutions += 1;
          try {
            const execution: AiExecutionResult =
              await runtime.execution.execute(taskKey, input);
            const effectiveServiceTier =
              execution.metadata.requestMetadata?.service_tier;
            if (typeof effectiveServiceTier === "string") {
              scenarioEffectiveServiceTiers.push(effectiveServiceTier);
              effectiveServiceTierCounts.set(
                effectiveServiceTier,
                (effectiveServiceTierCounts.get(effectiveServiceTier) ?? 0) + 1,
              );
            }
            const policy = isSecondPlan
              ? openAiAcquisitionRequiredIdentityCorrectionPolicy
              : openAiAcquisitionPlanningPolicy;
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
              const policy = isSecondPlan
                ? openAiAcquisitionRequiredIdentityCorrectionPolicy
                : openAiAcquisitionPlanningPolicy;
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
        correction_plan_attempted: result.correction_plan_attempted,
        correction_plan_succeeded: result.correction_plan_succeeded,
        correction_plan_elapsed_ms: scenarioSecondPlanElapsedMs,
        effective_service_tiers: scenarioEffectiveServiceTiers,
        quality_flagged_field_count: result.quality_flagged_field_count,
        mechanical_repair_field_count: result.mechanical_repair_field_count,
        related_field_equivalence_match_count:
          result.related_field_equivalence_match_count,
        related_field_equivalence_recovered:
          result.related_field_equivalence_recovered,
      });
    }
  }
  const effectiveServiceTierVerified =
    !aiServiceTierRequiresPriority(
      openAiAcquisitionPlanningPolicy.serviceTier,
    ) || effectiveServiceTierCounts.get("priority") === planningExecutions;
  const passed =
    reports.every((report) => report.passed) && effectiveServiceTierVerified;
  const summary = {
    gate,
    planning_policy_key: openAiAcquisitionPlanningPolicy.key,
    planning_model_key: openAiAcquisitionPlanningPolicy.modelKey,
    planning_reasoning_effort: openAiAcquisitionPlanningPolicy.reasoningEffort,
    planning_requested_service_tier:
      openAiAcquisitionPlanningPolicy.serviceTier,
    correction_policy_key:
      openAiAcquisitionRequiredIdentityCorrectionPolicy.key,
    correction_model_key:
      openAiAcquisitionRequiredIdentityCorrectionPolicy.modelKey,
    correction_reasoning_effort:
      openAiAcquisitionRequiredIdentityCorrectionPolicy.reasoningEffort,
    correction_requested_service_tier:
      openAiAcquisitionRequiredIdentityCorrectionPolicy.serviceTier,
    effective_service_tier_distribution: Object.fromEntries(
      [...effectiveServiceTierCounts.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    effective_service_tier_verified: effectiveServiceTierVerified,
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
    correction_plan_execution_count: secondPlanExecutions,
    related_field_equivalence_recovered_execution_count: reports.filter(
      (report) => report.related_field_equivalence_recovered,
    ).length,
    correction_plan_success_count: reports.filter(
      (report) => report.correction_plan_succeeded,
    ).length,
    correction_plan_execution_rate:
      reports.length === 0
        ? 0
        : Number((secondPlanExecutions / reports.length).toFixed(6)),
    correction_plan_input_tokens: secondPlanInputTokens,
    correction_plan_output_tokens: secondPlanOutputTokens,
    correction_plan_estimated_cost_microusd: secondPlanCostMicrousd,
    correction_plan_elapsed_ms: secondPlanElapsedMs,
    correction_plan_average_elapsed_ms:
      secondPlanExecutions === 0
        ? 0
        : Math.round(secondPlanElapsedMs / secondPlanExecutions),
    reports,
  };
  console.log(JSON.stringify(summary));
  return { ran: true, passed, summary } as const;
}
