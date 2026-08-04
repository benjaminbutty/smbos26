import { calculateAiTokenCostMicrousd } from "../../accounting/cost";
import { StructuredAiProviderError } from "../../contracts";
import type { AiExecutionResult } from "../../execution";
import { AiExecutionError } from "../../errors";
import {
  BUILDER_LOCATION_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
  openAiBuilderLocationCreationPolicy,
} from "../../policies";
import { builderLocationCreationIntentTaskV1 } from "../../location-creation-intent/task";
import {
  aiExecutionPolicies,
  registeredAiTasks,
  structuredAiProviders,
} from "../../registry";
import { createAiExecutionService } from "../../execution";
import {
  builderLocationCreationEvaluationScenarios,
  type BuilderLocationCreationEvaluationScenario,
} from "./scenarios";
import {
  deriveBuilderLocationCreationQualificationEnvelope,
  deriveBuilderLocationCreationReliabilityEnvelope,
  BUILDER_LOCATION_CREATION_INTENT_RELIABILITY_REPETITIONS,
} from "./envelope";
import { evaluateBuilderLocationCreationIntent } from "./evaluator";

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

interface LiveDependencies {
  execute(
    taskKey: "builder_location_creation_intent_v1",
    input: unknown,
  ): Promise<AiExecutionResult>;
  now(): number;
  emit(value: unknown): void;
}

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

async function defaultDependencies(): Promise<LiveDependencies> {
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

function safeErrorCode(cause: unknown): string {
  if (cause instanceof AiExecutionError) return cause.code;
  if (cause instanceof StructuredAiProviderError) return cause.kind;
  return "evaluation_execution_failed";
}

async function runScenario(
  dependencies: LiveDependencies,
  scenario: BuilderLocationCreationEvaluationScenario,
  repetition: number,
) {
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
        attempts: execution.metadata.attempts,
        inputTokens: execution.accounting.inputTokens,
        outputTokens: execution.accounting.outputTokens,
        elapsedMs: Math.max(0, Math.round(dependencies.now() - started)),
      },
      { repetition },
    );
    dependencies.emit(report);
    return report;
  } catch (cause) {
    const report = evaluateBuilderLocationCreationIntent(
      scenario,
      null,
      {
        attempts: 0,
        inputTokens: 0,
        outputTokens: 0,
        elapsedMs: Math.max(0, Math.round(dependencies.now() - started)),
      },
      { repetition, errorCode: safeErrorCode(cause) },
    );
    dependencies.emit(report);
    return report;
  }
}

function resultSummary(
  reports: readonly ReturnType<typeof evaluateBuilderLocationCreationIntent>[],
  expectedCount: number,
  envelope: {
    reservedCostMicrousd: number;
    hardCeilingMicrousd: number;
  },
) {
  const passed =
    reports.length === expectedCount &&
    reports.every((report) => report.passed);
  return {
    ran: true,
    passed:
      passed && envelope.reservedCostMicrousd <= envelope.hardCeilingMicrousd,
    reports,
  };
}

export async function runLiveBuilderLocationCreationQualification(
  environment: BuilderLocationCreationQualificationEnvironment,
  overrides: Partial<LiveDependencies> = {},
) {
  if (!liveBuilderLocationCreationQualificationIsActivated(environment)) {
    return { ran: false, passed: false } as const;
  }
  const dependencies = { ...(await defaultDependencies()), ...overrides };
  const reports = [];
  for (const scenario of builderLocationCreationEvaluationScenarios) {
    reports.push(await runScenario(dependencies, scenario, 1));
  }
  return resultSummary(
    reports,
    8,
    deriveBuilderLocationCreationQualificationEnvelope(),
  );
}

export async function runLiveBuilderLocationCreationReliability(
  environment: BuilderLocationCreationReliabilityEnvironment,
  overrides: Partial<LiveDependencies> = {},
) {
  if (!liveBuilderLocationCreationReliabilityIsActivated(environment)) {
    return { ran: false, passed: false } as const;
  }
  const dependencies = { ...(await defaultDependencies()), ...overrides };
  const reports = [];
  for (
    let repetition = 1;
    repetition <= BUILDER_LOCATION_CREATION_INTENT_RELIABILITY_REPETITIONS;
    repetition += 1
  ) {
    for (const scenario of builderLocationCreationEvaluationScenarios) {
      reports.push(await runScenario(dependencies, scenario, repetition));
    }
  }
  return resultSummary(
    reports,
    24,
    deriveBuilderLocationCreationReliabilityEnvelope(),
  );
}

export const builderLocationCreationSingleExecutionReservationMicrousd =
  calculateAiTokenCostMicrousd({
    inputTokens: 80_000 * 2,
    outputTokens: 2_048 * 2,
    inputMicrousdPerMillion: 2_500_000,
    outputMicrousdPerMillion: 15_000_000,
  });
