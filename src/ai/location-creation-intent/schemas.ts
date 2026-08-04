import { z } from "zod";

import {
  aiBusinessModelContextV1Schema,
  type AiBusinessModelContextV1,
} from "../context/schemas";
import {
  builderPlanOutputSchema,
  builderPlanTaskInputSchema,
} from "../planning/schemas";

export const BUILDER_LOCATION_CREATION_INTENT_SCHEMA_VERSION = 1 as const;
export const BUILDER_LOCATION_CREATION_INTENT_MAX_OUTPUT_BYTES = 16 * 1024;

const ownerReadableTextSchema = z.string().trim().min(1).max(2_000);
const stepReferenceSchema = z
  .string()
  .max(80)
  .regex(/^step_[1-9][0-9]*$/);
const exactTimezoneSchema = z.string().trim().min(1).max(80);
const timezoneIntentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("use_business_timezone"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("explicit_timezone"),
      timezone: exactTimezoneSchema,
    })
    .strict(),
]);

export const builderLocationCreationIntentTaskInputSchema = z
  .object({
    schema_version: z.literal(BUILDER_LOCATION_CREATION_INTENT_SCHEMA_VERSION),
    owner_request: builderPlanTaskInputSchema.shape.owner_request,
    business_context: aiBusinessModelContextV1Schema,
    ready_plan: builderPlanOutputSchema,
  })
  .strict();

const sourceStepReferencesSchema = z
  .array(stepReferenceSchema)
  .length(1)
  .superRefine((references, context) => {
    if (new Set(references).size !== references.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The Location intent source step must be unique.",
      });
    }
  });

export const builderLocationCreationIntentReadySchema = z
  .object({
    schema_version: z.literal(BUILDER_LOCATION_CREATION_INTENT_SCHEMA_VERSION),
    state: z.literal("ready"),
    summary: ownerReadableTextSchema,
    location_name: z.string().trim().min(1).max(120),
    timezone_intent: timezoneIntentSchema,
    source_step_references: sourceStepReferencesSchema,
  })
  .strict();

export const builderLocationCreationIntentClarificationSchema = z
  .object({
    schema_version: z.literal(BUILDER_LOCATION_CREATION_INTENT_SCHEMA_VERSION),
    state: z.literal("needs_clarification"),
    understanding: ownerReadableTextSchema,
    question: ownerReadableTextSchema,
    reason: ownerReadableTextSchema,
    source_step_references: sourceStepReferencesSchema,
  })
  .strict();

export const builderLocationCreationIntentOutputSchema = z.discriminatedUnion(
  "state",
  [
    builderLocationCreationIntentReadySchema,
    builderLocationCreationIntentClarificationSchema,
  ],
);

export type BuilderLocationCreationIntentTaskInput = z.infer<
  typeof builderLocationCreationIntentTaskInputSchema
>;
export type BuilderLocationCreationIntentOutput = z.infer<
  typeof builderLocationCreationIntentOutputSchema
>;
export type BuilderLocationCreationIntentReady = z.infer<
  typeof builderLocationCreationIntentReadySchema
>;
export type BuilderLocationCreationIntentClarification = z.infer<
  typeof builderLocationCreationIntentClarificationSchema
>;
export type { AiBusinessModelContextV1 };
