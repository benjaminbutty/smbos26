"use client";

import { useActionState, useCallback, useState, type ReactNode } from "react";

import type { Json, Tables } from "../../db/supabase/database.types";
import { FieldInputControl, FieldValue } from "../fields/field-renderer";
import {
  inlineEditFieldKey,
  inlineEditRecordId,
  inlineEditViewKey,
  type InlineEditAction,
  type InlineEditActionState,
} from "./inline-edit-contract";

interface InlineTableProps {
  action: InlineEditAction;
  editableFieldKeys: readonly string[];
  fields: Tables<"field_definitions">[];
  recordBasePath: string;
  records: Tables<"records">[];
  viewKey: string;
}

interface EditingCell {
  fieldKey: string;
  recordId: string;
}

function recordData(
  record: Tables<"records">,
): Record<string, Json | undefined> {
  return typeof record.data_json === "object" &&
    record.data_json !== null &&
    !Array.isArray(record.data_json)
    ? record.data_json
    : {};
}

function cellId(cell: EditingCell): string {
  return `${cell.recordId}:${cell.fieldKey}`;
}

function sameCell(left: EditingCell | null, right: EditingCell): boolean {
  return left !== null && cellId(left) === cellId(right);
}

const initialActionState: InlineEditActionState = { status: "idle" };

export function InlineTable({
  action,
  editableFieldKeys,
  fields,
  recordBasePath,
  records,
  viewKey,
}: Readonly<InlineTableProps>): ReactNode {
  const [rows, setRows] = useState(records);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const submitAction = useCallback(
    async (
      previousState: InlineEditActionState,
      formData: FormData,
    ): Promise<InlineEditActionState> => {
      const nextState = await action(previousState, formData);
      if (nextState.status === "success") {
        setRows((currentRows) =>
          currentRows.map((row) =>
            row.id === nextState.record.id ? nextState.record : row,
          ),
        );
        setEditingCell(null);
      }
      return nextState;
    },
    [action],
  );
  const [state, formAction, pending] = useActionState(
    submitAction,
    initialActionState,
  );
  const editableKeys = new Set(editableFieldKeys);

  const visibleError =
    state.status === "error" &&
    editingCell &&
    state.recordId === editingCell.recordId &&
    state.fieldKey === editingCell.fieldKey
      ? state.message
      : null;
  const savedMessage = state.status === "success" && !editingCell;

  return (
    <>
      {savedMessage ? (
        <p className="inline-edit-message" role="status">
          Saved.
        </p>
      ) : null}
      <div className="table-scroll">
        <table className="runtime-table">
          <thead>
            <tr>
              {fields.map((field) => (
                <th key={field.key} scope="col">
                  {field.label}
                </th>
              ))}
              <th className="row-action-heading" scope="col">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((record) => {
              const data = recordData(record);
              return (
                <tr key={record.id}>
                  {fields.map((field, index) => {
                    const editing = sameCell(editingCell, {
                      recordId: record.id,
                      fieldKey: field.key,
                    });
                    const editable = editableKeys.has(field.key);
                    const value = data[field.key];

                    return (
                      <td key={field.key}>
                        {editing ? (
                          <form
                            action={formAction}
                            className="inline-cell-form"
                          >
                            <input
                              name={inlineEditViewKey}
                              type="hidden"
                              value={viewKey}
                            />
                            <input
                              name={inlineEditRecordId}
                              type="hidden"
                              value={record.id}
                            />
                            <input
                              name={inlineEditFieldKey}
                              type="hidden"
                              value={field.key}
                            />
                            <FieldInputControl
                              ariaLabel={`Edit ${field.label}`}
                              field={field}
                              value={value}
                            />
                            <span className="inline-cell-actions">
                              <button disabled={pending} type="submit">
                                {pending ? "Saving…" : "Save"}
                              </button>
                              <button
                                className="button-secondary"
                                disabled={pending}
                                onClick={() => setEditingCell(null)}
                                type="button"
                              >
                                Cancel
                              </button>
                            </span>
                            {visibleError ? (
                              <span className="inline-cell-error" role="alert">
                                {visibleError}
                              </span>
                            ) : null}
                          </form>
                        ) : editable ? (
                          <span className="inline-cell-display">
                            {index === 0 ? (
                              <a
                                className="primary-record-link"
                                href={`${recordBasePath}/${record.id}`}
                              >
                                <FieldValue field={field} value={value} />
                              </a>
                            ) : (
                              <FieldValue field={field} value={value} />
                            )}
                            <button
                              aria-label={`Edit ${field.label}`}
                              className="inline-edit-trigger"
                              disabled={editingCell !== null || pending}
                              onClick={() =>
                                setEditingCell({
                                  recordId: record.id,
                                  fieldKey: field.key,
                                })
                              }
                              type="button"
                            >
                              Edit
                            </button>
                          </span>
                        ) : index === 0 ? (
                          <a
                            className="primary-record-link"
                            href={`${recordBasePath}/${record.id}`}
                          >
                            <FieldValue field={field} value={value} />
                          </a>
                        ) : (
                          <FieldValue field={field} value={value} />
                        )}
                      </td>
                    );
                  })}
                  <td className="row-action">
                    <a href={`${recordBasePath}/${record.id}`}>Open</a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <span className="sr-only">
        Inline editing is available for supported values when an Edit button is
        shown.
      </span>
    </>
  );
}
