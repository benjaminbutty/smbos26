import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import {
  StructuredAiProviderError,
  type AiExecutionPolicy,
  type StructuredAiProvider,
  type StructuredAiProviderRequest,
} from "../src/ai/contracts";
import { AiExecutionError } from "../src/ai/errors";
import {
  aiExecutionService,
  createAiExecutionService,
} from "../src/ai/execution";
import { aiExecutionPolicies, registeredAiTasks } from "../src/ai/registry";
import { OpenAiInvalidRequestDiagnostic } from "../src/ai/providers/openai-diagnostics";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "..");

function policy(overrides: Partial<AiExecutionPolicy> = {}): AiExecutionPolicy {
  return {
    ...aiExecutionPolicies.bounded_structured_v1,
    ...overrides,
  };
}

function serviceWith(
  provider: Omit<StructuredAiProvider, "key"> &
    Partial<Pick<StructuredAiProvider, "key">>,
  options: {
    policy?: AiExecutionPolicy;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
) {
  return createAiExecutionService({
    tasks: registeredAiTasks,
    policies: {
      bounded_structured_v1: options.policy ?? policy(),
    },
    providers: {
      disabled: { key: "disabled", ...provider },
    },
    ...(options.sleep ? { sleep: options.sleep } : {}),
  });
}

function expectAiError(
  error: unknown,
  code: AiExecutionError["code"],
): asserts error is AiExecutionError {
  expect(error).toBeInstanceOf(AiExecutionError);
  expect((error as AiExecutionError).code).toBe(code);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("provider-neutral structured AI execution", () => {
  it("returns strictly parsed output and bounded metadata", async () => {
    const generateStructured = vi.fn().mockResolvedValue({
      output: { summary: "Ready." },
      usage: { inputTokens: 12, outputTokens: 3 },
      requestMetadata: { request_id: "safe-id", cached: false },
    });

    const result = await serviceWith({ generateStructured }).execute(
      "contract_probe_v1",
      { subject: "Readiness" },
    );

    expect(result).toEqual({
      output: { summary: "Ready." },
      accounting: {
        attemptsStarted: 1,
        inputTokens: 12,
        outputTokens: 3,
        usageReported: true,
        usageComplete: true,
        providerInvocationStarted: true,
        failureBeforeProviderInvocation: false,
      },
      metadata: {
        taskKey: "contract_probe_v1",
        taskVersion: 1,
        purposeLabel: "Verify structured AI execution readiness",
        providerKey: "disabled",
        modelKey: "unconfigured",
        attempts: 1,
        usage: { inputTokens: 12, outputTokens: 3, complete: true },
        requestMetadata: { request_id: "safe-id", cached: false },
      },
    });
    expect(generateStructured).toHaveBeenCalledOnce();
  });

  it("rejects invalid task input before invoking the provider", async () => {
    const generateStructured = vi.fn();

    await expect(
      serviceWith({ generateStructured }).execute("contract_probe_v1", {
        subject: "",
      }),
    ).rejects.toMatchObject({ code: "ai_input_invalid" });
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it("fails closed when a provider registry key does not match its declaration", async () => {
    const generateStructured = vi.fn();

    await expect(
      serviceWith({
        key: "different_provider",
        generateStructured,
      }).execute("contract_probe_v1", { subject: "Readiness" }),
    ).rejects.toMatchObject({ code: "ai_execution_failed" });
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it("rejects oversized input before invoking the provider", async () => {
    const generateStructured = vi.fn();

    await expect(
      serviceWith(
        { generateStructured },
        { policy: policy({ maxInputBytes: 20 }) },
      ).execute("contract_probe_v1", {
        subject: "This input is over the fixed byte limit.",
      }),
    ).rejects.toMatchObject({ code: "ai_input_too_large" });
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it("fails closed for an unknown task identity", async () => {
    const generateStructured = vi.fn();

    await expect(
      serviceWith({ generateStructured }).execute("unknown_task_v1", {
        subject: "Readiness",
      }),
    ).rejects.toMatchObject({ code: "ai_task_not_found" });
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it("keeps the production provider disabled and makes no network request", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("fetch must not be called"));

    await expect(
      aiExecutionService.execute("contract_probe_v1", {
        subject: "Readiness",
      }),
    ).rejects.toMatchObject({ code: "ai_disabled" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails closed when the provider output does not match the schema", async () => {
    const generateStructured = vi.fn().mockResolvedValue({
      output: { summary: 123 },
    });

    await expect(
      serviceWith({ generateStructured }).execute("contract_probe_v1", {
        subject: "Readiness",
      }),
    ).rejects.toMatchObject({ code: "ai_output_invalid" });
    expect(generateStructured).toHaveBeenCalledOnce();
  });

  it("runs optional semantic validation after strict parsing and preserves usage on failure", async () => {
    const validateOutput = vi.fn(() => {
      throw new Error("semantic detail must remain internal");
    });
    const inputSchema = z.object({ expected: z.string() }).strict();
    const outputSchema = z.object({ value: z.string() }).strict();
    const service = createAiExecutionService({
      tasks: {
        semantic_probe_v1: {
          key: "semantic_probe_v1",
          version: 1,
          purposeLabel: "Verify semantic output validation",
          policyKey: "bounded_structured_v1",
          inputSchema,
          outputSchema,
          buildInstruction: () => "Return the registered value.",
          validateOutput,
        },
      },
      policies: {
        bounded_structured_v1: policy(),
      },
      providers: {
        disabled: {
          key: "disabled",
          generateStructured: vi.fn().mockResolvedValue({
            output: { value: "strictly valid" },
            usage: { inputTokens: 31, outputTokens: 7 },
          }),
        },
      },
    });

    let caught: unknown;
    try {
      await service.execute("semantic_probe_v1", { expected: "different" });
    } catch (error) {
      caught = error;
    }

    expectAiError(caught, "ai_output_invalid");
    expect(validateOutput).toHaveBeenCalledWith(
      { expected: "different" },
      { value: "strictly valid" },
    );
    expect(caught.accounting).toMatchObject({
      inputTokens: 31,
      outputTokens: 7,
      usageReported: true,
      usageComplete: true,
    });
    expect(JSON.stringify(caught)).not.toContain("semantic detail");
  });

  it("accepts the value returned by a successful semantic validator", async () => {
    const inputSchema = z.object({ expected: z.string() }).strict();
    const outputSchema = z.object({ value: z.string() }).strict();
    const service = createAiExecutionService({
      tasks: {
        semantic_probe_v1: {
          key: "semantic_probe_v1",
          version: 1,
          purposeLabel: "Verify semantic output validation",
          policyKey: "bounded_structured_v1",
          inputSchema,
          outputSchema,
          buildInstruction: () => "Return the registered value.",
          validateOutput: (
            input: z.infer<typeof inputSchema>,
            output: z.infer<typeof outputSchema>,
          ) => {
            expect(output.value).toBe(input.expected);
            return output;
          },
        },
      },
      policies: {
        bounded_structured_v1: policy(),
      },
      providers: {
        disabled: {
          key: "disabled",
          generateStructured: vi.fn().mockResolvedValue({
            output: { value: "matching" },
          }),
        },
      },
    });

    await expect(
      service.execute("semantic_probe_v1", { expected: "matching" }),
    ).resolves.toMatchObject({ output: { value: "matching" } });
  });

  it("attempts a non-retryable provider failure exactly once", async () => {
    const generateStructured = vi
      .fn()
      .mockRejectedValue(
        new StructuredAiProviderError("unavailable", "provider detail"),
      );
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      serviceWith({ generateStructured }, { sleep }).execute(
        "contract_probe_v1",
        { subject: "Readiness" },
      ),
    ).rejects.toMatchObject({ code: "ai_provider_unavailable" });
    expect(generateStructured).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("keeps public errors and zero-usage accounting unchanged for invalid requests", async () => {
    const generateStructured = vi.fn().mockRejectedValue(
      new StructuredAiProviderError("invalid_request", "provider detail", {
        cause: new OpenAiInvalidRequestDiagnostic(
          "provider_invalid_request_unknown",
        ),
      }),
    );

    let caught: unknown;
    try {
      await serviceWith({ generateStructured }).execute("contract_probe_v1", {
        subject: "Readiness",
      });
    } catch (error) {
      caught = error;
    }

    expectAiError(caught, "ai_execution_failed");
    expect(caught.accounting).toEqual({
      attemptsStarted: 1,
      inputTokens: 0,
      outputTokens: 0,
      usageReported: false,
      usageComplete: false,
      providerInvocationStarted: true,
      failureBeforeProviderInvocation: false,
    });
    expect(caught.toJSON()).toEqual({
      code: "ai_execution_failed",
      message: "The AI request could not be completed safely.",
    });
    expect(JSON.stringify(caught)).not.toContain(
      "provider_invalid_request_unknown",
    );
    expect(generateStructured).toHaveBeenCalledOnce();
  });

  it("retries a transient failure only to the fixed maximum", async () => {
    const generateStructured = vi
      .fn()
      .mockRejectedValue(
        new StructuredAiProviderError("transient", "provider detail"),
      );
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      serviceWith(
        { generateStructured },
        { policy: policy({ maxAttempts: 3, retryDelayMs: 7 }), sleep },
      ).execute("contract_probe_v1", { subject: "Readiness" }),
    ).rejects.toMatchObject({ code: "ai_attempts_exhausted" });
    expect(generateStructured).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 7);
    expect(sleep).toHaveBeenNthCalledWith(2, 7);
  });

  it("returns a parsed result after a later successful retry", async () => {
    const generateStructured = vi
      .fn()
      .mockRejectedValueOnce(
        new StructuredAiProviderError("transient", "provider detail"),
      )
      .mockResolvedValueOnce({ output: { summary: "Recovered." } });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await serviceWith({ generateStructured }, { sleep }).execute(
      "contract_probe_v1",
      { subject: "Readiness" },
    );

    expect(result.output).toEqual({ summary: "Recovered." });
    expect(result.metadata.attempts).toBe(2);
    expect(generateStructured).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("aborts a provider attempt when the trusted timeout expires", async () => {
    let receivedSignal: AbortSignal | undefined;
    const generateStructured = vi.fn(
      (request: StructuredAiProviderRequest) =>
        new Promise<never>(() => {
          receivedSignal = request.signal;
        }),
    );

    await expect(
      serviceWith(
        { generateStructured },
        { policy: policy({ timeoutMs: 10 }) },
      ).execute("contract_probe_v1", { subject: "Readiness" }),
    ).rejects.toMatchObject({ code: "ai_timeout" });

    expect(generateStructured).toHaveBeenCalledOnce();
    expect(receivedSignal?.aborted).toBe(true);
  });

  it("passes only fixed server policy and registered contract values", async () => {
    const generateStructured = vi.fn().mockResolvedValue({
      output: { summary: "Ready." },
    });
    const fixedPolicy = policy({
      providerKey: "disabled",
      modelKey: "server-model",
      maxOutputTokens: 77,
      timeoutMs: 12_345,
      maxAttempts: 2,
    });

    await serviceWith({ generateStructured }, { policy: fixedPolicy }).execute(
      "contract_probe_v1",
      { subject: "Readiness" },
    );

    const request = generateStructured.mock
      .calls[0]?.[0] as StructuredAiProviderRequest;
    expect(request).toMatchObject({
      providerKey: "disabled",
      modelKey: "server-model",
      reasoningEffort: "medium",
      serviceTier: "auto",
      input: { subject: "Readiness" },
      maxOutputTokens: 77,
      outputContract: {
        name: "contract_probe_v1",
        version: 1,
      },
    });
    expect(request.outputContract.jsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["summary"],
    });
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(request).not.toHaveProperty("timeoutMs");
    expect(request).not.toHaveProperty("maxAttempts");
    expect(request).not.toHaveProperty("apiKey");
    expect(request).not.toHaveProperty("baseUrl");
    expect(request).not.toHaveProperty("headers");
    expect(request).not.toHaveProperty("tools");
  });

  it("rejects unknown and missing output properties through the strict task schema", async () => {
    const unknownPropertyProvider = vi.fn().mockResolvedValue({
      output: { summary: "Ready.", raw: "not allowed" },
    });
    const missingPropertyProvider = vi.fn().mockResolvedValue({
      output: {},
    });

    await expect(
      serviceWith({
        generateStructured: unknownPropertyProvider,
      }).execute("contract_probe_v1", { subject: "Readiness" }),
    ).rejects.toMatchObject({ code: "ai_output_invalid" });
    await expect(
      serviceWith({
        generateStructured: missingPropertyProvider,
      }).execute("contract_probe_v1", { subject: "Readiness" }),
    ).rejects.toMatchObject({ code: "ai_output_invalid" });
  });

  it("serialises invalid-output errors without input, prompt, or output data", async () => {
    const fakeSecret = "fake-api-key-never-expose";
    const rawPrompt =
      "Return one concise summary that matches the registered output contract.";
    const rawOutput = "raw provider body never expose";
    const generateStructured = vi.fn((request: StructuredAiProviderRequest) => {
      expect(request.instruction).toBe(rawPrompt);
      return Promise.resolve({
        output: {
          summary: { fakeSecret },
          rawOutput,
        },
      });
    });

    let caught: unknown;
    try {
      await serviceWith({ generateStructured }).execute("contract_probe_v1", {
        subject: fakeSecret,
      });
    } catch (error) {
      caught = error;
    }

    expectAiError(caught, "ai_output_invalid");
    const serialised = JSON.stringify(caught);
    expect(serialised).toBe(
      JSON.stringify({
        code: "ai_output_invalid",
        message: "The AI service returned an invalid result.",
      }),
    );
    expect(serialised).not.toContain(fakeSecret);
    expect(serialised).not.toContain(rawPrompt);
    expect(serialised).not.toContain(rawOutput);
  });

  it("preserves unexpected programming causes behind a safe execution error", async () => {
    const providerCause = {
      programmingFault: "unexpected test failure",
    };
    const generateStructured = vi.fn().mockRejectedValue(providerCause);

    let caught: unknown;
    try {
      await serviceWith({ generateStructured }).execute("contract_probe_v1", {
        subject: "Readiness",
      });
    } catch (error) {
      caught = error;
    }

    expectAiError(caught, "ai_execution_failed");
    expect(caught.cause).toBe(providerCause);
    const serialised = JSON.stringify(caught);
    expect(serialised).toBe(
      JSON.stringify({
        code: "ai_execution_failed",
        message: "The AI request could not be completed safely.",
      }),
    );
  });
});

describe("production AI source boundaries", () => {
  const aiRoot = path.join(repositoryRoot, "src", "ai");
  const productionTypeScript = fs
    .readdirSync(aiRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter(
      (file) =>
        !file.includes(`${path.sep}configuration-proposal${path.sep}`) &&
        !file.endsWith(
          `${path.sep}preorder-amendment${path.sep}proposal-service.ts`,
        ),
    );

  it("keeps the provider-neutral AI runtime free of mutation dependencies", () => {
    const source = productionTypeScript
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n");
    const providerNeutralCore = productionTypeScript
      .filter(
        (file) =>
          !file.includes(`${path.sep}accounting${path.sep}`) &&
          !file.includes(`${path.sep}builder${path.sep}`) &&
          !file.endsWith(`${path.sep}business-execution.ts`) &&
          !file.endsWith(`${path.sep}planning${path.sep}service.ts`),
      )
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n");
    const nonBuilderAiSource = productionTypeScript
      .filter((file) => !file.includes(`${path.sep}builder${path.sep}`))
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n");

    expect(source).not.toMatch(
      /core\/(?:configuration|graph|preorder|experience)\/service/,
    );
    expect(source).not.toMatch(
      /propose_configuration_change|apply_configuration_change|validate_configuration_change|submit_preorder/,
    );
    expect(nonBuilderAiSource).not.toMatch(/create_record/);
    expect(providerNeutralCore).not.toMatch(/supabase|service[_-]?role/i);
  });

  it("contains no direct network implementation outside the reviewed SDK", () => {
    const providerSource = productionTypeScript
      .filter((file) => file.includes(`${path.sep}providers${path.sep}`))
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n");

    expect(providerSource).not.toMatch(
      /\bfetch\s*\(|XMLHttpRequest|node:https|axios|anthropic|generativelanguage/i,
    );
    expect(providerSource.match(/from ["']openai["']/g)).toHaveLength(1);
  });
});
