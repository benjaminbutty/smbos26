import { useRef, useState, type RefObject } from "react";
import type {
  Column,
  RenderCellProps,
  RenderEditCellProps,
} from "react-data-grid";

import {
  displayEditorValue,
  editorInputValue,
  type EditorColumn,
  type EditorColumnKind,
  type EditorRow,
  type EditorValue,
} from "./contracts";
import { CellEditor } from "./cell-editors";
import {
  Menu,
  OptionManager,
  Popover,
  ShortcutSheet,
  TypePicker,
} from "./lenni-ui";

export interface PendingEdit {
  rowId: string;
  columnKey: string;
  value: EditorValue;
}

interface CreateEditorColumnsOptions {
  columns: readonly EditorColumn[];
  columnMenuKey: string | null;
  newRecordLabel?: string;
  onOpenColumnMenu: (columnKey: string) => void;
  onCloseColumnMenu?: () => void;
  onRenameColumn: (columnKey: string, label: string) => Promise<boolean>;
  onUpdateColumnOptions: (
    columnKey: string,
    options: readonly string[],
  ) => Promise<boolean>;
  onChangeColumnType?: (
    columnKey: string,
    kind: EditorColumnKind,
    options?: readonly string[],
    currency?: string,
  ) => Promise<boolean>;
  onInsertColumn?: (
    anchorColumnKey: string,
    position: "left" | "right",
    input: {
      label: string;
      kind: EditorColumnKind;
      options?: readonly string[];
      currency?: string;
    },
  ) => Promise<boolean>;
  onMoveColumn?: (columnKey: string, direction: "left" | "right") => void;
  onOpenRecord: (rowId: string, columnKey: string) => void;
  onActivateDraft: (rowIdx: number, columnIdx: number) => void;
  onSearchConnectionTargets?: (
    columnKey: string,
    search: string,
  ) => Promise<readonly { id: string; label: string }[]>;
  onCreateConnectionTarget?: (
    columnKey: string,
    primaryValue: string,
  ) => Promise<{ id: string; label: string }>;
  canRenameColumns?: boolean;
  canUpdateColumnOptions?: boolean;
  canChangeColumnTypes?: boolean;
  canInsertColumns?: boolean;
  canReorderColumns?: boolean;
  canResizeColumns?: boolean;
  pendingEdit: PendingEdit | null;
}

function valueForRow(row: EditorRow, column: EditorColumn): EditorValue {
  return row.values[column.key] ?? null;
}

function connectionContent(
  row: EditorRow,
  column: EditorColumn,
): React.ReactNode {
  const labels = row.connectionValues?.[column.key] ?? [];
  if (labels.length === 0) {
    return <span className="editor-connection-empty">—</span>;
  }
  const visibleLabels = labels.slice(0, column.connection?.multiple ? 2 : 1);
  const hiddenLabelCount = labels.length - visibleLabels.length;
  return (
    <span
      className="editor-table-connection-values"
      title={labels.map((item) => item.label).join(", ")}
    >
      {visibleLabels.map((item, index) => (
        <span className="editor-table-connection-value" key={item.id}>
          {index > 0 ? ", " : null}
          {item.label}
        </span>
      ))}
      {hiddenLabelCount > 0 ? (
        <span className="editor-table-connection-summary">
          +{hiddenLabelCount}
        </span>
      ) : null}
    </span>
  );
}

export function editorColumnKindIcon(kind: EditorColumnKind): string {
  switch (kind) {
    case "text":
      return "Aa";
    case "long_text":
      return "¶";
    case "number":
      return "#";
    case "currency":
      return "£";
    case "boolean":
      return "✓";
    case "date":
      return "◫";
    case "datetime":
      return "◷";
    case "email":
      return "@";
    case "phone":
      return "☎";
    case "url":
      return "↗";
    case "select":
      return "◉";
    case "multi_select":
      return "◎";
    case "status":
      return "●";
    case "connection":
      return "↔";
    case "file":
      return "▧";
  }
}

export function openConnectionCellEditor(
  column: EditorColumn | undefined,
  row: EditorRow,
  selectCell: (enableEditor?: boolean) => void,
): void {
  if (
    !column ||
    column.kind !== "connection" ||
    column.editable === false ||
    row.isDraft
  ) {
    return;
  }
  selectCell(true);
}

function HeaderCell({
  column,
  canReorder,
  canRename,
  canUpdateOptions,
  canChangeType,
  canInsert,
  isOpen,
  onOpen,
  onClose,
  onRename,
  onUpdateOptions,
  onChangeType,
  onInsert,
  onMove,
}: Readonly<{
  column: EditorColumn;
  canReorder: boolean;
  canRename: boolean;
  canUpdateOptions: boolean;
  canChangeType: boolean;
  canInsert: boolean;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onRename: (label: string) => Promise<boolean>;
  onUpdateOptions: (options: readonly string[]) => Promise<boolean>;
  onChangeType:
    | ((
        kind: EditorColumnKind,
        options?: readonly string[],
        currency?: string,
      ) => Promise<boolean>)
    | undefined;
  onInsert:
    | ((
        position: "left" | "right",
        input: {
          label: string;
          kind: EditorColumnKind;
          options?: readonly string[];
          currency?: string;
        },
      ) => Promise<boolean>)
    | undefined;
  onMove: ((direction: "left" | "right") => void) | undefined;
}>): React.ReactNode {
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const canChangeOptions = column.kind === "select" || column.kind === "status";
  const closeMenu = (): void => {
    onClose();
    window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  };
  return (
    <div
      className={`editor-header-cell${canReorder ? " is-reorderable" : ""}`}
      data-reorderable={canReorder ? "true" : "false"}
      data-editor-column-key={column.key}
      data-preview-column={column.preview ? "true" : undefined}
      ref={anchorRef}
      title={canReorder ? "Drag to reorder column" : undefined}
    >
      {canReorder ? (
        <span aria-hidden="true" className="editor-column-drag-affordance">
          ⋮⋮
        </span>
      ) : null}
      <span
        aria-hidden="true"
        className={`editor-header-type-icon is-${column.kind}`}
        title={`${column.kind.replaceAll("_", " ")} property`}
      >
        {editorColumnKindIcon(column.kind)}
      </span>
      <span className="editor-header-label">{column.label}</span>
      {canRename ||
      canChangeType ||
      canInsert ||
      (canUpdateOptions && canChangeOptions) ? (
        <>
          <button
            aria-expanded={isOpen}
            aria-label={`Column menu for ${column.label}`}
            className="editor-header-menu-button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
            ref={menuButtonRef}
            tabIndex={0}
            type="button"
          >
            ···
          </button>
          {isOpen ? (
            <ColumnMenu
              anchorRef={anchorRef}
              canChangeType={canChangeType}
              canInsert={canInsert}
              canRename={canRename}
              canUpdateOptions={canUpdateOptions}
              column={column}
              onChangeType={onChangeType}
              onClose={closeMenu}
              onInsert={onInsert}
              onMove={onMove}
              onRename={onRename}
              onUpdateOptions={onUpdateOptions}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function ColumnMenu({
  anchorRef,
  canRename,
  canChangeType,
  canInsert,
  canUpdateOptions,
  column,
  onChangeType,
  onClose,
  onInsert,
  onMove,
  onRename,
  onUpdateOptions,
}: Readonly<{
  anchorRef: RefObject<HTMLDivElement | null>;
  canRename: boolean;
  canChangeType: boolean;
  canInsert: boolean;
  canUpdateOptions: boolean;
  column: EditorColumn;
  onChangeType:
    | ((
        kind: EditorColumnKind,
        options?: readonly string[],
        currency?: string,
      ) => Promise<boolean>)
    | undefined;
  onInsert:
    | ((
        position: "left" | "right",
        input: {
          label: string;
          kind: EditorColumnKind;
          options?: readonly string[];
          currency?: string;
        },
      ) => Promise<boolean>)
    | undefined;
  onMove: ((direction: "left" | "right") => void) | undefined;
  onRename: (label: string) => Promise<boolean>;
  onUpdateOptions: (options: readonly string[]) => Promise<boolean>;
  onClose: () => void;
}>): React.ReactNode {
  const [label, setLabel] = useState(column.label);
  const [options, setOptions] = useState<string[]>(() =>
    column.options !== undefined
      ? [...column.options]
      : column.kind === "select" || column.kind === "status"
        ? []
        : ["Option 1", "Option 2"],
  );
  const [kind, setKind] = useState<EditorColumnKind>(column.kind);
  const [currency, setCurrency] = useState(column.currency ?? "GBP");
  const [mode, setMode] = useState<
    | "main"
    | "rename"
    | "type"
    | "options"
    | "insert-left"
    | "insert-right"
    | "shortcuts"
  >("main");
  const [submitting, setSubmitting] = useState(false);
  const canChangeOptions =
    canUpdateOptions && (column.kind === "select" || column.kind === "status");
  const validOptions = (values: readonly string[]): boolean => {
    const normalized = values
      .map((option) => option.trim())
      .filter(Boolean)
      .map((option) => option.normalize("NFKC").toLocaleLowerCase("en"));
    return (
      normalized.length >= 2 && new Set(normalized).size === normalized.length
    );
  };

  return (
    <Popover
      anchorRef={anchorRef}
      className="editor-column-menu"
      onClose={onClose}
      viewportSafe
    >
      {mode === "main" ? (
        <Menu>
          <div className="editor-column-menu-title">{column.label}</div>
          {canRename ? (
            <button
              onClick={() => setMode("rename")}
              role="menuitem"
              type="button"
            >
              Rename property
            </button>
          ) : null}
          {canChangeType && onChangeType ? (
            <button
              onClick={() => setMode("type")}
              role="menuitem"
              type="button"
            >
              Change type
            </button>
          ) : null}
          {canChangeOptions ? (
            <button
              onClick={() => setMode("options")}
              role="menuitem"
              type="button"
            >
              Edit options
            </button>
          ) : null}
          {canInsert && onInsert ? (
            <>
              <button
                onClick={() => setMode("insert-left")}
                role="menuitem"
                type="button"
              >
                Insert property left
              </button>
              <button
                onClick={() => setMode("insert-right")}
                role="menuitem"
                type="button"
              >
                Insert property right
              </button>
            </>
          ) : null}
          {onMove ? (
            <>
              <button
                onClick={() => onMove("left")}
                role="menuitem"
                type="button"
              >
                Move left
              </button>
              <button
                onClick={() => onMove("right")}
                role="menuitem"
                type="button"
              >
                Move right
              </button>
            </>
          ) : null}
          <button
            onClick={() => setMode("shortcuts")}
            role="menuitem"
            type="button"
          >
            Keyboard shortcuts
          </button>
        </Menu>
      ) : null}
      {mode === "rename" ? (
        <form
          className="editor-column-menu-form"
          onSubmit={(event) => {
            event.preventDefault();
            const next = label.trim();
            if (!next || submitting) return;
            setSubmitting(true);
            void onRename(next).finally(() => setSubmitting(false));
          }}
        >
          <label>
            Property name
            <input
              autoFocus
              maxLength={80}
              onChange={(event) => setLabel(event.currentTarget.value)}
              value={label}
            />
          </label>
          <button
            className="editor-menu-submit"
            disabled={submitting}
            type="submit"
          >
            {submitting ? "Renaming…" : "Rename"}
          </button>
        </form>
      ) : null}
      {mode === "type" && onChangeType ? (
        <div className="editor-column-menu-form">
          {column.primary ? (
            <p className="editor-property-type-note">
              The primary property names each Record, so it stays Text or Long
              text.
            </p>
          ) : null}
          <TypePicker
            {...(column.primary
              ? { allowedKinds: ["text", "long_text"] as const }
              : {})}
            onChange={setKind}
            value={kind}
          />
          {kind === "select" || kind === "status" ? (
            <OptionManager
              onChange={(next) => setOptions([...next])}
              options={options}
            />
          ) : null}
          {kind === "currency" ? (
            <label>
              Currency
              <select
                aria-label="Currency"
                onChange={(event) => setCurrency(event.currentTarget.value)}
                value={currency}
              >
                <option value="GBP">UK pounds (GBP)</option>
                <option value="EUR">Euros (EUR)</option>
                <option value="USD">US dollars (USD)</option>
              </select>
            </label>
          ) : null}
          <button
            className="editor-menu-submit"
            disabled={submitting}
            onClick={() => {
              if (
                (kind === "select" || kind === "status") &&
                !validOptions(options)
              )
                return;
              setSubmitting(true);
              void onChangeType(
                kind,
                kind === "select" || kind === "status" ? options : undefined,
                kind === "currency" ? currency : undefined,
              ).finally(() => setSubmitting(false));
            }}
            type="button"
          >
            {submitting ? "Saving…" : "Save type"}
          </button>
        </div>
      ) : null}
      {mode === "options" && canChangeOptions ? (
        <div className="editor-column-menu-form">
          {options.length === 0 ? (
            <p className="editor-options-empty-state">
              No options yet. Add at least two options to use this property.
            </p>
          ) : null}
          <OptionManager
            onChange={(next) => setOptions([...next])}
            options={options}
          />
          <button
            className="editor-menu-submit"
            disabled={submitting || !validOptions(options)}
            onClick={() => {
              if (!validOptions(options)) return;
              setSubmitting(true);
              void onUpdateOptions(options).finally(() => setSubmitting(false));
            }}
            type="button"
          >
            {submitting ? "Saving…" : "Save options"}
          </button>
        </div>
      ) : null}
      {(mode === "insert-left" || mode === "insert-right") && onInsert ? (
        <InsertColumnForm
          onCancel={() => setMode("main")}
          onSubmit={(input) =>
            onInsert(mode === "insert-left" ? "left" : "right", input)
          }
        />
      ) : null}
      {mode === "shortcuts" ? (
        <ShortcutSheet onClose={() => setMode("main")} />
      ) : null}
      {mode !== "main" ? (
        <button
          className="editor-menu-back"
          onClick={() => setMode("main")}
          type="button"
        >
          Back
        </button>
      ) : null}
    </Popover>
  );
}

function InsertColumnForm({
  onCancel,
  onSubmit,
}: Readonly<{
  onCancel: () => void;
  onSubmit: (input: {
    label: string;
    kind: EditorColumnKind;
    options?: readonly string[];
    currency?: string;
  }) => Promise<boolean>;
}>): React.ReactNode {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<EditorColumnKind>("text");
  const [options, setOptions] = useState<string[]>(["Option 1", "Option 2"]);
  const [currency, setCurrency] = useState("GBP");
  const [submitting, setSubmitting] = useState(false);
  return (
    <form
      className="editor-column-menu-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!label.trim() || submitting) return;
        setSubmitting(true);
        void onSubmit({
          label,
          kind,
          ...(kind === "select" || kind === "status" ? { options } : {}),
          ...(kind === "currency" ? { currency } : {}),
        }).finally(() => setSubmitting(false));
      }}
    >
      <label>
        Property name
        <input
          autoFocus
          onChange={(event) => setLabel(event.currentTarget.value)}
          value={label}
        />
      </label>
      <TypePicker onChange={setKind} value={kind} />
      {kind === "select" || kind === "status" ? (
        <OptionManager
          onChange={(next) => setOptions([...next])}
          options={options}
        />
      ) : null}
      {kind === "currency" ? (
        <label>
          Currency
          <select
            aria-label="Currency"
            onChange={(event) => setCurrency(event.currentTarget.value)}
            value={currency}
          >
            <option value="GBP">UK pounds (GBP)</option>
            <option value="EUR">Euros (EUR)</option>
            <option value="USD">US dollars (USD)</option>
          </select>
        </label>
      ) : null}
      <button
        className="editor-menu-submit"
        disabled={submitting}
        type="submit"
      >
        {submitting ? "Adding…" : "Insert property"}
      </button>
      <button onClick={onCancel} type="button">
        Cancel
      </button>
    </form>
  );
}

function NewRecordCell({
  columnIdx,
  label,
  onActivate,
  rowIdx,
}: Readonly<{
  columnIdx: number;
  label: string;
  onActivate: (rowIdx: number, columnIdx: number) => void;
  rowIdx: number;
}>): React.ReactNode {
  return (
    <button
      aria-label="New record"
      className="editor-new-record-trigger"
      data-testid="new-record-trigger"
      onClick={() => onActivate(rowIdx, columnIdx)}
      tabIndex={-1}
      type="button"
    >
      <span aria-hidden="true" className="editor-new-record-plus">
        +
      </span>
      <span>{label}</span>
    </button>
  );
}

export function EditorCell({
  column,
  newRecordLabel = "New record",
  onOpenRecord,
  onActivateDraft,
  props,
}: Readonly<{
  column: EditorColumn;
  newRecordLabel?: string;
  onOpenRecord: (rowId: string, columnKey: string) => void;
  onActivateDraft: (rowIdx: number, columnIdx: number) => void;
  onSearchConnectionTargets?: (
    columnKey: string,
    search: string,
  ) => Promise<readonly { id: string; label: string }[]>;
  props: RenderCellProps<EditorRow>;
}>): React.ReactNode {
  const { row, rowIdx, tabIndex, onRowChange } = props;
  if (column.preview) {
    return (
      <div className="editor-preview-cell" data-testid="proposed-property-cell">
        <span>Empty</span>
        <small>Not added yet</small>
      </div>
    );
  }
  if (row.isDraft) {
    return column.primary && column.editable !== false ? (
      <NewRecordCell
        columnIdx={props.column.idx}
        label={newRecordLabel}
        onActivate={onActivateDraft}
        rowIdx={rowIdx}
      />
    ) : (
      <span>—</span>
    );
  }

  const value = valueForRow(row, column);
  if (column.kind === "boolean" && column.editable !== false) {
    return (
      <input
        aria-label={`${column.label} for ${editorInputValue(
          row.values.name ?? null,
        )}`}
        checked={value === true}
        className="editor-inline-checkbox"
        onChange={(event) => {
          onRowChange({
            ...row,
            values: {
              ...row.values,
              [column.key]: event.currentTarget.checked,
            },
          });
        }}
        tabIndex={tabIndex}
        type="checkbox"
      />
    );
  }

  const display = displayEditorValue(column, value);
  const content = (
    <span
      className={
        column.kind === "status" || column.kind === "select"
          ? "editor-status-pill editor-status-pill-neutral"
          : undefined
      }
    >
      {column.kind === "connection" ? (
        connectionContent(row, column)
      ) : column.kind === "url" &&
        typeof value === "string" &&
        /^https?:\/\/\S+$/i.test(value) ? (
        <a href={value} rel="noreferrer" target="_blank">
          {display}
        </a>
      ) : column.kind === "email" && typeof value === "string" ? (
        <a href={`mailto:${value}`}>{display}</a>
      ) : column.kind === "phone" && typeof value === "string" ? (
        <a href={`tel:${value}`}>{display}</a>
      ) : (
        display
      )}
    </span>
  );

  return (
    <div className="editor-cell-content">
      {column.primary ? (
        <>
          <span className="editor-primary-value">{content}</span>
          <button
            aria-label={`Open record ${editorInputValue(value)}`}
            className="editor-open-record-button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenRecord(row.id, column.key);
            }}
            tabIndex={-1}
            type="button"
          >
            ↗
          </button>
        </>
      ) : (
        content
      )}
    </div>
  );
}

export function createEditorColumns({
  columns,
  columnMenuKey,
  newRecordLabel = "New record",
  onOpenColumnMenu,
  onCloseColumnMenu,
  onRenameColumn,
  onUpdateColumnOptions,
  onChangeColumnType,
  onInsertColumn,
  onMoveColumn,
  onOpenRecord,
  onActivateDraft,
  onSearchConnectionTargets,
  onCreateConnectionTarget,
  canRenameColumns = true,
  canUpdateColumnOptions = true,
  canChangeColumnTypes = true,
  canInsertColumns = true,
  canReorderColumns = true,
  canResizeColumns = true,
  pendingEdit,
}: CreateEditorColumnsOptions): readonly Column<EditorRow>[] {
  return columns.map((column) => ({
    key: column.key,
    name: column.label,
    width: column.width,
    minWidth: 128,
    maxWidth: 640,
    resizable: canResizeColumns && !column.preview,
    draggable: canReorderColumns && !column.preview,
    frozen: column.primary,
    editable: (row: EditorRow) =>
      !column.preview &&
      column.editable !== false &&
      (!row.isDraft || Boolean(column.primary)),
    ...(column.kind === "connection" ||
    column.kind === "select" ||
    column.kind === "status"
      ? { editorOptions: { commitOnOutsideClick: false } }
      : {}),
    renderHeaderCell: () => (
      <HeaderCell
        column={column}
        canReorder={canReorderColumns && !column.preview}
        canRename={canRenameColumns && !column.preview}
        canUpdateOptions={canUpdateColumnOptions && !column.preview}
        canChangeType={canChangeColumnTypes && !column.preview}
        canInsert={canInsertColumns && !column.preview}
        isOpen={columnMenuKey === column.key}
        onOpen={() => onOpenColumnMenu(column.key)}
        onClose={() => onCloseColumnMenu?.()}
        onChangeType={
          onChangeColumnType
            ? (kind, options, currency) =>
                onChangeColumnType(column.key, kind, options, currency)
            : undefined
        }
        onInsert={
          onInsertColumn
            ? (position, input) => onInsertColumn(column.key, position, input)
            : undefined
        }
        onMove={
          onMoveColumn
            ? (direction) => onMoveColumn(column.key, direction)
            : undefined
        }
        onRename={(label) => onRenameColumn(column.key, label)}
        onUpdateOptions={(options) =>
          onUpdateColumnOptions(column.key, options)
        }
      />
    ),
    renderCell: (props: RenderCellProps<EditorRow>) => (
      <EditorCell
        column={column}
        newRecordLabel={newRecordLabel}
        onActivateDraft={onActivateDraft}
        onOpenRecord={onOpenRecord}
        props={props}
      />
    ),
    renderEditCell: (props: RenderEditCellProps<EditorRow>) => (
      <CellEditor
        {...props}
        columnDefinition={column}
        onCreateConnectionTarget={onCreateConnectionTarget}
        onSearchConnectionTargets={onSearchConnectionTargets}
        initialValue={
          pendingEdit?.rowId === props.row.id &&
          pendingEdit.columnKey === column.key
            ? pendingEdit.value
            : undefined
        }
      />
    ),
  }));
}
