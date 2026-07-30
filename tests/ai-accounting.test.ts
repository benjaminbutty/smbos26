import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  calculateAiTokenCostMicrousd,
  deriveAiReservationEnvelope,
} from "../src/ai/accounting/cost";
import {
  AiAccountingServiceError,
  type AiAccountingStore,
  type AiReservation,
  type AiSettlement,
  type BusinessAiSettings,
} from "../src/ai/accounting/service";
import { createBusinessAiExecutionOrchestrator } from "../src/ai/business-execution";
import {
  StructuredAiProviderError,
  type AiExecutionPolicy,
  type StructuredAiProvider,
} from "../src/ai/contracts";
import { AiExecutionError, type AiExecutionAccounting } from "../src/ai/errors";
import { createAiExecutionService } from "../src/ai/execution";
import {
  aiExecutionPolicies,
  registeredAiTasks,
  structuredAiProviders,
} from "../src/ai/registry";

const executionId = "10000000-0000-4000-8000-000000000001";
const businessId = "10000000-0000-4000-8000-000000000002";
const now = "2026-07-29T12:00:00.000Z";

function policy(overrides: Partial<AiExecutionPolicy> = {}): AiExecutionPolicy {
  return {
    ...aiExecutionPolicies.bounded_structured_v1,
    inputMicrousdPerMillion: 2_000_000,
    outputMicrousdPerMillion: 8_000_000,
    ...overrides,
  };
}

function settings(overrides: Partial<BusinessAiSettings> = {}) {
  return {
    business_id: businessId,
    is_enabled: true,
    daily_request_limit: 25,
    daily_input_token_limit: 250_000,
    daily_output_token_limit: 100_000,
    daily_cost_limit_microusd: 5_000_000,
    created_at: now,
    updated_at: now,
    updated_by: null,
    ...overrides,
  } satisfies BusinessAiSettings;
}

function accountingStore(
  options: {
    currentSettings?: BusinessAiSettings;
    reserveError?: unknown;
    settleError?: unknown;
  } = {},
) {
  const reservation: AiReservation = {
    id: executionId,
    business_id: businessId,
    usage_day: "2026-07-29",
    status: "reserved",
    reserved_request_count: 1,
    reserved_input_tokens: 3_072,
    reserved_output_tokens: 768,
    reserved_cost_microusd: 12_288,
    reserved_at: now,
  };
  const settlement = {
    id: executionId,
    business_id: businessId,
    status: "succeeded",
    outcome_code: "ai_succeeded",
    actual_input_tokens: 0,
    actual_output_tokens: 0,
    actual_cost_microusd: 0,
    charged_input_tokens: 0,
    charged_output_tokens: 0,
    charged_cost_microusd: 0,
    provider_attempt_count: 1,
    provider_invocation_started: true,
    usage_complete: true,
    usage_overrun: false,
    settled_at: now,
  } satisfies AiSettlement;

  return {
    readSettings: vi
      .fn<AiAccountingStore["readSettings"]>()
      .mockResolvedValue(options.currentSettings ?? settings()),
    reserve: options.reserveError
      ? vi
          .fn<AiAccountingStore["reserve"]>()
          .mockRejectedValue(options.reserveError)
      : vi.fn<AiAccountingStore["reserve"]>().mockResolvedValue(reservation),
    settle: options.settleError
      ? vi
          .fn<AiAccountingStore["settle"]>()
          .mockRejectedValue(options.settleError)
      : vi.fn<AiAccountingStore["settle"]>().mockResolvedValue(settlement),
  } satisfies AiAccountingStore;
}

function executionCore(
  provider: Omit<StructuredAiProvider, "key"> &
    Partial<Pick<StructuredAiProvider, "key">>,
  selectedPolicy = policy(),
) {
  return createAiExecutionService({
    tasks: registeredAiTasks,
    policies: { bounded_structured_v1: selectedPolicy },
    providers: { disabled: { key: "disabled", ...provider } },
    sleep: async () => {},
  });
}

function orchestrator(
  provider: Omit<StructuredAiProvider, "key"> &
    Partial<Pick<StructuredAiProvider, "key">>,
  store = accountingStore(),
  selectedPolicy = policy(),
) {
  return {
    service: createBusinessAiExecutionOrchestrator({
      accounting: store,
      execution: executionCore(provider, selectedPolicy),
      generateExecutionId: () => executionId,
    }),
    store,
  };
}

describe("AI integer accounting and reservation envelopes", () => {
  it("calculates integer microusd deterministically with conservative ceiling", () => {
    expect(
      calculateAiTokenCostMicrousd({
        inputTokens: 1,
        outputTokens: 1,
        inputMicrousdPerMillion: 1,
        outputMicrousdPerMillion: 1,
      }),
    ).toBe(2);
    expect(
      calculateAiTokenCostMicrousd({
        inputTokens: 1_500_000,
        outputTokens: 250_000,
        inputMicrousdPerMillion: 2_000_000,
        outputMicrousdPerMillion: 8_000_000,
      }),
    ).toBe(5_000_000);
  });

  it("reserves the worst-case input, output, and cost across every attempt", () => {
    expect(
      deriveAiReservationEnvelope(
        policy({
          maxBillableInputTokens: 1_000,
          maxOutputTokens: 200,
          maxAttempts: 3,
        }),
      ),
    ).toEqual({
      reservedRequestCount: 1,
      reservedInputTokens: 3_000,
      reservedOutputTokens: 600,
      reservedCostMicrousd: 10_800,
      inputMicrousdPerMillion: 2_000_000,
      outputMicrousdPerMillion: 8_000_000,
    });
  });

  it("rejects unsafe integer values and monetary overflow", () => {
    expect(() =>
      calculateAiTokenCostMicrousd({
        inputTokens: Number.MAX_SAFE_INTEGER,
        outputTokens: Number.MAX_SAFE_INTEGER,
        inputMicrousdPerMillion: Number.MAX_SAFE_INTEGER,
        outputMicrousdPerMillion: Number.MAX_SAFE_INTEGER,
      }),
    ).toThrow("safe integer accounting bounds");
    expect(() =>
      calculateAiTokenCostMicrousd({
        inputTokens: 1.5,
        outputTokens: 0,
        inputMicrousdPerMillion: 1,
        outputMicrousdPerMillion: 1,
      }),
    ).toThrow("safe integer");
  });
});

describe("Business-aware AI execution accounting", () => {
  it.each([
    ["unknown task", "missing_task_v1", { subject: "Ready" }],
    ["invalid input", "contract_probe_v1", { subject: "" }],
  ])(
    "fails %s before reserving a Business budget",
    async (_label, taskKey, input) => {
      const provider = { generateStructured: vi.fn() };
      const store = accountingStore();
      const service = createBusinessAiExecutionOrchestrator({
        accounting: store,
        execution: executionCore(provider),
      });

      await expect(service.execute(taskKey, input)).rejects.toBeInstanceOf(
        AiExecutionError,
      );
      expect(store.readSettings).not.toHaveBeenCalled();
      expect(store.reserve).not.toHaveBeenCalled();
      expect(provider.generateStructured).not.toHaveBeenCalled();
    },
  );

  it("fails oversized valid input before reserving a Business budget", async () => {
    const provider = { generateStructured: vi.fn() };
    const store = accountingStore();
    const service = createBusinessAiExecutionOrchestrator({
      accounting: store,
      execution: executionCore(provider, policy({ maxInputBytes: 8 })),
    });

    await expect(
      service.execute("contract_probe_v1", { subject: "Ready" }),
    ).rejects.toMatchObject({ code: "ai_input_too_large" });
    expect(store.readSettings).not.toHaveBeenCalled();
    expect(store.reserve).not.toHaveBeenCalled();
    expect(provider.generateStructured).not.toHaveBeenCalled();
  });

  it("fails malformed trusted policy before reservation", async () => {
    const provider = { generateStructured: vi.fn() };
    const store = accountingStore();
    const service = createBusinessAiExecutionOrchestrator({
      accounting: store,
      execution: executionCore(
        provider,
        policy({ maxAttempts: 0 }) as AiExecutionPolicy,
      ),
    });

    await expect(
      service.execute("contract_probe_v1", { subject: "Ready" }),
    ).rejects.toMatchObject({ code: "ai_execution_failed" });
    expect(store.reserve).not.toHaveBeenCalled();
    expect(provider.generateStructured).not.toHaveBeenCalled();
  });

  it("prevents provider invocation when the database denies budget", async () => {
    const provider = { generateStructured: vi.fn() };
    const store = accountingStore({
      reserveError: new AiAccountingServiceError("denied", {
        message: "ai_budget_exceeded",
      }),
    });
    const { service } = orchestrator(provider, store);

    await expect(
      service.execute("contract_probe_v1", { subject: "Ready" }),
    ).rejects.toMatchObject({ code: "ai_budget_exceeded" });
    expect(provider.generateStructured).not.toHaveBeenCalled();
    expect(store.settle).not.toHaveBeenCalled();
  });

  it("settles successful aggregate actual usage", async () => {
    const provider = {
      generateStructured: vi.fn().mockResolvedValue({
        output: { summary: "Ready." },
        usage: { inputTokens: 120, outputTokens: 30 },
      }),
    };
    const { service, store } = orchestrator(provider);

    const result = await service.execute("contract_probe_v1", {
      subject: "Ready",
    });

    expect(result.accounting).toMatchObject({
      attemptsStarted: 1,
      inputTokens: 120,
      outputTokens: 30,
      usageComplete: true,
    });
    expect(store.settle).toHaveBeenCalledWith({
      executionId,
      status: "succeeded",
      outcomeCode: "ai_succeeded",
      actualInputTokens: 120,
      actualOutputTokens: 30,
      providerAttemptCount: 1,
      providerInvocationStarted: true,
      usageComplete: true,
    });
  });

  it("aggregates metered usage from a failed attempt and successful retry", async () => {
    const provider = {
      generateStructured: vi
        .fn()
        .mockRejectedValueOnce(
          new StructuredAiProviderError("transient", "retry", {
            usage: { inputTokens: 100, outputTokens: 10 },
          }),
        )
        .mockResolvedValueOnce({
          output: { summary: "Recovered." },
          usage: { inputTokens: 80, outputTokens: 20 },
        }),
    };
    const { service, store } = orchestrator(provider);

    const result = await service.execute("contract_probe_v1", {
      subject: "Ready",
    });

    expect(result.metadata.usage).toEqual({
      inputTokens: 180,
      outputTokens: 30,
      complete: true,
    });
    expect(store.settle).toHaveBeenCalledWith(
      expect.objectContaining({
        actualInputTokens: 180,
        actualOutputTokens: 30,
        providerAttemptCount: 2,
        usageComplete: true,
      }),
    );
  });

  it("carries invalid-output usage into failure settlement", async () => {
    const provider = {
      generateStructured: vi.fn().mockResolvedValue({
        output: { summary: 42 },
        usage: { inputTokens: 50, outputTokens: 8 },
      }),
    };
    const { service, store } = orchestrator(provider);

    await expect(
      service.execute("contract_probe_v1", { subject: "Ready" }),
    ).rejects.toMatchObject({ code: "ai_output_invalid" });
    expect(store.settle).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        outcomeCode: "ai_output_invalid",
        actualInputTokens: 50,
        actualOutputTokens: 8,
        usageComplete: true,
      }),
    );
  });

  it("settles timeout and unknown usage conservatively", async () => {
    const provider = {
      generateStructured: vi.fn(() => new Promise<never>(() => undefined)),
    };
    const store = accountingStore();
    const { service } = orchestrator(provider, store, policy({ timeoutMs: 5 }));

    await expect(
      service.execute("contract_probe_v1", { subject: "Ready" }),
    ).rejects.toMatchObject({ code: "ai_timeout" });
    expect(store.settle).toHaveBeenCalledWith({
      executionId,
      status: "failed",
      outcomeCode: "ai_timeout",
      actualInputTokens: null,
      actualOutputTokens: null,
      providerAttemptCount: 1,
      providerInvocationStarted: true,
      usageComplete: false,
    });
  });

  it("cancels a reservation when execution fails before provider invocation", async () => {
    const store = accountingStore();
    const descriptor = {
      taskKey: "contract_probe_v1",
      taskVersion: 1,
      purposeLabel: "Readiness",
      policy: policy(),
    };
    const beforeProvider: AiExecutionAccounting = {
      attemptsStarted: 0,
      inputTokens: 0,
      outputTokens: 0,
      usageReported: false,
      usageComplete: true,
      providerInvocationStarted: false,
      failureBeforeProviderInvocation: true,
    };
    const service = createBusinessAiExecutionOrchestrator({
      accounting: store,
      execution: {
        prepare: () => ({ descriptor }),
        executePrepared: async () => {
          throw new AiExecutionError("ai_execution_failed", {
            accounting: beforeProvider,
          });
        },
      },
      generateExecutionId: () => executionId,
    });

    await expect(
      service.execute("contract_probe_v1", { subject: "Ready" }),
    ).rejects.toMatchObject({ code: "ai_execution_failed" });
    expect(store.settle).toHaveBeenCalledWith({
      executionId,
      status: "cancelled",
      outcomeCode: "ai_cancelled",
      actualInputTokens: 0,
      actualOutputTokens: 0,
      providerAttemptCount: 0,
      providerInvocationStarted: false,
      usageComplete: true,
    });
  });

  it("does not return successful output when settlement fails twice", async () => {
    const provider = {
      generateStructured: vi.fn().mockResolvedValue({
        output: { summary: "Must not escape." },
        usage: { inputTokens: 10, outputTokens: 2 },
      }),
    };
    const store = accountingStore({
      settleError: new Error("database unavailable"),
    });
    const { service } = orchestrator(provider, store);

    await expect(
      service.execute("contract_probe_v1", { subject: "Ready" }),
    ).rejects.toMatchObject({ code: "ai_accounting_failed" });
    expect(store.settle).toHaveBeenCalledTimes(2);
  });

  it("never copies provider metadata into reservation or settlement", async () => {
    const provider = {
      generateStructured: vi.fn().mockResolvedValue({
        output: { summary: "Ready." },
        usage: { inputTokens: 10, outputTokens: 2 },
        requestMetadata: {
          request_id: "safe-id",
          arbitrary: "fake-api-key-do-not-store",
        },
      }),
    };
    const { service, store } = orchestrator(provider);

    await service.execute("contract_probe_v1", { subject: "Ready" });

    expect(JSON.stringify(store.reserve.mock.calls)).not.toContain(
      "fake-api-key-do-not-store",
    );
    expect(JSON.stringify(store.settle.mock.calls)).not.toContain(
      "fake-api-key-do-not-store",
    );
  });
});

describe("Phase 1B source boundaries", () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = path.resolve(testDirectory, "..");
  const aiSource = fs
    .readdirSync(path.join(repositoryRoot, "src", "ai"), {
      recursive: true,
      withFileTypes: true,
    })
    .filter(
      (entry) => entry.isFile() && /\.(?:c|m)?(?:j|t)sx?$/.test(entry.name),
    )
    .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name)))
    .join("\n");
  const appSource = fs
    .readdirSync(path.join(repositoryRoot, "src", "app"), {
      recursive: true,
      withFileTypes: true,
    })
    .filter(
      (entry) => entry.isFile() && /\.(?:c|m)?(?:j|t)sx?$/.test(entry.name),
    )
    .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name)))
    .join("\n");

  it("keeps configuration lifecycle and operational mutation out of AI source", () => {
    expect(aiSource).not.toMatch(
      /ConfigurationChangeService|propose_configuration_change|validate_configuration_change|apply_configuration_change|create_graph_record|submit_public_preorder/,
    );
  });

  it("adds no route or Server Action AI caller", () => {
    expect(appSource).not.toMatch(
      /createBusinessAiExecutionService|aiExecutionService|reserve_business_ai_execution|settle_business_ai_execution/,
    );
  });

  it("keeps the production registry disabled with no successful fake", () => {
    expect(structuredAiProviders).toEqual({
      disabled: expect.anything(),
    });
    expect(aiExecutionPolicies.bounded_structured_v1.providerKey).toBe(
      "disabled",
    );
    expect(aiSource).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|node:https/);
  });

  it("adds no provider SDK dependency", () => {
    const packageJson = fs.readFileSync(
      path.join(repositoryRoot, "package.json"),
      "utf8",
    );
    expect(packageJson).not.toMatch(
      /"openai"|"anthropic"|"@google\/generative-ai"/,
    );
  });
});
