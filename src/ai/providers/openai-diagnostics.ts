import "server-only";

export const openAiInvalidRequestReasonCodes = [
  "local_schema_adaptation",
  "provider_schema_rejected",
  "provider_response_format_rejected",
  "provider_model_rejected",
  "provider_parameter_rejected",
  "provider_invalid_request_unknown",
] as const;

export type OpenAiInvalidRequestReasonCode =
  (typeof openAiInvalidRequestReasonCodes)[number];

export const openAiIncompleteReasonCodes = ["max_output_tokens"] as const;

export type OpenAiIncompleteReasonCode =
  (typeof openAiIncompleteReasonCodes)[number];

export const openAiSafeSchemaKeywords = [
  "$defs",
  "$ref",
  "additionalProperties",
  "anyOf",
  "const",
  "description",
  "enum",
  "format",
  "items",
  "maxItems",
  "maxLength",
  "maximum",
  "minItems",
  "minLength",
  "minimum",
  "pattern",
  "properties",
  "required",
  "title",
  "type",
] as const;

export type OpenAiSafeSchemaKeyword = (typeof openAiSafeSchemaKeywords)[number];

export const openAiSafeSchemaPathTokens = [
  ...openAiSafeSchemaKeywords,
  "result",
  "schema_version",
  "state",
  "summary",
  "source_step_references",
  "object_key",
  "field_values",
  "understanding",
  "question",
  "reason",
  "field_key",
  "field_type",
  "string_value",
  "number_value",
  "boolean_value",
  "date_value",
  "datetime_value",
  "option_value",
  "option_values",
] as const;

export type OpenAiSafeSchemaPathToken =
  (typeof openAiSafeSchemaPathTokens)[number];

export type OpenAiSafeSchemaContext =
  | "unknown"
  | Readonly<{
      keyword: OpenAiSafeSchemaKeyword | null;
      path: readonly (OpenAiSafeSchemaPathToken | number)[];
    }>;

const safeSchemaKeywordSet = new Set<string>(openAiSafeSchemaKeywords);
const safeSchemaPathTokenSet = new Set<string>(openAiSafeSchemaPathTokens);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedProviderMessages(cause: unknown): readonly string[] {
  if (!isRecord(cause)) return [];
  const candidates: unknown[] = [cause.message];
  if (isRecord(cause.error)) candidates.push(cause.error.message);
  if (isRecord(cause.body) && isRecord(cause.body.error)) {
    candidates.push(cause.body.error.message);
  }
  return candidates.filter(
    (value): value is string =>
      typeof value === "string" && value.length > 0 && value.length <= 2_000,
  );
}

function safeKeyword(message: string): OpenAiSafeSchemaKeyword | null {
  const quotedTokens = message.matchAll(
    /["'`]([A-Za-z_$][A-Za-z0-9_$-]*)["'`]/g,
  );
  let result: OpenAiSafeSchemaKeyword | null = null;
  for (const match of quotedTokens) {
    const token = match[1];
    if (token && safeSchemaKeywordSet.has(token)) {
      result = token as OpenAiSafeSchemaKeyword;
    }
  }
  return result;
}

function safePath(
  message: string,
): readonly (OpenAiSafeSchemaPathToken | number)[] | null {
  const context = /(?:in\s+)?context\s*=\s*\(([\s\S]{0,800}?)\)/i.exec(
    message,
  )?.[1];
  if (context === undefined) return [];

  const values: (OpenAiSafeSchemaPathToken | number)[] = [];
  const tokenPattern = /'([^']{0,80})'|"([^"]{0,80})"|(\d{1,4})/g;
  let cursor = 0;
  for (const match of context.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    if (!/^[\s,]*$/.test(context.slice(cursor, index))) return null;
    const raw = match[1] ?? match[2] ?? match[3];
    if (raw === undefined) return null;
    if (/^\d+$/.test(raw)) {
      const numeric = Number(raw);
      if (!Number.isInteger(numeric) || numeric < 0 || numeric > 100) {
        return null;
      }
      values.push(numeric);
    } else if (safeSchemaPathTokenSet.has(raw)) {
      values.push(raw as OpenAiSafeSchemaPathToken);
    } else {
      return null;
    }
    cursor = index + match[0].length;
  }
  if (!/^[\s,]*$/.test(context.slice(cursor)) || values.length > 20) {
    return null;
  }
  return values;
}

export function parseOpenAiSafeSchemaContext(
  cause: unknown,
): OpenAiSafeSchemaContext {
  for (const message of boundedProviderMessages(cause)) {
    const path = safePath(message);
    if (path === null) return "unknown";
    const pathKeyword = [...path]
      .reverse()
      .find(
        (token): token is OpenAiSafeSchemaKeyword =>
          typeof token === "string" && safeSchemaKeywordSet.has(token),
      );
    const keyword = safeKeyword(message) ?? pathKeyword ?? null;
    if (path.length > 0 || keyword !== null) {
      return Object.freeze({
        keyword,
        path: Object.freeze([...path]),
      });
    }
  }
  return "unknown";
}

const safeMessage =
  "The OpenAI invalid-request stage was classified internally.";

export class OpenAiInvalidRequestDiagnostic extends Error {
  readonly reasonCode: OpenAiInvalidRequestReasonCode;
  readonly safeSchemaContext: OpenAiSafeSchemaContext;

  constructor(
    reasonCode: OpenAiInvalidRequestReasonCode,
    safeSchemaContext: OpenAiSafeSchemaContext = "unknown",
  ) {
    super(safeMessage);
    this.name = "OpenAiInvalidRequestDiagnostic";
    this.reasonCode = reasonCode;
    this.safeSchemaContext = safeSchemaContext;
  }
}

export class OpenAiAuthenticationDiagnostic extends Error {
  constructor() {
    super("The OpenAI request was not authenticated.");
    this.name = "OpenAiAuthenticationDiagnostic";
  }
}

export class OpenAiIncompleteDiagnostic extends Error {
  readonly reasonCode: OpenAiIncompleteReasonCode;

  constructor(reasonCode: OpenAiIncompleteReasonCode) {
    super("The OpenAI incomplete-response reason was classified internally.");
    this.name = "OpenAiIncompleteDiagnostic";
    this.reasonCode = reasonCode;
  }
}
