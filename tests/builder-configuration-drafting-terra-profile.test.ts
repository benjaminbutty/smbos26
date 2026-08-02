import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { deriveAiReservationEnvelope } from "../src/ai/accounting/cost";
import type {
  AiExecutionPolicy,
  StructuredAiProvider,
  StructuredAiProviderRequest,
} from "../src/ai/contracts";
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
import * as aiRegistry from "../src/ai/registry";
import {
  builderConfigurationDraftTaskV1,
  BUILDER_CONFIGURATION_DRAFT_INSTRUCTION,
} from "../src/ai/configuration-drafting/task";
import {
  deriveConfigurationDraftingQualificationEnvelope,
  deriveConfigurationDraftingReliabilityEnvelope,
} from "../src/ai/evaluation/configuration-drafting/envelope";
import {
  defaultLoadProductionExecution,
  runLiveConfigurationDraftingQualification,
} from "../src/ai/evaluation/configuration-drafting/live";
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

  it("obtains the isolated evaluation provider from the production runtime factory", async () => {
    const generateStructured = vi.fn(
      async (request: StructuredAiProviderRequest) => {
        expect(request.providerKey).toBe("openai");
        expect(request.modelKey).toBe("gpt-5.6-terra");
        return {
          output: structuredClone(
            compliantConfigurationDraftingOutputs.catering_enquiry_full_stack,
          ),
          usage: { inputTokens: 1_200, outputTokens: 400 },
        };
      },
    );
    const provider: StructuredAiProvider = {
      key: "openai",
      generateStructured,
    };
    const productionFactory = aiRegistry.createProductionAiRuntime;
    const factory = vi
      .spyOn(aiRegistry, "createProductionAiRuntime")
      .mockImplementation((environment) =>
        productionFactory(environment, {
          createOpenAiProvider: () => provider,
        }),
      );

    try {
      const execution = await defaultLoadProductionExecution(
        "synthetic-server-only-key",
      );
      const result = await execution.execute(
        "builder_configuration_draft_v1",
        configurationDraftingScenarios[0]!.task_input,
      );
      expect(result.metadata.providerKey).toBe("openai");
      expect(generateStructured).toHaveBeenCalledTimes(1);
      expect(factory).toHaveBeenCalledWith({
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic-server-only-key",
      });
    } finally {
      factory.mockRestore();
    }
  });

  it("fails safely when the runtime factory does not return the OpenAI provider", async () => {
    const factory = vi
      .spyOn(aiRegistry, "createProductionAiRuntime")
      .mockReturnValue({
        providers: {
          openai: { key: "wrong-provider", generateStructured: vi.fn() },
        },
      } as never);

    try {
      await expect(
        defaultLoadProductionExecution("synthetic-server-only-key"),
      ).rejects.toThrow("The evaluation runtime did not provide OpenAI.");
    } finally {
      factory.mockRestore();
    }
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
      "183aca8affac1b45cac2a4d66d921beef3458fc2a389d7080f865f14797eebff",
    );
    expect(hashFile("src/ai/configuration-drafting/diagnostics.ts")).toBe(
      "5f2c29d5df8dccb1dac49fd19201b87cf3db21934c0be320f3f97c204ec27d80",
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
    ).toBe("5132a687b9cb3a89f6d80b97fb2a0be0180e0be2f569a62a663c6c475bb00aae");
    expect(
      hashFile("src/ai/evaluation/configuration-drafting/evaluator.ts"),
    ).toBe("571c3f5bafce433583d7db8c75562d9a95456cb1891677722c0eea3712db39a8");
  });

  it("keeps provider construction in the runtime factory path", () => {
    const liveSource = fs.readFileSync(
      path.join(
        repositoryRoot,
        "src",
        "ai",
        "evaluation",
        "configuration-drafting",
        "live.ts",
      ),
      "utf8",
    );
    expect(liveSource).toContain("createProductionAiRuntime");
    expect(liveSource).not.toContain("new OpenAiResponsesStructuredProvider");
    expect(liveSource).not.toContain("Reflect.construct");
  });
});
