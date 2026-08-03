import "server-only";

import type { AiExecutionPolicyRegistry } from "./contracts";

export const OPENAI_BUILDER_PLANNING_MODEL_KEY = "gpt-5.6-terra" as const;
export const OPENAI_BUILDER_PLANNING_REASONING_EFFORT = "medium" as const;
export const BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY =
  "builder_planning_terra_medium_v1" as const;
export const OPENAI_BUILDER_CONFIGURATION_DRAFTING_MODEL_KEY =
  "gpt-5.6-terra" as const;
export const OPENAI_BUILDER_CONFIGURATION_DRAFTING_REASONING_EFFORT =
  "medium" as const;
export const BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY =
  "builder_configuration_drafting_terra_medium_v1" as const;
export const BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY =
  "builder_configuration_drafting_disabled_v1" as const;
export const OPENAI_BUILDER_PREORDER_AMENDMENT_MODEL_KEY =
  "gpt-5.6-terra" as const;
export const OPENAI_BUILDER_PREORDER_AMENDMENT_REASONING_EFFORT =
  "medium" as const;
export const BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY =
  "builder_preorder_amendment_terra_medium_v1" as const;
export const BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY =
  "builder_preorder_amendment_disabled_v1" as const;

export const disabledExecutionPolicies = Object.freeze({
  bounded_structured_v1: Object.freeze({
    key: "bounded_structured_v1",
    providerKey: "disabled",
    modelKey: "unconfigured",
    maxInputBytes: 2_048,
    maxBillableInputTokens: 1_024,
    maxOutputTokens: 256,
    timeoutMs: 10_000,
    maxAttempts: 3,
    retryDelayMs: 100,
    retryableFailureKinds: Object.freeze([
      "rate_limited",
      "transient",
    ] as const),
    inputMicrousdPerMillion: 0,
    outputMicrousdPerMillion: 0,
  }),
  [BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY]: Object.freeze({
    key: BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY,
    providerKey: "disabled",
    modelKey: "unconfigured",
    maxInputBytes: 160 * 1024,
    maxBillableInputTokens: 64_000,
    maxOutputTokens: 4_096,
    timeoutMs: 30_000,
    maxAttempts: 2,
    retryDelayMs: 250,
    retryableFailureKinds: Object.freeze([
      "rate_limited",
      "transient",
    ] as const),
    inputMicrousdPerMillion: 0,
    outputMicrousdPerMillion: 0,
  }),
  [BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY]: Object.freeze({
    key: BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY,
    providerKey: "disabled",
    modelKey: "unconfigured",
    maxInputBytes: 256 * 1024,
    maxBillableInputTokens: 96_000,
    maxOutputTokens: 8_192,
    timeoutMs: 30_000,
    maxAttempts: 2,
    retryDelayMs: 250,
    retryableFailureKinds: Object.freeze([
      "rate_limited",
      "transient",
    ] as const),
    inputMicrousdPerMillion: 0,
    outputMicrousdPerMillion: 0,
  }),
  [BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY]: Object.freeze({
    key: BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY,
    providerKey: "disabled",
    modelKey: "unconfigured",
    maxInputBytes: 256 * 1024,
    maxBillableInputTokens: 80_000,
    maxOutputTokens: 4_096,
    timeoutMs: 30_000,
    maxAttempts: 2,
    retryDelayMs: 250,
    retryableFailureKinds: Object.freeze([
      "rate_limited",
      "transient",
    ] as const),
    inputMicrousdPerMillion: 0,
    outputMicrousdPerMillion: 0,
  }),
}) satisfies AiExecutionPolicyRegistry;

export const openAiBuilderPlanningPolicy = Object.freeze({
  ...disabledExecutionPolicies[BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY],
  providerKey: "openai",
  modelKey: OPENAI_BUILDER_PLANNING_MODEL_KEY,
  inputMicrousdPerMillion: 2_500_000,
  outputMicrousdPerMillion: 15_000_000,
});

export const openAiBuilderConfigurationDraftingPolicy = Object.freeze({
  ...disabledExecutionPolicies[
    BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY
  ],
  key: BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY,
  providerKey: "openai",
  modelKey: OPENAI_BUILDER_CONFIGURATION_DRAFTING_MODEL_KEY,
  maxInputBytes: 256 * 1024,
  maxBillableInputTokens: 96_000,
  maxOutputTokens: 8_192,
  timeoutMs: 60_000,
  maxAttempts: 2,
  retryDelayMs: 250,
  retryableFailureKinds: Object.freeze(["rate_limited", "transient"] as const),
  inputMicrousdPerMillion: 2_500_000,
  outputMicrousdPerMillion: 15_000_000,
});

export const openAiBuilderPreorderAmendmentPolicy = Object.freeze({
  ...disabledExecutionPolicies[BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY],
  key: BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY,
  providerKey: "openai",
  modelKey: OPENAI_BUILDER_PREORDER_AMENDMENT_MODEL_KEY,
  inputMicrousdPerMillion: 2_500_000,
  outputMicrousdPerMillion: 15_000_000,
});
