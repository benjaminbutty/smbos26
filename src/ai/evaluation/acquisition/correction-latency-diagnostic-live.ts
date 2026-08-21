import "server-only";

import {
  type AiExecutionPolicy,
  type AiReasoningEffort,
  type AiServiceTier,
} from "../../contracts";
import { AiExecutionError } from "../../errors";
import { calculateAiTokenCostMicrousd } from "../../accounting/cost";
import {
  createAiExecutionService,
  type AiExecutionResult,
} from "../../execution";
import {
  ACQUISITION_REQUIRED_IDENTITY_CORRECTION_POLICY_KEY,
  OPENAI_LUNA_MODEL_KEY,
  OPENAI_SOL_MODEL_KEY,
  openAiAcquisitionRequiredIdentityCorrectionPolicy,
} from "../../policies";
import { createObservedOpenAiResponsesStructuredProvider } from "../../providers/openai-latency-diagnostic";
import type { OpenAiLatencyDiagnosticObservation } from "../../providers/openai-latency-diagnostic";
import { acquisitionRequiredIdentityCorrectionTaskV1 } from "../../acquisition-planning/task";
import { ACQUISITION_MAX_PLANNING_EXECUTION_COST_MICROUSD } from "../../../core/acquisition/interpreter";
import {
  ACQUISITION_EVALUATION_SCENARIO_COUNT,
  ACQUISITION_RELIABILITY_EXECUTIONS,
  ACQUISITION_RELIABILITY_REPETITIONS,
  acquisitionEvaluationScenarios,
  type AcquisitionEvaluationScenario,
} from "./scenarios";
import {
  ACQUISITION_CORRECTION_TASK_KEY,
  runAcquisitionCorrectionQualificationScenario,
} from "./correction-qualification-live";

export const ACQUISITION_CORRECTION_LATENCY_DIAGNOSTIC_TIMEOUT_MS = 45_000;

export const acquisitionCorrectionLatencyDiagnosticCandidateSchema =
  Object.freeze({
    luna_max_fast: "luna_max_fast",
    sol_medium: "sol_medium",
  } as const);

export type AcquisitionCorrectionLatencyDiagnosticCandidate =
  keyof typeof acquisitionCorrectionLatencyDiagnosticCandidateSchema;

export type AcquisitionCorrectionLatencyDiagnosticEnvironment = Readonly<{
  RUN_LIVE_OPENAI_ACQUISITION_CORRECTION_LATENCY?: string | undefined;
  AI_PROVIDER?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
}>;

export type AcquisitionCorrectionLatencyDiagnosticProfile = Readonly<{
  candidate: AcquisitionCorrectionLatencyDiagnosticCandidate;
  modelKey: string;
  reasoningEffort: AiReasoningEffort;
  serviceTier: AiServiceTier;
  inputMicrousdPerMillion: number;
  outputMicrousdPerMillion: number;
}>;

export const acquisitionCorrectionLatencyDiagnosticProfiles: Readonly<
  Record<
    AcquisitionCorrectionLatencyDiagnosticCandidate,
    AcquisitionCorrectionLatencyDiagnosticProfile
  >
> = Object.freeze({
  luna_max_fast: Object.freeze({
    candidate: "luna_max_fast",
    modelKey: OPENAI_LUNA_MODEL_KEY,
    reasoningEffort: "max",
    serviceTier: "fast",
    inputMicrousdPerMillion: 200_000,
    outputMicrousdPerMillion: 1_200_000,
  }),
  sol_medium: Object.freeze({
    candidate: "sol_medium",
    modelKey: OPENAI_SOL_MODEL_KEY,
    reasoningEffort: "medium",
    serviceTier: "auto",
    inputMicrousdPerMillion: 5_000_000,
    outputMicrousdPerMillion: 30_000_000,
  }),
});

type DiagnosticExecutionStatus = "success" | "timeout" | "other_failure";

export type AcquisitionCorrectionLatencyDiagnosticReport = Readonly<{
  scenario_id: string;
  repetition: number;
  status: DiagnosticExecutionStatus;
  failure_code: string | null;
  provider_elapsed_ms: number;
  effective_service_tier: AiServiceTier | null;
  response_returned: boolean;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_microusd: number;
  quality_passed: boolean;
  quality_findings: readonly string[];
  hard_passed: boolean;
  hard_findings: readonly string[];
}>;

export type AcquisitionCorrectionLatencyDiagnosticSummary = Readonly<{
  diagnostic: "acquisition_correction_latency";
  diagnostic_only: true;
  candidate: AcquisitionCorrectionLatencyDiagnosticCandidate;
  model_key: string;
  reasoning_effort: AiReasoningEffort;
  requested_service_tier: AiServiceTier;
  diagnostic_timeout_ms: number;
  scenario_count: number;
  repetitions: number;
  execution_count: number;
  provider_execution_count: number;
  success_count: number;
  timeout_count: number;
  other_failure_count: number;
  effective_service_tier_distribution: Readonly<Record<string, number>>;
  effective_service_tier_verified: boolean;
  min_successful_latency_ms: number | null;
  median_successful_latency_ms: number | null;
  p90_successful_latency_ms: number | null;
  p95_successful_latency_ms: number | null;
  max_successful_latency_ms: number | null;
  min_observed_latency_ms: number | null;
  median_observed_latency_ms: number | null;
  p90_observed_latency_ms: number | null;
  p95_observed_latency_ms: number | null;
  max_observed_latency_ms: number | null;
  average_latency_ms: number | null;
  average_successful_latency_ms: number | null;
  recommended_timeout_ms: number | null;
  initial_planning_latency_measured: false;
  two_call_path_latency_measured: false;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_microusd: number;
  reports: readonly AcquisitionCorrectionLatencyDiagnosticReport[];
}>;

function activated(
  environment: AcquisitionCorrectionLatencyDiagnosticEnvironment,
): boolean {
  return (
    environment.RUN_LIVE_OPENAI_ACQUISITION_CORRECTION_LATENCY === "1" &&
    environment.AI_PROVIDER?.trim() === "openai" &&
    Boolean(environment.OPENAI_API_KEY?.trim())
  );
}

export function acquisitionCorrectionLatencyDiagnosticPolicy(
  profile: AcquisitionCorrectionLatencyDiagnosticProfile,
): AiExecutionPolicy {
  return Object.freeze({
    ...openAiAcquisitionRequiredIdentityCorrectionPolicy,
    modelKey: profile.modelKey,
    reasoningEffort: profile.reasoningEffort,
    serviceTier: profile.serviceTier,
    // The frozen latency subjects intentionally retain the historical
    // 2,500-token diagnostic cap. Production scoped correction owns its
    // separate 8,192-token cap in the active policy.
    maxOutputTokens: 2_500,
    timeoutMs: ACQUISITION_CORRECTION_LATENCY_DIAGNOSTIC_TIMEOUT_MS,
    inputMicrousdPerMillion: profile.inputMicrousdPerMillion,
    outputMicrousdPerMillion: profile.outputMicrousdPerMillion,
  });
}

function createDiagnosticExecution(
  environment: AcquisitionCorrectionLatencyDiagnosticEnvironment,
  profile: AcquisitionCorrectionLatencyDiagnosticProfile,
  observations: OpenAiLatencyDiagnosticObservation[],
) {
  const provider = createObservedOpenAiResponsesStructuredProvider(
    environment.OPENAI_API_KEY!,
    observations,
  );
  return createAiExecutionService({
    tasks: Object.freeze({
      [ACQUISITION_CORRECTION_TASK_KEY]:
        acquisitionRequiredIdentityCorrectionTaskV1,
    }),
    policies: Object.freeze({
      [ACQUISITION_REQUIRED_IDENTITY_CORRECTION_POLICY_KEY]:
        acquisitionCorrectionLatencyDiagnosticPolicy(profile),
    }),
    providers: Object.freeze({ [provider.key]: provider }),
  });
}

function diagnosticStatus(
  failureCode: string | null,
): DiagnosticExecutionStatus {
  if (failureCode === "ai_timeout") return "timeout";
  if (failureCode === null || failureCode.startsWith("quality_")) {
    return "success";
  }
  return "other_failure";
}

function sortedSuccessfulLatencies(
  reports: readonly AcquisitionCorrectionLatencyDiagnosticReport[],
): number[] {
  return reports
    .filter(({ status }) => status === "success")
    .map(({ provider_elapsed_ms }) => provider_elapsed_ms)
    .sort((left, right) => left - right);
}

export function percentileNearestRank(
  sortedValues: readonly number[],
  percentile: number,
): number | null {
  if (!sortedValues.length) return null;
  const rank = Math.max(1, Math.ceil(sortedValues.length * percentile));
  return sortedValues[rank - 1]!;
}

export function recommendedAcquisitionTimeoutMs(
  maxSuccessfulLatencyMs: number | null,
): number | null {
  if (maxSuccessfulLatencyMs === null) return null;
  return Math.min(
    ACQUISITION_CORRECTION_LATENCY_DIAGNOSTIC_TIMEOUT_MS,
    Math.ceil((maxSuccessfulLatencyMs + 5_000) / 5_000) * 5_000,
  );
}

export function summariseAcquisitionCorrectionLatency(
  profile: AcquisitionCorrectionLatencyDiagnosticProfile,
  reports: readonly AcquisitionCorrectionLatencyDiagnosticReport[],
  providerExecutionCount: number,
): AcquisitionCorrectionLatencyDiagnosticSummary {
  const successfulLatencies = sortedSuccessfulLatencies(reports);
  const allLatencies = reports.map(
    ({ provider_elapsed_ms }) => provider_elapsed_ms,
  );
  const sortedObservedLatencies = [...allLatencies].sort(
    (left, right) => left - right,
  );
  const sum = (values: readonly number[]) =>
    values.length
      ? Math.round(
          values.reduce((total, value) => total + value, 0) / values.length,
        )
      : null;
  const tierCounts = new Map<string, number>();
  for (const report of reports) {
    if (report.effective_service_tier) {
      tierCounts.set(
        report.effective_service_tier,
        (tierCounts.get(report.effective_service_tier) ?? 0) + 1,
      );
    }
  }
  const maxSuccessfulLatencyMs = successfulLatencies.length
    ? successfulLatencies[successfulLatencies.length - 1]!
    : null;
  const observedTierReports = reports.filter(
    ({ effective_service_tier }) => effective_service_tier !== null,
  );
  return {
    diagnostic: "acquisition_correction_latency",
    diagnostic_only: true,
    candidate: profile.candidate,
    model_key: profile.modelKey,
    reasoning_effort: profile.reasoningEffort,
    requested_service_tier: profile.serviceTier,
    diagnostic_timeout_ms: ACQUISITION_CORRECTION_LATENCY_DIAGNOSTIC_TIMEOUT_MS,
    scenario_count: ACQUISITION_EVALUATION_SCENARIO_COUNT,
    repetitions: ACQUISITION_RELIABILITY_REPETITIONS,
    execution_count: reports.length,
    provider_execution_count: providerExecutionCount,
    success_count: reports.filter(({ status }) => status === "success").length,
    timeout_count: reports.filter(({ status }) => status === "timeout").length,
    other_failure_count: reports.filter(
      ({ status }) => status === "other_failure",
    ).length,
    effective_service_tier_distribution: Object.fromEntries(
      [...tierCounts.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    effective_service_tier_verified:
      observedTierReports.length > 0 &&
      (profile.serviceTier !== "fast" && profile.serviceTier !== "priority"
        ? true
        : reports.every(
            ({ effective_service_tier }) =>
              effective_service_tier === "priority",
          )),
    min_successful_latency_ms: successfulLatencies[0] ?? null,
    median_successful_latency_ms: percentileNearestRank(
      successfulLatencies,
      0.5,
    ),
    p90_successful_latency_ms: percentileNearestRank(successfulLatencies, 0.9),
    p95_successful_latency_ms: percentileNearestRank(successfulLatencies, 0.95),
    max_successful_latency_ms: maxSuccessfulLatencyMs,
    min_observed_latency_ms: sortedObservedLatencies[0] ?? null,
    median_observed_latency_ms: percentileNearestRank(
      sortedObservedLatencies,
      0.5,
    ),
    p90_observed_latency_ms: percentileNearestRank(
      sortedObservedLatencies,
      0.9,
    ),
    p95_observed_latency_ms: percentileNearestRank(
      sortedObservedLatencies,
      0.95,
    ),
    max_observed_latency_ms: sortedObservedLatencies.at(-1) ?? null,
    average_latency_ms: sum(allLatencies),
    average_successful_latency_ms: sum(successfulLatencies),
    recommended_timeout_ms: recommendedAcquisitionTimeoutMs(
      maxSuccessfulLatencyMs,
    ),
    initial_planning_latency_measured: false,
    two_call_path_latency_measured: false,
    input_tokens: reports.reduce(
      (total, report) => total + report.input_tokens,
      0,
    ),
    output_tokens: reports.reduce(
      (total, report) => total + report.output_tokens,
      0,
    ),
    estimated_cost_microusd: reports.reduce(
      (total, report) => total + report.estimated_cost_microusd,
      0,
    ),
    reports,
  };
}

export function assertAcquisitionCorrectionLatencyDiagnosticSubject(): void {
  if (
    acquisitionEvaluationScenarios.length !==
      ACQUISITION_EVALUATION_SCENARIO_COUNT ||
    ACQUISITION_EVALUATION_SCENARIO_COUNT !== 8 ||
    ACQUISITION_RELIABILITY_REPETITIONS !== 3 ||
    ACQUISITION_RELIABILITY_EXECUTIONS !== 24 ||
    new Set(acquisitionEvaluationScenarios.map(({ id }) => id)).size !== 8
  ) {
    throw new Error("Acquisition latency diagnostic preflight failed.");
  }
}

async function runDiagnosticScenario(
  scenario: AcquisitionEvaluationScenario,
  profile: AcquisitionCorrectionLatencyDiagnosticProfile,
  execution: {
    execute(
      taskKey: typeof ACQUISITION_CORRECTION_TASK_KEY,
      input: unknown,
    ): Promise<AiExecutionResult>;
  },
  observations: OpenAiLatencyDiagnosticObservation[],
  providerExecutionIndex: number,
  repetition: number,
): Promise<AcquisitionCorrectionLatencyDiagnosticReport> {
  let inputTokens = 0;
  let outputTokens = 0;
  let providerObservation: OpenAiLatencyDiagnosticObservation | null = null;
  const executionStartedAt = performance.now();
  const tracked = {
    async execute(
      taskKey: typeof ACQUISITION_CORRECTION_TASK_KEY,
      input: unknown,
    ) {
      try {
        const result = await execution.execute(taskKey, input);
        inputTokens += result.metadata.usage.inputTokens;
        outputTokens += result.metadata.usage.outputTokens;
        providerObservation = observations[providerExecutionIndex] ?? null;
        return result;
      } catch (error) {
        if (error instanceof AiExecutionError && error.accounting) {
          inputTokens += error.accounting.inputTokens;
          outputTokens += error.accounting.outputTokens;
        }
        providerObservation = observations[providerExecutionIndex] ?? null;
        throw error;
      }
    },
  };
  const result = await runAcquisitionCorrectionQualificationScenario(
    scenario,
    tracked,
  );
  providerObservation =
    providerObservation ?? observations[providerExecutionIndex] ?? null;
  const providerElapsedMs =
    providerObservation?.providerElapsedMs ??
    Math.max(0, Math.round(performance.now() - executionStartedAt));
  const failureCode = result.diagnostic_code ?? null;
  const cost = calculateAiTokenCostMicrousd({
    inputTokens,
    outputTokens,
    inputMicrousdPerMillion: profile.inputMicrousdPerMillion,
    outputMicrousdPerMillion: profile.outputMicrousdPerMillion,
  });
  return {
    scenario_id: scenario.id,
    repetition,
    status: diagnosticStatus(failureCode),
    failure_code: failureCode,
    provider_elapsed_ms: providerElapsedMs,
    effective_service_tier: providerObservation?.effectiveServiceTier ?? null,
    response_returned: providerObservation?.responseReturned ?? false,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    estimated_cost_microusd: cost,
    quality_passed: result.quality_passed,
    quality_findings: result.quality_findings,
    hard_passed: result.hard_passed,
    hard_findings: result.hard_findings,
  };
}

export async function runLiveAcquisitionCorrectionLatencyDiagnostic(
  environment: AcquisitionCorrectionLatencyDiagnosticEnvironment,
  candidate: AcquisitionCorrectionLatencyDiagnosticCandidate,
) {
  if (!activated(environment)) {
    return { ran: false, passed: false } as const;
  }
  assertAcquisitionCorrectionLatencyDiagnosticSubject();
  const profile = acquisitionCorrectionLatencyDiagnosticProfiles[candidate];
  const observations: OpenAiLatencyDiagnosticObservation[] = [];
  const execution = createDiagnosticExecution(
    environment,
    profile,
    observations,
  );
  const hardCeiling =
    ACQUISITION_RELIABILITY_EXECUTIONS *
    ACQUISITION_MAX_PLANNING_EXECUTION_COST_MICROUSD;
  const reports: AcquisitionCorrectionLatencyDiagnosticReport[] = [];
  let providerExecutionCount = 0;
  let estimatedCostMicrousd = 0;

  for (
    let repetition = 1;
    repetition <= ACQUISITION_RELIABILITY_REPETITIONS;
    repetition += 1
  ) {
    for (const scenario of acquisitionEvaluationScenarios) {
      const providerExecutionIndex = providerExecutionCount;
      providerExecutionCount += 1;
      const report = await runDiagnosticScenario(
        scenario,
        profile,
        execution,
        observations,
        providerExecutionIndex,
        repetition,
      );
      reports.push(report);
      estimatedCostMicrousd += report.estimated_cost_microusd;
      if (estimatedCostMicrousd > hardCeiling) {
        throw new Error(
          "Acquisition latency diagnostic cost ceiling exceeded.",
        );
      }
    }
  }

  const summary = summariseAcquisitionCorrectionLatency(
    profile,
    reports,
    providerExecutionCount,
  );
  console.log(JSON.stringify(summary));
  return { ran: true, passed: true, summary } as const;
}
