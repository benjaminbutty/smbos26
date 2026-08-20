import { createHash } from "node:crypto";
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
import { builderRecordCreationIntentTaskV1 } from "../src/ai/record-creation-intent/task";
import { builderRecordCreationEvaluationScenarios } from "../src/ai/evaluation/record-creation-intent/scenarios";
import { builderPlanTaskV1 } from "../src/ai/planning/task";
import { builderConfigurationDraftTaskV1 } from "../src/ai/configuration-drafting/task";
import { builderPreorderAmendmentTaskV1 } from "../src/ai/preorder-amendment/task";
import { builderLocationCreationIntentTaskV1 } from "../src/ai/location-creation-intent/task";
import {
  createOpenAiResponsesClient,
  OPENAI_MODEL_KEY,
  OpenAiAuthenticationDiagnostic,
  OpenAiInvalidRequestDiagnostic,
  OpenAiResponsesStructuredProvider,
  serializeOpenAiStructuredInput,
  type OpenAiResponsesClient,
  type OpenAiSdkClientConstructor,
  type OpenAiSdkClientOptions,
} from "../src/ai/providers/openai";
import {
  adaptRegisteredSchemaForOpenAi,
  OPENAI_SUPPORTED_SCHEMA_FORMATS,
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

function collectSchemaNodes(
  value: unknown,
  seen = new Set<object>(),
): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectSchemaNodes(item, seen));
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const record = value as Record<string, unknown>;
  if (seen.has(record)) return [];
  seen.add(record);
  return [
    record,
    ...Object.values(record).flatMap((item) => collectSchemaNodes(item, seen)),
  ];
}

function collectObjectSchemas(value: unknown): Record<string, unknown>[] {
  return collectSchemaNodes(value).filter(
    (record) => record.type === "object" || "properties" in record,
  );
}

function fieldTypeForSchemaBranch(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const properties = (value as Record<string, unknown>).properties;
  if (
    typeof properties !== "object" ||
    properties === null ||
    Array.isArray(properties)
  ) {
    return null;
  }
  const fieldType = (properties as Record<string, unknown>).field_type;
  if (
    typeof fieldType !== "object" ||
    fieldType === null ||
    Array.isArray(fieldType)
  ) {
    return null;
  }
  const literal = (fieldType as Record<string, unknown>).const;
  return typeof literal === "string" ? literal : null;
}

const RECORD_FIELD_TYPES = [
  "short_text",
  "long_text",
  "email",
  "phone",
  "url",
  "number",
  "currency",
  "boolean",
  "date",
  "datetime",
  "select",
  "status",
  "multi_select",
] as const;

function canonicalSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalSchemaValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalSchemaValue(item)]),
    );
  }
  return value;
}

function adaptedTaskSchemaDigest(task: { outputSchema: z.ZodType }): string {
  const registered = z.toJSONSchema(task.outputSchema, {
    target: "draft-7",
    unrepresentable: "throw",
  });
  const adapted = adaptRegisteredSchemaForOpenAi(registered);
  return createHash("sha256")
    .update(JSON.stringify(canonicalSchemaValue(adapted)))
    .digest("hex");
}

const PRIOR_QUALIFIED_ADAPTED_SCHEMA_DIGESTS = {
  builder_plan_v1:
    "2ecc17b6136d7058def5c37c7459230ec8c36338e6d4f7af5cde89ef40bc189f",
  builder_configuration_draft_v1:
    "7116b5ce046caebb1e3d8603c25d766bbb5141470d36485d684c012a341d83b1",
  builder_preorder_amendment_v1:
    "c452e5ef07da361d9b9c938727d325c67b9db346dddbf043f4744e9da5c310e5",
  builder_location_creation_intent_v1:
    "57869c426420b08f12de94d947db3cc53e3fc5e896af746fb9e7d9e58a1a6d3a",
} as const;

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

  it("converts oneOf explicitly, removes the dialect, and preserves supported formats", () => {
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

  it("converts the exact Record schema through the Responses request boundary", async () => {
    const scenario = builderRecordCreationEvaluationScenarios.find(
      ({ id }) => id === "contact_field_types",
    )!;
    const registered = z.toJSONSchema(
      builderRecordCreationIntentTaskV1.outputSchema,
      { target: "draft-7", unrepresentable: "throw" },
    ) as Record<string, unknown>;
    const adapted = adaptRegisteredSchemaForOpenAi(registered);
    const { client, create } = clientReturning(
      completedResponse(scenario.expected_output, { input: 0, output: 0 }),
    );
    const provider = new OpenAiResponsesStructuredProvider({ client });
    const loggerSpies = [
      vi.spyOn(console, "debug").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];

    const response = await provider.generateStructured({
      providerKey: "openai",
      modelKey: OPENAI_MODEL_KEY,
      instruction: builderRecordCreationIntentTaskV1.buildInstruction(),
      input: scenario.input,
      outputContract: {
        name: builderRecordCreationIntentTaskV1.key,
        version: builderRecordCreationIntentTaskV1.version,
        jsonSchema: registered,
      },
      maxOutputTokens: 4_096,
      signal: new AbortController().signal,
    });
    expect(
      builderRecordCreationIntentTaskV1.outputSchema.parse(response.output),
    ).toEqual(scenario.expected_output);

    expect(adapted).toMatchObject({
      type: "object",
      properties: { result: expect.anything() },
      required: ["result"],
      additionalProperties: false,
    });
    const [body] = create.mock.calls[0]!;
    const bodyRecord = body as Record<string, unknown>;
    const format = (bodyRecord.text as Record<string, unknown>)
      .format as Record<string, unknown>;
    const schema = format.schema as Record<string, unknown>;
    expect(create).toHaveBeenCalledOnce();
    expect(format.name).toEqual("builder_record_creation_intent_v1_v1");
    expect(format.name).toMatch(/^[A-Za-z0-9_-]+$/);
    expect((format.name as string).length).toBeLessThanOrEqual(64);
    expect(JSON.stringify(schema)).not.toContain('"oneOf"');
    expect(JSON.stringify(schema)).toContain('"anyOf"');
    const schemaNodes = collectSchemaNodes(schema);
    const rejectedEmailPatternSchema = z.toJSONSchema(z.string().email(), {
      target: "draft-7",
      unrepresentable: "throw",
    }) as Record<string, unknown>;
    expect(rejectedEmailPatternSchema.pattern).toEqual(expect.any(String));
    expect(
      schemaNodes.some(
        (node) => node.pattern === rejectedEmailPatternSchema.pattern,
      ),
    ).toBe(false);
    const emailBranches = schemaNodes.filter(
      (node) => fieldTypeForSchemaBranch(node) === "email",
    );
    expect(emailBranches).not.toHaveLength(0);
    for (const emailBranch of emailBranches) {
      const properties = emailBranch.properties as Record<string, unknown>;
      expect(properties.string_value).toEqual({
        type: "string",
        minLength: 1,
        maxLength: 320,
      });
    }
    const completeFieldUnions = schemaNodes.filter((node) => {
      if (!Array.isArray(node.anyOf) || node.anyOf.length !== 13) return false;
      return new Set(node.anyOf.map(fieldTypeForSchemaBranch)).size === 13;
    });
    expect(completeFieldUnions).toHaveLength(1);
    expect(
      new Set(
        (completeFieldUnions[0]!.anyOf as unknown[]).map(
          fieldTypeForSchemaBranch,
        ),
      ),
    ).toEqual(new Set(RECORD_FIELD_TYPES));
    expect(JSON.stringify(schema)).toContain('"needs_clarification"');
    expect(JSON.stringify(schema)).toContain('"ready"');
    const formats = schemaNodes
      .filter((node) => "format" in node)
      .map((node) => node.format);
    expect(formats).not.toContain("uri");
    expect(
      formats.every(
        (format) =>
          typeof format === "string" &&
          OPENAI_SUPPORTED_SCHEMA_FORMATS.includes(
            format as (typeof OPENAI_SUPPORTED_SCHEMA_FORMATS)[number],
          ),
      ),
    ).toBe(true);
    const urlSchemas = schemaNodes.filter(
      (node) =>
        node.type === "string" &&
        typeof node.pattern === "string" &&
        node.pattern.includes("https?"),
    );
    expect(urlSchemas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "string",
          minLength: 1,
          maxLength: 2_048,
          pattern: "^https?:\\/\\/",
        }),
      ]),
    );
    for (const objectSchema of collectObjectSchemas(schema)) {
      expect(objectSchema.additionalProperties).toBe(false);
      expect(new Set(objectSchema.required as string[])).toEqual(
        new Set(Object.keys(objectSchema.properties as object)),
      );
    }
    for (const loggerSpy of loggerSpies) {
      expect(loggerSpy).not.toHaveBeenCalled();
      expect(JSON.stringify(loggerSpy.mock.calls)).not.toContain(
        scenario.owner_request,
      );
      expect(JSON.stringify(loggerSpy.mock.calls)).not.toContain(
        "events@example.test",
      );
    }
  });

  it("preserves the adapted schemas for previously qualified task families", () => {
    expect(adaptedTaskSchemaDigest(builderPlanTaskV1)).toBe(
      PRIOR_QUALIFIED_ADAPTED_SCHEMA_DIGESTS.builder_plan_v1,
    );
    expect(adaptedTaskSchemaDigest(builderConfigurationDraftTaskV1)).toBe(
      PRIOR_QUALIFIED_ADAPTED_SCHEMA_DIGESTS.builder_configuration_draft_v1,
    );
    expect(adaptedTaskSchemaDigest(builderPreorderAmendmentTaskV1)).toBe(
      PRIOR_QUALIFIED_ADAPTED_SCHEMA_DIGESTS.builder_preorder_amendment_v1,
    );
    expect(adaptedTaskSchemaDigest(builderLocationCreationIntentTaskV1)).toBe(
      PRIOR_QUALIFIED_ADAPTED_SCHEMA_DIGESTS.builder_location_creation_intent_v1,
    );
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
      service_tier: "auto",
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

  it("allows only the finite OpenAI format subset and rejects unsupported formats", () => {
    for (const format of OPENAI_SUPPORTED_SCHEMA_FORMATS) {
      expect(
        adaptRegisteredSchemaForOpenAi({ type: "string", format }),
      ).toMatchObject({
        properties: { result: { type: "string", format } },
      });
    }
    for (const format of ["uri", "uri-reference", "binary", "unknown"]) {
      expect(() =>
        adaptRegisteredSchemaForOpenAi({ type: "string", format }),
      ).toThrow(OpenAiSchemaAdaptationError);
    }
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

    let caught: StructuredAiProviderError | undefined;
    try {
      await provider.generateStructured(unsafe);
    } catch (cause) {
      caught = cause as StructuredAiProviderError;
    }
    expect(caught).toMatchObject({
      kind: "invalid_request",
      cause: expect.any(OpenAiInvalidRequestDiagnostic),
    });
    expect((caught?.cause as OpenAiInvalidRequestDiagnostic).reasonCode).toBe(
      "local_schema_adaptation",
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("maps an unsupported format to local schema adaptation before invocation", async () => {
    const { client, create } = clientReturning(completedResponse({ ok: true }));
    const provider = new OpenAiResponsesStructuredProvider({ client });
    let caught: StructuredAiProviderError | undefined;
    try {
      await provider.generateStructured(
        request({
          outputContract: {
            name: "url_contract",
            version: 1,
            jsonSchema: {
              type: "object",
              properties: {
                website: { type: "string", format: "uri" },
              },
              required: ["website"],
              additionalProperties: false,
            },
          },
        }),
      );
    } catch (cause) {
      caught = cause as StructuredAiProviderError;
    }
    expect(caught).toMatchObject({
      kind: "invalid_request",
      cause: expect.any(OpenAiInvalidRequestDiagnostic),
    });
    expect((caught?.cause as OpenAiInvalidRequestDiagnostic).reasonCode).toBe(
      "local_schema_adaptation",
    );
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
      expect(JSON.stringify(publicError)).toBe(
        JSON.stringify({
          code: "ai_execution_failed",
          message: "The AI request could not be completed safely.",
        }),
      );
    },
  );

  it.each([
    [
      "schema code",
      { status: 400, code: "invalid_json_schema" },
      "provider_schema_rejected",
    ],
    [
      "schema parameter",
      { status: 422, param: "text.format.schema" },
      "provider_schema_rejected",
    ],
    [
      "response-format parameter",
      { status: 400, param: "text.format" },
      "provider_response_format_rejected",
    ],
    [
      "model parameter",
      { status: 422, param: "model" },
      "provider_model_rejected",
    ],
    [
      "other allow-listed parameter",
      { status: 400, param: "max_output_tokens" },
      "provider_parameter_rejected",
    ],
    [
      "unknown request",
      {
        status: 400,
        code: "unrecognised_provider_code",
        param: "secret.parameter.value",
        message: "raw-provider-message-marker",
        body: "raw-provider-body-marker",
      },
      "provider_invalid_request_unknown",
    ],
  ])(
    "classifies %s with a finite reason and no raw provider material",
    async (_label, sdkFailure, expectedReason) => {
      const create = vi.fn().mockRejectedValue(sdkFailure);
      const provider = new OpenAiResponsesStructuredProvider({
        client: { responses: { create } },
      });
      let caught: StructuredAiProviderError | undefined;
      try {
        await provider.generateStructured(request());
      } catch (cause) {
        caught = cause as StructuredAiProviderError;
      }

      expect(caught).toMatchObject({
        kind: "invalid_request",
        cause: expect.any(OpenAiInvalidRequestDiagnostic),
      });
      expect((caught?.cause as OpenAiInvalidRequestDiagnostic).reasonCode).toBe(
        expectedReason,
      );
      const serialized = JSON.stringify(caught);
      expect(serialized).not.toContain("raw-provider-message-marker");
      expect(serialized).not.toContain("raw-provider-body-marker");
      expect(serialized).not.toContain("secret.parameter.value");
      expect(create).toHaveBeenCalledOnce();
    },
  );

  it("extracts only allow-listed schema context from an SDK rejection", async () => {
    const create = vi.fn().mockRejectedValue({
      status: 400,
      code: "invalid_json_schema",
      message:
        "Invalid schema in context=('properties','result','anyOf',0,'properties','field_values','items'): 'anyOf' is not permitted. raw-provider-marker",
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

    expect(caught?.cause).toBeInstanceOf(OpenAiInvalidRequestDiagnostic);
    expect(
      (caught?.cause as OpenAiInvalidRequestDiagnostic).safeSchemaContext,
    ).toEqual({
      keyword: "anyOf",
      path: [
        "properties",
        "result",
        "anyOf",
        0,
        "properties",
        "field_values",
        "items",
      ],
    });
    expect(JSON.stringify(caught)).not.toContain("raw-provider-marker");
  });

  it("distinguishes authentication failure without retaining provider material", async () => {
    const create = vi.fn().mockRejectedValue({
      status: 401,
      message: "raw-authentication-provider-marker",
      headers: { authorization: "raw-credential-marker" },
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

    expect(caught).toMatchObject({
      kind: "unavailable",
      cause: expect.any(OpenAiAuthenticationDiagnostic),
    });
    expect(JSON.stringify(caught)).not.toMatch(
      /raw-authentication-provider-marker|raw-credential-marker/,
    );
  });
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
    expect(runtime.policies.builder_planning_terra_medium_v1).toMatchObject({
      key: "builder_planning_terra_medium_v1",
      providerKey: "openai",
      modelKey: OPENAI_MODEL_KEY,
      maxInputBytes: 160 * 1024,
      maxBillableInputTokens: 64_000,
      maxOutputTokens: 4_096,
      timeoutMs: 30_000,
      maxAttempts: 2,
      retryDelayMs: 250,
      retryableFailureKinds: ["rate_limited", "transient"],
      inputMicrousdPerMillion: 2_500_000,
      outputMicrousdPerMillion: 15_000_000,
    });
    expect(
      deriveAiReservationEnvelope(
        runtime.policies.builder_planning_terra_medium_v1,
      ),
    ).toEqual({
      reservedRequestCount: 1,
      reservedInputTokens: 128_000,
      reservedOutputTokens: 8_192,
      reservedCostMicrousd: 442_880,
      inputMicrousdPerMillion: 2_500_000,
      outputMicrousdPerMillion: 15_000_000,
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
