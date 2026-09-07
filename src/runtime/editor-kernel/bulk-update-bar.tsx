"use client";

import { useMemo, useState, type ReactNode } from "react";

import {
  editorValueForColumn,
  type EditorColumn,
  type EditorRow,
  type EditorValue,
} from "./contracts";

export interface BulkUpdateSelection {
  recordId: string;
  expectedUpdatedAt: string;
}

function eligibleColumn(column: EditorColumn): boolean {
  return (
    column.editable !== false &&
    !column.primary &&
    column.kind !== "connection" &&
    column.kind !== "file"
  );
}

function inputForColumn(
  column: EditorColumn,
  value: string,
  onChange: (value: string) => void,
): ReactNode {
  if (column.kind === "boolean") {
    return (
      <select
        aria-label={`Value for ${column.label}`}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  if (
    (column.kind === "select" || column.kind === "status") &&
    column.options
  ) {
    return (
      <select
        aria-label={`Value for ${column.label}`}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {column.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      aria-label={`Value for ${column.label}`}
      onChange={(event) => onChange(event.target.value)}
      type={
        column.kind === "number" || column.kind === "currency"
          ? "number"
          : "text"
      }
      value={value}
    />
  );
}

export function TableBulkUpdateBar({
  columns,
  onApply,
  onClearSelection,
  selection,
}: Readonly<{
  columns: readonly EditorColumn[];
  onApply: (
    fieldKey: string,
    value: EditorValue,
    selection: readonly BulkUpdateSelection[],
  ) => Promise<void>;
  onClearSelection: () => void;
  selection: readonly BulkUpdateSelection[];
}>): ReactNode {
  const eligible = useMemo(() => columns.filter(eligibleColumn), [columns]);
  const [fieldKey, setFieldKey] = useState(eligible[0]?.key ?? "");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (selection.length === 0 || eligible.length === 0) return null;
  const field =
    eligible.find((column) => column.key === fieldKey) ?? eligible[0];
  if (!field) return null;

  const apply = async (clear: boolean): Promise<void> => {
    if (selection.length > 100) {
      setError("Bulk updates are limited to 100 loaded records.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onApply(
        field.key,
        clear ? null : editorValueForColumn(field, value),
        selection,
      );
      setValue("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not update selected records.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-label="Update selected records"
      className="editor-bulk-update-bar"
    >
      <div className="editor-bulk-update-heading">
        <strong>{selection.length} Records selected</strong>
        <span>Only the loaded Records you checked will change.</span>
      </div>
      <button
        className="editor-bulk-clear-selection"
        disabled={saving}
        onClick={onClearSelection}
        type="button"
      >
        Clear selection
      </button>
      <label>
        <span>Property</span>
        <select
          onChange={(event) => {
            setFieldKey(event.target.value);
            setValue("");
          }}
          value={field.key}
        >
          {eligible.map((column) => (
            <option key={column.key} value={column.key}>
              {column.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Value</span>
        {inputForColumn(field, value, setValue)}
      </label>
      <button
        disabled={saving || selection.length > 100}
        onClick={() => void apply(false)}
        type="button"
      >
        {saving
          ? "Updating…"
          : `Set ${field.label} for ${selection.length} Records`}
      </button>
      <button
        disabled={saving || selection.length > 100}
        onClick={() => void apply(true)}
        type="button"
      >
        Clear value
      </button>
      {error ? <p role="status">{error}</p> : null}
    </section>
  );
}

export function selectionForRows(
  rows: readonly EditorRow[],
): BulkUpdateSelection[] {
  return rows.flatMap((row) =>
    row.isDraft || !row.updatedAt
      ? []
      : [{ recordId: row.id, expectedUpdatedAt: row.updatedAt }],
  );
}
