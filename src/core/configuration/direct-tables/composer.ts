import {
  ConfigurationIdentityAllocationError,
  createGraphKeyAllocator,
} from "../identity-allocation";
import {
  configurationSnapshotV1Schema,
  type ConfigurationSnapshotV1,
} from "../definition-source";
import {
  configurationOperationsSchema,
  setObjectOperationSchema,
  setFieldOperationSchema,
  setViewOperationSchema,
  type ConfigurationOperation,
} from "../schemas";
import {
  tableViewConfigSchema,
  type TableViewConfig,
} from "../../experience/schemas";
import type { Json } from "../../../db/supabase/database.types";
import {
  directTableIntentSchema,
  type DirectTableActionKind,
  type DirectTableColumnType,
  type DirectTableIntent,
} from "./schemas";
import { directTableSettingsForTypeChange } from "./type-compatibility";

type FieldOperation = Extract<ConfigurationOperation, { op: "set_field" }>;
type ObjectOperation = Extract<ConfigurationOperation, { op: "set_object" }>;
type ViewOperation = Extract<ConfigurationOperation, { op: "set_view" }>;
type ViewSource = Pick<
  ViewOperation,
  "key" | "name" | "view_type" | "object_key" | "audience" | "is_active"
>;

export const directTableErrorCodes = [
  "direct_table_input_invalid",
  "direct_table_snapshot_invalid",
  "direct_table_not_found",
  "direct_table_object_label_conflict",
  "direct_table_field_label_conflict",
  "direct_table_key_unavailable",
  "direct_table_options_invalid",
  "direct_table_type_change_invalid",
  "direct_table_reorder_invalid",
  "direct_table_width_invalid",
  "direct_table_operations_invalid",
] as const;

export type DirectTableErrorCode = (typeof directTableErrorCodes)[number];

const directTableErrorMessages: Readonly<Record<DirectTableErrorCode, string>> =
  {
    direct_table_input_invalid:
      "Check the Table name, column details, and current screen, then try again.",
    direct_table_snapshot_invalid:
      "The current Table setup could not be read safely. Reload and try again.",
    direct_table_not_found:
      "That Table or column is no longer available. Reload and try again.",
    direct_table_object_label_conflict:
      "A Table with that name already exists. Choose a different name.",
    direct_table_field_label_conflict:
      "Columns in a Table must have different names.",
    direct_table_key_unavailable:
      "That Table could not be prepared safely. Try a different name.",
    direct_table_options_invalid:
      "Choice and Status columns need at least two different options.",
    direct_table_type_change_invalid:
      "That property type could not be changed safely. Nothing was changed.",
    direct_table_reorder_invalid:
      "Columns could not be reordered because the Table changed. Reload and try again.",
    direct_table_width_invalid:
      "Column widths must be between 128 and 640 pixels.",
    direct_table_operations_invalid:
      "The Table change could not be prepared safely. Reload and try again.",
  };

export class DirectTableComposerError extends Error {
  readonly code: DirectTableErrorCode;
  override readonly cause: unknown;

  constructor(code: DirectTableErrorCode, cause?: unknown) {
    super(directTableErrorMessages[code]);
    this.name = "DirectTableComposerError";
    this.code = code;
    this.cause = cause;
  }
}

export function directTableOwnerMessage(code: DirectTableErrorCode): string {
  return directTableErrorMessages[code];
}

export interface ComposedDirectTableAction {
  actionKind: DirectTableActionKind;
  title: string;
  description: string;
  operations: ConfigurationOperation[];
  viewKey: string;
}

function normalizeLabel(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFKC")
    .toLocaleLowerCase("en");
}

export function normalizeDirectTableLabel(value: string): string {
  return normalizeLabel(value);
}

function parseSnapshot(input: unknown): ConfigurationSnapshotV1 {
  try {
    return configurationSnapshotV1Schema.parse(input);
  } catch (error) {
    throw new DirectTableComposerError("direct_table_snapshot_invalid", error);
  }
}

function parseIntent(input: unknown): DirectTableIntent {
  try {
    return directTableIntentSchema.parse(input);
  } catch (error) {
    throw new DirectTableComposerError("direct_table_input_invalid", error);
  }
}

function allocateKey(
  reserved: Iterable<string>,
  value: string,
  fallback: string,
): string {
  try {
    return createGraphKeyAllocator(reserved).allocate(value, fallback);
  } catch (error) {
    if (
      error instanceof ConfigurationIdentityAllocationError &&
      error.code === "configuration_identity_key_unavailable"
    ) {
      throw new DirectTableComposerError("direct_table_key_unavailable", error);
    }
    throw error;
  }
}

function activeTable(
  snapshot: ConfigurationSnapshotV1,
  viewKey: string,
): {
  view: (typeof snapshot.views)[number];
  object: (typeof snapshot.object_definitions)[number];
  config: TableViewConfig;
} {
  const view = snapshot.views.find(
    (candidate) =>
      candidate.key === viewKey &&
      candidate.is_active &&
      candidate.audience === "internal" &&
      candidate.view_type === "table",
  );
  if (!view) {
    throw new DirectTableComposerError("direct_table_not_found");
  }

  const object = snapshot.object_definitions.find(
    (candidate) =>
      candidate.key === view.object_key &&
      candidate.is_active &&
      candidate.id === view.object_definition_id,
  );
  if (!object) {
    throw new DirectTableComposerError("direct_table_not_found");
  }

  try {
    return {
      view,
      object,
      config: tableViewConfigSchema.parse(view.config_json),
    };
  } catch (error) {
    throw new DirectTableComposerError("direct_table_snapshot_invalid", error);
  }
}

function activeTableFields(
  snapshot: ConfigurationSnapshotV1,
  table: ReturnType<typeof activeTable>,
): Array<(typeof snapshot.field_definitions)[number]> {
  return table.config.fields.flatMap((fieldKey) => {
    const field = snapshot.field_definitions.find(
      (candidate) =>
        candidate.object_key === table.object.key &&
        candidate.key === fieldKey &&
        candidate.object_definition_id === table.object.id &&
        candidate.is_active,
    );
    return field ? [field] : [];
  });
}

function tableField(
  snapshot: ConfigurationSnapshotV1,
  table: ReturnType<typeof activeTable>,
  fieldKey: string,
): (typeof snapshot.field_definitions)[number] {
  const field = snapshot.field_definitions.find(
    (candidate) =>
      candidate.object_key === table.object.key &&
      candidate.key === fieldKey &&
      candidate.object_definition_id === table.object.id &&
      candidate.is_active &&
      table.config.fields.includes(candidate.key),
  );
  if (!field) {
    throw new DirectTableComposerError("direct_table_not_found");
  }
  return field;
}

function objectLabelConflict(
  snapshot: ConfigurationSnapshotV1,
  title: string,
  exceptObjectKey?: string,
): boolean {
  const normalized = normalizeLabel(title);
  return snapshot.object_definitions.some(
    (object) =>
      object.key !== exceptObjectKey &&
      (normalizeLabel(object.singular_label) === normalized ||
        normalizeLabel(object.plural_label) === normalized),
  );
}

function tableNameConflict(
  snapshot: ConfigurationSnapshotV1,
  title: string,
  exceptViewKey?: string,
): boolean {
  const normalized = normalizeLabel(title);
  return snapshot.views.some(
    (view) =>
      view.key !== exceptViewKey &&
      view.audience === "internal" &&
      view.is_active &&
      normalizeLabel(view.name) === normalized,
  );
}

function fieldLabelConflict(
  fields: ReadonlyArray<{ key: string; label: string }>,
  label: string,
  exceptKey?: string,
): boolean {
  const normalized = normalizeLabel(label);
  return fields.some(
    (field) =>
      field.key !== exceptKey && normalizeLabel(field.label) === normalized,
  );
}

function settingsObject(value: Json): Record<string, Json | undefined> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : {};
}

function fieldOperation(values: Omit<FieldOperation, "op">): FieldOperation {
  return setFieldOperationSchema.parse({ op: "set_field", ...values });
}

function objectOperation(values: Omit<ObjectOperation, "op">): ObjectOperation {
  return setObjectOperationSchema.parse({ op: "set_object", ...values });
}

function directFieldType(
  type: DirectTableColumnType,
): FieldOperation["field_type"] {
  return type;
}

function composeCreateTable(
  snapshot: ConfigurationSnapshotV1,
  title: string,
): ComposedDirectTableAction {
  if (
    objectLabelConflict(snapshot, title) ||
    tableNameConflict(snapshot, title)
  ) {
    throw new DirectTableComposerError("direct_table_object_label_conflict");
  }

  const objectKey = allocateKey(
    snapshot.object_definitions.map((row) => row.key),
    title,
    "table",
  );
  const viewKey = allocateKey(
    snapshot.views.map((row) => row.key),
    title,
    "table",
  );
  const nameFieldKey = allocateKey([], "Name", "name");

  const operations: ConfigurationOperation[] = [
    {
      op: "set_object",
      key: objectKey,
      singular_label: title,
      plural_label: title,
      description: `A Table of ${title}.`,
      icon: null,
      is_active: true,
    },
    fieldOperation({
      object_key: objectKey,
      key: nameFieldKey,
      label: "Name",
      field_type: "short_text",
      required: true,
      default_value: null,
      settings_json: {},
      position: 0,
      is_active: true,
    }),
    setViewOperationSchema.parse({
      op: "set_view",
      key: viewKey,
      name: title,
      view_type: "table",
      object_key: objectKey,
      config_json: tableViewConfigSchema.parse({
        fields: [nameFieldKey],
        title_field: nameFieldKey,
        include_archived: false,
      }),
      audience: "internal",
      is_active: true,
    }),
  ];

  return finalizeAction("create_table", title, viewKey, operations);
}

function composeTableMutation(
  snapshot: ConfigurationSnapshotV1,
  intent: Exclude<DirectTableIntent, { action: "create_table" }>,
): ComposedDirectTableAction {
  const table = activeTable(snapshot, intent.viewKey);
  const fields = activeTableFields(snapshot, table);
  let operations: ConfigurationOperation[];
  let title: string;

  switch (intent.action) {
    case "rename_table": {
      if (
        tableNameConflict(snapshot, intent.title, table.view.key) ||
        objectLabelConflict(snapshot, intent.title, table.object.key)
      ) {
        throw new DirectTableComposerError(
          "direct_table_object_label_conflict",
        );
      }
      operations = [
        objectOperation({
          key: table.object.key,
          singular_label: intent.title,
          plural_label: intent.title,
          description: table.object.description,
          icon: table.object.icon,
          is_active: table.object.is_active,
        }),
        setViewOperationSchema.parse({
          op: "set_view",
          key: table.view.key,
          name: intent.title,
          view_type: table.view.view_type,
          object_key: table.view.object_key,
          config_json: table.config,
          audience: table.view.audience,
          is_active: table.view.is_active,
        }),
      ];
      title = `Rename ${intent.title}`;
      break;
    }
    case "add_column": {
      if (fieldLabelConflict(fields, intent.label)) {
        throw new DirectTableComposerError("direct_table_field_label_conflict");
      }
      if (
        (intent.columnType === "select" || intent.columnType === "status") &&
        !intent.options
      ) {
        throw new DirectTableComposerError("direct_table_options_invalid");
      }
      const fieldKey = allocateKey(
        snapshot.field_definitions
          .filter((field) => field.object_key === table.object.key)
          .map((field) => field.key),
        intent.label,
        "field",
      );
      const nextPosition =
        snapshot.field_definitions
          .filter((field) => field.object_key === table.object.key)
          .reduce((highest, field) => Math.max(highest, field.position), -1) +
        1;
      const field = fieldOperation({
        object_key: table.object.key,
        key: fieldKey,
        label: intent.label,
        field_type: directFieldType(intent.columnType),
        required: false,
        default_value: null,
        settings_json:
          intent.columnType === "currency"
            ? { ...(intent.currency ? { currency: intent.currency } : {}) }
            : intent.options
              ? { options: intent.options }
              : {},
        position: nextPosition,
        is_active: true,
      });
      const config = tableViewConfigSchema.parse({
        ...table.config,
        fields: [...table.config.fields, fieldKey],
      });
      operations = [field, tableViewOperation(table.view, config)];
      title = `Add ${intent.label}`;
      break;
    }
    case "insert_column": {
      if (fieldLabelConflict(fields, intent.label)) {
        throw new DirectTableComposerError("direct_table_field_label_conflict");
      }
      const anchorIndex = table.config.fields.indexOf(intent.anchorFieldKey);
      if (anchorIndex < 0) {
        throw new DirectTableComposerError("direct_table_not_found");
      }
      const fieldKey = allocateKey(
        snapshot.field_definitions
          .filter((field) => field.object_key === table.object.key)
          .map((field) => field.key),
        intent.label,
        "field",
      );
      const nextPosition =
        snapshot.field_definitions
          .filter((field) => field.object_key === table.object.key)
          .reduce((highest, field) => Math.max(highest, field.position), -1) +
        1;
      const field = fieldOperation({
        object_key: table.object.key,
        key: fieldKey,
        label: intent.label,
        field_type: directFieldType(intent.columnType),
        required: false,
        default_value: null,
        settings_json:
          intent.columnType === "currency"
            ? { ...(intent.currency ? { currency: intent.currency } : {}) }
            : intent.options
              ? { options: intent.options }
              : {},
        position: nextPosition,
        is_active: true,
      });
      const insertAt = anchorIndex + (intent.position === "right" ? 1 : 0);
      const fieldsNext = [...table.config.fields];
      fieldsNext.splice(insertAt, 0, fieldKey);
      operations = [
        field,
        tableViewOperation(
          table.view,
          tableViewConfigSchema.parse({ ...table.config, fields: fieldsNext }),
        ),
      ];
      title = `Insert ${intent.label}`;
      break;
    }
    case "rename_column": {
      const current = tableField(snapshot, table, intent.fieldKey);
      if (fieldLabelConflict(fields, intent.label, current.key)) {
        throw new DirectTableComposerError("direct_table_field_label_conflict");
      }
      operations = [
        fieldOperation({
          object_key: current.object_key,
          key: current.key,
          label: intent.label,
          field_type: current.field_type,
          required: current.required,
          default_value: current.default_value,
          settings_json: current.settings_json,
          position: current.position,
          is_active: current.is_active,
        }),
      ];
      title = `Rename ${intent.label}`;
      break;
    }
    case "change_column_type": {
      const current = tableField(snapshot, table, intent.fieldKey);
      if (
        table.config.title_field === current.key &&
        intent.columnType !== "short_text" &&
        intent.columnType !== "long_text"
      ) {
        throw new DirectTableComposerError("direct_table_type_change_invalid");
      }
      if (current.field_type === directFieldType(intent.columnType)) {
        throw new DirectTableComposerError("direct_table_type_change_invalid");
      }
      operations = [
        fieldOperation({
          object_key: current.object_key,
          key: current.key,
          label: current.label,
          field_type: directFieldType(intent.columnType),
          required: current.required,
          default_value: current.default_value,
          settings_json: directTableSettingsForTypeChange(
            intent.columnType,
            current.settings_json,
            intent.options,
            intent.currency,
          ),
          position: current.position,
          is_active: current.is_active,
        }),
      ];
      title = `Change ${current.label} type`;
      break;
    }
    case "update_column_options": {
      const current = tableField(snapshot, table, intent.fieldKey);
      if (current.field_type !== "select" && current.field_type !== "status") {
        throw new DirectTableComposerError("direct_table_options_invalid");
      }
      operations = [
        fieldOperation({
          object_key: current.object_key,
          key: current.key,
          label: current.label,
          field_type: current.field_type,
          required: current.required,
          default_value: current.default_value,
          settings_json: {
            ...settingsObject(current.settings_json),
            options: intent.options,
          },
          position: current.position,
          is_active: current.is_active,
        }),
      ];
      title = `Update ${current.label} options`;
      break;
    }
    case "reorder_columns": {
      const currentKeys = table.config.fields;
      if (
        intent.fieldKeys.length !== currentKeys.length ||
        new Set(intent.fieldKeys).size !== currentKeys.length ||
        intent.fieldKeys.some((key) => !currentKeys.includes(key))
      ) {
        throw new DirectTableComposerError("direct_table_reorder_invalid");
      }
      operations = [
        tableViewOperation(
          table.view,
          tableViewConfigSchema.parse({
            ...table.config,
            fields: intent.fieldKeys,
          }),
        ),
      ];
      title = `Reorder ${table.view.name}`;
      break;
    }
    case "resize_column": {
      tableField(snapshot, table, intent.fieldKey);
      const widths = { ...(table.config.column_widths ?? {}) };
      widths[intent.fieldKey] = intent.width;
      operations = [
        tableViewOperation(
          table.view,
          tableViewConfigSchema.parse({
            ...table.config,
            column_widths: widths,
          }),
        ),
      ];
      title = `Resize ${intent.fieldKey}`;
      break;
    }
  }

  return finalizeAction(intent.action, title, table.view.key, operations);
}

function tableViewOperation(
  view: ViewSource,
  config: TableViewConfig,
): ViewOperation {
  return setViewOperationSchema.parse({
    op: "set_view",
    key: view.key,
    name: view.name,
    view_type: view.view_type,
    object_key: view.object_key,
    config_json: config,
    audience: view.audience,
    is_active: view.is_active,
  });
}

function finalizeAction(
  actionKind: DirectTableActionKind,
  title: string,
  viewKey: string,
  operations: ConfigurationOperation[],
): ComposedDirectTableAction {
  try {
    return {
      actionKind,
      title: title.slice(0, 120),
      description: `Direct Table Workspace action: ${actionKind}.`,
      operations: configurationOperationsSchema.parse(operations),
      viewKey,
    };
  } catch (error) {
    throw new DirectTableComposerError(
      "direct_table_operations_invalid",
      error,
    );
  }
}

export function composeDirectTableAction(
  snapshotInput: unknown,
  intentInput: unknown,
): ComposedDirectTableAction {
  const snapshot = parseSnapshot(snapshotInput);
  const intent = parseIntent(intentInput);
  return intent.action === "create_table"
    ? composeCreateTable(snapshot, intent.title)
    : composeTableMutation(snapshot, intent);
}
