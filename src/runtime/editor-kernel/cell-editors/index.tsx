import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { RenderEditCellProps } from "react-data-grid";

import {
  editorInputValue,
  type EditorColumn,
  type EditorRow,
  type EditorValue,
} from "../contracts";

interface CellEditorProps extends RenderEditCellProps<EditorRow> {
  columnDefinition: EditorColumn;
  initialValue: EditorValue | undefined;
}

function rowWithValue(
  row: EditorRow,
  columnKey: string,
  value: EditorValue,
): EditorRow {
  return { ...row, values: { ...row.values, [columnKey]: value } };
}

export function ConnectionPicker({
  column,
  labels,
  onCancel,
  onCommit,
  onSearch,
  onCreate,
  initiallyOpen = false,
  portal = false,
  value,
}: Readonly<{
  column: EditorColumn;
  labels?: readonly { id: string; label: string }[] | undefined;
  onCancel?: () => void;
  onCommit: (value: readonly string[]) => void;
  onSearch: (
    search: string,
  ) => Promise<readonly { id: string; label: string }[]>;
  onCreate?: (primaryValue: string) => Promise<{ id: string; label: string }>;
  initiallyOpen?: boolean;
  portal?: boolean;
  value: EditorValue;
}>): React.ReactNode {
  type SearchState = "idle" | "loading" | "ready" | "unavailable";

  const [open, setOpen] = useState(initiallyOpen);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [portalPosition, setPortalPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [results, setResults] = useState<
    readonly { id: string; label: string }[]
  >(labels ?? []);
  const selected = Array.isArray(value) ? value : [];
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const selectedSet = new Set(selected);
  const isSearching =
    open && (searchState === "loading" || searchState === "idle");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void onSearch(query)
      .then((next) => {
        if (cancelled) return;
        setResults(next);
        setSearchState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setResults([]);
        setSearchState("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [onSearch, open, query, searchAttempt]);

  useEffect(() => {
    if (!open || !portal || typeof window === "undefined") {
      return;
    }

    const updatePosition = (): void => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const bounds = trigger.getBoundingClientRect();
      const popoverWidth = Math.min(304, window.innerWidth - 16);
      const estimatedHeight = Math.min(360, window.innerHeight - 16);
      const below = bounds.bottom + 4;
      const top =
        below + estimatedHeight <= window.innerHeight - 8
          ? below
          : Math.max(8, bounds.top - estimatedHeight - 4);
      const left = Math.min(
        Math.max(8, bounds.left),
        Math.max(8, window.innerWidth - popoverWidth - 8),
      );
      setPortalPosition({ top, left });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, portal]);

  useEffect(() => {
    if (!open || !portal || typeof document === "undefined") return;

    const handleOutsideMouseDown = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
      onCancel?.();
    };

    document.addEventListener("mousedown", handleOutsideMouseDown, true);
    return () => {
      document.removeEventListener("mousedown", handleOutsideMouseDown, true);
    };
  }, [onCancel, open, portal]);

  const commit = (next: readonly string[]): void => {
    onCommit(next);
    if (!column.connection?.multiple) {
      setOpen(false);
    }
  };
  const selectedLabels = (labels ?? []).filter((item) =>
    selectedSet.has(item.id),
  );
  const create = async (): Promise<void> => {
    if (!onCreate || !query.trim() || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await onCreate(query.trim());
      commit(
        column.connection?.multiple ? [...selected, created.id] : [created.id],
      );
    } catch (error) {
      setCreateError(
        error instanceof Error && error.message
          ? error.message
          : "This connected Record could not be created here.",
      );
    } finally {
      setCreating(false);
    }
  };

  const popover = (
    <div
      aria-busy={isSearching}
      aria-label={`Connect to ${column.label}`}
      className={`editor-connection-popover${portal ? " is-portal" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          onCancel?.();
        }
      }}
      ref={popoverRef}
      role="listbox"
      style={
        portalPosition
          ? { left: portalPosition.left, top: portalPosition.top }
          : undefined
      }
    >
      <input
        aria-label={`Search ${column.label}`}
        autoFocus
        className="editor-choice-search"
        onChange={(event) => {
          setSearchState("loading");
          setQuery(event.currentTarget.value);
        }}
        placeholder="Search records"
        value={query}
      />
      <div className="editor-connection-popover-heading">
        <strong>Connect to {column.label}</strong>
        <span>
          {column.connection?.multiple ? "Several records" : "One record"}
        </span>
      </div>
      {searchState === "unavailable" ? (
        <div
          aria-live="polite"
          className="editor-connection-status is-unavailable"
          role="status"
        >
          <span>Connections are temporarily unavailable.</span>
          <button
            onClick={() => {
              setSearchState("loading");
              setSearchAttempt((current) => current + 1);
            }}
            type="button"
          >
            Try again
          </button>
        </div>
      ) : isSearching ? (
        <p aria-live="polite" className="editor-connection-status">
          Searching…
        </p>
      ) : results.length === 0 ? (
        <p aria-live="polite" className="editor-connection-status">
          {query.trim()
            ? "No matching records."
            : "No records available to connect yet."}
        </p>
      ) : (
        results.map((result) => {
          const active = selectedSet.has(result.id);
          return (
            <button
              aria-selected={active}
              className={`editor-connection-option${active ? " is-selected" : ""}`}
              key={result.id}
              onClick={() => {
                const next = active
                  ? selected.filter((id) => id !== result.id)
                  : column.connection?.multiple
                    ? [...selected, result.id]
                    : [result.id];
                commit(next);
              }}
              role="option"
              type="button"
            >
              <span>{result.label}</span>
              {active ? <span aria-hidden="true">✓</span> : null}
            </button>
          );
        })
      )}
      {onCreate ? (
        <>
          {!query.trim() ? (
            <p className="editor-connection-create-hint">
              Type a name to enable quick-create.
            </p>
          ) : null}
          {createError ? (
            <p
              aria-live="polite"
              className="editor-connection-create-error"
              role="alert"
            >
              {createError}
            </p>
          ) : null}
          <button
            aria-disabled={!query.trim() || creating}
            className="editor-connection-create"
            disabled={!query.trim() || creating}
            onClick={() => void create()}
            type="button"
          >
            {creating
              ? "Creating…"
              : `+ Create ${column.label.toLocaleLowerCase("en")}`}
          </button>
        </>
      ) : null}
      <button
        className="editor-choice-clear"
        onClick={() => commit([])}
        type="button"
      >
        Clear
      </button>
    </div>
  );

  return (
    <div className="editor-connection-picker">
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Connect to ${column.label}`}
        className="editor-connection-trigger"
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          setSearchState("loading");
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            onCancel?.();
          } else if (event.key === "Backspace" || event.key === "Delete") {
            event.preventDefault();
            commit([]);
          }
        }}
        ref={triggerRef}
        type="button"
      >
        {selectedLabels.length > 0 ? (
          <span className="editor-connection-selected-pills">
            {selectedLabels.map((item) => (
              <span className="editor-connection-pill" key={item.id}>
                <span>{item.label}</span>
                <span
                  aria-hidden="true"
                  className="editor-connection-pill-link"
                >
                  ↗
                </span>
              </span>
            ))}
          </span>
        ) : (
          <span className="editor-connection-placeholder">Connect to…</span>
        )}
        <span aria-hidden="true" className="editor-connection-trigger-chevron">
          ⌄
        </span>
      </button>
      {open
        ? portal && portalPosition && typeof document !== "undefined"
          ? createPortal(popover, document.body)
          : popover
        : null}
    </div>
  );
}

function useFocusAndSelect(
  ref: RefObject<HTMLInputElement | HTMLSelectElement | null>,
  shouldSelect = true,
): void {
  useEffect(() => {
    ref.current?.focus();
    if (ref.current instanceof HTMLInputElement) {
      if (shouldSelect) {
        ref.current.select();
      } else if (ref.current.type !== "number") {
        const end = ref.current.value.length;
        ref.current.setSelectionRange(end, end);
      }
    }
  }, [ref, shouldSelect]);
}

function useSeedInitialValue({
  columnDefinition,
  initialValue,
  onRowChange,
  row,
}: Readonly<{
  columnDefinition: EditorColumn;
  initialValue: EditorValue | undefined;
  onRowChange: CellEditorProps["onRowChange"];
  row: EditorRow;
}>): void {
  const didSeed = useRef(false);
  useEffect(() => {
    if (initialValue !== undefined && !didSeed.current) {
      didSeed.current = true;
      onRowChange(rowWithValue(row, columnDefinition.key, initialValue));
    }
  }, [columnDefinition.key, initialValue, onRowChange, row]);
}

function TextLikeEditor({
  columnDefinition,
  initialValue,
  onRowChange,
  row,
}: CellEditorProps): React.ReactNode {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(() =>
    editorInputValue(
      initialValue === undefined
        ? (row.values[columnDefinition.key] ?? null)
        : initialValue,
    ),
  );
  useFocusAndSelect(ref, initialValue === undefined);
  useSeedInitialValue({
    columnDefinition,
    initialValue,
    onRowChange,
    row,
  });

  const inputType =
    columnDefinition.kind === "email"
      ? "email"
      : columnDefinition.kind === "url"
        ? "url"
        : columnDefinition.kind === "phone"
          ? "tel"
          : "text";

  return (
    <input
      ref={ref}
      aria-label={`Edit ${columnDefinition.label}`}
      className="editor-cell-editor"
      onChange={(event) => {
        const next = event.currentTarget.value;
        setValue(next);
        onRowChange(rowWithValue(row, columnDefinition.key, next));
      }}
      type={inputType}
      value={value}
    />
  );
}

function ConnectionEditor({
  columnDefinition,
  onClose,
  onRowChange,
  row,
  onSearchConnectionTargets,
  onCreateConnectionTarget,
}: CellEditorProps & {
  onSearchConnectionTargets?:
    | ((
        columnKey: string,
        search: string,
      ) => Promise<readonly { id: string; label: string }[]>)
    | undefined;
  onCreateConnectionTarget?:
    | ((
        columnKey: string,
        primaryValue: string,
      ) => Promise<{ id: string; label: string }>)
    | undefined;
}): React.ReactNode {
  const value = row.values[columnDefinition.key] ?? [];
  return (
    <ConnectionPicker
      column={columnDefinition}
      initiallyOpen
      labels={row.connectionValues?.[columnDefinition.key]}
      onCancel={() => onClose()}
      onCommit={(next) =>
        onRowChange(rowWithValue(row, columnDefinition.key, next), true)
      }
      onSearch={(search) =>
        onSearchConnectionTargets
          ? onSearchConnectionTargets(columnDefinition.key, search)
          : Promise.resolve(row.connectionValues?.[columnDefinition.key] ?? [])
      }
      {...(onCreateConnectionTarget
        ? {
            onCreate: (primaryValue: string) =>
              onCreateConnectionTarget(columnDefinition.key, primaryValue),
          }
        : {})}
      portal
      value={value}
    />
  );
}

function NumberEditor({
  columnDefinition,
  initialValue,
  onRowChange,
  row,
}: CellEditorProps): React.ReactNode {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(() =>
    editorInputValue(
      initialValue === undefined
        ? (row.values[columnDefinition.key] ?? null)
        : initialValue,
    ),
  );
  useFocusAndSelect(ref, initialValue === undefined);
  useSeedInitialValue({
    columnDefinition,
    initialValue,
    onRowChange,
    row,
  });

  return (
    <input
      ref={ref}
      aria-label={`Edit ${columnDefinition.label}`}
      className="editor-cell-editor editor-number-editor"
      inputMode="decimal"
      onChange={(event) => {
        const next = event.currentTarget.value;
        setValue(next);
        onRowChange(rowWithValue(row, columnDefinition.key, next));
      }}
      step="any"
      type="number"
      value={value}
    />
  );
}

export function ChoiceStatusPicker({
  column,
  onCancel,
  onCommit,
  value,
}: Readonly<{
  column: EditorColumn;
  onCancel?: () => void;
  onCommit: (value: EditorValue) => void;
  value: EditorValue;
}>): React.ReactNode {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const configuredOptions = (column.options ?? []).filter(
    (option) => option.trim().length > 0,
  );
  const options = configuredOptions.filter((option) =>
    option.toLocaleLowerCase("en").includes(query.toLocaleLowerCase("en")),
  );
  const hasConfiguredOptions = configuredOptions.length > 0;
  useEffect(() => buttonRef.current?.focus(), []);
  useEffect(() => {
    if (open && hasConfiguredOptions) searchRef.current?.focus();
  }, [hasConfiguredOptions, open]);
  const commitOption = (option: string): void => {
    onCommit(option);
    setOpen(false);
  };
  return (
    <div className="editor-choice-picker">
      <button
        aria-expanded={open}
        aria-haspopup={hasConfiguredOptions ? "listbox" : "dialog"}
        aria-label={`Edit ${column.label}`}
        className="editor-choice-trigger"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            if (onCancel) {
              onCancel();
            } else {
              setOpen(false);
            }
          } else if (event.key === "ArrowDown" || event.key === "Enter") {
            event.preventDefault();
            setOpen(true);
          } else if (event.key === "Backspace" || event.key === "Delete") {
            event.preventDefault();
            onCommit(null);
          }
        }}
        ref={buttonRef}
        type="button"
      >
        {editorInputValue(value) ||
          (hasConfiguredOptions ? "Choose…" : "No options yet")}
      </button>
      {open ? (
        hasConfiguredOptions ? (
          <div className="editor-choice-popover" role="listbox">
            <input
              aria-label={`Search ${column.label}`}
              className="editor-choice-search"
              ref={searchRef}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setActiveIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  if (onCancel) {
                    onCancel();
                  } else {
                    setOpen(false);
                  }
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((current) =>
                    options.length === 0
                      ? 0
                      : Math.min(current + 1, options.length - 1),
                  );
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((current) => Math.max(current - 1, 0));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const option = options[activeIndex];
                  if (option) commitOption(option);
                } else if (
                  (event.key === "Backspace" || event.key === "Delete") &&
                  !query
                ) {
                  event.preventDefault();
                  onCommit(null);
                  setOpen(false);
                }
              }}
              placeholder="Search"
              value={query}
            />
            {options.map((option, index) => (
              <button
                aria-current={option === value ? "true" : undefined}
                aria-selected={index === activeIndex}
                className={`editor-choice-option${index === activeIndex ? " is-active" : ""}`}
                id={`editor-choice-${column.key}-${index}`}
                key={option}
                onClick={() => commitOption(option)}
                onMouseEnter={() => setActiveIndex(index)}
                role="option"
                type="button"
              >
                <span className="editor-status-pill">{option}</span>
              </button>
            ))}
            <button
              className="editor-choice-clear"
              onClick={() => {
                onCommit(null);
                setOpen(false);
              }}
              type="button"
            >
              Clear
            </button>
          </div>
        ) : (
          <div
            aria-live="polite"
            className="editor-choice-popover editor-choice-empty-state"
            role="status"
          >
            <strong>No options yet</strong>
            <span>
              Use Edit options in the column menu to configure this property.
            </span>
          </div>
        )
      ) : null}
    </div>
  );
}

function StatusEditor({
  columnDefinition,
  onRowChange,
  row,
}: CellEditorProps): React.ReactNode {
  const value = editorInputValue(row.values[columnDefinition.key] ?? null);
  return (
    <ChoiceStatusPicker
      column={columnDefinition}
      onCommit={(next) =>
        onRowChange(rowWithValue(row, columnDefinition.key, next), true)
      }
      value={value}
    />
  );
}

function BooleanEditor({
  columnDefinition,
  onRowChange,
  row,
}: CellEditorProps): React.ReactNode {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), [ref]);

  return (
    <label className="editor-boolean-editor">
      <input
        ref={ref}
        aria-label={`Edit ${columnDefinition.label}`}
        checked={row.values[columnDefinition.key] === true}
        onChange={(event) => {
          onRowChange(
            rowWithValue(
              row,
              columnDefinition.key,
              event.currentTarget.checked,
            ),
            true,
          );
        }}
        type="checkbox"
      />
      <span>{row.values[columnDefinition.key] === true ? "Yes" : "No"}</span>
    </label>
  );
}

function DateEditor({
  columnDefinition,
  initialValue,
  onRowChange,
  row,
}: CellEditorProps): React.ReactNode {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(() =>
    editorInputValue(
      initialValue === undefined
        ? (row.values[columnDefinition.key] ?? null)
        : initialValue,
    ),
  );
  useFocusAndSelect(ref);

  return (
    <div className="editor-date-editor">
      <input
        ref={ref}
        aria-label={`Edit ${columnDefinition.label}`}
        className="editor-cell-editor"
        onChange={(event) => {
          const next = event.currentTarget.value;
          setValue(next);
          onRowChange(rowWithValue(row, columnDefinition.key, next));
        }}
        type="date"
        value={value}
      />
      <button
        onClick={() => {
          const today = new Date().toISOString().slice(0, 10);
          setValue(today);
          onRowChange(rowWithValue(row, columnDefinition.key, today), true);
        }}
        type="button"
      >
        Today
      </button>
      <button
        onClick={() => {
          setValue("");
          onRowChange(rowWithValue(row, columnDefinition.key, null), true);
        }}
        type="button"
      >
        Clear
      </button>
    </div>
  );
}

export function CellEditor(
  props: CellEditorProps & {
    onSearchConnectionTargets?:
      | ((
          columnKey: string,
          search: string,
        ) => Promise<readonly { id: string; label: string }[]>)
      | undefined;
    onCreateConnectionTarget?:
      | ((
          columnKey: string,
          primaryValue: string,
        ) => Promise<{ id: string; label: string }>)
      | undefined;
  },
): React.ReactNode {
  switch (props.columnDefinition.kind) {
    case "connection":
      return <ConnectionEditor {...props} />;
    case "number":
    case "currency":
      return <NumberEditor {...props} />;
    case "select":
    case "status":
      return <StatusEditor {...props} />;
    case "boolean":
      return <BooleanEditor {...props} />;
    case "date":
      return <DateEditor {...props} />;
    case "text":
    case "long_text":
    case "email":
    case "url":
    case "phone":
    case "datetime":
    case "multi_select":
    case "file":
      return <TextLikeEditor {...props} />;
  }
}
