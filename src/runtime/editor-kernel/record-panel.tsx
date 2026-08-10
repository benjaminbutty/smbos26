import { useState } from "react";

import {
  displayEditorValue,
  editorInputValue,
  type EditorColumn,
  type EditorRow,
  type EditorValue,
} from "./contracts";
import { ChoiceStatusPicker, ConnectionPicker } from "./cell-editors";
import { experienceKeyToPath } from "../routing";

interface RecordPanelProps {
  businessSlug?: string;
  columns: readonly EditorColumn[];
  fullRecordPath?: string;
  recordTypeLabel?: string;
  row: EditorRow;
  tableName: string;
  onBack?: (() => void) | undefined;
  onClose: () => void;
  onCommitCell: (rowId: string, columnKey: string, value: EditorValue) => void;
  onFollowConnectedRecord?:
    ((targetViewKey: string, recordId: string) => void) | undefined;
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

function connectedRecordHref(
  businessSlug: string | undefined,
  targetViewKey: string | undefined,
  recordId: string,
): string | undefined {
  if (!businessSlug || !targetViewKey) {
    return undefined;
  }
  return `/app/${encodeURIComponent(businessSlug)}/workspace/${experienceKeyToPath(
    targetViewKey,
  )}/${encodeURIComponent(recordId)}`;
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
  businessSlug,
  columns,
  fullRecordPath,
  recordTypeLabel,
  row,
  tableName,
  onBack,
  onClose,
  onCommitCell,
  onFollowConnectedRecord,
  onSearchConnectionTargets,
  onCreateConnectionTarget,
}: Readonly<RecordPanelProps>): React.ReactNode {
  const [draftValues, setDraftValues] = useState(row.values);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const primaryColumn = columns.find((column) => column.primary) ?? columns[0];
  const propertyColumns = columns.filter(
    (column) => column.kind !== "connection",
  );
  const connectionColumns = columns.filter(
    (column) => column.kind === "connection",
  );
  const recordTitle = primaryColumn
    ? displayEditorValue(primaryColumn, row.values[primaryColumn.key] ?? null)
    : "Record details";
  const fullRecordHref = fullRecordPath
    ? `${fullRecordPath}/${encodeURIComponent(row.id)}`
    : undefined;

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
          {onBack ? (
            <button
              className="editor-record-panel-back"
              onClick={onBack}
              type="button"
            >
              ← Back
            </button>
          ) : null}
          <h2>{recordTitle}</h2>
          <p className="editor-panel-table-name">
            {recordTypeLabel ?? tableName} record
          </p>
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
        {propertyColumns.map((column) => {
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
      {connectionColumns.length > 0 ? (
        <section className="editor-record-connections">
          <h3>Connected records</h3>
          <div className="editor-record-connection-list">
            {connectionColumns.map((column) => {
              const labels = row.connectionValues?.[column.key] ?? [];
              return (
                <div className="editor-record-connection" key={column.key}>
                  <span
                    aria-hidden="true"
                    className="editor-record-connection-icon"
                  >
                    ◇
                  </span>
                  <div className="editor-record-connection-copy">
                    <span className="editor-record-connection-label">
                      {column.label}
                    </span>
                    {labels.length > 0 ? (
                      <div className="editor-record-connection-values">
                        {labels.map((item, index) => {
                          const targetViewKey =
                            column.connection?.targetViewKey;
                          const href = connectedRecordHref(
                            businessSlug,
                            targetViewKey,
                            item.id,
                          );
                          return (
                            <span key={item.id}>
                              {targetViewKey && onFollowConnectedRecord ? (
                                <button
                                  className="editor-record-connection-link"
                                  onClick={() =>
                                    onFollowConnectedRecord(
                                      targetViewKey,
                                      item.id,
                                    )
                                  }
                                  type="button"
                                >
                                  {item.label}
                                </button>
                              ) : href ? (
                                <a
                                  className="editor-record-connection-link"
                                  href={href}
                                >
                                  {item.label}
                                </a>
                              ) : (
                                <span>{item.label}</span>
                              )}
                              {index < labels.length - 1 ? ", " : ""}
                            </span>
                          );
                        })}
                      </div>
                    ) : null}
                    {column.editable !== false ? (
                      <ConnectionPicker
                        column={column}
                        labels={labels}
                        onCommit={(next) =>
                          onCommitCell(row.id, column.key, next)
                        }
                        onSearch={(search) =>
                          onSearchConnectionTargets
                            ? onSearchConnectionTargets(column.key, search)
                            : Promise.resolve(labels)
                        }
                        {...(onCreateConnectionTarget
                          ? {
                              onCreate: (primaryValue: string) =>
                                onCreateConnectionTarget(
                                  column.key,
                                  primaryValue,
                                ),
                            }
                          : {})}
                        value={row.values[column.key] ?? []}
                      />
                    ) : labels.length === 0 ? (
                      <span className="editor-record-connection-values">—</span>
                    ) : null}
                  </div>
                  <span
                    aria-hidden="true"
                    className="editor-record-connection-chevron"
                  >
                    ›
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
      {fullRecordHref ? (
        <div className="editor-record-panel-footer">
          <a className="editor-record-full-link" href={fullRecordHref}>
            <span aria-hidden="true">↗</span>
            Open full record
          </a>
        </div>
      ) : null}
    </aside>
  );
}
