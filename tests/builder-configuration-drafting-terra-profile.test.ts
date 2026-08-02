import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { deriveAiReservationEnvelope } from "../src/ai/accounting/cost";
import type { AiExecutionPolicy } from "../src/ai/contracts";
import { createAiExecutionService } from "../src/ai/execution";
import {
  BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY,
  BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY,
  OPENAI_BUILDER_CONFIGURATION_DRAFTING_MODEL_KEY,
  OPENAI_BUILDER_CONFIGURATION_DRAFTING_REASONING_EFFORT,
  openAiBuilderConfigurationDraftingPolicy,
} from "../src/ai/policies";
import { OPENAI_MODEL_KEY } from "../src/ai/providers/openai";
import { createProductionAiRuntime } from "../src/ai/registry";
import {
  builderConfigurationDraftTaskV1,
  BUILDER_CONFIGURATION_DRAFT_INSTRUCTION,
} from "../src/ai/configuration-drafting/task";
import {
  deriveConfigurationDraftingQualificationEnvelope,
  deriveConfigurationDraftingReliabilityEnvelope,
} from "../src/ai/evaluation/configuration-drafting/envelope";
import { runLiveConfigurationDraftingQualification } from "../src/ai/evaluation/configuration-drafting/live";
import { createBuilderConfigurationDraftingEvaluationTask } from "../src/ai/evaluation/configuration-drafting/task";
import { configurationDraftingScenarios } from "../src/ai/evaluation/configuration-drafting/scenarios";
import {
  compliantConfigurationDraftingOutputs,
  createInjectedConfigurationDraftingExecution,
} from "./support/builder-configuration-drafting-evaluation-fixtures";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function hashFile(relativePath: string): string {
  return createHash("sha256")
    .update(fs.readFileSync(path.join(repositoryRoot, relativePath)))
    .digest("hex");
}

const activeEnvironment = {
  RUN_LIVE_OPENAI_CONFIGURATION_DRAFTING_QUALIFICATION: "1",
  AI_PROVIDER: "openai",
  OPENAI_API_KEY: "synthetic-server-only-key",
} as const;

describe("configuration drafting Terra medium evaluation profile", () => {
  it("uses the exact independent model, policy, bounds, pricing, and reservation", () => {
    expect(OPENAI_BUILDER_CONFIGURATION_DRAFTING_MODEL_KEY).toBe(
      "gpt-5.6-terra",
    );
    expect(OPENAI_MODEL_KEY).toBe("gpt-5.6-terra");
    expect(OPENAI_BUILDER_CONFIGURATION_DRAFTING_REASONING_EFFORT).toBe(
      "medium",
    );
    expect(openAiBuilderConfigurationDraftingPolicy).toMatchObject({
      key: "builder_configuration_drafting_terra_medium_v1",
      providerKey: "openai",
      modelKey: "gpt-5.6-terra",
      maxInputBytes: 256 * 1024,
      maxBillableInputTokens: 96_000,
      maxOutputTokens: 8_192,
      timeoutMs: 60_000,
      maxAttempts: 2,
      retryDelayMs: 250,
      retryableFailureKinds: ["rate_limited", "transient"],
      inputMicrousdPerMillion: 2_500_000,
      outputMicrousdPerMillion: 15_000_000,
    });
    expect(
      deriveAiReservationEnvelope(openAiBuilderConfigurationDraftingPolicy),
    ).toEqual({
      reservedRequestCount: 1,
      reservedInputTokens: 192_000,
      reservedOutputTokens: 16_384,
      reservedCostMicrousd: 725_760,
      inputMicrousdPerMillion: 2_500_000,
      outputMicrousdPerMillion: 15_000_000,
    });
    expect(deriveConfigurationDraftingQualificationEnvelope()).toEqual({
      perExecutionMicrousd: 725_760,
      aggregateMicrousd: 5_806_080,
      hardCeilingMicrousd: 6_000_000,
    });
    expect(deriveConfigurationDraftingReliabilityEnvelope()).toEqual({
      perExecutionMicrousd: 725_760,
      aggregateMicrousd: 17_418_240,
      hardCeilingMicrousd: 18_000_000,
    });
  });

  it("reuses the exact production subject while changing only the evaluation policy key", () => {
    const evaluationTask = createBuilderConfigurationDraftingEvaluationTask();
    expect(evaluationTask).toEqual({
      ...builderConfigurationDraftTaskV1,
      policyKey: BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY,
    });
    expect(evaluationTask.key).toBe(builderConfigurationDraftTaskV1.key);
    expect(evaluationTask.version).toBe(
      builderConfigurationDraftTaskV1.version,
    );
    expect(evaluationTask.purposeLabel).toBe(
      builderConfigurationDraftTaskV1.purposeLabel,
    );
    expect(evaluationTask.inputSchema).toBe(
      builderConfigurationDraftTaskV1.inputSchema,
    );
    expect(evaluationTask.outputSchema).toBe(
      builderConfigurationDraftTaskV1.outputSchema,
    );
    expect(evaluationTask.buildInstruction).toBe(
      builderConfigurationDraftTaskV1.buildInstruction,
    );
    expect(evaluationTask.validateOutput).toBe(
      builderConfigurationDraftTaskV1.validateOutput,
    );
    expect(builderConfigurationDraftTaskV1.policyKey).toBe(
      BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY,
    );
  });

  it("keeps provider-backed drafting out of production and inside the isolated evaluator", async () => {
    const productionProvider = {
      key: "openai",
      generateStructured: vi.fn(),
    };
    const runtime = createProductionAiRuntime(
      {
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic-server-only-key",
      },
      { createOpenAiProvider: () => productionProvider },
    );
    expect(runtime.tasks.builder_configuration_draft_v1).toBe(
      builderConfigurationDraftTaskV1,
    );
    expect(runtime.tasks.builder_configuration_draft_v1.policyKey).toBe(
      BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY,
    );
    expect(runtime.policies).not.toHaveProperty(
      BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY,
    );

    const productionExecute = createAiExecutionService({
      tasks: runtime.tasks,
      policies: runtime.policies,
      providers: runtime.providers,
    });
    await expect(
      productionExecute.execute(
        "builder_configuration_draft_v1",
        configurationDraftingScenarios[0]!.task_input,
      ),
    ).rejects.toMatchObject({ code: "ai_disabled" });
    expect(productionProvider.generateStructured).not.toHaveBeenCalled();

    let evaluationProviderCalls = 0;
    const evaluationExecute = createInjectedConfigurationDraftingExecution(
      async (scenarioId, _invocation, request) => {
        evaluationProviderCalls += 1;
        expect(request.modelKey).toBe("gpt-5.6-terra");
        return {
          output: structuredClone(
            compliantConfigurationDraftingOutputs[scenarioId],
          ),
          usage: { inputTokens: 1_200, outputTokens: 400 },
        };
      },
    );
    await evaluationExecute.execute(
      "builder_configuration_draft_v1",
      configurationDraftingScenarios[0]!.task_input,
    );
    expect(evaluationProviderCalls).toBe(1);
  });

  it("rejects an altered reservation before constructing the provider", async () => {
    const alteredPolicy: AiExecutionPolicy = {
      ...openAiBuilderConfigurationDraftingPolicy,
      maxOutputTokens:
        openAiBuilderConfigurationDraftingPolicy.maxOutputTokens + 1,
    };
    expect(() =>
      deriveConfigurationDraftingQualificationEnvelope(alteredPolicy),
    ).toThrow(RangeError);

    const loadProductionExecution = vi.fn();
    await expect(
      runLiveConfigurationDraftingQualification(activeEnvironment, {
        deriveQualificationEnvelope: () => {
          throw new RangeError("unapproved synthetic envelope");
        },
        loadProductionExecution,
      }),
    ).rejects.toThrow(RangeError);
    expect(loadProductionExecution).not.toHaveBeenCalled();
  });

  it("freezes the exact drafting subject, provider adaptation, and synthetic evaluation inputs", () => {
    expect(BUILDER_CONFIGURATION_DRAFT_INSTRUCTION).toBe(
      builderConfigurationDraftTaskV1.buildInstruction(),
    );
    expect(hashFile("src/ai/configuration-drafting/task.ts")).toBe(
      "78d72aabb0ef8a3a5b0092a4fa0d7912360aa59bd0a7eb7c11ed90ac3bf48be4",
    );
    expect(hashFile("src/ai/configuration-drafting/schemas.ts")).toBe(
      "cf3c6465ab24c45ee37d2340b42dcaa77fff261db916ec4e78ee50defd9fd30c",
    );
    expect(hashFile("src/ai/configuration-drafting/validation.ts")).toBe(
      "44fe125b93b1be03005db6eca253983f4a00b042626674a8d016a6c4685f5530",
    );
    expect(hashFile("src/ai/configuration-drafting/diagnostics.ts")).toBe(
      "dd737cbdb85de43a833a34609f51d00aa8bdc5961bef1508e6b8d7ab7e15cefe",
    );
    expect(hashFile("src/ai/providers/openai.ts")).toBe(
      "8ffd0e6c067a349e10ceacb3d047d2f7428921e0e2a2ed6420cfedd380a4eed4",
    );
    expect(hashFile("src/ai/providers/openai-schema.ts")).toBe(
      "caff37d3238d4c3bb0dbecc637122e2f412eab78a9b6a6d6e99749c340ecde6f",
    );
    expect(
      hashFile(
        "evaluations/fixtures/synthetic-configuration-drafting-context.ts",
      ),
    ).toBe("f9eab00c1583299ed8ce6d3bb8bbd60c0e2bced9c9472ddaa9318229913c1d1f");
    expect(
      hashFile("src/ai/evaluation/configuration-drafting/scenarios.ts"),
    ).toBe("1873a274b471a7f26034affcebb26af97e442c4bf390956a8f2513f17d4d90e4");
    expect(
      hashFile("src/ai/evaluation/configuration-drafting/evaluator.ts"),
    ).toBe("575fc8a297afefd9188a73c5d261ff4f954d9bec01374827606b6ff4781114d2");
  });
});
