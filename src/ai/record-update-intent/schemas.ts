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
import {
  recordCreationFieldValueSchema,
  type RecordCreationFieldValue,
} from "../../core/graph/record-creation/schemas";
import {
  recordUpdateSelectorClausesSchema,
  type RecordUpdateSelectorClause,
} from "../../core/graph/record-update/schemas";

export const BUILDER_RECORD_UPDATE_INTENT_SCHEMA_VERSION = 1 as const;
export const BUILDER_RECORD_UPDATE_INTENT_MAX_OUTPUT_BYTES = 64 * 1024;

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
        message: "The Record update intent source step must be unique.",
      });
    }
  });

export const builderRecordUpdateIntentTaskInputSchema = z
  .object({
    schema_version: z.literal(BUILDER_RECORD_UPDATE_INTENT_SCHEMA_VERSION),
    owner_request: builderPlanTaskInputSchema.shape.owner_request,
    business_context: aiBusinessModelContextV1Schema,
    ready_plan: builderPlanOutputSchema,
  })
  .strict();

const readySchema = z
  .object({
    schema_version: z.literal(BUILDER_RECORD_UPDATE_INTENT_SCHEMA_VERSION),
    state: z.literal("ready"),
    summary: ownerReadableTextSchema,
    source_step_references: sourceStepReferencesSchema,
    object_key: graphKeySchema,
    selector_clauses: recordUpdateSelectorClausesSchema,
    field_updates: z.array(recordCreationFieldValueSchema).min(1).max(5),
  })
  .strict()
  .superRefine((value, context) => {
    const updateKeys = value.field_updates.map((field) => field.field_key);
    if (new Set(updateKeys).size !== updateKeys.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["field_updates"],
        message: "Update Field keys must be unique.",
      });
    }
  });

const clarificationSchema = z
  .object({
    schema_version: z.literal(BUILDER_RECORD_UPDATE_INTENT_SCHEMA_VERSION),
    state: z.literal("needs_clarification"),
    understanding: ownerReadableTextSchema,
    question: ownerReadableTextSchema,
    reason: ownerReadableTextSchema,
    source_step_references: sourceStepReferencesSchema,
  })
  .strict();

export const builderRecordUpdateIntentOutputSchema = z.discriminatedUnion(
  "state",
  [readySchema, clarificationSchema],
);

export type BuilderRecordUpdateIntentTaskInput = z.infer<
  typeof builderRecordUpdateIntentTaskInputSchema
>;
export type BuilderRecordUpdateIntentOutput = z.infer<
  typeof builderRecordUpdateIntentOutputSchema
>;
export type BuilderRecordUpdateIntentReady = z.infer<typeof readySchema>;
export type BuilderRecordUpdateFieldValue = RecordCreationFieldValue;
export type { AiBusinessModelContextV1, RecordUpdateSelectorClause };
