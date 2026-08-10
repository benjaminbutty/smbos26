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

export function ChoiceStatusPicker({
  column,
  onCancel,
  onCommit,
  value,
}: Readonly<{
  column: EditorColumn;
  onCancel?: () => void;
  onCommit: (value: EditorValue) => void;
  value: EditorValue;
}>): React.ReactNode {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const options = (column.options ?? []).filter((option) =>
    option.toLocaleLowerCase("en").includes(query.toLocaleLowerCase("en")),
  );
  useEffect(() => buttonRef.current?.focus(), []);
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);
  const commitOption = (option: string): void => {
    onCommit(option);
    setOpen(false);
  };
  return (
    <div className="editor-choice-picker">
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Edit ${column.label}`}
        className="editor-choice-trigger"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            if (onCancel) {
              onCancel();
            } else {
              setOpen(false);
            }
          } else if (event.key === "ArrowDown" || event.key === "Enter") {
            event.preventDefault();
            setOpen(true);
          } else if (event.key === "Backspace" || event.key === "Delete") {
            event.preventDefault();
            onCommit(null);
          }
        }}
        ref={buttonRef}
        type="button"
      >
        {editorInputValue(value) || "Choose…"}
      </button>
      {open ? (
        <div className="editor-choice-popover" role="listbox">
          <input
            aria-label={`Search ${column.label}`}
            className="editor-choice-search"
            ref={searchRef}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                if (onCancel) {
                  onCancel();
                } else {
                  setOpen(false);
                }
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((current) =>
                  options.length === 0
                    ? 0
                    : Math.min(current + 1, options.length - 1),
                );
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) => Math.max(current - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const option = options[activeIndex];
                if (option) commitOption(option);
              } else if (
                (event.key === "Backspace" || event.key === "Delete") &&
                !query
              ) {
                event.preventDefault();
                onCommit(null);
                setOpen(false);
              }
            }}
            placeholder="Search"
            value={query}
          />
          {options.map((option, index) => (
            <button
              aria-current={option === value ? "true" : undefined}
              aria-selected={index === activeIndex}
              className={`editor-choice-option${index === activeIndex ? " is-active" : ""}`}
              id={`editor-choice-${column.key}-${index}`}
              key={option}
              onClick={() => commitOption(option)}
              onMouseEnter={() => setActiveIndex(index)}
              role="option"
              type="button"
            >
              <span className="editor-status-pill">{option}</span>
            </button>
          ))}
          <button
            className="editor-choice-clear"
            onClick={() => {
              onCommit(null);
              setOpen(false);
            }}
            type="button"
          >
            Clear
          </button>
        </div>
      ) : null}
    </div>
  );
}

function StatusEditor({
  columnDefinition,
  onRowChange,
  row,
}: CellEditorProps): React.ReactNode {
  const value = editorInputValue(row.values[columnDefinition.key] ?? null);
  return (
    <ChoiceStatusPicker
      column={columnDefinition}
      onCommit={(next) =>
        onRowChange(rowWithValue(row, columnDefinition.key, next), true)
      }
      value={value}
    />
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
    <div className="editor-date-editor">
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
      <button
        onClick={() => {
          const today = new Date().toISOString().slice(0, 10);
          setValue(today);
          onRowChange(rowWithValue(row, columnDefinition.key, today), true);
        }}
        type="button"
      >
        Today
      </button>
      <button
        onClick={() => {
          setValue("");
          onRowChange(rowWithValue(row, columnDefinition.key, null), true);
        }}
        type="button"
      >
        Clear
      </button>
    </div>
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
