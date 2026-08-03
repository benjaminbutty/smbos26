import { calculateAiTokenCostMicrousd } from "../../accounting/cost";
import type { AiExecutionResult } from "../../execution";
import { aiExecutionErrorCodes, type AiExecutionErrorCode } from "../../errors";
import {
  BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY,
  OPENAI_BUILDER_PREORDER_AMENDMENT_MODEL_KEY,
  OPENAI_BUILDER_PREORDER_AMENDMENT_REASONING_EFFORT,
  openAiBuilderPreorderAmendmentPolicy,
} from "../../policies";
import { builderPreorderAmendmentTaskInputBaseSchema } from "../../preorder-amendment/schemas";
import { builderPreorderAmendmentTaskV1 } from "../../preorder-amendment/task";
import { createAiExecutionService } from "../../execution";
import {
  aiExecutionPolicies,
  registeredAiTasks,
  structuredAiProviders,
} from "../../registry";
import { syntheticBusinessContext } from "../../../../evaluations/fixtures/synthetic-business-context";
import {
  BUILDER_PREORDER_AMENDMENT_RELIABILITY_REPETITIONS,
  BUILDER_PREORDER_AMENDMENT_RELIABILITY_TOTAL_EXECUTIONS,
  deriveBuilderPreorderAmendmentQualificationEnvelope,
  deriveBuilderPreorderAmendmentReliabilityEnvelope,
} from "./envelope";
import { evaluateBuilderPreorderAmendment } from "./evaluator";
import {
  builderPreorderAmendmentEvaluationAggregateSchema,
  builderPreorderAmendmentEvaluationReliabilityAggregateSchema,
  builderPreorderAmendmentEvaluationReliabilityReportSchema,
  type BuilderPreorderAmendmentEvaluationReport,
  type BuilderPreorderAmendmentEvaluationReliabilityReport,
  type BuilderPreorderAmendmentEvaluationScenarioId,
} from "./schemas";
import {
  builderPreorderAmendmentEvaluationPlans as awaitedPlans,
  builderPreorderAmendmentEvaluationScenarios,
} from "./scenarios";

export interface BuilderPreorderAmendmentQualificationEnvironment {
  RUN_LIVE_OPENAI_PREORDER_AMENDMENT_QUALIFICATION?: string | undefined;
  AI_PROVIDER?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
}

export interface BuilderPreorderAmendmentReliabilityEnvironment {
  RUN_LIVE_OPENAI_PREORDER_AMENDMENT_RELIABILITY?: string | undefined;
  AI_PROVIDER?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
}

interface LiveDependencies {
  execute(
    taskKey: "builder_preorder_amendment_v1",
    input: unknown,
  ): Promise<AiExecutionResult>;
  now(): number;
  emit(value: unknown): void;
}

function activated(environment: {
  flag: string | undefined;
  AI_PROVIDER: string | undefined;
  OPENAI_API_KEY: string | undefined;
}) {
  return (
    environment.flag === "1" &&
    environment.AI_PROVIDER?.trim() === "openai" &&
    Boolean(environment.OPENAI_API_KEY?.trim())
  );
}

export function liveBuilderPreorderAmendmentQualificationIsActivated(
  environment: BuilderPreorderAmendmentQualificationEnvironment,
): boolean {
  return activated({
    flag: environment.RUN_LIVE_OPENAI_PREORDER_AMENDMENT_QUALIFICATION,
    AI_PROVIDER: environment.AI_PROVIDER,
    OPENAI_API_KEY: environment.OPENAI_API_KEY,
  });
}

export function liveBuilderPreorderAmendmentReliabilityIsActivated(
  environment: BuilderPreorderAmendmentReliabilityEnvironment,
): boolean {
  return activated({
    flag: environment.RUN_LIVE_OPENAI_PREORDER_AMENDMENT_RELIABILITY,
    AI_PROVIDER: environment.AI_PROVIDER,
    OPENAI_API_KEY: environment.OPENAI_API_KEY,
  });
}

async function defaultDependencies(): Promise<LiveDependencies> {
  const task = Object.freeze({
    ...builderPreorderAmendmentTaskV1,
    policyKey: BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY,
  });
  const execution = createAiExecutionService({
    tasks: { ...registeredAiTasks, builder_preorder_amendment_v1: task },
    policies: {
      ...aiExecutionPolicies,
      [BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY]:
        openAiBuilderPreorderAmendmentPolicy,
    },
    providers: structuredAiProviders,
  });
  return {
    execute: (taskKey, input) => execution.execute(taskKey, input),
    now: () => performance.now(),
    emit: (value) => console.log(JSON.stringify(value)),
  };
}

function dependencyOverrides(overrides: Partial<LiveDependencies>) {
  return {
    execute: overrides.execute,
    now: overrides.now ?? (() => performance.now()),
    emit:
      overrides.emit ??
      ((value: unknown) => console.log(JSON.stringify(value))),
  } as LiveDependencies;
}

function safeErrorCode(cause: unknown): AiExecutionErrorCode {
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

function failureAccounting(cause: unknown) {
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

function redactedFailure(
  cause: unknown,
  scenarioId: BuilderPreorderAmendmentEvaluationScenarioId,
) {
  return { scenario_id: scenarioId, error_code: safeErrorCode(cause) };
}

function redactedReliabilityFailure(
  cause: unknown,
  scenarioId: BuilderPreorderAmendmentEvaluationScenarioId,
  repetition: 1 | 2 | 3,
) {
  return { ...redactedFailure(cause, scenarioId), repetition };
}

function cost(inputTokens: number, outputTokens: number) {
  return calculateAiTokenCostMicrousd({
    inputTokens,
    outputTokens,
    inputMicrousdPerMillion:
      openAiBuilderPreorderAmendmentPolicy.inputMicrousdPerMillion,
    outputMicrousdPerMillion:
      openAiBuilderPreorderAmendmentPolicy.outputMicrousdPerMillion,
  });
}

function totals() {
  return { passed: 0, failed: 0, input: 0, output: 0, cost: 0, elapsed: 0 };
}

function inputForScenario(id: BuilderPreorderAmendmentEvaluationScenarioId) {
  const scenario = builderPreorderAmendmentEvaluationScenarios.find(
    ({ id: candidate }) => candidate === id,
  );
  if (!scenario) throw new Error("The preorder amendment scenario is missing.");
  return builderPreorderAmendmentTaskInputBaseSchema.parse({
    schema_version: 1,
    owner_request: scenario.owner_request,
    business_context: syntheticBusinessContext,
    ready_plan: awaitedPlans[id],
    preorder_scope: {
      preorder_key: "bakery_preorder",
      selection: "sole_active",
    },
  });
}

export async function runLiveBuilderPreorderAmendmentQualification(
  environment: BuilderPreorderAmendmentQualificationEnvironment,
  overrides: Partial<LiveDependencies> = {},
) {
  if (!liveBuilderPreorderAmendmentQualificationIsActivated(environment)) {
    return Object.freeze({ ran: false, passed: false, reports: [] as const });
  }
  const deps = dependencyOverrides(overrides);
  if (!deps.execute) Object.assign(deps, await defaultDependencies());
  const envelope = deriveBuilderPreorderAmendmentQualificationEnvelope();
  const reports: BuilderPreorderAmendmentEvaluationReport[] = [];
  const total = totals();
  for (const scenario of builderPreorderAmendmentEvaluationScenarios) {
    const started = deps.now();
    try {
      const result = await deps.execute(
        "builder_preorder_amendment_v1",
        inputForScenario(scenario.id),
      );
      const report = evaluateBuilderPreorderAmendment(scenario, result.output, {
        attempts: result.accounting.attemptsStarted,
        inputTokens: result.accounting.inputTokens,
        outputTokens: result.accounting.outputTokens,
        elapsedMs: deps.now() - started,
      });
      reports.push(report);
      total.input += report.input_tokens;
      total.output += report.output_tokens;
      total.cost += report.estimated_cost_microusd;
      total.elapsed += report.elapsed_ms;
      if (report.passed) {
        total.passed += 1;
      } else {
        total.failed += 1;
      }
      deps.emit(report);
      if (!report.passed) break;
    } catch (cause) {
      const usage = failureAccounting(cause);
      total.input += usage.inputTokens;
      total.output += usage.outputTokens;
      total.cost += cost(usage.inputTokens, usage.outputTokens);
      total.elapsed += Math.max(0, Math.round(deps.now() - started));
      total.failed += 1;
      deps.emit(redactedFailure(cause, scenario.id));
      break;
    }
  }
  deps.emit(
    builderPreorderAmendmentEvaluationAggregateSchema.parse({
      model_key: OPENAI_BUILDER_PREORDER_AMENDMENT_MODEL_KEY,
      policy_key: BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY,
      reasoning_effort: OPENAI_BUILDER_PREORDER_AMENDMENT_REASONING_EFFORT,
      total_scenarios: 8,
      passed_scenarios: total.passed,
      failed_scenarios: total.failed,
      total_input_tokens: total.input,
      total_output_tokens: total.output,
      total_estimated_cost_microusd: total.cost,
      total_elapsed_ms: total.elapsed,
    }),
  );
  return Object.freeze({
    ran: true,
    passed:
      total.passed === 8 &&
      total.failed === 0 &&
      total.cost < envelope.hardCeilingMicrousd,
    reports: Object.freeze(reports),
  });
}

export async function runLiveBuilderPreorderAmendmentReliability(
  environment: BuilderPreorderAmendmentReliabilityEnvironment,
  overrides: Partial<LiveDependencies> = {},
) {
  if (!liveBuilderPreorderAmendmentReliabilityIsActivated(environment)) {
    return Object.freeze({ ran: false, passed: false, reports: [] as const });
  }
  const deps = dependencyOverrides(overrides);
  if (!deps.execute) Object.assign(deps, await defaultDependencies());
  const envelope = deriveBuilderPreorderAmendmentReliabilityEnvelope();
  const reports: BuilderPreorderAmendmentEvaluationReliabilityReport[] = [];
  const total = totals();
  const counts = new Map(
    builderPreorderAmendmentEvaluationScenarios.map(({ id }) => [id, 0]),
  );
  reliabilityRounds: for (
    let repetition = 1;
    repetition <= 3;
    repetition += 1
  ) {
    for (const scenario of builderPreorderAmendmentEvaluationScenarios) {
      const started = deps.now();
      try {
        const result = await deps.execute(
          "builder_preorder_amendment_v1",
          inputForScenario(scenario.id),
        );
        const report =
          builderPreorderAmendmentEvaluationReliabilityReportSchema.parse({
            ...evaluateBuilderPreorderAmendment(scenario, result.output, {
              attempts: result.accounting.attemptsStarted,
              inputTokens: result.accounting.inputTokens,
              outputTokens: result.accounting.outputTokens,
              elapsedMs: deps.now() - started,
            }),
            repetition,
          });
        reports.push(report);
        total.input += report.input_tokens;
        total.output += report.output_tokens;
        total.cost += report.estimated_cost_microusd;
        total.elapsed += report.elapsed_ms;
        if (report.passed) {
          total.passed += 1;
        } else {
          total.failed += 1;
        }
        if (report.passed)
          counts.set(scenario.id, (counts.get(scenario.id) ?? 0) + 1);
        deps.emit(report);
        if (!report.passed) break reliabilityRounds;
      } catch (cause) {
        const usage = failureAccounting(cause);
        total.input += usage.inputTokens;
        total.output += usage.outputTokens;
        total.cost += cost(usage.inputTokens, usage.outputTokens);
        total.elapsed += Math.max(0, Math.round(deps.now() - started));
        total.failed += 1;
        deps.emit(
          redactedReliabilityFailure(
            cause,
            scenario.id,
            repetition as 1 | 2 | 3,
          ),
        );
        break reliabilityRounds;
      }
    }
  }
  const reliabilityPassedScenarios = [...counts.values()].filter(
    (count) => count === BUILDER_PREORDER_AMENDMENT_RELIABILITY_REPETITIONS,
  ).length;
  deps.emit(
    builderPreorderAmendmentEvaluationReliabilityAggregateSchema.parse({
      model_key: OPENAI_BUILDER_PREORDER_AMENDMENT_MODEL_KEY,
      policy_key: BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY,
      reasoning_effort: OPENAI_BUILDER_PREORDER_AMENDMENT_REASONING_EFFORT,
      total_scenarios: 8,
      passed_scenarios: reliabilityPassedScenarios,
      failed_scenarios: 8 - reliabilityPassedScenarios,
      total_input_tokens: total.input,
      total_output_tokens: total.output,
      total_estimated_cost_microusd: total.cost,
      total_elapsed_ms: total.elapsed,
      repetitions_per_scenario: 3,
      total_executions: 24,
      passed_executions: total.passed,
      failed_executions: total.failed,
      per_scenario_pass_counts: builderPreorderAmendmentEvaluationScenarios.map(
        ({ id }) => ({
          scenario_id: id,
          passed_count: counts.get(id) ?? 0,
        }),
      ),
    }),
  );
  return Object.freeze({
    ran: true,
    passed:
      total.passed ===
        BUILDER_PREORDER_AMENDMENT_RELIABILITY_TOTAL_EXECUTIONS &&
      total.failed === 0 &&
      [...counts.values()].every(
        (count) => count === BUILDER_PREORDER_AMENDMENT_RELIABILITY_REPETITIONS,
      ) &&
      total.cost < envelope.hardCeilingMicrousd,
    reports: Object.freeze(reports),
  });
}
