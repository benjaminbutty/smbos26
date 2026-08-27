"use client";

import { useEffect, useMemo, useState } from "react";

import type { EditorColumn, EditorValue } from "./contracts";
import { ConnectionPicker } from "./cell-editors";

export interface ContextualRecordCreateConnection {
  relationshipKey: string;
  direction: "source" | "target";
  targetRecordIds: readonly string[];
}

export interface ContextualRecordCreateDialogState {
  parentLabel: string;
  connectionLabel: string;
  objectLabel: string;
  targetViewKey: string;
  columns: readonly EditorColumn[];
}

function inputType(column: EditorColumn): string {
  switch (column.kind) {
    case "email":
      return "email";
    case "url":
      return "url";
    case "phone":
      return "tel";
    case "number":
    case "currency":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime-local";
    default:
      return "text";
  }
}

function stringValue(value: EditorValue | undefined): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

function stringArray(value: EditorValue | undefined): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function initialValues(
  columns: readonly EditorColumn[],
): Record<string, EditorValue> {
  return Object.fromEntries(
    columns.flatMap((column) =>
      column.kind === "connection" || column.defaultValue === undefined
        ? []
        : [[column.key, column.defaultValue]],
    ),
  );
}

export function ContextualRecordCreateDialog({
  state,
  onClose,
  onSave,
  onSearchConnectionTargets,
}: Readonly<{
  state: ContextualRecordCreateDialogState;
  onClose: () => void;
  onSave: (
    values: Readonly<Record<string, EditorValue>>,
    connections: readonly ContextualRecordCreateConnection[],
  ) => Promise<void>;
  onSearchConnectionTargets: (
    columnKey: string,
    search: string,
  ) => Promise<readonly { id: string; label: string }[]>;
}>): React.ReactNode {
  const [values, setValues] = useState<Record<string, EditorValue>>(() =>
    initialValues(state.columns),
  );
  const [connections, setConnections] = useState<
    Record<string, readonly string[]>
  >({});
  const [labels, setLabels] = useState<
    Record<string, readonly { id: string; label: string }[]>
  >({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields = useMemo(
    () => state.columns.filter((column) => column.kind !== "connection"),
    [state.columns],
  );
  const connectionColumns = useMemo(
    () => state.columns.filter((column) => column.kind === "connection"),
    [state.columns],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      connectionColumns.map(
        async (column) =>
          [
            column.key,
            await onSearchConnectionTargets(column.key, ""),
          ] as const,
      ),
    )
      .then((items) => {
        if (!cancelled) setLabels(Object.fromEntries(items));
      })
      .catch(() => {
        // The picker will show its normal, actionable availability message.
      });
    return () => {
      cancelled = true;
    };
  }, [connectionColumns, onSearchConnectionTargets]);

  const setValue = (key: string, value: EditorValue): void => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const save = async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(
        values,
        connectionColumns.flatMap((column) => {
          if (!column.connection) return [];
          const targetRecordIds = connections[column.key] ?? [];
          return targetRecordIds.length > 0
            ? [
                {
                  relationshipKey: column.connection.relationshipKey,
                  direction: column.connection.direction,
                  targetRecordIds,
                },
              ]
            : [];
        }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "This related Record could not be added. Try again.",
      );
      setSaving(false);
    }
  };

  return (
    <div className="contextual-record-create-scrim" role="presentation">
      <section
        aria-describedby="contextual-record-create-context"
        aria-labelledby="contextual-record-create-heading"
        aria-modal="true"
        className="contextual-record-create-dialog"
        role="dialog"
      >
        <header className="contextual-record-create-header">
          <div>
            <p className="editor-record-section-eyebrow">Related work</p>
            <h2 id="contextual-record-create-heading">
              Add {state.objectLabel}
            </h2>
            <p id="contextual-record-create-context">
              Adding to <strong>{state.parentLabel}</strong> ·{" "}
              {state.connectionLabel} will be connected automatically.
            </p>
          </div>
          <button
            aria-label="Cancel adding related record"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>

        <div className="contextual-record-create-fields">
          {fields.map((column) => (
            <label className="contextual-record-create-field" key={column.key}>
              <span>{column.label}</span>
              {column.kind === "long_text" ? (
                <textarea
                  onChange={(event) =>
                    setValue(column.key, event.currentTarget.value)
                  }
                  rows={4}
                  value={stringValue(values[column.key])}
                />
              ) : column.kind === "select" || column.kind === "status" ? (
                <select
                  onChange={(event) =>
                    setValue(column.key, event.currentTarget.value)
                  }
                  value={stringValue(values[column.key])}
                >
                  <option value="">Not known yet</option>
                  {(column.options ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : column.kind === "multi_select" ? (
                <span className="contextual-record-create-options">
                  {(column.options ?? []).map((option) => {
                    const current = stringArray(values[column.key]);
                    const selected = current.includes(option);
                    return (
                      <label key={option}>
                        <input
                          checked={selected}
                          onChange={(event) => {
                            setValue(
                              column.key,
                              event.currentTarget.checked
                                ? [...current, option]
                                : current.filter((value) => value !== option),
                            );
                          }}
                          type="checkbox"
                        />
                        {option}
                      </label>
                    );
                  })}
                </span>
              ) : column.kind === "boolean" ? (
                <input
                  checked={values[column.key] === true}
                  onChange={(event) =>
                    setValue(column.key, event.currentTarget.checked)
                  }
                  type="checkbox"
                />
              ) : (
                <input
                  onChange={(event) =>
                    setValue(column.key, event.currentTarget.value)
                  }
                  step={
                    column.kind === "number" || column.kind === "currency"
                      ? "any"
                      : undefined
                  }
                  type={inputType(column)}
                  value={stringValue(values[column.key])}
                />
              )}
            </label>
          ))}

          {connectionColumns.map((column) => (
            <div className="contextual-record-create-field" key={column.key}>
              <span>{column.label}</span>
              <ConnectionPicker
                column={column}
                labels={labels[column.key]}
                onCommit={(next) =>
                  setConnections((current) => ({
                    ...current,
                    [column.key]: next,
                  }))
                }
                onSearch={(search) =>
                  onSearchConnectionTargets(column.key, search)
                }
                value={connections[column.key] ?? []}
              />
            </div>
          ))}
        </div>

        {error ? (
          <p className="contextual-record-create-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer className="contextual-record-create-actions">
          <button
            className="button button-secondary"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="button"
            disabled={saving}
            onClick={() => void save()}
            type="button"
          >
            {saving ? "Adding…" : `Add ${state.objectLabel}`}
          </button>
        </footer>
      </section>
    </div>
  );
}
