import { useState } from "react";

import {
  displayEditorValue,
  editorInputValue,
  type EditorColumn,
  type EditorRow,
  type EditorValue,
} from "./contracts";

interface RecordPanelProps {
  columns: readonly EditorColumn[];
  row: EditorRow;
  tableName: string;
  onClose: () => void;
  onCommitCell: (rowId: string, columnKey: string, value: EditorValue) => void;
}

function inputType(column: EditorColumn): "date" | "number" | "text" {
  if (column.kind === "date") {
    return "date";
  }
  if (column.kind === "number") {
    return "number";
  }
  return "text";
}

function InlinePropertyEditor({
  column,
  value,
  onCancel,
  onChange,
  onCommit,
}: Readonly<{
  column: EditorColumn;
  value: EditorValue;
  onCancel: () => void;
  onChange: (value: EditorValue) => void;
  onCommit: (value?: EditorValue) => void;
}>): React.ReactNode {
  if (column.kind === "status") {
    return (
      <select
        aria-label={`Edit ${column.label}`}
        autoFocus
        className="editor-panel-inline-editor editor-panel-status-editor"
        onChange={(event) => {
          const next = event.currentTarget.value;
          onChange(next);
          onCommit(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        value={editorInputValue(value)}
      >
        {(column.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      aria-label={`Edit ${column.label}`}
      autoFocus
      className="editor-panel-inline-editor"
      onBlur={() => onCommit()}
      onChange={(event) => onChange(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          onCommit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
      step={column.kind === "number" ? "any" : undefined}
      type={inputType(column)}
      value={editorInputValue(value)}
    />
  );
}

export function RecordPanel({
  columns,
  row,
  tableName,
  onClose,
  onCommitCell,
}: Readonly<RecordPanelProps>): React.ReactNode {
  const [draftValues, setDraftValues] = useState(row.values);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const updateDraft = (columnKey: string, value: EditorValue): void => {
    setDraftValues((current) => ({ ...current, [columnKey]: value }));
  };

  const cancel = (columnKey: string): void => {
    setDraftValues((current) => ({
      ...current,
      [columnKey]: row.values[columnKey] ?? null,
    }));
    setEditingKey(null);
  };

  const commit = (column: EditorColumn, nextValue?: EditorValue): void => {
    onCommitCell(
      row.id,
      column.key,
      nextValue === undefined ? (draftValues[column.key] ?? null) : nextValue,
    );
    setEditingKey(null);
  };

  return (
    <aside aria-label={`${tableName} record`} className="editor-record-panel">
      <div className="editor-record-panel-header">
        <div>
          <p className="editor-panel-eyebrow">Record</p>
          <h2>Record details</h2>
          <p className="editor-panel-table-name">{tableName}</p>
        </div>
        <button
          aria-label="Close record panel"
          className="editor-panel-close"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
      </div>

      <div className="editor-record-properties">
        {columns.map((column) => {
          const value = draftValues[column.key] ?? null;
          const isEditing = editingKey === column.key;

          return (
            <div className="editor-record-property" key={column.key}>
              <span className="editor-record-property-label">
                {column.label}
              </span>
              <div className="editor-record-property-value">
                {column.kind === "boolean" ? (
                  <input
                    aria-label={`Edit ${column.label}`}
                    checked={value === true}
                    className="editor-panel-checkbox"
                    onChange={(event) => {
                      const next = event.currentTarget.checked;
                      updateDraft(column.key, next);
                      onCommitCell(row.id, column.key, next);
                    }}
                    type="checkbox"
                  />
                ) : isEditing ? (
                  <InlinePropertyEditor
                    column={column}
                    onCancel={() => cancel(column.key)}
                    onChange={(next) => updateDraft(column.key, next)}
                    onCommit={(next) => commit(column, next)}
                    value={value}
                  />
                ) : (
                  <button
                    aria-label={`Edit ${column.label}`}
                    className="editor-property-value"
                    onClick={() => setEditingKey(column.key)}
                    type="button"
                  >
                    {displayEditorValue(column, value)}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
