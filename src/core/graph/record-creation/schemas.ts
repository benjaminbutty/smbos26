import { z } from "zod";

import type { Json } from "../../../db/supabase/database.types";
import {
  graphFieldTypeSchema,
  graphKeySchema,
  jsonObjectSchema,
  jsonValueSchema,
} from "../schemas";

export const RECORD_CREATION_STATE_SCHEMA_VERSION = 1 as const;

const strictRecordCreationEmailValueSchema = z.string().email();

export const recordCreationEmailValueSchema = z
  .string()
  .min(1)
  .max(320)
  .superRefine((value, context) => {
    if (!strictRecordCreationEmailValueSchema.safeParse(value).success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Email must be valid.",
      });
    }
  });

export const recordCreationUrlValueSchema = z
  .string()
  .min(1)
  .max(2_048)
  .regex(/^https?:\/\//i, "URL must use http or https.")
  .superRefine((value, context) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "URL must be syntactically valid.",
      });
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "URL must use http or https.",
      });
    }
  });

export const recordCreationEligibilityReasonSchema = z.enum([
  "inactive_object",
  "required_relationship_target",
  "preorder_order_object",
  "preorder_order_item_object",
  "required_file_without_default",
  "no_writable_fields",
]);

export const recordCreationEligibilitySchema = z
  .object({
    eligible: z.boolean(),
    reason_codes: z.array(recordCreationEligibilityReasonSchema).max(10),
  })
  .strict();

export const recordCreationFieldSchema = z
  .object({
    key: graphKeySchema,
    label: z.string().trim().min(1).max(120),
    field_type: graphFieldTypeSchema,
    required: z.boolean(),
    default_value: jsonValueSchema.nullable(),
    settings_json: jsonObjectSchema,
    position: z.number().int().nonnegative(),
    is_active: z.boolean(),
  })
  .strict();

export const recordCreationViewSchema = z
  .object({
    key: graphKeySchema,
    name: z.string().trim().min(1).max(120),
    view_type: z.enum(["table", "list", "cards", "detail"]),
    object_key: graphKeySchema,
  })
  .strict();

export const recordCreationStateSchema = z
  .object({
    schema_version: z.literal(RECORD_CREATION_STATE_SCHEMA_VERSION),
    business_id: z.uuid(),
    actor_id: z.uuid(),
    base_version_id: z.uuid(),
    head_revision: z.number().int().positive(),
    object_definition_id: z.uuid(),
    object_key: graphKeySchema,
    singular_label: z.string().trim().min(1).max(120),
    plural_label: z.string().trim().min(1).max(120),
    is_active: z.boolean(),
    eligibility: recordCreationEligibilitySchema,
    object_schema_digest: z.string().regex(/^[a-f0-9]{64}$/),
    record_state_digest: z.string().regex(/^[a-f0-9]{64}$/),
    fields: z.array(recordCreationFieldSchema).max(100),
    internal_views: z.array(recordCreationViewSchema).max(100),
  })
  .strict();

export const recordCreationTextFieldValueSchema = z.discriminatedUnion(
  "field_type",
  [
    z
      .object({
        field_key: graphKeySchema,
        field_type: z.literal("short_text"),
        string_value: z.string().trim().min(1).max(500),
      })
      .strict(),
    z
      .object({
        field_key: graphKeySchema,
        field_type: z.literal("long_text"),
        string_value: z.string().trim().min(1).max(5_000),
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
        string_value: z.string().trim().min(1).max(120),
      })
      .strict(),
    z
      .object({
        field_key: graphKeySchema,
        field_type: z.literal("url"),
        string_value: recordCreationUrlValueSchema,
      })
      .strict(),
  ],
);

export const recordCreationNumericFieldValueSchema = z.discriminatedUnion(
  "field_type",
  [
    z
      .object({
        field_key: graphKeySchema,
        field_type: z.literal("number"),
        number_value: z
          .number()
          .finite()
          .min(-1_000_000_000_000)
          .max(1_000_000_000_000),
      })
      .strict(),
    z
      .object({
        field_key: graphKeySchema,
        field_type: z.literal("currency"),
        number_value: z
          .number()
          .finite()
          .min(-1_000_000_000_000)
          .max(1_000_000_000_000),
      })
      .strict(),
  ],
);

export const recordCreationDateTimeFieldValueSchema = z.discriminatedUnion(
  "field_type",
  [
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
        date_value: z
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
          }, "Date must be a valid calendar date."),
      })
      .strict(),
    z
      .object({
        field_key: graphKeySchema,
        field_type: z.literal("datetime"),
        datetime_value: z
          .string()
          .max(80)
          .regex(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/,
          )
          .refine(
            (value) => !Number.isNaN(Date.parse(value)),
            "Datetime is invalid.",
          ),
      })
      .strict(),
  ],
);

export const recordCreationOptionFieldValueSchema = z.discriminatedUnion(
  "field_type",
  [
    z
      .object({
        field_key: graphKeySchema,
        field_type: z.literal("select"),
        option_value: z.string().trim().min(1).max(500),
      })
      .strict(),
    z
      .object({
        field_key: graphKeySchema,
        field_type: z.literal("status"),
        option_value: z.string().trim().min(1).max(500),
      })
      .strict(),
    z
      .object({
        field_key: graphKeySchema,
        field_type: z.literal("multi_select"),
        option_values: z
          .array(z.string().trim().min(1).max(500))
          .min(1)
          .max(100),
      })
      .strict(),
  ],
);

export const recordCreationFieldValueSchema = z.discriminatedUnion(
  "field_type",
  [
    ...recordCreationTextFieldValueSchema.options,
    ...recordCreationNumericFieldValueSchema.options,
    ...recordCreationDateTimeFieldValueSchema.options,
    ...recordCreationOptionFieldValueSchema.options,
  ],
);

export type RecordCreationState = z.infer<typeof recordCreationStateSchema>;
export type RecordCreationField = z.infer<typeof recordCreationFieldSchema>;
export type RecordCreationView = z.infer<typeof recordCreationViewSchema>;
export type RecordCreationFieldValue = z.infer<
  typeof recordCreationFieldValueSchema
>;

export interface RecordCreationData {
  readonly requestedData: Record<string, Json>;
  readonly fieldValues: readonly RecordCreationFieldValue[];
}
