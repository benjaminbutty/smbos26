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
  type CellMouseArgs,
  type CellMouseEvent,
  type DataGridHandle,
  type RowsChangeData,
} from "react-data-grid";

import {
  defaultEditorCapabilities,
  editorDraftRowId,
  editorInputValue,
  editorValueForColumn,
  freshDraftRowIndex,
  hasDraftName,
  reorderColumnKeys,
  type CreateColumnInput,
  type CreateConnectionPropertyInput,
  type ConnectionTableOption,
  type EditorCapabilities,
  type EditorColumn,
  type EditorColumnKind,
  type EditorRow,
  type EditorTable,
  type EditorValue,
} from "./contracts";
import {
  buildClipboardMatrix,
  MAX_PASTE_CELLS,
  MAX_PASTE_ROWS,
  selectionBounds,
  serializeClipboardMatrix,
} from "./clipboard";
import {
  createEditorColumns,
  openConnectionCellEditor,
  type PendingEdit,
} from "./table-columns";
import { RecordPanel } from "./record-panel";
import type { TableEditorAdapter } from "./contracts";
import { OptionManager, ShortcutSheet, TypePicker } from "./lenni-ui";

export interface EditorRecordContext {
  columns: readonly EditorColumn[];
  fullRecordPath?: string;
  isSource?: boolean;
  recordTypeLabel?: string;
  row: EditorRow;
  tableName: string;
  viewKey: string;
}

export interface EditorKernelProps {
  adapter: TableEditorAdapter;
  businessSlug?: string;
  capabilities?: EditorCapabilities;
  footer?: ReactNode;
  headerContent?: ReactNode;
  marker?: ReactNode;
  newRecordLabel?: string;
  onStructureChanged?: () => void;
  connectionSource?: Pick<
    ConnectionTableOption,
    "singularLabel" | "pluralLabel"
  >;
  connectionTargets?: readonly ConnectionTableOption[];
  onCreateConnection?: (
    input: CreateConnectionPropertyInput,
  ) => Promise<boolean>;
  recordCountLabel?: string;
  recordTypeLabel?: string;
  fullRecordPath?: string;
  loadConnectedRecord?:
    | ((
        targetViewKey: string,
        recordId: string,
      ) => Promise<EditorRecordContext | null>)
    | undefined;
  updateConnectedRecord?:
    | ((
        context: EditorRecordContext,
        column: EditorColumn,
        value: EditorValue,
      ) => Promise<EditorRow>)
    | undefined;
  searchConnectedRecordTargets?:
    | ((
        context: EditorRecordContext,
        columnKey: string,
        search: string,
      ) => Promise<readonly { id: string; label: string }[]>)
    | undefined;
  createConnectedRecordTarget?:
    | ((
        context: EditorRecordContext,
        columnKey: string,
        primaryValue: string,
      ) => Promise<{ id: string; label: string }>)
    | undefined;
  title?: string;
  readOnly?: boolean;
  variant?: "workspace" | "embedded";
}

interface ActiveCell {
  rowId: string;
  columnKey: string;
}

interface GridPoint {
  rowIndex: number;
  columnIndex: number;
}

interface SaveRetry {
  rowId: string;
  columnKey: string;
  value: EditorValue;
}

type SaveState =
  | { status: "saved" }
  | { status: "saving" }
  | { status: "error"; cellLabel?: string; message?: string };

const addableColumnKinds: ReadonlyArray<{
  kind: EditorColumnKind;
  label: string;
}> = [
  { kind: "text", label: "Text" },
  { kind: "long_text", label: "Long text" },
  { kind: "number", label: "Number" },
  { kind: "boolean", label: "Yes / No" },
  { kind: "date", label: "Date" },
  { kind: "email", label: "Email" },
  { kind: "phone", label: "Phone" },
  { kind: "url", label: "Website" },
  { kind: "select", label: "Choice" },
  { kind: "status", label: "Status" },
];

function saveErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Could not save";
}

function optionsAreValid(options: readonly string[]): boolean {
  const normalized = options.map((option) =>
    option.normalize("NFKC").toLocaleLowerCase("en"),
  );
  return options.length >= 2 && new Set(normalized).size === normalized.length;
}

function TableTitleEditor({
  displayTitle,
  enabled,
  name,
  onCommit,
}: Readonly<{
  displayTitle: string;
  enabled: boolean;
  name: string;
  onCommit: (title: string) => Promise<boolean>;
}>): ReactNode {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const committingRef = useRef(false);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  if (!enabled) {
    return <h1>{displayTitle}</h1>;
  }

  const cancel = (): void => {
    setValue(name);
    setEditing(false);
  };

  const commit = async (): Promise<void> => {
    if (committingRef.current) {
      return;
    }
    const next = value.trim();
    if (!next || next === name) {
      cancel();
      return;
    }
    committingRef.current = true;
    try {
      if (await onCommit(next)) {
        setEditing(false);
      }
    } finally {
      committingRef.current = false;
    }
  };

  return editing ? (
    <input
      ref={inputRef}
      aria-label="Table title"
      className="editor-title-input"
      maxLength={120}
      minLength={1}
      onBlur={() => void commit()}
      onChange={(event) => setValue(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
      required
      value={value}
    />
  ) : (
    <button
      aria-label={`Rename Table ${name}`}
      className="editor-title-button"
      onClick={() => {
        setValue(name);
        setEditing(true);
      }}
      type="button"
    >
      <span>{name}</span>
    </button>
  );
}

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

function readOnlyTable(table: EditorTable): EditorTable {
  const lockColumn = (column: EditorTable["columns"][number]) => ({
    ...column,
    editable: false,
    readOnlyReason: "This Table is read-only on this Page.",
  });
  const recordColumns = table.recordColumns?.map(lockColumn);
  return {
    ...table,
    columns: table.columns.map(lockColumn),
    ...(recordColumns ? { recordColumns } : {}),
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

export function ConnectionPropertyPopover({
  onBack,
  onClose,
  onCreate,
  source,
  targets,
}: Readonly<{
  onBack: () => void;
  onClose: () => void;
  onCreate: (input: CreateConnectionPropertyInput) => Promise<boolean>;
  source: Pick<ConnectionTableOption, "singularLabel" | "pluralLabel">;
  targets: readonly ConnectionTableOption[];
}>): ReactNode {
  const [targetViewKey, setTargetViewKey] = useState(targets[0]?.viewKey ?? "");
  const [currentMultiplicity, setCurrentMultiplicity] = useState<
    "one" | "several"
  >("one");
  const [targetMultiplicity, setTargetMultiplicity] = useState<
    "one" | "several"
  >("several");
  const [label, setLabel] = useState(targets[0]?.singularLabel ?? "");
  const [reverseLabel, setReverseLabel] = useState(source.pluralLabel);
  const [addReverse, setAddReverse] = useState(true);
  const [labelTouched, setLabelTouched] = useState(false);
  const [reverseLabelTouched, setReverseLabelTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const target = targets.find(
    (candidate) => candidate.viewKey === targetViewKey,
  );

  return (
    <form
      className="editor-add-column-popover editor-connection-create-popover"
      onSubmit={(event) => {
        event.preventDefault();
        if (!target || !label.trim() || submitting) {
          return;
        }
        if (addReverse && !reverseLabel.trim()) {
          setError("Add a name for the property shown on the other Table.");
          return;
        }
        setError(null);
        setSubmitting(true);
        const input: CreateConnectionPropertyInput = {
          targetViewKey,
          label: label.trim(),
          currentMultiplicity,
          targetMultiplicity,
          addReverse,
          ...(addReverse ? { reverseLabel: reverseLabel.trim() } : {}),
        };
        void onCreate(input)
          .then((created) => {
            if (created) {
              onClose();
            }
          })
          .catch((submissionError: unknown) => {
            setError(saveErrorMessage(submissionError));
          })
          .finally(() => setSubmitting(false));
      }}
    >
      <div className="editor-popover-heading">
        <strong>Connect to another Table</strong>
        <button
          aria-label="Close connection setup"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
      </div>
      <label>
        Table to connect
        <select
          aria-label="Table to connect"
          onChange={(event) => {
            const nextTargetViewKey = event.currentTarget.value;
            const nextTarget = targets.find(
              (candidate) => candidate.viewKey === nextTargetViewKey,
            );
            setTargetViewKey(nextTargetViewKey);
            setLabelTouched(false);
            setReverseLabelTouched(false);
            if (nextTarget) {
              setLabel(
                currentMultiplicity === "one"
                  ? nextTarget.singularLabel
                  : nextTarget.pluralLabel,
              );
              setReverseLabel(
                targetMultiplicity === "several"
                  ? source.pluralLabel
                  : source.singularLabel,
              );
            }
          }}
          value={targetViewKey}
        >
          {targets.map((candidate) => (
            <option key={candidate.viewKey} value={candidate.viewKey}>
              {candidate.label}
            </option>
          ))}
        </select>
      </label>
      {target ? (
        <>
          <label>
            On {source.singularLabel}, call this property
            <input
              aria-label={`On ${source.singularLabel}, call this property`}
              maxLength={120}
              onChange={(event) => {
                setLabelTouched(true);
                setLabel(event.currentTarget.value);
              }}
              required
              value={label}
            />
          </label>
          <div className="editor-connection-multiplicity">
            <span>Each {source.singularLabel} can have:</span>
            <label>
              <span className="editor-sr-only">How many connected Records</span>
              <select
                aria-label={`Each ${source.singularLabel} can have`}
                onChange={(event) => {
                  const nextMultiplicity = event.currentTarget.value as
                    "one" | "several";
                  setCurrentMultiplicity(nextMultiplicity);
                  if (!labelTouched && target) {
                    setLabel(
                      nextMultiplicity === "one"
                        ? target.singularLabel
                        : target.pluralLabel,
                    );
                  }
                }}
                value={currentMultiplicity}
              >
                <option value="one">One</option>
                <option value="several">Several</option>
              </select>
            </label>
            <span>
              {currentMultiplicity === "one"
                ? target.singularLabel
                : target.pluralLabel}
            </span>
          </div>
          <div className="editor-connection-multiplicity">
            <span>Each {target.singularLabel} can have:</span>
            <label>
              <span className="editor-sr-only">
                How many Records can connect back
              </span>
              <select
                aria-label={`Each ${target.singularLabel} can have`}
                onChange={(event) => {
                  const nextMultiplicity = event.currentTarget.value as
                    "one" | "several";
                  setTargetMultiplicity(nextMultiplicity);
                  if (!reverseLabelTouched) {
                    setReverseLabel(
                      nextMultiplicity === "several"
                        ? source.pluralLabel
                        : source.singularLabel,
                    );
                  }
                }}
                value={targetMultiplicity}
              >
                <option value="one">One</option>
                <option value="several">Several</option>
              </select>
            </label>
            <span>
              {targetMultiplicity === "one"
                ? source.singularLabel
                : source.pluralLabel}
            </span>
          </div>
          <label className="editor-connection-reverse-toggle">
            <span>
              <input
                checked={addReverse}
                onChange={(event) => setAddReverse(event.currentTarget.checked)}
                type="checkbox"
              />{" "}
              Also show this on {target.label}
            </span>
          </label>
          {addReverse ? (
            <label>
              On {target.singularLabel}, call this property
              <input
                aria-label={`On ${target.singularLabel}, call this property`}
                maxLength={120}
                onChange={(event) => {
                  setReverseLabelTouched(true);
                  setReverseLabel(event.currentTarget.value);
                }}
                required
                value={reverseLabel}
              />
            </label>
          ) : null}
          <p className="editor-connection-summary">
            Each {source.singularLabel} can have {currentMultiplicity}{" "}
            {currentMultiplicity === "one"
              ? target.singularLabel
              : target.pluralLabel}
            . Each {target.singularLabel} can have {targetMultiplicity}{" "}
            {targetMultiplicity === "one"
              ? source.singularLabel
              : source.pluralLabel}
            .
          </p>
        </>
      ) : (
        <span className="editor-structural-error" role="status">
          Create another Table before adding a Connection.
        </span>
      )}
      {error ? (
        <span className="editor-structural-error" role="alert">
          {error}
        </span>
      ) : null}
      <div className="editor-connection-flow-actions">
        <button className="editor-menu-back" onClick={onBack} type="button">
          Back
        </button>
        <button
          className="editor-menu-submit"
          disabled={submitting || !target}
          type="submit"
        >
          {submitting ? "Creating…" : "Create connection"}
        </button>
      </div>
    </form>
  );
}

export function AddColumnPopover({
  canAddConnections,
  connectionSource,
  connectionTargets,
  onClose,
  onCreate,
  onCreateConnection,
}: Readonly<{
  canAddConnections: boolean;
  connectionSource?: Pick<
    ConnectionTableOption,
    "singularLabel" | "pluralLabel"
  >;
  connectionTargets?: readonly ConnectionTableOption[];
  onClose: () => void;
  onCreate: (input: CreateColumnInput) => Promise<void>;
  onCreateConnection?: (
    input: CreateConnectionPropertyInput,
  ) => Promise<boolean>;
}>): ReactNode {
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<EditorColumnKind>("text");
  const [options, setOptions] = useState<string[]>(["Active", "Inactive"]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (connectionOpen && connectionSource && onCreateConnection) {
    return (
      <ConnectionPropertyPopover
        onBack={() => setConnectionOpen(false)}
        onClose={onClose}
        onCreate={onCreateConnection}
        source={connectionSource}
        targets={connectionTargets ?? []}
      />
    );
  }

  return (
    <form
      className="editor-add-column-popover"
      onSubmit={(event) => {
        event.preventDefault();
        if (!label.trim() || submitting) {
          return;
        }
        const input: CreateColumnInput = { label, kind };
        if (kind === "select" || kind === "status") {
          input.options = options;
          if (!optionsAreValid(input.options)) {
            setError("Choice and Status need two different options.");
            return;
          }
        }
        setError(null);
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
      <label>Type</label>
      <TypePicker
        allowedKinds={addableColumnKinds.map((option) => option.kind)}
        onChange={setKind}
        value={kind}
      />
      {kind === "select" || kind === "status" ? (
        <label>
          Options
          <OptionManager
            onChange={(next) => setOptions([...next])}
            options={options}
          />
        </label>
      ) : null}
      {error ? (
        <span className="editor-structural-error" role="alert">
          {error}
        </span>
      ) : null}
      <button
        className="editor-menu-submit"
        disabled={submitting}
        type="submit"
      >
        {submitting ? "Adding…" : "Add column"}
      </button>
      {canAddConnections && onCreateConnection && connectionSource ? (
        (connectionTargets?.length ?? 0) > 0 ? (
          <>
            <div className="editor-add-property-divider" />
            <button
              className="editor-add-connection-link"
              onClick={() => {
                setError(null);
                setConnectionOpen(true);
              }}
              type="button"
            >
              Connect to another Table
            </button>
          </>
        ) : (
          <span className="editor-property-type-note" role="status">
            Create another Table before adding a Connection.
          </span>
        )
      ) : null}
    </form>
  );
}

export function EditorKernel({
  adapter,
  businessSlug,
  capabilities = defaultEditorCapabilities,
  footer,
  headerContent,
  marker,
  newRecordLabel = "New record",
  onStructureChanged,
  connectionSource,
  connectionTargets,
  onCreateConnection,
  recordCountLabel,
  recordTypeLabel,
  fullRecordPath,
  loadConnectedRecord,
  updateConnectedRecord,
  searchConnectedRecordTargets,
  createConnectedRecordTarget,
  readOnly = false,
  title,
  variant = "workspace",
}: Readonly<EditorKernelProps>): ReactNode {
  const [table, setTable] = useState<EditorTable>(() => {
    const initial = adapter.getTable();
    return readOnly ? readOnlyTable(initial) : initial;
  });
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null);
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const [columnMenuKey, setColumnMenuKey] = useState<string | null>(null);
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const [selectionAnchor, setSelectionAnchor] = useState<GridPoint | null>(
    null,
  );
  const [selectionEnd, setSelectionEnd] = useState<GridPoint | null>(null);
  const [panelRowId, setPanelRowId] = useState<string | null>(null);
  const [panelOrigin, setPanelOrigin] = useState<ActiveCell | null>(null);
  const [connectedPanel, setConnectedPanel] =
    useState<EditorRecordContext | null>(null);
  const [panelHistory, setPanelHistory] = useState<EditorRecordContext[]>([]);
  const [draftActivation, setDraftActivation] = useState<{
    rowIdx: number;
    columnIdx: number;
  } | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: "saved" });
  const [retry, setRetry] = useState<SaveRetry | null>(null);
  const gridRef = useRef<DataGridHandle>(null);
  const operationVersions = useRef(new Map<string, number>());
  const pendingSaves = useRef(new Set<string>());
  const rangeSelectionRef = useRef(false);

  const panelRow = panelRowId
    ? (table.rows.find((row) => row.id === panelRowId) ?? null)
    : null;
  const recordColumns = table.recordColumns ?? table.columns;
  const sourcePanel = panelRow
    ? {
        columns: recordColumns,
        ...(fullRecordPath !== undefined ? { fullRecordPath } : {}),
        isSource: true,
        ...(recordTypeLabel !== undefined ? { recordTypeLabel } : {}),
        row: panelRow,
        tableName: table.name,
        viewKey: table.key,
      }
    : null;
  const activePanel = connectedPanel ?? sourcePanel;
  const columnForKey = useCallback(
    (columnKey: string) =>
      recordColumns.find((column) => column.key === columnKey) ?? null,
    [recordColumns],
  );

  const closePanel = useCallback(() => {
    const origin = panelOrigin;
    setPanelRowId(null);
    setPanelOrigin(null);
    setConnectedPanel(null);
    setPanelHistory([]);
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
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing = Boolean(
        target?.closest("input, textarea, select, [contenteditable='true']"),
      );
      if (!typing && event.key === "?" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setShortcutOpen(true);
      }
      if (
        capabilities.canAddColumns &&
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLocaleLowerCase("en") === "p"
      ) {
        event.preventDefault();
        setColumnMenuKey(null);
        setAddColumnOpen(true);
      }
      if (
        !typing &&
        ((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu")
      ) {
        event.preventDefault();
        const column = table.columns[selectionAnchor?.columnIndex ?? 0];
        if (column) {
          setAddColumnOpen(false);
          setColumnMenuKey(column.key);
        }
      }
      if (!typing && event.key === "Escape") {
        const point = selectionAnchor ?? { rowIndex: 0, columnIndex: 0 };
        setSelectionAnchor(point);
        setSelectionEnd(point);
        setColumnMenuKey(null);
        setAddColumnOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [capabilities.canAddColumns, selectionAnchor, table.columns]);

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
      const column = columnForKey(columnKey);
      if (!row || !column || column.editable === false) {
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
          setTable((current) => ({
            ...current,
            rows: current.rows.map((candidate) =>
              candidate.id === rowId
                ? {
                    ...candidate,
                    values: { ...candidate.values, ...savedRow.values },
                    ...(savedRow.connectionValues
                      ? { connectionValues: savedRow.connectionValues }
                      : {}),
                  }
                : candidate,
            ),
          }));
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
    [adapter, columnForKey, table.rows],
  );

  const runStructural = useCallback(
    async (operation: () => Promise<unknown>): Promise<boolean> => {
      setSaveState({ status: "saving" });
      setRetry(null);
      try {
        await operation();
        setTable(adapter.getTable());
        setSaveState({ status: "saved" });
        onStructureChanged?.();
        return true;
      } catch (error) {
        setSaveState({
          status: "error",
          message: saveErrorMessage(error),
        });
        return false;
      }
    },
    [adapter, onStructureChanged],
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
      const primaryColumn = table.columns[primaryColumnIndex];
      if (!primaryColumn || primaryColumn.editable === false) {
        setSaveState({
          status: "error",
          cellLabel: primaryColumn?.label ?? "primary value",
        });
        return;
      }
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
      void adapter
        .openRecord(rowId)
        .then((row) => {
          if (!row) {
            return;
          }
          setTable((current) => ({
            ...current,
            rows: current.rows.map((candidate) =>
              candidate.id === row.id ? row : candidate,
            ),
          }));
          setPanelOrigin({ rowId, columnKey });
          setPanelRowId(rowId);
          setConnectedPanel(null);
          setPanelHistory([]);
        })
        .catch(() => {
          setSaveState({ status: "error", cellLabel: "Record" });
        });
    },
    [adapter],
  );

  const followConnectedRecord = useCallback(
    (targetViewKey: string, recordId: string): void => {
      if (!loadConnectedRecord || !activePanel) {
        return;
      }
      void loadConnectedRecord(targetViewKey, recordId)
        .then((next) => {
          if (!next) {
            setSaveState({ status: "error", cellLabel: "Record" });
            return;
          }
          setPanelHistory((current) => [...current, activePanel]);
          setConnectedPanel({ ...next, isSource: false });
        })
        .catch(() => {
          setSaveState({ status: "error", cellLabel: "Record" });
        });
    },
    [activePanel, loadConnectedRecord],
  );

  const backConnectedRecord = useCallback((): void => {
    const previous = panelHistory[panelHistory.length - 1];
    if (!previous) {
      return;
    }
    setPanelHistory((current) => current.slice(0, -1));
    if (previous.isSource) {
      setConnectedPanel(null);
    } else {
      setConnectedPanel(previous);
    }
  }, [panelHistory]);

  const commitConnectedCell = useCallback(
    (rowId: string, columnKey: string, rawValue: unknown): void => {
      if (!connectedPanel || !updateConnectedRecord) {
        return;
      }
      const column = connectedPanel.columns.find(
        (candidate) => candidate.key === columnKey,
      );
      if (!column || column.editable === false) {
        return;
      }
      let value: EditorValue;
      try {
        value = editorValueForColumn(column, rawValue);
      } catch {
        setSaveState({ status: "error", cellLabel: column.label });
        return;
      }
      const previousRow = connectedPanel.row;
      setConnectedPanel((current) =>
        current
          ? {
              ...current,
              row: {
                ...current.row,
                values: { ...current.row.values, [columnKey]: value },
              },
            }
          : current,
      );
      void updateConnectedRecord(connectedPanel, column, value)
        .then((savedRow) => {
          setConnectedPanel((current) =>
            current
              ? {
                  ...current,
                  row: {
                    ...current.row,
                    values: { ...current.row.values, ...savedRow.values },
                    ...(savedRow.connectionValues
                      ? { connectionValues: savedRow.connectionValues }
                      : {}),
                  },
                }
              : current,
          );
          setSaveState({ status: "saved" });
        })
        .catch(() => {
          setConnectedPanel((current) =>
            current ? { ...current, row: previousRow } : current,
          );
          setSaveState({ status: "error", cellLabel: column.label });
        });
    },
    [connectedPanel, updateConnectedRecord],
  );

  const searchPanelConnectionTargets = useCallback(
    (columnKey: string, search: string) => {
      if (!connectedPanel || !searchConnectedRecordTargets) {
        return Promise.resolve([] as readonly { id: string; label: string }[]);
      }
      return searchConnectedRecordTargets(connectedPanel, columnKey, search);
    },
    [connectedPanel, searchConnectedRecordTargets],
  );

  const createPanelConnectionTarget = useCallback(
    (columnKey: string, primaryValue: string) => {
      if (!connectedPanel || !createConnectedRecordTarget) {
        return Promise.reject(
          new Error("Creating a connected Record is not available."),
        );
      }
      return createConnectedRecordTarget(
        connectedPanel,
        columnKey,
        primaryValue,
      );
    },
    [connectedPanel, createConnectedRecordTarget],
  );

  const handleCreateColumn = useCallback(
    async (input: CreateColumnInput): Promise<void> => {
      if (!capabilities.canAddColumns) {
        return;
      }
      if (await runStructural(() => adapter.createColumn(input))) {
        setAddColumnOpen(false);
        setColumnMenuKey(null);
      }
    },
    [adapter, capabilities.canAddColumns, runStructural],
  );

  const handleCreateConnection = useCallback(
    async (input: CreateConnectionPropertyInput): Promise<boolean> => {
      if (capabilities.canAddConnections === false || !onCreateConnection) {
        return false;
      }
      return runStructural(() => onCreateConnection(input));
    },
    [capabilities.canAddConnections, onCreateConnection, runStructural],
  );

  const handleRenameColumn = useCallback(
    async (columnKey: string, label: string): Promise<boolean> => {
      if (!capabilities.canRenameColumns) {
        return false;
      }
      const saved = await runStructural(() =>
        adapter.renameColumn(columnKey, label),
      );
      if (saved) {
        setColumnMenuKey(null);
      }
      return saved;
    },
    [adapter, capabilities.canRenameColumns, runStructural],
  );

  const handleUpdateColumnOptions = useCallback(
    async (columnKey: string, options: readonly string[]): Promise<boolean> => {
      if (!capabilities.canUpdateColumnOptions) {
        return false;
      }
      const saved = await runStructural(() =>
        adapter.updateColumnOptions(columnKey, options),
      );
      if (saved) {
        setColumnMenuKey(null);
      }
      return saved;
    },
    [adapter, capabilities.canUpdateColumnOptions, runStructural],
  );

  const handleChangeColumnType = useCallback(
    async (
      columnKey: string,
      kind: EditorColumnKind,
      options?: readonly string[],
    ): Promise<boolean> => {
      if (!capabilities.canChangeColumnTypes || !adapter.changeColumnType) {
        return false;
      }
      const saved = await runStructural(() =>
        adapter.changeColumnType!(columnKey, kind, options),
      );
      if (saved) setColumnMenuKey(null);
      return saved;
    },
    [adapter, capabilities.canChangeColumnTypes, runStructural],
  );

  const handleInsertColumn = useCallback(
    async (
      anchorColumnKey: string,
      position: "left" | "right",
      input: {
        label: string;
        kind: EditorColumnKind;
        options?: readonly string[];
      },
    ): Promise<boolean> => {
      if (!capabilities.canInsertColumns || !adapter.insertColumn) {
        return false;
      }
      const saved = await runStructural(() =>
        adapter.insertColumn!({ ...input, anchorColumnKey, position }),
      );
      if (saved) setColumnMenuKey(null);
      return saved;
    },
    [adapter, capabilities.canInsertColumns, runStructural],
  );

  const handleReorderColumns = useCallback(
    (sourceKey: string, targetKey: string): void => {
      if (!capabilities.canReorderColumns) {
        return;
      }
      if (sourceKey === targetKey) {
        return;
      }
      const nextKeys = reorderColumnKeys(
        table.columns.map((column) => column.key),
        sourceKey,
        targetKey,
      );
      void runStructural(() => adapter.reorderColumns(nextKeys));
    },
    [adapter, capabilities.canReorderColumns, runStructural, table.columns],
  );

  const handleMoveColumn = useCallback(
    (sourceKey: string, direction: "left" | "right"): void => {
      if (!capabilities.canReorderColumns) return;
      const keys = table.columns.map((column) => column.key);
      const sourceIndex = keys.indexOf(sourceKey);
      const targetIndex = sourceIndex + (direction === "left" ? -1 : 1);
      if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= keys.length)
        return;
      const next = [...keys];
      [next[sourceIndex]!, next[targetIndex]!] = [
        next[targetIndex]!,
        next[sourceIndex]!,
      ];
      void runStructural(() => adapter.reorderColumns(next));
      setColumnMenuKey(null);
    },
    [adapter, capabilities.canReorderColumns, runStructural, table.columns],
  );

  const handleResizeColumn = useCallback(
    (column: { key: string }, width: number): void => {
      if (!capabilities.canResizeColumns) {
        return;
      }
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
    [adapter, capabilities.canResizeColumns],
  );

  const handleRenameTable = useCallback(
    (nextTitle: string): Promise<boolean> => {
      if (!capabilities.canRenameTable) {
        return Promise.resolve(false);
      }
      return runStructural(() => adapter.renameTable(nextTitle));
    },
    [adapter, capabilities.canRenameTable, runStructural],
  );

  const applyPasteMatrix = useCallback(
    async (
      startRowIndex: number,
      startColumnIndex: number,
      matrix: readonly (EditorValue | null)[][],
    ): Promise<void> => {
      if (readOnly || !adapter.applyPaste) {
        setSaveState({ status: "error", message: "This Table is read-only." });
        return;
      }
      const cellCount = matrix.reduce((count, row) => count + row.length, 0);
      if (matrix.length > MAX_PASTE_ROWS || cellCount > MAX_PASTE_CELLS) {
        setSaveState({
          status: "error",
          message: `Paste is limited to ${MAX_PASTE_CELLS} cells and ${MAX_PASTE_ROWS} records.`,
        });
        return;
      }
      setSaveState({ status: "saving" });
      try {
        const result = await adapter.applyPaste({
          startRowIndex,
          startColumnIndex,
          matrix,
        });
        setTable((current) => {
          const byId = new Map(current.rows.map((row) => [row.id, row]));
          for (const row of result.rows) byId.set(row.id, row);
          return { ...current, rows: [...byId.values()] };
        });
        if (result.failures.length > 0) {
          setSaveState({
            status: "error",
            message: `${result.failures.length} row${result.failures.length === 1 ? "" : "s"} could not be saved.`,
          });
        } else {
          setSaveState({ status: "saved" });
        }
      } catch (error) {
        setSaveState({ status: "error", message: saveErrorMessage(error) });
      }
    },
    [adapter, readOnly],
  );

  const activeGridPoint = useCallback((): GridPoint => {
    const rowIndex = activeCell
      ? table.rows.findIndex((row) => row.id === activeCell.rowId)
      : 0;
    const columnIndex = activeCell
      ? table.columns.findIndex((column) => column.key === activeCell.columnKey)
      : 0;
    return {
      rowIndex: Math.max(0, rowIndex),
      columnIndex: Math.max(0, columnIndex),
    };
  }, [activeCell, table.columns, table.rows]);

  const handleClipboardPaste = useCallback(
    (text: string): void => {
      const point = selectionAnchor ?? activeGridPoint();
      const end = selectionEnd ?? point;
      const bounds = selectionBounds(point, end);
      try {
        const columns = table.columns.slice(bounds.startColumn);
        const parsed = buildClipboardMatrix(text, columns);
        void applyPasteMatrix(
          bounds.startRow,
          bounds.startColumn,
          parsed.matrix,
        );
      } catch (error) {
        setSaveState({ status: "error", message: saveErrorMessage(error) });
      }
    },
    [
      activeGridPoint,
      applyPasteMatrix,
      selectionAnchor,
      selectionEnd,
      table.columns,
    ],
  );

  const handleCopyCapture = useCallback(
    (event: React.ClipboardEvent): void => {
      const point = selectionAnchor ?? activeGridPoint();
      const end = selectionEnd ?? point;
      const bounds = selectionBounds(point, end);
      const matrix = table.rows
        .slice(bounds.startRow, bounds.endRow + 1)
        .map((row) =>
          table.columns
            .slice(bounds.startColumn, bounds.endColumn + 1)
            .map((column) => row.values[column.key] ?? null),
        );
      if (matrix.length === 0) return;
      event.preventDefault();
      event.clipboardData.setData(
        "text/plain",
        serializeClipboardMatrix(matrix),
      );
    },
    [activeGridPoint, selectionAnchor, selectionEnd, table.columns, table.rows],
  );

  const handlePasteCapture = useCallback(
    (event: React.ClipboardEvent): void => {
      const text = event.clipboardData.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      handleClipboardPaste(text);
    },
    [handleClipboardPaste],
  );

  const handleCellKeyDown = useCallback(
    (args: CellKeyDownArgs<EditorRow>, event: CellKeyboardEvent): void => {
      const column = table.columns.find(
        (candidate) => candidate.key === args.column.key,
      );
      if (!column) {
        return;
      }

      if (args.mode === "SELECT") {
        const arrowDelta: Record<string, { row: number; column: number }> = {
          ArrowUp: { row: -1, column: 0 },
          ArrowDown: { row: 1, column: 0 },
          ArrowLeft: { row: 0, column: -1 },
          ArrowRight: { row: 0, column: 1 },
        };
        const delta = arrowDelta[event.key];
        if (event.shiftKey && delta) {
          event.preventGridDefault();
          const anchor = selectionAnchor ?? {
            rowIndex: args.rowIdx,
            columnIndex: args.column.idx,
          };
          const rowCount =
            table.rows.length + (capabilities.rowCreation === "direct" ? 1 : 0);
          const next = {
            rowIndex: Math.max(
              0,
              Math.min(rowCount - 1, args.rowIdx + delta.row),
            ),
            columnIndex: Math.max(
              0,
              Math.min(
                table.columns.length - 1,
                args.column.idx + delta.column,
              ),
            ),
          };
          rangeSelectionRef.current = true;
          setSelectionAnchor(anchor);
          setSelectionEnd(next);
          args.selectCell(
            { idx: next.columnIndex, rowIdx: next.rowIndex },
            { shouldFocusCell: true },
          );
          return;
        }
        if (
          (event.key === "Backspace" || event.key === "Delete") &&
          !readOnly
        ) {
          event.preventGridDefault();
          const point = selectionAnchor ?? {
            rowIndex: args.rowIdx,
            columnIndex: args.column.idx,
          };
          const end = selectionEnd ?? point;
          const bounds = selectionBounds(point, end);
          const matrix = Array.from(
            { length: bounds.endRow - bounds.startRow + 1 },
            () =>
              Array.from(
                { length: bounds.endColumn - bounds.startColumn + 1 },
                () => null,
              ),
          );
          void applyPasteMatrix(bounds.startRow, bounds.startColumn, matrix);
          return;
        }
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

      if (!args.row.isDraft && column.editable === false) {
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
        column.editable !== false &&
        (column.kind === "text" ||
          column.kind === "long_text" ||
          column.kind === "email" ||
          column.kind === "url" ||
          column.kind === "phone" ||
          column.kind === "number" ||
          column.kind === "currency")
      ) {
        setPendingEdit({
          rowId: args.row.id,
          columnKey: column.key,
          value: event.key,
        });
      }
    },
    [
      applyPasteMatrix,
      capabilities.rowCreation,
      createDraftRecord,
      readOnly,
      selectionAnchor,
      selectionEnd,
      table.columns,
      table.rows.length,
    ],
  );

  const handleDoubleClick = useCallback(
    (args: CellMouseArgs<EditorRow>, event: React.MouseEvent): void => {
      const column = table.columns.find(
        (candidate) => candidate.key === args.column.key,
      );
      if (
        !column ||
        column.editable === false ||
        (args.row.isDraft && !column.primary)
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      args.selectCell(true);
    },
    [table.columns],
  );

  const handleCellClick = useCallback(
    (args: CellMouseArgs<EditorRow>, event: CellMouseEvent): void => {
      if (event.shiftKey) {
        return;
      }
      const column = table.columns.find(
        (candidate) => candidate.key === args.column.key,
      );
      openConnectionCellEditor(column, args.row, args.selectCell);
    },
    [table.columns],
  );

  const handleCellMouseDown = useCallback(
    (args: CellMouseArgs<EditorRow>, event: React.MouseEvent): void => {
      const point = { rowIndex: args.rowIdx, columnIndex: args.column.idx };
      if (event.shiftKey && selectionAnchor) {
        event.preventDefault();
        rangeSelectionRef.current = true;
        setSelectionEnd(point);
        args.selectCell(true);
      } else {
        setSelectionAnchor(point);
        setSelectionEnd(point);
      }
    },
    [selectionAnchor],
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
    () =>
      capabilities.rowCreation === "direct"
        ? [...table.rows, draftRow]
        : table.rows,
    [capabilities.rowCreation, draftRow, table.rows],
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
        newRecordLabel,
        onActivateDraft: activateDraft,
        onOpenColumnMenu: (columnKey) => {
          setAddColumnOpen(false);
          setColumnMenuKey((current) =>
            current === columnKey ? null : columnKey,
          );
        },
        onCloseColumnMenu: () => setColumnMenuKey(null),
        onOpenRecord: openRecord,
        onRenameColumn: handleRenameColumn,
        onUpdateColumnOptions: handleUpdateColumnOptions,
        onChangeColumnType: handleChangeColumnType,
        onInsertColumn: handleInsertColumn,
        onMoveColumn: handleMoveColumn,
        onSearchConnectionTargets: (columnKey, search) =>
          adapter.searchConnectionTargets
            ? adapter.searchConnectionTargets(columnKey, search)
            : Promise.resolve([]),
        onCreateConnectionTarget: (columnKey, primaryValue) =>
          adapter.createConnectionTarget
            ? adapter.createConnectionTarget(columnKey, primaryValue)
            : Promise.reject(
                new Error("Creating a connected Record is not available."),
              ),
        canRenameColumns: capabilities.canRenameColumns,
        canUpdateColumnOptions: capabilities.canUpdateColumnOptions,
        canChangeColumnTypes: Boolean(capabilities.canChangeColumnTypes),
        canInsertColumns: Boolean(capabilities.canInsertColumns),
        canReorderColumns: capabilities.canReorderColumns,
        canResizeColumns: capabilities.canResizeColumns,
        pendingEdit,
      }),
    [
      activateDraft,
      columnMenuKey,
      handleRenameColumn,
      handleUpdateColumnOptions,
      handleChangeColumnType,
      handleInsertColumn,
      handleMoveColumn,
      setColumnMenuKey,
      openRecord,
      pendingEdit,
      capabilities.canRenameColumns,
      capabilities.canUpdateColumnOptions,
      capabilities.canChangeColumnTypes,
      capabilities.canInsertColumns,
      capabilities.canReorderColumns,
      capabilities.canResizeColumns,
      table.columns,
      adapter,
      newRecordLabel,
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
    <section
      className={`editor-kernel-page ${variant === "embedded" ? "editor-kernel-embedded" : ""}`}
    >
      <header className="editor-lab-header">
        <div>
          {marker}
          <TableTitleEditor
            displayTitle={title ?? table.name}
            enabled={capabilities.canRenameTable}
            name={table.name}
            onCommit={handleRenameTable}
          />
        </div>
        <div className="editor-lab-header-actions">
          {variant === "workspace" ? (
            <details className="editor-table-menu">
              <summary>Table menu</summary>
              <div className="editor-table-menu-body" role="menu">
                {capabilities.canAddColumns ? (
                  <button
                    onClick={() => {
                      setColumnMenuKey(null);
                      setAddColumnOpen(true);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    Add property
                  </button>
                ) : null}
                <button
                  onClick={() => setShortcutOpen(true)}
                  role="menuitem"
                  type="button"
                >
                  Keyboard shortcuts
                </button>
              </div>
            </details>
          ) : null}
          <div
            className={`editor-save-state editor-save-${saveState.status}`}
            role="status"
          >
            <span className="editor-save-dot" aria-hidden="true" />
            {saveState.status === "error" && saveState.message
              ? saveState.message
              : statusLabel(saveState)}
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
        </div>
      </header>

      {headerContent ? (
        <div className="editor-header-content">{headerContent}</div>
      ) : null}

      <div className="editor-lab-meta">
        <span>{recordCountLabel ?? `${table.rows.length} records`}</span>
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
          <div
            className="editor-grid-shell"
            onCopyCapture={handleCopyCapture}
            onPasteCapture={handlePasteCapture}
          >
            <DataGrid
              aria-label={`${table.name} editor`}
              className="editor-grid"
              columns={gridColumns}
              data-testid="editor-grid"
              headerRowHeight={36}
              onCellClick={handleCellClick}
              onCellMouseDown={handleCellMouseDown}
              onCellDoubleClick={handleDoubleClick}
              onCellKeyDown={handleCellKeyDown}
              onColumnResize={
                capabilities.canResizeColumns ? handleResizeColumn : undefined
              }
              onColumnsReorder={
                capabilities.canReorderColumns
                  ? handleReorderColumns
                  : undefined
              }
              onRowsChange={handleRowsChange}
              onSelectedCellChange={({ row, column }) => {
                setPendingEdit(null);
                if (row) {
                  setActiveCell({ rowId: row.id, columnKey: column.key });
                }
                const point = {
                  rowIndex: row
                    ? row.isDraft
                      ? table.rows.length
                      : table.rows.findIndex(
                          (candidate) => candidate.id === row.id,
                        )
                    : 0,
                  columnIndex: column.idx,
                };
                if (rangeSelectionRef.current) {
                  rangeSelectionRef.current = false;
                  setSelectionEnd(point);
                } else {
                  setSelectionAnchor(point);
                  setSelectionEnd(point);
                }
              }}
              ref={gridRef}
              rowClass={(row) => (row.isDraft ? "editor-draft-row" : undefined)}
              rowHeight={38}
              rowKeyGetter={(row) => row.id}
              rows={gridRows}
            />
            {capabilities.canAddColumns ? (
              <>
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
                    canAddConnections={capabilities.canAddConnections !== false}
                    {...(connectionSource ? { connectionSource } : {})}
                    {...(connectionTargets ? { connectionTargets } : {})}
                    onClose={() => setAddColumnOpen(false)}
                    onCreate={handleCreateColumn}
                    {...(onCreateConnection
                      ? { onCreateConnection: handleCreateConnection }
                      : {})}
                  />
                ) : null}
              </>
            ) : null}
          </div>
          {footer || capabilities.rowCreation !== "direct" ? (
            <div className="editor-grid-footnote">
              {capabilities.rowCreation !== "direct" ? (
                <span>
                  {capabilities.rowCreationMessage ??
                    "New records are not available in this Table preview."}
                </span>
              ) : null}
              {footer}
            </div>
          ) : null}
        </div>
        {activePanel ? (
          <RecordPanel
            key={`${activePanel.viewKey}:${activePanel.row.id}:${JSON.stringify(activePanel.row.values)}`}
            {...(businessSlug !== undefined ? { businessSlug } : {})}
            columns={activePanel.columns}
            {...(activePanel.fullRecordPath !== undefined
              ? { fullRecordPath: activePanel.fullRecordPath }
              : {})}
            {...(panelHistory.length > 0
              ? { onBack: backConnectedRecord }
              : {})}
            onClose={closePanel}
            onCommitCell={connectedPanel ? commitConnectedCell : commitCell}
            onFollowConnectedRecord={
              loadConnectedRecord ? followConnectedRecord : undefined
            }
            onSearchConnectionTargets={
              connectedPanel
                ? searchPanelConnectionTargets
                : (columnKey, search) =>
                    adapter.searchConnectionTargets
                      ? adapter.searchConnectionTargets(columnKey, search)
                      : Promise.resolve([])
            }
            onCreateConnectionTarget={
              connectedPanel
                ? createPanelConnectionTarget
                : (columnKey, primaryValue) =>
                    adapter.createConnectionTarget
                      ? adapter.createConnectionTarget(columnKey, primaryValue)
                      : Promise.reject(
                          new Error(
                            "Creating a connected Record is not available.",
                          ),
                        )
            }
            row={activePanel.row}
            {...(activePanel.recordTypeLabel !== undefined
              ? { recordTypeLabel: activePanel.recordTypeLabel }
              : {})}
            tableName={activePanel.tableName}
          />
        ) : null}
      </div>
      {shortcutOpen ? (
        <ShortcutSheet onClose={() => setShortcutOpen(false)} />
      ) : null}
    </section>
  );
}
