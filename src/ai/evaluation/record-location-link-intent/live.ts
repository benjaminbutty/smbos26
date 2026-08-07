import type { AiExecutionResult } from "../../execution";
import { createAiExecutionService } from "../../execution";
import {
  BUILDER_RECORD_LOCATION_LINK_INTENT_TERRA_MEDIUM_POLICY_KEY,
  OPENAI_BUILDER_RECORD_LOCATION_LINK_INTENT_MODEL_KEY,
  OPENAI_BUILDER_RECORD_LOCATION_LINK_INTENT_REASONING_EFFORT,
  openAiBuilderRecordLocationLinkIntentPolicy,
} from "../../policies";
import { builderRecordLocationLinkIntentTaskV1 } from "../../record-location-link-intent/task";
import { OpenAiInvalidRequestDiagnostic } from "../../providers/openai-diagnostics";
import {
  BUILDER_RECORD_LOCATION_LINK_INTENT_QUALIFICATION_HARD_CEILING_MICROUSD,
  BUILDER_RECORD_LOCATION_LINK_INTENT_QUALIFICATION_SCENARIO_COUNT,
  BUILDER_RECORD_LOCATION_LINK_INTENT_RELIABILITY_HARD_CEILING_MICROUSD,
  BUILDER_RECORD_LOCATION_LINK_INTENT_RELIABILITY_REPETITIONS,
  BUILDER_RECORD_LOCATION_LINK_INTENT_RELIABILITY_TOTAL_EXECUTIONS,
  deriveBuilderRecordLocationLinkQualificationEnvelope,
  deriveBuilderRecordLocationLinkReliabilityEnvelope,
} from "./envelope";
import {
  BUILDER_RECORD_LOCATION_LINK_EVALUATION_SCENARIO_IDS,
  builderRecordLocationLinkEvaluationScenarios,
  type BuilderRecordLocationLinkEvaluationScenario,
} from "./scenarios";
import {
  builderRecordLocationLinkEvaluationQualificationAggregateSchema,
  builderRecordLocationLinkEvaluationReliabilityAggregateSchema,
  builderRecordLocationLinkEvaluationSetupFailureSchema,
  type BuilderRecordLocationLinkEvaluationReport,
  type BuilderRecordLocationLinkEvaluationSetupReason,
} from "./schemas";
import {
  classifyOutputInvalidFailure,
  evaluateBuilderRecordLocationLinkIntent,
  executionFailureReport,
  failureAccounting,
  safeErrorCode,
} from "./evaluator";

export interface BuilderRecordLocationLinkQualificationEnvironment {
  RUN_LIVE_OPENAI_RECORD_LOCATION_LINK_TERRA_QUALIFICATION?: string | undefined;
  AI_PROVIDER?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
}

export interface BuilderRecordLocationLinkReliabilityEnvironment {
  RUN_LIVE_OPENAI_RECORD_LOCATION_LINK_TERRA_RELIABILITY?: string | undefined;
  AI_PROVIDER?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
}

export interface BuilderRecordLocationLinkLiveDependencies {
  execute(
    taskKey: "builder_record_location_link_intent_v1",
    input: unknown,
  ): Promise<AiExecutionResult>;
  now(): number;
  emit(value: unknown): void;
}

export interface BuilderRecordLocationLinkLiveOverrides {
  execute?: BuilderRecordLocationLinkLiveDependencies["execute"];
  now?: () => number;
  emit?: (value: unknown) => void;
  loadDependencies?: () => Promise<BuilderRecordLocationLinkLiveDependencies>;
  deriveQualificationEnvelope?: typeof deriveBuilderRecordLocationLinkQualificationEnvelope;
  deriveReliabilityEnvelope?: typeof deriveBuilderRecordLocationLinkReliabilityEnvelope;
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

const expectedPolicy = Object.freeze({
  key: BUILDER_RECORD_LOCATION_LINK_INTENT_TERRA_MEDIUM_POLICY_KEY,
  providerKey: "openai",
  modelKey: OPENAI_BUILDER_RECORD_LOCATION_LINK_INTENT_MODEL_KEY,
  maxInputBytes: 160 * 1024,
  maxBillableInputTokens: 48_000,
  maxOutputTokens: 1_536,
  timeoutMs: 30_000,
  maxAttempts: 2,
  retryDelayMs: 250,
  retryableFailureKinds: ["rate_limited", "transient"] as const,
  inputMicrousdPerMillion: 2_500_000,
  outputMicrousdPerMillion: 15_000_000,
});

const exactSingleExecutionReservation =
  openAiBuilderRecordLocationLinkIntentPolicy.maxBillableInputTokens *
    openAiBuilderRecordLocationLinkIntentPolicy.maxAttempts *
    (openAiBuilderRecordLocationLinkIntentPolicy.inputMicrousdPerMillion /
      1_000_000) +
  openAiBuilderRecordLocationLinkIntentPolicy.maxOutputTokens *
    openAiBuilderRecordLocationLinkIntentPolicy.maxAttempts *
    (openAiBuilderRecordLocationLinkIntentPolicy.outputMicrousdPerMillion /
      1_000_000);

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

export function liveBuilderRecordLocationLinkQualificationIsActivated(
  environment: BuilderRecordLocationLinkQualificationEnvironment,
): boolean {
  return activated(
    environment.RUN_LIVE_OPENAI_RECORD_LOCATION_LINK_TERRA_QUALIFICATION,
    environment,
  );
}

export function liveBuilderRecordLocationLinkReliabilityIsActivated(
  environment: BuilderRecordLocationLinkReliabilityEnvironment,
): boolean {
  return activated(
    environment.RUN_LIVE_OPENAI_RECORD_LOCATION_LINK_TERRA_RELIABILITY,
    environment,
  );
}

async function defaultDependencies(): Promise<BuilderRecordLocationLinkLiveDependencies> {
  const { aiExecutionPolicies, registeredAiTasks, structuredAiProviders } =
    await import("../../registry");
  const task = Object.freeze({
    ...builderRecordLocationLinkIntentTaskV1,
    policyKey: BUILDER_RECORD_LOCATION_LINK_INTENT_TERRA_MEDIUM_POLICY_KEY,
  });
  const execution = createAiExecutionService({
    tasks: {
      ...registeredAiTasks,
      builder_record_location_link_intent_v1: task,
    },
    policies: {
      ...aiExecutionPolicies,
      [BUILDER_RECORD_LOCATION_LINK_INTENT_TERRA_MEDIUM_POLICY_KEY]:
        openAiBuilderRecordLocationLinkIntentPolicy,
    },
    providers: structuredAiProviders,
  });
  return {
    execute: (taskKey, input) => execution.execute(taskKey, input),
    now: () => performance.now(),
    emit: (value) => console.log(JSON.stringify(value)),
  };
}

function setupFailure(
  reasonCode: BuilderRecordLocationLinkEvaluationSetupReason,
) {
  return builderRecordLocationLinkEvaluationSetupFailureSchema.parse({
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
    openAiBuilderRecordLocationLinkIntentPolicy.key === expectedPolicy.key &&
    openAiBuilderRecordLocationLinkIntentPolicy.providerKey ===
      expectedPolicy.providerKey &&
    openAiBuilderRecordLocationLinkIntentPolicy.modelKey ===
      expectedPolicy.modelKey &&
    openAiBuilderRecordLocationLinkIntentPolicy.maxInputBytes ===
      expectedPolicy.maxInputBytes &&
    openAiBuilderRecordLocationLinkIntentPolicy.maxBillableInputTokens ===
      expectedPolicy.maxBillableInputTokens &&
    openAiBuilderRecordLocationLinkIntentPolicy.maxOutputTokens ===
      expectedPolicy.maxOutputTokens &&
    openAiBuilderRecordLocationLinkIntentPolicy.timeoutMs ===
      expectedPolicy.timeoutMs &&
    openAiBuilderRecordLocationLinkIntentPolicy.maxAttempts ===
      expectedPolicy.maxAttempts &&
    openAiBuilderRecordLocationLinkIntentPolicy.retryDelayMs ===
      expectedPolicy.retryDelayMs &&
    arraysEqual(
      openAiBuilderRecordLocationLinkIntentPolicy.retryableFailureKinds,
      expectedPolicy.retryableFailureKinds,
    ) &&
    openAiBuilderRecordLocationLinkIntentPolicy.inputMicrousdPerMillion ===
      expectedPolicy.inputMicrousdPerMillion &&
    openAiBuilderRecordLocationLinkIntentPolicy.outputMicrousdPerMillion ===
      expectedPolicy.outputMicrousdPerMillion
  );
}

function preflightGate(
  gate: "qualification" | "reliability",
  envelope: GateEnvelope,
): BuilderRecordLocationLinkEvaluationSetupReason | null {
  if (
    builderRecordLocationLinkEvaluationScenarios.length !==
    BUILDER_RECORD_LOCATION_LINK_INTENT_QUALIFICATION_SCENARIO_COUNT
  ) {
    return "scenario_count_mismatch";
  }
  if (
    !arraysEqual(
      builderRecordLocationLinkEvaluationScenarios.map(({ id }) => id),
      BUILDER_RECORD_LOCATION_LINK_EVALUATION_SCENARIO_IDS,
    )
  ) {
    return "scenario_order_mismatch";
  }
  if (
    builderRecordLocationLinkIntentTaskV1.key !==
      "builder_record_location_link_intent_v1" ||
    builderRecordLocationLinkIntentTaskV1.version !== 1
  ) {
    return "task_identity_mismatch";
  }
  if (!policyMatches()) return "policy_envelope_mismatch";
  if (
    envelope.taskKey !== "builder_record_location_link_intent_v1" ||
    envelope.policyKey !==
      BUILDER_RECORD_LOCATION_LINK_INTENT_TERRA_MEDIUM_POLICY_KEY ||
    envelope.modelKey !==
      OPENAI_BUILDER_RECORD_LOCATION_LINK_INTENT_MODEL_KEY ||
    envelope.reasoningEffort !==
      OPENAI_BUILDER_RECORD_LOCATION_LINK_INTENT_REASONING_EFFORT
  ) {
    return "policy_identity_mismatch";
  }
  if (
    envelope.reservedCostMicrousdPerExecution !==
      exactSingleExecutionReservation ||
    envelope.reservedCostMicrousd !==
      exactSingleExecutionReservation *
        (gate === "qualification"
          ? BUILDER_RECORD_LOCATION_LINK_INTENT_QUALIFICATION_SCENARIO_COUNT
          : BUILDER_RECORD_LOCATION_LINK_INTENT_RELIABILITY_TOTAL_EXECUTIONS)
  ) {
    return "reservation_envelope_mismatch";
  }
  if (
    envelope.hardCeilingMicrousd !==
    (gate === "qualification"
      ? BUILDER_RECORD_LOCATION_LINK_INTENT_QUALIFICATION_HARD_CEILING_MICROUSD
      : BUILDER_RECORD_LOCATION_LINK_INTENT_RELIABILITY_HARD_CEILING_MICROUSD)
  ) {
    return gate === "qualification"
      ? "qualification_ceiling_mismatch"
      : "reliability_ceiling_mismatch";
  }
  if (gate === "reliability") {
    if (BUILDER_RECORD_LOCATION_LINK_INTENT_RELIABILITY_REPETITIONS !== 3) {
      return "repetition_count_mismatch";
    }
    if (
      BUILDER_RECORD_LOCATION_LINK_INTENT_RELIABILITY_TOTAL_EXECUTIONS !==
      BUILDER_RECORD_LOCATION_LINK_INTENT_QUALIFICATION_SCENARIO_COUNT * 3
    ) {
      return "execution_count_mismatch";
    }
  }
  return null;
}

function providerReasonCode(
  cause: unknown,
): BuilderRecordLocationLinkEvaluationReport["provider_reason_code"] {
  const seen = new Set<object>();
  let current: unknown = cause;
  for (let depth = 0; depth < 5 && current !== undefined; depth += 1) {
    if (current instanceof OpenAiInvalidRequestDiagnostic) {
      return current.reasonCode;
    }
    if (
      (typeof current === "object" && current !== null) ||
      typeof current === "function"
    ) {
      const objectCause = current as object;
      if (seen.has(objectCause)) break;
      seen.add(objectCause);
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
  report: BuilderRecordLocationLinkEvaluationReport,
) {
  if (report.passed) totals.passedExecutions += 1;
  else totals.failedExecutions += 1;
  totals.attempts += report.attempts;
  totals.inputTokens += report.input_tokens;
  totals.outputTokens += report.output_tokens;
  totals.estimatedCostMicrousd += report.estimated_microusd;
  totals.elapsedMs += report.elapsed_ms;
}

function dependenciesFor(
  overrides: BuilderRecordLocationLinkLiveOverrides,
): BuilderRecordLocationLinkLiveDependencies {
  return {
    execute:
      overrides.execute as BuilderRecordLocationLinkLiveDependencies["execute"],
    now: overrides.now ?? (() => performance.now()),
    emit:
      overrides.emit ??
      ((value: unknown) => console.log(JSON.stringify(value))),
  };
}

async function resolveDependencies(
  overrides: BuilderRecordLocationLinkLiveOverrides,
): Promise<BuilderRecordLocationLinkLiveDependencies> {
  if (overrides.execute) return dependenciesFor(overrides);
  const loaded = await (overrides.loadDependencies ?? defaultDependencies)();
  return {
    execute: loaded.execute,
    now: overrides.now ?? loaded.now,
    emit: overrides.emit ?? loaded.emit,
  };
}

async function runScenario(
  dependencies: BuilderRecordLocationLinkLiveDependencies,
  scenario: BuilderRecordLocationLinkEvaluationScenario,
  repetition: 1 | 2 | 3,
): Promise<BuilderRecordLocationLinkEvaluationReport> {
  const started = dependencies.now();
  try {
    const execution = await dependencies.execute(
      "builder_record_location_link_intent_v1",
      scenario.input,
    );
    const report = evaluateBuilderRecordLocationLinkIntent(
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
    dependencies.emit(report);
    return report;
  } catch (cause) {
    const usage = failureAccounting(cause);
    const errorCode = safeErrorCode(cause);
    const classification =
      errorCode === "ai_output_invalid"
        ? classifyOutputInvalidFailure(cause)
        : {
            failureClass: "provider_execution" as const,
            failedGateCode: "provider_execution" as const,
            validationReasonCode: null,
          };
    const report = executionFailureReport(
      scenario,
      {
        ...usage,
        elapsedMs: Math.max(0, Math.round(dependencies.now() - started)),
      },
      errorCode,
      repetition,
      {
        ...classification,
        providerReasonCode: providerReasonCode(cause),
      },
    );
    dependencies.emit(report);
    return report;
  }
}

function emitSetupFailure(
  emit: (value: unknown) => void,
  reason: BuilderRecordLocationLinkEvaluationSetupReason,
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
  return builderRecordLocationLinkEvaluationQualificationAggregateSchema.parse({
    schema_version: 1,
    gate: "qualification",
    model_key: OPENAI_BUILDER_RECORD_LOCATION_LINK_INTENT_MODEL_KEY,
    policy_key: BUILDER_RECORD_LOCATION_LINK_INTENT_TERRA_MEDIUM_POLICY_KEY,
    reasoning_effort:
      OPENAI_BUILDER_RECORD_LOCATION_LINK_INTENT_REASONING_EFFORT,
    total_scenarios: 8,
    passed_scenarios: totals.passedExecutions,
    failed_scenarios: totals.failedExecutions,
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
    (count) =>
      count === BUILDER_RECORD_LOCATION_LINK_INTENT_RELIABILITY_REPETITIONS,
  ).length;
  return builderRecordLocationLinkEvaluationReliabilityAggregateSchema.parse({
    schema_version: 1,
    gate: "reliability",
    model_key: OPENAI_BUILDER_RECORD_LOCATION_LINK_INTENT_MODEL_KEY,
    policy_key: BUILDER_RECORD_LOCATION_LINK_INTENT_TERRA_MEDIUM_POLICY_KEY,
    reasoning_effort:
      OPENAI_BUILDER_RECORD_LOCATION_LINK_INTENT_REASONING_EFFORT,
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
    per_scenario_pass_counts: builderRecordLocationLinkEvaluationScenarios.map(
      ({ id }) => ({
        scenario_id: id,
        passed_count: passCounts.get(id) ?? 0,
      }),
    ),
  });
}

export async function runLiveBuilderRecordLocationLinkQualification(
  environment: BuilderRecordLocationLinkQualificationEnvironment,
  overrides: BuilderRecordLocationLinkLiveOverrides = {},
) {
  if (!liveBuilderRecordLocationLinkQualificationIsActivated(environment)) {
    return { ran: false, passed: false } as const;
  }
  const emit =
    overrides.emit ?? ((value: unknown) => console.log(JSON.stringify(value)));
  let envelope: GateEnvelope;
  try {
    envelope = (
      overrides.deriveQualificationEnvelope ??
      deriveBuilderRecordLocationLinkQualificationEnvelope
    )() as GateEnvelope;
  } catch {
    return emitSetupFailure(emit, "reservation_envelope_mismatch");
  }
  const setupReason = preflightGate("qualification", envelope);
  if (setupReason) return emitSetupFailure(emit, setupReason);

  let dependencies: BuilderRecordLocationLinkLiveDependencies;
  try {
    dependencies = await resolveDependencies(overrides);
  } catch {
    return emitSetupFailure(emit, "dependency_initialization_failed");
  }

  const reports: BuilderRecordLocationLinkEvaluationReport[] = [];
  const totals = newTotals();
  for (const scenario of builderRecordLocationLinkEvaluationScenarios) {
    const report = await runScenario(dependencies, scenario, 1);
    reports.push(report);
    updateTotals(totals, report);
    if (!report.passed) break;
  }
  dependencies.emit(qualificationAggregate(totals));
  return Object.freeze({
    ran: true,
    passed:
      reports.length === 8 &&
      totals.passedExecutions === 8 &&
      totals.failedExecutions === 0 &&
      totals.estimatedCostMicrousd < envelope.hardCeilingMicrousd &&
      envelope.reservedCostMicrousd <= envelope.hardCeilingMicrousd,
    reports: Object.freeze(reports),
  });
}

export async function runLiveBuilderRecordLocationLinkReliability(
  environment: BuilderRecordLocationLinkReliabilityEnvironment,
  overrides: BuilderRecordLocationLinkLiveOverrides = {},
) {
  if (!liveBuilderRecordLocationLinkReliabilityIsActivated(environment)) {
    return { ran: false, passed: false } as const;
  }
  const emit =
    overrides.emit ?? ((value: unknown) => console.log(JSON.stringify(value)));
  let envelope: GateEnvelope;
  try {
    envelope = (
      overrides.deriveReliabilityEnvelope ??
      deriveBuilderRecordLocationLinkReliabilityEnvelope
    )() as GateEnvelope;
  } catch {
    return emitSetupFailure(emit, "reservation_envelope_mismatch");
  }
  const setupReason = preflightGate("reliability", envelope);
  if (setupReason) return emitSetupFailure(emit, setupReason);

  let dependencies: BuilderRecordLocationLinkLiveDependencies;
  try {
    dependencies = await resolveDependencies(overrides);
  } catch {
    return emitSetupFailure(emit, "dependency_initialization_failed");
  }

  const reports: BuilderRecordLocationLinkEvaluationReport[] = [];
  const totals = newTotals();
  const passCounts = new Map<string, number>(
    builderRecordLocationLinkEvaluationScenarios.map(({ id }) => [id, 0]),
  );
  reliabilityRounds: for (
    let repetition = 1;
    repetition <= BUILDER_RECORD_LOCATION_LINK_INTENT_RELIABILITY_REPETITIONS;
    repetition += 1
  ) {
    for (const scenario of builderRecordLocationLinkEvaluationScenarios) {
      const report = await runScenario(
        dependencies,
        scenario,
        repetition as 1 | 2 | 3,
      );
      reports.push(report);
      updateTotals(totals, report);
      if (report.passed) {
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
        BUILDER_RECORD_LOCATION_LINK_INTENT_RELIABILITY_TOTAL_EXECUTIONS &&
      totals.passedExecutions ===
        BUILDER_RECORD_LOCATION_LINK_INTENT_RELIABILITY_TOTAL_EXECUTIONS &&
      totals.failedExecutions === 0 &&
      [...passCounts.values()].every(
        (count) =>
          count === BUILDER_RECORD_LOCATION_LINK_INTENT_RELIABILITY_REPETITIONS,
      ) &&
      totals.estimatedCostMicrousd < envelope.hardCeilingMicrousd &&
      envelope.reservedCostMicrousd <= envelope.hardCeilingMicrousd,
    reports: Object.freeze(reports),
  });
}

export const builderRecordLocationLinkSingleExecutionReservationMicrousd =
  exactSingleExecutionReservation;
