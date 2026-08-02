import { ZodError } from "zod";

import { calculateAiTokenCostMicrousd } from "../../accounting/cost";
import type { AiExecutionResult } from "../../execution";
import { aiExecutionErrorCodes, type AiExecutionErrorCode } from "../../errors";
import {
  BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY,
  OPENAI_BUILDER_CONFIGURATION_DRAFTING_MODEL_KEY,
  OPENAI_BUILDER_CONFIGURATION_DRAFTING_REASONING_EFFORT,
  openAiBuilderConfigurationDraftingPolicy,
} from "../../policies";
import {
  BuilderConfigurationDraftValidationError,
  type BuilderConfigurationDraftDiagnosticCode,
} from "../../configuration-drafting/diagnostics";
import { builderConfigurationDraftOutputSchema } from "../../configuration-drafting/schemas";
import {
  CONFIGURATION_DRAFTING_QUALIFICATION_SCENARIO_COUNT,
  CONFIGURATION_DRAFTING_RELIABILITY_REPETITIONS,
  CONFIGURATION_DRAFTING_RELIABILITY_TOTAL_EXECUTIONS,
  deriveConfigurationDraftingQualificationEnvelope,
  deriveConfigurationDraftingReliabilityEnvelope,
  type ConfigurationDraftingEvaluationEnvelope,
} from "./envelope";
import { evaluateConfigurationDraft } from "./evaluator";
import {
  configurationDraftingProviderFailureSchema,
  configurationDraftingQualificationAggregateSchema,
  configurationDraftingReliabilityAggregateSchema,
  configurationDraftingReliabilityProviderFailureSchema,
  configurationDraftingReliabilityReportSchema,
  configurationDraftingReportSchema,
  configurationDraftingTopLevelFailureSchema,
  configurationDraftingValidationReasonCodeSchema,
  configurationDraftingValidationStageSchema,
  type ConfigurationDraftingReport,
  type ConfigurationDraftingReliabilityReport,
  type ConfigurationDraftingScenarioId,
} from "./schemas";
import { configurationDraftingScenarios } from "./scenarios";
import { createBuilderConfigurationDraftingEvaluationTask } from "./task";

export interface ConfigurationDraftingQualificationEnvironment {
  RUN_LIVE_OPENAI_CONFIGURATION_DRAFTING_QUALIFICATION?: string | undefined;
  AI_PROVIDER?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
}

export interface ConfigurationDraftingReliabilityEnvironment {
  RUN_LIVE_OPENAI_CONFIGURATION_DRAFTING_RELIABILITY?: string | undefined;
  AI_PROVIDER?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
}

interface ConfigurationDraftingExecution {
  execute(
    taskKey: "builder_configuration_draft_v1",
    input: unknown,
  ): Promise<AiExecutionResult>;
}

interface LiveEvaluationDependencies {
  loadProductionExecution(
    apiKey: string,
  ): Promise<ConfigurationDraftingExecution>;
  now(): number;
  emit(value: unknown): void;
  deriveQualificationEnvelope(): ConfigurationDraftingEvaluationEnvelope;
  deriveReliabilityEnvelope(): ConfigurationDraftingEvaluationEnvelope;
}

export interface LiveConfigurationDraftingQualificationResult {
  ran: boolean;
  passed: boolean;
  reports: readonly ConfigurationDraftingReport[];
}

export interface LiveConfigurationDraftingReliabilityResult {
  ran: boolean;
  passed: boolean;
  reports: readonly ConfigurationDraftingReliabilityReport[];
}

interface MutableGateTotals {
  passedExecutions: number;
  failedExecutions: number;
  structuralFailureCount: number;
  semanticFailureCount: number;
  unknownOutputFailureCount: number;
  scenarioGateFailureCount: number;
  providerOrExecutionFailureCount: number;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicrousd: number;
  elapsedMs: number;
}

export function liveConfigurationDraftingQualificationIsActivated(
  environment: ConfigurationDraftingQualificationEnvironment,
): boolean {
  return (
    environment.RUN_LIVE_OPENAI_CONFIGURATION_DRAFTING_QUALIFICATION === "1" &&
    environment.AI_PROVIDER?.trim() === "openai" &&
    Boolean(environment.OPENAI_API_KEY?.trim())
  );
}

export function liveConfigurationDraftingReliabilityIsActivated(
  environment: ConfigurationDraftingReliabilityEnvironment,
): boolean {
  return (
    environment.RUN_LIVE_OPENAI_CONFIGURATION_DRAFTING_RELIABILITY === "1" &&
    environment.AI_PROVIDER?.trim() === "openai" &&
    Boolean(environment.OPENAI_API_KEY?.trim())
  );
}

function safeExecutionErrorCode(cause: unknown): AiExecutionErrorCode {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof cause.code === "string" &&
    aiExecutionErrorCodes.includes(cause.code as AiExecutionErrorCode)
  ) {
    return cause.code as AiExecutionErrorCode;
  }
  return "ai_execution_failed";
}

function nextCause(cause: unknown): unknown {
  if (typeof cause !== "object" || cause === null || !("cause" in cause)) {
    return undefined;
  }
  return (cause as { cause?: unknown }).cause;
}

function classifyOutputValidationFailure(cause: unknown): {
  validation_stage: "structural" | "semantic" | "unknown";
  validation_reason_code:
    BuilderConfigurationDraftDiagnosticCode | "unknown_output_invalid";
} {
  const seen = new Set<object>();
  let current: unknown = cause;
  for (let depth = 0; depth < 5 && current !== undefined; depth += 1) {
    if (current instanceof BuilderConfigurationDraftValidationError) {
      const diagnosticCode =
        configurationDraftingValidationReasonCodeSchema.parse(
          current.diagnosticCode,
        );
      const validationStage =
        diagnosticCode === "output_contract_invalid"
          ? "structural"
          : "semantic";
      return {
        validation_stage:
          configurationDraftingValidationStageSchema.parse(validationStage),
        validation_reason_code: diagnosticCode,
      };
    }
    if (current instanceof ZodError) {
      return {
        validation_stage: "structural",
        validation_reason_code: "output_contract_invalid",
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
    validation_stage: "unknown",
    validation_reason_code: "unknown_output_invalid",
  };
}

export function redactConfigurationDraftingFailure(
  cause: unknown,
  scenarioId: ConfigurationDraftingScenarioId,
) {
  const errorCode = safeExecutionErrorCode(cause);
  if (errorCode !== "ai_output_invalid") {
    return configurationDraftingProviderFailureSchema.parse({
      schema_version: 1,
      scenario_id: scenarioId,
      error_code: errorCode,
    });
  }
  return configurationDraftingProviderFailureSchema.parse({
    schema_version: 1,
    scenario_id: scenarioId,
    error_code: errorCode,
    ...classifyOutputValidationFailure(cause),
  });
}

function redactReliabilityFailure(
  cause: unknown,
  scenarioId: ConfigurationDraftingScenarioId,
  repetition: 1 | 2 | 3,
) {
  return configurationDraftingReliabilityProviderFailureSchema.parse({
    ...redactConfigurationDraftingFailure(cause, scenarioId),
    repetition,
  });
}

function boundedInteger(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function failureAccounting(cause: unknown): {
  attempts: number;
  inputTokens: number;
  outputTokens: number;
} {
  if (
    typeof cause !== "object" ||
    cause === null ||
    !("accounting" in cause) ||
    typeof cause.accounting !== "object" ||
    cause.accounting === null
  ) {
    return { attempts: 0, inputTokens: 0, outputTokens: 0 };
  }
  const accounting = cause.accounting as Record<string, unknown>;
  return {
    attempts: boundedInteger(accounting.attemptsStarted),
    inputTokens: boundedInteger(accounting.inputTokens),
    outputTokens: boundedInteger(accounting.outputTokens),
  };
}

function estimatedCost(inputTokens: number, outputTokens: number): number {
  return calculateAiTokenCostMicrousd({
    inputTokens,
    outputTokens,
    inputMicrousdPerMillion:
      openAiBuilderConfigurationDraftingPolicy.inputMicrousdPerMillion,
    outputMicrousdPerMillion:
      openAiBuilderConfigurationDraftingPolicy.outputMicrousdPerMillion,
  });
}

function newTotals(): MutableGateTotals {
  return {
    passedExecutions: 0,
    failedExecutions: 0,
    structuralFailureCount: 0,
    semanticFailureCount: 0,
    unknownOutputFailureCount: 0,
    scenarioGateFailureCount: 0,
    providerOrExecutionFailureCount: 0,
    attempts: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostMicrousd: 0,
    elapsedMs: 0,
  };
}

function addTotals(
  totals: MutableGateTotals,
  input: {
    attempts: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostMicrousd: number;
    elapsedMs: number;
  },
): void {
  totals.attempts += input.attempts;
  totals.inputTokens += input.inputTokens;
  totals.outputTokens += input.outputTokens;
  totals.estimatedCostMicrousd += input.estimatedCostMicrousd;
  totals.elapsedMs += input.elapsedMs;
}

function updateTotalsForReport(
  report: ConfigurationDraftingReport,
  totals: MutableGateTotals,
): void {
  addTotals(totals, {
    attempts: report.attempts,
    inputTokens: report.input_tokens,
    outputTokens: report.output_tokens,
    estimatedCostMicrousd: report.estimated_cost_microusd,
    elapsedMs: report.elapsed_ms,
  });
  if (report.passed) {
    totals.passedExecutions += 1;
  } else {
    totals.failedExecutions += 1;
    totals.scenarioGateFailureCount += 1;
  }
}

function updateTotalsForFailure(
  cause: unknown,
  scenarioId: ConfigurationDraftingScenarioId,
  elapsedMs: number,
  totals: MutableGateTotals,
): void {
  const accounting = failureAccounting(cause);
  addTotals(totals, {
    ...accounting,
    estimatedCostMicrousd: estimatedCost(
      accounting.inputTokens,
      accounting.outputTokens,
    ),
    elapsedMs,
  });
  totals.failedExecutions += 1;
  const redacted = redactConfigurationDraftingFailure(cause, scenarioId);
  if (redacted.error_code !== "ai_output_invalid") {
    totals.providerOrExecutionFailureCount += 1;
    return;
  }
  if (redacted.validation_stage === "semantic") {
    totals.semanticFailureCount += 1;
  } else if (redacted.validation_stage === "unknown") {
    totals.unknownOutputFailureCount += 1;
  } else {
    totals.structuralFailureCount += 1;
  }
}

export async function defaultLoadProductionExecution(
  apiKey: string,
): Promise<ConfigurationDraftingExecution> {
  const [{ createAiExecutionService }, { createProductionAiRuntime }] =
    await Promise.all([import("../../execution"), import("../../registry")]);
  const runtime = createProductionAiRuntime({
    AI_PROVIDER: "openai",
    OPENAI_API_KEY: apiKey,
  });
  const provider = runtime.providers.openai;
  if (!provider || provider.key !== "openai") {
    throw new Error("The evaluation runtime did not provide OpenAI.");
  }
  const task = createBuilderConfigurationDraftingEvaluationTask();
  return createAiExecutionService({
    tasks: { builder_configuration_draft_v1: task },
    policies: {
      [BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY]:
        openAiBuilderConfigurationDraftingPolicy,
    },
    providers: { openai: provider },
  });
}

function dependenciesFor(
  overrides: Partial<LiveEvaluationDependencies>,
): LiveEvaluationDependencies {
  return {
    loadProductionExecution:
      overrides.loadProductionExecution ?? defaultLoadProductionExecution,
    now: overrides.now ?? (() => performance.now()),
    emit: overrides.emit ?? ((value) => console.log(JSON.stringify(value))),
    deriveQualificationEnvelope:
      overrides.deriveQualificationEnvelope ??
      (() => deriveConfigurationDraftingQualificationEnvelope()),
    deriveReliabilityEnvelope:
      overrides.deriveReliabilityEnvelope ??
      (() => deriveConfigurationDraftingReliabilityEnvelope()),
  };
}

function aggregateCostIsBelowCeiling(
  totals: MutableGateTotals,
  envelope: ConfigurationDraftingEvaluationEnvelope,
): boolean {
  return totals.estimatedCostMicrousd < envelope.hardCeilingMicrousd;
}

export async function runLiveConfigurationDraftingQualification(
  environment: ConfigurationDraftingQualificationEnvironment,
  overrides: Partial<LiveEvaluationDependencies> = {},
): Promise<LiveConfigurationDraftingQualificationResult> {
  if (!liveConfigurationDraftingQualificationIsActivated(environment)) {
    return Object.freeze({ ran: false, passed: false, reports: [] });
  }

  const dependencies = dependenciesFor(overrides);
  const envelope = dependencies.deriveQualificationEnvelope();
  const execution = await dependencies.loadProductionExecution(
    environment.OPENAI_API_KEY!.trim(),
  );
  const reports: ConfigurationDraftingReport[] = [];
  const totals = newTotals();

  for (const scenario of configurationDraftingScenarios) {
    const startedAt = dependencies.now();
    try {
      const result = await execution.execute(
        "builder_configuration_draft_v1",
        scenario.task_input,
      );
      const report = evaluateConfigurationDraft(
        scenario,
        builderConfigurationDraftOutputSchema.parse(result.output),
        {
          attempts: result.accounting.attemptsStarted,
          inputTokens: result.accounting.inputTokens,
          outputTokens: result.accounting.outputTokens,
          usageComplete: result.accounting.usageComplete,
          elapsedMs: Math.max(0, Math.round(dependencies.now() - startedAt)),
        },
      );
      reports.push(configurationDraftingReportSchema.parse(report));
      updateTotalsForReport(report, totals);
      dependencies.emit(report);
    } catch (cause) {
      const elapsedMs = Math.max(0, Math.round(dependencies.now() - startedAt));
      updateTotalsForFailure(cause, scenario.id, elapsedMs, totals);
      dependencies.emit(redactConfigurationDraftingFailure(cause, scenario.id));
    }
  }

  const aggregate = configurationDraftingQualificationAggregateSchema.parse({
    schema_version: 1,
    gate: "qualification",
    model_key: OPENAI_BUILDER_CONFIGURATION_DRAFTING_MODEL_KEY,
    policy_key: BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY,
    reasoning_effort: OPENAI_BUILDER_CONFIGURATION_DRAFTING_REASONING_EFFORT,
    total_scenarios: CONFIGURATION_DRAFTING_QUALIFICATION_SCENARIO_COUNT,
    passed_scenarios: totals.passedExecutions,
    failed_scenarios: totals.failedExecutions,
    structural_failure_count: totals.structuralFailureCount,
    semantic_failure_count: totals.semanticFailureCount,
    unknown_output_failure_count: totals.unknownOutputFailureCount,
    scenario_gate_failure_count: totals.scenarioGateFailureCount,
    provider_or_execution_failure_count: totals.providerOrExecutionFailureCount,
    total_attempts: totals.attempts,
    total_input_tokens: totals.inputTokens,
    total_output_tokens: totals.outputTokens,
    total_estimated_cost_microusd: totals.estimatedCostMicrousd,
    total_elapsed_ms: totals.elapsedMs,
  });
  dependencies.emit(aggregate);

  return Object.freeze({
    ran: true,
    passed:
      totals.passedExecutions ===
        CONFIGURATION_DRAFTING_QUALIFICATION_SCENARIO_COUNT &&
      totals.failedExecutions === 0 &&
      totals.structuralFailureCount === 0 &&
      totals.semanticFailureCount === 0 &&
      totals.unknownOutputFailureCount === 0 &&
      totals.scenarioGateFailureCount === 0 &&
      totals.providerOrExecutionFailureCount === 0 &&
      reports.length === CONFIGURATION_DRAFTING_QUALIFICATION_SCENARIO_COUNT &&
      reports.every(({ usage_complete }) => usage_complete) &&
      aggregateCostIsBelowCeiling(totals, envelope),
    reports: Object.freeze(reports),
  });
}

export async function runLiveConfigurationDraftingReliability(
  environment: ConfigurationDraftingReliabilityEnvironment,
  overrides: Partial<LiveEvaluationDependencies> = {},
): Promise<LiveConfigurationDraftingReliabilityResult> {
  if (!liveConfigurationDraftingReliabilityIsActivated(environment)) {
    return Object.freeze({ ran: false, passed: false, reports: [] });
  }

  const dependencies = dependenciesFor(overrides);
  const envelope = dependencies.deriveReliabilityEnvelope();
  const execution = await dependencies.loadProductionExecution(
    environment.OPENAI_API_KEY!.trim(),
  );
  const reports: ConfigurationDraftingReliabilityReport[] = [];
  const totals = newTotals();
  const perScenarioPassCounts = new Map<
    ConfigurationDraftingScenarioId,
    number
  >(configurationDraftingScenarios.map(({ id }) => [id, 0]));

  for (
    let repetition = 1;
    repetition <= CONFIGURATION_DRAFTING_RELIABILITY_REPETITIONS;
    repetition += 1
  ) {
    for (const scenario of configurationDraftingScenarios) {
      const startedAt = dependencies.now();
      try {
        const result = await execution.execute(
          "builder_configuration_draft_v1",
          scenario.task_input,
        );
        const report = configurationDraftingReliabilityReportSchema.parse({
          ...evaluateConfigurationDraft(
            scenario,
            builderConfigurationDraftOutputSchema.parse(result.output),
            {
              attempts: result.accounting.attemptsStarted,
              inputTokens: result.accounting.inputTokens,
              outputTokens: result.accounting.outputTokens,
              usageComplete: result.accounting.usageComplete,
              elapsedMs: Math.max(
                0,
                Math.round(dependencies.now() - startedAt),
              ),
            },
          ),
          repetition,
        });
        reports.push(report);
        updateTotalsForReport(report, totals);
        if (report.passed) {
          perScenarioPassCounts.set(
            scenario.id,
            (perScenarioPassCounts.get(scenario.id) ?? 0) + 1,
          );
        }
        dependencies.emit(report);
      } catch (cause) {
        const elapsedMs = Math.max(
          0,
          Math.round(dependencies.now() - startedAt),
        );
        updateTotalsForFailure(cause, scenario.id, elapsedMs, totals);
        dependencies.emit(
          redactReliabilityFailure(cause, scenario.id, repetition as 1 | 2 | 3),
        );
      }
    }
  }

  const aggregate = configurationDraftingReliabilityAggregateSchema.parse({
    schema_version: 1,
    gate: "reliability",
    model_key: OPENAI_BUILDER_CONFIGURATION_DRAFTING_MODEL_KEY,
    policy_key: BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY,
    reasoning_effort: OPENAI_BUILDER_CONFIGURATION_DRAFTING_REASONING_EFFORT,
    total_scenarios: CONFIGURATION_DRAFTING_QUALIFICATION_SCENARIO_COUNT,
    repetitions_per_scenario: CONFIGURATION_DRAFTING_RELIABILITY_REPETITIONS,
    total_executions: CONFIGURATION_DRAFTING_RELIABILITY_TOTAL_EXECUTIONS,
    passed_executions: totals.passedExecutions,
    failed_executions: totals.failedExecutions,
    structural_failure_count: totals.structuralFailureCount,
    semantic_failure_count: totals.semanticFailureCount,
    unknown_output_failure_count: totals.unknownOutputFailureCount,
    scenario_gate_failure_count: totals.scenarioGateFailureCount,
    provider_or_execution_failure_count: totals.providerOrExecutionFailureCount,
    total_attempts: totals.attempts,
    total_input_tokens: totals.inputTokens,
    total_output_tokens: totals.outputTokens,
    total_estimated_cost_microusd: totals.estimatedCostMicrousd,
    total_elapsed_ms: totals.elapsedMs,
    per_scenario_pass_counts: configurationDraftingScenarios.map(({ id }) => ({
      scenario_id: id,
      passed_count: perScenarioPassCounts.get(id) ?? 0,
    })),
  });
  dependencies.emit(aggregate);

  return Object.freeze({
    ran: true,
    passed:
      totals.passedExecutions ===
        CONFIGURATION_DRAFTING_RELIABILITY_TOTAL_EXECUTIONS &&
      totals.failedExecutions === 0 &&
      totals.structuralFailureCount === 0 &&
      totals.semanticFailureCount === 0 &&
      totals.unknownOutputFailureCount === 0 &&
      totals.scenarioGateFailureCount === 0 &&
      totals.providerOrExecutionFailureCount === 0 &&
      reports.length === CONFIGURATION_DRAFTING_RELIABILITY_TOTAL_EXECUTIONS &&
      reports.every(({ usage_complete }) => usage_complete) &&
      [...perScenarioPassCounts.values()].every(
        (count) => count === CONFIGURATION_DRAFTING_RELIABILITY_REPETITIONS,
      ) &&
      aggregateCostIsBelowCeiling(totals, envelope),
    reports: Object.freeze(reports),
  });
}

export function configurationDraftingTopLevelFailure(): {
  evaluation_error_code: "evaluation_setup_failed";
} {
  return configurationDraftingTopLevelFailureSchema.parse({
    evaluation_error_code: "evaluation_setup_failed",
  });
}
