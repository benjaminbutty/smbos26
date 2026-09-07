"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { EditorRow, EditorTable } from "../editor-kernel/contracts";
import type { ProductionTableAdapterActions } from "../editor-kernel/production/production-table-adapter";

interface ChecklistWorkspaceProps {
  table: EditorTable;
  actions: ProductionTableAdapterActions;
  viewKey: string;
  labelField: string;
  completedField: string;
  readOnly?: boolean;
  businessSlug?: string;
}

function labelFor(row: EditorRow, field: string): string {
  const value = row.values[field];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return "Untitled item";
}

export function ChecklistWorkspace({
  actions,
  businessSlug,
  completedField,
  labelField,
  readOnly = false,
  table,
  viewKey,
}: Readonly<ChecklistWorkspaceProps>): ReactNode {
  const [rows, setRows] = useState(table.rows);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<Record<string, string>>({});
  const [newItem, setNewItem] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setRows(table.rows);
  }, [table.rows]);

  const activeRows = useMemo(() => rows.filter((row) => !row.isDraft), [rows]);

  async function toggle(row: EditorRow): Promise<void> {
    if (readOnly || pending.has(row.id)) return;
    const nextValue = row.values[completedField] !== true;
    setPending((current) => new Set(current).add(row.id));
    setError((current) => {
      const next = { ...current };
      delete next[row.id];
      return next;
    });
    try {
      const result = await actions.updateCell({
        fieldKey: completedField,
        recordId: row.id,
        value: nextValue,
      });
      if (result.status === "error") throw new Error(result.message);
      setRows((current) =>
        current.map((candidate) =>
          candidate.id === row.id ? result.value : candidate,
        ),
      );
    } catch (caught) {
      setError((current) => ({
        ...current,
        [row.id]:
          caught instanceof Error
            ? caught.message
            : "Could not update this item. Try again.",
      }));
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(row.id);
        return next;
      });
    }
  }

  async function createItem(): Promise<void> {
    const value = newItem.trim();
    if (!value || creating || readOnly) return;
    setCreating(true);
    try {
      const result = await actions.createRow({ primaryValue: value });
      if (result.status === "error") throw new Error(result.message);
      setRows((current) => [...current, result.value]);
      setNewItem("");
    } catch (caught) {
      setError((current) => ({
        ...current,
        __new__:
          caught instanceof Error ? caught.message : "Could not add this item.",
      }));
    } finally {
      setCreating(false);
    }
  }

  return (
    <section
      aria-label={`${table.name} checklist`}
      className="page-checklist-workspace"
      data-business-slug={businessSlug}
      data-view-key={viewKey}
    >
      <div className="page-checklist-items">
        {activeRows.length > 0 ? (
          activeRows.map((row) => {
            const completed = row.values[completedField] === true;
            const isPending = pending.has(row.id);
            return (
              <div
                className={`page-checklist-item${completed ? " is-complete" : ""}`}
                key={row.id}
              >
                <label>
                  <input
                    aria-label={`${completed ? "Mark incomplete" : "Mark complete"}: ${labelFor(row, labelField)}`}
                    checked={completed}
                    disabled={readOnly || isPending}
                    onChange={() => void toggle(row)}
                    type="checkbox"
                  />
                  <span>{labelFor(row, labelField)}</span>
                </label>
                {error[row.id] ? (
                  <span className="page-checklist-item-error" role="alert">
                    {error[row.id]}
                  </span>
                ) : null}
              </div>
            );
          })
        ) : (
          <p className="page-checklist-empty">No items yet.</p>
        )}
      </div>
      {!readOnly ? (
        <form
          className="page-checklist-add"
          onSubmit={(event) => {
            event.preventDefault();
            void createItem();
          }}
        >
          <input
            aria-label="New checklist item"
            maxLength={200}
            onChange={(event) => setNewItem(event.currentTarget.value)}
            placeholder="Add an item…"
            value={newItem}
          />
          <button
            className="button button-secondary button-small"
            disabled={!newItem.trim() || creating}
            type="submit"
          >
            {creating ? "Adding…" : "Add item"}
          </button>
        </form>
      ) : null}
      {error.__new__ ? (
        <p className="page-checklist-error" role="alert">
          {error.__new__}
        </p>
      ) : null}
    </section>
  );
}
