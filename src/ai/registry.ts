import "server-only";

import { z } from "zod";

import type {
  AiExecutionPolicy,
  RegisteredAiTaskRegistry,
  StructuredAiProvider,
  StructuredAiProviderRegistry,
} from "./contracts";
import {
  BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY,
  BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY,
  BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY,
  BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY,
  BUILDER_RECORD_CREATION_INTENT_DISABLED_POLICY_KEY,
  BUILDER_RECORD_UPDATE_INTENT_DISABLED_POLICY_KEY,
  disabledExecutionPolicies,
  openAiBuilderPlanningPolicy,
} from "./policies";
import { builderConfigurationDraftTaskV1 } from "./configuration-drafting/task";
import { builderPreorderAmendmentTaskV1 } from "./preorder-amendment/task";
import { builderLocationCreationIntentTaskV1 } from "./location-creation-intent/task";
import { builderRecordCreationIntentTaskV1 } from "./record-creation-intent/task";
import { builderRecordUpdateIntentTaskV1 } from "./record-update-intent/task";
import { builderPlanTaskV1 } from "./planning/task";
import { DisabledStructuredAiProvider } from "./providers/disabled";
import { OpenAiResponsesStructuredProvider } from "./providers/openai";

const contractProbeInputSchema = z
  .object({
    subject: z.string().trim().min(1).max(500),
  })
  .strict();

const contractProbeOutputSchema = z
  .object({
    summary: z.string().trim().min(1).max(500),
  })
  .strict();

const allRegisteredAiTasks = Object.freeze({
  contract_probe_v1: Object.freeze({
    key: "contract_probe_v1",
    version: 1,
    purposeLabel: "Verify structured AI execution readiness",
    policyKey: "bounded_structured_v1",
    inputSchema: contractProbeInputSchema,
    outputSchema: contractProbeOutputSchema,
    buildInstruction: () =>
      "Return one concise summary that matches the registered output contract.",
  }),
  builder_plan_v1: builderPlanTaskV1,
  builder_configuration_draft_v1: builderConfigurationDraftTaskV1,
  builder_preorder_amendment_v1: builderPreorderAmendmentTaskV1,
  builder_location_creation_intent_v1: builderLocationCreationIntentTaskV1,
  builder_record_creation_intent_v1: builderRecordCreationIntentTaskV1,
  builder_record_update_intent_v1: builderRecordUpdateIntentTaskV1,
}) satisfies RegisteredAiTaskRegistry;

export interface AiRuntimeServerEnvironment {
  AI_PROVIDER?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
}

interface ProductionRuntimeDependencies {
  createOpenAiProvider(apiKey: string): StructuredAiProvider;
}

export interface ProductionAiRuntime {
  tasks: typeof allRegisteredAiTasks;
  policies: Readonly<{
    bounded_structured_v1: AiExecutionPolicy;
    builder_planning_terra_medium_v1: AiExecutionPolicy;
    builder_configuration_drafting_disabled_v1: AiExecutionPolicy;
    builder_preorder_amendment_disabled_v1: AiExecutionPolicy;
    builder_location_creation_intent_disabled_v1: AiExecutionPolicy;
    builder_record_creation_intent_disabled_v1: AiExecutionPolicy;
    builder_record_update_intent_disabled_v1: AiExecutionPolicy;
  }>;
  providers: StructuredAiProviderRegistry;
}

export class AiRuntimeConfigurationError extends Error {
  constructor() {
    super("The server AI provider configuration is invalid.");
    this.name = "AiRuntimeConfigurationError";
  }
}

function validateProductionAiRuntime(
  runtime: ProductionAiRuntime,
): ProductionAiRuntime {
  try {
    for (const [providerRegistryKey, provider] of Object.entries(
      runtime.providers,
    )) {
      if (providerRegistryKey !== provider.key) {
        throw new Error("The production AI provider identity is invalid.");
      }
    }

    for (const [policyRegistryKey, policy] of Object.entries(
      runtime.policies,
    )) {
      if (policyRegistryKey !== policy.key) {
        throw new Error("The production AI policy identity is invalid.");
      }
      const provider = runtime.providers[policy.providerKey];
      if (!provider || provider.key !== policy.providerKey) {
        throw new Error("The production AI policy provider is unavailable.");
      }
    }

    for (const [taskRegistryKey, task] of Object.entries(runtime.tasks)) {
      if (taskRegistryKey !== task.key) {
        throw new Error("The production AI task identity is invalid.");
      }
      const policy = runtime.policies[task.policyKey];
      if (!policy || policy.key !== task.policyKey) {
        throw new Error("The production AI task policy is unavailable.");
      }
      const provider = runtime.providers[policy.providerKey];
      if (!provider || provider.key !== policy.providerKey) {
        throw new Error("The production AI task provider is unavailable.");
      }
    }
  } catch {
    throw new AiRuntimeConfigurationError();
  }

  return Object.freeze(runtime);
}

export function createProductionAiRuntime(
  serverEnvironment: AiRuntimeServerEnvironment,
  overrides: Partial<ProductionRuntimeDependencies> = {},
): ProductionAiRuntime {
  const providerMode = serverEnvironment.AI_PROVIDER?.trim() || "disabled";
  if (providerMode === "disabled") {
    return validateProductionAiRuntime({
      tasks: allRegisteredAiTasks,
      policies: disabledExecutionPolicies,
      providers: Object.freeze({
        disabled: Object.freeze(new DisabledStructuredAiProvider()),
      }),
    });
  }
  if (providerMode !== "openai") {
    throw new AiRuntimeConfigurationError();
  }
  const apiKey = serverEnvironment.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new AiRuntimeConfigurationError();
  }
  const createOpenAiProvider =
    overrides.createOpenAiProvider ??
    ((trustedApiKey: string) =>
      new OpenAiResponsesStructuredProvider({ apiKey: trustedApiKey }));
  return validateProductionAiRuntime({
    tasks: allRegisteredAiTasks,
    policies: Object.freeze({
      bounded_structured_v1: disabledExecutionPolicies.bounded_structured_v1,
      [BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY]: openAiBuilderPlanningPolicy,
      [BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY]:
        disabledExecutionPolicies[
          BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY
        ],
      [BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY]:
        disabledExecutionPolicies[
          BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY
        ],
      [BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY]:
        disabledExecutionPolicies[
          BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY
        ],
      [BUILDER_RECORD_CREATION_INTENT_DISABLED_POLICY_KEY]:
        disabledExecutionPolicies[
          BUILDER_RECORD_CREATION_INTENT_DISABLED_POLICY_KEY
        ],
      [BUILDER_RECORD_UPDATE_INTENT_DISABLED_POLICY_KEY]:
        disabledExecutionPolicies[
          BUILDER_RECORD_UPDATE_INTENT_DISABLED_POLICY_KEY
        ],
    }),
    providers: Object.freeze({
      disabled: Object.freeze(new DisabledStructuredAiProvider()),
      openai: Object.freeze(createOpenAiProvider(apiKey)),
    }),
  });
}

const productionRuntime = createProductionAiRuntime({
  AI_PROVIDER: process.env.AI_PROVIDER,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
});

export const registeredAiTasks = productionRuntime.tasks;
export const aiExecutionPolicies = productionRuntime.policies;
export const structuredAiProviders = productionRuntime.providers;
