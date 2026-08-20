import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { deriveAiReservationEnvelope } from "../src/ai/accounting/cost";
import type { StructuredAiProviderRequest } from "../src/ai/contracts";
import { environmentSchema } from "../src/env";
import { createAiExecutionService } from "../src/ai/execution";
import {
  BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY,
  OPENAI_BUILDER_PLANNING_MODEL_KEY,
  OPENAI_BUILDER_PLANNING_REASONING_EFFORT,
  disabledExecutionPolicies,
  openAiBuilderConfigurationDraftingPolicy,
  openAiBuilderLocationCreationPolicy,
  openAiBuilderPreorderAmendmentPolicy,
  openAiBuilderRecordCreationIntentPolicy,
  openAiBuilderRecordLocationLinkIntentPolicy,
  openAiBuilderRecordUpdateIntentPolicy,
  openAiBuilderPlanningPolicy,
} from "../src/ai/policies";
import {
  OPENAI_MODEL_KEY,
  OpenAiResponsesStructuredProvider,
  type OpenAiResponsesClient,
} from "../src/ai/providers/openai";
import { createProductionAiRuntime } from "../src/ai/registry";
import {
  BUILDER_PLANNING_INSTRUCTION,
  builderPlanTaskV1,
} from "../src/ai/planning/task";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

afterEach(() => {
  vi.unstubAllEnvs();
});

const approvedPhase4B2Instruction = [
  "Interpret the owner's bounded request in ordinary Business language.",
  "Use only capabilities and existing references declared in business_context.",
  "Return exactly one schema-v1 clarification result or ready owner-readable plan.",
  "Distinguish configuration steps from operational steps and preserve their dependencies.",
  "Prefer a clarification question over a high-impact unsupported or unresolved assumption.",
  "Surface workflows, rules, payments, inventory, integrations, arbitrary code, and every other unavailable capability explicitly; never pretend they exist.",
  "Never produce SQL, source code, HTTP requests, tool calls, executable workflows, executable rules, or arbitrary code.",
  "This task must not produce Milestone 5 operations, candidates, proposals, validation, application, publication, or runtime mutations.",
  "Never invent an existing Object key or Location reference.",
  "Use concepts only for generic Business concepts; a platform-only Location plan keeps the required concepts array empty and never invents a Location Object.",
  "New concepts use plan-local references only and receive no UUID or trusted platform key.",
  "Every ready-plan step includes existing_object_keys and location_references as required arrays, using empty arrays when no reference applies.",
  "Every ready-plan step is proposed planning only and requires later owner confirmation.",
  "Treat the owner's explicit request as the boundary of the plan's scope.",
  "Choose the smallest coherent plan that satisfies that request.",
  "Do not add adjacent, useful, preparatory, or follow-on work that the owner did not ask for.",
  "A Location create or update request by itself is operational Location work only.",
  "Do not associate a Location with preorder, forms, pages, views, concepts, or other configuration unless the owner explicitly asks for that association.",
  "When an existing schedule, question, setting, or other capability changes, configure that existing capability; do not define unrelated Objects, Fields, Relationships, Forms, Pages, Views, or journeys unless a genuinely missing domain definition is explicitly required.",
  "For an explicit combined new platform entity and later configuration request, create the entity first and put dependent configuration later with a dependency; never invent its UUID or platform key, and keep existing-reference arrays empty until a trusted reference exists.",
  "An assumption is a fact not explicitly supplied by the owner and not already established by business_context.",
  "Do not restate an explicit owner instruction as an assumption.",
  "Do not label the direct requested effect of a change as an assumption.",
  'In a ready plan, every assumption with impact="high" must set requires_owner_confirmation=true.',
  'Never return a ready plan containing an impact="high" assumption with requires_owner_confirmation=false.',
  "If a high-impact unknown must be resolved before a coherent plan can be proposed, return needs_clarification and ask a bounded question.",
  "If a high-impact unknown can safely be confirmed during later owner review, keep the ready-plan assumption and explicitly require owner confirmation.",
  "Prefer no assumption over inventing an unnecessary assumption.",
  "For a fully specified change to an existing capability, do not introduce an unrelated high-impact assumption.",
  "Classify low- and medium-impact assumptions honestly; do not relabel a genuinely high-impact assumption merely to pass validation.",
  "Keep references globally unique across assumptions, unsupported requirements, questions, concepts, journeys, and steps.",
  "A step may depend only on an earlier step, and affected concepts must be declared in the same plan.",
  "Use existing Object keys and Location references exactly as supplied in context.",
  "When a key or UUID is required, never substitute a label, name, guessed slug, or fabricated identifier.",
].join(" ");

function hashFile(relativePath: string): string {
  return createHash("sha256")
    .update(fs.readFileSync(path.join(repositoryRoot, relativePath)))
    .digest("hex");
}

function request(): StructuredAiProviderRequest {
  return {
    providerKey: "openai",
    modelKey: OPENAI_MODEL_KEY,
    instruction: "Return the registered structured result.",
    input: { request: "synthetic" },
    outputContract: {
      name: "test_contract",
      version: 1,
      jsonSchema: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
        additionalProperties: false,
      },
    },
    maxOutputTokens: 256,
    signal: new AbortController().signal,
  };
}

function completedResponse() {
  return {
    status: "completed",
    error: null,
    output: [
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({ result: { summary: "Ready" } }),
          },
        ],
      },
    ],
    usage: { input_tokens: 12, output_tokens: 4 },
  };
}

describe("GPT-5.6 Terra medium production profile", () => {
  it("uses the exact fixed model, policy, pricing, and reservation", () => {
    expect(OPENAI_BUILDER_PLANNING_MODEL_KEY).toBe("gpt-5.6-terra");
    expect(OPENAI_MODEL_KEY).toBe("gpt-5.6-terra");
    expect(OPENAI_BUILDER_PLANNING_REASONING_EFFORT).toBe("medium");
    expect(builderPlanTaskV1.policyKey).toBe(
      "builder_planning_terra_medium_v1",
    );
    expect(openAiBuilderPlanningPolicy).toMatchObject({
      key: "builder_planning_terra_medium_v1",
      providerKey: "openai",
      modelKey: "gpt-5.6-terra",
      inputMicrousdPerMillion: 2_500_000,
      outputMicrousdPerMillion: 15_000_000,
      serviceTier: "auto",
      maxInputBytes: 160 * 1024,
      maxBillableInputTokens: 64_000,
      maxOutputTokens: 4_096,
      timeoutMs: 30_000,
      maxAttempts: 2,
      retryDelayMs: 250,
      retryableFailureKinds: ["rate_limited", "transient"],
      reasoningEffort: "medium",
    });
    expect(deriveAiReservationEnvelope(openAiBuilderPlanningPolicy)).toEqual({
      reservedRequestCount: 1,
      reservedInputTokens: 128_000,
      reservedOutputTokens: 8_192,
      reservedCostMicrousd: 442_880,
      inputMicrousdPerMillion: 2_500_000,
      outputMicrousdPerMillion: 15_000_000,
    });
    expect(5_000_000).toBeGreaterThan(442_880);
  });

  it("keeps the disabled policy chain and contract probe network-free", async () => {
    const runtime = createProductionAiRuntime({});
    expect(runtime.policies[BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY]).toBe(
      disabledExecutionPolicies[BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY],
    );
    expect(
      runtime.policies[BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY],
    ).toMatchObject({ providerKey: "disabled", modelKey: "unconfigured" });
    const execute = createAiExecutionService({
      tasks: runtime.tasks,
      policies: runtime.policies,
      providers: runtime.providers,
    });
    await expect(
      execute.execute("contract_probe_v1", { subject: "Readiness" }),
    ).rejects.toMatchObject({ code: "ai_disabled" });
  });

  it("makes medium reasoning and cache disabling explicit in the strict stateless no-tools request", async () => {
    const create = vi.fn().mockResolvedValue(completedResponse());
    const provider = new OpenAiResponsesStructuredProvider({
      client: { responses: { create } } as OpenAiResponsesClient,
    });
    const selectedRequest = request();
    const cacheMarker = "forged-cache-breakpoint";
    await expect(
      provider.generateStructured({
        ...selectedRequest,
        reasoning: { effort: "high" },
        metadata: { model: "ignored" },
        prompt_cache_options: { mode: "implicit" },
        prompt_cache_breakpoint: cacheMarker,
        prompt_cache_key: cacheMarker,
        prompt_cache_retention: cacheMarker,
      } as StructuredAiProviderRequest & {
        reasoning: { effort: string };
        metadata: Record<string, string>;
        prompt_cache_options: { mode: string };
        prompt_cache_breakpoint: string;
        prompt_cache_key: string;
        prompt_cache_retention: string;
      }),
    ).resolves.toMatchObject({ output: { summary: "Ready" } });

    const [body, options] = create.mock.calls[0]!;
    expect(body).toMatchObject({
      model: "gpt-5.6-terra",
      store: false,
      reasoning: { effort: "medium" },
    });
    expect(body.prompt_cache_options).toEqual({ mode: "explicit" });
    expect(body.instructions).toBe(selectedRequest.instruction);
    expect(JSON.stringify(body.input)).not.toContain(cacheMarker);
    expect(body.instructions).not.toContain(cacheMarker);
    expect(options).toEqual({ signal: selectedRequest.signal });
    for (const forbidden of [
      "tools",
      "previous_response_id",
      "conversation",
      "background",
      "metadata",
      "headers",
      "baseURL",
      "reasoning_summary",
      "reasoning_content",
      "reasoning_mode",
      "prompt_cache_breakpoint",
      "prompt_cache_key",
      "prompt_cache_retention",
    ]) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });

  it("keeps the model and reasoning profile policy-owned for approved candidates", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ ...completedResponse(), service_tier: "priority" });
    const provider = new OpenAiResponsesStructuredProvider({
      client: { responses: { create } } as OpenAiResponsesClient,
    });

    await provider.generateStructured({
      ...request(),
      modelKey: "gpt-5.6-luna",
      reasoningEffort: "max",
      serviceTier: "fast",
    });

    expect(create.mock.calls[0]?.[0]).toMatchObject({
      model: "gpt-5.6-luna",
      reasoning: { effort: "max" },
      service_tier: "fast",
    });
    expect(
      (
        await provider.generateStructured({
          ...request(),
          modelKey: "gpt-5.6-luna",
          reasoningEffort: "max",
          serviceTier: "fast",
        })
      ).requestMetadata,
    ).toEqual({ service_tier: "priority" });
  });

  it("rejects models and reasoning efforts outside the closed provider allow-lists", async () => {
    const provider = new OpenAiResponsesStructuredProvider({
      client: {
        responses: { create: vi.fn().mockResolvedValue(completedResponse()) },
      } as OpenAiResponsesClient,
    });

    await expect(
      provider.generateStructured({
        ...request(),
        modelKey: "untrusted-model",
      }),
    ).rejects.toMatchObject({ kind: "invalid_request" });
    await expect(
      provider.generateStructured({
        ...request(),
        reasoningEffort: "unsupported" as never,
      }),
    ).rejects.toMatchObject({ kind: "invalid_request" });
    await expect(
      provider.generateStructured({
        ...request(),
        serviceTier: "fast",
      }),
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("keeps unrelated qualified Builder policies on Terra medium", () => {
    const unrelatedPolicies = [
      openAiBuilderPlanningPolicy,
      openAiBuilderConfigurationDraftingPolicy,
      openAiBuilderPreorderAmendmentPolicy,
      openAiBuilderLocationCreationPolicy,
      openAiBuilderRecordCreationIntentPolicy,
      openAiBuilderRecordUpdateIntentPolicy,
      openAiBuilderRecordLocationLinkIntentPolicy,
    ];
    for (const policy of unrelatedPolicies) {
      expect(policy.modelKey).toBe("gpt-5.6-terra");
      expect(policy.reasoningEffort).toBe("medium");
      expect(policy.serviceTier).toBe("auto");
    }
  });

  it("ignores unrecognised model, reasoning, and prompt-cache environment values", async () => {
    vi.stubEnv("OPENAI_PROMPT_CACHE_MODE", "implicit");
    vi.stubEnv("AI_PROMPT_CACHE_MODE", "implicit");
    vi.stubEnv("PROMPT_CACHE_MODE", "implicit");
    const provider = { key: "openai", generateStructured: vi.fn() };
    const runtime = createProductionAiRuntime(
      {
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic-key",
        OPENAI_MODEL: "untrusted-model",
        AI_MODEL: "untrusted-model",
        OPENAI_REASONING_EFFORT: "high",
        AI_REASONING_EFFORT: "high",
        OPENAI_PROMPT_CACHE_MODE: "implicit",
        AI_PROMPT_CACHE_MODE: "implicit",
        PROMPT_CACHE_MODE: "implicit",
      } as {
        AI_PROVIDER: string;
        OPENAI_API_KEY: string;
        OPENAI_MODEL: string;
        AI_MODEL: string;
        OPENAI_REASONING_EFFORT: string;
        AI_REASONING_EFFORT: string;
        OPENAI_PROMPT_CACHE_MODE: string;
        AI_PROMPT_CACHE_MODE: string;
        PROMPT_CACHE_MODE: string;
      },
      { createOpenAiProvider: () => provider },
    );
    expect(
      runtime.policies[BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY],
    ).toMatchObject({
      modelKey: "gpt-5.6-terra",
    });
    expect(environmentSchema.shape).not.toHaveProperty("OPENAI_MODEL");
    expect(environmentSchema.shape).not.toHaveProperty("AI_MODEL");
    expect(environmentSchema.shape).not.toHaveProperty(
      "OPENAI_REASONING_EFFORT",
    );
    expect(environmentSchema.shape).not.toHaveProperty("AI_REASONING_EFFORT");
    expect(environmentSchema.shape).not.toHaveProperty(
      "OPENAI_PROMPT_CACHE_MODE",
    );
    expect(environmentSchema.shape).not.toHaveProperty("AI_PROMPT_CACHE_MODE");
    expect(environmentSchema.shape).not.toHaveProperty("PROMPT_CACHE_MODE");
    expect(
      fs.readFileSync(path.join(repositoryRoot, ".env.example"), "utf8"),
    ).not.toMatch(
      /OPENAI_PROMPT_CACHE_MODE|AI_PROMPT_CACHE_MODE|PROMPT_CACHE_MODE/,
    );

    const create = vi.fn().mockResolvedValue(completedResponse());
    const openAiProvider = new OpenAiResponsesStructuredProvider({
      client: { responses: { create } } as OpenAiResponsesClient,
    });
    await openAiProvider.generateStructured(request());
    expect(create.mock.calls[0]?.[0]?.prompt_cache_options).toEqual({
      mode: "explicit",
    });
  });

  it("freezes the approved Phase 4B.2 planning subject", () => {
    expect(BUILDER_PLANNING_INSTRUCTION).toBe(approvedPhase4B2Instruction);
    expect(hashFile("src/ai/planning/schemas.ts")).toBe(
      "21b3d954f3cb0a7671c3264295f02cc02adc170d43878d7f706e5b1b14230f19",
    );
    expect(hashFile("src/ai/planning/validation.ts")).toBe(
      "da444f7e47667a695741744046579ad6d88e2f3687e2d5f39615445695d2ff75",
    );
    expect(hashFile("src/ai/planning/diagnostics.ts")).toBe(
      "fc9663ed46305d8de3275bbe96a0e23e36c17bc2ed0328162f8cbc954e012309",
    );
    expect(hashFile("src/ai/evaluation/scenarios.ts")).toBe(
      "5f75bd32ac630e38580ea30146c84df1d46d4a7763339fa2905357b0f7ff5ee9",
    );
    expect(hashFile("src/ai/evaluation/evaluator.ts")).toBe(
      "f77d75207e05cf10f8d9019454bc9db2ed117a080f0dad7aa715fc5aff5f176d",
    );
    expect(hashFile("evaluations/fixtures/synthetic-business-context.ts")).toBe(
      "6895729c912ad4beaba5306f2ae934359bda0840e2ca139f4b96b0d5be00de3c",
    );
  });
});
