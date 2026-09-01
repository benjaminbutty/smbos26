"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
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
  displayEditorValue,
  editorDraftRowId,
  editorInputValue,
  editorValueForColumn,
  freshDraftRowIndex,
  hasDraftName,
  reorderColumnKeys,
  type AddExistingConnectionPropertyInput,
  type CreatePropertyInput,
  type CreateConnectionPropertyInput,
  type ConnectionTableOption,
  type ExistingConnectionPropertyOption,
  type EditorCapabilities,
  type EditorColumn,
  type EditorColumnKind,
  type EditorRow,
  type EditorTable,
  type EditorTablePreview,
  type EditorValue,
} from "./contracts";
import {
  buildClipboardMatrix,
  clipboardEventBelongsToGrid,
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
import { selectionForRows, TableBulkUpdateBar } from "./bulk-update-bar";
import {
  ContextualRecordCreateDialog,
  type ContextualRecordCreateConnection,
  type ContextualRecordCreateDialogState,
} from "./contextual-record-create-dialog";
import type { TableEditorAdapter } from "./contracts";
import { OptionManager, Popover, ShortcutSheet, TypePicker } from "./lenni-ui";
import {
  addablePropertyKinds,
  describePropertyChange,
  ensureCompactPropertyPreviewColumns,
  maximumPropertyOptions,
  propertyKindDescription,
  propertyKindLabel,
  previewTableWithConnection,
  previewTableWithProperty,
  validatePropertyOptions,
  type ConnectionDraft,
  type PropertyDraft,
} from "./property-preview";
import { useUnsavedNavigationWarning } from "../unsaved-navigation-warning";

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
  creationFallbackHref?: string;
  footer?: ReactNode;
  bulkUpdate?: (input: {
    fieldKey: string;
    value: EditorValue;
    records: readonly { recordId: string; expectedUpdatedAt: string }[];
  }) => Promise<
    | { status: "success"; value: readonly EditorRow[] }
    | { status: "error"; message: string }
  >;
  headerContent?: ReactNode;
  marker?: ReactNode;
  newRecordLabel?: string;
  onStructureChanged?: () => void;
  connectionSource?: Pick<
    ConnectionTableOption,
    "singularLabel" | "pluralLabel"
  >;
  connectionTargets?: readonly ConnectionTableOption[];
  existingConnections?: readonly ExistingConnectionPropertyOption[];
  onCreateConnection?: (
    input: CreateConnectionPropertyInput,
  ) => Promise<string | false>;
  onAddExistingConnection?: (
    input: AddExistingConnectionPropertyInput,
  ) => Promise<string | false>;
  recordCountLabel?: string;
  recordTypeLabel?: string;
  panelStatusLabel?: string;
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
  loadContextualRecordCreate?:
    | ((
        context: EditorRecordContext,
        columnKey: string,
      ) => Promise<ContextualRecordCreateDialogState>)
    | undefined;
  createContextualRecord?:
    | ((
        context: EditorRecordContext,
        columnKey: string,
        values: Readonly<Record<string, EditorValue>>,
        connections: readonly ContextualRecordCreateConnection[],
      ) => Promise<{ id: string; label: string }>)
    | undefined;
  title?: string;
  readOnly?: boolean;
  /** A containing workbench owns complete-view search and paging. */
  serverSearchManaged?: boolean;
  variant?: "workspace" | "embedded";
  viewPreview?: EditorTablePreview | null;
}

interface ActiveCell {
  rowId: string;
  columnKey: string;
}

interface GridPoint {
  rowIndex: number;
  columnIndex: number;
}

const editorAddPropertyColumnKey = "__editor_add_property__";

export interface SaveRetry {
  rowId: string;
  columnKey: string;
  value: EditorValue;
  previousValue: EditorValue;
}

type SaveState =
  | { status: "saved" }
  | { status: "saving" }
  | { status: "stale"; message?: string }
  | { status: "error"; cellLabel?: string; message?: string };

function saveErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Could not save";
}

function saveStateForError(error: unknown): SaveState {
  const message = saveErrorMessage(error);
  return /reload|table changed|current/i.test(message)
    ? { status: "stale", message: "Needs reload" }
    : { status: "error", message };
}

function rowSearchText(
  row: EditorRow,
  columns: readonly EditorColumn[],
): string {
  const values = columns.flatMap((column) => {
    const value = row.values[column.key];
    const labels = row.connectionValues?.[column.key]?.map(
      (item) => item.label,
    );
    return [editorInputValue(value ?? null), ...(labels ?? [])];
  });
  return values.join(" ").toLocaleLowerCase("en");
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

  return (
    <input
      ref={inputRef}
      aria-label="Table title"
      className="editor-title-input editor-title-inline"
      maxLength={120}
      minLength={1}
      onBlur={() => void commit()}
      onChange={(event) => setValue(event.currentTarget.value)}
      onFocus={() => setEditing(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
      readOnly={!editing}
      required
      value={value}
    />
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

export function gridCoordinatesForCell(
  rows: readonly EditorRow[],
  columns: readonly EditorColumn[],
  cell: ActiveCell,
): { idx: number; rowIdx: number } | null {
  const rowIdx = rows.findIndex((row) => row.id === cell.rowId);
  const idx = columns.findIndex((column) => column.key === cell.columnKey);
  return rowIdx >= 0 && idx >= 0 ? { idx, rowIdx } : null;
}

export function cancelFailedSave(
  table: EditorTable,
  retry: SaveRetry,
): EditorTable {
  return replaceCell(table, retry.rowId, retry.columnKey, retry.previousValue);
}

function mergeSavedRow(current: EditorRow, saved: EditorRow): EditorRow {
  const currentConnectionValues = current.connectionValues ?? {};
  const savedConnectionValues = saved.connectionValues ?? {};
  const connectionValues = {
    ...currentConnectionValues,
    ...savedConnectionValues,
  };
  const values = { ...current.values, ...saved.values };

  for (const [columnKey, labels] of Object.entries(connectionValues)) {
    if (
      !Object.prototype.hasOwnProperty.call(savedConnectionValues, columnKey) ||
      savedConnectionValues[columnKey]
    ) {
      values[columnKey] = labels.map((value) => value.id);
    }
  }

  return {
    ...current,
    ...saved,
    values,
    ...(Object.keys(connectionValues).length > 0 ? { connectionValues } : {}),
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
    case "stale":
      return "Needs reload";
    case "error":
      return "Could not save";
    case "saved":
      return "Saved";
  }
}

const compactPropertyLimit = 4;

function mobileRecordValue(row: EditorRow, column: EditorColumn): string {
  if (column.kind === "connection") {
    return (row.connectionValues?.[column.key] ?? [])
      .map((item) => item.label)
      .join(", ");
  }
  return displayEditorValue(column, row.values[column.key] ?? null);
}

function EditorMobileRecordList({
  columns,
  emptyMessage,
  emptyRecordLabel,
  noMatches,
  onClearSearch,
  onOpenRecord,
  previewColumn,
  rows,
  tableName,
}: Readonly<{
  columns: readonly EditorColumn[];
  emptyMessage: string;
  emptyRecordLabel: string;
  noMatches: boolean;
  onClearSearch: () => void;
  onOpenRecord: (rowId: string, columnKey: string) => void;
  previewColumn?: EditorColumn;
  rows: readonly EditorRow[];
  tableName: string;
}>): ReactNode {
  const primaryColumn = columns.find((column) => column.primary) ?? columns[0];
  const secondaryColumns = columns
    .filter((column) => column.key !== primaryColumn?.key)
    .slice(0, 2);
  if (!primaryColumn) {
    return null;
  }

  return (
    <div
      aria-label={`${tableName} records`}
      className="editor-mobile-record-list"
      data-testid="editor-mobile-record-list"
    >
      {previewColumn ? (
        <div className="editor-mobile-property-preview" role="status">
          <strong>{previewColumn.label}</strong>
          <span>
            Preview only · Empty until you add this property. It cannot be
            edited yet.
          </span>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <div className="editor-mobile-record-empty" role="status">
          <strong>
            {noMatches ? "No matches" : `No ${emptyRecordLabel} yet`}
          </strong>
          <span>
            {noMatches
              ? "Try a different search or clear search."
              : emptyMessage}
          </span>
          {noMatches ? (
            <button
              className="button-secondary button-small"
              onClick={onClearSearch}
              type="button"
            >
              Clear search
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="editor-mobile-record-items">
          {rows.map((row) => {
            const primaryValue = mobileRecordValue(row, primaryColumn);
            return (
              <li key={row.id}>
                <button
                  aria-label={`Open record ${primaryValue || "Unnamed record"}`}
                  className="editor-mobile-record-card"
                  onClick={() => onOpenRecord(row.id, primaryColumn.key)}
                  type="button"
                >
                  <span className="editor-mobile-record-card-heading">
                    <strong>{primaryValue || "Unnamed record"}</strong>
                    <span aria-hidden="true">Open</span>
                  </span>
                  {secondaryColumns.length > 0 ? (
                    <span className="editor-mobile-record-card-details">
                      {secondaryColumns.map((column) => (
                        <span key={column.key}>
                          <small>{column.label}</small>
                          <span>{mobileRecordValue(row, column) || "—"}</span>
                        </span>
                      ))}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function ConnectionPropertyPopover({
  existingConnections = [],
  externalError,
  onAddExisting,
  onBack,
  onClose,
  onCreate,
  onDraftChange,
  onRefresh,
  source,
  targets,
}: Readonly<{
  onBack: () => void;
  onClose: () => void;
  onAddExisting?: (
    input: AddExistingConnectionPropertyInput,
  ) => Promise<boolean>;
  onCreate: (input: CreateConnectionPropertyInput) => Promise<boolean>;
  onDraftChange?: (draft: ConnectionDraft | null) => void;
  source: Pick<ConnectionTableOption, "singularLabel" | "pluralLabel">;
  targets: readonly ConnectionTableOption[];
  existingConnections?: readonly ExistingConnectionPropertyOption[];
  externalError?: string | null;
  onRefresh?: () => void;
}>): ReactNode {
  const readableSingular = (singular: string, plural: string): string => {
    if (
      singular.trim().toLocaleLowerCase("en") !==
      plural.trim().toLocaleLowerCase("en")
    ) {
      return singular;
    }
    const words = singular.trim().split(/\s+/);
    const finalWord = words.at(-1) ?? singular;
    const normalized = finalWord.toLocaleLowerCase("en");
    const replacement = normalized.endsWith("ies")
      ? `${finalWord.slice(0, -3)}y`
      : normalized.endsWith("sses")
        ? finalWord.slice(0, -2)
        : normalized.endsWith("s") && !normalized.endsWith("ss")
          ? finalWord.slice(0, -1)
          : finalWord;
    return [...words.slice(0, -1), replacement].join(" ");
  };
  const sourceSingular = readableSingular(
    source.singularLabel,
    source.pluralLabel,
  );
  const [existingKey, setExistingKey] = useState(() => {
    const first = existingConnections[0];
    return first ? `${first.relationshipKey}:${first.direction}` : "";
  });
  const [targetViewKey, setTargetViewKey] = useState(targets[0]?.viewKey ?? "");
  const [currentMultiplicity, setCurrentMultiplicity] = useState<
    "one" | "several"
  >("one");
  const [targetMultiplicity, setTargetMultiplicity] = useState<
    "one" | "several"
  >("several");
  const [label, setLabel] = useState(() => {
    const first = targets[0];
    return first
      ? readableSingular(first.singularLabel, first.pluralLabel)
      : "";
  });
  const [reverseLabel, setReverseLabel] = useState(source.pluralLabel);
  const [addReverse, setAddReverse] = useState(true);
  const [labelTouched, setLabelTouched] = useState(false);
  const [reverseLabelTouched, setReverseLabelTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const target = targets.find(
    (candidate) => candidate.viewKey === targetViewKey,
  );
  const targetSingular = target
    ? readableSingular(target.singularLabel, target.pluralLabel)
    : "record";
  const existing = existingConnections.find(
    (candidate) =>
      `${candidate.relationshipKey}:${candidate.direction}` === existingKey,
  );

  useEffect(() => {
    if (existing) {
      onDraftChange?.({
        targetViewKey: existing.targetViewKey,
        label: existing.label,
        currentMultiplicity: existing.currentMultiplicity,
        targetMultiplicity: existing.targetMultiplicity,
        addReverse: false,
      });
      return () => onDraftChange?.(null);
    }
    if (!target) {
      onDraftChange?.(null);
      return;
    }
    onDraftChange?.({
      targetViewKey,
      label,
      currentMultiplicity,
      targetMultiplicity,
      addReverse,
      ...(addReverse && reverseLabel.trim() ? { reverseLabel } : {}),
    });
    return () => onDraftChange?.(null);
  }, [
    addReverse,
    currentMultiplicity,
    existing,
    label,
    onDraftChange,
    reverseLabel,
    target,
    targetMultiplicity,
    targetViewKey,
  ]);

  return (
    <form
      className="editor-add-column-popover editor-connection-create-popover"
      onSubmit={(event) => {
        event.preventDefault();
        if (existing) {
          if (!onAddExisting || submitting) return;
          setError(null);
          setSubmitting(true);
          void onAddExisting({
            relationshipKey: existing.relationshipKey,
            direction: existing.direction,
            label: existing.label,
          })
            .then((added) => {
              if (added) onClose();
            })
            .catch((submissionError: unknown) => {
              setError(saveErrorMessage(submissionError));
            })
            .finally(() => setSubmitting(false));
          return;
        }
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
      {existingConnections.length > 0 ? (
        <fieldset className="editor-existing-connections">
          <legend>Already connected</legend>
          <p>
            Show an existing connection as a Property instead of creating a
            duplicate.
          </p>
          {existingConnections.map((candidate) => {
            const key = `${candidate.relationshipKey}:${candidate.direction}`;
            return (
              <label key={key}>
                <input
                  checked={existingKey === key}
                  name="existing-connection"
                  onChange={() => {
                    setExistingKey(key);
                    setError(null);
                  }}
                  type="radio"
                />
                <span>
                  <strong>{candidate.label}</strong>
                  <small>Connected with {candidate.otherTableLabel}</small>
                </span>
              </label>
            );
          })}
          <button
            className="editor-add-connection-link"
            onClick={() => {
              setExistingKey("");
              setError(null);
            }}
            type="button"
          >
            Create a different connection
          </button>
        </fieldset>
      ) : null}
      {existing ? (
        <div className="editor-connection-summary">
          <strong>What happens</strong>
          <p>
            {existing.label} appears on this Table using its existing connection
            with {existing.otherTableLabel}.
          </p>
          <p>Existing Records and connected values stay unchanged.</p>
        </div>
      ) : (
        <>
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
                      ? readableSingular(
                          nextTarget.singularLabel,
                          nextTarget.pluralLabel,
                        )
                      : nextTarget.pluralLabel,
                  );
                  setReverseLabel(
                    targetMultiplicity === "several"
                      ? source.pluralLabel
                      : sourceSingular,
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
                On {source.pluralLabel}, call this property
                <input
                  aria-label={`On ${source.pluralLabel}, call this property`}
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
                <span>Each {sourceSingular} can have:</span>
                <label>
                  <span className="editor-sr-only">
                    How many connected Records
                  </span>
                  <select
                    aria-label={`Each ${sourceSingular} can have`}
                    onChange={(event) => {
                      const nextMultiplicity = event.currentTarget.value as
                        "one" | "several";
                      setCurrentMultiplicity(nextMultiplicity);
                      if (!labelTouched && target) {
                        setLabel(
                          nextMultiplicity === "one"
                            ? targetSingular
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
                    ? targetSingular
                    : target.pluralLabel}
                </span>
              </div>
              <div className="editor-connection-multiplicity">
                <span>Each {targetSingular} can have:</span>
                <label>
                  <span className="editor-sr-only">
                    How many Records can connect back
                  </span>
                  <select
                    aria-label={`Each ${targetSingular} can have`}
                    onChange={(event) => {
                      const nextMultiplicity = event.currentTarget.value as
                        "one" | "several";
                      setTargetMultiplicity(nextMultiplicity);
                      if (!reverseLabelTouched) {
                        setReverseLabel(
                          nextMultiplicity === "several"
                            ? source.pluralLabel
                            : sourceSingular,
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
                    ? sourceSingular
                    : source.pluralLabel}
                </span>
              </div>
              <label className="editor-connection-reverse-toggle">
                <span>
                  <input
                    checked={addReverse}
                    onChange={(event) =>
                      setAddReverse(event.currentTarget.checked)
                    }
                    type="checkbox"
                  />{" "}
                  Also show this on {target.label}
                </span>
              </label>
              {addReverse ? (
                <label>
                  On {target.pluralLabel}, call this property
                  <input
                    aria-label={`On ${target.pluralLabel}, call this property`}
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
              <div className="editor-connection-summary">
                <strong>What happens</strong>
                <p>
                  Each {sourceSingular} can have {currentMultiplicity}{" "}
                  {currentMultiplicity === "one"
                    ? targetSingular
                    : target.pluralLabel}
                  . Each {targetSingular} can have {targetMultiplicity}{" "}
                  {targetMultiplicity === "one"
                    ? sourceSingular
                    : source.pluralLabel}
                  .
                </p>
                <p>
                  Existing Records stay unchanged and nothing is filled
                  automatically.
                </p>
                <p>
                  Unlinking later removes only the connection, not either
                  Record.
                </p>
              </div>
            </>
          ) : (
            <span className="editor-structural-error" role="status">
              Create another Table before adding a Connection.
            </span>
          )}
        </>
      )}
      {error || externalError ? (
        <span className="editor-structural-error" role="alert">
          {error ?? externalError}
        </span>
      ) : null}
      {externalError && onRefresh ? (
        <button
          className="editor-property-refresh"
          onClick={onRefresh}
          type="button"
        >
          Refresh and recheck
        </button>
      ) : null}
      <div className="editor-connection-flow-actions">
        <button className="editor-menu-back" onClick={onBack} type="button">
          Back
        </button>
        <button
          className="editor-menu-submit"
          disabled={submitting || (!existing && !target)}
          type="submit"
        >
          {submitting
            ? "Adding…"
            : existing
              ? "Show connection"
              : "Add connection"}
        </button>
      </div>
    </form>
  );
}

function initialPropertyDraft(): PropertyDraft {
  return {
    label: "",
    kind: "text",
    options: ["Option 1", "Option 2"],
    placement: { mode: "end" },
  };
}

export function AddColumnPopover({
  anchorRef,
  canAddConnections,
  columns = [],
  connectionSource,
  connectionTargets,
  existingConnections,
  draft: controlledDraft,
  onClose,
  onCreate,
  onCreateConnection,
  onAddExistingConnection,
  onConnectionDraftChange,
  onDraftChange,
  onRefresh,
  externalError,
  tableName,
}: Readonly<{
  anchorRef?: RefObject<HTMLElement | null>;
  canAddConnections?: boolean;
  columns?: readonly EditorColumn[];
  connectionSource?: Pick<
    ConnectionTableOption,
    "singularLabel" | "pluralLabel"
  >;
  connectionTargets?: readonly ConnectionTableOption[];
  existingConnections?: readonly ExistingConnectionPropertyOption[];
  draft?: PropertyDraft;
  onClose: () => void;
  onCreate: (input: CreatePropertyInput) => Promise<boolean | void>;
  onCreateConnection?: (
    input: CreateConnectionPropertyInput,
  ) => Promise<boolean>;
  onAddExistingConnection?: (
    input: AddExistingConnectionPropertyInput,
  ) => Promise<boolean>;
  onConnectionDraftChange?: (draft: ConnectionDraft | null) => void;
  onDraftChange?: (draft: PropertyDraft | null) => void;
  onRefresh?: () => void;
  externalError?: string | null;
  tableName?: string;
}>): ReactNode {
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [localDraft, setLocalDraft] =
    useState<PropertyDraft>(initialPropertyDraft);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const propertyNameRef = useRef<HTMLInputElement>(null);
  const draft = controlledDraft ?? localDraft;

  useEffect(() => {
    let followUpFrame: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      followUpFrame = window.requestAnimationFrame(() => {
        propertyNameRef.current?.focus({ preventScroll: true });
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (followUpFrame !== undefined) {
        window.cancelAnimationFrame(followUpFrame);
      }
    };
  }, []);
  const propertyColumns = columns.filter(
    (column) => column.kind !== "connection" && !column.preview,
  );
  const optionError =
    draft.kind === "select" || draft.kind === "status"
      ? validatePropertyOptions(draft.options)
      : null;
  const placementAnchorKey =
    draft.placement.mode === "end" ? null : draft.placement.anchorColumnKey;
  const placementError =
    placementAnchorKey !== null &&
    !propertyColumns.some((column) => column.key === placementAnchorKey)
      ? "Choose an existing property for this placement."
      : null;
  const descriptor = describePropertyChange(
    {
      key: "property-editor",
      name: tableName ?? "this Table",
      primaryColumnKey: propertyColumns[0]?.key ?? "",
      columns: propertyColumns,
      rows: [],
    },
    draft,
  );

  const updateDraft = (next: PropertyDraft): void => {
    if (!controlledDraft) {
      setLocalDraft(next);
    }
    onDraftChange?.(next);
    setError(null);
  };
  const openConnectionSetup = (): void => {
    setError(null);
    onDraftChange?.(null);
    setConnectionOpen(true);
  };

  const submit = (): void => {
    if (submitting) return;
    const label = draft.label.trim();
    if (!label) {
      setError("Give this property a name.");
      return;
    }
    if (optionError) {
      setError(optionError);
      return;
    }
    if (placementError) {
      setError(placementError);
      return;
    }
    setError(null);
    setSubmitting(true);
    const input: CreatePropertyInput = {
      label,
      kind: draft.kind,
      placement: draft.placement,
      ...(draft.kind === "select" || draft.kind === "status"
        ? { options: draft.options }
        : {}),
      ...(draft.kind === "currency"
        ? { currency: draft.currency ?? "GBP" }
        : {}),
    };
    void onCreate(input)
      .then((created) => {
        if (created !== false) {
          onClose();
        }
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error ? cause.message : "Could not add property",
        );
      })
      .finally(() => setSubmitting(false));
  };

  if (connectionOpen && connectionSource && onCreateConnection) {
    return (
      <ConnectionPropertyPopover
        existingConnections={existingConnections ?? []}
        {...(externalError ? { externalError } : {})}
        {...(onAddExistingConnection
          ? { onAddExisting: onAddExistingConnection }
          : {})}
        onBack={() => setConnectionOpen(false)}
        onClose={onClose}
        onCreate={onCreateConnection}
        {...(onRefresh ? { onRefresh } : {})}
        {...(onConnectionDraftChange
          ? { onDraftChange: onConnectionDraftChange }
          : {})}
        source={connectionSource}
        targets={connectionTargets ?? []}
      />
    );
  }

  return (
    <Popover
      {...(anchorRef ? { anchorRef } : {})}
      className="editor-property-editor"
      onClose={onClose}
      viewportSafe={Boolean(anchorRef)}
    >
      <div className="editor-property-editor-header editor-popover-heading">
        <div>
          <strong>Add property</strong>
          <span>Shape this Table where you work.</span>
        </div>
        <button
          aria-label="Close add property editor"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
      </div>
      <div className="editor-property-editor-body">
        <label>
          Property name
          <input
            maxLength={120}
            onChange={(event) =>
              updateDraft({ ...draft, label: event.currentTarget.value })
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
            placeholder="e.g. Referral source"
            ref={propertyNameRef}
            value={draft.label}
          />
        </label>
        <div className="editor-property-type-section">
          <div className="editor-property-section-heading">
            <span>Type</span>
            <span className="editor-property-type-label">
              {propertyKindLabel(draft.kind)}
            </span>
          </div>
          <p className="editor-property-type-note">
            {propertyKindDescription(draft.kind)}
          </p>
          <TypePicker
            allowedKinds={addablePropertyKinds}
            onChange={(kind) => updateDraft({ ...draft, kind })}
            value={draft.kind}
          />
        </div>
        {canAddConnections && onCreateConnection && connectionSource ? (
          <div className="editor-property-connection-choice">
            <div>
              <strong>Connect another Table</strong>
              <span>Show related Records alongside this Table.</span>
            </div>
            {(connectionTargets?.length ?? 0) > 0 ? (
              <button onClick={openConnectionSetup} type="button">
                Add connected property
              </button>
            ) : (
              <span className="editor-property-type-note" role="status">
                Create another Table before adding a connected property.
              </span>
            )}
          </div>
        ) : null}
        {draft.kind === "currency" ? (
          <label>
            Currency
            <select
              aria-label="Currency"
              onChange={(event) =>
                updateDraft({ ...draft, currency: event.currentTarget.value })
              }
              value={draft.currency ?? "GBP"}
            >
              <option value="GBP">UK pounds (GBP)</option>
              <option value="EUR">Euros (EUR)</option>
              <option value="USD">US dollars (USD)</option>
            </select>
          </label>
        ) : null}
        {draft.kind === "select" || draft.kind === "status" ? (
          <div className="editor-property-options-section">
            <div className="editor-property-section-heading">
              <span>{draft.kind === "status" ? "Stages" : "Choices"}</span>
              <span>{draft.options.length} added</span>
            </div>
            <OptionManager
              maxOptions={maximumPropertyOptions}
              onChange={(options) => updateDraft({ ...draft, options })}
              options={draft.options}
            />
            {optionError ? (
              <span className="editor-structural-error" role="alert">
                {optionError}
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="editor-property-placement-section">
          <label>
            Placement
            <select
              aria-label="Property placement"
              onChange={(event) => {
                const mode = event.currentTarget.value as
                  "end" | "before" | "after";
                if (mode === "end") {
                  updateDraft({ ...draft, placement: { mode } });
                  return;
                }
                const anchorColumnKey =
                  draft.placement.mode === "end"
                    ? propertyColumns[0]?.key
                    : draft.placement.anchorColumnKey;
                if (!anchorColumnKey) return;
                updateDraft({
                  ...draft,
                  placement: { mode, anchorColumnKey },
                });
              }}
              value={draft.placement.mode}
            >
              <option value="end">At the end</option>
              <option disabled={propertyColumns.length === 0} value="before">
                Before a property
              </option>
              <option disabled={propertyColumns.length === 0} value="after">
                After a property
              </option>
            </select>
          </label>
          {draft.placement.mode !== "end" ? (
            <label>
              Property
              <select
                aria-label="Placement property"
                onChange={(event) =>
                  updateDraft({
                    ...draft,
                    placement: {
                      mode: draft.placement.mode,
                      anchorColumnKey: event.currentTarget.value,
                    },
                  })
                }
                value={draft.placement.anchorColumnKey}
              >
                {propertyColumns.map((column) => (
                  <option key={column.key} value={column.key}>
                    {column.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className="editor-property-consequence" aria-live="polite">
          <strong>What happens</strong>
          <p>{descriptor.summary}</p>
          {descriptor.optionCount !== undefined ? (
            <p>
              {descriptor.optionCount}{" "}
              {descriptor.optionCount === 1 ? "option" : "options"} will be
              available.
            </p>
          ) : null}
          <ul>
            {descriptor.details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        </div>
        {error || externalError ? (
          <span className="editor-structural-error" role="alert">
            {error ?? externalError}
          </span>
        ) : null}
      </div>
      <div className="editor-property-editor-actions">
        <button className="editor-menu-back" onClick={onClose} type="button">
          Cancel
        </button>
        <button
          className="editor-menu-submit"
          disabled={submitting}
          onClick={submit}
          type="button"
        >
          {submitting ? "Adding…" : "Add property"}
        </button>
      </div>
      {externalError && onRefresh ? (
        <button
          className="editor-property-refresh"
          onClick={onRefresh}
          type="button"
        >
          Refresh and recheck
        </button>
      ) : null}
    </Popover>
  );
}

export function EditorKernel({
  adapter,
  businessSlug,
  capabilities = defaultEditorCapabilities,
  creationFallbackHref,
  footer,
  bulkUpdate,
  headerContent,
  marker,
  newRecordLabel = "New record",
  onStructureChanged,
  connectionSource,
  connectionTargets,
  existingConnections,
  onCreateConnection,
  onAddExistingConnection,
  panelStatusLabel,
  recordCountLabel,
  recordTypeLabel,
  fullRecordPath,
  loadConnectedRecord,
  updateConnectedRecord,
  searchConnectedRecordTargets,
  createConnectedRecordTarget,
  loadContextualRecordCreate,
  createContextualRecord,
  readOnly = false,
  serverSearchManaged = false,
  title,
  variant = "workspace",
  viewPreview = null,
}: Readonly<EditorKernelProps>): ReactNode {
  const [table, setTable] = useState<EditorTable>(() => {
    const initial = adapter.getTable();
    return readOnly ? readOnlyTable(initial) : initial;
  });
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null);
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const [columnMenuKey, setColumnMenuKey] = useState<string | null>(null);
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [propertyDraft, setPropertyDraft] = useState<PropertyDraft | null>(
    null,
  );
  const [connectionDraft, setConnectionDraft] =
    useState<ConnectionDraft | null>(null);
  const [focusColumnKey, setFocusColumnKey] = useState<string | null>(null);
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const [selectionAnchor, setSelectionAnchor] = useState<GridPoint | null>(
    null,
  );
  const [selectionEnd, setSelectionEnd] = useState<GridPoint | null>(null);
  const [panelRowId, setPanelRowId] = useState<string | null>(null);
  const [panelOrigin, setPanelOrigin] = useState<ActiveCell | null>(null);
  const [panelEditingKey, setPanelEditingKey] = useState<string | null>(null);
  const [connectedPanel, setConnectedPanel] =
    useState<EditorRecordContext | null>(null);
  const [contextualCreate, setContextualCreate] = useState<{
    context: EditorRecordContext;
    columnKey: string;
    state: ContextualRecordCreateDialogState;
  } | null>(null);
  const [panelHistory, setPanelHistory] = useState<EditorRecordContext[]>([]);
  const [draftActivation, setDraftActivation] = useState<{
    rowIdx: number;
    columnIdx: number;
  } | null>(null);
  const [recordSearch, setRecordSearch] = useState("");
  const [saveState, setSaveState] = useState<SaveState>({ status: "saved" });
  const [structuralError, setStructuralError] = useState<string | null>(null);
  const [retry, setRetry] = useState<SaveRetry | null>(null);
  const [restoreCell, setRestoreCell] = useState<ActiveCell | null>(null);
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [showAllProperties, setShowAllProperties] = useState(false);
  const gridRef = useRef<DataGridHandle>(null);
  const addColumnButtonRef = useRef<HTMLButtonElement>(null);
  const adapterRef = useRef(adapter);
  const operationVersions = useRef(new Map<string, number>());
  const pendingSaves = useRef(new Set<string>());
  const rangeSelectionRef = useRef(false);

  useUnsavedNavigationWarning(
    addColumnOpen &&
      saveState.status !== "saving" &&
      Boolean(propertyDraft?.label.trim() || connectionDraft),
  );

  const panelRow = panelRowId
    ? (table.rows.find((row) => row.id === panelRowId) ?? null)
    : null;
  const previewTable = viewPreview?.table;
  const recordColumns =
    previewTable?.recordColumns ?? table.recordColumns ?? table.columns;
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
  const normalizedRecordSearch = serverSearchManaged
    ? ""
    : recordSearch.trim().toLocaleLowerCase("en");
  useEffect(() => {
    if (adapterRef.current === adapter) {
      return;
    }
    adapterRef.current = adapter;
    const next = adapter.getTable();
    setTable(readOnly ? readOnlyTable(next) : next);
    if (activeCell) {
      setRestoreCell(activeCell);
    }
  }, [activeCell, adapter, readOnly]);

  const visibleRows = useMemo(
    () =>
      normalizedRecordSearch
        ? (previewTable?.rows ?? table.rows).filter((row) =>
            rowSearchText(row, recordColumns).includes(normalizedRecordSearch),
          )
        : (previewTable?.rows ?? table.rows),
    [normalizedRecordSearch, previewTable?.rows, recordColumns, table.rows],
  );
  const presentationTable = useMemo(
    () =>
      propertyDraft && !readOnly
        ? previewTableWithProperty(table, propertyDraft)
        : connectionDraft && !readOnly
          ? previewTableWithConnection(table, connectionDraft)
          : (previewTable ?? table),
    [connectionDraft, previewTable, propertyDraft, readOnly, table],
  );
  useEffect(() => {
    if (variant !== "workspace") {
      return;
    }
    const mediaQuery = window.matchMedia("(max-width: 48rem)");
    const updateViewport = (): void => setIsCompactViewport(mediaQuery.matches);
    updateViewport();
    mediaQuery.addEventListener("change", updateViewport);
    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, [variant]);

  useEffect(() => {
    setShowAllProperties(false);
  }, [table.key]);

  const compactColumns = useMemo(() => {
    const columns = presentationTable.columns;
    if (columns.length <= compactPropertyLimit) {
      return columns;
    }
    const primaryColumn =
      columns.find((column) => column.key === table.primaryColumnKey) ??
      columns[0];
    if (!primaryColumn) {
      return columns.slice(0, compactPropertyLimit);
    }
    const prioritized = [
      primaryColumn,
      ...columns.filter((column) => column.key !== primaryColumn.key),
    ].slice(0, compactPropertyLimit);
    const keys = new Set(prioritized.map((column) => column.key));
    const compact = columns.filter((column) => keys.has(column.key));
    if (connectionDraft && !readOnly) {
      const required = new Set([
        table.primaryColumnKey,
        columns.find((column) => column.preview)?.key,
      ]);
      return columns.filter(
        (column) => keys.has(column.key) || required.has(column.key),
      );
    }
    return propertyDraft && !readOnly
      ? ensureCompactPropertyPreviewColumns(
          columns,
          compact,
          table.primaryColumnKey,
          propertyDraft,
        )
      : compact;
  }, [
    presentationTable.columns,
    connectionDraft,
    propertyDraft,
    readOnly,
    table.primaryColumnKey,
  ]);
  const visibleGridColumns = useMemo(
    () =>
      variant === "workspace" && isCompactViewport && !showAllProperties
        ? compactColumns
        : presentationTable.columns,
    [
      compactColumns,
      isCompactViewport,
      presentationTable.columns,
      showAllProperties,
      variant,
    ],
  );
  const omittedPropertyCount =
    presentationTable.columns.length - visibleGridColumns.length;
  const columnForKey = useCallback(
    (columnKey: string) =>
      recordColumns.find((column) => column.key === columnKey) ?? null,
    [recordColumns],
  );

  const closePanel = useCallback(() => {
    const origin = panelOrigin;
    setPanelRowId(null);
    setPanelOrigin(null);
    setPanelEditingKey(null);
    setConnectedPanel(null);
    setPanelHistory([]);
    if (!origin) {
      return;
    }
    window.requestAnimationFrame(() => {
      const rowIdx = visibleRows.findIndex((row) => row.id === origin.rowId);
      const columnIdx = visibleGridColumns.findIndex(
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
  }, [panelOrigin, visibleGridColumns, visibleRows]);

  useEffect(() => {
    setSelectionAnchor(null);
    setSelectionEnd(null);
  }, [normalizedRecordSearch]);

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
        setPropertyDraft(initialPropertyDraft());
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
        setPropertyDraft(null);
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
    (
      rowId: string,
      columnKey: string,
      rawValue: unknown,
      options?: { force?: boolean; previousValue?: EditorValue },
    ): void => {
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
      if (Object.is(previousValue, value) && !options?.force) {
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
                ? mergeSavedRow(candidate, savedRow)
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
          setRetry({
            rowId,
            columnKey,
            value,
            previousValue: options?.previousValue ?? previousValue,
          });
          setSaveState({ status: "error", cellLabel: column.label });
        });
    },
    [adapter, columnForKey, table.rows],
  );

  const runStructural = useCallback(
    async (operation: () => Promise<unknown>): Promise<boolean> => {
      setSaveState({ status: "saving" });
      setStructuralError(null);
      setRetry(null);
      try {
        await operation();
        setTable(adapter.getTable());
        setSaveState({ status: "saved" });
        onStructureChanged?.();
        return true;
      } catch (error) {
        setSaveState(saveStateForError(error));
        setStructuralError(
          /reload|table changed|current/i.test(saveErrorMessage(error))
            ? "Things changed. Refresh to recheck this change before trying again."
            : saveErrorMessage(error),
        );
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
      if (normalizedRecordSearch) {
        setRecordSearch("");
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
    [
      adapter,
      normalizedRecordSearch,
      table.columns,
      table.primaryColumnKey,
      table.rows.length,
    ],
  );

  const handleRowsChange = useCallback(
    (nextRows: EditorRow[], data: RowsChangeData<EditorRow>): void => {
      const rowIndex = data.indexes[0];
      if (rowIndex === undefined) {
        return;
      }
      const nextRow = nextRows[rowIndex];
      if (!nextRow) {
        return;
      }
      if (nextRow.isDraft) {
        if (data.column.key === table.primaryColumnKey) {
          createDraftRecord(nextRow.values[data.column.key]);
        }
        return;
      }
      if (!table.rows.some((row) => row.id === nextRow.id)) {
        return;
      }
      commitCell(nextRow.id, data.column.key, nextRow.values[data.column.key]);
    },
    [commitCell, createDraftRecord, table.primaryColumnKey, table.rows],
  );

  const openRecord = useCallback(
    (rowId: string, columnKey: string, editColumnKey?: string): void => {
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
          setPanelEditingKey(editColumnKey ?? null);
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
                  row: mergeSavedRow(current.row, savedRow),
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

  const beginContextualRecordCreate = useCallback(
    (columnKey: string, parentRecordId: string): void => {
      if (
        !activePanel ||
        activePanel.row.id !== parentRecordId ||
        !loadContextualRecordCreate
      ) {
        return;
      }
      void loadContextualRecordCreate(activePanel, columnKey)
        .then((state) =>
          setContextualCreate({ context: activePanel, columnKey, state }),
        )
        .catch((error: unknown) => {
          setSaveState({
            status: "error",
            message: saveErrorMessage(error),
          });
        });
    },
    [activePanel, loadContextualRecordCreate],
  );

  const saveContextualRecordCreate = useCallback(
    async (
      values: Readonly<Record<string, EditorValue>>,
      connections: readonly ContextualRecordCreateConnection[],
    ): Promise<void> => {
      if (!contextualCreate || !createContextualRecord) {
        throw new Error("Adding a related Record is not available.");
      }
      const created = await createContextualRecord(
        contextualCreate.context,
        contextualCreate.columnKey,
        values,
        connections,
      );
      const appendConnection = (row: EditorRow): EditorRow => {
        const selectedValue = row.values[contextualCreate.columnKey];
        const selected = Array.isArray(selectedValue)
          ? selectedValue.filter(
              (item): item is string => typeof item === "string",
            )
          : [];
        const labels = row.connectionValues?.[contextualCreate.columnKey] ?? [];
        return {
          ...row,
          values: {
            ...row.values,
            [contextualCreate.columnKey]: selected.includes(created.id)
              ? selected
              : [...selected, created.id],
          },
          connectionValues: {
            ...row.connectionValues,
            [contextualCreate.columnKey]: labels.some(
              (item) => item.id === created.id,
            )
              ? labels
              : [...labels, created],
          },
        };
      };
      if (connectedPanel) {
        setConnectedPanel((current) =>
          current
            ? { ...current, row: appendConnection(current.row) }
            : current,
        );
      } else {
        setTable((current) => ({
          ...current,
          rows: current.rows.map((row) =>
            row.id === contextualCreate.context.row.id
              ? appendConnection(row)
              : row,
          ),
        }));
      }
      setContextualCreate(null);
      setSaveState({ status: "saved" });
    },
    [connectedPanel, contextualCreate, createContextualRecord],
  );

  const handleCreateProperty = useCallback(
    async (input: CreatePropertyInput): Promise<boolean> => {
      if (!capabilities.canAddColumns) {
        return false;
      }
      let createdColumnKey: string | null = null;
      const saved = await runStructural(async () => {
        const columnInput = {
          label: input.label,
          kind: input.kind,
          ...(input.options !== undefined ? { options: input.options } : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
        };
        const createdColumn =
          input.placement.mode === "end"
            ? await adapter.createColumn(columnInput)
            : adapter.insertColumn
              ? await adapter.insertColumn({
                  ...columnInput,
                  anchorColumnKey: input.placement.anchorColumnKey,
                  position:
                    input.placement.mode === "before" ? "left" : "right",
                })
              : null;
        if (!createdColumn) {
          throw new Error("Placement is not available for this Table.");
        }
        createdColumnKey = createdColumn.key;
      });
      if (saved) {
        setPropertyDraft(null);
        setAddColumnOpen(false);
        setColumnMenuKey(null);
        setShowAllProperties(true);
        setFocusColumnKey(createdColumnKey);
      }
      return saved;
    },
    [adapter, capabilities.canAddColumns, runStructural],
  );

  const handleCreateConnection = useCallback(
    async (input: CreateConnectionPropertyInput): Promise<boolean> => {
      if (capabilities.canAddConnections === false || !onCreateConnection) {
        return false;
      }
      let createdColumnKey: string | null = null;
      const saved = await runStructural(async () => {
        const result = await onCreateConnection(input);
        if (result === false) {
          throw new Error("That Connection could not be added.");
        }
        createdColumnKey = result;
      });
      if (saved) {
        setConnectionDraft(null);
        setAddColumnOpen(false);
        setShowAllProperties(true);
        setFocusColumnKey(createdColumnKey);
      }
      return saved;
    },
    [capabilities.canAddConnections, onCreateConnection, runStructural],
  );

  const handleAddExistingConnection = useCallback(
    async (input: AddExistingConnectionPropertyInput): Promise<boolean> => {
      if (
        capabilities.canAddConnections === false ||
        !onAddExistingConnection
      ) {
        return false;
      }
      let createdColumnKey: string | null = null;
      const saved = await runStructural(async () => {
        const result = await onAddExistingConnection(input);
        if (result === false) {
          throw new Error("That existing Connection could not be shown.");
        }
        createdColumnKey = result;
      });
      if (saved) {
        setConnectionDraft(null);
        setAddColumnOpen(false);
        setShowAllProperties(true);
        setFocusColumnKey(createdColumnKey);
      }
      return saved;
    },
    [capabilities.canAddConnections, onAddExistingConnection, runStructural],
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
      currency?: string,
    ): Promise<boolean> => {
      if (!capabilities.canChangeColumnTypes || !adapter.changeColumnType) {
        return false;
      }
      const saved = await runStructural(() =>
        adapter.changeColumnType!(columnKey, kind, options, currency),
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
        currency?: string;
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
      if (
        !capabilities.canResizeColumns ||
        !table.columns.some((candidate) => candidate.key === column.key)
      ) {
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
    [adapter, capabilities.canResizeColumns, table.columns],
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
      ? visibleRows.findIndex((row) => row.id === activeCell.rowId)
      : 0;
    const columnIndex = activeCell
      ? visibleGridColumns.findIndex(
          (column) => column.key === activeCell.columnKey,
        )
      : 0;
    return {
      rowIndex: Math.max(0, rowIndex),
      columnIndex: Math.max(0, columnIndex),
    };
  }, [activeCell, visibleGridColumns, visibleRows]);

  const handleClipboardPaste = useCallback(
    (text: string): void => {
      if (normalizedRecordSearch) {
        setSaveState({
          status: "error",
          message: "Clear search before pasting into the Table.",
        });
        return;
      }
      if (omittedPropertyCount > 0) {
        setSaveState({
          status: "error",
          message: "Show all properties before pasting into this Table.",
        });
        return;
      }
      const point = selectionAnchor ?? activeGridPoint();
      const end = selectionEnd ?? point;
      const bounds = selectionBounds(point, end);
      try {
        const columns = visibleGridColumns.slice(bounds.startColumn);
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
      normalizedRecordSearch,
      omittedPropertyCount,
      selectionAnchor,
      selectionEnd,
      visibleGridColumns,
    ],
  );

  const handleCopyCapture = useCallback(
    (event: React.ClipboardEvent): void => {
      if (!clipboardEventBelongsToGrid(event.target)) return;
      const point = selectionAnchor ?? activeGridPoint();
      const end = selectionEnd ?? point;
      const bounds = selectionBounds(point, end);
      const matrix = visibleRows
        .slice(bounds.startRow, bounds.endRow + 1)
        .map((row) =>
          visibleGridColumns
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
    [
      activeGridPoint,
      selectionAnchor,
      selectionEnd,
      visibleGridColumns,
      visibleRows,
    ],
  );

  const handlePasteCapture = useCallback(
    (event: React.ClipboardEvent): void => {
      if (!clipboardEventBelongsToGrid(event.target)) return;
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
            visibleRows.length +
            (capabilities.rowCreation === "direct" && !normalizedRecordSearch
              ? 1
              : 0);
          const next = {
            rowIndex: Math.max(
              0,
              Math.min(rowCount - 1, args.rowIdx + delta.row),
            ),
            columnIndex: Math.max(
              0,
              Math.min(
                visibleGridColumns.length - 1,
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
          if (omittedPropertyCount > 0) {
            setSaveState({
              status: "error",
              message: "Show all properties before clearing cells.",
            });
            return;
          }
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
          if (nextColumnIndex < visibleGridColumns.length) {
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
      visibleGridColumns,
      normalizedRecordSearch,
      omittedPropertyCount,
      visibleRows.length,
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
      capabilities.rowCreation === "direct" && !normalizedRecordSearch
        ? [...visibleRows, draftRow]
        : visibleRows,
    [capabilities.rowCreation, draftRow, normalizedRecordSearch, visibleRows],
  );

  useEffect(() => {
    if (!restoreCell) return;
    const target = gridCoordinatesForCell(
      gridRows,
      visibleGridColumns,
      restoreCell,
    );
    if (!target) {
      setRestoreCell(null);
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      gridRef.current?.selectCell(target, { shouldFocusCell: true });
      window.requestAnimationFrame(() => {
        gridRef.current?.element
          ?.querySelector<HTMLElement>(
            '[role="gridcell"][aria-selected="true"]',
          )
          ?.focus({ preventScroll: true });
      });
      setRestoreCell(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [gridRows, restoreCell, visibleGridColumns]);

  useEffect(() => {
    const focusRequestedColumn = (): void => {
      const prefix = "#table-column-";
      if (!window.location.hash.startsWith(prefix)) return;
      const requestedKey = decodeURIComponent(
        window.location.hash.slice(prefix.length),
      );
      if (table.columns.some((column) => column.key === requestedKey)) {
        setShowAllProperties(true);
        setFocusColumnKey(requestedKey);
      }
    };
    focusRequestedColumn();
    window.addEventListener("hashchange", focusRequestedColumn);
    return () => window.removeEventListener("hashchange", focusRequestedColumn);
  }, [table.columns]);

  useEffect(() => {
    if (!focusColumnKey) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const columnIndex = visibleGridColumns.findIndex(
        (column) => column.key === focusColumnKey,
      );
      if (columnIndex < 0) {
        setFocusColumnKey(null);
        return;
      }
      const row = gridRows[0];
      if (row) {
        gridRef.current?.selectCell(
          { idx: columnIndex, rowIdx: 0 },
          { shouldFocusCell: true },
        );
        setActiveCell({ rowId: row.id, columnKey: focusColumnKey });
        window.requestAnimationFrame(() => {
          const selectedCell =
            gridRef.current?.element?.querySelector<HTMLElement>(
              '[role="gridcell"][aria-selected="true"]',
            );
          selectedCell?.focus({ preventScroll: true });
        });
      } else {
        addColumnButtonRef.current?.focus({ preventScroll: true });
      }
      setFocusColumnKey(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusColumnKey, gridRows, visibleGridColumns]);

  const activateDraft = useCallback((rowIdx: number, columnIdx: number) => {
    setPendingEdit(null);
    setDraftActivation({ rowIdx, columnIdx });
  }, []);

  const gridColumns = useMemo(() => {
    const columns = createEditorColumns({
      columnMenuKey,
      columns: visibleGridColumns,
      newRecordLabel,
      onActivateDraft: activateDraft,
      onOpenColumnMenu: (columnKey) => {
        setPropertyDraft(null);
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
      onReorderColumns: handleReorderColumns,
      onSearchConnectionTargets: (columnKey, search) =>
        adapter.searchConnectionTargets
          ? adapter.searchConnectionTargets(columnKey, search)
          : Promise.resolve([]),
      ...(adapter.createConnectionTarget
        ? {
            onCreateConnectionTarget: (
              columnKey: string,
              primaryValue: string,
            ) => adapter.createConnectionTarget!(columnKey, primaryValue),
          }
        : {}),
      canRenameColumns: capabilities.canRenameColumns,
      canUpdateColumnOptions: capabilities.canUpdateColumnOptions,
      canChangeColumnTypes: Boolean(capabilities.canChangeColumnTypes),
      canInsertColumns: Boolean(capabilities.canInsertColumns),
      canReorderColumns: capabilities.canReorderColumns,
      canResizeColumns: capabilities.canResizeColumns,
      pendingEdit,
    });
    if (!capabilities.canAddColumns) {
      return columns;
    }
    return [
      ...columns,
      {
        key: editorAddPropertyColumnKey,
        name: "",
        width: 42,
        minWidth: 42,
        maxWidth: 42,
        resizable: false,
        draggable: false,
        renderHeaderCell: () => (
          <button
            aria-expanded={addColumnOpen}
            aria-label="Add property"
            className="editor-add-column-button"
            ref={addColumnButtonRef}
            onClick={() => {
              setColumnMenuKey(null);
              if (addColumnOpen) {
                setPropertyDraft(null);
                setAddColumnOpen(false);
              } else {
                setPropertyDraft(initialPropertyDraft());
                setAddColumnOpen(true);
              }
            }}
            type="button"
          >
            <span aria-hidden="true">+</span>
          </button>
        ),
        renderCell: () => null,
      },
    ];
  }, [
    activateDraft,
    addColumnOpen,
    adapter,
    capabilities.canAddColumns,
    capabilities.canChangeColumnTypes,
    capabilities.canInsertColumns,
    capabilities.canRenameColumns,
    capabilities.canReorderColumns,
    capabilities.canResizeColumns,
    capabilities.canUpdateColumnOptions,
    columnMenuKey,
    handleChangeColumnType,
    handleInsertColumn,
    handleMoveColumn,
    handleReorderColumns,
    handleRenameColumn,
    handleUpdateColumnOptions,
    newRecordLabel,
    openRecord,
    pendingEdit,
    visibleGridColumns,
  ]);

  const emptyRecordLabel =
    recordCountLabel?.replace(/^\d+\s+/, "").trim() ||
    (recordTypeLabel
      ? `${recordTypeLabel.toLocaleLowerCase("en")}s`
      : "records");
  const displayedRecordCountLabel = normalizedRecordSearch
    ? `${visibleRows.length} of ${table.rows.length} ${emptyRecordLabel}`
    : viewPreview
      ? `${viewPreview.table.rows.length} of ${viewPreview.totalCount} ${emptyRecordLabel}`
      : (recordCountLabel ?? `${table.rows.length} ${emptyRecordLabel}`);
  const emptyRecordMessage =
    capabilities.rowCreation === "direct"
      ? "Start with the first record using the row below or the button above."
      : capabilities.rowCreation === "configured_form"
        ? "Records added through the configured creation screen will appear here."
        : (capabilities.rowCreationMessage ??
          "Records will appear here when they are available.");
  const noMatches = table.rows.length > 0 && visibleRows.length === 0;
  const bulkRows = useMemo(() => {
    if (!selectionAnchor) return [];
    const bounds = selectionBounds(
      selectionAnchor,
      selectionEnd ?? selectionAnchor,
    );
    return visibleRows.slice(bounds.startRow, bounds.endRow + 1);
  }, [selectionAnchor, selectionEnd, visibleRows]);
  const bulkSelection = useMemo(() => selectionForRows(bulkRows), [bulkRows]);
  const applyBulkUpdate = useCallback(
    async (
      fieldKey: string,
      value: EditorValue,
      records: readonly { recordId: string; expectedUpdatedAt: string }[],
    ): Promise<void> => {
      if (!bulkUpdate) return;
      const result = await bulkUpdate({ fieldKey, value, records });
      if (result.status === "error") throw new Error(result.message);
      const updated = new Map(result.value.map((row) => [row.id, row]));
      setTable((current) => ({
        ...current,
        rows: current.rows.map((row) => {
          const next = updated.get(row.id);
          return next
            ? {
                ...next,
                values: { ...row.values, ...next.values },
                ...(row.connectionValues
                  ? { connectionValues: row.connectionValues }
                  : {}),
              }
            : row;
        }),
      }));
      setSaveState({ status: "saved" });
    },
    [bulkUpdate],
  );
  const previewColumn = presentationTable.columns.find(
    (column) => column.preview,
  );

  return (
    <section
      className={`editor-kernel-page ${variant === "embedded" ? "editor-kernel-embedded" : "editor-kernel-workspace"}`}
      data-read-only={readOnly ? "true" : "false"}
      data-row-creation={capabilities.rowCreation}
    >
      <header className="editor-lab-header">
        <div className="editor-table-title-block">
          {marker}
          <TableTitleEditor
            displayTitle={title ?? table.name}
            enabled={capabilities.canRenameTable}
            name={table.name}
            onCommit={handleRenameTable}
          />
        </div>
        <div className="editor-lab-header-actions">
          <div
            className={`editor-save-state editor-save-${saveState.status}`}
            role="status"
          >
            <span className="editor-save-dot" aria-hidden="true" />
            {saveState.status === "error" && saveState.message
              ? saveState.message
              : statusLabel(saveState)}
            {saveState.status === "error" && retry ? (
              <span className="editor-save-recovery">
                <button
                  className="editor-retry-button"
                  onClick={() =>
                    commitCell(retry.rowId, retry.columnKey, retry.value, {
                      force: true,
                      previousValue: retry.previousValue,
                    })
                  }
                  type="button"
                >
                  Retry
                </button>
                <button
                  className="editor-retry-button"
                  onClick={() => {
                    setTable((current) => cancelFailedSave(current, retry));
                    setRetry(null);
                    setSaveState({ status: "saved" });
                    setRestoreCell({
                      rowId: retry.rowId,
                      columnKey: retry.columnKey,
                    });
                  }}
                  type="button"
                >
                  Cancel
                </button>
              </span>
            ) : null}
          </div>
        </div>
      </header>

      {headerContent ? (
        <div className="editor-header-content">{headerContent}</div>
      ) : null}

      <div className="editor-lab-meta">
        {variant === "workspace" && !serverSearchManaged ? (
          <label className="editor-table-search">
            <span>Search this Table</span>
            <input
              aria-label="Search this Table"
              onChange={(event) => setRecordSearch(event.currentTarget.value)}
              placeholder={`Search ${table.name}`}
              type="search"
              value={recordSearch}
            />
            {recordSearch ? (
              <button
                aria-label="Clear search"
                className="editor-table-search-clear"
                onClick={() => setRecordSearch("")}
                type="button"
              >
                Clear
              </button>
            ) : null}
          </label>
        ) : null}
        {!serverSearchManaged ? <span>{displayedRecordCountLabel}</span> : null}
        {viewPreview ? (
          <span className="editor-view-preview-state">
            Previewing unsaved View in this grid
          </span>
        ) : null}
        {omittedPropertyCount > 0 ? (
          <span className="editor-property-disclosure">
            Showing {visibleGridColumns.length} of {table.columns.length}{" "}
            properties · Open a Record to see all{" "}
            <button onClick={() => setShowAllProperties(true)} type="button">
              Show all properties
            </button>
          </span>
        ) : null}
        {showAllProperties && isCompactViewport ? (
          <span className="editor-property-disclosure">
            Showing all {table.columns.length} properties{" "}
            <button onClick={() => setShowAllProperties(false)} type="button">
              Show fewer
            </button>
          </span>
        ) : null}
        <span className="editor-lab-shortcut-hint">
          {readOnly
            ? "Select a Record to inspect its example details · Copy supported"
            : `${capabilities.canReorderColumns ? "Drag column headings to reorder · " : ""}Enter / double-click to edit · ⌘C / ⌘V supported`}
        </span>
        <div className="editor-lab-meta-actions">
          {capabilities.rowCreation === "direct" ? (
            <button
              className="editor-new-record-action"
              onClick={() => {
                setRecordSearch("");
                const primaryColumnIndex = table.columns.findIndex(
                  (column) => column.key === table.primaryColumnKey,
                );
                if (primaryColumnIndex >= 0) {
                  setDraftActivation({
                    rowIdx: table.rows.length,
                    columnIdx: primaryColumnIndex,
                  });
                }
              }}
              type="button"
            >
              <span aria-hidden="true">+</span>
              {newRecordLabel}
            </button>
          ) : creationFallbackHref ? (
            <a className="editor-new-record-action" href={creationFallbackHref}>
              <span aria-hidden="true">+</span>
              {newRecordLabel}
            </a>
          ) : null}
        </div>
      </div>

      {bulkUpdate && !readOnly ? (
        <TableBulkUpdateBar
          columns={table.columns}
          onApply={applyBulkUpdate}
          selection={bulkSelection}
        />
      ) : null}

      <div className="editor-lab-workspace">
        <div className="editor-grid-area">
          <div
            className="editor-grid-shell"
            onCopyCapture={handleCopyCapture}
            onPasteCapture={handlePasteCapture}
          >
            <div className="editor-desktop-grid">
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
                  if (column.key === editorAddPropertyColumnKey) {
                    return;
                  }
                  setPendingEdit(null);
                  if (row) {
                    setActiveCell({ rowId: row.id, columnKey: column.key });
                  }
                  const point = {
                    rowIndex: row
                      ? row.isDraft
                        ? visibleRows.length
                        : visibleRows.findIndex(
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
                rowClass={(row) =>
                  row.isDraft ? "editor-draft-row" : undefined
                }
                rowHeight={38}
                rowKeyGetter={(row) => row.id}
                rows={gridRows}
              />
              {table.rows.length === 0 ? (
                <div
                  className="editor-grid-empty"
                  data-testid="editor-grid-empty"
                  role="status"
                >
                  <span aria-hidden="true" className="editor-grid-empty-icon">
                    □
                  </span>
                  <strong>No {emptyRecordLabel} yet</strong>
                  <span>{emptyRecordMessage}</span>
                </div>
              ) : null}
              {noMatches ? (
                <div
                  className="editor-grid-empty editor-grid-no-matches"
                  data-testid="editor-grid-no-matches"
                  role="status"
                >
                  <strong>No matches</strong>
                  <span>Try a different search or clear search.</span>
                  <button
                    className="button-secondary button-small"
                    onClick={() => setRecordSearch("")}
                    type="button"
                  >
                    Clear search
                  </button>
                </div>
              ) : null}
            </div>
            <EditorMobileRecordList
              columns={recordColumns}
              emptyMessage={emptyRecordMessage}
              emptyRecordLabel={emptyRecordLabel}
              noMatches={noMatches}
              onClearSearch={() => setRecordSearch("")}
              onOpenRecord={openRecord}
              {...(previewColumn ? { previewColumn } : {})}
              rows={visibleRows}
              tableName={table.name}
            />
            {capabilities.canAddColumns ? (
              <>
                {addColumnOpen ? (
                  <AddColumnPopover
                    anchorRef={addColumnButtonRef}
                    canAddConnections={capabilities.canAddConnections !== false}
                    {...(connectionSource ? { connectionSource } : {})}
                    {...(connectionTargets ? { connectionTargets } : {})}
                    {...(existingConnections ? { existingConnections } : {})}
                    columns={table.columns}
                    draft={propertyDraft ?? initialPropertyDraft()}
                    onClose={() => {
                      setPropertyDraft(null);
                      setConnectionDraft(null);
                      setAddColumnOpen(false);
                    }}
                    onCreate={handleCreateProperty}
                    onConnectionDraftChange={setConnectionDraft}
                    onDraftChange={setPropertyDraft}
                    {...(structuralError
                      ? { externalError: structuralError }
                      : {})}
                    {...(onStructureChanged
                      ? {
                          onRefresh: () => {
                            setStructuralError(null);
                            onStructureChanged();
                          },
                        }
                      : {})}
                    tableName={table.name}
                    {...(onCreateConnection
                      ? { onCreateConnection: handleCreateConnection }
                      : {})}
                    {...(onAddExistingConnection
                      ? {
                          onAddExistingConnection: handleAddExistingConnection,
                        }
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
            {...(panelEditingKey && !connectedPanel
              ? { initialEditingColumnKey: panelEditingKey }
              : {})}
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
            {...(loadContextualRecordCreate && createContextualRecord
              ? { onAddRelatedRecord: beginContextualRecordCreate }
              : {})}
            {...(panelStatusLabel !== undefined
              ? { statusLabel: panelStatusLabel }
              : {})}
            {...(connectedPanel
              ? createConnectedRecordTarget
                ? { onCreateConnectionTarget: createPanelConnectionTarget }
                : {}
              : adapter.createConnectionTarget
                ? {
                    onCreateConnectionTarget: (
                      columnKey: string,
                      primaryValue: string,
                    ) =>
                      adapter.createConnectionTarget!(columnKey, primaryValue),
                  }
                : {})}
            row={activePanel.row}
            {...(activePanel.recordTypeLabel !== undefined
              ? { recordTypeLabel: activePanel.recordTypeLabel }
              : {})}
            tableName={activePanel.tableName}
          />
        ) : null}
        {contextualCreate ? (
          <ContextualRecordCreateDialog
            onClose={() => setContextualCreate(null)}
            onSave={saveContextualRecordCreate}
            onSearchConnectionTargets={(columnKey, search) =>
              searchConnectedRecordTargets
                ? searchConnectedRecordTargets(
                    {
                      ...contextualCreate.context,
                      viewKey: contextualCreate.state.targetViewKey,
                    },
                    columnKey,
                    search,
                  )
                : Promise.resolve([])
            }
            state={contextualCreate.state}
          />
        ) : null}
      </div>
      {shortcutOpen ? (
        <ShortcutSheet onClose={() => setShortcutOpen(false)} />
      ) : null}
    </section>
  );
}
