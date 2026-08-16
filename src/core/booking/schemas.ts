import { z } from "zod";

import { graphKeySchema, jsonValueSchema } from "../graph/schemas";

const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const labelSchema = z.string().trim().min(1).max(120);

export const bookingScheduleSchema = z
  .object({
    timezone_source: z.enum(["business", "location"]),
    location_id: z.uuid().nullable().default(null),
    days_of_week: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((days) => new Set(days).size === days.length),
    first_time: timeSchema,
    last_time: timeSchema,
    slot_interval_minutes: z.number().int().min(5).max(240),
    capacity_per_slot: z.number().int().min(1).max(1000),
    minimum_notice_minutes: z
      .number()
      .int()
      .min(0)
      .max(8760 * 60),
    booking_horizon_days: z.number().int().min(1).max(365),
  })
  .strict()
  .superRefine((schedule, context) => {
    if (schedule.first_time >= schedule.last_time) {
      context.addIssue({
        code: "custom",
        message: "The last booking time must be later than the first.",
        path: ["last_time"],
      });
    }
    if (
      schedule.timezone_source === "location" &&
      schedule.location_id === null
    ) {
      context.addIssue({
        code: "custom",
        message: "A Location is required when booking uses Location timezone.",
        path: ["location_id"],
      });
    }
    if (
      schedule.timezone_source === "business" &&
      schedule.location_id !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "Business-timezone booking cannot bind a Location.",
        path: ["location_id"],
      });
    }
  });

const customerMappingSchema = z
  .object({
    name: graphKeySchema,
    email: graphKeySchema.nullable().default(null),
    phone: graphKeySchema.nullable().default(null),
  })
  .strict();

const bookingMappingSchema = z
  .object({
    start_at: graphKeySchema,
    status: graphKeySchema,
    default_status: labelSchema,
    date: graphKeySchema.nullable().default(null),
    time: graphKeySchema.nullable().default(null),
  })
  .strict();

const subjectMappingSchema = z
  .object({
    name: graphKeySchema,
  })
  .strict();

const serviceMappingSchema = z
  .object({
    name: graphKeySchema,
  })
  .strict();

export const bookingPublicFieldSchema = z
  .object({
    target: z.enum(["customer", "subject", "booking"]),
    field: graphKeySchema,
    label: labelSchema,
    required: z.boolean(),
    derived: z.boolean().default(false),
    help_text: z.string().trim().min(1).max(500).optional(),
    autocomplete: z
      .enum(["name", "email", "tel", "organization", "off"])
      .optional(),
  })
  .strict();

export const bookingConfigSchema = z
  .object({
    booking_object_key: graphKeySchema,
    customer_object_key: graphKeySchema,
    subject_object_key: graphKeySchema.nullable().default(null),
    service_object_key: graphKeySchema.nullable().default(null),
    relationships: z
      .object({
        customer_booking: graphKeySchema,
        customer_subject: graphKeySchema.nullable().default(null),
        subject_booking: graphKeySchema.nullable().default(null),
        service_booking: graphKeySchema.nullable().default(null),
      })
      .strict(),
    field_mappings: z
      .object({
        customer: customerMappingSchema,
        booking: bookingMappingSchema,
        subject: subjectMappingSchema.nullable().default(null),
        service: serviceMappingSchema.nullable().default(null),
      })
      .strict(),
    public_fields: z
      .array(bookingPublicFieldSchema)
      .max(30)
      .refine(
        (fields) =>
          new Set(fields.map(({ target, field }) => `${target}:${field}`))
            .size === fields.length,
        "Public booking fields must be unique.",
      ),
    schedule: bookingScheduleSchema,
  })
  .strict()
  .superRefine((config, context) => {
    if (
      config.subject_object_key === null &&
      (config.field_mappings.subject !== null ||
        config.relationships.customer_subject !== null ||
        config.relationships.subject_booking !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Subject mappings require a Subject Object.",
        path: ["subject_object_key"],
      });
    }
    if (
      config.service_object_key === null &&
      (config.field_mappings.service !== null ||
        config.relationships.service_booking !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Service mappings require a Service Object.",
        path: ["service_object_key"],
      });
    }
    if (
      config.subject_object_key !== null &&
      (config.field_mappings.subject === null ||
        config.relationships.customer_subject === null ||
        config.relationships.subject_booking === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "A Subject requires its configured mappings and connections.",
        path: ["field_mappings", "subject"],
      });
    }
    if (
      config.service_object_key !== null &&
      (config.field_mappings.service === null ||
        config.relationships.service_booking === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "A Service requires its configured mapping and connection.",
        path: ["field_mappings", "service"],
      });
    }
    const mapped = [
      ["customer", config.field_mappings.customer.name],
      ["customer", config.field_mappings.customer.email],
      ["customer", config.field_mappings.customer.phone],
      ["booking", config.field_mappings.booking.start_at],
      ["booking", config.field_mappings.booking.status],
      ["booking", config.field_mappings.booking.date],
      ["booking", config.field_mappings.booking.time],
      ["subject", config.field_mappings.subject?.name],
      ["service", config.field_mappings.service?.name],
    ]
      .filter(
        (entry): entry is [string, string] =>
          entry[1] !== null && entry[1] !== undefined,
      )
      .map(([target, field]) => `${target}:${field}`);
    if (new Set(mapped).size !== mapped.length) {
      context.addIssue({
        code: "custom",
        message: "Each mapped Field must have one booking responsibility.",
        path: ["field_mappings"],
      });
    }
  });

export const publicFormBlockSchema = z
  .object({
    type: z.literal("public_form"),
    form_key: graphKeySchema,
    id: z.uuid().optional(),
  })
  .strict();

export const bookingBlockSchema = z
  .object({
    type: z.literal("booking"),
    booking_key: graphKeySchema,
    config: bookingConfigSchema,
    id: z.uuid().optional(),
  })
  .strict();

export const bookingSubmissionSchema = z
  .object({
    idempotency_token: z.uuid(),
    start_at: z.iso.datetime({ offset: true }),
    customer: z.record(graphKeySchema, jsonValueSchema).default({}),
    subject: z.record(graphKeySchema, jsonValueSchema).default({}),
    booking: z.record(graphKeySchema, jsonValueSchema).default({}),
    service_record_id: z.uuid().nullable().default(null),
    website: z.string().max(200).default(""),
  })
  .strict();

export const publicBookingSlotSchema = z.object({
  start_at: z.string(),
  local_date: z.string(),
  local_time: z.string(),
  remaining: z.number().int().nonnegative(),
});

export const publicBookingCatalogueSchema = z.object({
  business: z.object({ name: z.string(), slug: z.string() }),
  page: z.object({ title: z.string(), slug: z.string() }),
  booking: z.object({
    key: graphKeySchema,
    timezone: z.string(),
    schedule: bookingScheduleSchema,
    slots: z.array(publicBookingSlotSchema),
    services: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
      }),
    ),
    public_fields: z.array(bookingPublicFieldSchema),
  }),
});

export const publicBookingResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    idempotent: z.boolean(),
    confirmation: z.object({
      public_reference: z.string().regex(/^BK-[A-F0-9]{8}$/),
      start_at: z.string(),
      timezone: z.string(),
    }),
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum([
      "not_found",
      "invalid_submission",
      "rate_limited",
      "invalid_slot",
      "invalid_service",
      "required_field",
      "invalid_field",
      "capacity_unavailable",
      "retry",
      "rejected",
    ]),
  }),
]);

export type BookingConfig = z.infer<typeof bookingConfigSchema>;
export type BookingSubmission = z.infer<typeof bookingSubmissionSchema>;
export type PublicBookingCatalogue = z.infer<
  typeof publicBookingCatalogueSchema
>;
export type PublicBookingResult = z.infer<typeof publicBookingResultSchema>;
