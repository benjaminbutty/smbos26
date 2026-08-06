import "server-only";

import { createHash } from "node:crypto";

import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import { calculateAiTokenCostMicrousd } from "../../accounting/cost";
import {
  StructuredAiProviderError,
  type StructuredAiProviderResponse,
} from "../../contracts";
import {
  OPENAI_BUILDER_RECORD_CREATION_INTENT_MODEL_KEY,
  OPENAI_BUILDER_RECORD_CREATION_INTENT_REASONING_EFFORT,
  openAiBuilderRecordCreationIntentPolicy,
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
  BUILDER_RECORD_CREATION_INTENT_SCHEMA_VERSION,
  builderRecordCreationFieldValueSchema,
  builderRecordCreationIntentOutputSchema,
} from "../../record-creation-intent/schemas";
import { graphKeySchema } from "../../../core/graph/schemas";

export const BUILDER_RECORD_SCHEMA_COMPATIBILITY_SCHEMA_VERSION = 1 as const;
export const BUILDER_RECORD_SCHEMA_COMPATIBILITY_MAX_PROBE_COUNT = 32 as const;
export const BUILDER_RECORD_SCHEMA_COMPATIBILITY_MAX_OUTPUT_TOKENS =
  128 as const;
export const BUILDER_RECORD_SCHEMA_COMPATIBILITY_RESERVED_INPUT_TOKENS =
  16_000 as const;
export const BUILDER_RECORD_SCHEMA_COMPATIBILITY_TIMEOUT_MS = 30_000 as const;
export const BUILDER_RECORD_SCHEMA_COMPATIBILITY_PER_PROBE_RESERVATION_MICROUSD =
  41_920 as const;
export const BUILDER_RECORD_SCHEMA_COMPATIBILITY_AGGREGATE_RESERVATION_MICROUSD =
  1_341_440 as const;
export const BUILDER_RECORD_SCHEMA_COMPATIBILITY_HARD_CEILING_MICROUSD =
  1_350_000 as const;

const fieldTypes = Object.freeze([
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
] as const);

type FieldType = (typeof fieldTypes)[number];

export const BUILDER_RECORD_SCHEMA_COMPATIBILITY_BASE_PROBE_IDS = Object.freeze(
  [
    "a_transport_baseline",
    "b_state_union",
    "c_short_text",
    "d_long_text",
    "d_email",
    "d_phone",
    "d_url",
    "d_text_like_cumulative",
    "e_number",
    "e_currency",
    "e_boolean",
    "e_date",
    "e_datetime",
    "e_primitive_cumulative",
    "f_select",
    "f_status",
    "f_multi_select",
    "f_option_cumulative",
    "g_complete_field_union",
    "h_exact_full_record_schema",
  ] as const,
);

const keywordVariantIds = Object.freeze([
  "keyword_without_string_bounds",
  "keyword_without_patterns",
  "keyword_without_formats",
  "keyword_without_numeric_bounds",
  "keyword_without_array_bounds",
  "keyword_without_annotations",
  "keyword_without_defs_refs",
] as const);

const schemaKeywordNames = Object.freeze([
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
] as const);

type SchemaKeyword = (typeof schemaKeywordNames)[number];
type JsonSchema = Readonly<Record<string, unknown>>;

const schemaKeywordCountShape = Object.fromEntries(
  schemaKeywordNames.map((keyword) => [
    keyword,
    z.number().int().nonnegative().max(100_000),
  ]),
) as Record<SchemaKeyword, z.ZodNumber>;

export const builderRecordSchemaCompatibilityMetricsSchema = z
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

export const builderRecordSchemaCompatibilityResultClassSchema = z.enum([
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

export const builderRecordSchemaCompatibilityProbeReportSchema = z
  .object({
    schema_version: z.literal(
      BUILDER_RECORD_SCHEMA_COMPATIBILITY_SCHEMA_VERSION,
    ),
    probe_id: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9_]+$/),
    schema_digest: z.string().regex(/^[a-f0-9]{64}$/),
    accepted: z.boolean(),
    result_class: builderRecordSchemaCompatibilityResultClassSchema,
    provider_reason_code: z.enum(openAiInvalidRequestReasonCodes).nullable(),
    safe_schema_context: safeSchemaContextSchema,
    attempts: z.number().int().nonnegative().max(1),
    usage_complete: z.boolean(),
    input_tokens: z.number().int().nonnegative().max(5_000_000_000),
    output_tokens: z.number().int().nonnegative().max(5_000_000_000),
    estimated_microusd: z.number().int().nonnegative().max(5_000_000_000),
    elapsed_ms: z.number().int().nonnegative().max(120_000),
    schema_metrics: builderRecordSchemaCompatibilityMetricsSchema,
  })
  .strict();

const sdkDifferenceCategorySchema = z.enum([
  "none",
  "helper_generation_failed",
  "canonical_digest",
  "object_properties",
  "nesting_depth",
  "union_keywords",
  "definitions_or_references",
  "required_or_additional_properties",
  "string_constraints",
  "numeric_constraints",
  "array_constraints",
  "formats",
  "annotations",
  "other_keyword_counts",
  "keyword_paths",
  "schema_byte_length",
]);

export const builderRecordSchemaCompatibilitySdkComparisonSchema = z
  .object({
    schema_version: z.literal(
      BUILDER_RECORD_SCHEMA_COMPATIBILITY_SCHEMA_VERSION,
    ),
    helper_generation_succeeded: z.boolean(),
    smbos_schema_digest: z.string().regex(/^[a-f0-9]{64}$/),
    helper_schema_digest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    smbos_schema_metrics: builderRecordSchemaCompatibilityMetricsSchema,
    helper_schema_metrics:
      builderRecordSchemaCompatibilityMetricsSchema.nullable(),
    difference_categories: z.array(sdkDifferenceCategorySchema).max(20),
  })
  .strict();

const familyFindingSchema = z
  .object({
    family: z.enum(["text_like", "primitive_business_value", "option"]),
    conclusion: z.enum([
      "accepted",
      "individual_branch_rejected",
      "combination_or_union_size_rejected",
      "inconclusive",
    ]),
  })
  .strict();

const unionIsolationSchema = z
  .object({
    outcome: z.enum([
      "branch_count",
      "specific_combination_or_order",
      "inconclusive",
    ]),
    smallest_failing_branch_count: z.number().int().min(2).max(13).nullable(),
    specific_branch_combination_required: z.boolean().nullable(),
    probes_used: z.number().int().nonnegative().max(5),
  })
  .strict();

const exactIsolationSchema = z
  .object({
    outcome: z.enum([
      "not_required",
      "clarification_branch",
      "source_step_constraints",
      "annotations",
      "registered_schema_difference",
      "remaining_exact_schema_difference",
      "inconclusive",
    ]),
    outer_wrapper_baseline_accepted: z.boolean(),
    probes_used: z.number().int().nonnegative().max(4),
  })
  .strict();

export const builderRecordSchemaCompatibilityAggregateSchema = z
  .object({
    schema_version: z.literal(
      BUILDER_RECORD_SCHEMA_COMPATIBILITY_SCHEMA_VERSION,
    ),
    gate: z.literal("record_schema_compatibility"),
    model_key: z.literal(OPENAI_BUILDER_RECORD_CREATION_INTENT_MODEL_KEY),
    reasoning_effort: z.literal(
      OPENAI_BUILDER_RECORD_CREATION_INTENT_REASONING_EFFORT,
    ),
    max_probe_count: z.literal(
      BUILDER_RECORD_SCHEMA_COMPATIBILITY_MAX_PROBE_COUNT,
    ),
    per_probe_reserved_microusd: z.literal(
      BUILDER_RECORD_SCHEMA_COMPATIBILITY_PER_PROBE_RESERVATION_MICROUSD,
    ),
    aggregate_reserved_microusd: z.literal(
      BUILDER_RECORD_SCHEMA_COMPATIBILITY_AGGREGATE_RESERVATION_MICROUSD,
    ),
    aggregate_hard_ceiling_microusd: z.literal(
      BUILDER_RECORD_SCHEMA_COMPATIBILITY_HARD_CEILING_MICROUSD,
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
    ]),
    exact_schema_accepted: z.boolean(),
    first_structural_failure_probe_id: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9_]+$/)
      .nullable(),
    family_findings: z.array(familyFindingSchema).length(3),
    union_isolation: unionIsolationSchema.nullable(),
    exact_isolation: exactIsolationSchema,
  })
  .strict();

export type BuilderRecordSchemaCompatibilityProbeReport = z.infer<
  typeof builderRecordSchemaCompatibilityProbeReportSchema
>;

export interface BuilderRecordSchemaCompatibilityEnvironment {
  RUN_LIVE_OPENAI_RECORD_CREATION_SCHEMA_COMPATIBILITY?: string | undefined;
  AI_PROVIDER?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
}

interface CompatibilityProbe {
  readonly id: string;
  readonly registeredSchema: JsonSchema;
  readonly transportSchema: JsonSchema | null;
  readonly schemaDigest: string;
  readonly schemaMetrics: z.infer<
    typeof builderRecordSchemaCompatibilityMetricsSchema
  >;
  readonly fieldTypes: readonly FieldType[];
}

export interface BuilderRecordSchemaCompatibilityDependencies {
  execute(
    probe: CompatibilityProbe,
    signal: AbortSignal,
    ordinal: number,
  ): Promise<StructuredAiProviderResponse>;
  now(): number;
  emit(value: unknown): void;
}

export interface BuilderRecordSchemaCompatibilityOverrides {
  execute?: BuilderRecordSchemaCompatibilityDependencies["execute"];
  now?: () => number;
  emit?: (value: unknown) => void;
  loadDependencies?: (
    apiKey: string,
  ) => Promise<BuilderRecordSchemaCompatibilityDependencies>;
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

function schemaKeywordPaths(schema: JsonSchema): string {
  const paths: string[] = [];
  const visit = (value: unknown, path: readonly string[]) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, String(index)]));
      return;
    }
    if (!isPlainObject(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if ((schemaKeywordNames as readonly string[]).includes(key)) {
        paths.push([...path, key].join("/"));
      }
      visit(item, [...path, key]);
    }
  };
  visit(schema, []);
  return createHash("sha256").update(paths.toSorted().join("\n")).digest("hex");
}

export function measureBuilderRecordSchemaCompatibilitySchema(
  schema: JsonSchema,
): z.infer<typeof builderRecordSchemaCompatibilityMetricsSchema> {
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
      for (const item of value) visit(item, depth);
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
  const canonical = JSON.stringify(canonicalSchemaValue(schema));
  return builderRecordSchemaCompatibilityMetricsSchema.parse({
    total_object_properties: totalObjectProperties,
    maximum_nesting_depth: maximumNestingDepth,
    any_of_count: anyOfCount,
    maximum_any_of_branches: maximumAnyOfBranches,
    ref_count: refCount,
    keyword_counts: keywordCounts,
    schema_byte_length: Buffer.byteLength(canonical, "utf8"),
  });
}

function registeredSchema(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, {
    target: "draft-7",
    unrepresentable: "throw",
  }) as JsonSchema;
}

const fieldOptions =
  builderRecordCreationFieldValueSchema.options as readonly z.ZodType[];
if (fieldOptions.length !== fieldTypes.length) {
  throw new Error("The Record Field compatibility matrix is out of date.");
}
const fieldOptionByType = new Map<FieldType, z.ZodType>(
  fieldTypes.map(
    (fieldType, index) => [fieldType, fieldOptions[index]!] as const,
  ),
);

const ownerTextSchema = z.string().trim().min(1).max(2_000);

function sourceReferencesSchema(relaxed = false) {
  const item = relaxed
    ? z.string()
    : z
        .string()
        .max(80)
        .regex(/^step_[1-9][0-9]*$/);
  return z.array(item).length(1);
}

function fieldValueSubsetSchema(selected: readonly FieldType[]): z.ZodType {
  const options = selected.map((fieldType) => {
    const option = fieldOptionByType.get(fieldType);
    if (!option) throw new Error("Unknown Record Field compatibility branch.");
    return option;
  });
  if (options.length === 1) return options[0]!;
  return z.union(options as [z.ZodType, z.ZodType, ...z.ZodType[]]);
}

function readyProbeSchema(
  selected: readonly FieldType[],
  options: { relaxedSourceReferences?: boolean } = {},
) {
  return z
    .object({
      schema_version: z.literal(BUILDER_RECORD_CREATION_INTENT_SCHEMA_VERSION),
      state: z.literal("ready"),
      summary: ownerTextSchema,
      source_step_references: sourceReferencesSchema(
        options.relaxedSourceReferences,
      ),
      object_key: graphKeySchema,
      field_values: z.array(fieldValueSubsetSchema(selected)).min(1).max(50),
    })
    .strict();
}

function readyWithoutFieldsSchema() {
  return z
    .object({
      schema_version: z.literal(BUILDER_RECORD_CREATION_INTENT_SCHEMA_VERSION),
      state: z.literal("ready"),
      summary: ownerTextSchema,
      source_step_references: sourceReferencesSchema(),
      object_key: graphKeySchema,
    })
    .strict();
}

function clarificationProbeSchema(relaxedSourceReferences = false) {
  return z
    .object({
      schema_version: z.literal(BUILDER_RECORD_CREATION_INTENT_SCHEMA_VERSION),
      state: z.literal("needs_clarification"),
      understanding: ownerTextSchema,
      question: ownerTextSchema,
      reason: ownerTextSchema,
      source_step_references: sourceReferencesSchema(relaxedSourceReferences),
    })
    .strict();
}

function composedProbeSchema(
  selected: readonly FieldType[],
  relaxedSourceReferences = false,
) {
  return z.discriminatedUnion("state", [
    readyProbeSchema(selected, { relaxedSourceReferences }),
    clarificationProbeSchema(relaxedSourceReferences),
  ]);
}

function createProbe(
  id: string,
  sourceSchema: JsonSchema,
  selected: readonly FieldType[] = [],
): CompatibilityProbe {
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
      measureBuilderRecordSchemaCompatibilitySchema(measuredSchema),
    fieldTypes: Object.freeze([...selected]),
  });
}

function zodProbe(
  id: string,
  schema: z.ZodType,
  selected: readonly FieldType[] = [],
) {
  return createProbe(id, registeredSchema(schema), selected);
}

const textLikeTypes = fieldTypes.slice(0, 5);
const primitiveTypes = fieldTypes.slice(5, 10);
const optionTypes = fieldTypes.slice(10, 13);

export const builderRecordSchemaCompatibilityBaseProbes = Object.freeze([
  zodProbe(
    "a_transport_baseline",
    z.object({ accepted: z.literal(true) }).strict(),
  ),
  zodProbe(
    "b_state_union",
    z.discriminatedUnion("state", [
      readyWithoutFieldsSchema(),
      clarificationProbeSchema(),
    ]),
  ),
  zodProbe("c_short_text", readyProbeSchema(["short_text"]), ["short_text"]),
  zodProbe("d_long_text", readyProbeSchema(["long_text"]), ["long_text"]),
  zodProbe("d_email", readyProbeSchema(["email"]), ["email"]),
  zodProbe("d_phone", readyProbeSchema(["phone"]), ["phone"]),
  zodProbe("d_url", readyProbeSchema(["url"]), ["url"]),
  zodProbe(
    "d_text_like_cumulative",
    readyProbeSchema(textLikeTypes),
    textLikeTypes,
  ),
  zodProbe("e_number", readyProbeSchema(["number"]), ["number"]),
  zodProbe("e_currency", readyProbeSchema(["currency"]), ["currency"]),
  zodProbe("e_boolean", readyProbeSchema(["boolean"]), ["boolean"]),
  zodProbe("e_date", readyProbeSchema(["date"]), ["date"]),
  zodProbe("e_datetime", readyProbeSchema(["datetime"]), ["datetime"]),
  zodProbe(
    "e_primitive_cumulative",
    readyProbeSchema(primitiveTypes),
    primitiveTypes,
  ),
  zodProbe("f_select", readyProbeSchema(["select"]), ["select"]),
  zodProbe("f_status", readyProbeSchema(["status"]), ["status"]),
  zodProbe("f_multi_select", readyProbeSchema(["multi_select"]), [
    "multi_select",
  ]),
  zodProbe("f_option_cumulative", readyProbeSchema(optionTypes), optionTypes),
  zodProbe("g_complete_field_union", readyProbeSchema(fieldTypes), fieldTypes),
  createProbe(
    "h_exact_full_record_schema",
    registeredSchema(builderRecordCreationIntentOutputSchema),
    fieldTypes,
  ),
]);

function compareMetricGroup(
  left: z.infer<typeof builderRecordSchemaCompatibilityMetricsSchema>,
  right: z.infer<typeof builderRecordSchemaCompatibilityMetricsSchema>,
  keywords: readonly SchemaKeyword[],
) {
  return keywords.some(
    (keyword) => left.keyword_counts[keyword] !== right.keyword_counts[keyword],
  );
}

export function compareBuilderRecordSchemaWithInstalledOpenAiHelper() {
  const exactRegistered = registeredSchema(
    builderRecordCreationIntentOutputSchema,
  );
  const smbosSchema = adaptRegisteredSchemaForOpenAi(exactRegistered);
  const smbosMetrics =
    measureBuilderRecordSchemaCompatibilitySchema(smbosSchema);
  const smbosDigest = schemaDigest(smbosSchema);
  try {
    const helper = zodTextFormat(
      z.object({ result: builderRecordCreationIntentOutputSchema }).strict(),
      "builder_record_creation_schema_compatibility_v1",
    );
    const helperSchema = helper.schema as JsonSchema;
    const helperMetrics =
      measureBuilderRecordSchemaCompatibilitySchema(helperSchema);
    const differences = new Set<z.infer<typeof sdkDifferenceCategorySchema>>();
    if (smbosDigest !== schemaDigest(helperSchema))
      differences.add("canonical_digest");
    if (
      smbosMetrics.total_object_properties !==
      helperMetrics.total_object_properties
    )
      differences.add("object_properties");
    if (
      smbosMetrics.maximum_nesting_depth !== helperMetrics.maximum_nesting_depth
    )
      differences.add("nesting_depth");
    if (compareMetricGroup(smbosMetrics, helperMetrics, ["anyOf"])) {
      differences.add("union_keywords");
    }
    if (compareMetricGroup(smbosMetrics, helperMetrics, ["$defs", "$ref"])) {
      differences.add("definitions_or_references");
    }
    if (
      compareMetricGroup(smbosMetrics, helperMetrics, [
        "required",
        "additionalProperties",
      ])
    )
      differences.add("required_or_additional_properties");
    if (
      compareMetricGroup(smbosMetrics, helperMetrics, [
        "minLength",
        "maxLength",
        "pattern",
      ])
    )
      differences.add("string_constraints");
    if (
      compareMetricGroup(smbosMetrics, helperMetrics, ["minimum", "maximum"])
    ) {
      differences.add("numeric_constraints");
    }
    if (
      compareMetricGroup(smbosMetrics, helperMetrics, ["minItems", "maxItems"])
    ) {
      differences.add("array_constraints");
    }
    if (compareMetricGroup(smbosMetrics, helperMetrics, ["format"])) {
      differences.add("formats");
    }
    if (
      compareMetricGroup(smbosMetrics, helperMetrics, ["title", "description"])
    ) {
      differences.add("annotations");
    }
    const grouped = new Set<SchemaKeyword>([
      "anyOf",
      "$defs",
      "$ref",
      "required",
      "additionalProperties",
      "minLength",
      "maxLength",
      "pattern",
      "minimum",
      "maximum",
      "minItems",
      "maxItems",
      "format",
      "title",
      "description",
    ]);
    if (
      compareMetricGroup(
        smbosMetrics,
        helperMetrics,
        schemaKeywordNames.filter((keyword) => !grouped.has(keyword)),
      )
    )
      differences.add("other_keyword_counts");
    if (schemaKeywordPaths(smbosSchema) !== schemaKeywordPaths(helperSchema)) {
      differences.add("keyword_paths");
    }
    if (smbosMetrics.schema_byte_length !== helperMetrics.schema_byte_length) {
      differences.add("schema_byte_length");
    }
    if (differences.size === 0) differences.add("none");
    return builderRecordSchemaCompatibilitySdkComparisonSchema.parse({
      schema_version: BUILDER_RECORD_SCHEMA_COMPATIBILITY_SCHEMA_VERSION,
      helper_generation_succeeded: true,
      smbos_schema_digest: smbosDigest,
      helper_schema_digest: schemaDigest(helperSchema),
      smbos_schema_metrics: smbosMetrics,
      helper_schema_metrics: helperMetrics,
      difference_categories: [...differences],
    });
  } catch {
    return builderRecordSchemaCompatibilitySdkComparisonSchema.parse({
      schema_version: BUILDER_RECORD_SCHEMA_COMPATIBILITY_SCHEMA_VERSION,
      helper_generation_succeeded: false,
      smbos_schema_digest: smbosDigest,
      helper_schema_digest: null,
      smbos_schema_metrics: smbosMetrics,
      helper_schema_metrics: null,
      difference_categories: ["helper_generation_failed"],
    });
  }
}

function cloneRemovingKeywords(
  value: unknown,
  removed: ReadonlySet<string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneRemovingKeywords(item, removed));
  }
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !removed.has(key))
      .map(([key, item]) => [key, cloneRemovingKeywords(item, removed)]),
  );
}

function inlineLocalDefinitions(schema: JsonSchema): JsonSchema {
  const definitions = isPlainObject(schema.$defs) ? schema.$defs : null;
  if (!definitions) return schema;
  let safe = true;
  const expand = (value: unknown, stack: readonly string[]): unknown => {
    if (Array.isArray(value)) return value.map((item) => expand(item, stack));
    if (!isPlainObject(value)) return value;
    const reference = value.$ref;
    if (typeof reference === "string") {
      const match = /^#\/\$defs\/([^/]+)$/.exec(reference);
      const name = match?.[1] ? decodeURIComponent(match[1]) : null;
      const target = name ? definitions[name] : undefined;
      if (!name || target === undefined || stack.includes(name)) {
        safe = false;
        return value;
      }
      const expanded = expand(target, [...stack, name]);
      if (!isPlainObject(expanded)) {
        safe = false;
        return value;
      }
      const siblings = Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => key !== "$ref")
          .map(([key, item]) => [key, expand(item, stack)]),
      );
      return { ...expanded, ...siblings };
    }
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "$defs")
        .map(([key, item]) => [key, expand(item, stack)]),
    );
  };
  const result = expand(schema, []);
  return safe && isPlainObject(result) ? result : schema;
}

function keywordVariants(
  probe: CompatibilityProbe,
): readonly CompatibilityProbe[] {
  const variants: readonly [(typeof keywordVariantIds)[number], JsonSchema][] =
    [
      [
        "keyword_without_string_bounds",
        cloneRemovingKeywords(
          probe.registeredSchema,
          new Set(["minLength", "maxLength"]),
        ) as JsonSchema,
      ],
      [
        "keyword_without_patterns",
        cloneRemovingKeywords(
          probe.registeredSchema,
          new Set(["pattern"]),
        ) as JsonSchema,
      ],
      [
        "keyword_without_formats",
        cloneRemovingKeywords(
          probe.registeredSchema,
          new Set(["format"]),
        ) as JsonSchema,
      ],
      [
        "keyword_without_numeric_bounds",
        cloneRemovingKeywords(
          probe.registeredSchema,
          new Set([
            "minimum",
            "maximum",
            "exclusiveMinimum",
            "exclusiveMaximum",
          ]),
        ) as JsonSchema,
      ],
      [
        "keyword_without_array_bounds",
        cloneRemovingKeywords(
          probe.registeredSchema,
          new Set(["minItems", "maxItems"]),
        ) as JsonSchema,
      ],
      [
        "keyword_without_annotations",
        cloneRemovingKeywords(
          probe.registeredSchema,
          new Set(["title", "description"]),
        ) as JsonSchema,
      ],
      [
        "keyword_without_defs_refs",
        inlineLocalDefinitions(probe.registeredSchema),
      ],
    ];
  return Object.freeze(
    variants.map(([id, schema]) => createProbe(id, schema, probe.fieldTypes)),
  );
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

function estimatedCost(inputTokens: number, outputTokens: number): number {
  return calculateAiTokenCostMicrousd({
    inputTokens,
    outputTokens,
    inputMicrousdPerMillion:
      openAiBuilderRecordCreationIntentPolicy.inputMicrousdPerMillion,
    outputMicrousdPerMillion:
      openAiBuilderRecordCreationIntentPolicy.outputMicrousdPerMillion,
  });
}

function reportFor(
  probe: CompatibilityProbe,
  input: {
    accepted: boolean;
    resultClass: z.infer<
      typeof builderRecordSchemaCompatibilityResultClassSchema
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
  return builderRecordSchemaCompatibilityProbeReportSchema.parse({
    schema_version: BUILDER_RECORD_SCHEMA_COMPATIBILITY_SCHEMA_VERSION,
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

function isStructuralRejection(
  report: BuilderRecordSchemaCompatibilityProbeReport,
) {
  return (
    report.result_class === "schema_rejected" ||
    report.result_class === "local_schema_rejected"
  );
}

function fatalStopReason(
  report: BuilderRecordSchemaCompatibilityProbeReport,
):
  | z.infer<
      typeof builderRecordSchemaCompatibilityAggregateSchema
    >["stop_reason"]
  | null {
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
  dependencies: BuilderRecordSchemaCompatibilityDependencies,
  probe: CompatibilityProbe,
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
  }, BUILDER_RECORD_SCHEMA_COMPATIBILITY_TIMEOUT_MS);
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
    if (timedOut) {
      return reportFor(probe, {
        ...common,
        accepted: false,
        resultClass: "timeout",
      });
    }
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
    if (authentication) {
      return reportFor(probe, {
        ...common,
        accepted: false,
        resultClass: "authentication_failed",
      });
    }
    if (providerFailure?.kind === "rate_limited") {
      return reportFor(probe, {
        ...common,
        accepted: false,
        resultClass: "rate_limited",
      });
    }
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
    if (providerFailure?.kind === "incomplete") {
      return reportFor(probe, {
        ...common,
        accepted: true,
        resultClass: "accepted_incomplete",
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

function compatibilityIsActivated(
  environment: BuilderRecordSchemaCompatibilityEnvironment,
) {
  return (
    environment.RUN_LIVE_OPENAI_RECORD_CREATION_SCHEMA_COMPATIBILITY === "1" &&
    environment.AI_PROVIDER?.trim() === "openai" &&
    Boolean(environment.OPENAI_API_KEY?.trim())
  );
}

export function liveBuilderRecordSchemaCompatibilityIsActivated(
  environment: BuilderRecordSchemaCompatibilityEnvironment,
) {
  return compatibilityIsActivated(environment);
}

function preflightIsValid() {
  return (
    builderRecordSchemaCompatibilityBaseProbes.length === 20 &&
    builderRecordSchemaCompatibilityBaseProbes.every(
      (probe, index) =>
        probe.id === BUILDER_RECORD_SCHEMA_COMPATIBILITY_BASE_PROBE_IDS[index],
    ) &&
    keywordVariantIds.length === 7 &&
    BUILDER_RECORD_SCHEMA_COMPATIBILITY_MAX_PROBE_COUNT === 20 + 5 + 7 &&
    BUILDER_RECORD_SCHEMA_COMPATIBILITY_PER_PROBE_RESERVATION_MICROUSD ===
      estimatedCost(
        BUILDER_RECORD_SCHEMA_COMPATIBILITY_RESERVED_INPUT_TOKENS,
        BUILDER_RECORD_SCHEMA_COMPATIBILITY_MAX_OUTPUT_TOKENS,
      ) &&
    BUILDER_RECORD_SCHEMA_COMPATIBILITY_AGGREGATE_RESERVATION_MICROUSD ===
      BUILDER_RECORD_SCHEMA_COMPATIBILITY_MAX_PROBE_COUNT *
        BUILDER_RECORD_SCHEMA_COMPATIBILITY_PER_PROBE_RESERVATION_MICROUSD &&
    BUILDER_RECORD_SCHEMA_COMPATIBILITY_AGGREGATE_RESERVATION_MICROUSD <=
      BUILDER_RECORD_SCHEMA_COMPATIBILITY_HARD_CEILING_MICROUSD &&
    BUILDER_RECORD_SCHEMA_COMPATIBILITY_HARD_CEILING_MICROUSD < 4_183_040
  );
}

async function defaultDependencies(
  apiKey: string,
): Promise<BuilderRecordSchemaCompatibilityDependencies> {
  const provider = createOpenAiResponsesStructuredProvider(apiKey);
  return {
    execute: (probe, signal, ordinal) =>
      provider.generateStructured({
        providerKey: "openai",
        modelKey: OPENAI_BUILDER_RECORD_CREATION_INTENT_MODEL_KEY,
        instruction: "Return the smallest valid result.",
        input: Object.freeze({ request: "Return the smallest valid result." }),
        outputContract: Object.freeze({
          name: `record_schema_compat_${String(ordinal).padStart(2, "0")}`,
          version: 1,
          jsonSchema: probe.registeredSchema,
        }),
        maxOutputTokens: BUILDER_RECORD_SCHEMA_COMPATIBILITY_MAX_OUTPUT_TOKENS,
        signal,
      }),
    now: () => performance.now(),
    emit: (value) => console.log(JSON.stringify(value)),
  };
}

async function resolveDependencies(
  apiKey: string,
  overrides: BuilderRecordSchemaCompatibilityOverrides,
) {
  if (overrides.execute) {
    return {
      execute: overrides.execute,
      now: overrides.now ?? (() => performance.now()),
      emit:
        overrides.emit ??
        ((value: unknown) => console.log(JSON.stringify(value))),
    } satisfies BuilderRecordSchemaCompatibilityDependencies;
  }
  const loaded = await (overrides.loadDependencies ?? defaultDependencies)(
    apiKey,
  );
  return {
    execute: loaded.execute,
    now: overrides.now ?? loaded.now,
    emit: overrides.emit ?? loaded.emit,
  } satisfies BuilderRecordSchemaCompatibilityDependencies;
}

function familyFindings(
  reports: ReadonlyMap<string, BuilderRecordSchemaCompatibilityProbeReport>,
) {
  const family = (
    name: "text_like" | "primitive_business_value" | "option",
    cumulativeId: string,
    individualIds: readonly string[],
  ) => {
    const cumulative = reports.get(cumulativeId);
    const individuals = individualIds.map((id) => reports.get(id));
    let conclusion: z.infer<typeof familyFindingSchema>["conclusion"] =
      "inconclusive";
    if (cumulative?.accepted) conclusion = "accepted";
    else if (individuals.some((report) => report && !report.accepted)) {
      conclusion = "individual_branch_rejected";
    } else if (
      cumulative &&
      isStructuralRejection(cumulative) &&
      individuals.every((report) => report?.accepted)
    ) {
      conclusion = "combination_or_union_size_rejected";
    }
    return familyFindingSchema.parse({ family: name, conclusion });
  };
  return [
    family("text_like", "d_text_like_cumulative", [
      "c_short_text",
      "d_long_text",
      "d_email",
      "d_phone",
      "d_url",
    ]),
    family("primitive_business_value", "e_primitive_cumulative", [
      "e_number",
      "e_currency",
      "e_boolean",
      "e_date",
      "e_datetime",
    ]),
    family("option", "f_option_cumulative", [
      "f_select",
      "f_status",
      "f_multi_select",
    ]),
  ];
}

export async function runLiveBuilderRecordSchemaCompatibility(
  environment: BuilderRecordSchemaCompatibilityEnvironment,
  overrides: BuilderRecordSchemaCompatibilityOverrides = {},
) {
  if (!compatibilityIsActivated(environment)) {
    return Object.freeze({
      ran: false,
      passed: false,
      reports: Object.freeze([]),
    });
  }
  if (!preflightIsValid()) {
    throw new Error("The Record schema compatibility preflight failed.");
  }
  const apiKey = environment.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return Object.freeze({
      ran: false,
      passed: false,
      reports: Object.freeze([]),
    });
  }

  const comparison = compareBuilderRecordSchemaWithInstalledOpenAiHelper();
  const dependencies = await resolveDependencies(apiKey, overrides);
  dependencies.emit(comparison);

  const reports: BuilderRecordSchemaCompatibilityProbeReport[] = [];
  const reportsById = new Map<
    string,
    BuilderRecordSchemaCompatibilityProbeReport
  >();
  const probesById = new Map<string, CompatibilityProbe>(
    builderRecordSchemaCompatibilityBaseProbes.map((probe) => [
      probe.id,
      probe,
    ]),
  );
  let stopReason: z.infer<
    typeof builderRecordSchemaCompatibilityAggregateSchema
  >["stop_reason"] = "completed";

  const totalCost = () =>
    reports.reduce((total, report) => total + report.estimated_microusd, 0);

  const run = async (probe: CompatibilityProbe) => {
    if (reports.length >= BUILDER_RECORD_SCHEMA_COMPATIBILITY_MAX_PROBE_COUNT) {
      stopReason = "probe_limit_reached";
      return null;
    }
    if (
      (reports.length + 1) *
        BUILDER_RECORD_SCHEMA_COMPATIBILITY_PER_PROBE_RESERVATION_MICROUSD >
      BUILDER_RECORD_SCHEMA_COMPATIBILITY_HARD_CEILING_MICROUSD
    ) {
      stopReason = "probe_limit_reached";
      return null;
    }
    probesById.set(probe.id, probe);
    const report = await executeProbe(dependencies, probe, reports.length + 1);
    reports.push(report);
    reportsById.set(report.probe_id, report);
    dependencies.emit(report);
    const fatal = fatalStopReason(report);
    if (fatal) stopReason = fatal;
    if (
      stopReason === "completed" &&
      totalCost() > BUILDER_RECORD_SCHEMA_COMPATIBILITY_HARD_CEILING_MICROUSD
    ) {
      stopReason = "cost_ceiling_exceeded";
    }
    return report;
  };

  for (const probe of builderRecordSchemaCompatibilityBaseProbes) {
    await run(probe);
    if (stopReason !== "completed") break;
  }

  let unionIsolation: z.infer<typeof unionIsolationSchema> | null = null;
  const completeUnion = reportsById.get("g_complete_field_union");
  const individualIds = [
    "c_short_text",
    "d_long_text",
    "d_email",
    "d_phone",
    "d_url",
    "e_number",
    "e_currency",
    "e_boolean",
    "e_date",
    "e_datetime",
    "f_select",
    "f_status",
    "f_multi_select",
  ];
  if (
    stopReason === "completed" &&
    completeUnion &&
    isStructuralRejection(completeUnion) &&
    individualIds.every((id) => reportsById.get(id)?.accepted)
  ) {
    let low = 2;
    let high: number = fieldTypes.length;
    let probesUsed = 0;
    while (low < high && probesUsed < 4 && stopReason === "completed") {
      const middle = Math.floor((low + high) / 2);
      const selected = fieldTypes.slice(0, middle);
      const report = await run(
        zodProbe(
          `adaptive_union_prefix_${middle}`,
          readyProbeSchema(selected),
          selected,
        ),
      );
      probesUsed += 1;
      if (!report || fatalStopReason(report)) break;
      if (isStructuralRejection(report)) high = middle;
      else if (report.accepted) low = middle + 1;
      else break;
    }
    let specific: boolean | null = null;
    let outcome: z.infer<typeof unionIsolationSchema>["outcome"] =
      "inconclusive";
    if (low === high && stopReason === "completed") {
      const rotated = [...fieldTypes.slice(1), fieldTypes[0]].slice(
        0,
        low,
      ) as FieldType[];
      const alternate = await run(
        zodProbe(
          `adaptive_union_alternate_${low}`,
          readyProbeSchema(rotated),
          rotated,
        ),
      );
      probesUsed += 1;
      if (alternate?.accepted) {
        specific = true;
        outcome = "specific_combination_or_order";
      } else if (alternate && isStructuralRejection(alternate)) {
        specific = false;
        outcome = "branch_count";
      }
    }
    unionIsolation = unionIsolationSchema.parse({
      outcome,
      smallest_failing_branch_count: low === high ? low : null,
      specific_branch_combination_required: specific,
      probes_used: probesUsed,
    });
  }

  let exactIsolation: z.infer<typeof exactIsolationSchema> = {
    outcome: "not_required",
    outer_wrapper_baseline_accepted:
      reportsById.get("a_transport_baseline")?.accepted ?? false,
    probes_used: 0,
  };
  const exact = reportsById.get("h_exact_full_record_schema");
  if (
    stopReason === "completed" &&
    completeUnion?.accepted &&
    exact &&
    isStructuralRejection(exact)
  ) {
    const isolationReports: BuilderRecordSchemaCompatibilityProbeReport[] = [];
    const candidates = [
      zodProbe("adaptive_exact_clarification_only", clarificationProbeSchema()),
      zodProbe(
        "adaptive_exact_source_refs_relaxed",
        composedProbeSchema(fieldTypes, true),
        fieldTypes,
      ),
      createProbe(
        "adaptive_exact_without_annotations",
        cloneRemovingKeywords(
          registeredSchema(builderRecordCreationIntentOutputSchema),
          new Set(["title", "description"]),
        ) as JsonSchema,
        fieldTypes,
      ),
      zodProbe(
        "adaptive_exact_rebuilt_composition",
        composedProbeSchema(fieldTypes),
        fieldTypes,
      ),
    ];
    for (const candidate of candidates) {
      const result = await run(candidate);
      if (result) isolationReports.push(result);
      if (stopReason !== "completed") break;
    }
    const byId = new Map(
      isolationReports.map((report) => [report.probe_id, report]),
    );
    let outcome: z.infer<typeof exactIsolationSchema>["outcome"] =
      "remaining_exact_schema_difference";
    if (stopReason !== "completed") outcome = "inconclusive";
    else if (
      isStructuralRejection(byId.get("adaptive_exact_clarification_only")!)
    ) {
      outcome = "clarification_branch";
    } else if (byId.get("adaptive_exact_source_refs_relaxed")?.accepted) {
      outcome = "source_step_constraints";
    } else if (byId.get("adaptive_exact_without_annotations")?.accepted) {
      outcome = "annotations";
    } else if (byId.get("adaptive_exact_rebuilt_composition")?.accepted) {
      outcome = "registered_schema_difference";
    }
    exactIsolation = exactIsolationSchema.parse({
      outcome,
      outer_wrapper_baseline_accepted:
        reportsById.get("a_transport_baseline")?.accepted ?? false,
      probes_used: isolationReports.length,
    });
  }

  const firstStructuralFailure = reports.find(isStructuralRejection);
  if (stopReason === "completed" && firstStructuralFailure) {
    const sourceProbe = probesById.get(firstStructuralFailure.probe_id);
    if (sourceProbe) {
      for (const variant of keywordVariants(sourceProbe)) {
        await run(variant);
        if (stopReason !== "completed") break;
      }
    }
  }

  const aggregate = builderRecordSchemaCompatibilityAggregateSchema.parse({
    schema_version: BUILDER_RECORD_SCHEMA_COMPATIBILITY_SCHEMA_VERSION,
    gate: "record_schema_compatibility",
    model_key: OPENAI_BUILDER_RECORD_CREATION_INTENT_MODEL_KEY,
    reasoning_effort: OPENAI_BUILDER_RECORD_CREATION_INTENT_REASONING_EFFORT,
    max_probe_count: BUILDER_RECORD_SCHEMA_COMPATIBILITY_MAX_PROBE_COUNT,
    per_probe_reserved_microusd:
      BUILDER_RECORD_SCHEMA_COMPATIBILITY_PER_PROBE_RESERVATION_MICROUSD,
    aggregate_reserved_microusd:
      BUILDER_RECORD_SCHEMA_COMPATIBILITY_AGGREGATE_RESERVATION_MICROUSD,
    aggregate_hard_ceiling_microusd:
      BUILDER_RECORD_SCHEMA_COMPATIBILITY_HARD_CEILING_MICROUSD,
    probes_executed: reports.length,
    accepted_probes: reports.filter((report) => report.accepted).length,
    rejected_probes: reports.filter((report) => !report.accepted).length,
    total_attempts: reports.reduce(
      (total, report) => total + report.attempts,
      0,
    ),
    usage_complete: reports.every(
      (report) => report.usage_complete || isStructuralRejection(report),
    ),
    total_input_tokens: reports.reduce(
      (total, report) => total + report.input_tokens,
      0,
    ),
    total_output_tokens: reports.reduce(
      (total, report) => total + report.output_tokens,
      0,
    ),
    total_estimated_microusd: totalCost(),
    total_elapsed_ms: reports.reduce(
      (total, report) => total + report.elapsed_ms,
      0,
    ),
    stop_reason: stopReason,
    exact_schema_accepted:
      reportsById.get("h_exact_full_record_schema")?.accepted ?? false,
    first_structural_failure_probe_id: firstStructuralFailure?.probe_id ?? null,
    family_findings: familyFindings(reportsById),
    union_isolation: unionIsolation,
    exact_isolation: exactIsolation,
  });
  dependencies.emit(aggregate);

  return Object.freeze({
    ran: true,
    passed: aggregate.exact_schema_accepted && stopReason === "completed",
    reports: Object.freeze([...reports]),
    comparison,
    aggregate,
  });
}
