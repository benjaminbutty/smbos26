import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createBuilderAiRuntime } from "../src/ai/builder/runtime";
import { AiBuilderError } from "../src/ai/builder/errors";
import { builderConfigurationDraftTaskV1 } from "../src/ai/configuration-drafting/task";
import { builderLocationCreationIntentTaskV1 } from "../src/ai/location-creation-intent/task";
import { builderPlanTaskV1 } from "../src/ai/planning/task";
import { builderPreorderAmendmentTaskV1 } from "../src/ai/preorder-amendment/task";
import type { StructuredAiProvider } from "../src/ai/contracts";
import * as aiRegistry from "../src/ai/registry";
import {
  BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY,
  BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY,
  BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY,
  BUILDER_LOCATION_CREATION_TERRA_MEDIUM_POLICY_KEY,
  BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY,
  BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY,
  BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY,
  disabledExecutionPolicies,
  openAiBuilderLocationCreationPolicy,
  openAiBuilderConfigurationDraftingPolicy,
  openAiBuilderPreorderAmendmentPolicy,
  openAiBuilderPlanningPolicy,
} from "../src/ai/policies";

function openAiProvider(): StructuredAiProvider {
  return {
    key: "openai",
    generateStructured: vi.fn(),
  };
}

function validProductionRuntime(provider: StructuredAiProvider) {
  return aiRegistry.createProductionAiRuntime(
    { AI_PROVIDER: "openai", OPENAI_API_KEY: "synthetic-runtime-key" },
    { createOpenAiProvider: () => provider },
  );
}

function expectInvalidProductionRuntime(runtime: unknown): void {
  const factory = vi
    .spyOn(aiRegistry, "createProductionAiRuntime")
    .mockReturnValue(runtime as never);
  try {
    expect(() =>
      createBuilderAiRuntime({
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic-runtime-key",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AiBuilderError>>({
        code: "ai_builder_runtime_invalid",
      }),
    );
  } finally {
    factory.mockRestore();
  }
}

describe("private Builder runtime qualification boundary", () => {
  it("keeps the global Location registration disabled", () => {
    expect(
      aiRegistry.registeredAiTasks.builder_location_creation_intent_v1,
    ).toBe(builderLocationCreationIntentTaskV1);
    expect(
      aiRegistry.registeredAiTasks.builder_location_creation_intent_v1
        .policyKey,
    ).toBe(BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY);
    expect(aiRegistry.aiExecutionPolicies).not.toHaveProperty(
      BUILDER_LOCATION_CREATION_TERRA_MEDIUM_POLICY_KEY,
    );
  });

  it("keeps the global amendment registration disabled", () => {
    expect(aiRegistry.registeredAiTasks.builder_preorder_amendment_v1).toBe(
      builderPreorderAmendmentTaskV1,
    );
    expect(
      aiRegistry.registeredAiTasks.builder_preorder_amendment_v1.policyKey,
    ).toBe(BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY);
    expect(aiRegistry.aiExecutionPolicies).not.toHaveProperty(
      BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY,
    );
  });

  it("uses the disabled amendment policy and provider in disabled mode", () => {
    const runtime = createBuilderAiRuntime({ AI_PROVIDER: "disabled" });

    expect(runtime.mode).toBe("disabled");
    expect(runtime.tasks.builder_plan_v1).toBe(builderPlanTaskV1);
    expect(runtime.tasks.builder_configuration_draft_v1).toBe(
      builderConfigurationDraftTaskV1,
    );
    expect(runtime.tasks.builder_preorder_amendment_v1).toBe(
      builderPreorderAmendmentTaskV1,
    );
    expect(runtime.tasks.builder_location_creation_intent_v1).toBe(
      builderLocationCreationIntentTaskV1,
    );
    expect(
      runtime.policies[BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY],
    ).toBe(
      disabledExecutionPolicies[BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY],
    );
    expect(
      runtime.policies[BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY],
    ).toBe(
      disabledExecutionPolicies[BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY],
    );
    expect(runtime.providers.disabled?.key).toBe("disabled");
  });

  it("maps only the private OpenAI amendment task to the qualified policy", () => {
    const provider = openAiProvider();
    const runtime = createBuilderAiRuntime(
      { AI_PROVIDER: "openai", OPENAI_API_KEY: "synthetic-runtime-key" },
      { createOpenAiProvider: () => provider },
    );
    const amendmentTask = runtime.tasks.builder_preorder_amendment_v1!;

    expect(runtime.mode).toBe("openai");
    expect(amendmentTask).not.toBe(builderPreorderAmendmentTaskV1);
    expect(amendmentTask.policyKey).toBe(
      BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY,
    );
    expect(amendmentTask.key).toBe(builderPreorderAmendmentTaskV1.key);
    expect(amendmentTask.version).toBe(builderPreorderAmendmentTaskV1.version);
    expect(amendmentTask.purposeLabel).toBe(
      builderPreorderAmendmentTaskV1.purposeLabel,
    );
    expect(amendmentTask.inputSchema).toBe(
      builderPreorderAmendmentTaskV1.inputSchema,
    );
    expect(amendmentTask.outputSchema).toBe(
      builderPreorderAmendmentTaskV1.outputSchema,
    );
    expect(amendmentTask.buildInstruction).toBe(
      builderPreorderAmendmentTaskV1.buildInstruction,
    );
    expect(amendmentTask.validateOutput).toBe(
      builderPreorderAmendmentTaskV1.validateOutput,
    );
    expect(
      runtime.policies[BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY],
    ).toBe(openAiBuilderPreorderAmendmentPolicy);
    const locationIntentTask =
      runtime.tasks.builder_location_creation_intent_v1!;
    expect(locationIntentTask).not.toBe(builderLocationCreationIntentTaskV1);
    expect(locationIntentTask.policyKey).toBe(
      BUILDER_LOCATION_CREATION_TERRA_MEDIUM_POLICY_KEY,
    );
    expect(locationIntentTask.key).toBe(
      builderLocationCreationIntentTaskV1.key,
    );
    expect(locationIntentTask.version).toBe(
      builderLocationCreationIntentTaskV1.version,
    );
    expect(locationIntentTask.purposeLabel).toBe(
      builderLocationCreationIntentTaskV1.purposeLabel,
    );
    expect(locationIntentTask.inputSchema).toBe(
      builderLocationCreationIntentTaskV1.inputSchema,
    );
    expect(locationIntentTask.outputSchema).toBe(
      builderLocationCreationIntentTaskV1.outputSchema,
    );
    expect(locationIntentTask.buildInstruction).toBe(
      builderLocationCreationIntentTaskV1.buildInstruction,
    );
    expect(locationIntentTask.validateOutput).toBe(
      builderLocationCreationIntentTaskV1.validateOutput,
    );
    expect(
      runtime.policies[BUILDER_LOCATION_CREATION_TERRA_MEDIUM_POLICY_KEY],
    ).toBe(openAiBuilderLocationCreationPolicy);
    expect(runtime.policies).not.toHaveProperty(
      BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY,
    );
    expect(runtime.providers.openai).toBe(provider);

    expect(runtime.tasks.builder_plan_v1).toBe(builderPlanTaskV1);
    expect(runtime.tasks.builder_plan_v1!.policyKey).toBe(
      BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY,
    );
    expect(runtime.policies[BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY]).toBe(
      openAiBuilderPlanningPolicy,
    );
    expect(runtime.tasks.builder_configuration_draft_v1!.key).toBe(
      builderConfigurationDraftTaskV1.key,
    );
    expect(runtime.tasks.builder_configuration_draft_v1!.policyKey).toBe(
      BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY,
    );
    expect(
      runtime.policies[BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY],
    ).toBe(openAiBuilderConfigurationDraftingPolicy);
    expect(runtime.tasks.builder_preorder_amendment_v1).not.toBe(
      runtime.tasks.builder_configuration_draft_v1,
    );
  });

  it("fails closed for missing or mismatched private runtime prerequisites", () => {
    const provider = openAiProvider();
    const production = validProductionRuntime(provider);

    const {
      builder_preorder_amendment_v1: omittedTask,
      ...tasksWithoutAmendment
    } = production.tasks;
    void omittedTask;
    expectInvalidProductionRuntime({
      ...production,
      tasks: tasksWithoutAmendment,
    });

    expectInvalidProductionRuntime({
      ...production,
      tasks: {
        ...production.tasks,
        builder_preorder_amendment_v1: {
          ...production.tasks.builder_preorder_amendment_v1,
          policyKey: BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY,
        },
      },
    });

    const {
      [BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY]: omittedPolicy,
      ...policiesWithoutAmendment
    } = production.policies;
    void omittedPolicy;
    expectInvalidProductionRuntime({
      ...production,
      policies: policiesWithoutAmendment,
    });

    expectInvalidProductionRuntime({
      ...production,
      policies: {
        ...production.policies,
        [BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY]: {
          ...production.policies[
            BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY
          ],
          key: "wrong_policy_key",
        },
      },
    });

    const { disabled: omittedProvider, ...providersWithoutDisabled } =
      production.providers;
    void omittedProvider;
    expectInvalidProductionRuntime({
      ...production,
      providers: providersWithoutDisabled,
    });

    expectInvalidProductionRuntime({
      ...production,
      providers: {
        ...production.providers,
        openai: {
          ...production.providers.openai!,
          key: "wrong_provider_key",
        },
      },
    });
  });
});
