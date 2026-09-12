import { z } from "zod";

import type { Json } from "../../db/supabase/database.types";
import { bookingBlockSchema, publicFormBlockSchema } from "../booking/schemas";
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

export const tableViewRoleSchema = z.enum(["primary", "saved"]);
export const tableViewColumnDirectionSchema = z.enum(["source", "target"]);

export const tableViewFieldColumnSchema = z
  .object({
    kind: z.literal("field"),
    field_key: graphKeySchema,
  })
  .strict();

export const tableViewConnectionColumnSchema = z
  .object({
    kind: z.literal("connection"),
    relationship_key: graphKeySchema,
    direction: tableViewColumnDirectionSchema,
    label: labelSchema.optional(),
  })
  .strict();

/**
 * A read-only, one-hop value displayed from a single connected Record. This is
 * deliberately a View projection rather than a Field: the value is never
 * copied into the source Record and cannot be edited through the source Table.
 */
export const tableViewConnectedFieldColumnSchema = z
  .object({
    kind: z.literal("connected_field"),
    relationship_key: graphKeySchema,
    direction: tableViewColumnDirectionSchema,
    target_field_key: graphKeySchema,
    label: labelSchema.optional(),
  })
  .strict();

export const tableViewColumnSchema = z.discriminatedUnion("kind", [
  tableViewFieldColumnSchema,
  tableViewConnectionColumnSchema,
  tableViewConnectedFieldColumnSchema,
]);

const tableViewPropertyKeyPattern =
  /^(?:field:[a-z][a-z0-9_]{0,79}|connection:[a-z][a-z0-9_]{0,79}:(?:source|target))$/;

export const tableViewPropertyKeySchema = z
  .string()
  .regex(tableViewPropertyKeyPattern);

const tableViewColumnReferenceKeyPattern =
  /^(?:field:[a-z][a-z0-9_]{0,79}|connection:[a-z][a-z0-9_]{0,79}:(?:source|target)|connected_field:[a-z][a-z0-9_]{0,79}:(?:source|target):[a-z][a-z0-9_]{0,79})$/;

/** A complete Table column identity, used for layout-only ordering. */
export const tableViewColumnReferenceKeySchema = z
  .string()
  .regex(tableViewColumnReferenceKeyPattern);

export type TableViewPropertyKey = z.infer<typeof tableViewPropertyKeySchema>;

export type ParsedTableViewPropertyKey =
  | { kind: "field"; fieldKey: string }
  | {
      kind: "connection";
      relationshipKey: string;
      direction: "source" | "target";
    };

export function tableViewFieldPropertyKey(fieldKey: string): string {
  return `field:${graphKeySchema.parse(fieldKey)}`;
}

export function tableViewConnectionPropertyKey(
  relationshipKey: string,
  direction: "source" | "target",
): string {
  return `connection:${graphKeySchema.parse(relationshipKey)}:${direction}`;
}

export function tableViewConnectedFieldColumnKey(
  relationshipKey: string,
  direction: "source" | "target",
  targetFieldKey: string,
): string {
  return `connected_field:${graphKeySchema.parse(relationshipKey)}:${direction}:${graphKeySchema.parse(targetFieldKey)}`;
}

export function tableViewColumnReferenceKey(column: TableViewColumn): string {
  if (column.kind === "field") {
    return tableViewFieldPropertyKey(column.field_key);
  }
  if (column.kind === "connection") {
    return tableViewConnectionPropertyKey(
      column.relationship_key,
      column.direction,
    );
  }
  return tableViewConnectedFieldColumnKey(
    column.relationship_key,
    column.direction,
    column.target_field_key,
  );
}

/**
 * Field widths retain their historical Field-key storage. Mixed columns use a
 * stable canonical key so immutable V1/V2 snapshots need no rewrite.
 */
export function tableViewColumnWidthKey(column: TableViewColumn): string {
  if (column.kind === "field") return column.field_key;
  if (column.kind === "connection") {
    return tableViewConnectionPropertyKey(
      column.relationship_key,
      column.direction,
    );
  }
  return tableViewConnectedFieldColumnKey(
    column.relationship_key,
    column.direction,
    column.target_field_key,
  );
}

export const tableViewColumnWidthKeySchema = z
  .string()
  .regex(
    /^(?:[a-z][a-z0-9_]{0,79}|connection:[a-z][a-z0-9_]{0,79}:(?:source|target)|connected_field:[a-z][a-z0-9_]{0,79}:(?:source|target):[a-z][a-z0-9_]{0,79})$/,
  );

export function parseTableViewPropertyKey(
  propertyKey: string,
): ParsedTableViewPropertyKey | null {
  if (!tableViewPropertyKeySchema.safeParse(propertyKey).success) {
    return null;
  }
  const [kind, key, direction] = propertyKey.split(":");
  if (kind === "field" && key) {
    return { kind, fieldKey: key };
  }
  if (
    kind === "connection" &&
    key &&
    (direction === "source" || direction === "target")
  ) {
    return { kind, relationshipKey: key, direction };
  }
  return null;
}

export const tableViewFilterOperatorSchema = z.enum([
  "is",
  "is_not",
  "contains",
  "does_not_contain",
  "is_empty",
  "is_not_empty",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "on_or_before",
  "on_or_after",
  "between",
  "is_any_of",
  "contains_any",
  "contains_all",
  "is_yes",
  "is_no",
]);

export const tableViewRelativeDateSchema = z
  .object({
    unit: z.enum(["day", "week", "month"]),
    amount: z.number().int().min(-3650).max(3650),
  })
  .strict();

const tableViewFilterValueSchema = z.union([
  jsonValueSchema,
  tableViewRelativeDateSchema,
]);

export const tableViewFilterSchema = z
  .object({
    property: tableViewPropertyKeySchema,
    operator: tableViewFilterOperatorSchema,
    value: tableViewFilterValueSchema.optional(),
    values: z.array(tableViewFilterValueSchema).max(100).optional(),
  })
  .strict()
  .superRefine((filter, context) => {
    const noValueOperators = new Set([
      "is_empty",
      "is_not_empty",
      "is_yes",
      "is_no",
    ]);
    const listOperators = new Set([
      "is_any_of",
      "contains_any",
      "contains_all",
    ]);
    const needsValue = !noValueOperators.has(filter.operator);
    if (needsValue && filter.value === undefined && !filter.values) {
      context.addIssue({
        code: "custom",
        message: "This filter needs a value.",
        path: ["value"],
      });
    }
    if (!needsValue && (filter.value !== undefined || filter.values)) {
      context.addIssue({
        code: "custom",
        message: "This filter does not accept a value.",
        path: ["value"],
      });
    }
    if (listOperators.has(filter.operator) && !filter.values) {
      context.addIssue({
        code: "custom",
        message: "This filter needs a list of values.",
        path: ["values"],
      });
    }
    if (!listOperators.has(filter.operator) && filter.values) {
      context.addIssue({
        code: "custom",
        message: "This filter accepts one value.",
        path: ["values"],
      });
    }
    if (filter.operator === "between" && filter.values?.length !== 2) {
      context.addIssue({
        code: "custom",
        message: "Between filters need exactly two values.",
        path: ["values"],
      });
    }
  });

export const tableViewSortSchema = z
  .object({
    property: tableViewPropertyKeySchema,
    direction: z.enum(["ascending", "descending"]),
  })
  .strict();

export const tableViewQuerySchema = z
  .object({
    filters: z.array(tableViewFilterSchema).max(20).default([]),
    filter_match: z.enum(["all", "any"]).default("all"),
    sorts: z.array(tableViewSortSchema).max(5).default([]),
    group: tableViewPropertyKeySchema.nullable().default(null),
  })
  .strict();

const viewActionsSchema = {
  create_form_key: graphKeySchema.optional(),
  edit_form_key: graphKeySchema.optional(),
  include_archived: z.boolean().default(false),
};

export const tableViewConfigV1Schema = z
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

const tableViewConfigV2InputSchema = z
  .object({
    schema_version: z.literal(2),
    role: tableViewRoleSchema,
    columns: z.array(tableViewColumnSchema).min(1).max(50),
    fields: fieldKeysSchema.optional(),
    title_field: graphKeySchema,
    column_widths: z
      .record(tableViewColumnWidthKeySchema, z.number().int().min(128).max(640))
      .optional(),
    ...viewActionsSchema,
    ...tableViewQuerySchema.shape,
  })
  .strict()
  .superRefine((config, context) => {
    if (!config.column_widths) return;
    const visibleColumns = new Set(
      config.columns.map((column) => tableViewColumnWidthKey(column)),
    );
    for (const columnKey of Object.keys(config.column_widths)) {
      if (!visibleColumns.has(columnKey)) {
        context.addIssue({
          code: "custom",
          message: "Column widths can only be set for visible Table columns.",
          path: ["column_widths", columnKey],
        });
      }
    }
  });

export const tableViewConfigSchema = z.union([
  tableViewConfigV1Schema,
  tableViewConfigV2InputSchema,
]);

export type TableViewColumn = z.infer<typeof tableViewColumnSchema>;
export type TableViewRole = z.infer<typeof tableViewRoleSchema>;
export type TableViewFilter = z.infer<typeof tableViewFilterSchema>;
export type TableViewSort = z.infer<typeof tableViewSortSchema>;
export type TableViewQuery = z.infer<typeof tableViewQuerySchema>;
export type TableViewConfigV1 = z.infer<typeof tableViewConfigV1Schema>;
export type TableViewConfigV2 = Omit<
  z.infer<typeof tableViewConfigV2InputSchema>,
  "fields"
> & { fields: string[] };
export type TableViewConfig = TableViewConfigV1 | TableViewConfigV2;

function fieldColumnKeys(columns: readonly TableViewColumn[]): string[] {
  return columns.flatMap((column) =>
    column.kind === "field" ? [column.field_key] : [],
  );
}

export function normalizeTableViewConfig(
  input: unknown,
  legacyRole: TableViewRole = "primary",
): TableViewConfigV2 {
  const parsed = tableViewConfigSchema.parse(input);
  if (!("schema_version" in parsed)) {
    const columns = parsed.fields.map((field_key) => ({
      kind: "field" as const,
      field_key,
    }));
    return {
      schema_version: 2,
      role: legacyRole,
      columns,
      fields: parsed.fields,
      title_field: parsed.title_field ?? parsed.fields[0]!,
      ...(parsed.column_widths ? { column_widths: parsed.column_widths } : {}),
      ...(parsed.create_form_key
        ? { create_form_key: parsed.create_form_key }
        : {}),
      ...(parsed.edit_form_key ? { edit_form_key: parsed.edit_form_key } : {}),
      include_archived: parsed.include_archived,
      filters: [],
      filter_match: "all",
      sorts: [],
      group: null,
    };
  }

  const fields = fieldColumnKeys(parsed.columns);
  if (parsed.fields && parsed.fields.join("\u001f") !== fields.join("\u001f")) {
    throw new z.ZodError([
      {
        code: "custom",
        message: "Table fields must match the field columns in order.",
        path: ["fields"],
      },
    ]);
  }
  const columnKeys = parsed.columns.map((column) => {
    if (column.kind === "field") return `field:${column.field_key}`;
    if (column.kind === "connection") {
      return `connection:${column.relationship_key}:${column.direction}`;
    }
    return tableViewConnectedFieldColumnKey(
      column.relationship_key,
      column.direction,
      column.target_field_key,
    );
  });
  if (new Set(columnKeys).size !== columnKeys.length) {
    throw new z.ZodError([
      {
        code: "custom",
        message: "A Table column can only appear once.",
        path: ["columns"],
      },
    ]);
  }
  if (!fields.includes(parsed.title_field)) {
    throw new z.ZodError([
      {
        code: "custom",
        message: "The Table title property must be a visible field column.",
        path: ["title_field"],
      },
    ]);
  }
  return { ...parsed, fields };
}

export interface TableViewRoleCandidate {
  key: string;
  config_json: unknown;
}

export function deterministicTableViewRoles(
  candidates: readonly TableViewRoleCandidate[],
): Map<string, TableViewRole> {
  const ordered = [...candidates].toSorted((left, right) =>
    left.key.localeCompare(right.key),
  );
  const parsed = ordered.map((view) => ({
    view,
    config: tableViewConfigSchema.parse(view.config_json),
  }));
  const canonicalPrimaries = parsed.filter(
    ({ config }) => "schema_version" in config && config.role === "primary",
  );
  if (canonicalPrimaries.length > 1) {
    throw new z.ZodError([
      {
        code: "custom",
        message: "An Object can have only one active primary Table View.",
        path: ["views"],
      },
    ]);
  }

  const legacyViews = parsed.filter(
    ({ config }) => !("schema_version" in config),
  );
  const primary = canonicalPrimaries[0] ?? legacyViews[0];
  if (parsed.length > 0 && !primary) {
    throw new z.ZodError([
      {
        code: "custom",
        message: "An Object must have one active primary Table View.",
        path: ["views"],
      },
    ]);
  }

  return new Map(
    parsed.map(({ view }) => [
      view.key,
      view.key === primary?.view.key ? "primary" : "saved",
    ]),
  );
}

export interface TableViewQueryFieldContext {
  key: string;
  field_type: string;
}

export interface TableViewQueryRelationshipContext {
  key: string;
  cardinality: "one_to_one" | "one_to_many" | "many_to_many";
}

export interface TableViewQueryValidationContext {
  fields: readonly TableViewQueryFieldContext[];
  relationships: readonly TableViewQueryRelationshipContext[];
  columns?: readonly TableViewColumn[];
}

const textTypes = new Set(["short_text", "long_text", "email", "phone", "url"]);
const numericTypes = new Set(["number", "currency"]);
const dateTypes = new Set(["date", "datetime"]);
const choiceTypes = new Set(["select", "status"]);
const sortableFieldTypes = new Set([
  "short_text",
  "long_text",
  "email",
  "phone",
  "url",
  "number",
  "currency",
  "boolean",
  "date",
  "datetime",
  "select",
  "status",
]);
const groupableFieldTypes = new Set([
  "select",
  "status",
  "boolean",
  "date",
  "datetime",
]);

function validDateOperand(value: unknown, fieldType: string): boolean {
  if (tableViewRelativeDateSchema.safeParse(value).success) {
    return true;
  }
  if (typeof value !== "string") {
    return false;
  }
  return fieldType === "date"
    ? /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)
    : /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}/.test(value);
}

export function validateTableViewQuery(
  queryInput: unknown,
  context: TableViewQueryValidationContext,
): TableViewQuery {
  const query = tableViewQuerySchema.parse(queryInput);
  const fields = new Map(context.fields.map((field) => [field.key, field]));
  const relationships = new Map(
    context.relationships.map((relationship) => [
      relationship.key,
      relationship,
    ]),
  );
  const columns = context.columns ?? [];
  const errors: Array<{ path: (string | number)[]; message: string }> = [];

  type ResolvedField = {
    reference: Extract<ParsedTableViewPropertyKey, { kind: "field" }>;
    field: (typeof context.fields)[number];
  };
  type ResolvedConnection = {
    reference: Extract<ParsedTableViewPropertyKey, { kind: "connection" }>;
    relationship: (typeof context.relationships)[number];
    connectionColumn: Extract<TableViewColumn, { kind: "connection" }>;
  };

  const resolveProperty = (
    propertyKey: string,
    path: (string | number)[],
  ): ResolvedField | ResolvedConnection | null => {
    const reference = parseTableViewPropertyKey(propertyKey);
    if (!reference) {
      errors.push({
        path,
        message: "Invalid query property reference.",
      });
      return null;
    }
    if (reference.kind === "field") {
      const field = fields.get(reference.fieldKey);
      if (!field) {
        errors.push({ path, message: "Unknown field." });
        return null;
      }
      return { reference, field };
    }
    const relationship = relationships.get(reference.relationshipKey);
    if (!relationship) {
      errors.push({ path, message: "Unknown connection." });
      return null;
    }
    const connectionColumn = columns.find(
      (column): column is Extract<TableViewColumn, { kind: "connection" }> =>
        column.kind === "connection" &&
        column.relationship_key === reference.relationshipKey &&
        column.direction === reference.direction,
    );
    if (!connectionColumn) {
      errors.push({
        path,
        message: "The connection must be a visible Table column.",
      });
      return null;
    }
    return { reference, relationship, connectionColumn };
  };

  for (const [index, filter] of query.filters.entries()) {
    const resolved = resolveProperty(filter.property, [
      "filters",
      index,
      "property",
    ]);
    if (!resolved) continue;

    if ("field" in resolved) {
      const field = resolved.field;
      const operator = filter.operator;
      const valid = textTypes.has(field.field_type)
        ? new Set([
            "is",
            "is_not",
            "contains",
            "does_not_contain",
            "is_empty",
            "is_not_empty",
          ])
        : numericTypes.has(field.field_type)
          ? new Set([
              "is",
              "is_not",
              "greater_than",
              "greater_than_or_equal",
              "less_than",
              "less_than_or_equal",
              "is_empty",
              "is_not_empty",
            ])
          : dateTypes.has(field.field_type)
            ? new Set([
                "is",
                "is_not",
                "on_or_before",
                "on_or_after",
                "between",
                "is_empty",
                "is_not_empty",
              ])
            : field.field_type === "boolean"
              ? new Set(["is_yes", "is_no", "is_empty", "is_not_empty"])
              : choiceTypes.has(field.field_type)
                ? new Set([
                    "is",
                    "is_not",
                    "is_any_of",
                    "is_empty",
                    "is_not_empty",
                  ])
                : field.field_type === "multi_select"
                  ? new Set([
                      "contains_any",
                      "contains_all",
                      "is_empty",
                      "is_not_empty",
                    ])
                  : new Set(["is_empty", "is_not_empty"]);
      if (!valid.has(operator)) {
        errors.push({
          path: ["filters", index, "operator"],
          message: "That operator is not valid for this property type.",
        });
      }
      if (
        valid.has(operator) &&
        dateTypes.has(field.field_type) &&
        ["is", "is_not", "on_or_before", "on_or_after", "between"].includes(
          operator,
        )
      ) {
        const operands = filter.values ?? [filter.value];
        if (
          operands.some(
            (operand) => !validDateOperand(operand, field.field_type),
          )
        ) {
          errors.push({
            path: ["filters", index, "value"],
            message: "Date filters need an ISO date or bounded relative date.",
          });
        }
      }
    } else if (
      ![
        "is",
        "is_not",
        "contains",
        "does_not_contain",
        "is_any_of",
        "contains_any",
        "is_empty",
        "is_not_empty",
      ].includes(filter.operator)
    ) {
      errors.push({
        path: ["filters", index, "operator"],
        message: "Connections only support membership filters.",
      });
    }
  }

  for (const [index, sort] of query.sorts.entries()) {
    const resolved = resolveProperty(sort.property, [
      "sorts",
      index,
      "property",
    ]);
    if (!resolved) continue;
    if (
      "field" in resolved &&
      !sortableFieldTypes.has(resolved.field.field_type)
    ) {
      errors.push({
        path: ["sorts", index, "property"],
        message: "That property cannot be sorted.",
      });
    } else if (!("field" in resolved)) {
      const singleValue =
        resolved.relationship.cardinality === "one_to_one" ||
        (resolved.relationship.cardinality === "one_to_many" &&
          resolved.connectionColumn.direction === "source");
      if (!singleValue) {
        errors.push({
          path: ["sorts", index, "property"],
          message: "Only single-value Connections can be sorted.",
        });
      }
    }
  }

  if (query.group) {
    const resolved = resolveProperty(query.group, ["group"]);
    if (resolved) {
      if (
        "field" in resolved &&
        !groupableFieldTypes.has(resolved.field.field_type)
      ) {
        errors.push({
          path: ["group"],
          message: "That property cannot be grouped.",
        });
      } else if (!("field" in resolved)) {
        const singleValue =
          resolved.relationship.cardinality === "one_to_one" ||
          (resolved.relationship.cardinality === "one_to_many" &&
            resolved.connectionColumn.direction === "source");
        if (!singleValue) {
          errors.push({
            path: ["group"],
            message: "Only single-value Connections can be grouped.",
          });
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new z.ZodError(
      errors.map((error) => ({ code: "custom" as const, ...error })),
    );
  }
  return query;
}

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
    case "table": {
      const parsed = tableViewConfigSchema.parse(input);
      return "schema_version" in parsed
        ? normalizeTableViewConfig(parsed)
        : parsed;
    }
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
    /** Form requiredness is allowed to be stricter than the canonical Field. */
    required: z.boolean().optional(),
    visible_when: z
      .object({
        field: graphKeySchema,
        operator: z.enum(["equals", "not_equals", "includes"]),
        value: z.union([z.string(), z.number(), z.boolean()]),
      })
      .strict()
      .optional(),
    upload_kind: z.enum(["image", "pdf"]).optional(),
    upload_count: z.number().int().min(1).max(5).optional(),
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
    if (field.upload_count !== undefined && !field.upload_kind) {
      context.addIssue({
        code: "custom",
        message: "An upload count needs an upload kind.",
        path: ["upload_kind"],
      });
    }
    if (field.upload_kind && field.hidden) {
      context.addIssue({
        code: "custom",
        message: "Upload questions cannot be hidden.",
        path: ["hidden"],
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
  .strict()
  .superRefine((config, context) => {
    const positions = new Map(
      config.fields.map((field, index) => [field.field, index]),
    );
    const hiddenFields = new Set(
      config.fields.filter((field) => field.hidden).map((field) => field.field),
    );
    config.fields.forEach((field, index) => {
      if (
        field.visible_when &&
        (!positions.has(field.visible_when.field) ||
          (positions.get(field.visible_when.field) ?? -1) >= index)
      ) {
        context.addIssue({
          code: "custom",
          message: "A conditional Form field must reference an earlier field.",
          path: ["fields", index, "visible_when", "field"],
        });
      }
      if (field.visible_when && hiddenFields.has(field.visible_when.field)) {
        context.addIssue({
          code: "custom",
          message: "A condition cannot reference a hidden Form field.",
          path: ["fields", index, "visible_when", "field"],
        });
      }
    });
  });

export const safePageHrefSchema = z
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
    /** Historical Pages use `src`; new Pages may point at a private asset. */
    src: z.httpUrl().max(2048).optional(),
    asset_id: z.uuid().optional(),
    alt: z.string().trim().max(300).default(""),
    caption: z.string().trim().min(1).max(500).optional(),
    presentation: z.enum(["content", "wide"]).optional(),
    id: pageBlockIdSchema.optional(),
  })
  .strict()
  .superRefine((image, context) => {
    const hasSource = Boolean(image.src);
    const hasAsset = Boolean(image.asset_id);
    if (hasSource === hasAsset) {
      context.addIssue({
        code: "custom",
        message: "An image must reference one external URL or private asset.",
        path: ["src"],
      });
    }
    if (hasSource && image.alt.length === 0) {
      context.addIssue({
        code: "custom",
        message: "External images need an image description.",
        path: ["alt"],
      });
    }
  });

const buttonBlockSchema = z
  .object({
    type: z.literal("button"),
    label: labelSchema,
    href: safePageHrefSchema,
    style: z.enum(["primary", "secondary"]).default("primary"),
    id: pageBlockIdSchema.optional(),
  })
  .strict();

const viewBlockSchema = z
  .object({
    type: z.literal("view"),
    view_key: graphKeySchema,
    read_only: z.boolean().optional(),
    checklist: z
      .object({
        label_field: graphKeySchema,
        completed_field: graphKeySchema,
      })
      .strict()
      .optional(),
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

// Sites retain this bounded source identity in their private draft so a
// copied or moved Booking block keeps the same operational namespace. The
// ordinary Page grammar remains unchanged; publication strips this metadata
// before emitting canonical Page operations.
const siteBookingBlockSchema = bookingBlockSchema.extend({
  stable_source_page_id: z.uuid().optional(),
});

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

const pageRichTextMarkSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bold") }).strict(),
  z.object({ type: z.literal("italic") }).strict(),
  z.object({ type: z.literal("link"), href: safePageHrefSchema }).strict(),
]);

const pageRichTextSpanSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().min(1).max(5_000),
    marks: z.array(pageRichTextMarkSchema).max(3).optional(),
  })
  .strict()
  .superRefine((span, context) => {
    const markTypes = (span.marks ?? []).map((mark) => mark.type);
    if (new Set(markTypes).size !== markTypes.length) {
      context.addIssue({
        code: "custom",
        message: "Rich text marks cannot be repeated on one text span.",
        path: ["marks"],
      });
    }
  });

const pageRichTextContentSchema = z
  .array(pageRichTextSpanSchema)
  .max(200)
  .superRefine((content, context) => {
    const length = content.reduce((total, span) => total + span.text.length, 0);
    if (length > 5_000) {
      context.addIssue({
        code: "custom",
        message: "Rich text content cannot exceed 5,000 characters.",
      });
    }
  });

export const pageRichTextNodeSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("paragraph"),
      content: pageRichTextContentSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("heading"),
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      content: pageRichTextContentSchema,
    })
    .strict()
    .superRefine((node, context) => {
      const length = node.content.reduce(
        (total, span) => total + span.text.length,
        0,
      );
      if (length > 200) {
        context.addIssue({
          code: "custom",
          message: "Rich text headings cannot exceed 200 characters.",
          path: ["content"],
        });
      }
    }),
  z
    .object({
      type: z.literal("bullet_list"),
      items: z
        .array(z.object({ content: pageRichTextContentSchema }).strict())
        .min(1)
        .max(50),
    })
    .strict(),
  z
    .object({
      type: z.literal("numbered_list"),
      items: z
        .array(z.object({ content: pageRichTextContentSchema }).strict())
        .min(1)
        .max(50),
    })
    .strict(),
]);

const richTextBlockSchema = z
  .object({
    type: z.literal("rich_text"),
    node: pageRichTextNodeSchema,
    id: pageBlockIdSchema.optional(),
  })
  .strict();

/**
 * A collapsible section deliberately accepts the same authorable blocks as a
 * document, except another collapsible section. This keeps the grammar one
 * level deep while allowing useful content such as images and live Views.
 */
const containedPageBlockSchema = z.discriminatedUnion("type", [
  headingBlockSchema,
  textBlockSchema,
  imageBlockSchema,
  buttonBlockSchema,
  viewBlockSchema,
  formBlockSchema,
  publicFormBlockSchema,
  bookingBlockSchema,
  preorderBlockSchema,
  dividerBlockSchema,
  calloutBlockSchema,
  richTextBlockSchema,
]);

const collapsibleBlockSchema = z
  .object({
    type: z.literal("collapsible"),
    summary: z.string().trim().min(1).max(200),
    blocks: z.array(containedPageBlockSchema).max(50),
    open: z.boolean().default(true),
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
  publicFormBlockSchema,
  bookingBlockSchema,
  preorderBlockSchema,
  dividerBlockSchema,
  calloutBlockSchema,
  richTextBlockSchema,
  collapsibleBlockSchema,
]);

export const pageLayoutSchema = z
  .object({
    blocks: z.array(pageBlockSchema).max(100),
  })
  .strict()
  .superRefine((layout, context) => {
    const ids: string[] = [];
    let blockCount = 0;
    const collect = (blocks: readonly PageBlock[]): void => {
      for (const block of blocks) {
        blockCount += 1;
        if ("id" in block && block.id) ids.push(block.id);
        if (block.type === "collapsible") {
          collect(block.blocks as readonly PageBlock[]);
        }
      }
    };
    collect(layout.blocks);
    if (blockCount > 100) {
      context.addIssue({
        code: "custom",
        message: "A Page can contain at most 100 blocks, including sections.",
        path: ["blocks"],
      });
    }
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Page blocks must use unique IDs.",
        path: ["blocks"],
      });
    }
  });

/**
 * Site composition keeps the existing Page atoms as its base grammar. These
 * additions are intentionally finite and live beside the shared experience
 * schemas so a later public renderer extends the Page renderer rather than
 * introducing a second, Site-only document format.
 *
 * C1 supports explicit Record selection only. A later selection schema may
 * add bounded filters while preserving this versioned representation.
 */
export const siteGalleryImageSchema = z
  .object({
    asset_id: z.uuid().optional(),
    alt: z.string().trim().max(300).default(""),
    caption: z.string().trim().min(1).max(500).optional(),
    /**
     * C1 persists a small finite incomplete state while an owner is choosing
     * media or writing its description. Releases require `complete` entries.
     */
    draft_state: z.enum(["complete", "incomplete"]).default("complete"),
  })
  .strict()
  .superRefine((image, context) => {
    if (image.draft_state === "complete" && !image.asset_id) {
      context.addIssue({
        code: "custom",
        message: "A complete gallery image needs a managed asset.",
        path: ["asset_id"],
      });
    }
    if (image.draft_state === "complete" && image.alt.length === 0) {
      context.addIssue({
        code: "custom",
        message: "A complete gallery image needs a description.",
        path: ["alt"],
      });
    }
  });

export const siteGalleryBlockSchema = z
  .object({
    type: z.literal("gallery"),
    images: z.array(siteGalleryImageSchema).max(12),
    presentation: z.enum(["grid", "carousel"]).default("grid"),
    id: pageBlockIdSchema.optional(),
    draft_state: z.enum(["complete", "incomplete"]).default("complete"),
  })
  .strict()
  .superRefine((block, context) => {
    if (block.draft_state === "complete" && block.images.length === 0) {
      context.addIssue({
        code: "custom",
        message: "A complete gallery needs at least one image.",
        path: ["images"],
      });
    }
    if (
      block.draft_state === "complete" &&
      block.images.some((image) => image.draft_state !== "complete")
    ) {
      context.addIssue({
        code: "custom",
        message: "A complete gallery cannot contain an incomplete image.",
        path: ["images"],
      });
    }
    const ids = block.images.flatMap((image) =>
      image.asset_id ? [image.asset_id] : [],
    );
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "A gallery cannot contain the same image more than once.",
        path: ["images"],
      });
    }
  });

export const siteCollectionBlockSchema = z
  .object({
    type: z.literal("collection"),
    object_key: graphKeySchema.optional(),
    selection: z
      .object({
        schema_version: z.literal(1),
        record_ids: z.array(z.uuid()).max(500),
      })
      .strict()
      .superRefine((selection, context) => {
        if (
          new Set(selection.record_ids).size !== selection.record_ids.length
        ) {
          context.addIssue({
            code: "custom",
            message:
              "A collection cannot select the same Record more than once.",
            path: ["record_ids"],
          });
        }
      }),
    public_field_keys: z.array(graphKeySchema).max(50),
    /** C2 keeps filtering finite and stores it beside the explicit selection. */
    filter: z
      .object({
        schema_version: z.literal(1),
        filters: z
          .array(
            z
              .object({
                field_key: graphKeySchema,
                operator: z.enum([
                  "is",
                  "is_not",
                  "contains",
                  "does_not_contain",
                  "greater_than",
                  "greater_than_or_equal",
                  "less_than",
                  "less_than_or_equal",
                  "is_any_of",
                  "is_empty",
                  "is_not_empty",
                ]),
                value: z.json().optional(),
                values: z.array(z.json()).max(20).optional(),
              })
              .strict()
              .superRefine((item, context) => {
                const noValue =
                  item.operator === "is_empty" ||
                  item.operator === "is_not_empty";
                if (noValue && (item.value !== undefined || item.values)) {
                  context.addIssue({
                    code: "custom",
                    message: "This filter does not accept a value.",
                    path: ["value"],
                  });
                }
                if (item.operator === "is_any_of") {
                  if (
                    (!item.values || item.values.length === 0) &&
                    item.value === undefined
                  ) {
                    context.addIssue({
                      code: "custom",
                      message: "This filter needs a list of values.",
                      path: ["values"],
                    });
                  }
                  if (item.value !== undefined) {
                    context.addIssue({
                      code: "custom",
                      message: "This filter needs a list of values.",
                      path: ["values"],
                    });
                  }
                } else if (!noValue && item.value === undefined) {
                  context.addIssue({
                    code: "custom",
                    message: "This filter needs a value.",
                    path: ["value"],
                  });
                }
              }),
          )
          .max(10),
        filter_match: z.enum(["all", "any"]),
        sorts: z
          .array(
            z
              .object({
                field_key: graphKeySchema,
                direction: z.enum(["ascending", "descending"]),
              })
              .strict(),
          )
          .max(3),
      })
      .strict()
      .optional(),
    presentation: z.enum(["cards", "list", "table"]).default("cards"),
    detail_page_id: z.uuid().optional(),
    id: pageBlockIdSchema.optional(),
    draft_state: z.enum(["complete", "incomplete"]).default("complete"),
  })
  .strict()
  .superRefine((block, context) => {
    if (!block.id) {
      context.addIssue({
        code: "custom",
        message: "Collection blocks require a stable identity.",
        path: ["id"],
      });
    }
    if (block.draft_state === "complete" && !block.object_key) {
      context.addIssue({
        code: "custom",
        message: "A complete collection needs a Record type.",
        path: ["object_key"],
      });
    }
    if (
      block.draft_state === "complete" &&
      block.public_field_keys.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "A complete collection needs at least one public Property.",
        path: ["public_field_keys"],
      });
    }
    if (
      new Set(block.public_field_keys).size !== block.public_field_keys.length
    ) {
      context.addIssue({
        code: "custom",
        message: "A collection's public Properties must be unique.",
        path: ["public_field_keys"],
      });
    }
  });

/** Site drafts forbid URL images and can persist an unfinished managed image. */
export const siteDraftImageBlockSchema = z
  .object({
    type: z.literal("image"),
    asset_id: z.uuid().optional(),
    alt: z.string().trim().max(300).default(""),
    caption: z.string().trim().min(1).max(500).optional(),
    presentation: z.enum(["content", "wide"]).optional(),
    id: pageBlockIdSchema.optional(),
    draft_state: z.enum(["complete", "incomplete"]).default("complete"),
  })
  .strict()
  .superRefine((image, context) => {
    if (image.draft_state === "complete" && !image.asset_id) {
      context.addIssue({
        code: "custom",
        message: "A complete Site image needs a managed asset.",
        path: ["asset_id"],
      });
    }
    if (image.draft_state === "complete" && image.alt.length === 0) {
      context.addIssue({
        code: "custom",
        message: "A complete Site image needs a description.",
        path: ["alt"],
      });
    }
  });

/**
 * These shared atoms have finite empty states for editor autosave. A release
 * never includes them: `siteDraftPublicationReadyV1Schema` rejects every
 * `draft_state: incomplete` block on an included Page.
 */
const siteIncompleteAtomicBlockSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("heading"),
      text: z.string().trim().max(200),
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
      id: pageBlockIdSchema.optional(),
      draft_state: z.literal("incomplete"),
    })
    .strict(),
  z
    .object({
      type: z.literal("text"),
      text: z.string().trim().max(5000),
      id: pageBlockIdSchema.optional(),
      draft_state: z.literal("incomplete"),
    })
    .strict(),
  z
    .object({
      type: z.literal("button"),
      label: z.string().trim().max(120),
      href: z.string().trim().max(2048),
      style: z.enum(["primary", "secondary"]).default("primary"),
      id: pageBlockIdSchema.optional(),
      draft_state: z.literal("incomplete"),
    })
    .strict(),
  z
    .object({
      type: z.literal("callout"),
      text: z.string().trim().max(1000),
      tone: z.enum(["neutral", "info", "success", "warning"]).default("info"),
      id: pageBlockIdSchema.optional(),
      draft_state: z.literal("incomplete"),
    })
    .strict(),
]);

export const siteRecordDetailBlockSchema = z
  .object({
    type: z.literal("record_detail"),
    collection_block_id: z.uuid(),
    public_field_keys: z.array(graphKeySchema).min(1).max(50),
    id: pageBlockIdSchema.optional(),
  })
  .strict()
  .superRefine((block, context) => {
    if (!block.id) {
      context.addIssue({
        code: "custom",
        message: "Shared detail blocks require a stable identity.",
        path: ["id"],
      });
    }
    if (
      new Set(block.public_field_keys).size !== block.public_field_keys.length
    ) {
      context.addIssue({
        code: "custom",
        message: "A detail layout's public Properties must be unique.",
        path: ["public_field_keys"],
      });
    }
  });

type SiteCollapsibleBlock = {
  type: "collapsible";
  summary: string;
  blocks: SiteNestedBlock[];
  open: boolean;
  id?: string | undefined;
  draft_state: "complete" | "incomplete";
};

type SiteNestedBlock =
  | z.output<typeof headingBlockSchema>
  | z.output<typeof textBlockSchema>
  | z.output<typeof siteDraftImageBlockSchema>
  | z.output<typeof buttonBlockSchema>
  | z.output<typeof publicFormBlockSchema>
  | z.output<typeof siteBookingBlockSchema>
  | z.output<typeof preorderBlockSchema>
  | z.output<typeof dividerBlockSchema>
  | z.output<typeof calloutBlockSchema>
  | z.output<typeof richTextBlockSchema>
  | z.output<typeof siteGalleryBlockSchema>
  | z.output<typeof siteCollectionBlockSchema>
  | z.output<typeof siteRecordDetailBlockSchema>
  | z.output<typeof siteIncompleteAtomicBlockSchema>
  | SiteCollapsibleBlock;

export const siteSharedAtomicBlockSchema = z.union([
  headingBlockSchema,
  textBlockSchema,
  buttonBlockSchema,
  publicFormBlockSchema,
  siteBookingBlockSchema,
  preorderBlockSchema,
  dividerBlockSchema,
  calloutBlockSchema,
  richTextBlockSchema,
]);

const siteLeafBlockSchema = z.union([
  siteSharedAtomicBlockSchema,
  siteDraftImageBlockSchema,
  siteGalleryBlockSchema,
  siteCollectionBlockSchema,
  siteRecordDetailBlockSchema,
  siteIncompleteAtomicBlockSchema,
]);

function siteNestedBlockSchemaAtDepth(
  nesting: number,
): z.ZodType<SiteNestedBlock> {
  return z.lazy(() =>
    nesting > 1
      ? siteLeafBlockSchema
      : z.union([
          siteLeafBlockSchema,
          siteCollapsibleBlockSchemaAtDepth(nesting),
        ]),
  );
}

/**
 * Sites use their own bounded recursive section grammar. Reusing the normal
 * Page collapsible schema here would allow historical URL images to tunnel
 * through a nested child and would make an owner unable to autosave a cleared
 * child field.
 */
function siteCollapsibleBlockSchemaAtDepth(
  nesting: number,
): z.ZodType<SiteCollapsibleBlock> {
  return z
    .object({
      type: z.literal("collapsible"),
      summary: z.string().trim().max(200),
      blocks: z.array(siteNestedBlockSchemaAtDepth(nesting + 1)).max(50),
      open: z.boolean().default(true),
      id: pageBlockIdSchema.optional(),
      draft_state: z.enum(["complete", "incomplete"]).default("complete"),
    })
    .strict()
    .superRefine((block, context) => {
      if (block.draft_state === "complete" && block.summary.length === 0) {
        context.addIssue({
          code: "custom",
          message: "A complete section needs a summary.",
          path: ["summary"],
        });
      }
    });
}

const siteNestedBlockSchema: z.ZodType<SiteNestedBlock> =
  siteNestedBlockSchemaAtDepth(0);

export const siteSectionWidthSchema = z.enum(["content", "wide"]);
export const siteSectionSpacingSchema = z.enum([
  "compact",
  "comfortable",
  "spacious",
]);
export const siteSectionAlignmentSchema = z.enum(["start", "center", "end"]);
export const siteSectionBackgroundSchema = z.enum(["plain", "tint"]);

const siteSectionBlockSchema = z
  .object({
    type: z.literal("section"),
    width: siteSectionWidthSchema.default("content"),
    spacing: siteSectionSpacingSchema.default("comfortable"),
    alignment: siteSectionAlignmentSchema.default("start"),
    background: siteSectionBackgroundSchema.default("plain"),
    columns: z
      .array(
        z
          .object({
            blocks: z.array(siteNestedBlockSchemaAtDepth(1)).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(3),
    id: pageBlockIdSchema.optional(),
  })
  .strict();

export const sitePageBlockSchema = z.union([
  siteNestedBlockSchema,
  siteSectionBlockSchema,
]);

export const sitePageLayoutSchema = z
  .object({ blocks: z.array(sitePageBlockSchema).max(100) })
  .strict()
  .superRefine((layout, context) => {
    const ids: string[] = [];
    let blockCount = 0;
    const visit = (blocks: readonly z.infer<typeof sitePageBlockSchema>[]) => {
      for (const block of blocks) {
        blockCount += 1;
        if ("id" in block && block.id) ids.push(block.id);
        if (block.type === "collapsible") {
          visit(block.blocks);
        }
        if (block.type === "section") {
          for (const column of block.columns) {
            visit(column.blocks);
          }
        }
      }
    };
    visit(layout.blocks);
    if (blockCount > 100) {
      context.addIssue({
        code: "custom",
        message:
          "A Site Page can contain at most 100 blocks, including sections.",
        path: ["blocks"],
      });
    }
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Site Page blocks must use unique IDs.",
        path: ["blocks"],
      });
    }
  });

export type SitePageLayout = z.infer<typeof sitePageLayoutSchema>;
export type SitePageBlock = z.infer<typeof sitePageBlockSchema>;

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
