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
  onRenameColumn: (columnKey: string, label: string) => Promise<boolean>;
  onUpdateColumnOptions: (
    columnKey: string,
    options: readonly string[],
  ) => Promise<boolean>;
  onOpenRecord: (rowId: string, columnKey: string) => void;
  onActivateDraft: (rowIdx: number, columnIdx: number) => void;
  canRenameColumns?: boolean;
  canUpdateColumnOptions?: boolean;
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
  isOpen,
  onOpen,
  onRename,
  onUpdateOptions,
}: Readonly<{
  column: EditorColumn;
  canRename: boolean;
  canUpdateOptions: boolean;
  isOpen: boolean;
  onOpen: () => void;
  onRename: (label: string) => Promise<boolean>;
  onUpdateOptions: (options: readonly string[]) => Promise<boolean>;
}>): React.ReactNode {
  const canChangeOptions = column.kind === "select" || column.kind === "status";
  return (
    <div className="editor-header-cell">
      <span className="editor-header-label">{column.label}</span>
      {canRename || (canUpdateOptions && canChangeOptions) ? (
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
              canRename={canRename}
              canUpdateOptions={canUpdateOptions}
              column={column}
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
  canUpdateOptions,
  column,
  onRename,
  onUpdateOptions,
}: Readonly<{
  canRename: boolean;
  canUpdateOptions: boolean;
  column: EditorColumn;
  onRename: (label: string) => Promise<boolean>;
  onUpdateOptions: (options: readonly string[]) => Promise<boolean>;
}>): React.ReactNode {
  const [label, setLabel] = useState(column.label);
  const [optionsText, setOptionsText] = useState(
    (column.options ?? []).join("\n"),
  );
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const canChangeOptions =
    canUpdateOptions && (column.kind === "select" || column.kind === "status");

  const parsedOptions = (): string[] =>
    optionsText
      .split("\n")
      .map((option) => option.trim())
      .filter(Boolean);

  return (
    <form
      className="editor-column-menu"
      onClick={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        const next = label.trim();
        if (!canRename || !next || submitting) {
          return;
        }
        setSubmitting(true);
        void onRename(next).finally(() => setSubmitting(false));
      }}
    >
      {canRename ? (
        <>
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
        </>
      ) : null}
      {canChangeOptions ? (
        <div className="editor-column-options-form">
          <label>
            Options
            <textarea
              onChange={(event) => setOptionsText(event.currentTarget.value)}
              rows={4}
              value={optionsText}
            />
          </label>
          <button
            className="editor-menu-submit"
            disabled={submitting}
            onClick={() => {
              const options = parsedOptions();
              const normalized = options.map((option) =>
                option.normalize("NFKC").toLocaleLowerCase("en"),
              );
              if (
                options.length < 2 ||
                new Set(normalized).size !== normalized.length
              ) {
                setOptionsError("Use two or more different options.");
                return;
              }
              setOptionsError(null);
              setSubmitting(true);
              void onUpdateOptions(options).finally(() => setSubmitting(false));
            }}
            type="button"
          >
            {submitting ? "Saving…" : "Save options"}
          </button>
          {optionsError ? (
            <span className="editor-structural-error" role="alert">
              {optionsError}
            </span>
          ) : null}
        </div>
      ) : null}
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
  onRenameColumn,
  onUpdateColumnOptions,
  onOpenRecord,
  onActivateDraft,
  canRenameColumns = true,
  canUpdateColumnOptions = true,
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
        isOpen={columnMenuKey === column.key}
        onOpen={() => onOpenColumnMenu(column.key)}
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
