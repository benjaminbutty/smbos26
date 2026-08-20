import "server-only";

import OpenAI from "openai";

import {
  aiReasoningEffortSchema,
  aiServiceTierSchema,
  StructuredAiProviderError,
  type StructuredAiProvider,
  type StructuredAiProviderRequest,
  type StructuredAiProviderResponse,
  type AiServiceTier,
  type StructuredAiUsage,
} from "../contracts";
import {
  OPENAI_BUILDER_PLANNING_MODEL_KEY,
  OPENAI_BUILDER_PLANNING_REASONING_EFFORT,
  OPENAI_SUPPORTED_MODEL_KEYS,
} from "../policies";
import {
  adaptRegisteredSchemaForOpenAi,
  OpenAiSchemaAdaptationError,
} from "./openai-schema";
import {
  OpenAiAuthenticationDiagnostic,
  OpenAiInvalidRequestDiagnostic,
  parseOpenAiSafeSchemaContext,
  type OpenAiInvalidRequestReasonCode,
} from "./openai-diagnostics";

export {
  OpenAiAuthenticationDiagnostic,
  OpenAiInvalidRequestDiagnostic,
  openAiInvalidRequestReasonCodes,
  parseOpenAiSafeSchemaContext,
} from "./openai-diagnostics";
export type {
  OpenAiInvalidRequestReasonCode,
  OpenAiSafeSchemaContext,
} from "./openai-diagnostics";

export const OPENAI_PROVIDER_KEY = "openai";
export const OPENAI_MODEL_KEY = OPENAI_BUILDER_PLANNING_MODEL_KEY;
export const OPENAI_API_BASE_URL = "https://api.openai.com/v1";

export interface OpenAiResponsesClient {
  responses: {
    create(
      body: Readonly<Record<string, unknown>>,
      options: { signal: AbortSignal },
    ): PromiseLike<unknown>;
  };
}

export interface OpenAiSdkClientOptions {
  apiKey: string;
  baseURL: typeof OPENAI_API_BASE_URL;
  maxRetries: 0;
  organization: null;
  project: null;
  logLevel: "off";
}

export type OpenAiSdkClientConstructor = new (
  options: OpenAiSdkClientOptions,
) => OpenAiResponsesClient;

export function createOpenAiResponsesClient(
  apiKey: string,
  ClientConstructor: OpenAiSdkClientConstructor = OpenAI as unknown as OpenAiSdkClientConstructor,
): OpenAiResponsesClient {
  return new ClientConstructor(
    Object.freeze({
      apiKey,
      baseURL: OPENAI_API_BASE_URL,
      maxRetries: 0,
      organization: null,
      project: null,
      logLevel: "off",
    }),
  );
}

function stableJsonValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }
  if (
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableJsonValue(item)]),
    );
  }
  throw new StructuredAiProviderError(
    "invalid_request",
    "The OpenAI structured input was not serialisable.",
  );
}

export function serializeOpenAiStructuredInput(input: unknown): string {
  return JSON.stringify(stableJsonValue(input));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function usageFromResponse(
  response: Record<string, unknown>,
): StructuredAiUsage | undefined {
  const usage = response.usage;
  if (!isRecord(usage)) {
    return undefined;
  }
  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  if (
    !Number.isInteger(inputTokens) ||
    typeof inputTokens !== "number" ||
    inputTokens < 0 ||
    !Number.isInteger(outputTokens) ||
    typeof outputTokens !== "number" ||
    outputTokens < 0
  ) {
    return undefined;
  }
  return { inputTokens, outputTokens };
}

const OPENAI_SCHEMA_ERROR_CODES = new Set([
  "invalid_json_schema",
  "invalid_schema",
  "schema_invalid",
  "response_format_schema_invalid",
  "invalid_response_format_schema",
]);

const OPENAI_RESPONSE_FORMAT_ERROR_CODES = new Set([
  "invalid_response_format",
  "response_format_invalid",
]);

const OPENAI_REQUEST_PARAMETER_NAMES = new Set([
  "input",
  "instructions",
  "max_output_tokens",
  "prompt_cache_options",
  "reasoning",
  "reasoning.effort",
  "service_tier",
  "store",
  "text.format.name",
  "text.format.strict",
  "response_format.name",
  "response_format.strict",
]);

function safeSdkString(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 120 ? value : undefined;
}

function invalidRequestReasonCode(
  cause: Record<string, unknown>,
): OpenAiInvalidRequestReasonCode {
  const code = safeSdkString(cause.code);
  if (code && OPENAI_SCHEMA_ERROR_CODES.has(code)) {
    return "provider_schema_rejected";
  }
  if (code && OPENAI_RESPONSE_FORMAT_ERROR_CODES.has(code)) {
    return "provider_response_format_rejected";
  }

  const parameter = safeSdkString(cause.param);
  if (
    parameter === "text.format.schema" ||
    parameter === "response_format.schema"
  ) {
    return "provider_schema_rejected";
  }
  if (
    parameter === "text.format" ||
    parameter?.startsWith("text.format.") ||
    parameter === "response_format" ||
    parameter?.startsWith("response_format.")
  ) {
    return "provider_response_format_rejected";
  }
  if (parameter === "model" || parameter?.startsWith("model.")) {
    return "provider_model_rejected";
  }
  if (parameter && OPENAI_REQUEST_PARAMETER_NAMES.has(parameter)) {
    return "provider_parameter_rejected";
  }
  return "provider_invalid_request_unknown";
}

function providerError(
  kind:
    | "unavailable"
    | "rate_limited"
    | "transient"
    | "invalid_request"
    | "invalid_response"
    | "refused"
    | "incomplete"
    | "content_filtered",
  usage?: StructuredAiUsage,
  cause?: unknown,
): StructuredAiProviderError {
  return new StructuredAiProviderError(
    kind,
    "The OpenAI structured request did not complete safely.",
    usage || cause
      ? { ...(usage ? { usage } : {}), ...(cause ? { cause } : {}) }
      : undefined,
  );
}

function mapSdkFailure(cause: unknown): StructuredAiProviderError {
  if (cause instanceof StructuredAiProviderError) {
    return cause;
  }
  if (cause instanceof OpenAiSchemaAdaptationError) {
    return providerError(
      "invalid_request",
      undefined,
      new OpenAiInvalidRequestDiagnostic("local_schema_adaptation"),
    );
  }
  if (!isRecord(cause)) {
    return providerError("unavailable");
  }

  const status = cause.status;
  if (status === 429) {
    return providerError("rate_limited");
  }
  if (typeof status === "number" && status >= 500 && status <= 599) {
    return providerError("transient");
  }
  if (status === 400 || status === 422) {
    const reasonCode = invalidRequestReasonCode(cause);
    return providerError(
      "invalid_request",
      undefined,
      new OpenAiInvalidRequestDiagnostic(
        reasonCode,
        reasonCode === "provider_schema_rejected"
          ? parseOpenAiSafeSchemaContext(cause)
          : "unknown",
      ),
    );
  }
  if (status === 401 || status === 403) {
    return providerError(
      "unavailable",
      undefined,
      new OpenAiAuthenticationDiagnostic(),
    );
  }

  const name = cause.name;
  if (name === "APIConnectionError" || name === "APIConnectionTimeoutError") {
    return providerError("transient");
  }
  return providerError("unavailable");
}

function parseCompletedResponse(
  rawResponse: unknown,
  requestedServiceTier: AiServiceTier,
): StructuredAiProviderResponse {
  if (!isRecord(rawResponse)) {
    throw providerError("invalid_response");
  }
  const usage = usageFromResponse(rawResponse);
  if (rawResponse.status === "incomplete") {
    const details = rawResponse.incomplete_details;
    const reason = isRecord(details) ? details.reason : undefined;
    if (reason === "content_filter") {
      throw providerError("content_filtered", usage);
    }
    throw providerError("incomplete", usage);
  }
  if (rawResponse.status !== "completed" || rawResponse.error !== null) {
    throw providerError("unavailable", usage);
  }
  const effectiveServiceTier = aiServiceTierSchema.safeParse(
    rawResponse.service_tier,
  );
  if (
    rawResponse.service_tier !== undefined &&
    rawResponse.service_tier !== null &&
    !effectiveServiceTier.success
  ) {
    throw providerError("invalid_response", usage);
  }
  const effectiveTier = effectiveServiceTier.success
    ? effectiveServiceTier.data
    : undefined;
  if (
    (requestedServiceTier === "fast" || requestedServiceTier === "priority") &&
    effectiveTier !== "priority"
  ) {
    throw providerError("invalid_response", usage);
  }
  if (!Array.isArray(rawResponse.output)) {
    throw providerError("invalid_response", usage);
  }

  const messages = rawResponse.output.filter(
    (item): item is Record<string, unknown> =>
      isRecord(item) && item.type === "message" && item.role === "assistant",
  );
  if (messages.length !== 1 || !Array.isArray(messages[0]?.content)) {
    throw providerError("invalid_response", usage);
  }
  const content = messages[0].content;
  if (content.some((item) => isRecord(item) && item.type === "refusal")) {
    throw providerError("refused", usage);
  }
  const results = content.filter(
    (item): item is Record<string, unknown> =>
      isRecord(item) && item.type === "output_text",
  );
  if (results.length !== 1 || typeof results[0]?.text !== "string") {
    throw providerError("invalid_response", usage);
  }

  let transport: unknown;
  try {
    transport = JSON.parse(results[0].text);
  } catch {
    throw providerError("invalid_response", usage);
  }
  if (
    !isRecord(transport) ||
    Object.keys(transport).length !== 1 ||
    !("result" in transport)
  ) {
    throw providerError("invalid_response", usage);
  }
  return {
    output: transport.result,
    ...(usage ? { usage } : {}),
    ...(effectiveTier
      ? { requestMetadata: { service_tier: effectiveTier } }
      : {}),
  };
}

export class OpenAiResponsesStructuredProvider implements StructuredAiProvider {
  readonly key = OPENAI_PROVIDER_KEY;
  readonly #client: OpenAiResponsesClient;

  constructor(input: { apiKey?: string; client?: OpenAiResponsesClient }) {
    if (input.client) {
      this.#client = input.client;
      return;
    }
    if (!input.apiKey) {
      throw new Error("The OpenAI provider configuration is incomplete.");
    }
    this.#client = createOpenAiResponsesClient(input.apiKey);
  }

  async generateStructured(
    request: StructuredAiProviderRequest,
  ): Promise<StructuredAiProviderResponse> {
    try {
      if (
        request.providerKey !== OPENAI_PROVIDER_KEY ||
        !OPENAI_SUPPORTED_MODEL_KEYS.includes(
          request.modelKey as (typeof OPENAI_SUPPORTED_MODEL_KEYS)[number],
        )
      ) {
        throw providerError("invalid_request");
      }
      const reasoningEffort = aiReasoningEffortSchema.safeParse(
        request.reasoningEffort ?? OPENAI_BUILDER_PLANNING_REASONING_EFFORT,
      );
      if (!reasoningEffort.success) {
        throw providerError("invalid_request");
      }
      const serviceTier = aiServiceTierSchema.safeParse(
        request.serviceTier ?? "auto",
      );
      if (!serviceTier.success) {
        throw providerError("invalid_request");
      }
      const schema = adaptRegisteredSchemaForOpenAi(
        request.outputContract.jsonSchema,
      );
      const body = Object.freeze({
        model: request.modelKey,
        instructions: request.instruction,
        input: Object.freeze([
          Object.freeze({
            role: "user",
            content: Object.freeze([
              Object.freeze({
                type: "input_text",
                text: serializeOpenAiStructuredInput(request.input),
              }),
            ]),
          }),
        ]),
        max_output_tokens: request.maxOutputTokens,
        store: false,
        reasoning: Object.freeze({
          effort: reasoningEffort.data,
        }),
        service_tier: serviceTier.data,
        prompt_cache_options: Object.freeze({
          mode: "explicit",
        }),
        text: Object.freeze({
          format: Object.freeze({
            type: "json_schema",
            name: `${request.outputContract.name}_v${request.outputContract.version}`,
            strict: true,
            schema,
          }),
        }),
      });
      const response = await this.#client.responses.create(body, {
        signal: request.signal,
      });
      return parseCompletedResponse(response, serviceTier.data);
    } catch (cause) {
      throw mapSdkFailure(cause);
    }
  }
}

export function createOpenAiResponsesStructuredProvider(
  apiKey: string,
): OpenAiResponsesStructuredProvider {
  return new OpenAiResponsesStructuredProvider({ apiKey });
}
