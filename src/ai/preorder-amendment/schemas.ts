import { z } from "zod";

import {
  aiBusinessModelContextV1Schema,
  type AiBusinessModelContextV1,
} from "../context/schemas";
import { graphKeySchema } from "../../core/graph/schemas";
import {
  builderPlanOutputSchema,
  builderPlanTaskInputSchema,
} from "../planning/schemas";

export const BUILDER_PREORDER_AMENDMENT_SCHEMA_VERSION = 1 as const;
export const BUILDER_PREORDER_AMENDMENT_MAX_OUTPUT_BYTES = 32 * 1024;
export const BUILDER_PREORDER_AMENDMENT_MAX_AMENDMENTS = 12;
export const BUILDER_PREORDER_AMENDMENT_MAX_SOURCE_STEP_REFERENCES = 20;

const ownerReadableTextSchema = z.string().trim().min(1).max(2_000);
const questionLabelSchema = z.string().trim().min(1).max(120);
const optionalHelpTextSchema = z.string().trim().max(500).nullable();
const stepReferenceSchema = z
  .string()
  .max(80)
  .regex(/^step_[1-9][0-9]*$/);
const sourceStepReferencesSchema = z
  .array(stepReferenceSchema)
  .min(1)
  .max(BUILDER_PREORDER_AMENDMENT_MAX_SOURCE_STEP_REFERENCES)
  .superRefine((references, context) => {
    if (new Set(references).size !== references.length) {
      context.addIssue({
        code: "custom",
        message: "Source planning-step references must be unique.",
      });
    }
  });

const amendmentBase = {
  source_step_references: sourceStepReferencesSchema,
};

export const builderPreorderAmendmentSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...amendmentBase,
      type: z.literal("set_collection_days"),
      days_of_week: z
        .array(z.number().int().min(1).max(7))
        .min(1)
        .max(7)
        .refine((days) => new Set(days).size === days.length),
    })
    .strict(),
  z
    .object({
      ...amendmentBase,
      type: z.literal("set_collection_window"),
      start_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
      end_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    })
    .strict(),
  z
    .object({
      ...amendmentBase,
      type: z.literal("set_slot_interval_minutes"),
      slot_interval_minutes: z.number().int().min(5).max(240),
    })
    .strict(),
  z
    .object({
      ...amendmentBase,
      type: z.literal("set_slot_capacity"),
      slot_capacity: z.number().int().min(1).max(1_000),
    })
    .strict(),
  z
    .object({
      ...amendmentBase,
      type: z.literal("set_cutoff_hours"),
      cutoff_hours: z.number().int().min(0).max(8_760),
    })
    .strict(),
  z
    .object({
      ...amendmentBase,
      type: z.literal("set_booking_horizon_days"),
      booking_horizon_days: z.number().int().min(1).max(365),
    })
    .strict(),
  z
    .object({
      ...amendmentBase,
      type: z.literal("set_existing_question_requiredness"),
      target: z.enum(["customer", "order"]),
      field_key: graphKeySchema,
      required: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...amendmentBase,
      type: z.literal("set_existing_question_label"),
      target: z.enum(["customer", "order"]),
      field_key: graphKeySchema,
      label: questionLabelSchema,
    })
    .strict(),
  z
    .object({
      ...amendmentBase,
      type: z.literal("set_existing_question_help_text"),
      target: z.enum(["customer", "order"]),
      field_key: graphKeySchema,
      help_text: optionalHelpTextSchema,
    })
    .strict(),
  z
    .object({
      ...amendmentBase,
      type: z.literal("add_preorder_question"),
      label: questionLabelSchema,
      help_text: optionalHelpTextSchema,
      required: z.boolean(),
      answer_style: z.enum(["short_answer", "long_answer"]),
    })
    .strict(),
]);

export const builderPreorderAmendmentOutputSchema = z
  .object({
    schema_version: z.literal(BUILDER_PREORDER_AMENDMENT_SCHEMA_VERSION),
    summary: ownerReadableTextSchema,
    preorder_key: graphKeySchema,
    amendments: z
      .array(builderPreorderAmendmentSchema)
      .min(1)
      .max(BUILDER_PREORDER_AMENDMENT_MAX_AMENDMENTS),
  })
  .strict();

export const builderPreorderAmendmentTaskInputBaseSchema = z
  .object({
    schema_version: z.literal(BUILDER_PREORDER_AMENDMENT_SCHEMA_VERSION),
    owner_request: builderPlanTaskInputSchema.shape.owner_request,
    business_context: aiBusinessModelContextV1Schema,
    ready_plan: builderPlanOutputSchema,
  })
  .strict();

export type BuilderPreorderAmendment = z.infer<
  typeof builderPreorderAmendmentSchema
>;
export type BuilderPreorderAmendmentOutput = z.infer<
  typeof builderPreorderAmendmentOutputSchema
>;
export type BuilderPreorderAmendmentTaskInput = z.infer<
  typeof builderPreorderAmendmentTaskInputBaseSchema
>;
export type BuilderPreorderAmendmentReadyTaskInput = Omit<
  BuilderPreorderAmendmentTaskInput,
  "ready_plan"
> & {
  ready_plan: Extract<
    BuilderPreorderAmendmentTaskInput["ready_plan"],
    { state: "ready" }
  >;
};
export type { AiBusinessModelContextV1 };
