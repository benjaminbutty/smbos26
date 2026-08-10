import { useState } from "react";
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
  ) => Promise<boolean>;
  onInsertColumn?: (
    anchorColumnKey: string,
    position: "left" | "right",
    input: {
      label: string;
      kind: EditorColumnKind;
      options?: readonly string[];
    },
  ) => Promise<boolean>;
  onMoveColumn?: (columnKey: string, direction: "left" | "right") => void;
  onOpenRecord: (rowId: string, columnKey: string) => void;
  onActivateDraft: (rowIdx: number, columnIdx: number) => void;
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

function HeaderCell({
  column,
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
      ) => Promise<boolean>)
    | undefined;
  onInsert:
    | ((
        position: "left" | "right",
        input: {
          label: string;
          kind: EditorColumnKind;
          options?: readonly string[];
        },
      ) => Promise<boolean>)
    | undefined;
  onMove: ((direction: "left" | "right") => void) | undefined;
}>): React.ReactNode {
  const canChangeOptions = column.kind === "select" || column.kind === "status";
  return (
    <div className="editor-header-cell">
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
            tabIndex={-1}
            type="button"
          >
            ···
          </button>
          {isOpen ? (
            <ColumnMenu
              canChangeType={canChangeType}
              canInsert={canInsert}
              canRename={canRename}
              canUpdateOptions={canUpdateOptions}
              column={column}
              onChangeType={onChangeType}
              onClose={onClose}
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
  canRename: boolean;
  canChangeType: boolean;
  canInsert: boolean;
  canUpdateOptions: boolean;
  column: EditorColumn;
  onChangeType:
    | ((
        kind: EditorColumnKind,
        options?: readonly string[],
      ) => Promise<boolean>)
    | undefined;
  onInsert:
    | ((
        position: "left" | "right",
        input: {
          label: string;
          kind: EditorColumnKind;
          options?: readonly string[];
        },
      ) => Promise<boolean>)
    | undefined;
  onMove: ((direction: "left" | "right") => void) | undefined;
  onRename: (label: string) => Promise<boolean>;
  onUpdateOptions: (options: readonly string[]) => Promise<boolean>;
  onClose: () => void;
}>): React.ReactNode {
  const [label, setLabel] = useState(column.label);
  const [options, setOptions] = useState<string[]>([
    ...(column.options ?? ["Option 1", "Option 2"]),
  ]);
  const [kind, setKind] = useState<EditorColumnKind>(column.kind);
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
    <Popover className="editor-column-menu" onClose={onClose}>
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
          <OptionManager
            onChange={(next) => setOptions([...next])}
            options={options}
          />
          <button
            className="editor-menu-submit"
            disabled={submitting}
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
  }) => Promise<boolean>;
}>): React.ReactNode {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<EditorColumnKind>("text");
  const [options, setOptions] = useState<string[]>(["Option 1", "Option 2"]);
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
  onActivate,
  rowIdx,
}: Readonly<{
  columnIdx: number;
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
      <span>New record</span>
    </button>
  );
}

export function EditorCell({
  column,
  onOpenRecord,
  onActivateDraft,
  props,
}: Readonly<{
  column: EditorColumn;
  onOpenRecord: (rowId: string, columnKey: string) => void;
  onActivateDraft: (rowIdx: number, columnIdx: number) => void;
  props: RenderCellProps<EditorRow>;
}>): React.ReactNode {
  const { row, rowIdx, tabIndex, onRowChange } = props;
  if (row.isDraft) {
    return column.primary && column.editable !== false ? (
      <NewRecordCell
        columnIdx={props.column.idx}
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
          ? "editor-status-pill"
          : undefined
      }
    >
      {column.kind === "url" &&
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
  onOpenColumnMenu,
  onCloseColumnMenu,
  onRenameColumn,
  onUpdateColumnOptions,
  onChangeColumnType,
  onInsertColumn,
  onMoveColumn,
  onOpenRecord,
  onActivateDraft,
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
    resizable: canResizeColumns,
    draggable: canReorderColumns,
    frozen: column.primary,
    editable: (row: EditorRow) =>
      column.editable !== false && (!row.isDraft || Boolean(column.primary)),
    renderHeaderCell: () => (
      <HeaderCell
        column={column}
        canRename={canRenameColumns}
        canUpdateOptions={canUpdateColumnOptions}
        canChangeType={canChangeColumnTypes}
        canInsert={canInsertColumns}
        isOpen={columnMenuKey === column.key}
        onOpen={() => onOpenColumnMenu(column.key)}
        onClose={() => onCloseColumnMenu?.()}
        onChangeType={
          onChangeColumnType
            ? (kind, options) => onChangeColumnType(column.key, kind, options)
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
        onActivateDraft={onActivateDraft}
        onOpenRecord={onOpenRecord}
        props={props}
      />
    ),
    renderEditCell: (props: RenderEditCellProps<EditorRow>) => (
      <CellEditor
        {...props}
        columnDefinition={column}
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
