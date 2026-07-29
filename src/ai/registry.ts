import "server-only";

import { z } from "zod";

import type {
  AiExecutionPolicyRegistry,
  RegisteredAiTaskRegistry,
  StructuredAiProviderRegistry,
} from "./contracts";
import { DisabledStructuredAiProvider } from "./providers/disabled";

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

export const registeredAiTasks = Object.freeze({
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
}) satisfies RegisteredAiTaskRegistry;

export const aiExecutionPolicies = Object.freeze({
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
}) satisfies AiExecutionPolicyRegistry;

export const structuredAiProviders = Object.freeze({
  disabled: Object.freeze(new DisabledStructuredAiProvider()),
}) satisfies StructuredAiProviderRegistry;
