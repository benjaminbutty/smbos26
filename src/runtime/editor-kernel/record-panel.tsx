import { useState } from "react";

import {
  displayEditorValue,
  editorInputValue,
  type EditorColumn,
  type EditorRow,
  type EditorValue,
} from "./contracts";
import { ChoiceStatusPicker, ConnectionPicker } from "./cell-editors";

interface RecordPanelProps {
  columns: readonly EditorColumn[];
  row: EditorRow;
  tableName: string;
  onClose: () => void;
  onCommitCell: (rowId: string, columnKey: string, value: EditorValue) => void;
  onSearchConnectionTargets?:
    | ((
        columnKey: string,
        search: string,
      ) => Promise<readonly { id: string; label: string }[]>)
    | undefined;
  onCreateConnectionTarget?:
    | ((
        columnKey: string,
        primaryValue: string,
      ) => Promise<{ id: string; label: string }>)
    | undefined;
}

function panelDisplayValue(
  row: EditorRow,
  column: EditorColumn,
  value: EditorValue,
): string {
  if (column.kind === "connection") {
    return (
      (row.connectionValues?.[column.key] ?? [])
        .map((item) => item.label)
        .join(", ") || "—"
    );
  }
  return displayEditorValue(column, value);
}

function inputType(
  column: EditorColumn,
): "date" | "email" | "number" | "tel" | "text" | "url" {
  if (column.kind === "date") {
    return "date";
  }
  if (column.kind === "number" || column.kind === "currency") {
    return "number";
  }
  if (column.kind === "email") {
    return "email";
  }
  if (column.kind === "phone") {
    return "tel";
  }
  if (column.kind === "url") {
    return "url";
  }
  return "text";
}

function InlinePropertyEditor({
  column,
  value,
  onCancel,
  onChange,
  onCommit,
  onSearchConnectionTargets,
  onCreateConnectionTarget,
  labels,
}: Readonly<{
  column: EditorColumn;
  value: EditorValue;
  onCancel: () => void;
  onChange: (value: EditorValue) => void;
  onCommit: (value?: EditorValue) => void;
  onSearchConnectionTargets?:
    | ((
        columnKey: string,
        search: string,
      ) => Promise<readonly { id: string; label: string }[]>)
    | undefined;
  onCreateConnectionTarget?:
    | ((
        columnKey: string,
        primaryValue: string,
      ) => Promise<{ id: string; label: string }>)
    | undefined;
  labels?: readonly { id: string; label: string }[] | undefined;
}>): React.ReactNode {
  if (column.kind === "long_text") {
    return (
      <textarea
        aria-label={`Edit ${column.label}`}
        autoFocus
        className="editor-panel-inline-editor"
        onBlur={() => onCommit()}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        rows={4}
        value={editorInputValue(value)}
      />
    );
  }

  if (column.kind === "connection") {
    return (
      <ConnectionPicker
        column={column}
        labels={labels}
        onCancel={onCancel}
        onCommit={(next) => {
          onChange(next);
          onCommit(next);
        }}
        onSearch={(search) =>
          onSearchConnectionTargets
            ? onSearchConnectionTargets(column.key, search)
            : Promise.resolve(labels ?? [])
        }
        {...(onCreateConnectionTarget
          ? {
              onCreate: (primaryValue: string) =>
                onCreateConnectionTarget(column.key, primaryValue),
            }
          : {})}
        value={value}
      />
    );
  }

  if (column.kind === "status" || column.kind === "select") {
    return (
      <ChoiceStatusPicker
        column={column}
        onCancel={onCancel}
        onCommit={(next) => {
          onChange(next);
          onCommit(next);
        }}
        value={value}
      />
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
      step={
        column.kind === "number" || column.kind === "currency"
          ? "any"
          : undefined
      }
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
  onSearchConnectionTargets,
  onCreateConnectionTarget,
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
    if (column.editable === false) {
      setEditingKey(null);
      return;
    }
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
                {column.editable === false ? (
                  <span
                    className="editor-property-readonly"
                    title={column.readOnlyReason}
                  >
                    {panelDisplayValue(row, column, value)}
                  </span>
                ) : column.kind === "boolean" ? (
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
                    labels={row.connectionValues?.[column.key]}
                    onCancel={() => cancel(column.key)}
                    onChange={(next) => updateDraft(column.key, next)}
                    onCommit={(next) => commit(column, next)}
                    onSearchConnectionTargets={onSearchConnectionTargets}
                    onCreateConnectionTarget={onCreateConnectionTarget}
                    value={value}
                  />
                ) : (
                  <button
                    aria-label={`Edit ${column.label}`}
                    className="editor-property-value"
                    onClick={() => setEditingKey(column.key)}
                    type="button"
                  >
                    {panelDisplayValue(row, column, value)}
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
