"use client";

import Link from "next/link";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import type { ExperienceViewBundle } from "../../core/experience/service";
import {
  directTableEditableFieldTypes,
  isDirectTableEditableFieldType,
} from "../../core/experience/inline-edit";
import type { TableViewConfig } from "../../core/experience/schemas";
import type { Json, Tables } from "../../db/supabase/database.types";
import { experienceKeyToPath } from "../routing";
import {
  FieldInputControl,
  FieldValue,
  fieldOptions,
} from "../fields/field-renderer";
import type {
  DirectTableCellActionState,
  DirectTableRowActionState,
} from "./direct-actions";
import {
  directTableCellNavigationTarget,
  directTableEditorKeyAction,
} from "./direct-table-interactions";
import {
  directTableFullRecordHref,
  directTableRecordPanelHref,
} from "./direct-table-state";

type StructuralAction = (formData: FormData) => Promise<never>;
type CellAction = (
  previousState: DirectTableCellActionState,
  formData: FormData,
) => Promise<DirectTableCellActionState>;
type RowAction = (
  previousState: DirectTableRowActionState,
  formData: FormData,
) => Promise<DirectTableRowActionState>;

interface Currentness {
  expectedBaseVersionId: string;
  expectedHeadRevision: number;
}

interface DirectTableWorkspaceProps {
  addColumnAction?: StructuralAction | undefined;
  bundle: ExperienceViewBundle;
  businessSlug: string;
  canManageConfiguration: boolean;
  createRowAction: RowAction;
  currentness: Currentness | null;
  recordId: string | null;
  rowCreation: {
    kind: "direct" | "configured_form" | "unavailable";
    message?: string;
  };
  renameColumnAction?: StructuralAction | undefined;
  renameTableAction?: StructuralAction | undefined;
  reorderColumnsAction?: StructuralAction | undefined;
  resizeColumnAction?: StructuralAction | undefined;
  selectedRecord: Tables<"records"> | null;
  undoAction?: StructuralAction | undefined;
  updateCellAction: CellAction;
  updateOptionsAction?: StructuralAction | undefined;
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

function configuredFields(
  bundle: ExperienceViewBundle,
): Tables<"field_definitions">[] {
  const config = bundle.config as TableViewConfig;
  const fieldsByKey = new Map(bundle.fields.map((field) => [field.key, field]));
  return config.fields.flatMap((fieldKey) => {
    const field = fieldsByKey.get(fieldKey);
    return field?.is_active ? [field] : [];
  });
}

function widthFor(
  config: TableViewConfig,
  fieldKey: string,
): number | undefined {
  return config.column_widths?.[fieldKey];
}

function currentnessFields(currentness: Currentness | null): ReactNode {
  return currentness ? (
    <>
      <input
        name="expectedBaseVersionId"
        type="hidden"
        value={currentness.expectedBaseVersionId}
      />
      <input
        name="expectedHeadRevision"
        type="hidden"
        value={currentness.expectedHeadRevision}
      />
    </>
  ) : null;
}

function EditableTableTitle({
  action,
  currentness,
  title,
  viewKey,
}: Readonly<{
  action?: StructuralAction | undefined;
  currentness: Currentness | null;
  title: string;
  viewKey: string;
}>): ReactNode {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  if (!action || !currentness) {
    return <h1 className="runtime-title">{title}</h1>;
  }

  if (!editing) {
    return (
      <button
        className="editable-workspace-title"
        onClick={() => setEditing(true)}
        type="button"
      >
        <span className="runtime-title">{title}</span>
        <span className="field-help">Change title</span>
      </button>
    );
  }

  return (
    <form
      action={action}
      className="workspace-title-form"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setValue(title);
          setEditing(false);
        }
      }}
    >
      {currentnessFields(currentness)}
      <input name="viewKey" type="hidden" value={viewKey} />
      <input
        ref={inputRef}
        aria-label="Table title"
        maxLength={120}
        minLength={1}
        name="title"
        onChange={(event) => setValue(event.target.value)}
        required
        onBlur={(event) => {
          const nextTitle = event.currentTarget.value.trim();
          if (nextTitle && nextTitle !== title) {
            event.currentTarget.form?.requestSubmit();
          } else if (!nextTitle || nextTitle === title) {
            setEditing(false);
          }
        }}
        value={value}
      />
      <span className="field-help">
        Press Enter or leave the field to save. Escape cancels.
      </span>
    </form>
  );
}

function ColumnHeaderControls({
  action,
  currentness,
  field,
  optionsAction,
  viewKey,
}: Readonly<{
  action?: StructuralAction | undefined;
  currentness: Currentness | null;
  field: Tables<"field_definitions">;
  optionsAction?: StructuralAction | undefined;
  viewKey: string;
}>): ReactNode {
  const [label, setLabel] = useState(field.label);
  const [optionsText, setOptionsText] = useState(
    fieldOptions(field).join("\n"),
  );
  const canChangeOptions =
    field.field_type === "select" || field.field_type === "status";

  if (!currentness || (!action && !(canChangeOptions && optionsAction))) {
    return null;
  }

  return (
    <details className="table-column-menu">
      <summary aria-label={`Column options for ${field.label}`}>•••</summary>
      <div className="table-column-menu-body">
        {action ? (
          <form action={action} className="stack-form">
            {currentnessFields(currentness)}
            <input name="viewKey" type="hidden" value={viewKey} />
            <input name="fieldKey" type="hidden" value={field.key} />
            <label>
              Column name
              <input
                maxLength={120}
                minLength={1}
                name="label"
                onChange={(event) => setLabel(event.target.value)}
                required
                value={label}
              />
            </label>
            <button type="submit">Rename column</button>
          </form>
        ) : null}
        {canChangeOptions && optionsAction ? (
          <form action={optionsAction} className="stack-form">
            {currentnessFields(currentness)}
            <input name="viewKey" type="hidden" value={viewKey} />
            <input name="fieldKey" type="hidden" value={field.key} />
            <label>
              Options
              <textarea
                name="optionsText"
                onChange={(event) => setOptionsText(event.target.value)}
                rows={4}
                value={optionsText}
              />
            </label>
            <input
              name="options"
              type="hidden"
              value={JSON.stringify(
                optionsText
                  .split("\n")
                  .map((option) => option.trim())
                  .filter(Boolean),
              )}
            />
            <button type="submit">Save options</button>
          </form>
        ) : null}
      </div>
    </details>
  );
}

function AddColumnControl({
  action,
  currentness,
  viewKey,
}: Readonly<{
  action?: StructuralAction | undefined;
  currentness: Currentness | null;
  viewKey: string;
}>): ReactNode {
  const [columnType, setColumnType] = useState("short_text");
  const [optionsText, setOptionsText] = useState("");
  if (!action || !currentness) {
    return null;
  }
  const optionType = columnType === "select" || columnType === "status";
  return (
    <details className="table-add-column">
      <summary>Add column</summary>
      <form action={action} className="stack-form">
        {currentnessFields(currentness)}
        <input name="viewKey" type="hidden" value={viewKey} />
        <label>
          Column name
          <input maxLength={120} minLength={1} name="label" required />
        </label>
        <label>
          Type
          <select
            name="columnType"
            onChange={(event) => setColumnType(event.target.value)}
            value={columnType}
          >
            {directTableEditableFieldTypes
              .filter((type) => type !== "currency")
              .map((type) => (
                <option key={type} value={type}>
                  {type === "short_text"
                    ? "Text"
                    : type === "long_text"
                      ? "Long text"
                      : type === "boolean"
                        ? "Yes / No"
                        : type === "select"
                          ? "Choice"
                          : type[0]!.toUpperCase() + type.slice(1)}
                </option>
              ))}
          </select>
        </label>
        {optionType ? (
          <label>
            Options, one per line
            <textarea
              onChange={(event) => setOptionsText(event.target.value)}
              rows={4}
              value={optionsText}
            />
          </label>
        ) : null}
        <input
          name="options"
          type="hidden"
          value={
            optionType
              ? JSON.stringify(
                  optionsText
                    .split("\n")
                    .map((option) => option.trim())
                    .filter(Boolean),
                )
              : ""
          }
        />
        <button type="submit">Add column</button>
      </form>
    </details>
  );
}

function CellEditor({
  action,
  field,
  onCancel,
  onKeyDown,
  pending,
  record,
  viewKey,
}: Readonly<{
  action: (formData: FormData) => void;
  field: Tables<"field_definitions">;
  onCancel: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLFormElement>) => void;
  pending: boolean;
  record: Tables<"records">;
  viewKey: string;
}>): ReactNode {
  const value = recordData(record)[field.key];
  return (
    <form
      action={action}
      className="direct-cell-form"
      onChange={(event) => {
        if (
          field.field_type === "boolean" ||
          field.field_type === "select" ||
          field.field_type === "status"
        ) {
          event.currentTarget.requestSubmit();
        }
      }}
      onKeyDown={onKeyDown}
    >
      <input name="viewKey" type="hidden" value={viewKey} />
      <input name="recordId" type="hidden" value={record.id} />
      <input name="fieldKey" type="hidden" value={field.key} />
      <FieldInputControl
        ariaLabel={`Edit ${field.label}`}
        autoFocus
        field={field}
        value={value}
      />
      <span className="direct-cell-help">
        <button disabled={pending} type="submit">
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          className="button-secondary"
          disabled={pending}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </span>
    </form>
  );
}

function ColumnResizeHandle({
  action,
  currentness,
  field,
  tableConfig,
  viewKey,
}: Readonly<{
  action?: StructuralAction | undefined;
  currentness: Currentness | null;
  field: Tables<"field_definitions">;
  tableConfig: TableViewConfig;
  viewKey: string;
}>): ReactNode {
  const formRef = useRef<HTMLFormElement>(null);
  const widthInput = useRef<HTMLInputElement>(null);
  const start = useRef({
    x: 0,
    width: widthFor(tableConfig, field.key) ?? 240,
  });

  if (!action || !currentness) {
    return null;
  }

  function begin(event: React.PointerEvent<HTMLSpanElement>): void {
    start.current = {
      x: event.clientX,
      width: widthFor(tableConfig, field.key) ?? 240,
    };
    const move = (moveEvent: PointerEvent) => {
      const width = Math.min(
        640,
        Math.max(
          128,
          start.current.width + moveEvent.clientX - start.current.x,
        ),
      );
      if (widthInput.current)
        widthInput.current.value = String(Math.round(width));
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      formRef.current?.requestSubmit();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  }

  return (
    <>
      <form ref={formRef} action={action} className="sr-only">
        {currentnessFields(currentness)}
        <input name="viewKey" type="hidden" value={viewKey} />
        <input name="fieldKey" type="hidden" value={field.key} />
        <input
          ref={widthInput}
          name="width"
          type="number"
          value={widthFor(tableConfig, field.key) ?? 240}
          readOnly
        />
      </form>
      <span
        aria-label={`Resize ${field.label} column`}
        className="column-resize-handle"
        onPointerDown={begin}
        role="separator"
        tabIndex={0}
      />
    </>
  );
}

function DirectTableGrid({
  action,
  currentness,
  createRowAction,
  draftOpen,
  editableFieldKeys,
  fields,
  onDraftClose,
  onRecordCreated,
  onRecordUpdated,
  primaryFieldKey,
  records,
  recordBasePath,
  renameColumnAction,
  reorderColumnsAction,
  resizeColumnAction,
  tableConfig,
  updateOptionsAction,
  viewKey,
}: Readonly<{
  action: CellAction;
  currentness: Currentness | null;
  createRowAction?: RowAction | undefined;
  draftOpen: boolean;
  editableFieldKeys: ReadonlySet<string>;
  fields: Tables<"field_definitions">[];
  onDraftClose: () => void;
  onRecordCreated: (record: Tables<"records">) => void;
  onRecordUpdated: (record: Tables<"records">) => void;
  primaryFieldKey: string | undefined;
  records: Tables<"records">[];
  recordBasePath: string;
  renameColumnAction?: StructuralAction | undefined;
  reorderColumnsAction?: StructuralAction | undefined;
  resizeColumnAction?: StructuralAction | undefined;
  tableConfig: TableViewConfig;
  updateOptionsAction?: StructuralAction | undefined;
  viewKey: string;
}>): ReactNode {
  const [editingCell, setEditingCell] = useState<{
    recordId: string;
    fieldKey: string;
  } | null>(null);
  const [columnOrder, setColumnOrder] = useState(
    fields.map((field) => field.key),
  );
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const cellButtons = useRef(new Map<string, HTMLElement>());
  const reorderForm = useRef<HTMLFormElement>(null);
  const fieldKeys = new Set(fields.map((field) => field.key));
  const orderedColumnKeys = [
    ...columnOrder.filter((key) => fieldKeys.has(key)),
    ...fields
      .map((field) => field.key)
      .filter((key) => !columnOrder.includes(key)),
  ];
  const orderedFields = orderedColumnKeys.flatMap((key) =>
    fields.filter((field) => field.key === key),
  );
  const submitAction = async (
    previousState: DirectTableCellActionState,
    formData: FormData,
  ) => {
    const next = await action(previousState, formData);
    if (next.status === "success" && next.record) {
      onRecordUpdated(next.record);
      setEditingCell(null);
    }
    return next;
  };
  const [state, formAction, pending] = useActionState(submitAction, {
    status: "idle",
  });
  const submitRowAction = async (
    previousState: DirectTableRowActionState,
    formData: FormData,
  ) => {
    if (!createRowAction) {
      return { status: "error" as const, message: "Add row is unavailable." };
    }
    const next = await createRowAction(previousState, formData);
    if (next.status === "success" && next.record) {
      onRecordCreated(next.record);
      onDraftClose();
    }
    return next;
  };
  const [rowState, rowFormAction, rowPending] = useActionState(
    submitRowAction,
    { status: "idle" },
  );
  const editable = new Set(
    fields
      .filter(
        (field) =>
          editableFieldKeys.has(field.key) &&
          isDirectTableEditableFieldType(field.field_type),
      )
      .map((field) => field.key),
  );

  function dropColumn(targetKey: string): void {
    if (!draggedColumn || draggedColumn === targetKey || !reorderColumnsAction)
      return;
    const next = [...orderedColumnKeys];
    const from = next.indexOf(draggedColumn);
    const to = next.indexOf(targetKey);
    if (from < 0 || to < 0) return;
    next.splice(from, 1);
    next.splice(to, 0, draggedColumn);
    setColumnOrder(next);
    setDraggedColumn(null);
    window.requestAnimationFrame(() => reorderForm.current?.requestSubmit());
  }

  function focusCell(recordIndex: number, fieldIndex: number): void {
    const record = records[recordIndex];
    const field = orderedFields[fieldIndex];
    if (record && field)
      cellButtons.current.get(`${record.id}:${field.key}`)?.focus();
  }

  function handleCellNavigation(
    event: KeyboardEvent<HTMLElement>,
    recordIndex: number,
    fieldIndex: number,
  ): void {
    const target = directTableCellNavigationTarget(
      event.key,
      recordIndex,
      fieldIndex,
    );
    if (!target) return;
    event.preventDefault();
    focusCell(target.recordIndex, target.fieldIndex);
  }

  return (
    <div className="table-scroll direct-table-scroll">
      <table className="runtime-table direct-runtime-table">
        <thead>
          <tr>
            {orderedFields.map((field) => (
              <th
                draggable={Boolean(reorderColumnsAction && currentness)}
                key={field.key}
                onDragOver={(event) => event.preventDefault()}
                onDragStart={() => setDraggedColumn(field.key)}
                onDrop={() => dropColumn(field.key)}
                scope="col"
                style={{ width: widthFor(tableConfig, field.key) }}
              >
                <span className="table-column-heading-content">
                  {field.label}
                  <ColumnHeaderControls
                    action={renameColumnAction}
                    currentness={currentness}
                    field={field}
                    optionsAction={updateOptionsAction}
                    viewKey={viewKey}
                  />
                  <ColumnResizeHandle
                    action={resizeColumnAction}
                    currentness={currentness}
                    field={field}
                    tableConfig={tableConfig}
                    viewKey={viewKey}
                  />
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {draftOpen && createRowAction ? (
            <tr className="direct-new-row">
              {orderedFields.map((field) => (
                <td key={field.key}>
                  {field.key === primaryFieldKey ? (
                    <form
                      action={rowFormAction}
                      aria-label={`New ${field.label}`}
                      className="direct-new-row-form"
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          onDraftClose();
                        }
                      }}
                    >
                      <input name="viewKey" type="hidden" value={viewKey} />
                      <FieldInputControl
                        ariaLabel={`New ${field.label}`}
                        autoFocus
                        field={field}
                        value={field.default_value ?? undefined}
                      />
                      {rowPending ? (
                        <span className="field-help">Adding…</span>
                      ) : null}
                      {rowState.status === "error" ? (
                        <span className="inline-cell-error" role="alert">
                          {rowState.message}
                        </span>
                      ) : null}
                    </form>
                  ) : null}
                </td>
              ))}
            </tr>
          ) : null}
          {records.map((record, recordIndex) => {
            const data = recordData(record);
            return (
              <tr key={record.id}>
                {orderedFields.map((field, fieldIndex) => {
                  const editing =
                    editingCell?.recordId === record.id &&
                    editingCell.fieldKey === field.key;
                  const canEdit = editable.has(field.key);
                  const cellKey = `${record.id}:${field.key}`;
                  return (
                    <td key={field.key}>
                      {editing ? (
                        <CellEditor
                          action={formAction}
                          field={field}
                          onCancel={() => setEditingCell(null)}
                          onKeyDown={(event) => {
                            const keyAction = directTableEditorKeyAction(
                              event.key,
                              event.shiftKey,
                            );
                            if (keyAction === "cancel") {
                              event.preventDefault();
                              event.stopPropagation();
                              setEditingCell(null);
                            } else if (keyAction === "commit") {
                              event.preventDefault();
                              event.currentTarget.requestSubmit();
                            } else if (
                              keyAction === "commit_next" ||
                              keyAction === "commit_previous"
                            ) {
                              event.currentTarget.requestSubmit();
                              setEditingCell(null);
                              window.requestAnimationFrame(() =>
                                focusCell(
                                  recordIndex,
                                  keyAction === "commit_previous"
                                    ? fieldIndex - 1
                                    : fieldIndex + 1,
                                ),
                              );
                            }
                          }}
                          pending={pending}
                          record={record}
                          viewKey={viewKey}
                        />
                      ) : field.key === primaryFieldKey ? (
                        <a
                          id={`direct-record-${record.id}`}
                          className="primary-record-link"
                          href={directTableRecordPanelHref(
                            recordBasePath,
                            record.id,
                          )}
                          onDoubleClick={(event) => {
                            if (canEdit) {
                              event.preventDefault();
                              setEditingCell({
                                recordId: record.id,
                                fieldKey: field.key,
                              });
                            }
                          }}
                          onKeyDown={(event) =>
                            handleCellNavigation(event, recordIndex, fieldIndex)
                          }
                          ref={(element) => {
                            if (element)
                              cellButtons.current.set(cellKey, element);
                            else cellButtons.current.delete(cellKey);
                          }}
                          title={
                            canEdit
                              ? "Click to open; double-click to edit"
                              : undefined
                          }
                        >
                          <FieldValue field={field} value={data[field.key]} />
                        </a>
                      ) : canEdit ? (
                        <button
                          className="direct-cell-display"
                          data-cell={cellKey}
                          onClick={() =>
                            setEditingCell({
                              recordId: record.id,
                              fieldKey: field.key,
                            })
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setEditingCell({
                                recordId: record.id,
                                fieldKey: field.key,
                              });
                            }
                            handleCellNavigation(
                              event,
                              recordIndex,
                              fieldIndex,
                            );
                          }}
                          ref={(element) => {
                            if (element)
                              cellButtons.current.set(cellKey, element);
                            else cellButtons.current.delete(cellKey);
                          }}
                          type="button"
                        >
                          <FieldValue field={field} value={data[field.key]} />
                        </button>
                      ) : (
                        <span
                          className="direct-cell-static"
                          onKeyDown={(event) =>
                            handleCellNavigation(event, recordIndex, fieldIndex)
                          }
                          ref={(element) => {
                            if (element)
                              cellButtons.current.set(cellKey, element);
                            else cellButtons.current.delete(cellKey);
                          }}
                          tabIndex={0}
                        >
                          <FieldValue field={field} value={data[field.key]} />
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {reorderColumnsAction && currentness ? (
        <form
          ref={reorderForm}
          action={reorderColumnsAction}
          className="sr-only"
        >
          {currentnessFields(currentness)}
          <input name="viewKey" type="hidden" value={viewKey} />
          <input
            name="fieldKeys"
            type="hidden"
            value={JSON.stringify(orderedColumnKeys)}
          />
          <button type="submit">Save column order</button>
        </form>
      ) : null}
      {state.status === "error" ? (
        <p className="inline-cell-error" role="alert">
          {state.message}
        </p>
      ) : state.status === "success" && !editingCell ? (
        <p className="inline-edit-message" role="status">
          Saved.
        </p>
      ) : null}
    </div>
  );
}

function AddRowControl({
  businessSlug,
  draftOpen,
  onDraftChange,
  rowCreation,
  viewKey,
}: Readonly<{
  businessSlug: string;
  draftOpen: boolean;
  onDraftChange: (open: boolean) => void;
  rowCreation: {
    kind: "direct" | "configured_form" | "unavailable";
    message?: string;
  };
  viewKey: string;
}>): ReactNode {
  if (rowCreation.kind === "configured_form") {
    return (
      <Link
        className="button button-secondary"
        href={`/app/${encodeURIComponent(businessSlug)}/workspace/${experienceKeyToPath(viewKey)}/new`}
      >
        Add row
      </Link>
    );
  }

  if (rowCreation.kind === "unavailable") {
    return (
      <p className="field-help direct-add-row-unavailable">
        {rowCreation.message ?? "Add row is not available for this Table."}
      </p>
    );
  }

  return (
    <div className="direct-add-row">
      <button
        aria-expanded={draftOpen}
        onClick={() => onDraftChange(!draftOpen)}
        type="button"
      >
        {draftOpen ? "Cancel row" : "Add row"}
      </button>
    </div>
  );
}

function RecordPanel({
  action,
  editableFieldKeys,
  fields,
  fullRecordHref,
  onRecordUpdated,
  primaryFieldKey,
  record,
  tableName,
  viewKey,
  closeHref,
}: Readonly<{
  action: CellAction;
  closeHref: string;
  editableFieldKeys: ReadonlySet<string>;
  fields: Tables<"field_definitions">[];
  fullRecordHref: string;
  onRecordUpdated: (record: Tables<"records">) => void;
  primaryFieldKey: string | undefined;
  record: Tables<"records">;
  tableName: string;
  viewKey: string;
}>): ReactNode {
  const closeRef = useRef<HTMLAnchorElement>(null);
  const originId = `direct-record-${record.id}`;
  useEffect(() => {
    closeRef.current?.focus();
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") window.history.back();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.getElementById(originId)?.focus();
    };
  }, [originId]);

  const data = recordData(record);
  return (
    <aside aria-label="Record details" className="record-panel">
      <div className="record-panel-header">
        <h2>
          {String(data[primaryFieldKey ?? fields[0]?.key ?? ""] ?? "Record")}
        </h2>
        <Link ref={closeRef} href={closeHref}>
          Close
        </Link>
      </div>
      <p className="record-panel-table-name">{tableName}</p>
      <p className="record-panel-status" role="status">
        Status: {record.record_status === "active" ? "Active" : "Archived"}
      </p>
      <Link className="record-panel-full-link" href={fullRecordHref}>
        Open full record
      </Link>
      <div className="record-panel-fields">
        {fields.map((field) => (
          <PanelField
            action={action}
            editableFieldKeys={editableFieldKeys}
            field={field}
            key={field.key}
            onRecordUpdated={onRecordUpdated}
            record={record}
            viewKey={viewKey}
          />
        ))}
      </div>
    </aside>
  );
}

function PanelField({
  action,
  editableFieldKeys,
  field,
  onRecordUpdated,
  record,
  viewKey,
}: Readonly<{
  action: CellAction;
  editableFieldKeys: ReadonlySet<string>;
  field: Tables<"field_definitions">;
  onRecordUpdated: (record: Tables<"records">) => void;
  record: Tables<"records">;
  viewKey: string;
}>): ReactNode {
  const data = recordData(record);
  const editable =
    editableFieldKeys.has(field.key) &&
    isDirectTableEditableFieldType(field.field_type);
  const submitAction = async (
    previousState: DirectTableCellActionState,
    formData: FormData,
  ) => {
    const next = await action(previousState, formData);
    if (next.status === "success" && next.record) onRecordUpdated(next.record);
    return next;
  };
  const [state, formAction, pending] = useActionState(submitAction, {
    status: "idle",
  });
  return (
    <div className="record-panel-field">
      <span className="supporting-label">{field.label}</span>
      {editable ? (
        <form
          action={formAction}
          className="record-panel-field-form"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.currentTarget.reset();
              event.stopPropagation();
            }
          }}
        >
          <input name="viewKey" type="hidden" value={viewKey} />
          <input name="recordId" type="hidden" value={record.id} />
          <input name="fieldKey" type="hidden" value={field.key} />
          <FieldInputControl
            ariaLabel={`Edit ${field.label}`}
            field={field}
            value={data[field.key]}
          />
          <button disabled={pending} type="submit">
            {pending ? "Saving…" : "Save"}
          </button>
          {state.status === "error" ? (
            <span className="inline-cell-error" role="alert">
              {state.message}
            </span>
          ) : null}
        </form>
      ) : (
        <FieldValue field={field} value={data[field.key]} />
      )}
    </div>
  );
}

export function DirectTableWorkspace({
  addColumnAction,
  bundle,
  businessSlug,
  canManageConfiguration,
  createRowAction,
  currentness,
  recordId,
  renameColumnAction,
  renameTableAction,
  reorderColumnsAction,
  resizeColumnAction,
  rowCreation,
  selectedRecord,
  undoAction,
  updateCellAction,
  updateOptionsAction,
}: Readonly<DirectTableWorkspaceProps>): ReactNode {
  const config = bundle.config as TableViewConfig;
  const fields = configuredFields(bundle);
  const [records, setRecords] = useState(bundle.records);
  const [selected, setSelected] = useState(selectedRecord);
  const [draftOpen, setDraftOpen] = useState(false);
  const recordBasePath = `/app/${encodeURIComponent(businessSlug)}/workspace/${experienceKeyToPath(bundle.definition.key)}`;
  const primaryFieldKey = config.title_field ?? fields[0]?.key;
  const editableFieldKeys = new Set(
    config.edit_form_key
      ? (bundle.inlineEdit?.fieldKeys ?? [])
      : fields
          .filter((field) => isDirectTableEditableFieldType(field.field_type))
          .map((field) => field.key),
  );
  const panelFields = [
    ...fields,
    ...bundle.fields
      .filter(
        (field) =>
          field.is_active &&
          !fields.some((visible) => visible.key === field.key),
      )
      .sort((left, right) => left.position - right.position),
  ];

  function updateRecord(record: Tables<"records">): void {
    setRecords((current) =>
      current.map((candidate) =>
        candidate.id === record.id ? record : candidate,
      ),
    );
    setSelected((current) => (current?.id === record.id ? record : current));
  }

  function addRecord(record: Tables<"records">): void {
    setRecords((current) => [record, ...current]);
  }

  return (
    <section className="direct-table-workspace">
      <header className="direct-table-header">
        <div>
          <p className="eyebrow">Table</p>
          <EditableTableTitle
            action={canManageConfiguration ? renameTableAction : undefined}
            currentness={currentness}
            title={bundle.definition.name}
            viewKey={bundle.definition.key}
          />
          <p className="lede">
            Manage {bundle.object.plural_label.toLowerCase()} in one place.
          </p>
        </div>
        {canManageConfiguration && undoAction && currentness ? (
          <form action={undoAction}>
            <input name="viewKey" type="hidden" value={bundle.definition.key} />
            <input
              name="expectedActiveSourceVersionId"
              type="hidden"
              value={currentness.expectedBaseVersionId}
            />
            <input
              name="expectedHeadRevision"
              type="hidden"
              value={currentness.expectedHeadRevision}
            />
            <button className="button-secondary" type="submit">
              Undo last Table change
            </button>
          </form>
        ) : null}
      </header>

      {canManageConfiguration ? (
        <div className="direct-table-configuration-controls">
          <AddColumnControl
            action={addColumnAction}
            currentness={currentness}
            viewKey={bundle.definition.key}
          />
          <p className="field-help">
            Drag a column heading to reorder it. Drag its right edge to resize
            it.
          </p>
        </div>
      ) : null}

      <div className="direct-table-content">
        <div className="direct-table-main">
          <DirectTableGrid
            action={updateCellAction}
            currentness={currentness}
            createRowAction={
              rowCreation.kind === "direct" ? createRowAction : undefined
            }
            draftOpen={draftOpen}
            editableFieldKeys={editableFieldKeys}
            fields={fields}
            onDraftClose={() => setDraftOpen(false)}
            onRecordCreated={addRecord}
            onRecordUpdated={updateRecord}
            primaryFieldKey={primaryFieldKey}
            records={records}
            recordBasePath={recordBasePath}
            renameColumnAction={
              canManageConfiguration ? renameColumnAction : undefined
            }
            reorderColumnsAction={
              canManageConfiguration ? reorderColumnsAction : undefined
            }
            resizeColumnAction={
              canManageConfiguration ? resizeColumnAction : undefined
            }
            tableConfig={config}
            updateOptionsAction={
              canManageConfiguration ? updateOptionsAction : undefined
            }
            viewKey={bundle.definition.key}
          />
          <AddRowControl
            businessSlug={businessSlug}
            draftOpen={draftOpen}
            onDraftChange={setDraftOpen}
            rowCreation={rowCreation}
            viewKey={bundle.definition.key}
          />
        </div>
        {selected && recordId ? (
          <RecordPanel
            action={updateCellAction}
            editableFieldKeys={editableFieldKeys}
            closeHref={recordBasePath}
            fields={panelFields}
            fullRecordHref={directTableFullRecordHref(
              recordBasePath,
              selected.id,
            )}
            onRecordUpdated={updateRecord}
            primaryFieldKey={primaryFieldKey}
            record={selected}
            tableName={bundle.definition.name}
            viewKey={bundle.definition.key}
          />
        ) : null}
      </div>
    </section>
  );
}
