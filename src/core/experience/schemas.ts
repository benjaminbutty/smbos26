import { z } from "zod";

import type { Json } from "../../db/supabase/database.types";
import {
  graphKeySchema,
  jsonObjectSchema,
  jsonValueSchema,
} from "../graph/schemas";

export const experienceAudienceSchema = z.enum(["internal", "public"]);
export const experienceViewTypeSchema = z.enum([
  "table",
  "list",
  "cards",
  "detail",
]);
export const experienceFormModeSchema = z.enum(["create", "edit"]);
export const experiencePageStatusSchema = z.enum(["draft", "published"]);

const labelSchema = z.string().trim().min(1).max(120);
const fieldKeysSchema = z.array(graphKeySchema).min(1).max(50);
const optionalFieldKeysSchema = z.array(graphKeySchema).max(50);

const viewActionsSchema = {
  create_form_key: graphKeySchema.optional(),
  edit_form_key: graphKeySchema.optional(),
  include_archived: z.boolean().default(false),
};

export const tableViewConfigSchema = z
  .object({
    fields: fieldKeysSchema,
    title_field: graphKeySchema.optional(),
    column_widths: z
      .record(graphKeySchema, z.number().int().min(128).max(640))
      .optional(),
    ...viewActionsSchema,
  })
  .strict()
  .superRefine((config, context) => {
    if (!config.column_widths) {
      return;
    }

    const visibleFields = new Set(config.fields);
    for (const fieldKey of Object.keys(config.column_widths)) {
      if (!visibleFields.has(fieldKey)) {
        context.addIssue({
          code: "custom",
          message: "Column widths can only be set for visible Table columns.",
          path: ["column_widths", fieldKey],
        });
      }
    }
  });

export const listViewConfigSchema = z
  .object({
    primary_field: graphKeySchema,
    secondary_fields: optionalFieldKeysSchema.default([]),
    ...viewActionsSchema,
  })
  .strict();

export const cardsViewConfigSchema = z
  .object({
    title_field: graphKeySchema,
    subtitle_field: graphKeySchema.optional(),
    image_field: graphKeySchema.optional(),
    supporting_fields: optionalFieldKeysSchema.default([]),
    ...viewActionsSchema,
  })
  .strict();

export const detailViewConfigSchema = z
  .object({
    fields: fieldKeysSchema,
    title_field: graphKeySchema.optional(),
    edit_form_key: graphKeySchema.optional(),
    include_archived: z.boolean().default(false),
  })
  .strict();

export type TableViewConfig = z.infer<typeof tableViewConfigSchema>;
export type ListViewConfig = z.infer<typeof listViewConfigSchema>;
export type CardsViewConfig = z.infer<typeof cardsViewConfigSchema>;
export type DetailViewConfig = z.infer<typeof detailViewConfigSchema>;
export type ViewConfig =
  TableViewConfig | ListViewConfig | CardsViewConfig | DetailViewConfig;

export function parseViewConfig(
  viewType: z.infer<typeof experienceViewTypeSchema>,
  input: unknown,
): ViewConfig {
  switch (viewType) {
    case "table":
      return tableViewConfigSchema.parse(input);
    case "list":
      return listViewConfigSchema.parse(input);
    case "cards":
      return cardsViewConfigSchema.parse(input);
    case "detail":
      return detailViewConfigSchema.parse(input);
  }
}

export const formFieldConfigSchema = z
  .object({
    field: graphKeySchema,
    label: labelSchema.optional(),
    help_text: z.string().trim().min(1).max(500).optional(),
    hidden: z.boolean().default(false),
    default_value: jsonValueSchema.optional(),
  })
  .strict()
  .superRefine((field, context) => {
    if (
      field.hidden &&
      (field.default_value === undefined ||
        field.default_value === null ||
        field.default_value === "")
    ) {
      context.addIssue({
        code: "custom",
        message: "Hidden fields require a usable default value.",
        path: ["default_value"],
      });
    }
  });

export const formConfigSchema = z
  .object({
    fields: z
      .array(formFieldConfigSchema)
      .min(1)
      .max(50)
      .superRefine((fields, context) => {
        const keys = fields.map(({ field }) => field);
        if (new Set(keys).size !== keys.length) {
          context.addIssue({
            code: "custom",
            message: "A field can only appear once in a form.",
          });
        }
      }),
    submit_label: labelSchema.optional(),
  })
  .strict();

const safeHrefSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(
    (value) => /^(?:https?:\/\/|\/|mailto:|tel:)\S+$/i.test(value),
    "Use a safe web, relative, email, or telephone link.",
  );

const pageBlockIdSchema = z.uuid();

const headingBlockSchema = z
  .object({
    type: z.literal("heading"),
    text: z.string().trim().min(1).max(200),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
    id: pageBlockIdSchema.optional(),
  })
  .strict();

const textBlockSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().trim().min(1).max(5000),
    id: pageBlockIdSchema.optional(),
  })
  .strict();

const imageBlockSchema = z
  .object({
    type: z.literal("image"),
    src: z.httpUrl().max(2048),
    alt: z.string().trim().min(1).max(300),
    caption: z.string().trim().min(1).max(500).optional(),
    id: pageBlockIdSchema.optional(),
  })
  .strict();

const buttonBlockSchema = z
  .object({
    type: z.literal("button"),
    label: labelSchema,
    href: safeHrefSchema,
    style: z.enum(["primary", "secondary"]).default("primary"),
    id: pageBlockIdSchema.optional(),
  })
  .strict();

const viewBlockSchema = z
  .object({
    type: z.literal("view"),
    view_key: graphKeySchema,
    read_only: z.boolean().optional(),
    id: pageBlockIdSchema.optional(),
  })
  .strict();

const formBlockSchema = z
  .object({
    type: z.literal("form"),
    form_key: graphKeySchema,
    id: pageBlockIdSchema.optional(),
  })
  .strict();

const preorderBlockSchema = z
  .object({
    type: z.literal("preorder"),
    preorder_key: graphKeySchema,
    id: pageBlockIdSchema.optional(),
  })
  .strict();

const dividerBlockSchema = z
  .object({ type: z.literal("divider"), id: pageBlockIdSchema.optional() })
  .strict();

const calloutBlockSchema = z
  .object({
    type: z.literal("callout"),
    text: z.string().trim().min(1).max(1_000),
    tone: z.enum(["neutral", "info", "success", "warning"]).default("info"),
    id: pageBlockIdSchema.optional(),
  })
  .strict();

export const pageBlockSchema = z.discriminatedUnion("type", [
  headingBlockSchema,
  textBlockSchema,
  imageBlockSchema,
  buttonBlockSchema,
  viewBlockSchema,
  formBlockSchema,
  preorderBlockSchema,
  dividerBlockSchema,
  calloutBlockSchema,
]);

export const pageLayoutSchema = z
  .object({
    blocks: z.array(pageBlockSchema).max(100),
  })
  .strict()
  .superRefine((layout, context) => {
    const ids = layout.blocks.flatMap((block) =>
      "id" in block && block.id ? [block.id] : [],
    );
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Page blocks must use unique IDs.",
        path: ["blocks"],
      });
    }
  });

export const createViewDefinitionSchema = z
  .object({
    key: graphKeySchema,
    name: labelSchema,
    viewType: experienceViewTypeSchema,
    objectDefinitionId: z.uuid(),
    config: jsonObjectSchema,
    audience: experienceAudienceSchema.default("internal"),
    isActive: z.boolean().default(true),
  })
  .superRefine((definition, context) => {
    const parsed = z
      .custom<ViewConfig>((value) => {
        try {
          parseViewConfig(definition.viewType, value);
          return true;
        } catch {
          return false;
        }
      })
      .safeParse(definition.config);

    if (!parsed.success) {
      context.addIssue({
        code: "custom",
        message: "The View configuration does not match its View type.",
        path: ["config"],
      });
    }
  });

export const updateViewDefinitionSchema = z.object({
  viewDefinitionId: z.uuid(),
  changes: z
    .object({
      name: labelSchema.optional(),
      viewType: experienceViewTypeSchema.optional(),
      config: jsonObjectSchema.optional(),
      audience: experienceAudienceSchema.optional(),
      isActive: z.boolean().optional(),
    })
    .refine((changes) => Object.keys(changes).length > 0, {
      message: "At least one View change is required.",
    }),
});

export const createFormDefinitionSchema = z.object({
  key: graphKeySchema,
  name: labelSchema,
  objectDefinitionId: z.uuid(),
  mode: experienceFormModeSchema,
  config: formConfigSchema,
  audience: experienceAudienceSchema.default("internal"),
  isActive: z.boolean().default(true),
});

export const updateFormDefinitionSchema = z.object({
  formDefinitionId: z.uuid(),
  changes: z
    .object({
      name: labelSchema.optional(),
      config: formConfigSchema.optional(),
      audience: experienceAudienceSchema.optional(),
      isActive: z.boolean().optional(),
    })
    .refine((changes) => Object.keys(changes).length > 0, {
      message: "At least one Form change is required.",
    }),
});

export const createPageDefinitionSchema = z.object({
  key: graphKeySchema,
  title: labelSchema,
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  audience: experienceAudienceSchema,
  layout: pageLayoutSchema,
  status: experiencePageStatusSchema.default("draft"),
  isActive: z.boolean().default(true),
});

export const updatePageDefinitionSchema = z.object({
  pageDefinitionId: z.uuid(),
  changes: z
    .object({
      title: labelSchema.optional(),
      slug: z
        .string()
        .min(1)
        .max(80)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        .optional(),
      audience: experienceAudienceSchema.optional(),
      layout: pageLayoutSchema.optional(),
      status: experiencePageStatusSchema.optional(),
      isActive: z.boolean().optional(),
    })
    .refine((changes) => Object.keys(changes).length > 0, {
      message: "At least one Page change is required.",
    }),
});

export type ExperienceAudience = z.infer<typeof experienceAudienceSchema>;
export type ExperienceViewType = z.infer<typeof experienceViewTypeSchema>;
export type FormConfig = z.infer<typeof formConfigSchema>;
export type FormFieldConfig = z.infer<typeof formFieldConfigSchema>;
export type PageBlock = z.infer<typeof pageBlockSchema>;
export type PageLayout = z.infer<typeof pageLayoutSchema>;
export type CreateViewDefinitionInput = z.input<
  typeof createViewDefinitionSchema
>;
export type UpdateViewDefinitionInput = z.input<
  typeof updateViewDefinitionSchema
>;
export type CreateFormDefinitionInput = z.input<
  typeof createFormDefinitionSchema
>;
export type UpdateFormDefinitionInput = z.input<
  typeof updateFormDefinitionSchema
>;
export type CreatePageDefinitionInput = z.input<
  typeof createPageDefinitionSchema
>;
export type UpdatePageDefinitionInput = z.input<
  typeof updatePageDefinitionSchema
>;

export function toJson(value: unknown): Json {
  return jsonValueSchema.parse(value);
}
