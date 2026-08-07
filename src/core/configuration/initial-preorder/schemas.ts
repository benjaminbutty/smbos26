import { z } from "zod";

import { preorderScheduleSchema } from "../../preorder/schemas";

const uniqueUuidArray = (value: string[], ctx: z.RefinementCtx): void => {
  if (new Set(value).size !== value.length) {
    ctx.addIssue({
      code: "custom",
      message: "Collection Locations must be unique.",
    });
  }
};

export const initialPreorderSetupRequestSchema = z
  .object({
    expectedBaseVersionId: z.uuid(),
    expectedHeadRevision: z.number().int().positive(),
    locationIds: z.array(z.uuid()).min(1).max(50).superRefine(uniqueUuidArray),
    schedule: preorderScheduleSchema,
  })
  .strict();

const rawInitialPreorderSetupFormSchema = z
  .object({
    expectedBaseVersionId: z.string(),
    expectedHeadRevision: z.number().int(),
    locationIds: z.array(z.uuid()),
    daysOfWeek: z.array(z.number().int()),
    startTime: z.string(),
    endTime: z.string(),
    slotIntervalMinutes: z.number().int(),
    slotCapacity: z.number().int(),
    cutoffHours: z.number().int(),
    bookingHorizonDays: z.number().int(),
  })
  .strict();

export const initialPreorderSetupFormSchema = rawInitialPreorderSetupFormSchema
  .transform(
    ({
      expectedBaseVersionId,
      expectedHeadRevision,
      locationIds,
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
      locationIds,
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
  )
  .pipe(initialPreorderSetupRequestSchema);

export type InitialPreorderSetupRequest = z.infer<
  typeof initialPreorderSetupRequestSchema
>;
export type InitialPreorderSetupForm = z.input<
  typeof initialPreorderSetupFormSchema
>;
