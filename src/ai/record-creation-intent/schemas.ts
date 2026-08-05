import { z } from "zod";

import {
  aiBusinessModelContextV1Schema,
  type AiBusinessModelContextV1,
} from "../context/schemas";
import {
  builderPlanOutputSchema,
  builderPlanTaskInputSchema,
} from "../planning/schemas";
import { graphKeySchema } from "../../core/graph/schemas";
import { recordCreationUrlValueSchema } from "../../core/graph/record-creation/schemas";

export const BUILDER_RECORD_CREATION_INTENT_SCHEMA_VERSION = 1 as const;
export const BUILDER_RECORD_CREATION_INTENT_MAX_OUTPUT_BYTES = 64 * 1024;

const ownerReadableTextSchema = z.string().trim().min(1).max(2_000);
const sourceStepReferencesSchema = z
  .array(
    z
      .string()
      .max(80)
      .regex(/^step_[1-9][0-9]*$/),
  )
  .length(1)
  .superRefine((references, context) => {
    if (new Set(references).size !== references.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The Record intent source step must be unique.",
      });
    }
  });

export const builderRecordCreationIntentTaskInputSchema = z
  .object({
    schema_version: z.literal(BUILDER_RECORD_CREATION_INTENT_SCHEMA_VERSION),
    owner_request: builderPlanTaskInputSchema.shape.owner_request,
    business_context: aiBusinessModelContextV1Schema,
    ready_plan: builderPlanOutputSchema,
  })
  .strict();

const stringValueSchema = z.string().min(1).max(5_000);
const dateValueSchema = z
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
const datetimeValueSchema = z
  .string()
  .max(80)
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/,
  )
  .refine((value) => !Number.isNaN(Date.parse(value)), "Datetime is invalid.");

const textLikeFieldValueSchema = z.discriminatedUnion("field_type", [
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
      string_value: z.string().trim().email().max(320),
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
]);

const numericFieldValueSchema = z.discriminatedUnion("field_type", [
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
]);

const dateTimeFieldValueSchema = z.discriminatedUnion("field_type", [
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
      date_value: dateValueSchema,
    })
    .strict(),
  z
    .object({
      field_key: graphKeySchema,
      field_type: z.literal("datetime"),
      datetime_value: datetimeValueSchema,
    })
    .strict(),
]);

const optionFieldValueSchema = z.discriminatedUnion("field_type", [
  z
    .object({
      field_key: graphKeySchema,
      field_type: z.literal("select"),
      option_value: stringValueSchema.max(500),
    })
    .strict(),
  z
    .object({
      field_key: graphKeySchema,
      field_type: z.literal("status"),
      option_value: stringValueSchema.max(500),
    })
    .strict(),
  z
    .object({
      field_key: graphKeySchema,
      field_type: z.literal("multi_select"),
      option_values: z.array(stringValueSchema.max(500)).min(1).max(100),
    })
    .strict(),
]);

export const builderRecordCreationFieldValueSchema = z.discriminatedUnion(
  "field_type",
  [
    ...textLikeFieldValueSchema.options,
    ...numericFieldValueSchema.options,
    ...dateTimeFieldValueSchema.options,
    ...optionFieldValueSchema.options,
  ],
);

const readySchema = z
  .object({
    schema_version: z.literal(BUILDER_RECORD_CREATION_INTENT_SCHEMA_VERSION),
    state: z.literal("ready"),
    summary: ownerReadableTextSchema,
    source_step_references: sourceStepReferencesSchema,
    object_key: graphKeySchema,
    field_values: z.array(builderRecordCreationFieldValueSchema).min(1).max(50),
  })
  .strict()
  .superRefine((value, context) => {
    const keys = value.field_values.map((field) => field.field_key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["field_values"],
        message: "Field values must be unique by field key.",
      });
    }
  });

const clarificationSchema = z
  .object({
    schema_version: z.literal(BUILDER_RECORD_CREATION_INTENT_SCHEMA_VERSION),
    state: z.literal("needs_clarification"),
    understanding: ownerReadableTextSchema,
    question: ownerReadableTextSchema,
    reason: ownerReadableTextSchema,
    source_step_references: sourceStepReferencesSchema,
  })
  .strict();

export const builderRecordCreationIntentOutputSchema = z.discriminatedUnion(
  "state",
  [readySchema, clarificationSchema],
);

export type BuilderRecordCreationIntentTaskInput = z.infer<
  typeof builderRecordCreationIntentTaskInputSchema
>;
export type BuilderRecordCreationIntentOutput = z.infer<
  typeof builderRecordCreationIntentOutputSchema
>;
export type BuilderRecordCreationIntentReady = z.infer<typeof readySchema>;
export type BuilderRecordCreationFieldValue = z.infer<
  typeof builderRecordCreationFieldValueSchema
>;
export type { AiBusinessModelContextV1 };
