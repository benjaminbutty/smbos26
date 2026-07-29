import { z } from "zod";

import {
  experienceAudienceSchema,
  experienceFormModeSchema,
  experiencePageStatusSchema,
  experienceViewTypeSchema,
  formConfigSchema,
  pageLayoutSchema,
  parseViewConfig,
} from "../experience/schemas";
import {
  graphFieldTypeSchema,
  graphKeySchema,
  jsonObjectSchema,
  jsonValueSchema,
  relationshipCardinalitySchema,
} from "../graph/schemas";
import { preorderConfigSchema } from "../preorder/schemas";

const MAX_OPERATION_COUNT = 100;
const MAX_OPERATION_BYTES = 256 * 1024;
const MAX_DISPLAY_CONTEXT_BYTES = 128 * 1024;

const labelSchema = z.string().trim().min(1).max(120);
const descriptionSchema = z.string().max(5000);
const iconSchema = z.string().trim().min(1).max(120).nullable();

export const setObjectOperationSchema = z
  .object({
    op: z.literal("set_object"),
    key: graphKeySchema,
    singular_label: labelSchema,
    plural_label: labelSchema,
    description: descriptionSchema,
    icon: iconSchema,
    is_active: z.boolean(),
  })
  .strict();

export const setFieldOperationSchema = z
  .object({
    op: z.literal("set_field"),
    object_key: graphKeySchema,
    key: graphKeySchema,
    label: labelSchema,
    field_type: graphFieldTypeSchema,
    required: z.boolean(),
    default_value: jsonValueSchema.nullable(),
    settings_json: jsonObjectSchema,
    position: z.number().int().nonnegative(),
    is_active: z.boolean(),
  })
  .strict();

export const setRelationshipOperationSchema = z
  .object({
    op: z.literal("set_relationship"),
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

export const setViewOperationSchema = z
  .object({
    op: z.literal("set_view"),
    key: graphKeySchema,
    name: labelSchema,
    view_type: experienceViewTypeSchema,
    object_key: graphKeySchema,
    config_json: jsonObjectSchema,
    audience: experienceAudienceSchema,
    is_active: z.boolean(),
  })
  .strict()
  .superRefine((operation, context) => {
    try {
      parseViewConfig(operation.view_type, operation.config_json);
    } catch {
      context.addIssue({
        code: "custom",
        message: "The View configuration does not match its View type.",
        path: ["config_json"],
      });
    }
  });

export const setFormOperationSchema = z
  .object({
    op: z.literal("set_form"),
    key: graphKeySchema,
    name: labelSchema,
    object_key: graphKeySchema,
    mode: experienceFormModeSchema,
    config_json: formConfigSchema,
    audience: experienceAudienceSchema,
    is_active: z.boolean(),
  })
  .strict();

export const setPageOperationSchema = z
  .object({
    op: z.literal("set_page"),
    key: graphKeySchema,
    title: labelSchema,
    slug: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    audience: experienceAudienceSchema,
    layout_json: pageLayoutSchema,
    status: experiencePageStatusSchema,
    is_active: z.boolean(),
  })
  .strict();

export const setPreorderExperienceOperationSchema = z
  .object({
    op: z.literal("set_preorder_experience"),
    key: graphKeySchema,
    product_object_key: graphKeySchema,
    customer_object_key: graphKeySchema,
    order_object_key: graphKeySchema,
    order_item_object_key: graphKeySchema,
    customer_places_order_relationship_key: graphKeySchema,
    order_contains_item_relationship_key: graphKeySchema,
    product_appears_in_item_relationship_key: graphKeySchema,
    config_json: preorderConfigSchema,
    allowed_location_ids: z.array(z.uuid()).max(50),
    is_active: z.boolean(),
  })
  .strict()
  .superRefine((operation, context) => {
    if (operation.is_active && operation.allowed_location_ids.length === 0) {
      context.addIssue({
        code: "custom",
        message: "An active preorder experience requires a Location.",
        path: ["allowed_location_ids"],
      });
    }
    if (
      new Set(operation.allowed_location_ids).size !==
      operation.allowed_location_ids.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Allowed Location IDs must be unique.",
        path: ["allowed_location_ids"],
      });
    }
  });

export const configurationOperationSchema = z.union([
  setObjectOperationSchema,
  setFieldOperationSchema,
  setRelationshipOperationSchema,
  setViewOperationSchema,
  setFormOperationSchema,
  setPageOperationSchema,
  setPreorderExperienceOperationSchema,
]);

function operationTarget(
  operation: z.infer<typeof configurationOperationSchema>,
): string {
  switch (operation.op) {
    case "set_object":
      return `object:${operation.key}`;
    case "set_field":
      return `field:${operation.object_key}.${operation.key}`;
    case "set_relationship":
      return `relationship:${operation.key}`;
    case "set_view":
      return `view:${operation.key}`;
    case "set_form":
      return `form:${operation.key}`;
    case "set_page":
      return `page:${operation.key}`;
    case "set_preorder_experience":
      return `preorder:${operation.key}`;
  }
}

export const configurationOperationsSchema = z
  .array(configurationOperationSchema)
  .min(1)
  .max(MAX_OPERATION_COUNT)
  .superRefine((operations, context) => {
    const targets = operations.map(operationTarget);
    if (new Set(targets).size !== targets.length) {
      context.addIssue({
        code: "custom",
        message: "Only one operation may target each configuration entity.",
      });
    }

    if (
      new TextEncoder().encode(JSON.stringify(operations)).byteLength >
      MAX_OPERATION_BYTES
    ) {
      context.addIssue({
        code: "custom",
        message: "Configuration operations exceed the 256 KiB limit.",
      });
    }
  });

export const proposeConfigurationChangeSchema = z
  .object({
    title: labelSchema,
    description: descriptionSchema.nullable(),
    operations: configurationOperationsSchema,
  })
  .strict();

export const prepareConfigurationRollbackSchema = z
  .object({
    targetVersionId: z.uuid(),
    title: labelSchema,
    description: descriptionSchema.nullable(),
  })
  .strict();

export const configurationDisplayContextSchema = z
  .object({
    schema_version: z.literal(1),
    locations: z.record(
      z.uuid(),
      z
        .object({
          name: labelSchema,
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((context, refinement) => {
    if (
      new TextEncoder().encode(JSON.stringify(context)).byteLength >
      MAX_DISPLAY_CONTEXT_BYTES
    ) {
      refinement.addIssue({
        code: "custom",
        message: "Configuration display context exceeds the 128 KiB limit.",
      });
    }
  });

export const semanticDiffPropertySchema = z
  .object({
    property: z.string().min(1),
    before: jsonValueSchema,
    after: jsonValueSchema,
  })
  .strict();

export const semanticDiffSchema = z
  .object({
    schema_version: z.literal(1),
    counts: z
      .object({
        created: z.number().int().nonnegative(),
        updated: z.number().int().nonnegative(),
        archived: z.number().int().nonnegative(),
        restored: z.number().int().nonnegative(),
      })
      .strict(),
    changes: z.array(
      z
        .object({
          entity_type: z.enum([
            "object",
            "field",
            "relationship",
            "view",
            "form",
            "page",
            "preorder_experience",
            "preorder_location",
          ]),
          entity_key: z.string().min(1),
          change_type: z.enum(["created", "updated", "archived", "restored"]),
          label: z.string().min(1),
          properties: z.array(semanticDiffPropertySchema),
        })
        .strict(),
    ),
  })
  .strict();

export const configurationValidationIssueSchema = z
  .object({
    code: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z][a-z0-9_]*$/),
    message: z.string().trim().min(1).max(300),
  })
  .strict();

const configurationValidationResultBaseSchema = z
  .object({
    schema_version: z.literal(1),
    base_version_id: z.uuid(),
    base_head_revision: z.number().int().positive(),
    candidate_checksum: z.string().regex(/^[a-f0-9]{64}$/),
    warnings: z.array(configurationValidationIssueSchema).max(50),
  })
  .strict();

export const configurationValidationResultSchema = z.discriminatedUnion(
  "outcome",
  [
    configurationValidationResultBaseSchema.extend({
      outcome: z.literal("valid"),
      errors: z.array(configurationValidationIssueSchema).length(0),
    }),
    configurationValidationResultBaseSchema.extend({
      outcome: z.literal("invalid"),
      errors: z.array(configurationValidationIssueSchema).min(1).max(50),
    }),
  ],
);

export type ConfigurationOperation = z.infer<
  typeof configurationOperationSchema
>;
export type ProposeConfigurationChangeInput = z.input<
  typeof proposeConfigurationChangeSchema
>;
export type PrepareConfigurationRollbackInput = z.input<
  typeof prepareConfigurationRollbackSchema
>;
export type SemanticDiff = z.infer<typeof semanticDiffSchema>;
export type ConfigurationValidationResult = z.infer<
  typeof configurationValidationResultSchema
>;
