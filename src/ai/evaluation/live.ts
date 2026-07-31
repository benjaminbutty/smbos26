import { calculateAiTokenCostMicrousd } from "../accounting/cost";
import type { AiExecutionResult } from "../execution";
import { aiExecutionErrorCodes, type AiExecutionErrorCode } from "../errors";
import { openAiBuilderPlanningPolicy } from "../policies";
import {
  builderPlanOutputSchema,
  builderPlanTaskInputSchema,
  type BuilderPlanOutput,
} from "../planning/schemas";
import { deriveBuilderEvaluationEnvelope } from "./envelope";
import { evaluateBuilderPlan } from "./evaluator";
import { builderEvaluationScenarios } from "./scenarios";
import {
  builderEvaluationAggregateSchema,
  builderEvaluationProviderFailureSchema,
  type BuilderEvaluationReport,
} from "./schemas";

export interface BuilderEvaluationEnvironment {
  RUN_LIVE_OPENAI_EVAL?: string | undefined;
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

export interface LiveBuilderEvaluationResult {
  ran: boolean;
  passed: boolean;
  reports: readonly BuilderEvaluationReport[];
}

export function liveBuilderEvaluationIsActivated(
  environment: BuilderEvaluationEnvironment,
): boolean {
  return (
    environment.RUN_LIVE_OPENAI_EVAL === "1" &&
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

function failureAccounting(cause: unknown): {
  inputTokens: number;
  outputTokens: number;
  elapsedMs: number;
} {
  if (
    typeof cause !== "object" ||
    cause === null ||
    !("accounting" in cause) ||
    typeof cause.accounting !== "object" ||
    cause.accounting === null
  ) {
    return { inputTokens: 0, outputTokens: 0, elapsedMs: 0 };
  }
  const accounting = cause.accounting as Record<string, unknown>;
  return {
    inputTokens:
      typeof accounting.inputTokens === "number" ? accounting.inputTokens : 0,
    outputTokens:
      typeof accounting.outputTokens === "number" ? accounting.outputTokens : 0,
    elapsedMs: 0,
  };
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

export async function runLiveBuilderEvaluation(
  environment: BuilderEvaluationEnvironment,
  overrides: Partial<LiveEvaluationDependencies> = {},
): Promise<LiveBuilderEvaluationResult> {
  if (!liveBuilderEvaluationIsActivated(environment)) {
    return Object.freeze({ ran: false, passed: false, reports: [] });
  }

  deriveBuilderEvaluationEnvelope();

  const dependencies: LiveEvaluationDependencies = {
    loadProductionExecution:
      overrides.loadProductionExecution ?? defaultLoadProductionExecution,
    now: overrides.now ?? (() => performance.now()),
    emit: overrides.emit ?? ((value) => console.log(JSON.stringify(value))),
  };
  const execution = await dependencies.loadProductionExecution();
  const reports: BuilderEvaluationReport[] = [];
  let failedScenarios = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalEstimatedCostMicrousd = 0;
  let totalElapsedMs = 0;

  for (const scenario of builderEvaluationScenarios) {
    const startedAt = dependencies.now();
    try {
      const input = builderPlanTaskInputSchema.parse({
        schema_version: 1,
        owner_request: scenario.owner_request,
        business_context: (
          await import("../../../evaluations/fixtures/synthetic-business-context")
        ).syntheticBusinessContext,
      });
      const result = await execution.execute("builder_plan_v1", input);
      const elapsedMs = Math.max(0, Math.round(dependencies.now() - startedAt));
      const output = builderPlanOutputSchema.parse(
        result.output,
      ) as BuilderPlanOutput;
      const report = evaluateBuilderPlan(scenario, output, {
        attempts: result.accounting.attemptsStarted,
        inputTokens: result.accounting.inputTokens,
        outputTokens: result.accounting.outputTokens,
        elapsedMs,
      });
      reports.push(report);
      dependencies.emit(report);
      if (!report.passed) failedScenarios += 1;
      totalInputTokens += report.input_tokens;
      totalOutputTokens += report.output_tokens;
      totalEstimatedCostMicrousd += report.estimated_cost_microusd;
      totalElapsedMs += report.elapsed_ms;
    } catch (cause) {
      failedScenarios += 1;
      const elapsedMs = Math.max(0, Math.round(dependencies.now() - startedAt));
      const accounting = failureAccounting(cause);
      const estimatedCostMicrousd = calculateAiTokenCostMicrousd({
        inputTokens: accounting.inputTokens,
        outputTokens: accounting.outputTokens,
        inputMicrousdPerMillion:
          openAiBuilderPlanningPolicy.inputMicrousdPerMillion,
        outputMicrousdPerMillion:
          openAiBuilderPlanningPolicy.outputMicrousdPerMillion,
      });
      totalInputTokens += accounting.inputTokens;
      totalOutputTokens += accounting.outputTokens;
      totalEstimatedCostMicrousd += estimatedCostMicrousd;
      totalElapsedMs += elapsedMs;
      dependencies.emit(
        builderEvaluationProviderFailureSchema.parse({
          scenario_id: scenario.id,
          error_code: safeExecutionErrorCode(cause),
        }),
      );
    }
  }

  const aggregate = builderEvaluationAggregateSchema.parse({
    model_key: openAiBuilderPlanningPolicy.modelKey,
    total_scenarios: 8,
    passed_scenarios: 8 - failedScenarios,
    failed_scenarios: failedScenarios,
    total_input_tokens: totalInputTokens,
    total_output_tokens: totalOutputTokens,
    total_estimated_cost_microusd: totalEstimatedCostMicrousd,
    total_elapsed_ms: totalElapsedMs,
  });
  dependencies.emit(aggregate);

  return Object.freeze({
    ran: true,
    passed:
      failedScenarios === 0 &&
      totalEstimatedCostMicrousd <=
        deriveBuilderEvaluationEnvelope().hardCeilingMicrousd,
    reports: Object.freeze(reports),
  });
}
