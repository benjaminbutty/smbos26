export type EditorColumnKind =
  "text" | "phone" | "number" | "status" | "boolean" | "date";

export type EditorValue = string | number | boolean | null;

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
  options?: readonly string[];
  width: number;
}

export interface EditorRow {
  id: string;
  values: Record<string, EditorValue>;
  isDraft?: boolean;
}

export interface EditorTable {
  key: string;
  name: string;
  primaryColumnKey: string;
  columns: readonly EditorColumn[];
  rows: readonly EditorRow[];
}

export interface CreateColumnInput {
  label: string;
  kind: EditorColumnKind;
  options?: readonly string[];
}

export interface TableEditorAdapter {
  getTable(): EditorTable;
  updateCell(
    rowId: string,
    columnKey: string,
    value: EditorValue,
  ): Promise<EditorRow>;
  createRow(
    initialValues: Readonly<Record<string, EditorValue>>,
  ): Promise<EditorRow>;
  createColumn(input: CreateColumnInput): Promise<EditorColumn>;
  renameColumn(columnKey: string, label: string): Promise<EditorColumn>;
  reorderColumns(
    columnKeys: readonly string[],
  ): Promise<readonly EditorColumn[]>;
  resizeColumn(columnKey: string, width: number): Promise<EditorColumn>;
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
    case "number": {
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
    case "text":
    case "phone":
    case "status":
    case "date":
      return value === null || value === undefined ? "" : String(value);
  }
}

export function editorInputValue(value: EditorValue): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

export function displayEditorValue(
  column: Pick<EditorColumn, "kind">,
  value: EditorValue,
): string {
  if (value === null || value === "") {
    return "—";
  }
  if (column.kind === "boolean") {
    return value === true ? "Yes" : "No";
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
