import { z } from "zod";

import { graphKeySchema, jsonValueSchema } from "../graph/schemas";

const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const labelSchema = z.string().trim().min(1).max(120);

export const preorderScheduleSchema = z
  .object({
    days_of_week: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((days) => new Set(days).size === days.length),
    start_time: timeSchema,
    end_time: timeSchema,
    slot_interval_minutes: z.number().int().min(5).max(240),
    slot_capacity: z.number().int().min(1).max(1000),
    cutoff_hours: z.number().int().min(0).max(8760),
    booking_horizon_days: z.number().int().min(1).max(365),
  })
  .strict()
  .refine(({ start_time, end_time }) => start_time <= end_time, {
    message: "The last collection time must not precede the first.",
  });

const productMappingsSchema = z
  .object({
    name: graphKeySchema,
    description: graphKeySchema,
    price: graphKeySchema,
    image: graphKeySchema.nullable(),
    status: graphKeySchema,
    active_status_value: labelSchema,
  })
  .strict();

const customerMappingsSchema = z
  .object({
    name: graphKeySchema,
    email: graphKeySchema,
    phone: graphKeySchema.nullable(),
  })
  .strict();

const orderMappingsSchema = z
  .object({
    public_reference: graphKeySchema,
    status: graphKeySchema,
    new_status_value: labelSchema,
    collection_at: graphKeySchema,
    collection_location_name: graphKeySchema,
    customer_name: graphKeySchema,
    customer_email: graphKeySchema,
    customer_phone: graphKeySchema.nullable(),
    item_summary: graphKeySchema,
    total: graphKeySchema,
  })
  .strict();

const orderItemMappingsSchema = z
  .object({
    product_name: graphKeySchema,
    quantity: graphKeySchema,
    unit_price: graphKeySchema,
    line_total: graphKeySchema,
  })
  .strict();

export const preorderPublicFieldSchema = z
  .object({
    target: z.enum(["customer", "order"]),
    field: graphKeySchema,
    label: labelSchema,
    required: z.boolean(),
    help_text: z.string().trim().min(1).max(500).optional(),
    autocomplete: z
      .enum(["name", "email", "tel", "organization", "off"])
      .optional(),
  })
  .strict();

export const preorderConfigSchema = z
  .object({
    schedule: preorderScheduleSchema,
    field_mappings: z
      .object({
        product: productMappingsSchema,
        customer: customerMappingsSchema,
        order: orderMappingsSchema,
        order_item: orderItemMappingsSchema,
      })
      .strict(),
    public_fields: z
      .array(preorderPublicFieldSchema)
      .min(2)
      .max(20)
      .refine(
        (fields) =>
          new Set(fields.map(({ target, field }) => `${target}:${field}`))
            .size === fields.length,
        "Public fields must be unique.",
      ),
  })
  .strict()
  .superRefine((config, context) => {
    const mappedFieldGroups = [
      [
        config.field_mappings.product.name,
        config.field_mappings.product.description,
        config.field_mappings.product.price,
        config.field_mappings.product.image,
        config.field_mappings.product.status,
      ],
      [
        config.field_mappings.customer.name,
        config.field_mappings.customer.email,
        config.field_mappings.customer.phone,
      ],
      [
        config.field_mappings.order.public_reference,
        config.field_mappings.order.status,
        config.field_mappings.order.collection_at,
        config.field_mappings.order.collection_location_name,
        config.field_mappings.order.customer_name,
        config.field_mappings.order.customer_email,
        config.field_mappings.order.customer_phone,
        config.field_mappings.order.item_summary,
        config.field_mappings.order.total,
      ],
      [
        config.field_mappings.order_item.product_name,
        config.field_mappings.order_item.quantity,
        config.field_mappings.order_item.unit_price,
        config.field_mappings.order_item.line_total,
      ],
    ].map((fields) => fields.filter((field) => field !== null));

    if (
      mappedFieldGroups.some((fields) => new Set(fields).size !== fields.length)
    ) {
      context.addIssue({
        code: "custom",
        message: "Each mapped Field must have one preorder responsibility.",
        path: ["field_mappings"],
      });
    }

    const protectedGraphKeys = new Set([
      "business_id",
      "created_at",
      "created_by",
      "id",
      "object_definition_id",
      "record_status",
      "updated_at",
    ]);
    const protectedOrderFields = new Set(
      mappedFieldGroups[2] as string[] | undefined,
    );
    config.public_fields.forEach((field, index) => {
      if (
        protectedGraphKeys.has(field.field) ||
        (field.target === "order" && protectedOrderFields.has(field.field))
      ) {
        context.addIssue({
          code: "custom",
          message: "This Field is controlled by the preorder runtime.",
          path: ["public_fields", index, "field"],
        });
      }
    });
  });

export const createPreorderExperienceSchema = z.object({
  key: graphKeySchema,
  productObjectDefinitionId: z.uuid(),
  customerObjectDefinitionId: z.uuid(),
  orderObjectDefinitionId: z.uuid(),
  orderItemObjectDefinitionId: z.uuid(),
  customerPlacesOrderRelationshipDefinitionId: z.uuid(),
  orderContainsItemRelationshipDefinitionId: z.uuid(),
  productAppearsInItemRelationshipDefinitionId: z.uuid(),
  config: preorderConfigSchema,
  locationIds: z.array(z.uuid()).min(1).max(50),
  isActive: z.boolean().default(true),
});

export const updatePreorderExperienceSchema = z.object({
  preorderExperienceId: z.uuid(),
  config: preorderConfigSchema.optional(),
  isActive: z.boolean().optional(),
});

const catalogueSlotSchema = z.object({
  date: z.string(),
  time: timeSchema,
  collection_at: z.string(),
  available: z.boolean(),
  remaining: z.number().int().nonnegative(),
});

const catalogueLocationSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  timezone: z.string(),
  slots: z.array(catalogueSlotSchema),
});

const catalogueProductSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  price: z.number().positive(),
  image_url: z.url().optional(),
  location_ids: z.array(z.uuid()),
});

const cataloguePublicFieldSchema = preorderPublicFieldSchema.extend({
  field_type: z.enum([
    "short_text",
    "long_text",
    "number",
    "boolean",
    "date",
    "email",
    "phone",
    "select",
    "multi_select",
  ]),
  options: z.array(z.string()).optional(),
});

export const publicPreorderCatalogueSchema = z.object({
  business: z.object({ name: z.string(), slug: z.string() }),
  page: z.object({ title: z.string(), slug: z.string() }),
  preorder: z.object({
    key: graphKeySchema,
    currency: z.string().regex(/^[A-Z]{3}$/),
    schedule: preorderScheduleSchema,
    locations: z.array(catalogueLocationSchema),
    products: z.array(catalogueProductSchema),
    public_fields: z.array(cataloguePublicFieldSchema),
  }),
  generated_at: z.string(),
});

export const publicPreorderSubmissionSchema = z
  .object({
    idempotency_token: z.uuid(),
    location_id: z.uuid(),
    collection_at: z.iso.datetime({ offset: true }),
    items: z
      .array(
        z
          .object({
            product_id: z.uuid(),
            quantity: z.number().int().min(1).max(20),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    fields: z
      .object({
        customer: z.record(graphKeySchema, jsonValueSchema),
        order: z.record(graphKeySchema, jsonValueSchema),
      })
      .strict(),
    website: z.string().max(200).default(""),
  })
  .strict()
  .refine(
    ({ items }) =>
      new Set(items.map(({ product_id }) => product_id)).size === items.length,
    "Each product may appear only once.",
  )
  .refine(
    ({ items }) =>
      items.reduce((total, { quantity }) => total + quantity, 0) <= 100,
    "The total quantity is too large.",
  );

export const publicPreorderConfirmationSchema = z.object({
  public_reference: z.string().regex(/^PO-[A-F0-9]{8}$/),
  collection_location: z.string(),
  collection_at: z.string(),
  timezone: z.string(),
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().int().positive(),
      unit_price: z.number().nonnegative(),
      line_total: z.number().nonnegative(),
    }),
  ),
  item_summary: z.string(),
  total: z.number().nonnegative(),
  confirmation_email: z.email(),
});

export const publicPreorderResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    idempotent: z.boolean(),
    email_status: z.enum(["pending", "sending", "delivered", "failed"]),
    confirmation: publicPreorderConfirmationSchema,
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum([
      "not_found",
      "invalid_submission",
      "rate_limited",
      "invalid_slot",
      "invalid_location",
      "unavailable_product",
      "invalid_quantity",
      "required_field",
      "invalid_field",
      "unsupported_field",
      "retry",
      "rejected",
      "sold_out",
    ]),
  }),
]);

export type PreorderConfig = z.infer<typeof preorderConfigSchema>;
export type CreatePreorderExperienceInput = z.input<
  typeof createPreorderExperienceSchema
>;
export type UpdatePreorderExperienceInput = z.input<
  typeof updatePreorderExperienceSchema
>;
export type PublicPreorderCatalogue = z.infer<
  typeof publicPreorderCatalogueSchema
>;
export type PublicPreorderSubmission = z.infer<
  typeof publicPreorderSubmissionSchema
>;
export type PublicPreorderConfirmation = z.infer<
  typeof publicPreorderConfirmationSchema
>;
export type PublicPreorderResult = z.infer<typeof publicPreorderResultSchema>;
