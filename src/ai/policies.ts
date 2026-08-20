import "server-only";

import type { AiExecutionPolicyRegistry, AiServiceTier } from "./contracts";

export const OPENAI_BUILDER_PLANNING_MODEL_KEY = "gpt-5.6-terra" as const;
export const OPENAI_BUILDER_PLANNING_REASONING_EFFORT = "medium" as const;
export const OPENAI_LUNA_MODEL_KEY = "gpt-5.6-luna" as const;
export const OPENAI_SOL_MODEL_KEY = "gpt-5.6-sol" as const;
export const OPENAI_SUPPORTED_MODEL_KEYS = Object.freeze([
  OPENAI_BUILDER_PLANNING_MODEL_KEY,
  OPENAI_LUNA_MODEL_KEY,
  OPENAI_SOL_MODEL_KEY,
] as const);
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
export const OPENAI_BUILDER_LOCATION_CREATION_MODEL_KEY =
  "gpt-5.6-terra" as const;
export const OPENAI_BUILDER_LOCATION_CREATION_REASONING_EFFORT =
  "medium" as const;
export const BUILDER_LOCATION_CREATION_TERRA_MEDIUM_POLICY_KEY =
  "builder_location_creation_intent_terra_medium_v1" as const;
export const BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY =
  "builder_location_creation_intent_disabled_v1" as const;
export const BUILDER_LOCATION_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY =
  BUILDER_LOCATION_CREATION_TERRA_MEDIUM_POLICY_KEY;
export const BUILDER_LOCATION_CREATION_INTENT_DISABLED_POLICY_KEY =
  BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY;
export const OPENAI_BUILDER_LOCATION_CREATION_INTENT_MODEL_KEY =
  OPENAI_BUILDER_LOCATION_CREATION_MODEL_KEY;
export const OPENAI_BUILDER_LOCATION_CREATION_INTENT_REASONING_EFFORT =
  OPENAI_BUILDER_LOCATION_CREATION_REASONING_EFFORT;
export const OPENAI_BUILDER_RECORD_CREATION_INTENT_MODEL_KEY =
  "gpt-5.6-terra" as const;
export const OPENAI_BUILDER_RECORD_CREATION_INTENT_REASONING_EFFORT =
  "medium" as const;
export const BUILDER_RECORD_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY =
  "builder_record_creation_intent_terra_medium_v1" as const;
export const BUILDER_RECORD_CREATION_INTENT_DISABLED_POLICY_KEY =
  "builder_record_creation_intent_disabled_v1" as const;
export const OPENAI_BUILDER_RECORD_UPDATE_INTENT_MODEL_KEY =
  "gpt-5.6-terra" as const;
export const OPENAI_BUILDER_RECORD_UPDATE_INTENT_REASONING_EFFORT =
  "medium" as const;
export const BUILDER_RECORD_UPDATE_INTENT_TERRA_MEDIUM_POLICY_KEY =
  "builder_record_update_intent_terra_medium_v1" as const;
export const BUILDER_RECORD_UPDATE_INTENT_DISABLED_POLICY_KEY =
  "builder_record_update_intent_disabled_v1" as const;
export const BUILDER_RECORD_LOCATION_LINK_INTENT_DISABLED_POLICY_KEY =
  "builder_record_location_link_intent_disabled_v1" as const;
export const OPENAI_BUILDER_RECORD_LOCATION_LINK_INTENT_MODEL_KEY =
  "gpt-5.6-terra" as const;
export const OPENAI_BUILDER_RECORD_LOCATION_LINK_INTENT_REASONING_EFFORT =
  "medium" as const;
export const BUILDER_RECORD_LOCATION_LINK_INTENT_TERRA_MEDIUM_POLICY_KEY =
  "builder_record_location_link_intent_terra_medium_v1" as const;
export const ACQUISITION_PLANNING_POLICY_KEY =
  "acquisition_planning_v1" as const;
export const ACQUISITION_REQUIRED_IDENTITY_CORRECTION_POLICY_KEY =
  "acquisition_required_identity_correction_v1" as const;

// The active acquisition candidate is server-owned. Changing this profile is
// an evaluated release decision, never an owner- or environment-controlled
// setting. Candidate Sol Medium is selected only after Luna Max Standard and
// Luna Max Fast failed their required correction gates; all subjects remain
// unchanged.
export const OPENAI_ACQUISITION_MODEL_KEY = OPENAI_SOL_MODEL_KEY;
export const OPENAI_ACQUISITION_REASONING_EFFORT = "medium" as const;
export const OPENAI_ACQUISITION_SERVICE_TIER: AiServiceTier = "auto";
export const OPENAI_ACQUISITION_INPUT_MICROUSD_PER_MILLION = 5_000_000;
export const OPENAI_ACQUISITION_OUTPUT_MICROUSD_PER_MILLION = 30_000_000;

export const disabledExecutionPolicies = Object.freeze({
  bounded_structured_v1: Object.freeze({
    key: "bounded_structured_v1",
    providerKey: "disabled",
    modelKey: "unconfigured",
    reasoningEffort: "medium",
    serviceTier: "auto",
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
    reasoningEffort: "medium",
    serviceTier: "auto",
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
    reasoningEffort: "medium",
    serviceTier: "auto",
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
    reasoningEffort: "medium",
    serviceTier: "auto",
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
  [BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY]: Object.freeze({
    key: BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY,
    providerKey: "disabled",
    modelKey: "unconfigured",
    reasoningEffort: "medium",
    serviceTier: "auto",
    maxInputBytes: 256 * 1024,
    maxBillableInputTokens: 80_000,
    maxOutputTokens: 2_048,
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
  [BUILDER_RECORD_CREATION_INTENT_DISABLED_POLICY_KEY]: Object.freeze({
    key: BUILDER_RECORD_CREATION_INTENT_DISABLED_POLICY_KEY,
    providerKey: "disabled",
    modelKey: "unconfigured",
    reasoningEffort: "medium",
    serviceTier: "auto",
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
  [BUILDER_RECORD_UPDATE_INTENT_DISABLED_POLICY_KEY]: Object.freeze({
    key: BUILDER_RECORD_UPDATE_INTENT_DISABLED_POLICY_KEY,
    providerKey: "disabled",
    modelKey: "unconfigured",
    reasoningEffort: "medium",
    serviceTier: "auto",
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
  [BUILDER_RECORD_LOCATION_LINK_INTENT_DISABLED_POLICY_KEY]: Object.freeze({
    key: BUILDER_RECORD_LOCATION_LINK_INTENT_DISABLED_POLICY_KEY,
    providerKey: "disabled",
    modelKey: "unconfigured",
    reasoningEffort: "medium",
    serviceTier: "auto",
    maxInputBytes: 256 * 1024,
    maxBillableInputTokens: 80_000,
    maxOutputTokens: 2_048,
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
  [ACQUISITION_PLANNING_POLICY_KEY]: Object.freeze({
    key: ACQUISITION_PLANNING_POLICY_KEY,
    providerKey: "disabled",
    modelKey: "unconfigured",
    reasoningEffort: "medium",
    serviceTier: "auto",
    maxInputBytes: 8 * 1024,
    maxBillableInputTokens: 4_000,
    maxOutputTokens: 2_500,
    timeoutMs: 25_000,
    maxAttempts: 1,
    retryDelayMs: 0,
    retryableFailureKinds: Object.freeze([]),
    inputMicrousdPerMillion: 0,
    outputMicrousdPerMillion: 0,
  }),
  [ACQUISITION_REQUIRED_IDENTITY_CORRECTION_POLICY_KEY]: Object.freeze({
    key: ACQUISITION_REQUIRED_IDENTITY_CORRECTION_POLICY_KEY,
    providerKey: "disabled",
    modelKey: "unconfigured",
    reasoningEffort: "medium",
    serviceTier: "auto",
    maxInputBytes: 8 * 1024,
    maxBillableInputTokens: 4_000,
    maxOutputTokens: 2_500,
    timeoutMs: 25_000,
    maxAttempts: 1,
    retryDelayMs: 0,
    retryableFailureKinds: Object.freeze([]),
    inputMicrousdPerMillion: 0,
    outputMicrousdPerMillion: 0,
  }),
}) satisfies AiExecutionPolicyRegistry;

export const openAiAcquisitionPlanningPolicy = Object.freeze({
  ...disabledExecutionPolicies[ACQUISITION_PLANNING_POLICY_KEY],
  providerKey: "openai",
  modelKey: OPENAI_ACQUISITION_MODEL_KEY,
  reasoningEffort: OPENAI_ACQUISITION_REASONING_EFFORT,
  serviceTier: OPENAI_ACQUISITION_SERVICE_TIER,
  inputMicrousdPerMillion: OPENAI_ACQUISITION_INPUT_MICROUSD_PER_MILLION,
  outputMicrousdPerMillion: OPENAI_ACQUISITION_OUTPUT_MICROUSD_PER_MILLION,
});

export const openAiAcquisitionRequiredIdentityCorrectionPolicy = Object.freeze({
  ...disabledExecutionPolicies[
    ACQUISITION_REQUIRED_IDENTITY_CORRECTION_POLICY_KEY
  ],
  providerKey: "openai",
  modelKey: OPENAI_ACQUISITION_MODEL_KEY,
  reasoningEffort: OPENAI_ACQUISITION_REASONING_EFFORT,
  serviceTier: OPENAI_ACQUISITION_SERVICE_TIER,
  inputMicrousdPerMillion: OPENAI_ACQUISITION_INPUT_MICROUSD_PER_MILLION,
  outputMicrousdPerMillion: OPENAI_ACQUISITION_OUTPUT_MICROUSD_PER_MILLION,
});

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

/**
 * Qualified for the private authenticated Builder runtime only. It remains
 * outside the global/default production policy registry.
 */
export const openAiBuilderLocationCreationPolicy = Object.freeze({
  ...disabledExecutionPolicies[BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY],
  key: BUILDER_LOCATION_CREATION_TERRA_MEDIUM_POLICY_KEY,
  providerKey: "openai",
  modelKey: OPENAI_BUILDER_LOCATION_CREATION_MODEL_KEY,
  inputMicrousdPerMillion: 2_500_000,
  outputMicrousdPerMillion: 15_000_000,
});

/**
 * Qualified for the private authenticated Builder runtime only. It remains
 * outside the global/default production policy registry.
 */
export const openAiBuilderRecordCreationIntentPolicy = Object.freeze({
  ...disabledExecutionPolicies[
    BUILDER_RECORD_CREATION_INTENT_DISABLED_POLICY_KEY
  ],
  key: BUILDER_RECORD_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
  providerKey: "openai",
  modelKey: OPENAI_BUILDER_RECORD_CREATION_INTENT_MODEL_KEY,
  inputMicrousdPerMillion: 2_500_000,
  outputMicrousdPerMillion: 15_000_000,
});

/**
 * Qualified for the private authenticated Builder runtime only. It remains
 * outside the global/default production policy registry.
 */
export const openAiBuilderRecordUpdateIntentPolicy = Object.freeze({
  ...disabledExecutionPolicies[
    BUILDER_RECORD_UPDATE_INTENT_DISABLED_POLICY_KEY
  ],
  key: BUILDER_RECORD_UPDATE_INTENT_TERRA_MEDIUM_POLICY_KEY,
  providerKey: "openai",
  modelKey: OPENAI_BUILDER_RECORD_UPDATE_INTENT_MODEL_KEY,
  inputMicrousdPerMillion: 2_500_000,
  outputMicrousdPerMillion: 15_000_000,
});

/**
 * Qualified for the private authenticated Builder runtime only. It remains
 * outside the global/default production policy registry.
 */
export const openAiBuilderRecordLocationLinkIntentPolicy = Object.freeze({
  ...disabledExecutionPolicies[
    BUILDER_RECORD_LOCATION_LINK_INTENT_DISABLED_POLICY_KEY
  ],
  key: BUILDER_RECORD_LOCATION_LINK_INTENT_TERRA_MEDIUM_POLICY_KEY,
  maxInputBytes: 160 * 1024,
  maxBillableInputTokens: 48_000,
  maxOutputTokens: 1_536,
  providerKey: "openai",
  modelKey: OPENAI_BUILDER_RECORD_LOCATION_LINK_INTENT_MODEL_KEY,
  inputMicrousdPerMillion: 2_500_000,
  outputMicrousdPerMillion: 15_000_000,
});
