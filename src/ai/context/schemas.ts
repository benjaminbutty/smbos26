import { z } from "zod";

import { configurationOperationSchema } from "../../core/configuration/schemas";
import { bookingConfigSchema } from "../../core/booking/schemas";
import {
  experienceAudienceSchema,
  experienceFormModeSchema,
  experiencePageStatusSchema,
  experienceViewTypeSchema,
} from "../../core/experience/schemas";
import {
  graphFieldTypeSchema,
  graphKeySchema,
  objectDefinitionKindSchema,
  relationshipCardinalitySchema,
} from "../../core/graph/schemas";
import { preorderConfigSchema } from "../../core/preorder/schemas";

const labelSchema = z.string().trim().min(1).max(120);
const descriptionSchema = z.string().max(5000);
const timezoneSchema = z.string().trim().min(1).max(80);

export const AI_BUSINESS_CONTEXT_SCHEMA_VERSION = 1 as const;
export const AI_BUSINESS_CONTEXT_MAX_BYTES = 128 * 1024;

export const aiContextCapabilitySchema = z.literal("manage_configuration");

export const aiContextLocationSchema = z
  .object({
    reference: z.uuid(),
    name: labelSchema,
    timezone: timezoneSchema,
    is_active: z.boolean(),
  })
  .strict();

export const aiContextFieldSettingsSchema = z
  .object({
    options: z.array(labelSchema).min(1).max(100).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
  })
  .strict();

export const aiContextFieldSchema = z
  .object({
    key: graphKeySchema,
    label: labelSchema,
    field_type: graphFieldTypeSchema,
    required: z.boolean(),
    position: z.number().int().nonnegative(),
    is_active: z.boolean(),
    has_default: z.boolean(),
    settings: aiContextFieldSettingsSchema,
  })
  .strict();

export const aiContextObjectSchema = z
  .object({
    key: graphKeySchema,
    singular_label: labelSchema,
    plural_label: labelSchema,
    description: descriptionSchema,
    kind: objectDefinitionKindSchema,
    semantic_type: z.string().trim().min(1).max(120).nullable(),
    icon: z.string().trim().min(1).max(120).nullable(),
    is_active: z.boolean(),
    fields: z.array(aiContextFieldSchema),
  })
  .strict();

export const aiContextRelationshipSchema = z
  .object({
    key: graphKeySchema,
    source_object_key: graphKeySchema,
    target_object_key: graphKeySchema,
    source_label: labelSchema,
    target_label: labelSchema,
    cardinality: relationshipCardinalitySchema,
    is_required: z.boolean(),
    is_active: z.boolean(),
  })
  .strict();

const viewActionsSchema = {
  create_form_key: graphKeySchema.optional(),
  edit_form_key: graphKeySchema.optional(),
  include_archived: z.boolean(),
};

const aiContextViewBaseSchema = z.object({
  key: graphKeySchema,
  name: labelSchema,
  object_key: graphKeySchema,
  audience: experienceAudienceSchema,
  is_active: z.boolean(),
});

export const aiContextViewSchema = z.discriminatedUnion("view_type", [
  aiContextViewBaseSchema
    .extend({
      view_type: z.literal("table"),
      configuration: z
        .object({
          fields: z.array(graphKeySchema).min(1).max(50),
          title_field: graphKeySchema.optional(),
          ...viewActionsSchema,
        })
        .strict(),
    })
    .strict(),
  aiContextViewBaseSchema
    .extend({
      view_type: z.literal("list"),
      configuration: z
        .object({
          primary_field: graphKeySchema,
          secondary_fields: z.array(graphKeySchema).max(50),
          ...viewActionsSchema,
        })
        .strict(),
    })
    .strict(),
  aiContextViewBaseSchema
    .extend({
      view_type: z.literal("cards"),
      configuration: z
        .object({
          title_field: graphKeySchema,
          subtitle_field: graphKeySchema.optional(),
          image_field: graphKeySchema.optional(),
          supporting_fields: z.array(graphKeySchema).max(50),
          ...viewActionsSchema,
        })
        .strict(),
    })
    .strict(),
  aiContextViewBaseSchema
    .extend({
      view_type: z.literal("detail"),
      configuration: z
        .object({
          fields: z.array(graphKeySchema).min(1).max(50),
          title_field: graphKeySchema.optional(),
          edit_form_key: graphKeySchema.optional(),
          include_archived: z.boolean(),
        })
        .strict(),
    })
    .strict(),
]);

export const aiContextFormFieldSchema = z
  .object({
    field: graphKeySchema,
    label: labelSchema.optional(),
    help_text: z.string().trim().min(1).max(500).optional(),
    hidden: z.boolean(),
    has_default: z.boolean(),
  })
  .strict();

export const aiContextFormSchema = z
  .object({
    key: graphKeySchema,
    name: labelSchema,
    object_key: graphKeySchema,
    mode: experienceFormModeSchema,
    audience: experienceAudienceSchema,
    is_active: z.boolean(),
    fields: z.array(aiContextFormFieldSchema).min(1).max(50),
    submit_label: labelSchema.optional(),
  })
  .strict();

const aiContextHeadingBlockSchema = z
  .object({
    type: z.literal("heading"),
    text: z.string().trim().min(1).max(200),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  })
  .strict();

const aiContextTextBlockSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().trim().min(1).max(5000),
  })
  .strict();

const aiContextImageBlockSchema = z
  .object({
    type: z.literal("image"),
    alt: z.string().trim().min(1).max(300),
    caption: z.string().trim().min(1).max(500).optional(),
    source_kind: z.literal("external_web"),
  })
  .strict();

const aiContextButtonBlockSchema = z
  .object({
    type: z.literal("button"),
    label: labelSchema,
    style: z.enum(["primary", "secondary"]),
    destination_kind: z.enum([
      "internal_path",
      "external_web",
      "email",
      "telephone",
    ]),
  })
  .strict();

const aiContextViewBlockSchema = z
  .object({
    type: z.literal("view"),
    view_key: graphKeySchema,
  })
  .strict();

const aiContextFormBlockSchema = z
  .object({
    type: z.literal("form"),
    form_key: graphKeySchema,
  })
  .strict();

const aiContextPublicFormBlockSchema = z
  .object({
    type: z.literal("public_form"),
    form_key: graphKeySchema,
  })
  .strict();

const aiContextBookingBlockSchema = z
  .object({
    type: z.literal("booking"),
    booking_key: graphKeySchema,
    config: bookingConfigSchema,
  })
  .strict();

const aiContextPreorderBlockSchema = z
  .object({
    type: z.literal("preorder"),
    preorder_key: graphKeySchema,
  })
  .strict();

const aiContextDividerBlockSchema = z
  .object({
    type: z.literal("divider"),
  })
  .strict();

const aiContextCalloutBlockSchema = z
  .object({
    type: z.literal("callout"),
    text: z.string().trim().min(1).max(1_000),
    tone: z.enum(["neutral", "info", "success", "warning"]),
  })
  .strict();

export const aiContextPageBlockSchema = z.discriminatedUnion("type", [
  aiContextHeadingBlockSchema,
  aiContextTextBlockSchema,
  aiContextImageBlockSchema,
  aiContextButtonBlockSchema,
  aiContextViewBlockSchema,
  aiContextFormBlockSchema,
  aiContextPublicFormBlockSchema,
  aiContextBookingBlockSchema,
  aiContextPreorderBlockSchema,
  aiContextDividerBlockSchema,
  aiContextCalloutBlockSchema,
]);

export const aiContextPageSchema = z
  .object({
    key: graphKeySchema,
    title: labelSchema,
    slug: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    audience: experienceAudienceSchema,
    status: experiencePageStatusSchema,
    is_active: z.boolean(),
    blocks: z.array(aiContextPageBlockSchema).min(1).max(100),
  })
  .strict();

export const aiContextAllowedLocationSchema = z
  .object({
    reference: z.uuid(),
    name: labelSchema,
    timezone: timezoneSchema,
    association_is_active: z.boolean(),
    location_is_active: z.boolean(),
  })
  .strict();

export const aiContextPreorderExperienceSchema = z
  .object({
    key: graphKeySchema,
    product_object_key: graphKeySchema,
    customer_object_key: graphKeySchema,
    order_object_key: graphKeySchema,
    order_item_object_key: graphKeySchema,
    customer_places_order_relationship_key: graphKeySchema,
    order_contains_item_relationship_key: graphKeySchema,
    product_appears_in_item_relationship_key: graphKeySchema,
    schedule: preorderConfigSchema.shape.schedule,
    field_mappings: preorderConfigSchema.shape.field_mappings,
    public_fields: preorderConfigSchema.shape.public_fields,
    is_active: z.boolean(),
    allowed_locations: z.array(aiContextAllowedLocationSchema).max(50),
  })
  .strict();

const platformCapabilityNameSchema = z.enum([
  "generic_graph",
  "generic_records",
  "generic_record_connections",
  "record_to_location_connections",
  "configured_views_forms_pages",
  "published_public_pages",
  "trusted_public_preorder",
  "immutable_configuration_versions",
  "configuration_candidate_preview",
  "manual_preorder_schedule_amendments",
  "manual_preorder_question_amendments",
  "public_create_forms",
  "scheduling_booking",
  "sites_public_pages",
]);

const changeLaneSchema = z
  .object({
    name: z.enum(["configuration", "operational"]),
    supports: z.array(z.string().min(1).max(80)),
    mechanism: z.enum([
      "proposal_preview_validation_deliberate_application",
      "narrow_deterministic_services",
    ]),
  })
  .strict();

export const aiContextPlatformCapabilitiesSchema = z
  .object({
    registry_version: z.literal(1),
    field_types: z.array(graphFieldTypeSchema),
    relationship_cardinalities: z.array(relationshipCardinalitySchema),
    view_types: z.array(experienceViewTypeSchema),
    form_modes: z.array(experienceFormModeSchema),
    page_block_types: z.array(
      z.enum([
        "heading",
        "text",
        "image",
        "button",
        "view",
        "form",
        "public_form",
        "booking",
        "preorder",
        "divider",
        "callout",
      ]),
    ),
    configuration_operation_names: z.array(
      z.enum([
        "set_object",
        "set_field",
        "set_relationship",
        "set_view",
        "set_form",
        "set_page",
        "set_preorder_experience",
      ]),
    ),
    reusable_capabilities: z.array(platformCapabilityNameSchema),
    unavailable: z
      .object({
        workflows: z.literal(true),
        rules: z.literal(true),
        arbitrary_code: z.literal(true),
      })
      .strict(),
    change_lanes: z.array(changeLaneSchema).length(2),
  })
  .strict();

export const aiBusinessModelContextV1Schema = z
  .object({
    schema_version: z.literal(AI_BUSINESS_CONTEXT_SCHEMA_VERSION),
    business: z
      .object({
        name: labelSchema,
        business_type: z.string().trim().min(1).max(80),
        timezone: timezoneSchema,
      })
      .strict(),
    access: z
      .object({
        role: z.enum(["owner", "admin"]),
        capabilities: z.array(aiContextCapabilitySchema).length(1),
      })
      .strict(),
    active_configuration: z
      .object({
        version_number: z.number().int().positive(),
        revision: z.number().int().positive(),
      })
      .strict(),
    locations: z.array(aiContextLocationSchema),
    objects: z.array(aiContextObjectSchema),
    relationships: z.array(aiContextRelationshipSchema),
    views: z.array(aiContextViewSchema),
    forms: z.array(aiContextFormSchema),
    pages: z.array(aiContextPageSchema),
    preorder_experiences: z.array(aiContextPreorderExperienceSchema),
    platform_capabilities: aiContextPlatformCapabilitiesSchema,
  })
  .strict();

export type AiBusinessModelContextV1 = z.infer<
  typeof aiBusinessModelContextV1Schema
>;

export const authoritativeFieldTypes = graphFieldTypeSchema.options;
export const authoritativeRelationshipCardinalities =
  relationshipCardinalitySchema.options;
export const authoritativeViewTypes = experienceViewTypeSchema.options;
export const authoritativeFormModes = experienceFormModeSchema.options;
export const authoritativePageBlockTypes = [
  "heading",
  "text",
  "image",
  "button",
  "view",
  "form",
  "public_form",
  "booking",
  "preorder",
  "divider",
  "callout",
] as const;
export const authoritativeConfigurationOperationNames =
  configurationOperationSchema.options.map((schema) => schema.shape.op.value);
