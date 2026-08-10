import { z } from "zod";

import { tableViewQuerySchema } from "../../experience/schemas";
import { graphKeySchema } from "../../graph/schemas";

const directTableLabelSchema = z.string().trim().min(1).max(120);

export const directTableColumnTypeSchema = z.enum([
  "short_text",
  "long_text",
  "number",
  "currency",
  "boolean",
  "date",
  "email",
  "phone",
  "url",
  "select",
  "status",
]);

export const directTableActionKindSchema = z.enum([
  "create_table",
  "rename_table",
  "add_column",
  "insert_column",
  "rename_column",
  "change_column_type",
  "update_column_options",
  "reorder_columns",
  "resize_column",
  "create_connection_property",
  "add_existing_connection_property",
  "rename_connection_property",
  "create_saved_view",
  "duplicate_saved_view",
  "rename_saved_view",
  "update_view_query",
  "archive_saved_view",
]);

const directTableOptionsSchema = z
  .array(directTableLabelSchema)
  .min(2)
  .max(100)
  .superRefine((options, context) => {
    const normalized = options.map((option) =>
      option.normalize("NFKC").toLocaleLowerCase("en"),
    );
    if (new Set(normalized).size !== normalized.length) {
      context.addIssue({
        code: "custom",
        message: "Options must be different.",
      });
    }
  });

const createTableIntentSchema = z
  .object({
    action: z.literal("create_table"),
    title: directTableLabelSchema,
  })
  .strict();

const renameTableIntentSchema = z
  .object({
    action: z.literal("rename_table"),
    viewKey: graphKeySchema,
    title: directTableLabelSchema,
  })
  .strict();

const addColumnIntentSchema = z
  .object({
    action: z.literal("add_column"),
    viewKey: graphKeySchema,
    label: directTableLabelSchema,
    columnType: directTableColumnTypeSchema,
    options: directTableOptionsSchema.optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.options &&
      input.columnType !== "select" &&
      input.columnType !== "status"
    ) {
      context.addIssue({
        code: "custom",
        message: "Only Choice and Status columns can have options.",
        path: ["options"],
      });
    }
    if (
      (input.columnType === "select" || input.columnType === "status") &&
      !input.options
    ) {
      context.addIssue({
        code: "custom",
        message: "Choice and Status columns need at least two options.",
        path: ["options"],
      });
    }
    if (input.columnType === "currency" && input.currency === undefined) {
      context.addIssue({
        code: "custom",
        message: "Currency columns need a currency code.",
        path: ["currency"],
      });
    }
    if (input.columnType !== "currency" && input.currency !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Currency metadata is only valid for Currency columns.",
        path: ["currency"],
      });
    }
  });

const insertColumnIntentSchema = z
  .object({
    action: z.literal("insert_column"),
    viewKey: graphKeySchema,
    anchorFieldKey: graphKeySchema,
    position: z.enum(["left", "right"]),
    label: directTableLabelSchema,
    columnType: directTableColumnTypeSchema,
    options: directTableOptionsSchema.optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const optionColumn =
      input.columnType === "select" || input.columnType === "status";
    if (optionColumn !== Boolean(input.options)) {
      context.addIssue({
        code: "custom",
        message: optionColumn
          ? "Choice and Status columns need options."
          : "Only Choice and Status columns can have options.",
        path: ["options"],
      });
    }
    if (input.columnType !== "currency" && input.currency !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Currency metadata is only valid for Currency columns.",
        path: ["currency"],
      });
    }
    if (input.columnType === "currency" && input.currency === undefined) {
      context.addIssue({
        code: "custom",
        message: "Currency columns need a currency code.",
        path: ["currency"],
      });
    }
  });

const renameColumnIntentSchema = z
  .object({
    action: z.literal("rename_column"),
    viewKey: graphKeySchema,
    fieldKey: graphKeySchema,
    label: directTableLabelSchema,
  })
  .strict();

const changeColumnTypeIntentSchema = z
  .object({
    action: z.literal("change_column_type"),
    viewKey: graphKeySchema,
    fieldKey: graphKeySchema,
    columnType: directTableColumnTypeSchema,
    options: directTableOptionsSchema.optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const optionColumn =
      input.columnType === "select" || input.columnType === "status";
    if (optionColumn !== Boolean(input.options)) {
      context.addIssue({
        code: "custom",
        message: optionColumn
          ? "Choice and Status columns need options."
          : "Only Choice and Status columns can have options.",
        path: ["options"],
      });
    }
    if (input.columnType !== "currency" && input.currency !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Currency metadata is only valid for Currency columns.",
        path: ["currency"],
      });
    }
    if (input.columnType === "currency" && input.currency === undefined) {
      context.addIssue({
        code: "custom",
        message: "Currency columns need a currency code.",
        path: ["currency"],
      });
    }
  });

const updateColumnOptionsIntentSchema = z
  .object({
    action: z.literal("update_column_options"),
    viewKey: graphKeySchema,
    fieldKey: graphKeySchema,
    options: directTableOptionsSchema,
  })
  .strict();

const reorderColumnsIntentSchema = z
  .object({
    action: z.literal("reorder_columns"),
    viewKey: graphKeySchema,
    fieldKeys: z.array(graphKeySchema).min(1).max(50),
  })
  .strict();

const resizeColumnIntentSchema = z
  .object({
    action: z.literal("resize_column"),
    viewKey: graphKeySchema,
    fieldKey: graphKeySchema,
    width: z.number().int().min(128).max(640),
  })
  .strict();

const connectionModeSchema = z.enum([
  "one_record",
  "several_records",
  "single",
  "multiple",
]);

const createConnectionPropertyIntentSchema = z
  .object({
    action: z.literal("create_connection_property"),
    viewKey: graphKeySchema,
    targetViewKey: graphKeySchema,
    label: directTableLabelSchema,
    mode: connectionModeSchema,
    reverseLabel: directTableLabelSchema.optional(),
    addReverse: z.boolean().default(true),
  })
  .strict();

const addExistingConnectionPropertyIntentSchema = z
  .object({
    action: z.literal("add_existing_connection_property"),
    viewKey: graphKeySchema,
    relationshipKey: graphKeySchema,
    direction: z.enum(["source", "target"]).optional(),
    label: directTableLabelSchema.optional(),
  })
  .strict();

const renameConnectionPropertyIntentSchema = z
  .object({
    action: z.literal("rename_connection_property"),
    viewKey: graphKeySchema,
    relationshipKey: graphKeySchema,
    direction: z.enum(["source", "target"]),
    label: directTableLabelSchema,
  })
  .strict();

const createSavedViewIntentSchema = z
  .object({
    action: z.literal("create_saved_view"),
    sourceViewKey: graphKeySchema,
    name: directTableLabelSchema,
  })
  .strict();

const duplicateSavedViewIntentSchema = z
  .object({
    action: z.literal("duplicate_saved_view"),
    sourceViewKey: graphKeySchema,
    name: directTableLabelSchema,
  })
  .strict();

const renameSavedViewIntentSchema = z
  .object({
    action: z.literal("rename_saved_view"),
    viewKey: graphKeySchema,
    name: directTableLabelSchema,
  })
  .strict();

const updateViewQueryIntentSchema = z
  .object({
    action: z.literal("update_view_query"),
    viewKey: graphKeySchema,
    query: tableViewQuerySchema,
  })
  .strict();

const archiveSavedViewIntentSchema = z
  .object({
    action: z.literal("archive_saved_view"),
    viewKey: graphKeySchema,
  })
  .strict();

export const directTableIntentSchema = z.discriminatedUnion("action", [
  createTableIntentSchema,
  renameTableIntentSchema,
  addColumnIntentSchema,
  insertColumnIntentSchema,
  renameColumnIntentSchema,
  changeColumnTypeIntentSchema,
  updateColumnOptionsIntentSchema,
  reorderColumnsIntentSchema,
  resizeColumnIntentSchema,
  createConnectionPropertyIntentSchema,
  addExistingConnectionPropertyIntentSchema,
  renameConnectionPropertyIntentSchema,
  createSavedViewIntentSchema,
  duplicateSavedViewIntentSchema,
  renameSavedViewIntentSchema,
  updateViewQueryIntentSchema,
  archiveSavedViewIntentSchema,
]);

export const directTableCurrentnessSchema = z
  .object({
    expectedBaseVersionId: z.uuid(),
    expectedHeadRevision: z.number().int().positive(),
  })
  .strict();

export const directTableUndoIntentSchema = z
  .object({
    expectedActiveSourceVersionId: z.uuid(),
    expectedHeadRevision: z.number().int().positive(),
  })
  .strict();

export type DirectTableIntent = z.infer<typeof directTableIntentSchema>;
export type DirectTableActionKind = z.infer<typeof directTableActionKindSchema>;
export type DirectTableColumnType = z.infer<typeof directTableColumnTypeSchema>;
export type DirectTableCurrentness = z.infer<
  typeof directTableCurrentnessSchema
>;
export type DirectTableUndoIntent = z.infer<typeof directTableUndoIntentSchema>;
