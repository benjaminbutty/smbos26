import "server-only";

import type { StructuredAiProvider } from "../contracts";
import { createAiExecutionService, type AiExecutionResult } from "../execution";
import {
  ACQUISITION_PLANNING_POLICY_KEY,
  disabledExecutionPolicies,
  openAiAcquisitionPlanningPolicy,
} from "../policies";
import { DisabledStructuredAiProvider } from "../providers/disabled";
import { OpenAiResponsesStructuredProvider } from "../providers/openai";
import { acquisitionPlanningTaskV1 } from "./task";

export type AcquisitionTaskKey = "acquisition_workspace_plan_v1";

export interface AcquisitionExecutionCore {
  execute(
    taskKey: AcquisitionTaskKey,
    input: unknown,
  ): Promise<AiExecutionResult>;
}

export interface AcquisitionAiRuntime {
  mode: "disabled" | "openai";
  execution: AcquisitionExecutionCore;
}

export function createAcquisitionAiRuntime(
  environment: {
    AI_PROVIDER?: string;
    OPENAI_API_KEY?: string;
  },
  overrides: {
    createOpenAiProvider?(apiKey: string): StructuredAiProvider;
  } = {},
): AcquisitionAiRuntime {
  const mode = environment.AI_PROVIDER?.trim() || "disabled";
  const disabled = Object.freeze(new DisabledStructuredAiProvider());
  if (mode !== "disabled" && mode !== "openai") {
    throw new Error("The acquisition AI provider mode is invalid.");
  }
  const apiKey = environment.OPENAI_API_KEY?.trim();
  if (mode === "openai" && !apiKey) {
    throw new Error("The acquisition AI provider configuration is incomplete.");
  }
  const provider =
    mode === "openai"
      ? (overrides.createOpenAiProvider?.(apiKey as string) ??
        new OpenAiResponsesStructuredProvider({ apiKey: apiKey as string }))
      : disabled;
  const plannerPolicy =
    mode === "openai"
      ? openAiAcquisitionPlanningPolicy
      : disabledExecutionPolicies[ACQUISITION_PLANNING_POLICY_KEY];
  const execution = createAiExecutionService({
    tasks: Object.freeze({
      acquisition_workspace_plan_v1: acquisitionPlanningTaskV1,
    }),
    policies: Object.freeze({
      [ACQUISITION_PLANNING_POLICY_KEY]: plannerPolicy,
    }),
    providers: Object.freeze({ [provider.key]: provider }),
  });
  return Object.freeze({
    mode,
    execution: Object.freeze({
      async execute(taskKey: AcquisitionTaskKey, input: unknown) {
        return execution.executePrepared(execution.prepare(taskKey, input));
      },
    }),
  });
}

export const acquisitionAiRuntime = createAcquisitionAiRuntime({
  ...(process.env.AI_PROVIDER ? { AI_PROVIDER: process.env.AI_PROVIDER } : {}),
  ...(process.env.OPENAI_API_KEY
    ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY }
    : {}),
});
