import { ZodError } from "zod";

import { StructuredAiProviderError } from "../../contracts";
import type { AiExecutionResult } from "../../execution";
import { createAiExecutionService } from "../../execution";
import { AiExecutionError } from "../../errors";
import {
  BUILDER_RECORD_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
  OPENAI_BUILDER_RECORD_CREATION_INTENT_MODEL_KEY,
  OPENAI_BUILDER_RECORD_CREATION_INTENT_REASONING_EFFORT,
  openAiBuilderRecordCreationIntentPolicy,
} from "../../policies";
import { builderRecordCreationIntentTaskV1 } from "../../record-creation-intent/task";
import {
  BUILDER_RECORD_CREATION_INTENT_QUALIFICATION_SCENARIO_COUNT,
  BUILDER_RECORD_CREATION_INTENT_QUALIFICATION_HARD_CEILING_MICROUSD,
  BUILDER_RECORD_CREATION_INTENT_RELIABILITY_HARD_CEILING_MICROUSD,
  BUILDER_RECORD_CREATION_INTENT_RELIABILITY_REPETITIONS,
  BUILDER_RECORD_CREATION_INTENT_RELIABILITY_TOTAL_EXECUTIONS,
  deriveBuilderRecordCreationQualificationEnvelope,
  deriveBuilderRecordCreationReliabilityEnvelope,
} from "./envelope";
import {
  BUILDER_RECORD_CREATION_EVALUATION_SCENARIO_IDS,
  builderRecordCreationEvaluationScenarios,
  type BuilderRecordCreationEvaluationScenario,
} from "./scenarios";
import {
  builderRecordCreationEvaluationQualificationAggregateSchema,
  builderRecordCreationEvaluationReliabilityAggregateSchema,
  builderRecordCreationEvaluationSetupFailureSchema,
  type BuilderRecordCreationEvaluationReport,
  type BuilderRecordCreationEvaluationSetupReason,
} from "./schemas";
import {
  evaluateBuilderRecordCreationIntent,
  executionFailureReport,
  failureAccounting,
  safeErrorCode,
} from "./evaluator";

export interface BuilderRecordCreationQualificationEnvironment {
  RUN_LIVE_OPENAI_RECORD_CREATION_TERRA_QUALIFICATION?: string | undefined;
  AI_PROVIDER?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
}

export interface BuilderRecordCreationReliabilityEnvironment {
  RUN_LIVE_OPENAI_RECORD_CREATION_TERRA_RELIABILITY?: string | undefined;
  AI_PROVIDER?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
}

export interface BuilderRecordCreationLiveDependencies {
  execute(
    taskKey: "builder_record_creation_intent_v1",
    input: unknown,
  ): Promise<AiExecutionResult>;
  now(): number;
  emit(value: unknown): void;
}

export interface BuilderRecordCreationLiveOverrides {
  execute?: BuilderRecordCreationLiveDependencies["execute"];
  now?: () => number;
  emit?: (value: unknown) => void;
  loadDependencies?: () => Promise<BuilderRecordCreationLiveDependencies>;
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
  key: BUILDER_RECORD_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
  providerKey: "openai",
  modelKey: OPENAI_BUILDER_RECORD_CREATION_INTENT_MODEL_KEY,
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

const exactSingleExecutionReservation = 522_880;

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

export function liveBuilderRecordCreationQualificationIsActivated(
  environment: BuilderRecordCreationQualificationEnvironment,
): boolean {
  return activated(
    environment.RUN_LIVE_OPENAI_RECORD_CREATION_TERRA_QUALIFICATION,
    environment,
  );
}

export function liveBuilderRecordCreationReliabilityIsActivated(
  environment: BuilderRecordCreationReliabilityEnvironment,
): boolean {
  return activated(
    environment.RUN_LIVE_OPENAI_RECORD_CREATION_TERRA_RELIABILITY,
    environment,
  );
}

async function defaultDependencies(): Promise<BuilderRecordCreationLiveDependencies> {
  const { aiExecutionPolicies, registeredAiTasks, structuredAiProviders } =
    await import("../../registry");
  const task = Object.freeze({
    ...builderRecordCreationIntentTaskV1,
    policyKey: BUILDER_RECORD_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
  });
  const execution = createAiExecutionService({
    tasks: { ...registeredAiTasks, builder_record_creation_intent_v1: task },
    policies: {
      ...aiExecutionPolicies,
      [BUILDER_RECORD_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY]:
        openAiBuilderRecordCreationIntentPolicy,
    },
    providers: structuredAiProviders,
  });
  return {
    execute: (taskKey, input) => execution.execute(taskKey, input),
    now: () => performance.now(),
    emit: (value) => console.log(JSON.stringify(value)),
  };
}

function setupFailure(reasonCode: BuilderRecordCreationEvaluationSetupReason) {
  return builderRecordCreationEvaluationSetupFailureSchema.parse({
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
        openAiBuilderRecordCreationIntentPolicy[
          key as keyof typeof openAiBuilderRecordCreationIntentPolicy
        ];
      return Array.isArray(expected) && Array.isArray(actual)
        ? arraysEqual(actual, expected)
        : actual === expected;
    }) &&
    arraysEqual(
      openAiBuilderRecordCreationIntentPolicy.retryableFailureKinds,
      expectedPolicy.retryableFailureKinds,
    )
  );
}

function preflightGate(
  gate: "qualification" | "reliability",
  envelope: GateEnvelope,
): BuilderRecordCreationEvaluationSetupReason | null {
  if (
    builderRecordCreationEvaluationScenarios.length !==
    BUILDER_RECORD_CREATION_INTENT_QUALIFICATION_SCENARIO_COUNT
  ) {
    return "scenario_count_mismatch";
  }
  if (
    !arraysEqual(
      builderRecordCreationEvaluationScenarios.map(({ id }) => id),
      BUILDER_RECORD_CREATION_EVALUATION_SCENARIO_IDS,
    )
  ) {
    return "scenario_order_mismatch";
  }
  if (
    builderRecordCreationIntentTaskV1.key !==
      "builder_record_creation_intent_v1" ||
    builderRecordCreationIntentTaskV1.version !== 1
  ) {
    return "task_identity_mismatch";
  }
  if (!policyMatches()) return "policy_envelope_mismatch";
  if (
    envelope.taskKey !== "builder_record_creation_intent_v1" ||
    envelope.policyKey !==
      BUILDER_RECORD_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY ||
    envelope.modelKey !== OPENAI_BUILDER_RECORD_CREATION_INTENT_MODEL_KEY ||
    envelope.reasoningEffort !==
      OPENAI_BUILDER_RECORD_CREATION_INTENT_REASONING_EFFORT
  ) {
    return "policy_identity_mismatch";
  }
  const expectedExecutions =
    gate === "qualification"
      ? BUILDER_RECORD_CREATION_INTENT_QUALIFICATION_SCENARIO_COUNT
      : BUILDER_RECORD_CREATION_INTENT_RELIABILITY_TOTAL_EXECUTIONS;
  if (
    envelope.reservedCostMicrousdPerExecution !==
      exactSingleExecutionReservation ||
    envelope.reservedCostMicrousd !==
      exactSingleExecutionReservation * expectedExecutions
  ) {
    return "reservation_envelope_mismatch";
  }
  if (
    envelope.hardCeilingMicrousd !==
    (gate === "qualification"
      ? BUILDER_RECORD_CREATION_INTENT_QUALIFICATION_HARD_CEILING_MICROUSD
      : BUILDER_RECORD_CREATION_INTENT_RELIABILITY_HARD_CEILING_MICROUSD)
  ) {
    return gate === "qualification"
      ? "qualification_ceiling_mismatch"
      : "reliability_ceiling_mismatch";
  }
  if (gate === "reliability") {
    if (BUILDER_RECORD_CREATION_INTENT_RELIABILITY_REPETITIONS !== 3) {
      return "repetition_count_mismatch";
    }
    if (
      BUILDER_RECORD_CREATION_INTENT_RELIABILITY_TOTAL_EXECUTIONS !==
      BUILDER_RECORD_CREATION_INTENT_QUALIFICATION_SCENARIO_COUNT * 3
    ) {
      return "execution_count_mismatch";
    }
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
  report: BuilderRecordCreationEvaluationReport,
) {
  if (report.passed) totals.passedExecutions += 1;
  else totals.failedExecutions += 1;
  totals.attempts += report.attempts;
  totals.inputTokens += report.input_tokens;
  totals.outputTokens += report.output_tokens;
  totals.estimatedCostMicrousd += report.estimated_microusd;
  totals.elapsedMs += report.elapsed_ms;
}

function safeOutputFailureCause(cause: unknown) {
  if (cause instanceof AiExecutionError && cause.code === "ai_output_invalid") {
    let current: unknown = cause.cause;
    const seen = new Set<object>();
    for (let depth = 0; depth < 5 && current !== undefined; depth += 1) {
      if (current instanceof StructuredAiProviderError) return current;
      if (current instanceof ZodError) return current;
      if (typeof current === "object" && current !== null) {
        if (seen.has(current)) break;
        seen.add(current);
      }
      if (
        typeof current !== "object" ||
        current === null ||
        !("cause" in current)
      ) {
        break;
      }
      current = (current as { cause?: unknown }).cause;
    }
  }
  return cause;
}

async function resolveDependencies(
  overrides: BuilderRecordCreationLiveOverrides,
): Promise<BuilderRecordCreationLiveDependencies> {
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
  dependencies: BuilderRecordCreationLiveDependencies,
  scenario: BuilderRecordCreationEvaluationScenario,
  repetition: 1 | 2 | 3,
) {
  const started = dependencies.now();
  try {
    const execution = await dependencies.execute(
      "builder_record_creation_intent_v1",
      scenario.input,
    );
    const result = evaluateBuilderRecordCreationIntent(
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
      safeOutputFailureCause(cause),
    );
    dependencies.emit(result);
    return result;
  }
}

function emitSetupFailure(
  emit: (value: unknown) => void,
  reason: BuilderRecordCreationEvaluationSetupReason,
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
  return builderRecordCreationEvaluationQualificationAggregateSchema.parse({
    schema_version: 1,
    gate: "qualification",
    model_key: OPENAI_BUILDER_RECORD_CREATION_INTENT_MODEL_KEY,
    policy_key: BUILDER_RECORD_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
    reasoning_effort: OPENAI_BUILDER_RECORD_CREATION_INTENT_REASONING_EFFORT,
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
    (passedCount) => passedCount === 3,
  ).length;
  const failedScenarios = [...passCounts.values()].filter(
    (passedCount) => passedCount < 3,
  ).length;
  return builderRecordCreationEvaluationReliabilityAggregateSchema.parse({
    schema_version: 1,
    gate: "reliability",
    model_key: OPENAI_BUILDER_RECORD_CREATION_INTENT_MODEL_KEY,
    policy_key: BUILDER_RECORD_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
    reasoning_effort: OPENAI_BUILDER_RECORD_CREATION_INTENT_REASONING_EFFORT,
    total_scenarios: 8,
    passed_scenarios: passedScenarios,
    failed_scenarios: failedScenarios,
    total_attempts: totals.attempts,
    total_input_tokens: totals.inputTokens,
    total_output_tokens: totals.outputTokens,
    total_estimated_cost_microusd: totals.estimatedCostMicrousd,
    total_elapsed_ms: totals.elapsedMs,
    repetitions_per_scenario: 3,
    total_executions: 24,
    passed_executions: totals.passedExecutions,
    failed_executions: totals.failedExecutions,
    per_scenario_pass_counts: builderRecordCreationEvaluationScenarios.map(
      ({ id }) => ({ scenario_id: id, passed_count: passCounts.get(id) ?? 0 }),
    ),
  });
}

export async function runLiveBuilderRecordCreationQualification(
  environment: BuilderRecordCreationQualificationEnvironment,
  overrides: BuilderRecordCreationLiveOverrides = {},
) {
  if (!liveBuilderRecordCreationQualificationIsActivated(environment)) {
    return { ran: false, passed: false } as const;
  }
  const emit =
    overrides.emit ?? ((value: unknown) => console.log(JSON.stringify(value)));
  let envelope: GateEnvelope;
  try {
    envelope = (
      overrides.deriveQualificationEnvelope ??
      deriveBuilderRecordCreationQualificationEnvelope
    )() as GateEnvelope;
  } catch {
    return emitSetupFailure(emit, "reservation_envelope_mismatch");
  }
  const reason = preflightGate("qualification", envelope);
  if (reason) return emitSetupFailure(emit, reason);
  let dependencies: BuilderRecordCreationLiveDependencies;
  try {
    dependencies = await resolveDependencies(overrides);
  } catch {
    return emitSetupFailure(emit, "dependency_initialization_failed");
  }
  const reports: BuilderRecordCreationEvaluationReport[] = [];
  const totals = newTotals();
  for (const scenario of builderRecordCreationEvaluationScenarios) {
    const result = await runScenario(dependencies, scenario, 1);
    reports.push(result);
    updateTotals(totals, result);
    if (!result.passed) break;
  }
  dependencies.emit(qualificationAggregate(totals));
  return Object.freeze({
    ran: true,
    passed:
      reports.length === 8 &&
      totals.passedExecutions === 8 &&
      totals.failedExecutions === 0 &&
      totals.estimatedCostMicrousd <= envelope.hardCeilingMicrousd &&
      envelope.reservedCostMicrousd <= envelope.hardCeilingMicrousd,
    reports: Object.freeze(reports),
  });
}

export async function runLiveBuilderRecordCreationReliability(
  environment: BuilderRecordCreationReliabilityEnvironment,
  overrides: BuilderRecordCreationLiveOverrides = {},
) {
  if (!liveBuilderRecordCreationReliabilityIsActivated(environment)) {
    return { ran: false, passed: false } as const;
  }
  const emit =
    overrides.emit ?? ((value: unknown) => console.log(JSON.stringify(value)));
  let envelope: GateEnvelope;
  try {
    envelope = (
      overrides.deriveReliabilityEnvelope ??
      deriveBuilderRecordCreationReliabilityEnvelope
    )() as GateEnvelope;
  } catch {
    return emitSetupFailure(emit, "reservation_envelope_mismatch");
  }
  const reason = preflightGate("reliability", envelope);
  if (reason) return emitSetupFailure(emit, reason);
  let dependencies: BuilderRecordCreationLiveDependencies;
  try {
    dependencies = await resolveDependencies(overrides);
  } catch {
    return emitSetupFailure(emit, "dependency_initialization_failed");
  }
  const reports: BuilderRecordCreationEvaluationReport[] = [];
  const totals = newTotals();
  const passCounts = new Map<string, number>(
    builderRecordCreationEvaluationScenarios.map(({ id }) => [id, 0]),
  );
  reliabilityRounds: for (
    let repetition = 1;
    repetition <= BUILDER_RECORD_CREATION_INTENT_RELIABILITY_REPETITIONS;
    repetition += 1
  ) {
    for (const scenario of builderRecordCreationEvaluationScenarios) {
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
  dependencies.emit(reliabilityAggregate(totals, passCounts));
  return Object.freeze({
    ran: true,
    passed:
      reports.length ===
        BUILDER_RECORD_CREATION_INTENT_RELIABILITY_TOTAL_EXECUTIONS &&
      totals.passedExecutions ===
        BUILDER_RECORD_CREATION_INTENT_RELIABILITY_TOTAL_EXECUTIONS &&
      totals.failedExecutions === 0 &&
      [...passCounts.values()].every(
        (count) =>
          count === BUILDER_RECORD_CREATION_INTENT_RELIABILITY_REPETITIONS,
      ) &&
      totals.estimatedCostMicrousd <= envelope.hardCeilingMicrousd &&
      envelope.reservedCostMicrousd <= envelope.hardCeilingMicrousd,
    reports: Object.freeze(reports),
  });
}

export const builderRecordCreationSingleExecutionReservationMicrousd =
  exactSingleExecutionReservation;
