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
  recordUpdateSelectorSchema,
  type RecordUpdateSelector,
} from "../../core/graph/record-update/schemas";

export const BUILDER_RECORD_LOCATION_LINK_INTENT_SCHEMA_VERSION = 1 as const;
export const BUILDER_RECORD_LOCATION_LINK_INTENT_MAX_OUTPUT_BYTES = 16 * 1024;

const ownerReadableTextSchema = z.string().trim().min(1).max(2_000);
const sourceStepReferenceSchema = z
  .string()
  .max(80)
  .regex(/^step_[1-9][0-9]*$/);

export const builderRecordLocationLinkIntentTaskInputSchema = z
  .object({
    schema_version: z.literal(
      BUILDER_RECORD_LOCATION_LINK_INTENT_SCHEMA_VERSION,
    ),
    owner_request: builderPlanTaskInputSchema.shape.owner_request,
    business_context: aiBusinessModelContextV1Schema,
    ready_plan: builderPlanOutputSchema,
  })
  .strict();

const readySchema = z
  .object({
    schema_version: z.literal(
      BUILDER_RECORD_LOCATION_LINK_INTENT_SCHEMA_VERSION,
    ),
    state: z.literal("ready"),
    summary: ownerReadableTextSchema,
    source_step_reference: sourceStepReferenceSchema,
    action: z.enum(["link", "unlink"]),
    object_key: graphKeySchema,
    selector: recordUpdateSelectorSchema,
    location_reference: z.uuid(),
  })
  .strict();

const clarificationSchema = z
  .object({
    schema_version: z.literal(
      BUILDER_RECORD_LOCATION_LINK_INTENT_SCHEMA_VERSION,
    ),
    state: z.literal("needs_clarification"),
    understanding: ownerReadableTextSchema,
    question: ownerReadableTextSchema,
    reason: ownerReadableTextSchema,
    source_step_reference: sourceStepReferenceSchema,
  })
  .strict();

export const builderRecordLocationLinkIntentOutputSchema = z.discriminatedUnion(
  "state",
  [readySchema, clarificationSchema],
);

export type BuilderRecordLocationLinkIntentTaskInput = z.infer<
  typeof builderRecordLocationLinkIntentTaskInputSchema
>;
export type BuilderRecordLocationLinkIntentOutput = z.infer<
  typeof builderRecordLocationLinkIntentOutputSchema
>;
export type BuilderRecordLocationLinkIntentReady = z.infer<typeof readySchema>;
export type { AiBusinessModelContextV1, RecordUpdateSelector };
