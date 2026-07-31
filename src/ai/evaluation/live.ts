import { ZodError } from "zod";

import { calculateAiTokenCostMicrousd } from "../accounting/cost";
import type { AiExecutionResult } from "../execution";
import { aiExecutionErrorCodes, type AiExecutionErrorCode } from "../errors";
import {
  BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY,
  OPENAI_BUILDER_PLANNING_MODEL_KEY,
  OPENAI_BUILDER_PLANNING_REASONING_EFFORT,
  openAiBuilderPlanningPolicy,
} from "../policies";
import {
  BuilderPlanValidationError,
  type BuilderPlanValidationDiagnosticCode,
} from "../planning/diagnostics";
import {
  builderPlanOutputSchema,
  builderPlanTaskInputSchema,
  type BuilderPlanOutput,
} from "../planning/schemas";
import { syntheticBusinessContext } from "../../../evaluations/fixtures/synthetic-business-context";
import {
  BUILDER_TERRA_QUALIFICATION_SCENARIO_COUNT,
  BUILDER_TERRA_RELIABILITY_REPETITIONS,
  BUILDER_TERRA_RELIABILITY_TOTAL_EXECUTIONS,
  deriveBuilderTerraQualificationEnvelope,
  deriveBuilderTerraReliabilityEnvelope,
} from "./envelope";
import { evaluateBuilderPlan } from "./evaluator";
import { builderEvaluationScenarios } from "./scenarios";
import {
  builderEvaluationAggregateSchema,
  builderEvaluationProviderFailureSchema,
  builderEvaluationReliabilityAggregateSchema,
  builderEvaluationReliabilityProviderFailureSchema,
  builderEvaluationReliabilityReportSchema,
  builderEvaluationValidationReasonCodeSchema,
  builderEvaluationValidationStageSchema,
  type BuilderEvaluationReport,
  type BuilderEvaluationReliabilityReport,
  type BuilderEvaluationScenarioId,
} from "./schemas";

export interface BuilderTerraQualificationEnvironment {
  RUN_LIVE_OPENAI_TERRA_QUALIFICATION?: string | undefined;
  AI_PROVIDER?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
}

export interface BuilderTerraReliabilityEnvironment {
  RUN_LIVE_OPENAI_TERRA_RELIABILITY?: string | undefined;
  AI_PROVIDER?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
}

interface LiveEvaluationDependencies {
  loadProductionExecution(): Promise<{
    execute(
      taskKey: "builder_plan_v1",
      input: unknown,
    ): Promise<AiExecutionResult>;
  }>;
  now(): number;
  emit(value: unknown): void;
}

export interface LiveBuilderTerraQualificationResult {
  ran: boolean;
  passed: boolean;
  reports: readonly BuilderEvaluationReport[];
}

export interface LiveBuilderTerraReliabilityResult {
  ran: boolean;
  passed: boolean;
  reports: readonly BuilderEvaluationReliabilityReport[];
}

interface MutableGateTotals {
  passedExecutions: number;
  failedExecutions: number;
  structuralFailureCount: number;
  semanticFailureCount: number;
  scenarioGateFailureCount: number;
  providerFailureCount: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicrousd: number;
  elapsedMs: number;
}

export function liveBuilderTerraQualificationIsActivated(
  environment: BuilderTerraQualificationEnvironment,
): boolean {
  return (
    environment.RUN_LIVE_OPENAI_TERRA_QUALIFICATION === "1" &&
    environment.AI_PROVIDER?.trim() === "openai" &&
    Boolean(environment.OPENAI_API_KEY?.trim())
  );
}

export function liveBuilderTerraReliabilityIsActivated(
  environment: BuilderTerraReliabilityEnvironment,
): boolean {
  return (
    environment.RUN_LIVE_OPENAI_TERRA_RELIABILITY === "1" &&
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
  validation_reason_code: BuilderPlanValidationDiagnosticCode;
} {
  const seen = new Set<object>();
  let current: unknown = cause;
  for (let depth = 0; depth < 5 && current !== undefined; depth += 1) {
    if (current instanceof BuilderPlanValidationError) {
      const diagnosticCode = builderEvaluationValidationReasonCodeSchema.parse(
        current.diagnosticCode,
      );
      const validationStage =
        diagnosticCode === "output_contract_invalid"
          ? "structural"
          : diagnosticCode === "unknown_output_invalid"
            ? "unknown"
            : "semantic";
      return {
        validation_stage:
          builderEvaluationValidationStageSchema.parse(validationStage),
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

export function redactBuilderEvaluationFailure(
  cause: unknown,
  scenarioId: BuilderEvaluationScenarioId,
) {
  const errorCode = safeExecutionErrorCode(cause);
  if (errorCode !== "ai_output_invalid") {
    return builderEvaluationProviderFailureSchema.parse({
      scenario_id: scenarioId,
      error_code: errorCode,
    });
  }
  return builderEvaluationProviderFailureSchema.parse({
    scenario_id: scenarioId,
    error_code: errorCode,
    ...classifyOutputValidationFailure(cause),
  });
}

function redactBuilderReliabilityFailure(
  cause: unknown,
  scenarioId: BuilderEvaluationScenarioId,
  repetition: 1 | 2 | 3,
) {
  return builderEvaluationReliabilityProviderFailureSchema.parse({
    ...redactBuilderEvaluationFailure(cause, scenarioId),
    repetition,
  });
}

function failureAccounting(cause: unknown): {
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
    return { inputTokens: 0, outputTokens: 0 };
  }
  const accounting = cause.accounting as Record<string, unknown>;
  return {
    inputTokens:
      typeof accounting.inputTokens === "number" ? accounting.inputTokens : 0,
    outputTokens:
      typeof accounting.outputTokens === "number" ? accounting.outputTokens : 0,
  };
}

function estimatedCost(inputTokens: number, outputTokens: number): number {
  return calculateAiTokenCostMicrousd({
    inputTokens,
    outputTokens,
    inputMicrousdPerMillion:
      openAiBuilderPlanningPolicy.inputMicrousdPerMillion,
    outputMicrousdPerMillion:
      openAiBuilderPlanningPolicy.outputMicrousdPerMillion,
  });
}

function classifyFailedExecution(
  cause: unknown,
  totals: MutableGateTotals,
): void {
  const errorCode = safeExecutionErrorCode(cause);
  if (errorCode !== "ai_output_invalid") {
    totals.providerFailureCount += 1;
    return;
  }
  const validation = classifyOutputValidationFailure(cause);
  if (validation.validation_stage === "semantic") {
    totals.semanticFailureCount += 1;
  } else {
    totals.structuralFailureCount += 1;
  }
}

async function defaultLoadProductionExecution() {
  const [
    { createAiExecutionService },
    { aiExecutionPolicies, registeredAiTasks, structuredAiProviders },
  ] = await Promise.all([import("../execution"), import("../registry")]);
  return createAiExecutionService({
    tasks: registeredAiTasks,
    policies: aiExecutionPolicies,
    providers: structuredAiProviders,
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
  };
}

function newTotals(): MutableGateTotals {
  return {
    passedExecutions: 0,
    failedExecutions: 0,
    structuralFailureCount: 0,
    semanticFailureCount: 0,
    scenarioGateFailureCount: 0,
    providerFailureCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostMicrousd: 0,
    elapsedMs: 0,
  };
}

function taskInputFor(scenarioId: BuilderEvaluationScenarioId) {
  const scenario = builderEvaluationScenarios.find(
    ({ id }) => id === scenarioId,
  );
  if (!scenario) throw new Error("The builder evaluation scenario is missing.");
  return builderPlanTaskInputSchema.parse({
    schema_version: 1,
    owner_request: scenario.owner_request,
    business_context: syntheticBusinessContext,
  });
}

function updateTotalsForReport(
  report: BuilderEvaluationReport,
  totals: MutableGateTotals,
): void {
  totals.inputTokens += report.input_tokens;
  totals.outputTokens += report.output_tokens;
  totals.estimatedCostMicrousd += report.estimated_cost_microusd;
  totals.elapsedMs += report.elapsed_ms;
  if (report.passed) {
    totals.passedExecutions += 1;
  } else {
    totals.failedExecutions += 1;
    totals.scenarioGateFailureCount += 1;
  }
}

function updateTotalsForFailure(
  cause: unknown,
  elapsedMs: number,
  totals: MutableGateTotals,
): void {
  const accounting = failureAccounting(cause);
  totals.failedExecutions += 1;
  totals.inputTokens += accounting.inputTokens;
  totals.outputTokens += accounting.outputTokens;
  totals.estimatedCostMicrousd += estimatedCost(
    accounting.inputTokens,
    accounting.outputTokens,
  );
  totals.elapsedMs += elapsedMs;
  classifyFailedExecution(cause, totals);
}

export async function runLiveBuilderTerraQualification(
  environment: BuilderTerraQualificationEnvironment,
  overrides: Partial<LiveEvaluationDependencies> = {},
): Promise<LiveBuilderTerraQualificationResult> {
  if (!liveBuilderTerraQualificationIsActivated(environment)) {
    return Object.freeze({ ran: false, passed: false, reports: [] });
  }

  const envelope = deriveBuilderTerraQualificationEnvelope();
  const dependencies = dependenciesFor(overrides);
  const execution = await dependencies.loadProductionExecution();
  const reports: BuilderEvaluationReport[] = [];
  const totals = newTotals();

  for (const scenario of builderEvaluationScenarios) {
    const startedAt = dependencies.now();
    try {
      const result = await execution.execute(
        "builder_plan_v1",
        taskInputFor(scenario.id),
      );
      const report = evaluateBuilderPlan(
        scenario,
        builderPlanOutputSchema.parse(result.output) as BuilderPlanOutput,
        {
          attempts: result.accounting.attemptsStarted,
          inputTokens: result.accounting.inputTokens,
          outputTokens: result.accounting.outputTokens,
          elapsedMs: Math.max(0, Math.round(dependencies.now() - startedAt)),
        },
      );
      reports.push(report);
      updateTotalsForReport(report, totals);
      dependencies.emit(report);
    } catch (cause) {
      const elapsedMs = Math.max(0, Math.round(dependencies.now() - startedAt));
      updateTotalsForFailure(cause, elapsedMs, totals);
      dependencies.emit(redactBuilderEvaluationFailure(cause, scenario.id));
    }
  }

  const aggregate = builderEvaluationAggregateSchema.parse({
    model_key: OPENAI_BUILDER_PLANNING_MODEL_KEY,
    policy_key: BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY,
    reasoning_effort: OPENAI_BUILDER_PLANNING_REASONING_EFFORT,
    total_scenarios: BUILDER_TERRA_QUALIFICATION_SCENARIO_COUNT,
    passed_scenarios: totals.passedExecutions,
    failed_scenarios: totals.failedExecutions,
    structural_failure_count: totals.structuralFailureCount,
    semantic_failure_count: totals.semanticFailureCount,
    scenario_gate_failure_count: totals.scenarioGateFailureCount,
    provider_failure_count: totals.providerFailureCount,
    total_input_tokens: totals.inputTokens,
    total_output_tokens: totals.outputTokens,
    total_estimated_cost_microusd: totals.estimatedCostMicrousd,
    total_elapsed_ms: totals.elapsedMs,
  });
  dependencies.emit(aggregate);

  return Object.freeze({
    ran: true,
    passed:
      totals.passedExecutions === BUILDER_TERRA_QUALIFICATION_SCENARIO_COUNT &&
      totals.failedExecutions === 0 &&
      totals.estimatedCostMicrousd < envelope.hardCeilingMicrousd,
    reports: Object.freeze(reports),
  });
}

export async function runLiveBuilderTerraReliability(
  environment: BuilderTerraReliabilityEnvironment,
  overrides: Partial<LiveEvaluationDependencies> = {},
): Promise<LiveBuilderTerraReliabilityResult> {
  if (!liveBuilderTerraReliabilityIsActivated(environment)) {
    return Object.freeze({ ran: false, passed: false, reports: [] });
  }

  const envelope = deriveBuilderTerraReliabilityEnvelope();
  const dependencies = dependenciesFor(overrides);
  const execution = await dependencies.loadProductionExecution();
  const reports: BuilderEvaluationReliabilityReport[] = [];
  const totals = newTotals();
  const perScenarioPassCounts = new Map<BuilderEvaluationScenarioId, number>(
    builderEvaluationScenarios.map(({ id }) => [id, 0]),
  );

  for (
    let repetition = 1;
    repetition <= BUILDER_TERRA_RELIABILITY_REPETITIONS;
    repetition += 1
  ) {
    for (const scenario of builderEvaluationScenarios) {
      const startedAt = dependencies.now();
      try {
        const result = await execution.execute(
          "builder_plan_v1",
          taskInputFor(scenario.id),
        );
        const report = builderEvaluationReliabilityReportSchema.parse({
          ...evaluateBuilderPlan(
            scenario,
            builderPlanOutputSchema.parse(result.output) as BuilderPlanOutput,
            {
              attempts: result.accounting.attemptsStarted,
              inputTokens: result.accounting.inputTokens,
              outputTokens: result.accounting.outputTokens,
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
        updateTotalsForFailure(cause, elapsedMs, totals);
        dependencies.emit(
          redactBuilderReliabilityFailure(
            cause,
            scenario.id,
            repetition as 1 | 2 | 3,
          ),
        );
      }
    }
  }

  const aggregate = builderEvaluationReliabilityAggregateSchema.parse({
    model_key: OPENAI_BUILDER_PLANNING_MODEL_KEY,
    policy_key: BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY,
    reasoning_effort: OPENAI_BUILDER_PLANNING_REASONING_EFFORT,
    total_scenarios: BUILDER_TERRA_QUALIFICATION_SCENARIO_COUNT,
    repetitions_per_scenario: BUILDER_TERRA_RELIABILITY_REPETITIONS,
    total_executions: BUILDER_TERRA_RELIABILITY_TOTAL_EXECUTIONS,
    passed_executions: totals.passedExecutions,
    failed_executions: totals.failedExecutions,
    structural_failure_count: totals.structuralFailureCount,
    semantic_failure_count: totals.semanticFailureCount,
    scenario_gate_failure_count: totals.scenarioGateFailureCount,
    provider_failure_count: totals.providerFailureCount,
    total_input_tokens: totals.inputTokens,
    total_output_tokens: totals.outputTokens,
    total_estimated_cost_microusd: totals.estimatedCostMicrousd,
    total_elapsed_ms: totals.elapsedMs,
    per_scenario_pass_counts: builderEvaluationScenarios.map(({ id }) => ({
      scenario_id: id,
      passed_count: perScenarioPassCounts.get(id) ?? 0,
    })),
  });
  dependencies.emit(aggregate);

  return Object.freeze({
    ran: true,
    passed:
      totals.passedExecutions === BUILDER_TERRA_RELIABILITY_TOTAL_EXECUTIONS &&
      totals.failedExecutions === 0 &&
      [...perScenarioPassCounts.values()].every(
        (count) => count === BUILDER_TERRA_RELIABILITY_REPETITIONS,
      ) &&
      totals.estimatedCostMicrousd < envelope.hardCeilingMicrousd,
    reports: Object.freeze(reports),
  });
}
