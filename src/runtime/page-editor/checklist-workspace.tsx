"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type {
  EditorRow,
  EditorTable,
  EditorValue,
} from "../editor-kernel/contracts";
import type { ProductionTableAdapterActions } from "../editor-kernel/production/production-table-adapter";
import type {
  ProductionActionResult,
  ProductionCellEditInput,
  ProductionTablePageAction,
} from "../editor-kernel/production/action-types";

export type PageChecklistCellAction = (
  blockId: string,
  input: ProductionCellEditInput,
) => Promise<ProductionActionResult<EditorRow>>;

export type PageChecklistRowAction = (
  blockId: string,
  input: { labelValue: string },
) => Promise<ProductionActionResult<EditorRow>>;

interface ChecklistWorkspaceProps {
  table: EditorTable;
  actions: ProductionTableAdapterActions;
  viewKey: string;
  labelField: string;
  completedField: string;
  readOnly?: boolean;
  businessSlug?: string;
  blockId?: string;
  creationFallbackHref?: string;
  initialSearch?: string;
  initialTotalCount?: number;
  initialHasMore?: boolean;
  loadTablePage?: ProductionTablePageAction;
  pageAwareUpdateCell?: PageChecklistCellAction;
  pageAwareCreateRow?: PageChecklistRowAction;
  canCreate?: boolean;
}

function labelFor(row: EditorRow, field: string): string {
  const value = row.values[field];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return "Untitled item";
}

function replaceRow(rows: readonly EditorRow[], next: EditorRow): EditorRow[] {
  return rows.map((row) => (row.id === next.id ? next : row));
}

export function ChecklistWorkspace({
  actions,
  blockId,
  businessSlug,
  canCreate,
  completedField,
  creationFallbackHref,
  initialHasMore = false,
  initialSearch = "",
  initialTotalCount,
  labelField,
  loadTablePage,
  pageAwareCreateRow,
  pageAwareUpdateCell,
  readOnly = false,
  table,
  viewKey,
}: Readonly<ChecklistWorkspaceProps>): ReactNode {
  const [rows, setRows] = useState(table.rows);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<Record<string, string>>({});
  const [newItem, setNewItem] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [search, setSearch] = useState(initialSearch);
  const [appliedSearch, setAppliedSearch] = useState(initialSearch);
  const [totalCount, setTotalCount] = useState(
    initialTotalCount ?? table.rows.length,
  );
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingPage, setLoadingPage] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const requestVersion = useRef(0);

  useEffect(() => {
    setRows(table.rows);
    setTotalCount(initialTotalCount ?? table.rows.length);
    setHasMore(initialHasMore);
  }, [initialHasMore, initialTotalCount, table.rows]);

  const activeRows = useMemo(() => rows.filter((row) => !row.isDraft), [rows]);
  const columns = table.recordColumns ?? table.columns;
  const primaryColumn = columns.find(
    (column) => column.key === table.primaryColumnKey,
  );
  const labelColumn = columns.find((column) => column.key === labelField);
  const completionColumn = columns.find(
    (column) => column.key === completedField,
  );
  const canWriteLabels =
    !readOnly &&
    labelColumn?.editable !== false &&
    Boolean(pageAwareUpdateCell || actions.updateCell);
  const canWriteCompletion =
    !readOnly &&
    completionColumn?.kind === "boolean" &&
    completionColumn.editable !== false &&
    Boolean(pageAwareUpdateCell || actions.updateCell);
  const canAddItems =
    !readOnly &&
    canCreate !== false &&
    primaryColumn?.editable !== false &&
    Boolean(pageAwareCreateRow || actions.createRow);

  const loadPage = async (
    offset: number,
    nextSearch: string,
    append: boolean,
  ): Promise<void> => {
    if (!loadTablePage) return;
    const version = ++requestVersion.current;
    setLoadingPage(true);
    setPageError(null);
    try {
      const result = await loadTablePage({
        offset,
        search: nextSearch,
      });
      if (version !== requestVersion.current) return;
      if (result.status === "error") throw new Error(result.message);
      setRows((current) =>
        append
          ? [
              ...current,
              ...result.value.rows.filter(
                (row) => !current.some((candidate) => candidate.id === row.id),
              ),
            ]
          : [...result.value.rows],
      );
      setAppliedSearch(result.value.search);
      setTotalCount(result.value.totalCount);
      setHasMore(result.value.hasMore);
    } catch (caught) {
      if (version !== requestVersion.current) return;
      setPageError(
        caught instanceof Error
          ? caught.message
          : "Could not load checklist items. Try again.",
      );
    } finally {
      if (version === requestVersion.current) setLoadingPage(false);
    }
  };

  useEffect(() => {
    if (!loadTablePage) return;
    const timer = window.setTimeout(
      () => void loadPage(0, search.trim(), false),
      180,
    );
    return () => {
      window.clearTimeout(timer);
      requestVersion.current += 1;
    };
    // `loadTablePage` is stable for a given Page render; the callback only
    // reads the current search value and server action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadTablePage, search]);

  async function updateCell(
    row: EditorRow,
    fieldKey: string,
    value: EditorValue,
  ): Promise<EditorRow> {
    const result =
      pageAwareUpdateCell && blockId
        ? await pageAwareUpdateCell(blockId, {
            fieldKey,
            recordId: row.id,
            value,
          })
        : await actions.updateCell({ fieldKey, recordId: row.id, value });
    if (result.status === "error") throw new Error(result.message);
    return result.value;
  }

  async function toggle(row: EditorRow): Promise<void> {
    if (!canWriteCompletion || pending.has(row.id)) return;
    const nextValue = row.values[completedField] !== true;
    setPending((current) => new Set(current).add(row.id));
    setError((current) => {
      const next = { ...current };
      delete next[row.id];
      return next;
    });
    try {
      const updated = await updateCell(row, completedField, nextValue);
      setRows((current) => replaceRow(current, updated));
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

  async function saveLabel(row: EditorRow): Promise<void> {
    const value = labelDraft.trim();
    setEditingLabelId(null);
    if (!value || value === labelFor(row, labelField) || !canWriteLabels)
      return;
    setPending((current) => new Set(current).add(row.id));
    try {
      const updated = await updateCell(row, labelField, value);
      setRows((current) => replaceRow(current, updated));
      setError((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
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
    if (!value || creating || !canAddItems) return;
    setCreating(true);
    setError((current) => {
      const next = { ...current };
      delete next.__new__;
      return next;
    });
    try {
      const result =
        pageAwareCreateRow && blockId
          ? await pageAwareCreateRow(blockId, { labelValue: value })
          : await actions.createRow({ primaryValue: value });
      if (result.status === "error") throw new Error(result.message);
      let created = result.value;
      if (!pageAwareCreateRow && labelField !== table.primaryColumnKey) {
        created = await updateCell(created, labelField, value);
      }
      setRows((current) => [...current, created]);
      setTotalCount((current) => current + 1);
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
      {loadTablePage ? (
        <div className="page-checklist-toolbar">
          <label>
            <span className="editor-sr-only">Search checklist</span>
            <input
              aria-label="Search checklist"
              maxLength={200}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="Search items…"
              type="search"
              value={search}
            />
          </label>
          <span role="status">
            {activeRows.length} of {totalCount}
            {appliedSearch ? " matching" : ""} items
          </span>
        </div>
      ) : null}
      <div className="page-checklist-items">
        {activeRows.length > 0 ? (
          activeRows.map((row) => {
            const completed = row.values[completedField] === true;
            const isPending = pending.has(row.id);
            const isEditingLabel = editingLabelId === row.id;
            return (
              <div
                className={`page-checklist-item${completed ? " is-complete" : ""}`}
                key={row.id}
              >
                <div className="page-checklist-item-check">
                  <input
                    aria-label={`${completed ? "Mark incomplete" : "Mark complete"}: ${labelFor(row, labelField)}`}
                    checked={completed}
                    disabled={!canWriteCompletion || isPending}
                    onChange={() => void toggle(row)}
                    type="checkbox"
                  />
                  {isEditingLabel ? (
                    <input
                      aria-label="Checklist item label"
                      autoFocus
                      onChange={(event) =>
                        setLabelDraft(event.currentTarget.value)
                      }
                      onBlur={() => void saveLabel(row)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void saveLabel(row);
                        }
                        if (event.key === "Escape") setEditingLabelId(null);
                      }}
                      value={labelDraft}
                    />
                  ) : (
                    <button
                      className="page-checklist-label"
                      disabled={!canWriteLabels || isPending}
                      onClick={() => {
                        setEditingLabelId(row.id);
                        setLabelDraft(labelFor(row, labelField));
                      }}
                      title={canWriteLabels ? "Edit item label" : undefined}
                      type="button"
                    >
                      {labelFor(row, labelField)}
                    </button>
                  )}
                </div>
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
      {hasMore ? (
        <button
          className="button button-secondary button-small page-checklist-load-more"
          disabled={loadingPage}
          onClick={() => void loadPage(rows.length, appliedSearch, true)}
          type="button"
        >
          {loadingPage ? "Loading…" : "Load more"}
        </button>
      ) : null}
      {pageError ? (
        <p className="page-checklist-error" role="alert">
          {pageError}{" "}
          <button onClick={() => void loadPage(0, search, false)} type="button">
            Retry
          </button>
        </p>
      ) : null}
      {!readOnly && canAddItems ? (
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
      ) : !readOnly && creationFallbackHref ? (
        <a
          className="button button-secondary button-small page-checklist-add-link"
          href={creationFallbackHref}
        >
          Open creation screen
        </a>
      ) : null}
      {error.__new__ ? (
        <p className="page-checklist-error" role="alert">
          {error.__new__}
        </p>
      ) : null}
    </section>
  );
}
