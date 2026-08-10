export type EditorColumnKind =
  | "text"
  | "long_text"
  | "email"
  | "url"
  | "phone"
  | "number"
  | "currency"
  | "status"
  | "select"
  | "boolean"
  | "date"
  | "datetime"
  | "multi_select"
  | "file"
  | "connection";

type EditorObjectValue = Readonly<
  Record<string, string | number | boolean | null | readonly string[]>
>;

export type EditorValue =
  string | number | boolean | readonly string[] | EditorObjectValue | null;

export const editorDraftRowId = "__new_record__";

export function hasDraftName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function draftRowIndex(savedRowCount: number): number {
  return savedRowCount;
}

export function freshDraftRowIndex(savedRowCount: number): number {
  return savedRowCount + 1;
}

export interface EditorColumn {
  key: string;
  label: string;
  kind: EditorColumnKind;
  primary?: boolean;
  editable?: boolean;
  required?: boolean;
  options?: readonly string[];
  currency?: string;
  readOnlyReason?: string;
  connection?: {
    relationshipKey: string;
    direction: "source" | "target";
    multiple: boolean;
    targetObjectKey: string;
    targetViewKey?: string;
  };
  width: number;
}

export interface EditorRow {
  id: string;
  values: Record<string, EditorValue>;
  connectionValues?: Record<string, readonly { id: string; label: string }[]>;
  isDraft?: boolean;
}

export interface EditorTable {
  key: string;
  name: string;
  primaryColumnKey: string;
  columns: readonly EditorColumn[];
  recordColumns?: readonly EditorColumn[];
  rows: readonly EditorRow[];
}

export interface EditorCapabilities {
  rowCreation: "direct" | "configured_form" | "unavailable";
  rowCreationMessage?: string;
  canAddColumns: boolean;
  canInsertColumns?: boolean;
  canRenameColumns: boolean;
  canChangeColumnTypes?: boolean;
  canUpdateColumnOptions: boolean;
  canReorderColumns: boolean;
  canResizeColumns: boolean;
  canRenameTable: boolean;
}

export const defaultEditorCapabilities: EditorCapabilities = {
  rowCreation: "direct",
  canAddColumns: true,
  canInsertColumns: true,
  canRenameColumns: true,
  canChangeColumnTypes: true,
  canUpdateColumnOptions: true,
  canReorderColumns: true,
  canResizeColumns: true,
  canRenameTable: true,
};

export interface CreateColumnInput {
  label: string;
  kind: EditorColumnKind;
  options?: readonly string[];
  currency?: string;
}

export interface InsertColumnInput extends CreateColumnInput {
  anchorColumnKey: string;
  position: "left" | "right";
}

export interface EditorPasteRequest {
  startRowIndex: number;
  startColumnIndex: number;
  matrix: readonly (EditorValue | null)[][];
}

export interface EditorPasteFailure {
  rowIndex: number;
  fieldKey?: string;
  message: string;
}

export interface EditorPasteResult {
  rows: readonly EditorRow[];
  failures: readonly EditorPasteFailure[];
}

export interface TableEditorAdapter {
  getTable(): EditorTable;
  updateCell(
    rowId: string,
    columnKey: string,
    value: EditorValue,
  ): Promise<EditorRow>;
  searchConnectionTargets?(
    columnKey: string,
    search: string,
  ): Promise<readonly { id: string; label: string }[]>;
  createConnectionTarget?(
    columnKey: string,
    primaryValue: string,
  ): Promise<{ id: string; label: string }>;
  createRow(
    initialValues: Readonly<Record<string, EditorValue>>,
  ): Promise<EditorRow>;
  createColumn(input: CreateColumnInput): Promise<EditorColumn>;
  insertColumn?(input: InsertColumnInput): Promise<EditorColumn>;
  renameColumn(columnKey: string, label: string): Promise<EditorColumn>;
  changeColumnType?(
    columnKey: string,
    kind: EditorColumnKind,
    options?: readonly string[],
    currency?: string,
  ): Promise<EditorColumn>;
  applyPaste?(request: EditorPasteRequest): Promise<EditorPasteResult>;
  updateColumnOptions(
    columnKey: string,
    options: readonly string[],
  ): Promise<EditorColumn>;
  reorderColumns(
    columnKeys: readonly string[],
  ): Promise<readonly EditorColumn[]>;
  resizeColumn(columnKey: string, width: number): Promise<EditorColumn>;
  renameTable(title: string): Promise<EditorTable>;
  openRecord(rowId: string): Promise<EditorRow | null>;
}

export function columnKeyFromLabel(label: string): string {
  const key = label
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return key || "column";
}

export function editorValueForColumn(
  column: Pick<EditorColumn, "kind">,
  value: unknown,
): EditorValue {
  switch (column.kind) {
    case "connection":
      if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === "string");
      }
      return value === null || value === undefined || value === ""
        ? []
        : [String(value)];
    case "number":
    case "currency": {
      if (value === "" || value === null || value === undefined) {
        return null;
      }
      const numberValue = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(numberValue)) {
        throw new Error("Enter a valid number.");
      }
      return numberValue;
    }
    case "boolean":
      return value === true || value === "true";
    case "multi_select":
      if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === "string");
      }
      return value === null || value === undefined || value === ""
        ? []
        : [String(value)];
    case "text":
    case "long_text":
    case "email":
    case "url":
    case "phone":
    case "status":
    case "select":
    case "date":
    case "datetime":
      return value === null || value === undefined ? "" : String(value);
    case "file":
      return value === null || value === undefined
        ? ""
        : typeof value === "object" && !Array.isArray(value)
          ? (value as EditorObjectValue)
          : String(value);
  }
}

export function editorInputValue(value: EditorValue): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (!Array.isArray(value) && typeof value === "object") {
    const objectValue = value as EditorObjectValue;
    const name = objectValue.name;
    if (typeof name === "string" && name.trim()) {
      return name;
    }
    const url = objectValue.url;
    if (typeof url === "string" && url.trim()) {
      return url;
    }
    return "Unavailable";
  }
  return String(value);
}

export function displayEditorValue(
  column: Pick<EditorColumn, "kind" | "currency">,
  value: EditorValue,
): string {
  if (
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  ) {
    return "—";
  }
  if (column.kind === "boolean") {
    return value === true ? "Yes" : "No";
  }
  if (column.kind === "currency" && typeof value === "number") {
    const currency =
      typeof column.currency === "string" && /^[A-Z]{3}$/.test(column.currency)
        ? column.currency
        : "GBP";
    try {
      return new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency,
      }).format(value);
    } catch {
      return String(value);
    }
  }
  if (column.kind === "date" && typeof value === "string") {
    const date = new Date(`${value}T12:00:00`);
    if (!Number.isNaN(date.valueOf())) {
      return new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(date);
    }
  }
  if (column.kind === "datetime" && typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.valueOf())) {
      return new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
    }
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (!Array.isArray(value) && typeof value === "object") {
    return editorInputValue(value);
  }
  return String(value);
}

export function reorderColumnKeys(
  columnKeys: readonly string[],
  sourceKey: string,
  targetKey: string,
): string[] {
  if (sourceKey === targetKey) {
    return [...columnKeys];
  }

  const sourceIndex = columnKeys.indexOf(sourceKey);
  const targetIndex = columnKeys.indexOf(targetKey);
  if (sourceIndex === -1 || targetIndex === -1) {
    return [...columnKeys];
  }

  const next = [...columnKeys];
  const [source] = next.splice(sourceIndex, 1);
  if (source === undefined) {
    return [...columnKeys];
  }
  next.splice(targetIndex, 0, source);
  return next;
}
