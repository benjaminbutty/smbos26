import "server-only";

const PASSTHROUGH_KEYWORDS = new Set([
  "$defs",
  "$ref",
  "additionalProperties",
  "anyOf",
  "const",
  "description",
  "enum",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "items",
  "maxItems",
  "maxLength",
  "maximum",
  "minItems",
  "minLength",
  "minimum",
  "multipleOf",
  "pattern",
  "properties",
  "required",
  "title",
  "type",
]);

const EXPLICITLY_REMOVED_KEYWORDS = new Set([
  // Provider strict schemas select their own dialect and do not accept this
  // draft declaration inside the response-format schema.
  "$schema",
]);

export class OpenAiSchemaAdaptationError extends Error {
  constructor() {
    super("The registered output schema is not OpenAI-compatible.");
    this.name = "OpenAiSchemaAdaptationError";
  }
}

function isPlainObject(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function adaptArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new OpenAiSchemaAdaptationError();
  }
  return value.map(adaptSchemaNode);
}

function adaptProperties(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new OpenAiSchemaAdaptationError();
  }
  return Object.fromEntries(
    Object.entries(value).map(([name, schema]) => [
      name,
      adaptSchemaNode(schema),
    ]),
  );
}

function adaptDefinitions(value: unknown): Record<string, unknown> {
  return adaptProperties(value);
}

function adaptSchemaNode(value: unknown): unknown {
  if (!isPlainObject(value)) {
    throw new OpenAiSchemaAdaptationError();
  }

  for (const keyword of Object.keys(value)) {
    if (
      !PASSTHROUGH_KEYWORDS.has(keyword) &&
      !EXPLICITLY_REMOVED_KEYWORDS.has(keyword) &&
      keyword !== "oneOf"
    ) {
      throw new OpenAiSchemaAdaptationError();
    }
  }
  if ("oneOf" in value && "anyOf" in value) {
    throw new OpenAiSchemaAdaptationError();
  }

  const adapted: Record<string, unknown> = {};
  for (const [keyword, item] of Object.entries(value)) {
    if (EXPLICITLY_REMOVED_KEYWORDS.has(keyword)) {
      continue;
    }
    switch (keyword) {
      case "$defs":
        adapted.$defs = adaptDefinitions(item);
        break;
      case "properties":
        adapted.properties = adaptProperties(item);
        break;
      case "items":
        adapted.items = adaptSchemaNode(item);
        break;
      case "anyOf":
      case "oneOf":
        adapted.anyOf = adaptArray(item);
        break;
      default:
        adapted[keyword] = item;
    }
  }

  if (adapted.type === "object" || "properties" in adapted) {
    const properties = adapted.properties;
    if (!isPlainObject(properties)) {
      throw new OpenAiSchemaAdaptationError();
    }
    const propertyNames = Object.keys(properties);
    const required = adapted.required;
    if (
      !Array.isArray(required) ||
      required.some((name) => typeof name !== "string") ||
      required.length !== propertyNames.length ||
      new Set(required).size !== propertyNames.length ||
      propertyNames.some((name) => !required.includes(name))
    ) {
      throw new OpenAiSchemaAdaptationError();
    }
    if (
      "additionalProperties" in adapted &&
      adapted.additionalProperties !== false
    ) {
      throw new OpenAiSchemaAdaptationError();
    }
    adapted.additionalProperties = false;
  }

  return adapted;
}

export function adaptRegisteredSchemaForOpenAi(
  registeredSchema: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const result = adaptSchemaNode(registeredSchema);
  if (!isPlainObject(result)) {
    throw new OpenAiSchemaAdaptationError();
  }

  return Object.freeze({
    type: "object",
    properties: Object.freeze({ result }),
    required: Object.freeze(["result"]),
    additionalProperties: false,
  });
}
