import { useEffect, useRef, useState, type RefObject } from "react";
import type { RenderEditCellProps } from "react-data-grid";

import {
  editorInputValue,
  type EditorColumn,
  type EditorRow,
  type EditorValue,
} from "../contracts";

interface CellEditorProps extends RenderEditCellProps<EditorRow> {
  columnDefinition: EditorColumn;
  initialValue: EditorValue | undefined;
}

function rowWithValue(
  row: EditorRow,
  columnKey: string,
  value: EditorValue,
): EditorRow {
  return { ...row, values: { ...row.values, [columnKey]: value } };
}

function useFocusAndSelect(
  ref: RefObject<HTMLInputElement | HTMLSelectElement | null>,
  shouldSelect = true,
): void {
  useEffect(() => {
    ref.current?.focus();
    if (ref.current instanceof HTMLInputElement) {
      if (shouldSelect) {
        ref.current.select();
      } else if (ref.current.type !== "number") {
        const end = ref.current.value.length;
        ref.current.setSelectionRange(end, end);
      }
    }
  }, [ref, shouldSelect]);
}

function useSeedInitialValue({
  columnDefinition,
  initialValue,
  onRowChange,
  row,
}: Readonly<{
  columnDefinition: EditorColumn;
  initialValue: EditorValue | undefined;
  onRowChange: CellEditorProps["onRowChange"];
  row: EditorRow;
}>): void {
  const didSeed = useRef(false);
  useEffect(() => {
    if (initialValue !== undefined && !didSeed.current) {
      didSeed.current = true;
      onRowChange(rowWithValue(row, columnDefinition.key, initialValue));
    }
  }, [columnDefinition.key, initialValue, onRowChange, row]);
}

function TextLikeEditor({
  columnDefinition,
  initialValue,
  onRowChange,
  row,
}: CellEditorProps): React.ReactNode {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(() =>
    editorInputValue(
      initialValue === undefined
        ? (row.values[columnDefinition.key] ?? null)
        : initialValue,
    ),
  );
  useFocusAndSelect(ref, initialValue === undefined);
  useSeedInitialValue({
    columnDefinition,
    initialValue,
    onRowChange,
    row,
  });

  const inputType =
    columnDefinition.kind === "email"
      ? "email"
      : columnDefinition.kind === "url"
        ? "url"
        : columnDefinition.kind === "phone"
          ? "tel"
          : "text";

  return (
    <input
      ref={ref}
      aria-label={`Edit ${columnDefinition.label}`}
      className="editor-cell-editor"
      onChange={(event) => {
        const next = event.currentTarget.value;
        setValue(next);
        onRowChange(rowWithValue(row, columnDefinition.key, next));
      }}
      type={inputType}
      value={value}
    />
  );
}

function NumberEditor({
  columnDefinition,
  initialValue,
  onRowChange,
  row,
}: CellEditorProps): React.ReactNode {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(() =>
    editorInputValue(
      initialValue === undefined
        ? (row.values[columnDefinition.key] ?? null)
        : initialValue,
    ),
  );
  useFocusAndSelect(ref, initialValue === undefined);
  useSeedInitialValue({
    columnDefinition,
    initialValue,
    onRowChange,
    row,
  });

  return (
    <input
      ref={ref}
      aria-label={`Edit ${columnDefinition.label}`}
      className="editor-cell-editor editor-number-editor"
      inputMode="decimal"
      onChange={(event) => {
        const next = event.currentTarget.value;
        setValue(next);
        onRowChange(rowWithValue(row, columnDefinition.key, next));
      }}
      step="any"
      type="number"
      value={value}
    />
  );
}

function StatusEditor({
  columnDefinition,
  onRowChange,
  row,
}: CellEditorProps): React.ReactNode {
  const ref = useRef<HTMLSelectElement>(null);
  const value = editorInputValue(row.values[columnDefinition.key] ?? null);
  useFocusAndSelect(ref);

  return (
    <select
      ref={ref}
      aria-label={`Edit ${columnDefinition.label}`}
      className="editor-cell-editor"
      onChange={(event) => {
        onRowChange(
          rowWithValue(row, columnDefinition.key, event.currentTarget.value),
          true,
        );
      }}
      value={value}
    >
      {(columnDefinition.options ?? []).map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function BooleanEditor({
  columnDefinition,
  onRowChange,
  row,
}: CellEditorProps): React.ReactNode {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), [ref]);

  return (
    <label className="editor-boolean-editor">
      <input
        ref={ref}
        aria-label={`Edit ${columnDefinition.label}`}
        checked={row.values[columnDefinition.key] === true}
        onChange={(event) => {
          onRowChange(
            rowWithValue(
              row,
              columnDefinition.key,
              event.currentTarget.checked,
            ),
            true,
          );
        }}
        type="checkbox"
      />
      <span>{row.values[columnDefinition.key] === true ? "Yes" : "No"}</span>
    </label>
  );
}

function DateEditor({
  columnDefinition,
  initialValue,
  onRowChange,
  row,
}: CellEditorProps): React.ReactNode {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(() =>
    editorInputValue(
      initialValue === undefined
        ? (row.values[columnDefinition.key] ?? null)
        : initialValue,
    ),
  );
  useFocusAndSelect(ref);

  return (
    <input
      ref={ref}
      aria-label={`Edit ${columnDefinition.label}`}
      className="editor-cell-editor"
      onChange={(event) => {
        const next = event.currentTarget.value;
        setValue(next);
        onRowChange(rowWithValue(row, columnDefinition.key, next));
      }}
      type="date"
      value={value}
    />
  );
}

export function CellEditor(props: CellEditorProps): React.ReactNode {
  switch (props.columnDefinition.kind) {
    case "number":
    case "currency":
      return <NumberEditor {...props} />;
    case "select":
    case "status":
      return <StatusEditor {...props} />;
    case "boolean":
      return <BooleanEditor {...props} />;
    case "date":
      return <DateEditor {...props} />;
    case "text":
    case "long_text":
    case "email":
    case "url":
    case "phone":
    case "datetime":
    case "multi_select":
    case "file":
      return <TextLikeEditor {...props} />;
  }
}
