import type { ExperienceViewBundle } from "../../../core/experience/service";
import type { TableViewConfig } from "../../../core/experience/schemas";
import type { Json, Tables } from "../../../db/supabase/database.types";
import {
  directTableEditableFieldTypes,
  isDirectTableEditableFieldType,
} from "../../../core/experience/inline-edit";
import type {
  EditorColumn,
  EditorColumnKind,
  EditorRow,
  EditorTable,
  EditorValue,
} from "../contracts";

export class ProductionTableMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionTableMappingError";
  }
}

export interface ProductionTableMappingInput {
  bundle: ExperienceViewBundle;
  /** Present for a configured edit Form; absent means metadata-derived rules. */
  editFormFieldKeys?: readonly string[] | undefined;
}

export interface ProductionTableMapping {
  table: EditorTable;
  visibleFields: readonly Tables<"field_definitions">[];
  recordFields: readonly Tables<"field_definitions">[];
}

const defaultWidths: Readonly<Record<EditorColumnKind, number>> = {
  text: 220,
  long_text: 260,
  email: 220,
  url: 250,
  phone: 170,
  number: 130,
  currency: 150,
  status: 155,
  select: 155,
  boolean: 135,
  date: 165,
  datetime: 210,
  multi_select: 220,
  file: 220,
};

function fieldOptions(field: Tables<"field_definitions">): string[] {
  const settings = field.settings_json;
  if (
    typeof settings !== "object" ||
    settings === null ||
    Array.isArray(settings)
  ) {
    return [];
  }
  const options = settings.options;
  return Array.isArray(options)
    ? options.filter((option): option is string => typeof option === "string")
    : [];
}

function fieldCurrency(field: Tables<"field_definitions">): string | undefined {
  const settings = field.settings_json;
  if (
    typeof settings !== "object" ||
    settings === null ||
    Array.isArray(settings)
  ) {
    return undefined;
  }
  const currency = settings.currency;
  return typeof currency === "string" && /^[A-Z]{3}$/.test(currency)
    ? currency
    : undefined;
}

function editorKind(
  fieldType: Tables<"field_definitions">["field_type"],
): EditorColumnKind {
  switch (fieldType) {
    case "short_text":
      return "text";
    case "long_text":
      return "long_text";
    case "email":
      return "email";
    case "url":
      return "url";
    case "phone":
      return "phone";
    case "number":
      return "number";
    case "currency":
      return "currency";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "select":
      return "select";
    case "multi_select":
      return "multi_select";
    case "file":
      return "file";
    case "status":
      return "status";
  }
}

function readOnlyReason(
  field: Tables<"field_definitions">,
  editable: boolean,
): string | undefined {
  if (editable) {
    return undefined;
  }
  if (!isDirectTableEditableFieldType(field.field_type)) {
    return "This property is read-only in the Table preview.";
  }
  return "This property is not available through the configured edit screen.";
}

function mapField(
  field: Tables<"field_definitions">,
  config: TableViewConfig,
  editFormFieldKeys: readonly string[] | undefined,
): EditorColumn {
  const kind = editorKind(field.field_type);
  const editable =
    isDirectTableEditableFieldType(field.field_type) &&
    (editFormFieldKeys === undefined || editFormFieldKeys.includes(field.key));
  const configuredWidth = config.column_widths?.[field.key];
  const options = fieldOptions(field);
  const reason = readOnlyReason(field, editable);
  return {
    key: field.key,
    label: field.label,
    kind,
    editable,
    required: field.required,
    ...(options.length > 0 ? { options } : {}),
    ...(kind === "currency" ? { currency: fieldCurrency(field) ?? "GBP" } : {}),
    ...(reason ? { readOnlyReason: reason } : {}),
    width: configuredWidth ?? defaultWidths[kind],
  };
}

function compatibleEditorObject(
  value: Record<string, Json | undefined>,
): EditorValue | null {
  const output: Record<
    string,
    string | number | boolean | null | readonly string[]
  > = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) {
      continue;
    }
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      output[key] = item;
      continue;
    }
    if (
      Array.isArray(item) &&
      item.every((entry): entry is string => typeof entry === "string")
    ) {
      output[key] = item;
      continue;
    }
    return null;
  }
  return output;
}

export function editorValueFromJson(value: Json | undefined): EditorValue {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.every((entry): entry is string => typeof entry === "string")
      ? value
      : JSON.stringify(value);
  }
  return compatibleEditorObject(value) ?? JSON.stringify(value);
}

function recordData(
  record: Tables<"records">,
): Record<string, Json | undefined> {
  return typeof record.data_json === "object" &&
    record.data_json !== null &&
    !Array.isArray(record.data_json)
    ? record.data_json
    : {};
}

function mapRow(table: EditorTable, record: Tables<"records">): EditorRow {
  const data = recordData(record);
  const values: Record<string, EditorValue> = {};
  for (const column of table.recordColumns ?? table.columns) {
    values[column.key] = editorValueFromJson(data[column.key]);
  }
  return { id: record.id, values };
}

export function mapProductionRecordToEditorRow(
  table: EditorTable,
  record: Tables<"records">,
): EditorRow {
  return mapRow(table, record);
}

export function mapExperienceViewBundleToEditorTable({
  bundle,
  editFormFieldKeys,
}: ProductionTableMappingInput): ProductionTableMapping {
  if (
    bundle.definition.view_type !== "table" ||
    bundle.definition.audience !== "internal" ||
    !bundle.definition.is_active
  ) {
    throw new ProductionTableMappingError(
      "Only active internal Table screens can use the kernel preview.",
    );
  }

  const config = bundle.config as TableViewConfig;
  const fieldsByKey = new Map(bundle.fields.map((field) => [field.key, field]));
  const visibleFields = config.fields.map((fieldKey) => {
    const field = fieldsByKey.get(fieldKey);
    if (!field || !field.is_active) {
      throw new ProductionTableMappingError(
        "This Table has a missing or inactive visible property.",
      );
    }
    return field;
  });
  if (visibleFields.length === 0) {
    throw new ProductionTableMappingError(
      "This Table has no usable visible properties.",
    );
  }

  const primaryColumnKey = config.title_field ?? visibleFields[0]?.key;
  if (
    !primaryColumnKey ||
    !visibleFields.some((field) => field.key === primaryColumnKey)
  ) {
    throw new ProductionTableMappingError(
      "This Table has no usable primary visible property.",
    );
  }

  const recordFields = bundle.fields.filter((field) => field.is_active);
  const recordColumns = recordFields.map((field) => {
    const column = mapField(field, config, editFormFieldKeys);
    return field.key === primaryColumnKey
      ? { ...column, primary: true }
      : column;
  });
  const columns = visibleFields.map((field) => {
    const column = recordColumns.find(
      (candidate) => candidate.key === field.key,
    );
    if (!column) {
      throw new ProductionTableMappingError(
        "This Table has an unusable visible property.",
      );
    }
    return column;
  });
  const rows = bundle.records
    .filter((record) => record.record_status === "active")
    .map((record) =>
      mapRow(
        {
          key: bundle.definition.key,
          name: bundle.definition.name,
          primaryColumnKey,
          columns,
          recordColumns,
          rows: [],
        },
        record,
      ),
    );

  const table: EditorTable = {
    key: bundle.definition.key,
    name: bundle.definition.name,
    primaryColumnKey,
    columns,
    recordColumns,
    rows,
  };

  return { table, visibleFields, recordFields };
}

export const productionDirectEditableFieldTypes = directTableEditableFieldTypes;
