import { z } from "zod";

import type { Json } from "../../db/supabase/database.types";

export const graphKeySchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_]*$/);

export const objectDefinitionKindSchema = z.enum(["template", "custom"]);

export const graphFieldTypeSchema = z.enum([
  "short_text",
  "long_text",
  "number",
  "currency",
  "boolean",
  "date",
  "datetime",
  "email",
  "phone",
  "url",
  "select",
  "multi_select",
  "file",
  "status",
]);

export const relationshipCardinalitySchema = z.enum([
  "one_to_one",
  "one_to_many",
  "many_to_many",
]);

export const graphRecordStatusSchema = z.enum(["active", "archived"]);

export const jsonValueSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

const labelSchema = z.string().trim().min(1).max(120);
const optionalMetadataSchema = z.string().trim().min(1).max(120).nullable();

export const createObjectDefinitionSchema = z.object({
  key: graphKeySchema,
  singularLabel: labelSchema,
  pluralLabel: labelSchema,
  description: z.string().default(""),
  kind: objectDefinitionKindSchema,
  semanticType: optionalMetadataSchema.default(null),
  icon: optionalMetadataSchema.default(null),
  isActive: z.boolean().default(true),
});

export const updateObjectDefinitionSchema = z.object({
  objectDefinitionId: z.uuid(),
  changes: z
    .object({
      singularLabel: labelSchema.optional(),
      pluralLabel: labelSchema.optional(),
      description: z.string().optional(),
      semanticType: optionalMetadataSchema.optional(),
      icon: optionalMetadataSchema.optional(),
      isActive: z.boolean().optional(),
    })
    .refine((changes) => Object.keys(changes).length > 0, {
      message: "At least one object definition change is required.",
    }),
});

export const createFieldDefinitionSchema = z.object({
  objectDefinitionId: z.uuid(),
  key: graphKeySchema,
  label: labelSchema,
  fieldType: graphFieldTypeSchema,
  required: z.boolean().default(false),
  defaultValue: jsonValueSchema.nullable().default(null),
  settings: jsonObjectSchema.default({}),
  position: z.number().int().nonnegative().default(0),
  isActive: z.boolean().default(true),
});

export const updateFieldDefinitionSchema = z.object({
  fieldDefinitionId: z.uuid(),
  changes: z
    .object({
      label: labelSchema.optional(),
      fieldType: graphFieldTypeSchema.optional(),
      required: z.boolean().optional(),
      defaultValue: jsonValueSchema.nullable().optional(),
      settings: jsonObjectSchema.optional(),
      position: z.number().int().nonnegative().optional(),
      isActive: z.boolean().optional(),
    })
    .refine((changes) => Object.keys(changes).length > 0, {
      message: "At least one field definition change is required.",
    }),
});

export const createRelationshipDefinitionSchema = z.object({
  key: graphKeySchema,
  sourceObjectDefinitionId: z.uuid(),
  targetObjectDefinitionId: z.uuid(),
  sourceLabel: labelSchema,
  targetLabel: labelSchema,
  cardinality: relationshipCardinalitySchema,
  isRequired: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const createRecordSchema = z.object({
  objectDefinitionId: z.uuid(),
  data: jsonObjectSchema,
  recordStatus: graphRecordStatusSchema.default("active"),
});

export const updateRecordSchema = z.object({
  recordId: z.uuid(),
  dataPatch: jsonObjectSchema.default({}),
  recordStatus: graphRecordStatusSchema.optional(),
});

export const createRecordRelationshipSchema = z.object({
  relationshipDefinitionId: z.uuid(),
  sourceRecordId: z.uuid(),
  targetRecordId: z.uuid(),
});

export const queryRecordsSchema = z.object({
  objectDefinitionId: z.uuid(),
  includeArchived: z.boolean().default(false),
});

export type CreateObjectDefinitionInput = z.input<
  typeof createObjectDefinitionSchema
>;
export type UpdateObjectDefinitionInput = z.input<
  typeof updateObjectDefinitionSchema
>;
export type CreateFieldDefinitionInput = z.input<
  typeof createFieldDefinitionSchema
>;
export type UpdateFieldDefinitionInput = z.input<
  typeof updateFieldDefinitionSchema
>;
export type CreateRelationshipDefinitionInput = z.input<
  typeof createRelationshipDefinitionSchema
>;
export type CreateRecordInput = z.input<typeof createRecordSchema>;
export type UpdateRecordInput = z.input<typeof updateRecordSchema>;
export type CreateRecordRelationshipInput = z.input<
  typeof createRecordRelationshipSchema
>;
export type QueryRecordsInput = z.input<typeof queryRecordsSchema>;
