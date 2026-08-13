import {
  editorInputValue,
  editorValueForColumn,
  type EditorColumn,
  type EditorValue,
} from "./contracts";

export const MAX_PASTE_CELLS = 500;
export const MAX_PASTE_ROWS = 100;

const clipboardControlSelector =
  'input, textarea, select, [contenteditable="true"], form';

export function clipboardEventBelongsToGrid(
  target: EventTarget | null,
): boolean {
  const candidate = target as
    (EventTarget & { closest?: (selector: string) => unknown }) | null;

  return (
    typeof candidate?.closest !== "function" ||
    candidate.closest(clipboardControlSelector) === null
  );
}

export interface ClipboardMatrixResult {
  matrix: readonly (EditorValue | null)[][];
  cellCount: number;
}

function splitClipboardLine(line: string): string[] {
  return line.split("\t");
}

export function parseClipboardMatrix(text: string): readonly string[][] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.endsWith("\n")
    ? normalized.slice(0, -1).split("\n")
    : normalized.split("\n");
  return lines.length === 1 && lines[0] === ""
    ? []
    : lines.map(splitClipboardLine);
}

export function serializeClipboardMatrix(
  matrix: readonly (EditorValue | null)[][],
): string {
  return matrix
    .map((row) => row.map((value) => editorInputValue(value)).join("\t"))
    .join("\n");
}

function valueFromClipboard(
  raw: string,
  column: EditorColumn,
): EditorValue | null {
  if (raw.trim() === "") {
    return null;
  }
  if (column.kind === "boolean") {
    const normalized = raw.trim().toLocaleLowerCase("en");
    if (["yes", "true", "1"].includes(normalized)) return true;
    if (["no", "false", "0"].includes(normalized)) return false;
    throw new Error(`Use Yes or No for ${column.label}.`);
  }
  return editorValueForColumn(column, raw);
}

export function buildClipboardMatrix(
  text: string,
  columns: readonly EditorColumn[],
): ClipboardMatrixResult {
  const rawMatrix = parseClipboardMatrix(text);
  const cellCount = rawMatrix.reduce((sum, row) => sum + row.length, 0);
  if (rawMatrix.length > MAX_PASTE_ROWS) {
    throw new Error(`Paste is limited to ${MAX_PASTE_ROWS} records.`);
  }
  if (cellCount > MAX_PASTE_CELLS) {
    throw new Error(`Paste is limited to ${MAX_PASTE_CELLS} cells.`);
  }
  if (rawMatrix.some((row) => row.length > columns.length)) {
    throw new Error("Paste cannot add properties. Copy into existing columns.");
  }

  return {
    cellCount,
    matrix: rawMatrix.map((row) =>
      row.map((raw, index) => {
        const column = columns[index];
        if (!column) throw new Error("Paste cannot add properties.");
        return valueFromClipboard(raw, column);
      }),
    ),
  };
}

export function selectionBounds(
  anchor: { rowIndex: number; columnIndex: number },
  end: { rowIndex: number; columnIndex: number },
): {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
} {
  return {
    startRow: Math.min(anchor.rowIndex, end.rowIndex),
    endRow: Math.max(anchor.rowIndex, end.rowIndex),
    startColumn: Math.min(anchor.columnIndex, end.columnIndex),
    endColumn: Math.max(anchor.columnIndex, end.columnIndex),
  };
}
