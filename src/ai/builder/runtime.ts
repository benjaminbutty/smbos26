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
  BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY,
  BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY,
  BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY,
  BUILDER_LOCATION_CREATION_TERRA_MEDIUM_POLICY_KEY,
  BUILDER_RECORD_CREATION_INTENT_DISABLED_POLICY_KEY,
  BUILDER_RECORD_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
  BUILDER_RECORD_UPDATE_INTENT_DISABLED_POLICY_KEY,
  BUILDER_RECORD_UPDATE_INTENT_TERRA_MEDIUM_POLICY_KEY,
  BUILDER_RECORD_LOCATION_LINK_INTENT_DISABLED_POLICY_KEY,
  BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY,
  disabledExecutionPolicies,
  openAiBuilderLocationCreationPolicy,
  openAiBuilderPreorderAmendmentPolicy,
  openAiBuilderConfigurationDraftingPolicy,
  openAiBuilderPlanningPolicy,
  openAiBuilderRecordCreationIntentPolicy,
  openAiBuilderRecordUpdateIntentPolicy,
} from "../policies";
import { builderConfigurationDraftTaskV1 } from "../configuration-drafting/task";
import { builderPreorderAmendmentTaskV1 } from "../preorder-amendment/task";
import { builderPlanTaskV1 } from "../planning/task";
import { builderLocationCreationIntentTaskV1 } from "../location-creation-intent/task";
import { builderRecordCreationIntentTaskV1 } from "../record-creation-intent/task";
import { builderRecordUpdateIntentTaskV1 } from "../record-update-intent/task";
import { builderRecordLocationLinkIntentTaskV1 } from "../record-location-link-intent/task";
import { AiBuilderError } from "./errors";

export type BuilderTaskKey =
  | "builder_plan_v1"
  | "builder_configuration_draft_v1"
  | "builder_preorder_amendment_v1"
  | "builder_location_creation_intent_v1"
  | "builder_record_creation_intent_v1"
  | "builder_record_update_intent_v1"
  | "builder_record_location_link_intent_v1";

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
    Object.keys(runtime.tasks).length !== 7 ||
    Object.keys(runtime.policies).length !== 7
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
    assertTask(
      runtime.tasks.builder_preorder_amendment_v1,
      "builder_preorder_amendment_v1",
      BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY,
    );
    assertTask(
      runtime.tasks.builder_location_creation_intent_v1,
      "builder_location_creation_intent_v1",
      BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY,
    );
    assertTask(
      runtime.tasks.builder_record_creation_intent_v1,
      "builder_record_creation_intent_v1",
      BUILDER_RECORD_CREATION_INTENT_DISABLED_POLICY_KEY,
    );
    assertTask(
      runtime.tasks.builder_record_update_intent_v1,
      "builder_record_update_intent_v1",
      BUILDER_RECORD_UPDATE_INTENT_DISABLED_POLICY_KEY,
    );
    assertTask(
      runtime.tasks.builder_record_location_link_intent_v1,
      "builder_record_location_link_intent_v1",
      BUILDER_RECORD_LOCATION_LINK_INTENT_DISABLED_POLICY_KEY,
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
    assertPolicy(
      runtime.policies[BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY],
      disabledExecutionPolicies[BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY],
    );
    assertPolicy(
      runtime.policies[BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY],
      disabledExecutionPolicies[BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY],
    );
    assertPolicy(
      runtime.policies[BUILDER_RECORD_CREATION_INTENT_DISABLED_POLICY_KEY],
      disabledExecutionPolicies[
        BUILDER_RECORD_CREATION_INTENT_DISABLED_POLICY_KEY
      ],
    );
    assertPolicy(
      runtime.policies[BUILDER_RECORD_UPDATE_INTENT_DISABLED_POLICY_KEY],
      disabledExecutionPolicies[
        BUILDER_RECORD_UPDATE_INTENT_DISABLED_POLICY_KEY
      ],
    );
    assertPolicy(
      runtime.policies[BUILDER_RECORD_LOCATION_LINK_INTENT_DISABLED_POLICY_KEY],
      disabledExecutionPolicies[
        BUILDER_RECORD_LOCATION_LINK_INTENT_DISABLED_POLICY_KEY
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
  assertTask(
    runtime.tasks.builder_preorder_amendment_v1,
    "builder_preorder_amendment_v1",
    BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY,
  );
  assertTask(
    runtime.tasks.builder_location_creation_intent_v1,
    "builder_location_creation_intent_v1",
    BUILDER_LOCATION_CREATION_TERRA_MEDIUM_POLICY_KEY,
  );
  assertTask(
    runtime.tasks.builder_record_creation_intent_v1,
    "builder_record_creation_intent_v1",
    BUILDER_RECORD_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
  );
  assertTask(
    runtime.tasks.builder_record_update_intent_v1,
    "builder_record_update_intent_v1",
    BUILDER_RECORD_UPDATE_INTENT_TERRA_MEDIUM_POLICY_KEY,
  );
  assertTask(
    runtime.tasks.builder_record_location_link_intent_v1,
    "builder_record_location_link_intent_v1",
    BUILDER_RECORD_LOCATION_LINK_INTENT_DISABLED_POLICY_KEY,
  );
  assertPolicy(
    runtime.policies[BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY],
    openAiBuilderPlanningPolicy,
  );
  assertPolicy(
    runtime.policies[BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY],
    openAiBuilderConfigurationDraftingPolicy,
  );
  assertPolicy(
    runtime.policies[BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY],
    openAiBuilderPreorderAmendmentPolicy,
  );
  assertPolicy(
    runtime.policies[BUILDER_LOCATION_CREATION_TERRA_MEDIUM_POLICY_KEY],
    openAiBuilderLocationCreationPolicy,
  );
  assertPolicy(
    runtime.policies[BUILDER_RECORD_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY],
    openAiBuilderRecordCreationIntentPolicy,
  );
  assertPolicy(
    runtime.policies[BUILDER_RECORD_UPDATE_INTENT_TERRA_MEDIUM_POLICY_KEY],
    openAiBuilderRecordUpdateIntentPolicy,
  );
  assertPolicy(
    runtime.policies[BUILDER_RECORD_LOCATION_LINK_INTENT_DISABLED_POLICY_KEY],
    disabledExecutionPolicies[
      BUILDER_RECORD_LOCATION_LINK_INTENT_DISABLED_POLICY_KEY
    ],
  );
  if (
    Object.keys(runtime.providers).length !== 2 ||
    runtime.providers.disabled?.key !== "disabled" ||
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
    assertTask(
      productionRuntime.tasks.builder_plan_v1,
      "builder_plan_v1",
      BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY,
    );
    assertTask(
      productionRuntime.tasks.builder_configuration_draft_v1,
      "builder_configuration_draft_v1",
      BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY,
    );
    assertTask(
      productionRuntime.tasks.builder_preorder_amendment_v1,
      "builder_preorder_amendment_v1",
      BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY,
    );
    assertTask(
      productionRuntime.tasks.builder_location_creation_intent_v1,
      "builder_location_creation_intent_v1",
      BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY,
    );
    assertTask(
      productionRuntime.tasks.builder_record_creation_intent_v1,
      "builder_record_creation_intent_v1",
      BUILDER_RECORD_CREATION_INTENT_DISABLED_POLICY_KEY,
    );
    assertTask(
      productionRuntime.tasks.builder_record_update_intent_v1,
      "builder_record_update_intent_v1",
      BUILDER_RECORD_UPDATE_INTENT_DISABLED_POLICY_KEY,
    );
    assertTask(
      productionRuntime.tasks.builder_record_location_link_intent_v1,
      "builder_record_location_link_intent_v1",
      BUILDER_RECORD_LOCATION_LINK_INTENT_DISABLED_POLICY_KEY,
    );
    assertPolicy(
      productionRuntime.policies[BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY],
      providerMode === "openai"
        ? openAiBuilderPlanningPolicy
        : disabledExecutionPolicies[BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY],
    );
    assertPolicy(
      productionRuntime.policies[
        BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY
      ],
      disabledExecutionPolicies[
        BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY
      ],
    );
    assertPolicy(
      productionRuntime.policies[
        BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY
      ],
      disabledExecutionPolicies[BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY],
    );
    assertPolicy(
      productionRuntime.policies[BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY],
      disabledExecutionPolicies[BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY],
    );
    assertPolicy(
      productionRuntime.policies[
        BUILDER_RECORD_CREATION_INTENT_DISABLED_POLICY_KEY
      ],
      disabledExecutionPolicies[
        BUILDER_RECORD_CREATION_INTENT_DISABLED_POLICY_KEY
      ],
    );
    assertPolicy(
      productionRuntime.policies[
        BUILDER_RECORD_UPDATE_INTENT_DISABLED_POLICY_KEY
      ],
      disabledExecutionPolicies[
        BUILDER_RECORD_UPDATE_INTENT_DISABLED_POLICY_KEY
      ],
    );
    assertPolicy(
      productionRuntime.policies[
        BUILDER_RECORD_LOCATION_LINK_INTENT_DISABLED_POLICY_KEY
      ],
      disabledExecutionPolicies[
        BUILDER_RECORD_LOCATION_LINK_INTENT_DISABLED_POLICY_KEY
      ],
    );
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
          builder_preorder_amendment_v1: builderPreorderAmendmentTaskV1,
          builder_location_creation_intent_v1:
            builderLocationCreationIntentTaskV1,
          builder_record_creation_intent_v1: builderRecordCreationIntentTaskV1,
          builder_record_update_intent_v1: builderRecordUpdateIntentTaskV1,
          builder_record_location_link_intent_v1:
            builderRecordLocationLinkIntentTaskV1,
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
          [BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY]:
            productionRuntime.policies[
              BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY
            ],
          [BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY]:
            productionRuntime.policies[
              BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY
            ],
          [BUILDER_RECORD_CREATION_INTENT_DISABLED_POLICY_KEY]:
            productionRuntime.policies[
              BUILDER_RECORD_CREATION_INTENT_DISABLED_POLICY_KEY
            ],
          [BUILDER_RECORD_UPDATE_INTENT_DISABLED_POLICY_KEY]:
            productionRuntime.policies[
              BUILDER_RECORD_UPDATE_INTENT_DISABLED_POLICY_KEY
            ],
          [BUILDER_RECORD_LOCATION_LINK_INTENT_DISABLED_POLICY_KEY]:
            productionRuntime.policies[
              BUILDER_RECORD_LOCATION_LINK_INTENT_DISABLED_POLICY_KEY
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
    const disabledProvider = productionRuntime.providers.disabled;
    if (!configuredOpenAiProvider || !disabledProvider) {
      runtimeConfigurationError();
    }

    const qualifiedDraftTask = Object.freeze({
      ...builderConfigurationDraftTaskV1,
      policyKey: BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY,
    });
    const qualifiedPreorderAmendmentTask = Object.freeze({
      ...builderPreorderAmendmentTaskV1,
      policyKey: BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY,
    });
    const qualifiedLocationCreationIntentTask = Object.freeze({
      ...builderLocationCreationIntentTaskV1,
      policyKey: BUILDER_LOCATION_CREATION_TERRA_MEDIUM_POLICY_KEY,
    });
    const qualifiedRecordCreationIntentTask = Object.freeze({
      ...builderRecordCreationIntentTaskV1,
      policyKey: BUILDER_RECORD_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
    });
    const qualifiedRecordUpdateIntentTask = Object.freeze({
      ...builderRecordUpdateIntentTaskV1,
      policyKey: BUILDER_RECORD_UPDATE_INTENT_TERRA_MEDIUM_POLICY_KEY,
    });
    return assertPrivateRuntime({
      mode: "openai",
      tasks: Object.freeze({
        builder_plan_v1: builderPlanTaskV1,
        builder_configuration_draft_v1: qualifiedDraftTask,
        builder_preorder_amendment_v1: qualifiedPreorderAmendmentTask,
        builder_location_creation_intent_v1:
          qualifiedLocationCreationIntentTask,
        builder_record_creation_intent_v1: qualifiedRecordCreationIntentTask,
        builder_record_update_intent_v1: qualifiedRecordUpdateIntentTask,
        builder_record_location_link_intent_v1:
          builderRecordLocationLinkIntentTaskV1,
      }),
      policies: Object.freeze({
        [BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY]: openAiBuilderPlanningPolicy,
        [BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY]:
          openAiBuilderConfigurationDraftingPolicy,
        [BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY]:
          openAiBuilderPreorderAmendmentPolicy,
        [BUILDER_LOCATION_CREATION_TERRA_MEDIUM_POLICY_KEY]:
          openAiBuilderLocationCreationPolicy,
        [BUILDER_RECORD_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY]:
          openAiBuilderRecordCreationIntentPolicy,
        [BUILDER_RECORD_UPDATE_INTENT_TERRA_MEDIUM_POLICY_KEY]:
          openAiBuilderRecordUpdateIntentPolicy,
        [BUILDER_RECORD_LOCATION_LINK_INTENT_DISABLED_POLICY_KEY]:
          productionRuntime.policies[
            BUILDER_RECORD_LOCATION_LINK_INTENT_DISABLED_POLICY_KEY
          ],
      }),
      providers: Object.freeze({
        disabled: disabledProvider,
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
