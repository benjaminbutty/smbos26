import { ZodError } from "zod";

import { StructuredAiProviderError } from "../../contracts";
import { calculateAiTokenCostMicrousd } from "../../accounting/cost";
import type { AiExecutionResult } from "../../execution";
import { AiExecutionError } from "../../errors";
import {
  BUILDER_LOCATION_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
  OPENAI_BUILDER_LOCATION_CREATION_MODEL_KEY,
  OPENAI_BUILDER_LOCATION_CREATION_REASONING_EFFORT,
  openAiBuilderLocationCreationPolicy,
} from "../../policies";
import { builderLocationCreationIntentTaskV1 } from "../../location-creation-intent/task";
import { BuilderLocationCreationIntentValidationError } from "../../location-creation-intent/diagnostics";
import { createAiExecutionService } from "../../execution";
import {
  builderLocationCreationEvaluationScenarios,
  BUILDER_LOCATION_CREATION_EVALUATION_SCENARIO_IDS,
  type BuilderLocationCreationEvaluationScenario,
} from "./scenarios";
import {
  deriveBuilderLocationCreationQualificationEnvelope,
  deriveBuilderLocationCreationReliabilityEnvelope,
  BUILDER_LOCATION_CREATION_INTENT_QUALIFICATION_HARD_CEILING_MICROUSD,
  BUILDER_LOCATION_CREATION_INTENT_QUALIFICATION_SCENARIO_COUNT,
  BUILDER_LOCATION_CREATION_INTENT_RELIABILITY_HARD_CEILING_MICROUSD,
  BUILDER_LOCATION_CREATION_INTENT_RELIABILITY_REPETITIONS,
  BUILDER_LOCATION_CREATION_INTENT_RELIABILITY_TOTAL_EXECUTIONS,
} from "./envelope";
import {
  evaluateBuilderLocationCreationIntent,
  executionFailureReport,
} from "./evaluator";
import {
  builderLocationCreationEvaluationQualificationAggregateSchema,
  builderLocationCreationEvaluationReliabilityAggregateSchema,
  builderLocationCreationEvaluationSetupFailureSchema,
  builderLocationCreationEvaluationValidationReasonCodeSchema,
  type BuilderLocationCreationEvaluationReport,
  type BuilderLocationCreationEvaluationSetupReason,
} from "./schemas";

export interface BuilderLocationCreationQualificationEnvironment {
  RUN_LIVE_OPENAI_LOCATION_CREATION_TERRA_QUALIFICATION?: string | undefined;
  AI_PROVIDER?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
}

export interface BuilderLocationCreationReliabilityEnvironment {
  RUN_LIVE_OPENAI_LOCATION_CREATION_TERRA_RELIABILITY?: string | undefined;
  AI_PROVIDER?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
}

export interface BuilderLocationCreationLiveDependencies {
  execute(
    taskKey: "builder_location_creation_intent_v1",
    input: unknown,
  ): Promise<AiExecutionResult>;
  now(): number;
  emit(value: unknown): void;
}

export interface BuilderLocationCreationLiveOverrides {
  execute?: BuilderLocationCreationLiveDependencies["execute"];
  now?: () => number;
  emit?: (value: unknown) => void;
  loadDependencies?: () => Promise<BuilderLocationCreationLiveDependencies>;
  deriveQualificationEnvelope?: typeof deriveBuilderLocationCreationQualificationEnvelope;
  deriveReliabilityEnvelope?: typeof deriveBuilderLocationCreationReliabilityEnvelope;
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
  key: BUILDER_LOCATION_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
  providerKey: "openai",
  modelKey: OPENAI_BUILDER_LOCATION_CREATION_MODEL_KEY,
  maxInputBytes: 256 * 1024,
  maxBillableInputTokens: 80_000,
  maxOutputTokens: 2_048,
  timeoutMs: 30_000,
  maxAttempts: 2,
  retryDelayMs: 250,
  retryableFailureKinds: ["rate_limited", "transient"],
  inputMicrousdPerMillion: 2_500_000,
  outputMicrousdPerMillion: 15_000_000,
});

const exactSingleExecutionReservation = calculateAiTokenCostMicrousd({
  inputTokens:
    expectedPolicy.maxBillableInputTokens * expectedPolicy.maxAttempts,
  outputTokens: expectedPolicy.maxOutputTokens * expectedPolicy.maxAttempts,
  inputMicrousdPerMillion: expectedPolicy.inputMicrousdPerMillion,
  outputMicrousdPerMillion: expectedPolicy.outputMicrousdPerMillion,
});

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

export function liveBuilderLocationCreationQualificationIsActivated(
  environment: BuilderLocationCreationQualificationEnvironment,
): boolean {
  return activated(
    environment.RUN_LIVE_OPENAI_LOCATION_CREATION_TERRA_QUALIFICATION,
    environment,
  );
}

export function liveBuilderLocationCreationReliabilityIsActivated(
  environment: BuilderLocationCreationReliabilityEnvironment,
): boolean {
  return activated(
    environment.RUN_LIVE_OPENAI_LOCATION_CREATION_TERRA_RELIABILITY,
    environment,
  );
}

async function defaultDependencies(): Promise<BuilderLocationCreationLiveDependencies> {
  // Keep registry/provider construction behind the setup preflight. Importing
  // the production registry eagerly would construct an OpenAI provider before
  // the exact live envelope had been validated.
  const { aiExecutionPolicies, registeredAiTasks, structuredAiProviders } =
    await import("../../registry");
  const task = Object.freeze({
    ...builderLocationCreationIntentTaskV1,
    policyKey: BUILDER_LOCATION_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
  });
  const execution = createAiExecutionService({
    tasks: { ...registeredAiTasks, builder_location_creation_intent_v1: task },
    policies: {
      ...aiExecutionPolicies,
      [BUILDER_LOCATION_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY]:
        openAiBuilderLocationCreationPolicy,
    },
    providers: structuredAiProviders,
  });
  return {
    execute: (taskKey, input) => execution.execute(taskKey, input),
    now: () => performance.now(),
    emit: (value) => console.log(JSON.stringify(value)),
  };
}

function setupFailureReason(
  reasonCode: BuilderLocationCreationEvaluationSetupReason,
) {
  return builderLocationCreationEvaluationSetupFailureSchema.parse({
    evaluation_error_code: "evaluation_setup_failed",
    reason_code: reasonCode,
  });
}

function arraysEqual(
  left: readonly unknown[],
  right: readonly unknown[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function policyMatches(): boolean {
  return (
    openAiBuilderLocationCreationPolicy.key === expectedPolicy.key &&
    openAiBuilderLocationCreationPolicy.providerKey ===
      expectedPolicy.providerKey &&
    openAiBuilderLocationCreationPolicy.modelKey === expectedPolicy.modelKey &&
    openAiBuilderLocationCreationPolicy.maxInputBytes ===
      expectedPolicy.maxInputBytes &&
    openAiBuilderLocationCreationPolicy.maxBillableInputTokens ===
      expectedPolicy.maxBillableInputTokens &&
    openAiBuilderLocationCreationPolicy.maxOutputTokens ===
      expectedPolicy.maxOutputTokens &&
    openAiBuilderLocationCreationPolicy.timeoutMs ===
      expectedPolicy.timeoutMs &&
    openAiBuilderLocationCreationPolicy.maxAttempts ===
      expectedPolicy.maxAttempts &&
    openAiBuilderLocationCreationPolicy.retryDelayMs ===
      expectedPolicy.retryDelayMs &&
    arraysEqual(
      openAiBuilderLocationCreationPolicy.retryableFailureKinds,
      expectedPolicy.retryableFailureKinds,
    ) &&
    openAiBuilderLocationCreationPolicy.inputMicrousdPerMillion ===
      expectedPolicy.inputMicrousdPerMillion &&
    openAiBuilderLocationCreationPolicy.outputMicrousdPerMillion ===
      expectedPolicy.outputMicrousdPerMillion
  );
}

function preflightGate(
  gate: "qualification" | "reliability",
  envelope: GateEnvelope,
): BuilderLocationCreationEvaluationSetupReason | null {
  if (
    builderLocationCreationEvaluationScenarios.length !==
    BUILDER_LOCATION_CREATION_INTENT_QUALIFICATION_SCENARIO_COUNT
  ) {
    return "scenario_count_mismatch";
  }
  if (
    !arraysEqual(
      builderLocationCreationEvaluationScenarios.map(({ id }) => id),
      BUILDER_LOCATION_CREATION_EVALUATION_SCENARIO_IDS,
    )
  ) {
    return "scenario_order_mismatch";
  }
  if (
    builderLocationCreationIntentTaskV1.key !==
      "builder_location_creation_intent_v1" ||
    builderLocationCreationIntentTaskV1.version !== 1
  ) {
    return "task_identity_mismatch";
  }
  if (!policyMatches()) {
    return "policy_envelope_mismatch";
  }
  if (
    envelope.taskKey !== "builder_location_creation_intent_v1" ||
    envelope.policyKey !==
      BUILDER_LOCATION_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY ||
    envelope.modelKey !== OPENAI_BUILDER_LOCATION_CREATION_MODEL_KEY ||
    envelope.reasoningEffort !==
      OPENAI_BUILDER_LOCATION_CREATION_REASONING_EFFORT
  ) {
    return "policy_identity_mismatch";
  }
  if (
    exactSingleExecutionReservation !== 461_440 ||
    envelope.reservedCostMicrousdPerExecution !==
      exactSingleExecutionReservation ||
    envelope.reservedCostMicrousd !==
      exactSingleExecutionReservation *
        (gate === "qualification"
          ? BUILDER_LOCATION_CREATION_INTENT_QUALIFICATION_SCENARIO_COUNT
          : BUILDER_LOCATION_CREATION_INTENT_RELIABILITY_TOTAL_EXECUTIONS)
  ) {
    return "reservation_envelope_mismatch";
  }
  if (
    envelope.hardCeilingMicrousd !==
    (gate === "qualification"
      ? BUILDER_LOCATION_CREATION_INTENT_QUALIFICATION_HARD_CEILING_MICROUSD
      : BUILDER_LOCATION_CREATION_INTENT_RELIABILITY_HARD_CEILING_MICROUSD)
  ) {
    return gate === "qualification"
      ? "qualification_ceiling_mismatch"
      : "reliability_ceiling_mismatch";
  }
  if (gate === "reliability") {
    if (BUILDER_LOCATION_CREATION_INTENT_RELIABILITY_REPETITIONS !== 3) {
      return "repetition_count_mismatch";
    }
    if (
      BUILDER_LOCATION_CREATION_INTENT_RELIABILITY_TOTAL_EXECUTIONS !==
      BUILDER_LOCATION_CREATION_INTENT_QUALIFICATION_SCENARIO_COUNT * 3
    ) {
      return "execution_count_mismatch";
    }
  }
  return null;
}

function safeErrorCode(
  cause: unknown,
): BuilderLocationCreationEvaluationReport["error_code"] {
  if (cause instanceof AiExecutionError) {
    return cause.code;
  }
  if (cause instanceof StructuredAiProviderError) {
    const mapped = {
      disabled: "ai_disabled",
      unavailable: "ai_provider_unavailable",
      rate_limited: "ai_rate_limited",
      transient: "ai_provider_unavailable",
      invalid_request: "ai_execution_failed",
      invalid_response: "ai_output_invalid",
      refused: "ai_refused",
      incomplete: "ai_incomplete",
      content_filtered: "ai_content_filtered",
    } as const;
    return mapped[cause.kind];
  }
  return "evaluation_execution_failed";
}

function nextCause(cause: unknown): unknown {
  if (typeof cause !== "object" || cause === null || !("cause" in cause)) {
    return undefined;
  }
  return (cause as { cause?: unknown }).cause;
}

function classifyOutputInvalidFailure(cause: unknown): {
  failureClass:
    | "output_contract"
    | "semantic_validation"
    | "provider_execution"
    | "unknown";
  failedGateCode:
    | "output_contract"
    | "semantic_validation"
    | "provider_execution"
    | "unknown_output";
  validationReasonCode: BuilderLocationCreationEvaluationReport["validation_reason_code"];
} {
  const seen = new Set<object>();
  let current: unknown = cause;
  for (let depth = 0; depth < 5 && current !== undefined; depth += 1) {
    if (
      current instanceof StructuredAiProviderError &&
      current.kind === "invalid_response"
    ) {
      return {
        failureClass: "provider_execution",
        failedGateCode: "provider_execution",
        validationReasonCode: "provider_invalid_response",
      };
    }
    if (current instanceof BuilderLocationCreationIntentValidationError) {
      const diagnosticCode =
        builderLocationCreationEvaluationValidationReasonCodeSchema.parse(
          current.diagnosticCode,
        );
      const outputContract = diagnosticCode === "output_contract_invalid";
      return {
        failureClass: outputContract
          ? "output_contract"
          : "semantic_validation",
        failedGateCode: outputContract
          ? "output_contract"
          : "semantic_validation",
        validationReasonCode: diagnosticCode,
      };
    }
    if (current instanceof ZodError) {
      return {
        failureClass: "output_contract",
        failedGateCode: "output_contract",
        validationReasonCode: "output_contract_invalid",
      };
    }
    if (
      (typeof current === "object" && current !== null) ||
      typeof current === "function"
    ) {
      const objectCause = current as object;
      if (seen.has(objectCause)) break;
      seen.add(objectCause);
    }
    current = nextCause(current);
  }
  return {
    failureClass: "unknown",
    failedGateCode: "unknown_output",
    validationReasonCode: "unknown_output_invalid",
  };
}

function failureClassification(
  cause: unknown,
  errorCode: BuilderLocationCreationEvaluationReport["error_code"],
) {
  if (errorCode === "ai_output_invalid") {
    return classifyOutputInvalidFailure(cause);
  }
  return {
    failureClass: "provider_execution" as const,
    failedGateCode: "provider_execution" as const,
    validationReasonCode: null,
  };
}

function boundedNumber(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function failureAccounting(cause: unknown) {
  if (cause instanceof AiExecutionError && cause.accounting) {
    return {
      attempts: boundedNumber(cause.accounting.attemptsStarted),
      inputTokens: boundedNumber(cause.accounting.inputTokens),
      outputTokens: boundedNumber(cause.accounting.outputTokens),
      usageComplete: cause.accounting.usageComplete,
    };
  }
  if (cause instanceof StructuredAiProviderError) {
    return {
      attempts: 1,
      inputTokens: boundedNumber(cause.usage?.inputTokens),
      outputTokens: boundedNumber(cause.usage?.outputTokens),
      usageComplete: Boolean(cause.usage),
    };
  }
  return {
    attempts: 0,
    inputTokens: 0,
    outputTokens: 0,
    usageComplete: false,
  };
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
  report: BuilderLocationCreationEvaluationReport,
) {
  if (report.passed) totals.passedExecutions += 1;
  else totals.failedExecutions += 1;
  totals.attempts += report.attempts;
  totals.inputTokens += report.input_tokens;
  totals.outputTokens += report.output_tokens;
  totals.estimatedCostMicrousd += report.estimated_microusd;
  totals.elapsedMs += report.elapsed_ms;
}

function emitSetupFailure(
  emit: (value: unknown) => void,
  reason: BuilderLocationCreationEvaluationSetupReason,
) {
  const failure = setupFailureReason(reason);
  emit(failure);
  return {
    ran: true as const,
    passed: false as const,
    reports: [] as const,
    setup_failure: failure,
  };
}

function dependenciesFor(
  overrides: BuilderLocationCreationLiveOverrides,
): BuilderLocationCreationLiveDependencies {
  return {
    execute:
      overrides.execute as BuilderLocationCreationLiveDependencies["execute"],
    now: overrides.now ?? (() => performance.now()),
    emit:
      overrides.emit ??
      ((value: unknown) => console.log(JSON.stringify(value))),
  };
}

async function resolveDependencies(
  overrides: BuilderLocationCreationLiveOverrides,
): Promise<BuilderLocationCreationLiveDependencies> {
  if (overrides.execute) {
    return dependenciesFor(overrides);
  }
  const loaded = await (overrides.loadDependencies ?? defaultDependencies)();
  return {
    execute: loaded.execute,
    now: overrides.now ?? loaded.now,
    emit: overrides.emit ?? loaded.emit,
  };
}

async function runScenario(
  dependencies: BuilderLocationCreationLiveDependencies,
  scenario: BuilderLocationCreationEvaluationScenario,
  repetition: 1 | 2 | 3,
): Promise<BuilderLocationCreationEvaluationReport> {
  const started = dependencies.now();
  try {
    const execution = await dependencies.execute(
      "builder_location_creation_intent_v1",
      scenario.input,
    );
    const report = evaluateBuilderLocationCreationIntent(
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
    const report = executionFailureReport(
      scenario,
      {
        ...usage,
        elapsedMs: Math.max(0, Math.round(dependencies.now() - started)),
      },
      errorCode,
      repetition,
      failureClassification(cause, errorCode),
    );
    dependencies.emit(report);
    return report;
  }
}

function qualificationAggregate(totals: GateTotals) {
  return builderLocationCreationEvaluationQualificationAggregateSchema.parse({
    schema_version: 1,
    gate: "qualification",
    model_key: OPENAI_BUILDER_LOCATION_CREATION_MODEL_KEY,
    policy_key: BUILDER_LOCATION_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
    reasoning_effort: OPENAI_BUILDER_LOCATION_CREATION_REASONING_EFFORT,
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
      count === BUILDER_LOCATION_CREATION_INTENT_RELIABILITY_REPETITIONS,
  ).length;
  return builderLocationCreationEvaluationReliabilityAggregateSchema.parse({
    schema_version: 1,
    gate: "reliability",
    model_key: OPENAI_BUILDER_LOCATION_CREATION_MODEL_KEY,
    policy_key: BUILDER_LOCATION_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
    reasoning_effort: OPENAI_BUILDER_LOCATION_CREATION_REASONING_EFFORT,
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
    per_scenario_pass_counts: builderLocationCreationEvaluationScenarios.map(
      ({ id }) => ({
        scenario_id: id,
        passed_count: passCounts.get(id) ?? 0,
      }),
    ),
  });
}

export async function runLiveBuilderLocationCreationQualification(
  environment: BuilderLocationCreationQualificationEnvironment,
  overrides: BuilderLocationCreationLiveOverrides = {},
) {
  if (!liveBuilderLocationCreationQualificationIsActivated(environment)) {
    return { ran: false, passed: false } as const;
  }

  const emit =
    overrides.emit ?? ((value: unknown) => console.log(JSON.stringify(value)));
  let envelope: GateEnvelope;
  try {
    envelope = (
      overrides.deriveQualificationEnvelope ??
      deriveBuilderLocationCreationQualificationEnvelope
    )() as GateEnvelope;
  } catch {
    return emitSetupFailure(emit, "reservation_envelope_mismatch");
  }
  const setupReason = preflightGate("qualification", envelope);
  if (setupReason) return emitSetupFailure(emit, setupReason);

  let dependencies: BuilderLocationCreationLiveDependencies;
  try {
    dependencies = await resolveDependencies(overrides);
  } catch {
    return emitSetupFailure(emit, "dependency_initialization_failed");
  }

  const reports: BuilderLocationCreationEvaluationReport[] = [];
  const totals = newTotals();
  for (const scenario of builderLocationCreationEvaluationScenarios) {
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

export async function runLiveBuilderLocationCreationReliability(
  environment: BuilderLocationCreationReliabilityEnvironment,
  overrides: BuilderLocationCreationLiveOverrides = {},
) {
  if (!liveBuilderLocationCreationReliabilityIsActivated(environment)) {
    return { ran: false, passed: false } as const;
  }

  const emit =
    overrides.emit ?? ((value: unknown) => console.log(JSON.stringify(value)));
  let envelope: GateEnvelope;
  try {
    envelope = (
      overrides.deriveReliabilityEnvelope ??
      deriveBuilderLocationCreationReliabilityEnvelope
    )() as GateEnvelope;
  } catch {
    return emitSetupFailure(emit, "reservation_envelope_mismatch");
  }
  const setupReason = preflightGate("reliability", envelope);
  if (setupReason) return emitSetupFailure(emit, setupReason);

  let dependencies: BuilderLocationCreationLiveDependencies;
  try {
    dependencies = await resolveDependencies(overrides);
  } catch {
    return emitSetupFailure(emit, "dependency_initialization_failed");
  }

  const reports: BuilderLocationCreationEvaluationReport[] = [];
  const totals = newTotals();
  const passCounts = new Map<string, number>(
    builderLocationCreationEvaluationScenarios.map(({ id }) => [id, 0]),
  );
  reliabilityRounds: for (
    let repetition = 1;
    repetition <= BUILDER_LOCATION_CREATION_INTENT_RELIABILITY_REPETITIONS;
    repetition += 1
  ) {
    for (const scenario of builderLocationCreationEvaluationScenarios) {
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
        BUILDER_LOCATION_CREATION_INTENT_RELIABILITY_TOTAL_EXECUTIONS &&
      totals.passedExecutions ===
        BUILDER_LOCATION_CREATION_INTENT_RELIABILITY_TOTAL_EXECUTIONS &&
      totals.failedExecutions === 0 &&
      [...passCounts.values()].every(
        (count) =>
          count === BUILDER_LOCATION_CREATION_INTENT_RELIABILITY_REPETITIONS,
      ) &&
      totals.estimatedCostMicrousd < envelope.hardCeilingMicrousd &&
      envelope.reservedCostMicrousd <= envelope.hardCeilingMicrousd,
    reports: Object.freeze(reports),
  });
}

export const builderLocationCreationSingleExecutionReservationMicrousd =
  exactSingleExecutionReservation;
