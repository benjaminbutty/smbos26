import { z } from "zod";

import {
  experienceAudienceSchema,
  experienceFormModeSchema,
} from "../../core/experience/schemas";
import {
  graphFieldTypeSchema,
  graphKeySchema,
  relationshipCardinalitySchema,
} from "../../core/graph/schemas";
import { aiBusinessModelContextV1Schema } from "../context/schemas";
import {
  builderPlanOutputSchema,
  builderPlanTaskInputSchema,
} from "../planning/schemas";

export const BUILDER_CONFIGURATION_DRAFT_SCHEMA_VERSION = 1 as const;
export const BUILDER_CONFIGURATION_DRAFT_MAX_OUTPUT_BYTES = 128 * 1024;

export const BUILDER_CONFIGURATION_DRAFT_MAX_OBJECTS = 20;
export const BUILDER_CONFIGURATION_DRAFT_MAX_FIELDS = 100;
export const BUILDER_CONFIGURATION_DRAFT_MAX_RELATIONSHIPS = 50;
export const BUILDER_CONFIGURATION_DRAFT_MAX_VIEWS = 50;
export const BUILDER_CONFIGURATION_DRAFT_MAX_FORMS = 50;
export const BUILDER_CONFIGURATION_DRAFT_MAX_PAGES = 50;
export const BUILDER_CONFIGURATION_DRAFT_MAX_PAGE_BLOCKS = 100;
export const BUILDER_CONFIGURATION_DRAFT_MAX_SOURCE_STEP_REFERENCES = 20;

const labelSchema = z.string().trim().min(1).max(120);
const descriptionSchema = z.string().max(5_000);
const ownerReadableTextSchema = z.string().trim().min(1).max(5_000);

function referenceSchema(prefix: string, maximum = 80) {
  return z
    .string()
    .min(1)
    .max(maximum)
    .regex(new RegExp(`^${prefix}_[1-9][0-9]*$`));
}

export const draftObjectReferenceSchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("existing"),
      object_key: graphKeySchema,
    })
    .strict(),
  z
    .object({
      source: z.literal("draft"),
      object_reference: referenceSchema("draft_object", 60),
    })
    .strict(),
]);

export const draftFieldReferenceSchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("existing"),
      object_key: graphKeySchema,
      field_key: graphKeySchema,
    })
    .strict(),
  z
    .object({
      source: z.literal("draft"),
      field_reference: referenceSchema("draft_field", 60),
    })
    .strict(),
]);

export const draftViewReferenceSchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("existing"),
      view_key: graphKeySchema,
    })
    .strict(),
  z
    .object({
      source: z.literal("draft"),
      view_reference: referenceSchema("draft_view", 60),
    })
    .strict(),
]);

export const draftFormReferenceSchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("existing"),
      form_key: graphKeySchema,
    })
    .strict(),
  z
    .object({
      source: z.literal("draft"),
      form_reference: referenceSchema("draft_form", 60),
    })
    .strict(),
]);

export const draftSourceStepReferencesSchema = z
  .array(referenceSchema("step"))
  .min(1)
  .max(BUILDER_CONFIGURATION_DRAFT_MAX_SOURCE_STEP_REFERENCES)
  .superRefine((references, context) => {
    if (new Set(references).size !== references.length) {
      context.addIssue({
        code: "custom",
        message: "Source planning-step references must be unique.",
      });
    }
  });

const draftObjectBase = {
  reference: referenceSchema("draft_object", 60),
  concept_reference: referenceSchema("concept"),
  source_step_references: draftSourceStepReferencesSchema,
  singular_label: labelSchema,
  plural_label: labelSchema,
  description: descriptionSchema,
};

export const draftObjectSchema = z.object(draftObjectBase).strict();

const emptySettingsSchema = z.null();
const optionsSettingsSchema = z
  .object({
    options: z.array(labelSchema).min(1).max(100),
  })
  .strict()
  .superRefine((settings, context) => {
    const normalised = settings.options.map((option) =>
      option.normalize("NFKC").toLocaleLowerCase("en"),
    );
    if (new Set(normalised).size !== normalised.length) {
      context.addIssue({
        code: "custom",
        message: "Field options must be unique.",
        path: ["options"],
      });
    }
  });
const currencySettingsSchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();

const draftFieldBase = {
  reference: referenceSchema("draft_field", 60),
  source_step_references: draftSourceStepReferencesSchema,
  object_reference: draftObjectReferenceSchema,
  label: labelSchema,
  required: z.boolean(),
};

function draftFieldWithSettings(
  fieldType: z.infer<typeof graphFieldTypeSchema>,
  settings:
    | typeof emptySettingsSchema
    | typeof optionsSettingsSchema
    | typeof currencySettingsSchema,
) {
  return z
    .object({
      ...draftFieldBase,
      field_type: z.literal(fieldType),
      settings,
    })
    .strict();
}

export const draftFieldSchema = z.discriminatedUnion("field_type", [
  draftFieldWithSettings("short_text", emptySettingsSchema),
  draftFieldWithSettings("long_text", emptySettingsSchema),
  draftFieldWithSettings("number", emptySettingsSchema),
  draftFieldWithSettings("currency", currencySettingsSchema),
  draftFieldWithSettings("boolean", emptySettingsSchema),
  draftFieldWithSettings("date", emptySettingsSchema),
  draftFieldWithSettings("datetime", emptySettingsSchema),
  draftFieldWithSettings("email", emptySettingsSchema),
  draftFieldWithSettings("phone", emptySettingsSchema),
  draftFieldWithSettings("url", emptySettingsSchema),
  draftFieldWithSettings("select", optionsSettingsSchema),
  draftFieldWithSettings("multi_select", optionsSettingsSchema),
  draftFieldWithSettings("file", emptySettingsSchema),
  draftFieldWithSettings("status", optionsSettingsSchema),
]);

export const draftRelationshipSchema = z
  .object({
    reference: referenceSchema("draft_relationship", 60),
    source_step_references: draftSourceStepReferencesSchema,
    source_object_reference: draftObjectReferenceSchema,
    target_object_reference: draftObjectReferenceSchema,
    source_label: labelSchema,
    target_label: labelSchema,
    cardinality: relationshipCardinalitySchema,
    is_required: z.boolean(),
  })
  .strict();

const tableViewConfigurationSchema = z
  .object({
    fields: z.array(draftFieldReferenceSchema).min(1).max(50),
    title_field: draftFieldReferenceSchema.nullable(),
    create_form_reference: draftFormReferenceSchema.nullable(),
    edit_form_reference: draftFormReferenceSchema.nullable(),
  })
  .strict();

const listViewConfigurationSchema = z
  .object({
    primary_field: draftFieldReferenceSchema,
    secondary_fields: z.array(draftFieldReferenceSchema).max(50),
    create_form_reference: draftFormReferenceSchema.nullable(),
    edit_form_reference: draftFormReferenceSchema.nullable(),
  })
  .strict();

const cardsViewConfigurationSchema = z
  .object({
    title_field: draftFieldReferenceSchema,
    subtitle_field: draftFieldReferenceSchema.nullable(),
    image_field: draftFieldReferenceSchema.nullable(),
    supporting_fields: z.array(draftFieldReferenceSchema).max(50),
    create_form_reference: draftFormReferenceSchema.nullable(),
    edit_form_reference: draftFormReferenceSchema.nullable(),
  })
  .strict();

const detailViewConfigurationSchema = z
  .object({
    fields: z.array(draftFieldReferenceSchema).min(1).max(50),
    title_field: draftFieldReferenceSchema.nullable(),
    edit_form_reference: draftFormReferenceSchema.nullable(),
  })
  .strict();

const draftViewBase = {
  reference: referenceSchema("draft_view", 60),
  source_step_references: draftSourceStepReferencesSchema,
  name: labelSchema,
  audience: experienceAudienceSchema,
  object_reference: draftObjectReferenceSchema,
};

export const draftViewSchema = z.discriminatedUnion("view_type", [
  z
    .object({
      ...draftViewBase,
      view_type: z.literal("table"),
      configuration: tableViewConfigurationSchema,
    })
    .strict(),
  z
    .object({
      ...draftViewBase,
      view_type: z.literal("list"),
      configuration: listViewConfigurationSchema,
    })
    .strict(),
  z
    .object({
      ...draftViewBase,
      view_type: z.literal("cards"),
      configuration: cardsViewConfigurationSchema,
    })
    .strict(),
  z
    .object({
      ...draftViewBase,
      view_type: z.literal("detail"),
      configuration: detailViewConfigurationSchema,
    })
    .strict(),
]);

const draftFormFieldSchema = z
  .object({
    field_reference: draftFieldReferenceSchema,
    label: labelSchema.nullable(),
    help_text: z.string().trim().min(1).max(500).nullable(),
  })
  .strict();

export const draftFormSchema = z
  .object({
    reference: referenceSchema("draft_form", 60),
    source_step_references: draftSourceStepReferencesSchema,
    name: labelSchema,
    object_reference: draftObjectReferenceSchema,
    mode: experienceFormModeSchema,
    audience: experienceAudienceSchema,
    fields: z.array(draftFormFieldSchema).min(1).max(50),
    submit_label: labelSchema.nullable(),
  })
  .strict();

const draftHeadingBlockSchema = z
  .object({
    type: z.literal("heading"),
    text: z.string().trim().min(1).max(200),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  })
  .strict();

const draftTextBlockSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().trim().min(1).max(5_000),
  })
  .strict();

const draftViewBlockSchema = z
  .object({
    type: z.literal("view"),
    view_reference: draftViewReferenceSchema,
  })
  .strict();

const draftFormBlockSchema = z
  .object({
    type: z.literal("form"),
    form_reference: draftFormReferenceSchema,
  })
  .strict();

const draftDividerBlockSchema = z
  .object({ type: z.literal("divider") })
  .strict();

export const draftPageBlockSchema = z.discriminatedUnion("type", [
  draftHeadingBlockSchema,
  draftTextBlockSchema,
  draftViewBlockSchema,
  draftFormBlockSchema,
  draftDividerBlockSchema,
]);

export const draftPageSchema = z
  .object({
    reference: referenceSchema("draft_page", 60),
    source_step_references: draftSourceStepReferencesSchema,
    title: labelSchema,
    audience: experienceAudienceSchema,
    blocks: z
      .array(draftPageBlockSchema)
      .min(1)
      .max(BUILDER_CONFIGURATION_DRAFT_MAX_PAGE_BLOCKS),
  })
  .strict();

export const builderConfigurationDraftOutputSchema = z
  .object({
    schema_version: z.literal(BUILDER_CONFIGURATION_DRAFT_SCHEMA_VERSION),
    summary: ownerReadableTextSchema.max(2_000),
    objects: z
      .array(draftObjectSchema)
      .max(BUILDER_CONFIGURATION_DRAFT_MAX_OBJECTS),
    fields: z
      .array(draftFieldSchema)
      .max(BUILDER_CONFIGURATION_DRAFT_MAX_FIELDS),
    relationships: z
      .array(draftRelationshipSchema)
      .max(BUILDER_CONFIGURATION_DRAFT_MAX_RELATIONSHIPS),
    views: z.array(draftViewSchema).max(BUILDER_CONFIGURATION_DRAFT_MAX_VIEWS),
    forms: z.array(draftFormSchema).max(BUILDER_CONFIGURATION_DRAFT_MAX_FORMS),
    pages: z.array(draftPageSchema).max(BUILDER_CONFIGURATION_DRAFT_MAX_PAGES),
  })
  .strict();

export const builderConfigurationDraftTaskInputBaseSchema = z
  .object({
    schema_version: z.literal(BUILDER_CONFIGURATION_DRAFT_SCHEMA_VERSION),
    owner_request: builderPlanTaskInputSchema.shape.owner_request,
    business_context: aiBusinessModelContextV1Schema,
    ready_plan: builderPlanOutputSchema,
  })
  .strict();

export type BuilderConfigurationDraftTaskInput = z.infer<
  typeof builderConfigurationDraftTaskInputBaseSchema
>;
export type BuilderConfigurationDraftReadyTaskInput = Omit<
  BuilderConfigurationDraftTaskInput,
  "ready_plan"
> & {
  ready_plan: Extract<
    BuilderConfigurationDraftTaskInput["ready_plan"],
    { state: "ready" }
  >;
};
export type BuilderConfigurationDraftOutput = z.infer<
  typeof builderConfigurationDraftOutputSchema
>;
export type DraftObject = z.infer<typeof draftObjectSchema>;
export type DraftField = z.infer<typeof draftFieldSchema>;
export type DraftRelationship = z.infer<typeof draftRelationshipSchema>;
export type DraftView = z.infer<typeof draftViewSchema>;
export type DraftForm = z.infer<typeof draftFormSchema>;
export type DraftPage = z.infer<typeof draftPageSchema>;
export type DraftObjectReference = z.infer<typeof draftObjectReferenceSchema>;
export type DraftFieldReference = z.infer<typeof draftFieldReferenceSchema>;
export type DraftViewReference = z.infer<typeof draftViewReferenceSchema>;
export type DraftFormReference = z.infer<typeof draftFormReferenceSchema>;
