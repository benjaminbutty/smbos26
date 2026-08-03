import "server-only";

import type {
  AiExecutionPolicy,
  AiExecutionPolicyRegistry,
  RegisteredAiTask,
  RegisteredAiTaskRegistry,
  StructuredAiProviderRegistry,
  StructuredAiProvider,
} from "../contracts";
import {
  createAiExecutionService,
  type AiExecutionResult,
  type PreparedAiExecution,
} from "../execution";
import {
  AiRuntimeConfigurationError,
  createProductionAiRuntime,
  type AiRuntimeServerEnvironment,
} from "../registry";
import {
  BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY,
  BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY,
  BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY,
  disabledExecutionPolicies,
  openAiBuilderConfigurationDraftingPolicy,
  openAiBuilderPlanningPolicy,
} from "../policies";
import { builderConfigurationDraftTaskV1 } from "../configuration-drafting/task";
import { builderPlanTaskV1 } from "../planning/task";
import { AiBuilderError } from "./errors";

export type BuilderTaskKey =
  "builder_plan_v1" | "builder_configuration_draft_v1";

export interface BuilderAiRuntime {
  readonly mode: "disabled" | "openai";
  readonly tasks: RegisteredAiTaskRegistry;
  readonly policies: AiExecutionPolicyRegistry;
  readonly providers: StructuredAiProviderRegistry;
}

export interface BuilderExecutionCore {
  prepare(taskKey: BuilderTaskKey, input: unknown): PreparedAiExecution;
  executePrepared(prepared: PreparedAiExecution): Promise<AiExecutionResult>;
}

export interface BuilderRuntimeOverrides {
  createOpenAiProvider?(apiKey: string): StructuredAiProvider;
}

function runtimeConfigurationError(): never {
  throw new AiRuntimeConfigurationError();
}

function assertTask(
  task: RegisteredAiTask | undefined,
  expectedKey: BuilderTaskKey,
  expectedPolicyKey: string,
): void {
  if (
    !task ||
    task.key !== expectedKey ||
    task.version !== 1 ||
    task.policyKey !== expectedPolicyKey
  ) {
    runtimeConfigurationError();
  }
}

function assertPolicy(
  policy: AiExecutionPolicy | undefined,
  expected: AiExecutionPolicy,
): void {
  if (!policy || policy !== expected) {
    runtimeConfigurationError();
  }
}

function assertPrivateRuntime(runtime: BuilderAiRuntime): BuilderAiRuntime {
  if (
    Object.keys(runtime.tasks).length !== 2 ||
    Object.keys(runtime.policies).length !== 2
  ) {
    runtimeConfigurationError();
  }

  if (runtime.mode === "disabled") {
    assertTask(
      runtime.tasks.builder_plan_v1,
      "builder_plan_v1",
      BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY,
    );
    assertTask(
      runtime.tasks.builder_configuration_draft_v1,
      "builder_configuration_draft_v1",
      BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY,
    );
    assertPolicy(
      runtime.policies[BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY],
      disabledExecutionPolicies[BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY],
    );
    assertPolicy(
      runtime.policies[BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY],
      disabledExecutionPolicies[
        BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY
      ],
    );
    if (
      Object.keys(runtime.providers).length !== 1 ||
      runtime.providers.disabled?.key !== "disabled"
    ) {
      runtimeConfigurationError();
    }
    return Object.freeze(runtime);
  }

  assertTask(
    runtime.tasks.builder_plan_v1,
    "builder_plan_v1",
    BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY,
  );
  assertTask(
    runtime.tasks.builder_configuration_draft_v1,
    "builder_configuration_draft_v1",
    BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY,
  );
  assertPolicy(
    runtime.policies[BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY],
    openAiBuilderPlanningPolicy,
  );
  assertPolicy(
    runtime.policies[BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY],
    openAiBuilderConfigurationDraftingPolicy,
  );
  if (
    Object.keys(runtime.providers).length !== 1 ||
    runtime.providers.openai?.key !== "openai"
  ) {
    runtimeConfigurationError();
  }
  return Object.freeze(runtime);
}

export function createBuilderAiRuntime(
  serverEnvironment: AiRuntimeServerEnvironment,
  overrides: BuilderRuntimeOverrides = {},
): BuilderAiRuntime {
  const providerMode = serverEnvironment.AI_PROVIDER?.trim() || "disabled";
  let productionRuntime;
  try {
    productionRuntime = createProductionAiRuntime(serverEnvironment, overrides);
  } catch (cause) {
    if (cause instanceof AiRuntimeConfigurationError) {
      throw new AiBuilderError("ai_builder_runtime_invalid", { cause });
    }
    throw cause;
  }

  try {
    if (providerMode === "disabled") {
      const disabledProvider = productionRuntime.providers.disabled;
      if (!disabledProvider) {
        runtimeConfigurationError();
      }
      return assertPrivateRuntime({
        mode: "disabled",
        tasks: Object.freeze({
          builder_plan_v1: builderPlanTaskV1,
          builder_configuration_draft_v1: builderConfigurationDraftTaskV1,
        }),
        policies: Object.freeze({
          [BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY]:
            productionRuntime.policies[
              BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY
            ],
          [BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY]:
            productionRuntime.policies[
              BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY
            ],
        }),
        providers: Object.freeze({
          disabled: disabledProvider,
        }),
      });
    }

    if (providerMode !== "openai") {
      runtimeConfigurationError();
    }
    const configuredOpenAiProvider = productionRuntime.providers.openai;
    if (!configuredOpenAiProvider) {
      runtimeConfigurationError();
    }

    const qualifiedDraftTask = Object.freeze({
      ...builderConfigurationDraftTaskV1,
      policyKey: BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY,
    });
    return assertPrivateRuntime({
      mode: "openai",
      tasks: Object.freeze({
        builder_plan_v1: builderPlanTaskV1,
        builder_configuration_draft_v1: qualifiedDraftTask,
      }),
      policies: Object.freeze({
        [BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY]: openAiBuilderPlanningPolicy,
        [BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY]:
          openAiBuilderConfigurationDraftingPolicy,
      }),
      providers: Object.freeze({
        openai: configuredOpenAiProvider,
      }),
    });
  } catch (cause) {
    if (cause instanceof AiRuntimeConfigurationError) {
      throw new AiBuilderError("ai_builder_runtime_invalid", { cause });
    }
    throw cause;
  }
}

export function createBuilderExecutionCore(
  runtime: BuilderAiRuntime,
): BuilderExecutionCore {
  const execution = createAiExecutionService({
    tasks: runtime.tasks,
    policies: runtime.policies,
    providers: runtime.providers,
  });
  return Object.freeze({
    prepare: execution.prepare,
    executePrepared: execution.executePrepared,
  });
}
