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
  type EditorRow,
  type EditorValue,
} from "./contracts";
import { CellEditor } from "./cell-editors";

export interface PendingEdit {
  rowId: string;
  columnKey: string;
  value: EditorValue;
}

interface CreateEditorColumnsOptions {
  columns: readonly EditorColumn[];
  columnMenuKey: string | null;
  onOpenColumnMenu: (columnKey: string) => void;
  onRenameColumn: (columnKey: string, label: string) => Promise<void>;
  onOpenRecord: (rowId: string, columnKey: string) => void;
  onActivateDraft: (rowIdx: number, columnIdx: number) => void;
  pendingEdit: PendingEdit | null;
}

function valueForRow(row: EditorRow, column: EditorColumn): EditorValue {
  return row.values[column.key] ?? null;
}

function HeaderCell({
  column,
  isOpen,
  onOpen,
  onRename,
}: Readonly<{
  column: EditorColumn;
  isOpen: boolean;
  onOpen: () => void;
  onRename: (label: string) => Promise<void>;
}>): React.ReactNode {
  return (
    <div className="editor-header-cell">
      <span className="editor-header-label">{column.label}</span>
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
      {isOpen ? <ColumnMenu column={column} onRename={onRename} /> : null}
    </div>
  );
}

function ColumnMenu({
  column,
  onRename,
}: Readonly<{
  column: EditorColumn;
  onRename: (label: string) => Promise<void>;
}>): React.ReactNode {
  const [label, setLabel] = useState(column.label);
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      className="editor-column-menu"
      onClick={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        const next = label.trim();
        if (!next || submitting) {
          return;
        }
        setSubmitting(true);
        void onRename(next).finally(() => setSubmitting(false));
      }}
    >
      <label>
        Rename column
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
    return column.primary ? (
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
  if (column.kind === "boolean") {
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

  const content = (
    <span
      className={column.kind === "status" ? "editor-status-pill" : undefined}
    >
      {displayEditorValue(column, value)}
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
  onRenameColumn,
  onOpenRecord,
  onActivateDraft,
  pendingEdit,
}: CreateEditorColumnsOptions): readonly Column<EditorRow>[] {
  return columns.map((column) => ({
    key: column.key,
    name: column.label,
    width: column.width,
    minWidth: 128,
    maxWidth: 640,
    resizable: true,
    draggable: true,
    frozen: column.primary,
    editable: (row: EditorRow) => !row.isDraft || Boolean(column.primary),
    renderHeaderCell: () => (
      <HeaderCell
        column={column}
        isOpen={columnMenuKey === column.key}
        onOpen={() => onOpenColumnMenu(column.key)}
        onRename={(label) => onRenameColumn(column.key, label)}
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
