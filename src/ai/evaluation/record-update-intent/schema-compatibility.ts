import "server-only";

import { createHash } from "node:crypto";

import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import {
  StructuredAiProviderError,
  type StructuredAiProvider,
  type StructuredAiProviderResponse,
} from "../../contracts";
import { calculateAiTokenCostMicrousd } from "../../accounting/cost";
import {
  OPENAI_BUILDER_RECORD_UPDATE_INTENT_MODEL_KEY,
  OPENAI_BUILDER_RECORD_UPDATE_INTENT_REASONING_EFFORT,
  openAiBuilderRecordUpdateIntentPolicy,
} from "../../policies";
import {
  OpenAiAuthenticationDiagnostic,
  OpenAiInvalidRequestDiagnostic,
  createOpenAiResponsesStructuredProvider,
} from "../../providers/openai";
import {
  openAiInvalidRequestReasonCodes,
  openAiSafeSchemaKeywords,
  openAiSafeSchemaPathTokens,
  type OpenAiSafeSchemaContext,
} from "../../providers/openai-diagnostics";
import {
  adaptRegisteredSchemaForOpenAi,
  OpenAiSchemaAdaptationError,
} from "../../providers/openai-schema";
import {
  builderRecordUpdateIntentOutputSchema,
  BUILDER_RECORD_UPDATE_INTENT_SCHEMA_VERSION,
} from "../../record-update-intent/schemas";
import { recordCreationFieldValueSchema } from "../../../core/graph/record-creation/schemas";
import { recordUpdateSelectorSchema } from "../../../core/graph/record-update/schemas";

export const BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_SCHEMA_VERSION =
  1 as const;
export const BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_MAX_PROBE_COUNT =
  32 as const;
export const BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_MAX_OUTPUT_TOKENS =
  128 as const;
export const BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_RESERVED_INPUT_TOKENS =
  16_000 as const;
export const BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_TIMEOUT_MS =
  30_000 as const;
export const BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_PER_PROBE_RESERVATION_MICROUSD =
  41_920 as const;
export const BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_AGGREGATE_RESERVATION_MICROUSD =
  1_341_440 as const;
export const BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_HARD_CEILING_MICROUSD =
  1_350_000 as const;

type JsonSchema = Readonly<Record<string, unknown>>;
type SelectorFieldType =
  | "short_text"
  | "email"
  | "phone"
  | "url"
  | "number"
  | "currency"
  | "boolean"
  | "date"
  | "datetime"
  | "select"
  | "status";

const selectorFieldTypes: readonly SelectorFieldType[] = [
  "short_text",
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
];
const updateFieldTypes = [
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

export const BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_BASE_PROBE_IDS =
  Object.freeze([
    "a_transport_baseline",
    "b_state_union",
    "c_short_text_selector",
    "c_email_selector",
    "c_phone_selector",
    "c_url_selector",
    "c_text_selector_cumulative",
    "d_number_selector",
    "d_currency_selector",
    "d_boolean_selector",
    "d_date_selector",
    "d_datetime_selector",
    "d_primitive_selector_cumulative",
    "e_select_selector",
    "e_status_selector",
    "e_option_selector_cumulative",
    "f_complete_selector_union",
    "g_imported_field_update_union",
    "h_complete_ready_record_update",
    "i_exact_registered_record_update_schema",
  ] as const);

const schemaKeywordNames = [
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
type SchemaKeyword = (typeof schemaKeywordNames)[number];
const schemaKeywordCountShape = Object.fromEntries(
  schemaKeywordNames.map((keyword) => [
    keyword,
    z.number().int().nonnegative().max(100_000),
  ]),
) as Record<SchemaKeyword, z.ZodNumber>;

export const builderRecordUpdateSchemaCompatibilityMetricsSchema = z
  .object({
    total_object_properties: z.number().int().nonnegative().max(100_000),
    maximum_nesting_depth: z.number().int().nonnegative().max(1_000),
    any_of_count: z.number().int().nonnegative().max(100_000),
    maximum_any_of_branches: z.number().int().nonnegative().max(1_000),
    ref_count: z.number().int().nonnegative().max(100_000),
    keyword_counts: z.object(schemaKeywordCountShape).strict(),
    schema_byte_length: z.number().int().nonnegative().max(10_000_000),
  })
  .strict();

const safeSchemaContextSchema = z.union([
  z.literal("unknown"),
  z
    .object({
      keyword: z.enum(openAiSafeSchemaKeywords).nullable(),
      path: z
        .array(
          z.union([
            z.enum(openAiSafeSchemaPathTokens),
            z.number().int().nonnegative().max(100),
          ]),
        )
        .max(20),
    })
    .strict(),
]);

export const builderRecordUpdateSchemaCompatibilityResultClassSchema = z.enum([
  "accepted_completed",
  "accepted_incomplete",
  "schema_rejected",
  "local_schema_rejected",
  "provider_unavailable",
  "authentication_failed",
  "rate_limited",
  "timeout",
  "unexpected_provider_failure",
]);

export const builderRecordUpdateSchemaCompatibilityProbeReportSchema = z
  .object({
    schema_version: z.literal(
      BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_SCHEMA_VERSION,
    ),
    probe_id: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9_]+$/),
    schema_digest: z.string().regex(/^[a-f0-9]{64}$/),
    accepted: z.boolean(),
    result_class: builderRecordUpdateSchemaCompatibilityResultClassSchema,
    provider_reason_code: z.enum(openAiInvalidRequestReasonCodes).nullable(),
    safe_schema_context: safeSchemaContextSchema,
    attempts: z.number().int().nonnegative().max(1),
    usage_complete: z.boolean(),
    input_tokens: z.number().int().nonnegative().max(5_000_000_000),
    output_tokens: z.number().int().nonnegative().max(5_000_000_000),
    estimated_microusd: z.number().int().nonnegative().max(5_000_000_000),
    elapsed_ms: z.number().int().nonnegative().max(120_000),
    schema_metrics: builderRecordUpdateSchemaCompatibilityMetricsSchema,
  })
  .strict();

export const builderRecordUpdateSchemaCompatibilityAggregateSchema = z
  .object({
    schema_version: z.literal(
      BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_SCHEMA_VERSION,
    ),
    gate: z.literal("record_update_schema_compatibility"),
    model_key: z.literal(OPENAI_BUILDER_RECORD_UPDATE_INTENT_MODEL_KEY),
    reasoning_effort: z.literal(
      OPENAI_BUILDER_RECORD_UPDATE_INTENT_REASONING_EFFORT,
    ),
    max_probe_count: z.literal(
      BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_MAX_PROBE_COUNT,
    ),
    per_probe_reserved_microusd: z.literal(
      BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_PER_PROBE_RESERVATION_MICROUSD,
    ),
    aggregate_reserved_microusd: z.literal(
      BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_AGGREGATE_RESERVATION_MICROUSD,
    ),
    aggregate_hard_ceiling_microusd: z.literal(
      BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_HARD_CEILING_MICROUSD,
    ),
    probes_executed: z.number().int().nonnegative().max(32),
    accepted_probes: z.number().int().nonnegative().max(32),
    rejected_probes: z.number().int().nonnegative().max(32),
    total_attempts: z.number().int().nonnegative().max(32),
    usage_complete: z.boolean(),
    total_input_tokens: z.number().int().nonnegative(),
    total_output_tokens: z.number().int().nonnegative(),
    total_estimated_microusd: z.number().int().nonnegative(),
    total_elapsed_ms: z.number().int().nonnegative(),
    stop_reason: z.enum([
      "completed",
      "provider_unavailable",
      "authentication_failed",
      "rate_limited",
      "timeout",
      "unexpected_provider_failure",
      "cost_ceiling_exceeded",
      "probe_limit_reached",
      "local_schema_rejected",
    ]),
    exact_schema_accepted: z.boolean(),
    first_structural_failure_probe_id: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9_]+$/)
      .nullable(),
  })
  .strict();

export type BuilderRecordUpdateSchemaCompatibilityProbeReport = z.infer<
  typeof builderRecordUpdateSchemaCompatibilityProbeReportSchema
>;
export type BuilderRecordUpdateSchemaCompatibilityAggregate = z.infer<
  typeof builderRecordUpdateSchemaCompatibilityAggregateSchema
>;

export interface BuilderRecordUpdateSchemaCompatibilityEnvironment {
  RUN_LIVE_OPENAI_RECORD_UPDATE_SCHEMA_COMPATIBILITY?: string | undefined;
  AI_PROVIDER?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
}

export interface BuilderRecordUpdateSchemaCompatibilityProbe {
  readonly id: string;
  readonly registeredSchema: JsonSchema;
  readonly transportSchema: JsonSchema | null;
  readonly schemaDigest: string;
  readonly schemaMetrics: z.infer<
    typeof builderRecordUpdateSchemaCompatibilityMetricsSchema
  >;
}

export interface BuilderRecordUpdateSchemaCompatibilityDependencies {
  execute(
    probe: BuilderRecordUpdateSchemaCompatibilityProbe,
    signal: AbortSignal,
    ordinal: number,
  ): Promise<StructuredAiProviderResponse>;
  now(): number;
  emit(value: unknown): void;
}

export interface BuilderRecordUpdateSchemaCompatibilityOverrides {
  execute?: BuilderRecordUpdateSchemaCompatibilityDependencies["execute"];
  now?: () => number;
  emit?: (value: unknown) => void;
  loadDependencies?: (
    apiKey: string,
  ) => Promise<BuilderRecordUpdateSchemaCompatibilityDependencies>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function canonicalSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalSchemaValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalSchemaValue(item)]),
    );
  }
  return value;
}

function schemaDigest(schema: JsonSchema): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalSchemaValue(schema)))
    .digest("hex");
}

export function measureBuilderRecordUpdateSchemaCompatibilitySchema(
  schema: JsonSchema,
) {
  const keywordCounts = Object.fromEntries(
    schemaKeywordNames.map((keyword) => [keyword, 0]),
  ) as Record<SchemaKeyword, number>;
  let totalObjectProperties = 0;
  let maximumNestingDepth = 0;
  let anyOfCount = 0;
  let maximumAnyOfBranches = 0;
  let refCount = 0;
  const visit = (value: unknown, depth: number) => {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth));
      return;
    }
    if (!isPlainObject(value)) return;
    maximumNestingDepth = Math.max(maximumNestingDepth, depth);
    if (isPlainObject(value.properties)) {
      totalObjectProperties += Object.keys(value.properties).length;
    }
    if (Array.isArray(value.anyOf)) {
      anyOfCount += 1;
      maximumAnyOfBranches = Math.max(maximumAnyOfBranches, value.anyOf.length);
    }
    if (typeof value.$ref === "string") refCount += 1;
    for (const [key, item] of Object.entries(value)) {
      if ((schemaKeywordNames as readonly string[]).includes(key)) {
        keywordCounts[key as SchemaKeyword] += 1;
      }
      visit(item, depth + 1);
    }
  };
  visit(schema, 1);
  return builderRecordUpdateSchemaCompatibilityMetricsSchema.parse({
    total_object_properties: totalObjectProperties,
    maximum_nesting_depth: maximumNestingDepth,
    any_of_count: anyOfCount,
    maximum_any_of_branches: maximumAnyOfBranches,
    ref_count: refCount,
    keyword_counts: keywordCounts,
    schema_byte_length: Buffer.byteLength(
      JSON.stringify(canonicalSchemaValue(schema)),
      "utf8",
    ),
  });
}

function registeredSchema(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, {
    target: "draft-7",
    unrepresentable: "throw",
  }) as JsonSchema;
}

function zodProbe(
  id: string,
  schema: z.ZodType,
): BuilderRecordUpdateSchemaCompatibilityProbe {
  return createProbe(id, registeredSchema(schema));
}

function createProbe(
  id: string,
  sourceSchema: JsonSchema,
): BuilderRecordUpdateSchemaCompatibilityProbe {
  let transportSchema: JsonSchema | null = null;
  try {
    transportSchema = adaptRegisteredSchemaForOpenAi(sourceSchema);
  } catch (cause) {
    if (!(cause instanceof OpenAiSchemaAdaptationError)) throw cause;
  }
  const measuredSchema = transportSchema ?? sourceSchema;
  return Object.freeze({
    id,
    registeredSchema: sourceSchema,
    transportSchema,
    schemaDigest: schemaDigest(measuredSchema),
    schemaMetrics:
      measureBuilderRecordUpdateSchemaCompatibilitySchema(measuredSchema),
  });
}

function fieldValueSubset(
  selected: readonly (typeof updateFieldTypes)[number][],
) {
  const options = selected.map((fieldType) => {
    const option = recordCreationFieldValueSchema.options.find(
      (candidate) => candidate.shape.field_type.value === fieldType,
    );
    if (!option) throw new Error("Unknown update Field compatibility branch.");
    return option;
  });
  return options.length === 1
    ? options[0]!
    : z.union(options as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]);
}

function selectorSubset(selected: readonly SelectorFieldType[]) {
  const options = selected.map((fieldType) => {
    const option = recordUpdateSelectorSchema.options.find(
      (candidate) => candidate.shape.field_type.value === fieldType,
    );
    if (!option) throw new Error("Unknown selector compatibility branch.");
    return option;
  });
  return options.length === 1
    ? options[0]!
    : z.union(options as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]);
}

const ownerTextSchema = z.string().trim().min(1).max(2_000);
const sourceStepReference = z.string().regex(/^step_[1-9][0-9]*$/);
const objectKey = z.string().regex(/^[a-z][a-z0-9_]*$/);

function readyProbeSchema(
  selectors: readonly SelectorFieldType[],
  updates: readonly (typeof updateFieldTypes)[number][],
) {
  return z
    .object({
      schema_version: z.literal(BUILDER_RECORD_UPDATE_INTENT_SCHEMA_VERSION),
      state: z.literal("ready"),
      summary: ownerTextSchema,
      source_step_reference: sourceStepReference,
      object_key: objectKey,
      selector: selectorSubset(selectors),
      field_updates: z.array(fieldValueSubset(updates)).min(1).max(3),
    })
    .strict();
}

const clarificationProbeSchema = z
  .object({
    schema_version: z.literal(BUILDER_RECORD_UPDATE_INTENT_SCHEMA_VERSION),
    state: z.literal("needs_clarification"),
    understanding: ownerTextSchema,
    question: ownerTextSchema,
    reason: ownerTextSchema,
    source_step_reference: sourceStepReference,
  })
  .strict();

export const builderRecordUpdateSchemaCompatibilityBaseProbes = Object.freeze([
  zodProbe(
    "a_transport_baseline",
    z.object({ accepted: z.literal(true) }).strict(),
  ),
  zodProbe(
    "b_state_union",
    z.discriminatedUnion("state", [
      readyProbeSchema(["short_text"], ["short_text"]),
      clarificationProbeSchema,
    ]),
  ),
  zodProbe(
    "c_short_text_selector",
    readyProbeSchema(["short_text"], ["short_text"]),
  ),
  zodProbe("c_email_selector", readyProbeSchema(["email"], ["short_text"])),
  zodProbe("c_phone_selector", readyProbeSchema(["phone"], ["short_text"])),
  zodProbe("c_url_selector", readyProbeSchema(["url"], ["short_text"])),
  zodProbe(
    "c_text_selector_cumulative",
    readyProbeSchema(selectorFieldTypes.slice(0, 4), ["short_text"]),
  ),
  zodProbe("d_number_selector", readyProbeSchema(["number"], ["currency"])),
  zodProbe("d_currency_selector", readyProbeSchema(["currency"], ["currency"])),
  zodProbe("d_boolean_selector", readyProbeSchema(["boolean"], ["boolean"])),
  zodProbe("d_date_selector", readyProbeSchema(["date"], ["date"])),
  zodProbe("d_datetime_selector", readyProbeSchema(["datetime"], ["datetime"])),
  zodProbe(
    "d_primitive_selector_cumulative",
    readyProbeSchema(selectorFieldTypes.slice(4, 9), ["currency"]),
  ),
  zodProbe("e_select_selector", readyProbeSchema(["select"], ["status"])),
  zodProbe("e_status_selector", readyProbeSchema(["status"], ["status"])),
  zodProbe(
    "e_option_selector_cumulative",
    readyProbeSchema(["select", "status"], ["status"]),
  ),
  zodProbe(
    "f_complete_selector_union",
    readyProbeSchema(selectorFieldTypes, ["currency"]),
  ),
  zodProbe(
    "g_imported_field_update_union",
    readyProbeSchema(["short_text"], updateFieldTypes),
  ),
  zodProbe(
    "h_complete_ready_record_update",
    readyProbeSchema(selectorFieldTypes, updateFieldTypes),
  ),
  createProbe(
    "i_exact_registered_record_update_schema",
    registeredSchema(builderRecordUpdateIntentOutputSchema),
  ),
]);

function cloneRemovingKeywords(
  value: unknown,
  removed: ReadonlySet<string>,
): unknown {
  if (Array.isArray(value))
    return value.map((item) => cloneRemovingKeywords(item, removed));
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !removed.has(key))
      .map(([key, item]) => [key, cloneRemovingKeywords(item, removed)]),
  );
}

function keywordVariants() {
  return [
    ["keyword_without_string_bounds", ["minLength", "maxLength"]],
    ["keyword_without_patterns", ["pattern"]],
    ["keyword_without_formats", ["format"]],
    ["keyword_without_numeric_bounds", ["minimum", "maximum"]],
    ["keyword_without_array_bounds", ["minItems", "maxItems"]],
    ["keyword_without_annotations", ["title", "description"]],
    ["keyword_without_defs_refs", ["$defs", "$ref"]],
  ] as const;
}

function estimatedCost(inputTokens: number, outputTokens: number) {
  return calculateAiTokenCostMicrousd({
    inputTokens,
    outputTokens,
    inputMicrousdPerMillion:
      openAiBuilderRecordUpdateIntentPolicy.inputMicrousdPerMillion,
    outputMicrousdPerMillion:
      openAiBuilderRecordUpdateIntentPolicy.outputMicrousdPerMillion,
  });
}

function causeInChain<T>(
  cause: unknown,
  predicate: (value: unknown) => value is T,
): T | undefined {
  let current = cause;
  const seen = new Set<object>();
  for (let depth = 0; depth < 6 && current !== undefined; depth += 1) {
    if (predicate(current)) return current;
    if (typeof current !== "object" || current === null) break;
    if (seen.has(current)) break;
    seen.add(current);
    if (!("cause" in current)) break;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function reportFor(
  probe: BuilderRecordUpdateSchemaCompatibilityProbe,
  input: {
    accepted: boolean;
    resultClass: z.infer<
      typeof builderRecordUpdateSchemaCompatibilityResultClassSchema
    >;
    providerReasonCode: (typeof openAiInvalidRequestReasonCodes)[number] | null;
    safeSchemaContext: OpenAiSafeSchemaContext;
    attempts: 0 | 1;
    inputTokens: number;
    outputTokens: number;
    usageComplete: boolean;
    elapsedMs: number;
  },
) {
  return builderRecordUpdateSchemaCompatibilityProbeReportSchema.parse({
    schema_version: BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_SCHEMA_VERSION,
    probe_id: probe.id,
    schema_digest: probe.schemaDigest,
    accepted: input.accepted,
    result_class: input.resultClass,
    provider_reason_code: input.providerReasonCode,
    safe_schema_context: input.safeSchemaContext,
    attempts: input.attempts,
    usage_complete: input.usageComplete,
    input_tokens: input.inputTokens,
    output_tokens: input.outputTokens,
    estimated_microusd: estimatedCost(input.inputTokens, input.outputTokens),
    elapsed_ms: input.elapsedMs,
    schema_metrics: probe.schemaMetrics,
  });
}

function fatalStopReason(
  report: BuilderRecordUpdateSchemaCompatibilityProbeReport,
) {
  switch (report.result_class) {
    case "provider_unavailable":
    case "authentication_failed":
    case "rate_limited":
    case "timeout":
    case "unexpected_provider_failure":
      return report.result_class;
    default:
      return null;
  }
}

async function executeProbe(
  dependencies: BuilderRecordUpdateSchemaCompatibilityDependencies,
  probe: BuilderRecordUpdateSchemaCompatibilityProbe,
  ordinal: number,
) {
  const started = dependencies.now();
  if (!probe.transportSchema) {
    return reportFor(probe, {
      accepted: false,
      resultClass: "local_schema_rejected",
      providerReasonCode: "local_schema_adaptation",
      safeSchemaContext: "unknown",
      attempts: 0,
      inputTokens: 0,
      outputTokens: 0,
      usageComplete: false,
      elapsedMs: Math.max(0, Math.round(dependencies.now() - started)),
    });
  }
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_TIMEOUT_MS);
  try {
    const response = await dependencies.execute(
      probe,
      controller.signal,
      ordinal,
    );
    const usage = response.usage;
    return reportFor(probe, {
      accepted: true,
      resultClass: "accepted_completed",
      providerReasonCode: null,
      safeSchemaContext: "unknown",
      attempts: 1,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      usageComplete: usage !== undefined,
      elapsedMs: Math.max(0, Math.round(dependencies.now() - started)),
    });
  } catch (cause) {
    const providerFailure = causeInChain(
      cause,
      (value): value is StructuredAiProviderError =>
        value instanceof StructuredAiProviderError,
    );
    const diagnostic = causeInChain(
      cause,
      (value): value is OpenAiInvalidRequestDiagnostic =>
        value instanceof OpenAiInvalidRequestDiagnostic,
    );
    const authentication = causeInChain(
      cause,
      (value): value is OpenAiAuthenticationDiagnostic =>
        value instanceof OpenAiAuthenticationDiagnostic,
    );
    const usage = providerFailure?.usage;
    const common = {
      providerReasonCode: diagnostic?.reasonCode ?? null,
      safeSchemaContext: diagnostic?.safeSchemaContext ?? ("unknown" as const),
      attempts: (diagnostic?.reasonCode === "local_schema_adaptation"
        ? 0
        : 1) as 0 | 1,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      usageComplete: usage !== undefined,
      elapsedMs: Math.max(0, Math.round(dependencies.now() - started)),
    };
    if (timedOut)
      return reportFor(probe, {
        ...common,
        accepted: false,
        resultClass: "timeout",
      });
    if (diagnostic?.reasonCode === "local_schema_adaptation") {
      return reportFor(probe, {
        ...common,
        accepted: false,
        resultClass: "local_schema_rejected",
      });
    }
    if (diagnostic?.reasonCode === "provider_schema_rejected") {
      return reportFor(probe, {
        ...common,
        accepted: false,
        resultClass: "schema_rejected",
      });
    }
    if (authentication)
      return reportFor(probe, {
        ...common,
        accepted: false,
        resultClass: "authentication_failed",
      });
    if (providerFailure?.kind === "rate_limited")
      return reportFor(probe, {
        ...common,
        accepted: false,
        resultClass: "rate_limited",
      });
    if (
      providerFailure?.kind === "unavailable" ||
      providerFailure?.kind === "transient"
    ) {
      return reportFor(probe, {
        ...common,
        accepted: false,
        resultClass: "provider_unavailable",
      });
    }
    return reportFor(probe, {
      ...common,
      accepted: false,
      resultClass: "unexpected_provider_failure",
    });
  } finally {
    clearTimeout(timeout);
  }
}

function activated(
  environment: BuilderRecordUpdateSchemaCompatibilityEnvironment,
) {
  return (
    environment.RUN_LIVE_OPENAI_RECORD_UPDATE_SCHEMA_COMPATIBILITY === "1" &&
    environment.AI_PROVIDER?.trim() === "openai" &&
    Boolean(environment.OPENAI_API_KEY?.trim())
  );
}

export function liveBuilderRecordUpdateSchemaCompatibilityIsActivated(
  environment: BuilderRecordUpdateSchemaCompatibilityEnvironment,
) {
  return activated(environment);
}

async function defaultDependencies(
  apiKey: string,
): Promise<BuilderRecordUpdateSchemaCompatibilityDependencies> {
  const provider: StructuredAiProvider =
    createOpenAiResponsesStructuredProvider(apiKey);
  return {
    execute: (probe, signal) =>
      provider.generateStructured({
        providerKey: "openai",
        modelKey: OPENAI_BUILDER_RECORD_UPDATE_INTENT_MODEL_KEY,
        instruction: "Return the smallest valid result.",
        input: { compatibility_probe: "record_update_schema", ordinal: 1 },
        outputContract: {
          name: "builder_record_update_schema_compatibility_v1",
          version: 1,
          jsonSchema: probe.registeredSchema,
        },
        maxOutputTokens:
          BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_MAX_OUTPUT_TOKENS,
        signal,
      }),
    now: () => performance.now(),
    emit: (value) => console.log(JSON.stringify(value)),
  };
}

function setupFailure(reasonCode: "dependency_initialization_failed") {
  return {
    evaluation_error_code: "evaluation_setup_failed",
    reason_code: reasonCode,
  } as const;
}

export function compareBuilderRecordUpdateSchemaWithInstalledOpenAiHelper() {
  const registered = registeredSchema(builderRecordUpdateIntentOutputSchema);
  const transport = adaptRegisteredSchemaForOpenAi(registered);
  const smbosMetrics =
    measureBuilderRecordUpdateSchemaCompatibilitySchema(transport);
  const smbosDigest = schemaDigest(transport);
  try {
    const helper = zodTextFormat(
      z.object({ result: builderRecordUpdateIntentOutputSchema }).strict(),
      "builder_record_update_schema_compatibility_v1",
    );
    const helperSchema = helper.schema as JsonSchema;
    const helperMetrics =
      measureBuilderRecordUpdateSchemaCompatibilitySchema(helperSchema);
    const difference =
      smbosDigest === schemaDigest(helperSchema)
        ? ["none"]
        : ["canonical_digest"];
    return {
      schema_version: 1,
      helper_generation_succeeded: true,
      smbos_schema_digest: smbosDigest,
      helper_schema_digest: schemaDigest(helperSchema),
      smbos_schema_metrics: smbosMetrics,
      helper_schema_metrics: helperMetrics,
      difference_categories: difference,
    } as const;
  } catch {
    return {
      schema_version: 1,
      helper_generation_succeeded: false,
      smbos_schema_digest: smbosDigest,
      helper_schema_digest: null,
      smbos_schema_metrics: smbosMetrics,
      helper_schema_metrics: null,
      difference_categories: ["helper_generation_failed"],
    } as const;
  }
}

export async function runLiveBuilderRecordUpdateSchemaCompatibility(
  environment: BuilderRecordUpdateSchemaCompatibilityEnvironment,
  overrides: BuilderRecordUpdateSchemaCompatibilityOverrides = {},
) {
  if (!activated(environment)) return { ran: false, passed: false } as const;
  const emit =
    overrides.emit ?? ((value: unknown) => console.log(JSON.stringify(value)));
  const apiKey = environment.OPENAI_API_KEY!.trim();
  let dependencies: BuilderRecordUpdateSchemaCompatibilityDependencies;
  try {
    dependencies = overrides.execute
      ? {
          execute: overrides.execute,
          now: overrides.now ?? (() => performance.now()),
          emit,
        }
      : await (overrides.loadDependencies ?? defaultDependencies)(apiKey);
  } catch {
    const failure = setupFailure("dependency_initialization_failed");
    emit(failure);
    return { ran: true, passed: false, setup_failure: failure } as const;
  }

  const reports: BuilderRecordUpdateSchemaCompatibilityProbeReport[] = [];
  let totalCost = 0;
  let stopReason: BuilderRecordUpdateSchemaCompatibilityAggregate["stop_reason"] =
    "completed";

  const run = async (probe: BuilderRecordUpdateSchemaCompatibilityProbe) => {
    if (
      reports.length >=
      BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_MAX_PROBE_COUNT
    ) {
      stopReason = "probe_limit_reached";
      return false;
    }
    const result = await executeProbe(dependencies, probe, reports.length + 1);
    reports.push(result);
    emit(result);
    totalCost += result.estimated_microusd;
    if (
      totalCost >
      BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_HARD_CEILING_MICROUSD
    ) {
      stopReason = "cost_ceiling_exceeded";
      return false;
    }
    const fatal = fatalStopReason(result);
    if (fatal) {
      stopReason = fatal;
      return false;
    }
    return true;
  };

  const exactProbe = builderRecordUpdateSchemaCompatibilityBaseProbes.at(-1)!;
  if (!(await run(exactProbe))) {
    // A provider/schema failure is already represented by the bounded report.
  } else if (reports[0]?.accepted) {
    stopReason = "completed";
  } else if (reports[0]?.result_class === "schema_rejected") {
    for (const probe of builderRecordUpdateSchemaCompatibilityBaseProbes) {
      if (!(await run(probe))) break;
    }
    const exact = builderRecordUpdateSchemaCompatibilityBaseProbes.at(-1)!;
    for (const [id, removed] of keywordVariants()) {
      if (
        reports.length >=
        BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_MAX_PROBE_COUNT
      )
        break;
      const variant = createProbe(
        id,
        cloneRemovingKeywords(
          exact.registeredSchema,
          new Set(removed),
        ) as JsonSchema,
      );
      if (!(await run(variant))) break;
    }
  } else if (reports[0]?.result_class === "local_schema_rejected") {
    stopReason = "local_schema_rejected";
  }

  const accepted = reports.filter(({ accepted: value }) => value).length;
  const aggregate = builderRecordUpdateSchemaCompatibilityAggregateSchema.parse(
    {
      schema_version: 1,
      gate: "record_update_schema_compatibility",
      model_key: OPENAI_BUILDER_RECORD_UPDATE_INTENT_MODEL_KEY,
      reasoning_effort: OPENAI_BUILDER_RECORD_UPDATE_INTENT_REASONING_EFFORT,
      max_probe_count:
        BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_MAX_PROBE_COUNT,
      per_probe_reserved_microusd:
        BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_PER_PROBE_RESERVATION_MICROUSD,
      aggregate_reserved_microusd:
        BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_AGGREGATE_RESERVATION_MICROUSD,
      aggregate_hard_ceiling_microusd:
        BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_HARD_CEILING_MICROUSD,
      probes_executed: reports.length,
      accepted_probes: accepted,
      rejected_probes: reports.length - accepted,
      total_attempts: reports.reduce((sum, report) => sum + report.attempts, 0),
      usage_complete: reports.every(({ usage_complete }) => usage_complete),
      total_input_tokens: reports.reduce(
        (sum, report) => sum + report.input_tokens,
        0,
      ),
      total_output_tokens: reports.reduce(
        (sum, report) => sum + report.output_tokens,
        0,
      ),
      total_estimated_microusd: totalCost,
      total_elapsed_ms: reports.reduce(
        (sum, report) => sum + report.elapsed_ms,
        0,
      ),
      stop_reason: stopReason,
      exact_schema_accepted: reports[0]?.accepted ?? false,
      first_structural_failure_probe_id:
        reports.find(
          ({ result_class }) =>
            result_class === "schema_rejected" ||
            result_class === "local_schema_rejected",
        )?.probe_id ?? null,
    },
  );
  emit(aggregate);
  return Object.freeze({
    ran: true,
    passed: aggregate.exact_schema_accepted && stopReason === "completed",
    reports: Object.freeze(reports),
    aggregate,
  });
}
