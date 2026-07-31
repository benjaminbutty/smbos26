import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import { deriveAiReservationEnvelope } from "../src/ai/accounting/cost";
import {
  StructuredAiProviderError,
  type StructuredAiProviderRequest,
} from "../src/ai/contracts";
import { AiExecutionError } from "../src/ai/errors";
import { builderPlanTaskV1 } from "../src/ai/planning/task";
import {
  createOpenAiResponsesClient,
  OPENAI_MODEL_KEY,
  OpenAiResponsesStructuredProvider,
  serializeOpenAiStructuredInput,
  type OpenAiResponsesClient,
  type OpenAiSdkClientConstructor,
  type OpenAiSdkClientOptions,
} from "../src/ai/providers/openai";
import {
  adaptRegisteredSchemaForOpenAi,
  OpenAiSchemaAdaptationError,
} from "../src/ai/providers/openai-schema";
import {
  AiRuntimeConfigurationError,
  createProductionAiRuntime,
} from "../src/ai/registry";
import { createAiExecutionService } from "../src/ai/execution";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const simpleOutputSchema = {
  type: "object",
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 120 },
  },
  required: ["summary"],
  additionalProperties: false,
} as const;

function request(
  overrides: Partial<StructuredAiProviderRequest> = {},
): StructuredAiProviderRequest {
  return {
    providerKey: "openai",
    modelKey: OPENAI_MODEL_KEY,
    instruction: "Return the registered structured result.",
    input: { zeta: 2, alpha: { second: true, first: "value" } },
    outputContract: {
      name: "test_contract",
      version: 1,
      jsonSchema: simpleOutputSchema,
    },
    maxOutputTokens: 256,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function completedResponse(
  result: unknown,
  usage: { input: number; output: number } = { input: 12, output: 4 },
) {
  return {
    status: "completed",
    error: null,
    incomplete_details: null,
    output: [
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({ result }),
            annotations: [],
          },
        ],
      },
    ],
    usage: {
      input_tokens: usage.input,
      output_tokens: usage.output,
      total_tokens: usage.input + usage.output,
      input_tokens_details: {
        cached_tokens: 0,
        cache_write_tokens: 0,
      },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  };
}

function clientReturning(value: unknown): {
  client: OpenAiResponsesClient;
  create: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn().mockResolvedValue(value);
  return {
    client: { responses: { create } },
    create,
  };
}

function collectObjectSchemas(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectObjectSchemas);
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const record = value as Record<string, unknown>;
  return [
    ...(record.type === "object" || "properties" in record ? [record] : []),
    ...Object.values(record).flatMap(collectObjectSchemas),
  ];
}

describe("OpenAI strict schema adaptation", () => {
  it("adapts the actual builder plan contract into one strict object root", () => {
    const registered = z.toJSONSchema(builderPlanTaskV1.outputSchema, {
      target: "draft-7",
      unrepresentable: "throw",
    }) as Record<string, unknown>;
    const adapted = adaptRegisteredSchemaForOpenAi(registered);
    const serialized = JSON.stringify(adapted);

    expect(adapted).toMatchObject({
      type: "object",
      required: ["result"],
      additionalProperties: false,
    });
    expect(serialized).toContain('"anyOf"');
    expect(serialized).toContain('"needs_clarification"');
    expect(serialized).toContain('"ready"');
    expect(serialized).toContain('"existing_object_keys"');
    expect(serialized).toContain('"location_references"');
    for (const objectSchema of collectObjectSchemas(adapted)) {
      expect(objectSchema.additionalProperties).toBe(false);
      expect(new Set(objectSchema.required as string[])).toEqual(
        new Set(Object.keys(objectSchema.properties as object)),
      );
    }
  });

  it("converts oneOf explicitly, removes the dialect, and preserves formats", () => {
    expect(
      adaptRegisteredSchemaForOpenAi({
        $schema: "http://json-schema.org/draft-07/schema#",
        oneOf: [
          {
            type: "object",
            properties: { id: { type: "string", format: "uuid" } },
            required: ["id"],
            additionalProperties: false,
          },
        ],
      }),
    ).toEqual({
      type: "object",
      properties: {
        result: {
          anyOf: [
            {
              type: "object",
              properties: { id: { type: "string", format: "uuid" } },
              required: ["id"],
              additionalProperties: false,
            },
          ],
        },
      },
      required: ["result"],
      additionalProperties: false,
    });
  });

  it("fails closed for optional object properties and unsupported keywords", () => {
    expect(() =>
      adaptRegisteredSchemaForOpenAi({
        type: "object",
        properties: { optional: { type: "string" } },
        required: [],
      }),
    ).toThrow(OpenAiSchemaAdaptationError);
    expect(() =>
      adaptRegisteredSchemaForOpenAi({
        type: "object",
        properties: {},
        required: [],
        if: { type: "object" },
      }),
    ).toThrow(OpenAiSchemaAdaptationError);
  });
});

describe("OpenAI Responses structured provider", () => {
  it("constructs the actual SDK boundary with logging forced off", () => {
    vi.stubEnv("OPENAI_LOG", "debug");
    let receivedOptions: OpenAiSdkClientOptions | undefined;
    class CapturingOpenAiClient {
      readonly responses = { create: vi.fn() };

      constructor(options: OpenAiSdkClientOptions) {
        receivedOptions = options;
      }
    }

    createOpenAiResponsesClient(
      "synthetic-test-value",
      CapturingOpenAiClient as OpenAiSdkClientConstructor,
    );

    expect(receivedOptions).toEqual({
      apiKey: "synthetic-test-value",
      baseURL: "https://api.openai.com/v1",
      maxRetries: 0,
      organization: null,
      project: null,
      logLevel: "off",
    });
    expect(receivedOptions).not.toHaveProperty("logger");
  });

  it("overrides ambient OPENAI_LOG and sends no payload markers to the SDK logger", async () => {
    vi.stubEnv("OPENAI_LOG", "debug");
    const ownerMarker = "owner-request-must-not-be-logged";
    const contextMarker = "business-context-must-not-be-logged";
    const responseMarker = "model-response-must-not-be-logged";
    const loggerSpies = [
      vi.spyOn(console, "debug").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify(
          completedResponse({
            summary: responseMarker,
          }),
        ),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const provider = new OpenAiResponsesStructuredProvider({
      apiKey: "synthetic-test-value",
    });

    await expect(
      provider.generateStructured({
        ...request({
          instruction: ownerMarker,
          input: {
            business_summary: contextMarker,
            business_settings: { logLevel: "debug" },
            task_input: { OPENAI_LOG: "debug" },
          },
        }),
        logLevel: "debug",
        logger: console,
      } as StructuredAiProviderRequest & {
        logLevel: string;
        logger: Console;
      }),
    ).resolves.toMatchObject({
      output: { summary: responseMarker },
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    for (const loggerSpy of loggerSpies) {
      expect(loggerSpy).not.toHaveBeenCalled();
      expect(JSON.stringify(loggerSpy.mock.calls)).not.toMatch(
        new RegExp(`${ownerMarker}|${contextMarker}|${responseMarker}`),
      );
    }
  });

  it("sends a fixed, stateless, tool-free request and forwards the AbortSignal", async () => {
    const { client, create } = clientReturning(
      completedResponse({ summary: "Ready" }),
    );
    const provider = new OpenAiResponsesStructuredProvider({ client });
    const selectedRequest = request();

    await expect(provider.generateStructured(selectedRequest)).resolves.toEqual(
      {
        output: { summary: "Ready" },
        usage: { inputTokens: 12, outputTokens: 4 },
      },
    );
    const [body, options] = create.mock.calls[0]!;
    expect(body).toMatchObject({
      model: OPENAI_MODEL_KEY,
      instructions: selectedRequest.instruction,
      max_output_tokens: 256,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "test_contract_v1",
          strict: true,
        },
      },
    });
    expect(body.input).toEqual([
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: '{"alpha":{"first":"value","second":true},"zeta":2}',
          },
        ],
      },
    ]);
    expect(options).toEqual({ signal: selectedRequest.signal });
    for (const forbidden of [
      "tools",
      "tool_choice",
      "previous_response_id",
      "conversation",
      "background",
      "metadata",
      "apiKey",
      "baseURL",
      "headers",
    ]) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });

  it("serializes equivalent structured inputs byte-identically", () => {
    expect(serializeOpenAiStructuredInput({ b: 2, a: { d: 4, c: 3 } })).toBe(
      serializeOpenAiStructuredInput({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it("adapts before invocation and unwraps without changing the task result", async () => {
    const { client, create } = clientReturning(completedResponse({ ok: true }));
    const provider = new OpenAiResponsesStructuredProvider({ client });
    const unsafe = request({
      outputContract: {
        name: "unsafe",
        version: 1,
        jsonSchema: { type: "object", properties: {}, required: [], if: {} },
      },
    });

    await expect(provider.generateStructured(unsafe)).rejects.toMatchObject({
      kind: "invalid_request",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    [
      "refusal",
      {
        ...completedResponse({}),
        output: [
          {
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "refusal", refusal: "raw refusal marker" }],
          },
        ],
      },
      "refused",
    ],
    [
      "max output",
      {
        ...completedResponse({}),
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
      },
      "incomplete",
    ],
    [
      "content filter",
      {
        ...completedResponse({}),
        status: "incomplete",
        incomplete_details: { reason: "content_filter" },
      },
      "content_filtered",
    ],
    [
      "missing message",
      { ...completedResponse({}), output: [] },
      "invalid_response",
    ],
    [
      "multiple messages",
      {
        ...completedResponse({}),
        output: [
          ...completedResponse({ first: true }).output,
          ...completedResponse({ second: true }).output,
        ],
      },
      "invalid_response",
    ],
    [
      "malformed JSON",
      {
        ...completedResponse({}),
        output: [
          {
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              { type: "output_text", text: "{not-json", annotations: [] },
            ],
          },
        ],
      },
      "invalid_response",
    ],
  ])(
    "fails safely for %s and retains reported usage",
    async (_label, raw, kind) => {
      const { client } = clientReturning(raw);
      const provider = new OpenAiResponsesStructuredProvider({ client });

      await expect(
        provider.generateStructured(request()),
      ).rejects.toMatchObject({
        kind,
        usage: { inputTokens: 12, outputTokens: 4 },
      });
    },
  );

  it.each([
    [429, "rate_limited"],
    [500, "transient"],
    [503, "transient"],
    [400, "invalid_request"],
    [422, "invalid_request"],
    [401, "unavailable"],
    [403, "unavailable"],
  ])(
    "maps HTTP %i without exposing provider material",
    async (status, kind) => {
      const secret = "provider-body-secret-marker";
      const create = vi.fn().mockRejectedValue({
        name: "APIError",
        status,
        body: secret,
        headers: { authorization: secret },
      });
      const provider = new OpenAiResponsesStructuredProvider({
        client: { responses: { create } },
      });
      let caught: StructuredAiProviderError | undefined;
      try {
        await provider.generateStructured(request());
      } catch (cause) {
        caught = cause as StructuredAiProviderError;
      }

      expect(caught).toMatchObject({ kind });
      expect(JSON.stringify(caught)).not.toContain(secret);
      const publicError = new AiExecutionError("ai_execution_failed", {
        cause: caught,
      });
      expect(JSON.stringify(publicError)).not.toContain(secret);
    },
  );
});

describe("server-owned OpenAI runtime and pricing", () => {
  it("defaults missing and blank provider mode to disabled without constructing OpenAI", () => {
    const createOpenAiProvider = vi.fn();
    expect(
      createProductionAiRuntime({}, { createOpenAiProvider }).providers,
    ).toHaveProperty("disabled");
    expect(
      createProductionAiRuntime(
        { AI_PROVIDER: "   ", OPENAI_API_KEY: "ignored" },
        { createOpenAiProvider },
      ).providers,
    ).toHaveProperty("disabled");
    expect(createOpenAiProvider).not.toHaveBeenCalled();
  });

  it("fails closed for an unknown mode or missing key without echoing values", () => {
    expect(() =>
      createProductionAiRuntime({ AI_PROVIDER: "unknown-secret-mode" }),
    ).toThrow(AiRuntimeConfigurationError);
    expect(() => createProductionAiRuntime({ AI_PROVIDER: "openai" })).toThrow(
      AiRuntimeConfigurationError,
    );
    for (const input of [
      { AI_PROVIDER: "unknown-secret-mode" },
      { AI_PROVIDER: "openai" },
    ]) {
      try {
        createProductionAiRuntime(input);
      } catch (error) {
        expect(JSON.stringify(error)).not.toContain("unknown-secret-mode");
      }
    }
  });

  it("constructs the complete fixed provider registry, model, policy, and pricing", () => {
    const provider = {
      key: "openai",
      generateStructured: vi.fn(),
    };
    const createOpenAiProvider = vi.fn().mockReturnValue(provider);
    const runtime = createProductionAiRuntime(
      {
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic-test-value",
      },
      { createOpenAiProvider },
    );

    expect(createOpenAiProvider).toHaveBeenCalledWith("synthetic-test-value");
    expect(Object.keys(runtime.providers).toSorted()).toEqual([
      "disabled",
      "openai",
    ]);
    expect(runtime.providers.openai).toBe(provider);
    expect(runtime.providers.disabled?.key).toBe("disabled");
    expect(runtime.policies.builder_planning_v1).toMatchObject({
      providerKey: "openai",
      modelKey: OPENAI_MODEL_KEY,
      maxInputBytes: 160 * 1024,
      maxBillableInputTokens: 64_000,
      maxOutputTokens: 4_096,
      timeoutMs: 30_000,
      maxAttempts: 2,
      retryDelayMs: 250,
      retryableFailureKinds: ["rate_limited", "transient"],
      inputMicrousdPerMillion: 750_000,
      outputMicrousdPerMillion: 4_500_000,
    });
    expect(
      deriveAiReservationEnvelope(runtime.policies.builder_planning_v1),
    ).toEqual({
      reservedRequestCount: 1,
      reservedInputTokens: 128_000,
      reservedOutputTokens: 8_192,
      reservedCostMicrousd: 132_864,
      inputMicrousdPerMillion: 750_000,
      outputMicrousdPerMillion: 4_500_000,
    });
  });

  it("ignores non-allow-listed runtime input and ambient logging configuration", () => {
    vi.stubEnv("OPENAI_LOG", "debug");
    const createOpenAiProvider = vi.fn().mockReturnValue({
      key: "openai",
      generateStructured: vi.fn(),
    });

    createProductionAiRuntime(
      {
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic-test-value",
        OPENAI_LOG: "debug",
        logLevel: "debug",
        business_ai_settings: { logLevel: "debug" },
      } as {
        AI_PROVIDER: string;
        OPENAI_API_KEY: string;
        OPENAI_LOG: string;
        logLevel: string;
        business_ai_settings: { logLevel: string };
      },
      { createOpenAiProvider },
    );

    expect(createOpenAiProvider).toHaveBeenCalledWith("synthetic-test-value");
    expect(createOpenAiProvider).not.toHaveBeenCalledWith(
      "synthetic-test-value",
      expect.anything(),
    );
  });

  it("validates every production task-policy-provider chain before returning", () => {
    for (const environment of [
      {},
      {
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic-test-value",
      },
    ]) {
      const runtime = createProductionAiRuntime(environment, {
        createOpenAiProvider: () => ({
          key: "openai",
          generateStructured: vi.fn(),
        }),
      });
      for (const [taskKey, task] of Object.entries(runtime.tasks)) {
        expect(task.key).toBe(taskKey);
        const policy = runtime.policies[task.policyKey];
        expect(policy?.key).toBe(task.policyKey);
        const provider = policy
          ? runtime.providers[policy.providerKey]
          : undefined;
        expect(provider?.key).toBe(policy?.providerKey);
      }
    }
  });

  it("rejects an incomplete injected production runtime during construction", () => {
    expect(() =>
      createProductionAiRuntime(
        {
          AI_PROVIDER: "openai",
          OPENAI_API_KEY: "synthetic-test-value",
        },
        {
          createOpenAiProvider: () => ({
            key: "wrong-provider-key",
            generateStructured: vi.fn(),
          }),
        },
      ),
    ).toThrow(AiRuntimeConfigurationError);
  });

  it("keeps the contract probe controlled-disabled in OpenAI mode", async () => {
    const openAiInvocation = vi.fn();
    const runtime = createProductionAiRuntime(
      {
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic-test-value",
      },
      {
        createOpenAiProvider: () => ({
          key: "openai",
          generateStructured: openAiInvocation,
        }),
      },
    );
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("No external request is permitted."));
    const execution = createAiExecutionService({
      tasks: runtime.tasks,
      policies: runtime.policies,
      providers: runtime.providers,
      sleep: async () => {},
    });

    await expect(
      execution.execute("contract_probe_v1", { subject: "Readiness" }),
    ).rejects.toMatchObject({ code: "ai_disabled" });
    expect(openAiInvocation).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps server configuration and SDK use out of client and non-provider source", () => {
    const sourceFiles = fs
      .readdirSync(path.join(repositoryRoot, "src"), { recursive: true })
      .filter((entry): entry is string => typeof entry === "string")
      .filter((entry) => /\.(?:ts|tsx)$/.test(entry));
    const sdkImports = sourceFiles.filter((entry) =>
      fs
        .readFileSync(path.join(repositoryRoot, "src", entry), "utf8")
        .match(/from ["']openai["']/),
    );
    const clientSource = sourceFiles
      .filter(
        (entry) =>
          entry.includes(`${path.sep}app${path.sep}`) ||
          entry.includes(`${path.sep}components${path.sep}`) ||
          entry.endsWith(`${path.sep}client.ts`),
      )
      .map((entry) =>
        fs.readFileSync(path.join(repositoryRoot, "src", entry), "utf8"),
      )
      .join("\n");
    const envExample = fs.readFileSync(
      path.join(repositoryRoot, ".env.example"),
      "utf8",
    );

    expect(sdkImports).toEqual(["ai/providers/openai.ts"]);
    expect(clientSource).not.toMatch(/OPENAI_API_KEY|AI_PROVIDER/);
    expect(clientSource).not.toMatch(/OPENAI_LOG|logLevel/);
    expect(envExample).toContain("AI_PROVIDER=");
    expect(envExample).toContain("OPENAI_API_KEY=");
    expect(envExample).not.toMatch(/OPENAI_API_KEY=.+/);
    expect(envExample).not.toMatch(
      /OPENAI_BASE_URL|OPENAI_MODEL|NEXT_PUBLIC_AI/,
    );
  });
});
