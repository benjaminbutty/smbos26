"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DataGrid,
  type CellKeyDownArgs,
  type CellKeyboardEvent,
  type DataGridHandle,
  type RowsChangeData,
} from "react-data-grid";

import {
  editorDraftRowId,
  editorInputValue,
  editorValueForColumn,
  freshDraftRowIndex,
  hasDraftName,
  reorderColumnKeys,
  type CreateColumnInput,
  type EditorColumnKind,
  type EditorRow,
  type EditorTable,
  type EditorValue,
} from "./contracts";
import { createEditorColumns, type PendingEdit } from "./table-columns";
import { RecordPanel } from "./record-panel";
import type { TableEditorAdapter } from "./contracts";

export interface EditorKernelProps {
  adapter: TableEditorAdapter;
  footer?: ReactNode;
  marker?: ReactNode;
  title?: string;
}

interface ActiveCell {
  rowId: string;
  columnKey: string;
}

interface SaveRetry {
  rowId: string;
  columnKey: string;
  value: EditorValue;
}

type SaveState =
  | { status: "saved" }
  | { status: "saving" }
  | { status: "error"; cellLabel: string };

const addableColumnKinds: ReadonlyArray<{
  kind: EditorColumnKind;
  label: string;
}> = [
  { kind: "text", label: "Text" },
  { kind: "number", label: "Number" },
  { kind: "boolean", label: "Yes / No" },
  { kind: "date", label: "Date" },
  { kind: "status", label: "Status" },
];

function replaceCell(
  table: EditorTable,
  rowId: string,
  columnKey: string,
  value: EditorValue,
): EditorTable {
  return {
    ...table,
    rows: table.rows.map((row) =>
      row.id === rowId
        ? { ...row, values: { ...row.values, [columnKey]: value } }
        : row,
    ),
  };
}

function isPrintableKey(event: React.KeyboardEvent): boolean {
  return (
    event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey
  );
}

function statusLabel(state: SaveState): string {
  switch (state.status) {
    case "saving":
      return "Saving…";
    case "error":
      return "Could not save";
    case "saved":
      return "Saved";
  }
}

function AddColumnPopover({
  onClose,
  onCreate,
}: Readonly<{
  onClose: () => void;
  onCreate: (input: CreateColumnInput) => Promise<void>;
}>): ReactNode {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<EditorColumnKind>("text");
  const [options, setOptions] = useState("Active\nInactive");
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      className="editor-add-column-popover"
      onSubmit={(event) => {
        event.preventDefault();
        if (!label.trim() || submitting) {
          return;
        }
        const input: CreateColumnInput = { label, kind };
        if (kind === "status") {
          input.options = options
            .split("\n")
            .map((option) => option.trim())
            .filter(Boolean);
        }
        setSubmitting(true);
        void onCreate(input).finally(() => setSubmitting(false));
      }}
    >
      <div className="editor-popover-heading">
        <strong>Add column</strong>
        <button
          aria-label="Close add column menu"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
      </div>
      <label>
        Name
        <input
          autoFocus
          maxLength={80}
          onChange={(event) => setLabel(event.currentTarget.value)}
          placeholder="e.g. Email"
          required
          value={label}
        />
      </label>
      <label>
        Type
        <select
          onChange={(event) =>
            setKind(event.currentTarget.value as EditorColumnKind)
          }
          value={kind}
        >
          {addableColumnKinds.map((option) => (
            <option key={option.kind} value={option.kind}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {kind === "status" ? (
        <label>
          Options
          <textarea
            onChange={(event) => setOptions(event.currentTarget.value)}
            rows={3}
            value={options}
          />
        </label>
      ) : null}
      <button
        className="editor-menu-submit"
        disabled={submitting}
        type="submit"
      >
        {submitting ? "Adding…" : "Add column"}
      </button>
    </form>
  );
}

export function EditorKernel({
  adapter,
  footer,
  marker,
  title,
}: Readonly<EditorKernelProps>): ReactNode {
  const [table, setTable] = useState<EditorTable>(() => adapter.getTable());
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null);
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const [columnMenuKey, setColumnMenuKey] = useState<string | null>(null);
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [panelRowId, setPanelRowId] = useState<string | null>(null);
  const [panelOrigin, setPanelOrigin] = useState<ActiveCell | null>(null);
  const [draftActivation, setDraftActivation] = useState<{
    rowIdx: number;
    columnIdx: number;
  } | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: "saved" });
  const [retry, setRetry] = useState<SaveRetry | null>(null);
  const gridRef = useRef<DataGridHandle>(null);
  const operationVersions = useRef(new Map<string, number>());
  const pendingSaves = useRef(new Set<string>());

  const panelRow = panelRowId
    ? (table.rows.find((row) => row.id === panelRowId) ?? null)
    : null;

  const closePanel = useCallback(() => {
    const origin = panelOrigin;
    setPanelRowId(null);
    setPanelOrigin(null);
    if (!origin) {
      return;
    }
    window.requestAnimationFrame(() => {
      const rowIdx = table.rows.findIndex((row) => row.id === origin.rowId);
      const columnIdx = table.columns.findIndex(
        (column) => column.key === origin.columnKey,
      );
      if (rowIdx >= 0 && columnIdx >= 0) {
        gridRef.current?.selectCell(
          { idx: columnIdx, rowIdx },
          { shouldFocusCell: true },
        );
        window.requestAnimationFrame(() => {
          const selectedCell =
            gridRef.current?.element?.querySelector<HTMLElement>(
              '[role="gridcell"][aria-selected="true"]',
            );
          selectedCell?.focus({ preventScroll: true });
        });
      }
    });
  }, [panelOrigin, table.columns, table.rows]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || !panelRowId) {
        return;
      }
      if (
        event.target instanceof HTMLElement &&
        (event.target.closest(".rdg-editor-container") ||
          event.target.closest(".editor-panel-inline-editor"))
      ) {
        return;
      }
      event.preventDefault();
      closePanel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closePanel, panelRowId]);

  useEffect(() => {
    if (!draftActivation) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      gridRef.current?.selectCell(
        { idx: draftActivation.columnIdx, rowIdx: draftActivation.rowIdx },
        { shouldFocusCell: true },
      );
      setDraftActivation(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [draftActivation]);

  const commitCell = useCallback(
    (rowId: string, columnKey: string, rawValue: unknown): void => {
      const row = table.rows.find((candidate) => candidate.id === rowId);
      const column = table.columns.find(
        (candidate) => candidate.key === columnKey,
      );
      if (!row || !column) {
        return;
      }

      let value: EditorValue;
      try {
        value = editorValueForColumn(column, rawValue);
      } catch {
        setSaveState({ status: "error", cellLabel: column.label });
        setRetry(null);
        return;
      }
      const previousValue = row.values[columnKey] ?? null;
      if (Object.is(previousValue, value)) {
        return;
      }

      const operationKey = `${rowId}:${columnKey}`;
      const version = (operationVersions.current.get(operationKey) ?? 0) + 1;
      operationVersions.current.set(operationKey, version);
      pendingSaves.current.add(operationKey);
      setTable((current) => replaceCell(current, rowId, columnKey, value));
      setSaveState({ status: "saving" });
      setRetry(null);

      void adapter
        .updateCell(rowId, columnKey, value)
        .then((savedRow) => {
          if (operationVersions.current.get(operationKey) !== version) {
            return;
          }
          setTable((current) =>
            replaceCell(
              current,
              rowId,
              columnKey,
              savedRow.values[columnKey] ?? null,
            ),
          );
          pendingSaves.current.delete(operationKey);
          if (pendingSaves.current.size === 0) {
            setSaveState({ status: "saved" });
          }
        })
        .catch(() => {
          if (operationVersions.current.get(operationKey) !== version) {
            return;
          }
          pendingSaves.current.delete(operationKey);
          setTable((current) =>
            replaceCell(current, rowId, columnKey, previousValue),
          );
          setRetry({ rowId, columnKey, value });
          setSaveState({ status: "error", cellLabel: column.label });
        });
    },
    [adapter, table.columns, table.rows],
  );

  type DraftCreateFocus = "new-draft" | { columnIdx: number };

  const createDraftRecord = useCallback(
    (rawName: unknown, focus: DraftCreateFocus = "new-draft"): void => {
      if (!hasDraftName(rawName)) {
        return;
      }
      const name = rawName.trim();
      const createdRowIndex = table.rows.length;
      const primaryColumnIndex = table.columns.findIndex(
        (column) => column.key === table.primaryColumnKey,
      );
      setSaveState({ status: "saving" });
      setRetry(null);

      void adapter
        .createRow({ [table.primaryColumnKey]: name })
        .then((row) => {
          setTable((current) => ({
            ...current,
            rows: [...current.rows, row],
          }));
          setSaveState({ status: "saved" });

          const targetRowIndex =
            focus === "new-draft"
              ? freshDraftRowIndex(createdRowIndex)
              : createdRowIndex;
          const targetColumnIndex =
            focus === "new-draft"
              ? primaryColumnIndex
              : Math.max(
                  0,
                  Math.min(focus.columnIdx, table.columns.length - 1),
                );
          window.requestAnimationFrame(() => {
            gridRef.current?.selectCell(
              { idx: targetColumnIndex, rowIdx: targetRowIndex },
              { shouldFocusCell: true },
            );
          });
        })
        .catch(() => setSaveState({ status: "error", cellLabel: "Name" }));
    },
    [adapter, table.columns, table.primaryColumnKey, table.rows.length],
  );

  const handleRowsChange = useCallback(
    (nextRows: EditorRow[], data: RowsChangeData<EditorRow>): void => {
      const rowIndex = data.indexes[0];
      if (rowIndex === undefined) {
        return;
      }
      const nextRow = nextRows[rowIndex];
      const currentRow = table.rows[rowIndex];
      if (!nextRow) {
        return;
      }
      if (nextRow.isDraft) {
        if (data.column.key === table.primaryColumnKey) {
          createDraftRecord(nextRow.values[data.column.key]);
        }
        return;
      }
      if (!currentRow) {
        return;
      }
      commitCell(nextRow.id, data.column.key, nextRow.values[data.column.key]);
    },
    [commitCell, createDraftRecord, table.primaryColumnKey, table.rows],
  );

  const openRecord = useCallback(
    (rowId: string, columnKey: string): void => {
      void adapter.openRecord(rowId).then((row) => {
        if (!row) {
          return;
        }
        setPanelOrigin({ rowId, columnKey });
        setPanelRowId(rowId);
      });
    },
    [adapter],
  );

  const handleCreateColumn = useCallback(
    async (input: CreateColumnInput): Promise<void> => {
      await adapter.createColumn(input);
      setTable(adapter.getTable());
      setAddColumnOpen(false);
      setColumnMenuKey(null);
    },
    [adapter],
  );

  const handleRenameColumn = useCallback(
    async (columnKey: string, label: string): Promise<void> => {
      await adapter.renameColumn(columnKey, label);
      setTable(adapter.getTable());
      setColumnMenuKey(null);
    },
    [adapter],
  );

  const handleReorderColumns = useCallback(
    (sourceKey: string, targetKey: string): void => {
      const nextKeys = reorderColumnKeys(
        table.columns.map((column) => column.key),
        sourceKey,
        targetKey,
      );
      void adapter
        .reorderColumns(nextKeys)
        .then(() => setTable(adapter.getTable()));
    },
    [adapter, table.columns],
  );

  const handleResizeColumn = useCallback(
    (column: { key: string }, width: number): void => {
      const nextWidth = Math.round(width);
      setTable((current) => ({
        ...current,
        columns: current.columns.map((candidate) =>
          candidate.key === column.key
            ? { ...candidate, width: nextWidth }
            : candidate,
        ),
      }));
      void adapter.resizeColumn(column.key, nextWidth).catch(() => undefined);
    },
    [adapter],
  );

  const handleCellKeyDown = useCallback(
    (args: CellKeyDownArgs<EditorRow>, event: CellKeyboardEvent): void => {
      const column = table.columns.find(
        (candidate) => candidate.key === args.column.key,
      );
      if (!column) {
        return;
      }

      if (args.mode === "EDIT") {
        if (
          args.row.isDraft &&
          column.primary &&
          event.key === "Tab" &&
          !event.shiftKey &&
          hasDraftName(args.row.values[column.key])
        ) {
          event.preventGridDefault();
          args.onClose(false, true);
          const nextColumnIndex = args.column.idx + 1;
          if (nextColumnIndex < table.columns.length) {
            createDraftRecord(args.row.values[column.key], {
              columnIdx: nextColumnIndex,
            });
          } else {
            createDraftRecord(args.row.values[column.key]);
          }
        }
        return;
      }

      if (args.row.isDraft) {
        if (!column.primary) {
          return;
        }
        if (event.key === "Enter" || event.key === "F2") {
          event.preventGridDefault();
          setPendingEdit(null);
          args.selectCell(
            { idx: args.column.idx, rowIdx: args.rowIdx },
            { enableEditor: true, shouldFocusCell: true },
          );
        } else if (isPrintableKey(event)) {
          setPendingEdit({
            rowId: args.row.id,
            columnKey: column.key,
            value: event.key,
          });
        }
        return;
      }

      if (event.key === "Enter" || event.key === "F2") {
        event.preventGridDefault();
        setPendingEdit(null);
        args.selectCell(
          { idx: args.column.idx, rowIdx: args.rowIdx },
          { enableEditor: true, shouldFocusCell: true },
        );
      } else if (
        isPrintableKey(event) &&
        (column.kind === "text" ||
          column.kind === "phone" ||
          column.kind === "number")
      ) {
        setPendingEdit({
          rowId: args.row.id,
          columnKey: column.key,
          value: event.key,
        });
      }
    },
    [createDraftRecord, table.columns],
  );

  const handleDoubleClick = useCallback(
    (
      args: { selectCell: (enableEditor?: boolean) => void },
      event: React.MouseEvent,
    ): void => {
      event.preventDefault();
      event.stopPropagation();
      args.selectCell(true);
    },
    [],
  );

  const draftRow = useMemo<EditorRow>(
    () => ({
      id: editorDraftRowId,
      isDraft: true,
      values: { [table.primaryColumnKey]: "" },
    }),
    [table.primaryColumnKey],
  );

  const gridRows = useMemo(
    () => [...table.rows, draftRow],
    [draftRow, table.rows],
  );

  const activateDraft = useCallback((rowIdx: number, columnIdx: number) => {
    setPendingEdit(null);
    setDraftActivation({ rowIdx, columnIdx });
  }, []);

  const gridColumns = useMemo(
    () =>
      createEditorColumns({
        columnMenuKey,
        columns: table.columns,
        onActivateDraft: activateDraft,
        onOpenColumnMenu: (columnKey) => {
          setAddColumnOpen(false);
          setColumnMenuKey((current) =>
            current === columnKey ? null : columnKey,
          );
        },
        onOpenRecord: openRecord,
        onRenameColumn: handleRenameColumn,
        pendingEdit,
      }),
    [
      activateDraft,
      columnMenuKey,
      handleRenameColumn,
      openRecord,
      pendingEdit,
      table.columns,
    ],
  );

  const activeCellLabel = activeCell
    ? table.columns.find((column) => column.key === activeCell.columnKey)?.label
    : null;
  const activeRow = activeCell
    ? table.rows.find((row) => row.id === activeCell.rowId)
    : null;
  const activeValue =
    activeCell && activeRow
      ? editorInputValue(activeRow.values[activeCell.columnKey] ?? null)
      : null;

  return (
    <section className="editor-kernel-page">
      <header className="editor-lab-header">
        <div>
          {marker}
          <h1>{title ?? table.name}</h1>
        </div>
        <div
          className={`editor-save-state editor-save-${saveState.status}`}
          role="status"
        >
          <span className="editor-save-dot" aria-hidden="true" />
          {statusLabel(saveState)}
          {saveState.status === "error" && retry ? (
            <button
              className="editor-retry-button"
              onClick={() =>
                commitCell(retry.rowId, retry.columnKey, retry.value)
              }
              type="button"
            >
              Retry
            </button>
          ) : null}
        </div>
      </header>

      <div className="editor-lab-meta">
        <span>{table.rows.length} records</span>
        <span aria-hidden="true">·</span>
        <span>
          {activeCellLabel && activeValue
            ? `${activeCellLabel} · ${activeValue}`
            : "Select a cell to begin"}
        </span>
        <span className="editor-lab-shortcut-hint">
          Enter / double-click to edit · ⌘C / ⌘V supported
        </span>
      </div>

      <div className="editor-lab-workspace">
        <div className="editor-grid-area">
          <div className="editor-grid-shell">
            <DataGrid
              aria-label="Customers editor"
              className="editor-grid"
              columns={gridColumns}
              data-testid="editor-grid"
              headerRowHeight={36}
              onCellDoubleClick={handleDoubleClick}
              onCellKeyDown={handleCellKeyDown}
              onColumnResize={handleResizeColumn}
              onColumnsReorder={handleReorderColumns}
              onRowsChange={handleRowsChange}
              onSelectedCellChange={({ row, column }) => {
                setPendingEdit(null);
                if (row) {
                  setActiveCell({ rowId: row.id, columnKey: column.key });
                }
              }}
              ref={gridRef}
              rowClass={(row) => (row.isDraft ? "editor-draft-row" : undefined)}
              rowHeight={38}
              rowKeyGetter={(row) => row.id}
              rows={gridRows}
            />
            <button
              aria-expanded={addColumnOpen}
              aria-label="Add column"
              className="editor-add-column-button"
              onClick={() => {
                setColumnMenuKey(null);
                setAddColumnOpen((current) => !current);
              }}
              type="button"
            >
              +
            </button>
            {addColumnOpen ? (
              <AddColumnPopover
                onClose={() => setAddColumnOpen(false)}
                onCreate={handleCreateColumn}
              />
            ) : null}
          </div>
          {footer ? <div className="editor-grid-footnote">{footer}</div> : null}
        </div>
        {panelRow ? (
          <RecordPanel
            key={`${panelRow.id}:${JSON.stringify(panelRow.values)}`}
            columns={table.columns}
            onClose={closePanel}
            onCommitCell={commitCell}
            row={panelRow}
            tableName={table.name}
          />
        ) : null}
      </div>
    </section>
  );
}
