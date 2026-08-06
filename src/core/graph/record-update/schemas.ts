import { z } from "zod";

import type { Json } from "../../../db/supabase/database.types";
import {
  graphFieldTypeSchema,
  graphKeySchema,
  jsonObjectSchema,
  jsonValueSchema,
} from "../schemas";
import {
  recordCreationEmailValueSchema,
  recordCreationFieldValueSchema,
  recordCreationUrlValueSchema,
} from "../record-creation/schemas";

export const RECORD_UPDATE_SCHEMA_VERSION = 1 as const;

const selectorTextValueSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (value) => value.normalize("NFKC").trim().length > 0,
    "Selector text must not be blank.",
  );

const selectorPhoneValueSchema = z
  .string()
  .min(1)
  .max(120)
  .refine(
    (value) => value === value.trim(),
    "Selector phone cannot be padded.",
  );

const selectorNumberValueSchema = z
  .number()
  .finite()
  .min(-1_000_000_000_000)
  .max(1_000_000_000_000);

const selectorDateValueSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year!, month! - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month! - 1 &&
      date.getUTCDate() === day
    );
  }, "Date must be a valid calendar date.");

const selectorDatetimeValueSchema = z
  .string()
  .max(80)
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/,
  )
  .refine((value) => !Number.isNaN(Date.parse(value)), "Datetime is invalid.");

const selectorOptionValueSchema = z.string().min(1).max(500);

export const recordUpdateSelectorClauseSchema = z.discriminatedUnion(
  "field_type",
  [
    z
      .object({
        field_key: graphKeySchema,
        field_type: z.literal("short_text"),
        string_value: selectorTextValueSchema,
      })
      .strict(),
    z
      .object({
        field_key: graphKeySchema,
        field_type: z.literal("email"),
        string_value: recordCreationEmailValueSchema,
      })
      .strict(),
    z
      .object({
        field_key: graphKeySchema,
        field_type: z.literal("phone"),
        string_value: selectorPhoneValueSchema,
      })
      .strict(),
    z
      .object({
        field_key: graphKeySchema,
        field_type: z.literal("url"),
        string_value: recordCreationUrlValueSchema,
      })
      .strict(),
    z
      .object({
        field_key: graphKeySchema,
        field_type: z.literal("number"),
        number_value: selectorNumberValueSchema,
      })
      .strict(),
    z
      .object({
        field_key: graphKeySchema,
        field_type: z.literal("currency"),
        number_value: selectorNumberValueSchema,
      })
      .strict(),
    z
      .object({
        field_key: graphKeySchema,
        field_type: z.literal("boolean"),
        boolean_value: z.boolean(),
      })
      .strict(),
    z
      .object({
        field_key: graphKeySchema,
        field_type: z.literal("date"),
        date_value: selectorDateValueSchema,
      })
      .strict(),
    z
      .object({
        field_key: graphKeySchema,
        field_type: z.literal("datetime"),
        datetime_value: selectorDatetimeValueSchema,
      })
      .strict(),
    z
      .object({
        field_key: graphKeySchema,
        field_type: z.literal("select"),
        option_value: selectorOptionValueSchema,
      })
      .strict(),
    z
      .object({
        field_key: graphKeySchema,
        field_type: z.literal("status"),
        option_value: selectorOptionValueSchema,
      })
      .strict(),
  ],
);

export const recordUpdateSelectorClausesSchema = z
  .array(recordUpdateSelectorClauseSchema)
  .min(1)
  .max(3)
  .superRefine((clauses, context) => {
    if (
      new Set(clauses.map((clause) => clause.field_key)).size !== clauses.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Selector Field keys must be unique.",
      });
    }
  });

export const recordUpdateCanonicalSelectorSchema = z
  .object({
    schema_version: z.literal(RECORD_UPDATE_SCHEMA_VERSION),
    object_definition_id: z.uuid(),
    clauses: recordUpdateSelectorClausesSchema,
  })
  .strict();

export const recordUpdateFieldSchema = z
  .object({
    key: graphKeySchema,
    label: z.string().trim().min(1).max(120),
    field_type: graphFieldTypeSchema,
    required: z.boolean(),
    settings_json: jsonObjectSchema,
    position: z.number().int().nonnegative(),
    is_active: z.boolean(),
  })
  .strict();

export const recordUpdateCurrentValueSchema = z
  .object({
    field_key: graphKeySchema,
    field_type: graphFieldTypeSchema,
    value: jsonValueSchema,
  })
  .strict();

export const recordUpdateSelectorCurrentValueSchema = z
  .object({
    field_key: graphKeySchema,
    field_type: graphFieldTypeSchema,
    label: z.string().trim().min(1).max(120),
    settings_json: jsonObjectSchema,
    value: jsonValueSchema,
  })
  .strict();

export const recordUpdateViewSchema = z
  .object({
    key: graphKeySchema,
    name: z.string().trim().min(1).max(120),
    view_type: z.enum(["table", "list", "cards"]),
    object_key: graphKeySchema,
  })
  .strict();

export const recordUpdateEligibilityReasonSchema = z.enum([
  "inactive_object",
  "preorder_customer_object",
  "preorder_order_object",
  "preorder_order_item_object",
  "no_selector_fields",
  "no_update_fields",
]);

const recordUpdateNotFoundStateSchema = z
  .object({
    schema_version: z.literal(RECORD_UPDATE_SCHEMA_VERSION),
    state: z.literal("not_found"),
    object_key: graphKeySchema,
    singular_label: z.string().trim().min(1).max(120),
  })
  .strict();

const recordUpdateAmbiguousStateSchema = z
  .object({
    schema_version: z.literal(RECORD_UPDATE_SCHEMA_VERSION),
    state: z.literal("ambiguous"),
    object_key: graphKeySchema,
    singular_label: z.string().trim().min(1).max(120),
    match_count_class: z.literal("2_or_more"),
  })
  .strict();

const recordUpdateIneligibleStateSchema = z
  .object({
    schema_version: z.literal(RECORD_UPDATE_SCHEMA_VERSION),
    state: z.literal("ineligible"),
    object_key: graphKeySchema,
    singular_label: z.string().trim().min(1).max(120),
    reason_codes: z.array(recordUpdateEligibilityReasonSchema).max(10),
  })
  .strict();

const recordUpdateReadyStateSchema = z
  .object({
    schema_version: z.literal(RECORD_UPDATE_SCHEMA_VERSION),
    state: z.literal("ready"),
    business_id: z.uuid(),
    actor_id: z.uuid(),
    base_version_id: z.uuid(),
    head_revision: z.number().int().positive(),
    object_definition_id: z.uuid(),
    object_key: graphKeySchema,
    singular_label: z.string().trim().min(1).max(120),
    object_schema_digest: z.string().regex(/^[a-f0-9]{64}$/),
    canonical_selector: recordUpdateCanonicalSelectorSchema,
    selector_digest: z.string().regex(/^[a-f0-9]{64}$/),
    target_record_id: z.uuid(),
    target_record_digest: z.string().regex(/^[a-f0-9]{64}$/),
    selector_current_values: z
      .array(recordUpdateSelectorCurrentValueSchema)
      .max(3),
    update_fields: z.array(recordUpdateFieldSchema).min(1).max(5),
    current_update_values: z.array(recordUpdateCurrentValueSchema).max(5),
    internal_views: z.array(recordUpdateViewSchema).max(100),
  })
  .strict();

export const recordUpdateTargetStateSchema = z.discriminatedUnion("state", [
  recordUpdateNotFoundStateSchema,
  recordUpdateAmbiguousStateSchema,
  recordUpdateIneligibleStateSchema,
  recordUpdateReadyStateSchema,
]);

export const recordUpdateFieldValueSchema = recordCreationFieldValueSchema;

export type RecordUpdateSelectorClause = z.infer<
  typeof recordUpdateSelectorClauseSchema
>;
export type RecordUpdateCanonicalSelector = z.infer<
  typeof recordUpdateCanonicalSelectorSchema
>;
export type RecordUpdateField = z.infer<typeof recordUpdateFieldSchema>;
export type RecordUpdateCurrentValue = z.infer<
  typeof recordUpdateCurrentValueSchema
>;
export type RecordUpdateSelectorCurrentValue = z.infer<
  typeof recordUpdateSelectorCurrentValueSchema
>;
export type RecordUpdateTargetState = z.infer<
  typeof recordUpdateTargetStateSchema
>;
export type RecordUpdateReadyState = Extract<
  RecordUpdateTargetState,
  { state: "ready" }
>;
export type RecordUpdateFieldValue = z.infer<
  typeof recordUpdateFieldValueSchema
>;

export type RecordUpdateDataPatch = Record<string, Json>;
