import { z } from "zod";

import { graphKeySchema } from "../../graph/schemas";
import { preorderScheduleSchema } from "../../preorder/schemas";

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

export type UpdatePreorderScheduleIntent = z.input<
  typeof updatePreorderScheduleIntentSchema
>;
