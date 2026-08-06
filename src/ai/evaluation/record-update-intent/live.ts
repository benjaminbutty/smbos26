import type { AiExecutionResult } from "../../execution";
import { createAiExecutionService } from "../../execution";
import {
  BUILDER_RECORD_UPDATE_INTENT_TERRA_MEDIUM_POLICY_KEY,
  OPENAI_BUILDER_RECORD_UPDATE_INTENT_MODEL_KEY,
  OPENAI_BUILDER_RECORD_UPDATE_INTENT_REASONING_EFFORT,
  openAiBuilderRecordUpdateIntentPolicy,
} from "../../policies";
import { builderRecordUpdateIntentTaskV1 } from "../../record-update-intent/task";
import {
  BUILDER_RECORD_UPDATE_INTENT_QUALIFICATION_HARD_CEILING_MICROUSD,
  BUILDER_RECORD_UPDATE_INTENT_QUALIFICATION_SCENARIO_COUNT,
  BUILDER_RECORD_UPDATE_INTENT_RELIABILITY_HARD_CEILING_MICROUSD,
  BUILDER_RECORD_UPDATE_INTENT_RELIABILITY_REPETITIONS,
  BUILDER_RECORD_UPDATE_INTENT_RELIABILITY_TOTAL_EXECUTIONS,
  deriveBuilderRecordUpdateQualificationEnvelope,
  deriveBuilderRecordUpdateReliabilityEnvelope,
} from "./envelope";
import {
  BUILDER_RECORD_UPDATE_EVALUATION_SCENARIO_IDS,
  builderRecordUpdateEvaluationScenarios,
  type BuilderRecordUpdateEvaluationScenario,
} from "./scenarios";
import {
  builderRecordUpdateEvaluationQualificationAggregateSchema,
  builderRecordUpdateEvaluationReliabilityAggregateSchema,
  builderRecordUpdateEvaluationSetupFailureSchema,
  type BuilderRecordUpdateEvaluationReport,
  type BuilderRecordUpdateEvaluationSetupReason,
} from "./schemas";
import {
  evaluateBuilderRecordUpdateIntent,
  executionFailureReport,
  failureAccounting,
  safeErrorCode,
} from "./evaluator";

export interface BuilderRecordUpdateQualificationEnvironment {
  RUN_LIVE_OPENAI_RECORD_UPDATE_TERRA_QUALIFICATION?: string | undefined;
  AI_PROVIDER?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
}

export interface BuilderRecordUpdateReliabilityEnvironment {
  RUN_LIVE_OPENAI_RECORD_UPDATE_TERRA_RELIABILITY?: string | undefined;
  AI_PROVIDER?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
}

export interface BuilderRecordUpdateLiveDependencies {
  execute(
    taskKey: "builder_record_update_intent_v1",
    input: unknown,
  ): Promise<AiExecutionResult>;
  now(): number;
  emit(value: unknown): void;
}

export interface BuilderRecordUpdateLiveOverrides {
  execute?: BuilderRecordUpdateLiveDependencies["execute"];
  now?: () => number;
  emit?: (value: unknown) => void;
  loadDependencies?: () => Promise<BuilderRecordUpdateLiveDependencies>;
  deriveQualificationEnvelope?: () => GateEnvelope;
  deriveReliabilityEnvelope?: () => GateEnvelope;
}

interface GateEnvelope {
  taskKey: string;
  policyKey: string;
  modelKey: string;
  reasoningEffort: string;
  reservedCostMicrousdPerExecution: number;
  reservedCostMicrousd: number;
  hardCeilingMicrousd: number;
}

interface GateTotals {
  passedExecutions: number;
  failedExecutions: number;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicrousd: number;
  elapsedMs: number;
}

const expectedPolicy = {
  key: BUILDER_RECORD_UPDATE_INTENT_TERRA_MEDIUM_POLICY_KEY,
  providerKey: "openai",
  modelKey: OPENAI_BUILDER_RECORD_UPDATE_INTENT_MODEL_KEY,
  maxInputBytes: 256 * 1024,
  maxBillableInputTokens: 80_000,
  maxOutputTokens: 4_096,
  timeoutMs: 30_000,
  maxAttempts: 2,
  retryDelayMs: 250,
  retryableFailureKinds: ["rate_limited", "transient"] as const,
  inputMicrousdPerMillion: 2_500_000,
  outputMicrousdPerMillion: 15_000_000,
} as const;

function activated(
  flag: string | undefined,
  environment: {
    AI_PROVIDER?: string | undefined;
    OPENAI_API_KEY?: string | undefined;
  },
) {
  return (
    flag === "1" &&
    environment.AI_PROVIDER?.trim() === "openai" &&
    Boolean(environment.OPENAI_API_KEY?.trim())
  );
}

export function liveBuilderRecordUpdateQualificationIsActivated(
  environment: BuilderRecordUpdateQualificationEnvironment,
): boolean {
  return activated(
    environment.RUN_LIVE_OPENAI_RECORD_UPDATE_TERRA_QUALIFICATION,
    environment,
  );
}

export function liveBuilderRecordUpdateReliabilityIsActivated(
  environment: BuilderRecordUpdateReliabilityEnvironment,
): boolean {
  return activated(
    environment.RUN_LIVE_OPENAI_RECORD_UPDATE_TERRA_RELIABILITY,
    environment,
  );
}

async function defaultDependencies(): Promise<BuilderRecordUpdateLiveDependencies> {
  const { aiExecutionPolicies, registeredAiTasks, structuredAiProviders } =
    await import("../../registry");
  const task = Object.freeze({
    ...builderRecordUpdateIntentTaskV1,
    policyKey: BUILDER_RECORD_UPDATE_INTENT_TERRA_MEDIUM_POLICY_KEY,
  });
  const execution = createAiExecutionService({
    tasks: { ...registeredAiTasks, builder_record_update_intent_v1: task },
    policies: {
      ...aiExecutionPolicies,
      [BUILDER_RECORD_UPDATE_INTENT_TERRA_MEDIUM_POLICY_KEY]:
        openAiBuilderRecordUpdateIntentPolicy,
    },
    providers: structuredAiProviders,
  });
  return {
    execute: (taskKey, input) => execution.execute(taskKey, input),
    now: () => performance.now(),
    emit: (value) => console.log(JSON.stringify(value)),
  };
}

function setupFailure(reasonCode: BuilderRecordUpdateEvaluationSetupReason) {
  return builderRecordUpdateEvaluationSetupFailureSchema.parse({
    evaluation_error_code: "evaluation_setup_failed",
    reason_code: reasonCode,
  });
}

function arraysEqual(left: readonly unknown[], right: readonly unknown[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function policyMatches() {
  return (
    Object.entries(expectedPolicy).every(([key, expected]) => {
      const actual =
        openAiBuilderRecordUpdateIntentPolicy[
          key as keyof typeof openAiBuilderRecordUpdateIntentPolicy
        ];
      return Array.isArray(expected) && Array.isArray(actual)
        ? arraysEqual(actual, expected)
        : actual === expected;
    }) &&
    arraysEqual(
      openAiBuilderRecordUpdateIntentPolicy.retryableFailureKinds,
      expectedPolicy.retryableFailureKinds,
    )
  );
}

function preflightGate(
  gate: "qualification" | "reliability",
  envelope: GateEnvelope,
): BuilderRecordUpdateEvaluationSetupReason | null {
  if (
    builderRecordUpdateEvaluationScenarios.length !==
    BUILDER_RECORD_UPDATE_INTENT_QUALIFICATION_SCENARIO_COUNT
  ) {
    return "scenario_count_mismatch";
  }
  if (
    !arraysEqual(
      builderRecordUpdateEvaluationScenarios.map(({ id }) => id),
      BUILDER_RECORD_UPDATE_EVALUATION_SCENARIO_IDS,
    )
  ) {
    return "scenario_order_mismatch";
  }
  if (
    builderRecordUpdateIntentTaskV1.key !== "builder_record_update_intent_v1" ||
    builderRecordUpdateIntentTaskV1.version !== 1
  ) {
    return "task_identity_mismatch";
  }
  if (!policyMatches()) return "policy_envelope_mismatch";
  if (
    envelope.taskKey !== "builder_record_update_intent_v1" ||
    envelope.policyKey !==
      BUILDER_RECORD_UPDATE_INTENT_TERRA_MEDIUM_POLICY_KEY ||
    envelope.modelKey !== OPENAI_BUILDER_RECORD_UPDATE_INTENT_MODEL_KEY ||
    envelope.reasoningEffort !==
      OPENAI_BUILDER_RECORD_UPDATE_INTENT_REASONING_EFFORT
  ) {
    return "policy_identity_mismatch";
  }
  const expectedExecutions =
    gate === "qualification"
      ? BUILDER_RECORD_UPDATE_INTENT_QUALIFICATION_SCENARIO_COUNT
      : BUILDER_RECORD_UPDATE_INTENT_RELIABILITY_TOTAL_EXECUTIONS;
  if (
    envelope.reservedCostMicrousdPerExecution !== 522_880 ||
    envelope.reservedCostMicrousd !== 522_880 * expectedExecutions
  ) {
    return "reservation_envelope_mismatch";
  }
  if (
    envelope.hardCeilingMicrousd !==
    (gate === "qualification"
      ? BUILDER_RECORD_UPDATE_INTENT_QUALIFICATION_HARD_CEILING_MICROUSD
      : BUILDER_RECORD_UPDATE_INTENT_RELIABILITY_HARD_CEILING_MICROUSD)
  ) {
    return gate === "qualification"
      ? "qualification_ceiling_mismatch"
      : "reliability_ceiling_mismatch";
  }
  if (
    gate === "reliability" &&
    (BUILDER_RECORD_UPDATE_INTENT_RELIABILITY_REPETITIONS !== 3 ||
      BUILDER_RECORD_UPDATE_INTENT_RELIABILITY_TOTAL_EXECUTIONS !== 24)
  ) {
    return BUILDER_RECORD_UPDATE_INTENT_RELIABILITY_REPETITIONS !== 3
      ? "repetition_count_mismatch"
      : "execution_count_mismatch";
  }
  return null;
}

function newTotals(): GateTotals {
  return {
    passedExecutions: 0,
    failedExecutions: 0,
    attempts: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostMicrousd: 0,
    elapsedMs: 0,
  };
}

function updateTotals(
  totals: GateTotals,
  report: BuilderRecordUpdateEvaluationReport,
) {
  if (report.passed) totals.passedExecutions += 1;
  else totals.failedExecutions += 1;
  totals.attempts += report.attempts;
  totals.inputTokens += report.input_tokens;
  totals.outputTokens += report.output_tokens;
  totals.estimatedCostMicrousd += report.estimated_microusd;
  totals.elapsedMs += report.elapsed_ms;
}

async function resolveDependencies(
  overrides: BuilderRecordUpdateLiveOverrides,
): Promise<BuilderRecordUpdateLiveDependencies> {
  if (overrides.execute) {
    return {
      execute: overrides.execute,
      now: overrides.now ?? (() => performance.now()),
      emit: overrides.emit ?? ((value) => console.log(JSON.stringify(value))),
    };
  }
  const loaded = await (overrides.loadDependencies ?? defaultDependencies)();
  return {
    execute: loaded.execute,
    now: overrides.now ?? loaded.now,
    emit: overrides.emit ?? loaded.emit,
  };
}

async function runScenario(
  dependencies: BuilderRecordUpdateLiveDependencies,
  scenario: BuilderRecordUpdateEvaluationScenario,
  repetition: 1 | 2 | 3,
) {
  const started = dependencies.now();
  try {
    const execution = await dependencies.execute(
      "builder_record_update_intent_v1",
      scenario.input,
    );
    const result = evaluateBuilderRecordUpdateIntent(
      scenario,
      execution.output,
      {
        attempts: execution.accounting.attemptsStarted,
        inputTokens: execution.accounting.inputTokens,
        outputTokens: execution.accounting.outputTokens,
        usageComplete: execution.accounting.usageComplete,
        elapsedMs: Math.max(0, Math.round(dependencies.now() - started)),
      },
      { repetition },
    );
    dependencies.emit(result);
    return result;
  } catch (cause) {
    const usage = failureAccounting(cause);
    const result = executionFailureReport(
      scenario,
      {
        ...usage,
        elapsedMs: Math.max(0, Math.round(dependencies.now() - started)),
      },
      safeErrorCode(cause),
      repetition,
      cause,
    );
    dependencies.emit(result);
    return result;
  }
}

function emitSetupFailure(
  emit: (value: unknown) => void,
  reason: BuilderRecordUpdateEvaluationSetupReason,
) {
  const failure = setupFailure(reason);
  emit(failure);
  return {
    ran: true as const,
    passed: false as const,
    reports: [] as const,
    setup_failure: failure,
  };
}

function qualificationAggregate(totals: GateTotals) {
  return builderRecordUpdateEvaluationQualificationAggregateSchema.parse({
    schema_version: 1,
    gate: "qualification",
    model_key: OPENAI_BUILDER_RECORD_UPDATE_INTENT_MODEL_KEY,
    policy_key: BUILDER_RECORD_UPDATE_INTENT_TERRA_MEDIUM_POLICY_KEY,
    reasoning_effort: OPENAI_BUILDER_RECORD_UPDATE_INTENT_REASONING_EFFORT,
    total_scenarios: 8,
    passed_scenarios: Math.min(8, totals.passedExecutions),
    failed_scenarios: Math.min(8, totals.failedExecutions),
    total_attempts: totals.attempts,
    total_input_tokens: totals.inputTokens,
    total_output_tokens: totals.outputTokens,
    total_estimated_cost_microusd: totals.estimatedCostMicrousd,
    total_elapsed_ms: totals.elapsedMs,
  });
}

function reliabilityAggregate(
  totals: GateTotals,
  passCounts: ReadonlyMap<string, number>,
) {
  const passedScenarios = [...passCounts.values()].filter(
    (count) => count === 3,
  ).length;
  return builderRecordUpdateEvaluationReliabilityAggregateSchema.parse({
    schema_version: 1,
    gate: "reliability",
    model_key: OPENAI_BUILDER_RECORD_UPDATE_INTENT_MODEL_KEY,
    policy_key: BUILDER_RECORD_UPDATE_INTENT_TERRA_MEDIUM_POLICY_KEY,
    reasoning_effort: OPENAI_BUILDER_RECORD_UPDATE_INTENT_REASONING_EFFORT,
    total_scenarios: 8,
    passed_scenarios: passedScenarios,
    failed_scenarios: 8 - passedScenarios,
    total_attempts: totals.attempts,
    total_input_tokens: totals.inputTokens,
    total_output_tokens: totals.outputTokens,
    total_estimated_cost_microusd: totals.estimatedCostMicrousd,
    total_elapsed_ms: totals.elapsedMs,
    repetitions_per_scenario: 3,
    total_executions: 24,
    passed_executions: totals.passedExecutions,
    failed_executions: totals.failedExecutions,
    per_scenario_pass_counts: builderRecordUpdateEvaluationScenarios.map(
      ({ id }) => ({ scenario_id: id, passed_count: passCounts.get(id) ?? 0 }),
    ),
  });
}

export async function runLiveBuilderRecordUpdateQualification(
  environment: BuilderRecordUpdateQualificationEnvironment,
  overrides: BuilderRecordUpdateLiveOverrides = {},
) {
  if (!liveBuilderRecordUpdateQualificationIsActivated(environment)) {
    return { ran: false, passed: false } as const;
  }
  const emit =
    overrides.emit ?? ((value: unknown) => console.log(JSON.stringify(value)));
  let envelope: GateEnvelope;
  try {
    envelope = (
      overrides.deriveQualificationEnvelope ??
      deriveBuilderRecordUpdateQualificationEnvelope
    )() as GateEnvelope;
  } catch {
    return emitSetupFailure(emit, "reservation_envelope_mismatch");
  }
  const reason = preflightGate("qualification", envelope);
  if (reason) return emitSetupFailure(emit, reason);
  let dependencies: BuilderRecordUpdateLiveDependencies;
  try {
    dependencies = await resolveDependencies(overrides);
  } catch {
    return emitSetupFailure(emit, "dependency_initialization_failed");
  }
  const reports: BuilderRecordUpdateEvaluationReport[] = [];
  const totals = newTotals();
  for (const scenario of builderRecordUpdateEvaluationScenarios) {
    const result = await runScenario(dependencies, scenario, 1);
    reports.push(result);
    updateTotals(totals, result);
    if (!result.passed) break;
  }
  const aggregate = qualificationAggregate(totals);
  dependencies.emit(aggregate);
  return Object.freeze({
    ran: true,
    passed:
      reports.length === 8 &&
      totals.passedExecutions === 8 &&
      totals.failedExecutions === 0 &&
      totals.estimatedCostMicrousd <= envelope.hardCeilingMicrousd &&
      envelope.reservedCostMicrousd <= envelope.hardCeilingMicrousd,
    reports: Object.freeze(reports),
    aggregate,
  });
}

export async function runLiveBuilderRecordUpdateReliability(
  environment: BuilderRecordUpdateReliabilityEnvironment,
  overrides: BuilderRecordUpdateLiveOverrides = {},
) {
  if (!liveBuilderRecordUpdateReliabilityIsActivated(environment)) {
    return { ran: false, passed: false } as const;
  }
  const emit =
    overrides.emit ?? ((value: unknown) => console.log(JSON.stringify(value)));
  let envelope: GateEnvelope;
  try {
    envelope = (
      overrides.deriveReliabilityEnvelope ??
      deriveBuilderRecordUpdateReliabilityEnvelope
    )() as GateEnvelope;
  } catch {
    return emitSetupFailure(emit, "reservation_envelope_mismatch");
  }
  const reason = preflightGate("reliability", envelope);
  if (reason) return emitSetupFailure(emit, reason);
  let dependencies: BuilderRecordUpdateLiveDependencies;
  try {
    dependencies = await resolveDependencies(overrides);
  } catch {
    return emitSetupFailure(emit, "dependency_initialization_failed");
  }
  const reports: BuilderRecordUpdateEvaluationReport[] = [];
  const totals = newTotals();
  const passCounts = new Map<string, number>(
    builderRecordUpdateEvaluationScenarios.map(({ id }) => [id, 0]),
  );
  reliabilityRounds: for (
    let repetition = 1;
    repetition <= BUILDER_RECORD_UPDATE_INTENT_RELIABILITY_REPETITIONS;
    repetition += 1
  ) {
    for (const scenario of builderRecordUpdateEvaluationScenarios) {
      const result = await runScenario(
        dependencies,
        scenario,
        repetition as 1 | 2 | 3,
      );
      reports.push(result);
      updateTotals(totals, result);
      if (result.passed) {
        passCounts.set(scenario.id, (passCounts.get(scenario.id) ?? 0) + 1);
      } else {
        break reliabilityRounds;
      }
    }
  }
  const aggregate = reliabilityAggregate(totals, passCounts);
  dependencies.emit(aggregate);
  return Object.freeze({
    ran: true,
    passed:
      reports.length ===
        BUILDER_RECORD_UPDATE_INTENT_RELIABILITY_TOTAL_EXECUTIONS &&
      totals.passedExecutions ===
        BUILDER_RECORD_UPDATE_INTENT_RELIABILITY_TOTAL_EXECUTIONS &&
      totals.failedExecutions === 0 &&
      [...passCounts.values()].every(
        (count) =>
          count === BUILDER_RECORD_UPDATE_INTENT_RELIABILITY_REPETITIONS,
      ) &&
      totals.estimatedCostMicrousd <= envelope.hardCeilingMicrousd &&
      envelope.reservedCostMicrousd <= envelope.hardCeilingMicrousd,
    reports: Object.freeze(reports),
    aggregate,
  });
}

export const builderRecordUpdateSingleExecutionReservationMicrousd = 522_880;
