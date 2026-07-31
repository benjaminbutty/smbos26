import "server-only";

import { z } from "zod";

import type {
  AiExecutionPolicy,
  AiExecutionPolicyRegistry,
  RegisteredAiTaskRegistry,
  StructuredAiProvider,
  StructuredAiProviderRegistry,
} from "./contracts";
import { builderPlanTaskV1 } from "./planning/task";
import { DisabledStructuredAiProvider } from "./providers/disabled";
import {
  OPENAI_MODEL_KEY,
  OpenAiResponsesStructuredProvider,
} from "./providers/openai";

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
}) satisfies RegisteredAiTaskRegistry;

const disabledExecutionPolicies = Object.freeze({
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
  builder_planning_v1: Object.freeze({
    key: "builder_planning_v1",
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
}) satisfies AiExecutionPolicyRegistry;

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
    builder_planning_v1: AiExecutionPolicy;
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

function openAiBuilderPolicy() {
  return Object.freeze({
    ...disabledExecutionPolicies.builder_planning_v1,
    providerKey: "openai",
    modelKey: OPENAI_MODEL_KEY,
    inputMicrousdPerMillion: 750_000,
    outputMicrousdPerMillion: 4_500_000,
  }) satisfies AiExecutionPolicy;
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
      builder_planning_v1: openAiBuilderPolicy(),
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
