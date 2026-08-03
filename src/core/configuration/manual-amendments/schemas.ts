import { z } from "zod";

import { graphKeySchema } from "../../graph/schemas";
import { preorderScheduleSchema } from "../../preorder/schemas";

const questionLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .transform((value) => value.replace(/\s+/g, " "));

const optionalQuestionHelpTextSchema = z
  .string()
  .trim()
  .max(500)
  .transform((value) => (value.length === 0 ? null : value))
  .nullable();

export const preorderQuestionTargetSchema = z.enum(["customer", "order"]);
export const preorderQuestionAnswerStyleSchema = z.enum([
  "short_answer",
  "long_answer",
]);

export const updatePreorderScheduleIntentSchema = z
  .object({
    intent: z.literal("update_preorder_schedule"),
    preorderKey: graphKeySchema,
    schedule: preorderScheduleSchema,
  })
  .strict();

export const manualPreorderScheduleFormSchema = z
  .object({
    expectedBaseVersionId: z.uuid(),
    expectedHeadRevision: z.number().int().positive(),
    preorderKey: graphKeySchema,
    daysOfWeek: z.array(z.number().int().min(1).max(7)),
    startTime: z.string(),
    endTime: z.string(),
    slotIntervalMinutes: z.number().int(),
    slotCapacity: z.number().int(),
    cutoffHours: z.number().int(),
    bookingHorizonDays: z.number().int(),
  })
  .strict()
  .transform(
    ({
      expectedBaseVersionId,
      expectedHeadRevision,
      preorderKey,
      daysOfWeek,
      startTime,
      endTime,
      slotIntervalMinutes,
      slotCapacity,
      cutoffHours,
      bookingHorizonDays,
    }) => ({
      expectedBaseVersionId,
      expectedHeadRevision,
      intent: updatePreorderScheduleIntentSchema.parse({
        intent: "update_preorder_schedule",
        preorderKey,
        schedule: {
          days_of_week: daysOfWeek,
          start_time: startTime,
          end_time: endTime,
          slot_interval_minutes: slotIntervalMinutes,
          slot_capacity: slotCapacity,
          cutoff_hours: cutoffHours,
          booking_horizon_days: bookingHorizonDays,
        },
      }),
    }),
  );

export const updatePreorderQuestionIntentSchema = z
  .object({
    intent: z.literal("update_preorder_question"),
    preorderKey: graphKeySchema,
    target: preorderQuestionTargetSchema,
    fieldKey: graphKeySchema,
    label: questionLabelSchema,
    helpText: optionalQuestionHelpTextSchema,
    required: z.boolean(),
  })
  .strict();

export const addPreorderQuestionIntentSchema = z
  .object({
    intent: z.literal("add_preorder_question"),
    preorderKey: graphKeySchema,
    label: questionLabelSchema,
    helpText: optionalQuestionHelpTextSchema,
    required: z.boolean(),
    answerStyle: preorderQuestionAnswerStyleSchema,
  })
  .strict();

const collectionDaysSchema = z
  .array(z.number().int().min(1).max(7))
  .min(1)
  .max(7)
  .refine((days) => new Set(days).size === days.length);
const collectionTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

export const preorderAmendmentIntentSchema = z.discriminatedUnion("intent", [
  z
    .object({
      intent: z.literal("set_collection_days"),
      daysOfWeek: collectionDaysSchema,
    })
    .strict(),
  z
    .object({
      intent: z.literal("set_collection_window"),
      startTime: collectionTimeSchema,
      endTime: collectionTimeSchema,
    })
    .strict(),
  z
    .object({
      intent: z.literal("set_slot_interval_minutes"),
      slotIntervalMinutes: z.number().int().min(5).max(240),
    })
    .strict(),
  z
    .object({
      intent: z.literal("set_slot_capacity"),
      slotCapacity: z.number().int().min(1).max(1000),
    })
    .strict(),
  z
    .object({
      intent: z.literal("set_cutoff_hours"),
      cutoffHours: z.number().int().min(0).max(8760),
    })
    .strict(),
  z
    .object({
      intent: z.literal("set_booking_horizon_days"),
      bookingHorizonDays: z.number().int().min(1).max(365),
    })
    .strict(),
  z
    .object({
      intent: z.literal("set_existing_question_requiredness"),
      target: preorderQuestionTargetSchema,
      fieldKey: graphKeySchema,
      required: z.boolean(),
    })
    .strict(),
  z
    .object({
      intent: z.literal("set_existing_question_label"),
      target: preorderQuestionTargetSchema,
      fieldKey: graphKeySchema,
      label: questionLabelSchema,
    })
    .strict(),
  z
    .object({
      intent: z.literal("set_existing_question_help_text"),
      target: preorderQuestionTargetSchema,
      fieldKey: graphKeySchema,
      helpText: optionalQuestionHelpTextSchema,
    })
    .strict(),
  z
    .object({
      intent: z.literal("add_preorder_question"),
      label: questionLabelSchema,
      helpText: optionalQuestionHelpTextSchema,
      required: z.boolean(),
      answerStyle: preorderQuestionAnswerStyleSchema,
    })
    .strict(),
]);

export const preorderAmendmentBatchSchema = z
  .object({
    preorderKey: graphKeySchema,
    amendments: z.array(preorderAmendmentIntentSchema).min(1).max(20),
  })
  .strict();

const manualQuestionCurrentnessSchema = z
  .object({
    expectedBaseVersionId: z.uuid(),
    expectedHeadRevision: z.number().int().positive(),
  })
  .strict();

export const manualExistingPreorderQuestionFormSchema =
  manualQuestionCurrentnessSchema.extend({
    label: questionLabelSchema,
    helpText: optionalQuestionHelpTextSchema,
    required: z.boolean(),
  });

export const manualNewPreorderQuestionFormSchema =
  manualQuestionCurrentnessSchema.extend({
    label: questionLabelSchema,
    helpText: optionalQuestionHelpTextSchema,
    answerStyle: preorderQuestionAnswerStyleSchema,
    required: z.boolean(),
  });

export type UpdatePreorderScheduleIntent = z.input<
  typeof updatePreorderScheduleIntentSchema
>;
export type UpdatePreorderQuestionIntent = z.input<
  typeof updatePreorderQuestionIntentSchema
>;
export type AddPreorderQuestionIntent = z.input<
  typeof addPreorderQuestionIntentSchema
>;
export type PreorderAmendmentIntent = z.input<
  typeof preorderAmendmentIntentSchema
>;
export type PreorderQuestionTarget = z.infer<
  typeof preorderQuestionTargetSchema
>;
