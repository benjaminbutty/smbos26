"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import type {
  TableViewColumn,
  TableViewConfigV2,
  TableViewFilter,
  TableViewQuery,
} from "../../core/experience/schemas";
import {
  tableViewConnectionPropertyKey,
  tableViewFieldPropertyKey,
} from "../../core/experience/schemas";
import type { Tables } from "../../db/supabase/database.types";
import type {
  ProductionConfigurationCurrentness,
  ProductionPreviewSavedView,
} from "../editor-kernel/production/action-types";
import {
  configureProductionSavedViewAction,
  duplicateProductionSavedViewAction,
  archiveProductionSavedViewAction,
  previewProductionSavedViewAction,
  refreshProductionTableCurrentnessAction,
  searchProductionTableConnectionTargetsAction,
} from "../editor-kernel/production/production-table-actions";
import { experienceKeyToPath } from "../routing";
import { useUnsavedNavigationWarning } from "../unsaved-navigation-warning";
import { useTableViewPreview } from "./table-view-preview-context";

type FilterOperator = TableViewFilter["operator"];

interface QueryProperty {
  kind: "field" | "connection";
  key: string;
  label: string;
  optionKey: string;
  fieldType?: string;
  relationshipKey?: string;
  direction?: "source" | "target";
}

interface OperatorOption {
  value: FilterOperator;
  label: string;
}

const noValueOperators = new Set<FilterOperator>([
  "is_empty",
  "is_not_empty",
  "is_yes",
  "is_no",
]);
const listOperators = new Set<FilterOperator>([
  "is_any_of",
  "contains_any",
  "contains_all",
  "between",
]);

function connectionOptionKey(
  relationshipKey: string,
  direction: "source" | "target",
): string {
  return tableViewConnectionPropertyKey(relationshipKey, direction);
}

function fieldOperators(fieldType: string): OperatorOption[] {
  if (
    ["short_text", "long_text", "email", "phone", "url"].includes(fieldType)
  ) {
    return [
      { value: "contains", label: "contains" },
      { value: "is", label: "is" },
      { value: "is_not", label: "is not" },
      { value: "does_not_contain", label: "does not contain" },
      { value: "is_empty", label: "is empty" },
      { value: "is_not_empty", label: "is not empty" },
    ];
  }
  if (["number", "currency"].includes(fieldType)) {
    return [
      { value: "is", label: "equals" },
      { value: "is_not", label: "does not equal" },
      { value: "greater_than", label: "greater than" },
      { value: "greater_than_or_equal", label: "greater than or equal" },
      { value: "less_than", label: "less than" },
      { value: "less_than_or_equal", label: "less than or equal" },
      { value: "is_empty", label: "is empty" },
      { value: "is_not_empty", label: "is not empty" },
    ];
  }
  if (["date", "datetime"].includes(fieldType)) {
    return [
      { value: "is", label: "is" },
      { value: "on_or_before", label: "on or before" },
      { value: "on_or_after", label: "on or after" },
      { value: "between", label: "between" },
      { value: "is_empty", label: "is empty" },
      { value: "is_not_empty", label: "is not empty" },
    ];
  }
  if (fieldType === "boolean") {
    return [
      { value: "is_yes", label: "is yes" },
      { value: "is_no", label: "is no" },
      { value: "is_empty", label: "is empty" },
      { value: "is_not_empty", label: "is not empty" },
    ];
  }
  if (["select", "status"].includes(fieldType)) {
    return [
      { value: "is", label: "is" },
      { value: "is_not", label: "is not" },
      { value: "is_any_of", label: "is any of" },
      { value: "is_empty", label: "is empty" },
      { value: "is_not_empty", label: "is not empty" },
    ];
  }
  if (fieldType === "multi_select") {
    return [
      { value: "contains_any", label: "contains any" },
      { value: "contains_all", label: "contains all" },
      { value: "is_empty", label: "is empty" },
      { value: "is_not_empty", label: "is not empty" },
    ];
  }
  return [
    { value: "is_empty", label: "is empty" },
    { value: "is_not_empty", label: "is not empty" },
  ];
}

function connectionOperators(): OperatorOption[] {
  return [
    { value: "is", label: "is" },
    { value: "is_not", label: "is not" },
    { value: "contains_any", label: "contains any" },
    { value: "is_empty", label: "is empty" },
    { value: "is_not_empty", label: "is not empty" },
  ];
}

function defaultOperator(property: QueryProperty | undefined): FilterOperator {
  if (!property) return "is";
  return property.kind === "connection"
    ? "is"
    : (fieldOperators(property.fieldType ?? "short_text")[0]?.value ?? "is");
}

function propertyOptions(
  fields: readonly Tables<"field_definitions">[],
  config: TableViewConfigV2,
  relationships: readonly Tables<"relationship_definitions">[],
): QueryProperty[] {
  const options: QueryProperty[] = fields.map((field) => ({
    kind: "field",
    key: field.key,
    label: field.label,
    optionKey: tableViewFieldPropertyKey(field.key),
    fieldType: field.field_type,
  }));
  for (const column of config.columns) {
    if (column.kind !== "connection") continue;
    const relationship = relationships.find(
      (candidate) => candidate.key === column.relationship_key,
    );
    if (!relationship) continue;
    options.push({
      kind: "connection",
      key: column.relationship_key,
      label:
        column.label ??
        (column.direction === "source"
          ? relationship.source_label
          : relationship.target_label),
      optionKey: connectionOptionKey(column.relationship_key, column.direction),
      relationshipKey: column.relationship_key,
      direction: column.direction,
    });
  }
  return options;
}

function singleValueConnection(
  property: QueryProperty,
  relationships: readonly Tables<"relationship_definitions">[],
): boolean {
  if (property.kind !== "connection" || !property.relationshipKey) return false;
  const relationship = relationships.find(
    (candidate) => candidate.key === property.relationshipKey,
  );
  return Boolean(
    relationship &&
    (relationship.cardinality === "one_to_one" ||
      (relationship.cardinality === "one_to_many" &&
        property.direction === "source")),
  );
}

function optionForQueryProperty(
  property: string | null | undefined,
  options: readonly QueryProperty[],
): string {
  if (!property) return "";
  return (
    options.find((option) => option.optionKey === property)?.optionKey ?? ""
  );
}

function valuesFromText(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function TableViewControls({
  businessSlug,
  config,
  currentness,
  fields,
  primaryViewKey,
  relationships = [],
  availableColumns,
  viewName,
  viewKey,
}: Readonly<{
  businessSlug: string;
  config: TableViewConfigV2;
  currentness?: ProductionConfigurationCurrentness | undefined;
  fields: readonly Tables<"field_definitions">[];
  primaryViewKey: string;
  relationships?: readonly Tables<"relationship_definitions">[];
  availableColumns: readonly TableViewColumn[];
  viewName: string;
  viewKey: string;
}>): React.ReactNode {
  const router = useRouter();
  const { setPreview: setGridPreview } = useTableViewPreview();
  const [open, setOpen] = useState(false);
  const [saving, startTransition] = useTransition();
  const [name, setName] = useState(config.role === "saved" ? viewName : "");
  const [columns, setColumns] = useState<readonly TableViewColumn[]>(
    config.role === "saved" ? config.columns : availableColumns,
  );
  const [preview, setPreview] = useState<ProductionPreviewSavedView | null>(
    null,
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [draftCurrentness, setDraftCurrentness] = useState(currentness);
  const optionConfig = useMemo(
    () => ({ ...config, columns: [...columns] }),
    [columns, config],
  );
  const options = useMemo(
    () => propertyOptions(fields, optionConfig, relationships),
    [fields, optionConfig, relationships],
  );
  const initialFilter = config.filters[0];
  const initialFilterProperty = options.find(
    (option) => option.optionKey === initialFilter?.property,
  );
  const [propertyOption, setPropertyOption] = useState(() =>
    optionForQueryProperty(initialFilter?.property, options),
  );
  const selectedProperty = options.find(
    (option) => option.optionKey === propertyOption,
  );
  const [operator, setOperator] = useState<FilterOperator>(
    initialFilter?.operator ?? defaultOperator(selectedProperty),
  );
  const [value, setValue] = useState(
    typeof initialFilter?.value === "string" ? initialFilter.value : "",
  );
  const [secondValue, setSecondValue] = useState(
    Array.isArray(initialFilter?.values) &&
      typeof initialFilter.values[1] === "string"
      ? initialFilter.values[1]
      : "",
  );
  const [connectionSearch, setConnectionSearch] = useState("");
  const [connectionResults, setConnectionResults] = useState<
    readonly { id: string; label: string }[]
  >([]);
  const [connectionValue, setConnectionValue] = useState(
    typeof initialFilter?.value === "string" &&
      initialFilterProperty?.kind === "connection"
      ? initialFilter.value
      : "",
  );
  const [filterTouched, setFilterTouched] = useState(false);
  const [sortOption, setSortOption] = useState(() =>
    optionForQueryProperty(config.sorts[0]?.property, options),
  );
  const [sortDirection, setSortDirection] = useState<
    "ascending" | "descending"
  >(config.sorts[0]?.direction ?? "ascending");
  const [sortTouched, setSortTouched] = useState(false);
  const [groupOption, setGroupOption] = useState(() =>
    optionForQueryProperty(config.group, options),
  );
  const controlsRef = useRef<HTMLElement>(null);
  const previewRequestRef = useRef(0);
  const hasMeaningfulDraft =
    name !== (config.role === "saved" ? viewName : "") ||
    propertyOption !==
      optionForQueryProperty(initialFilter?.property, options) ||
    operator !==
      (initialFilter?.operator ?? defaultOperator(selectedProperty)) ||
    value !==
      (typeof initialFilter?.value === "string" ? initialFilter.value : "") ||
    secondValue !==
      (Array.isArray(initialFilter?.values) &&
      typeof initialFilter.values[1] === "string"
        ? initialFilter.values[1]
        : "") ||
    connectionValue !==
      (typeof initialFilter?.value === "string" &&
      initialFilterProperty?.kind === "connection"
        ? initialFilter.value
        : "") ||
    sortOption !== optionForQueryProperty(config.sorts[0]?.property, options) ||
    sortDirection !== (config.sorts[0]?.direction ?? "ascending") ||
    groupOption !== optionForQueryProperty(config.group, options) ||
    JSON.stringify(columns) !==
      JSON.stringify(
        config.role === "saved" ? config.columns : availableColumns,
      );

  useUnsavedNavigationWarning(open && hasMeaningfulDraft && !saving);

  useEffect(() => {
    setGridPreview(preview);
    return () => setGridPreview(null);
  }, [preview, setGridPreview]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      const target = event.target;
      if (
        target instanceof Node &&
        controlsRef.current &&
        !controlsRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [open]);

  useEffect(() => {
    if (!selectedProperty || selectedProperty.kind !== "connection") {
      return;
    }
    let cancelled = false;
    void searchProductionTableConnectionTargetsAction(businessSlug, viewKey, {
      columnKey: selectedProperty.optionKey,
      search: connectionSearch,
    }).then((result) => {
      if (!cancelled && result.status === "success") {
        setConnectionResults(result.value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [businessSlug, connectionSearch, selectedProperty, viewKey]);

  const filterOperators = selectedProperty
    ? selectedProperty.kind === "connection"
      ? connectionOperators()
      : fieldOperators(selectedProperty.fieldType ?? "short_text")
    : [];
  const sortableOptions = options.filter(
    (option) =>
      option.kind === "field" || singleValueConnection(option, relationships),
  );
  const groupableOptions = options.filter(
    (option) =>
      (option.kind === "field" &&
        ["select", "status", "boolean", "date", "datetime"].includes(
          option.fieldType ?? "",
        )) ||
      singleValueConnection(option, relationships),
  );

  const filterPropertyLabel = config.filters[0]
    ? options.find((option) => option.optionKey === config.filters[0]?.property)
        ?.label
    : undefined;
  const filterSummary = config.filters.length
    ? `Filtered by ${filterPropertyLabel ?? "a property"}${
        config.filters.length > 1 ? ` +${config.filters.length - 1} more` : ""
      }`
    : "No filters";
  const sortPropertyLabel = config.sorts[0]
    ? options.find((option) => option.optionKey === config.sorts[0]?.property)
        ?.label
    : undefined;
  const sortSummary = sortPropertyLabel
    ? `Sorted by ${sortPropertyLabel}`
    : "Default order";
  const groupPropertyLabel = config.group
    ? options.find((option) => option.optionKey === config.group)?.label
    : undefined;
  const groupSummary = groupPropertyLabel
    ? `Grouped by ${groupPropertyLabel}`
    : "No grouping";

  const changeProperty = (nextOptionKey: string): void => {
    const nextProperty = options.find(
      (option) => option.optionKey === nextOptionKey,
    );
    setPropertyOption(nextOptionKey);
    setOperator(defaultOperator(nextProperty));
    setValue("");
    setSecondValue("");
    setConnectionValue("");
    setConnectionSearch("");
    setConnectionResults([]);
    setFilterTouched(true);
    setPreview(null);
  };

  const draftQuery = useCallback((): TableViewQuery => {
    const filters: TableViewQuery["filters"] = [];
    if (!filterTouched && initialFilter) {
      filters.push(initialFilter);
    } else {
      const filterValue =
        selectedProperty?.kind === "connection" ? connectionValue : value;
      const filterBase = selectedProperty
        ? { property: selectedProperty.optionKey, operator }
        : null;
      if (filterBase) {
        if (noValueOperators.has(operator)) {
          filters.push(filterBase);
        } else if (listOperators.has(operator)) {
          const list = valuesFromText(
            operator === "between" ? `${value},${secondValue}` : filterValue,
          );
          if (
            list.length > 0 &&
            (operator !== "between" || list.length === 2)
          ) {
            filters.push({ ...filterBase, values: list });
          }
        } else if (filterValue) {
          filters.push({ ...filterBase, value: filterValue });
        }
      }
    }
    filters.push(...config.filters.slice(1));
    const sortProperty = options.find(
      (option) => option.optionKey === sortOption,
    );
    const groupProperty = options.find(
      (option) => option.optionKey === groupOption,
    );
    const sorts: TableViewQuery["sorts"] =
      !sortTouched && config.sorts[0]
        ? [config.sorts[0]]
        : sortProperty
          ? [{ property: sortProperty.optionKey, direction: sortDirection }]
          : [];
    sorts.push(...config.sorts.slice(1));
    return {
      filters,
      filter_match: config.filter_match,
      sorts,
      group: groupProperty?.optionKey ?? null,
    };
  }, [
    config.filter_match,
    config.filters,
    config.sorts,
    connectionValue,
    filterTouched,
    groupOption,
    initialFilter,
    operator,
    options,
    secondValue,
    selectedProperty,
    sortDirection,
    sortOption,
    sortTouched,
    value,
  ]);

  useEffect(() => {
    if (!open) return;
    const request = previewRequestRef.current + 1;
    previewRequestRef.current = request;
    const timeout = window.setTimeout(() => {
      setFeedback(null);
      void previewProductionSavedViewAction(businessSlug, primaryViewKey, {
        columns,
        query: draftQuery(),
      }).then((result) => {
        if (previewRequestRef.current !== request) return;
        if (result.status === "success") setPreview(result.value);
        else setFeedback(result.message);
      });
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [businessSlug, columns, draftQuery, open, primaryViewKey]);

  const save = (): void => {
    const query = draftQuery();
    if (!draftCurrentness || !name.trim() || !preview) return;
    startTransition(() => {
      setFeedback(null);
      void configureProductionSavedViewAction(businessSlug, primaryViewKey, {
        currentness: draftCurrentness,
        ...(config.role === "saved" ? { viewKey } : {}),
        name,
        columns,
        query,
      }).then((result) => {
        if (result.status === "success") {
          setOpen(false);
          router.push(
            `/app/${encodeURIComponent(businessSlug)}/workspace/${experienceKeyToPath(result.value.viewKey)}#table-view-tab-${result.value.viewKey}`,
          );
        } else {
          setFeedback(result.message);
        }
      });
    });
  };

  const columnId = (column: TableViewColumn): string =>
    column.kind === "field"
      ? `field:${column.field_key}`
      : `connection:${column.relationship_key}:${column.direction}`;
  const columnLabel = (column: TableViewColumn): string => {
    if (column.kind === "field") {
      return (
        fields.find((field) => field.key === column.field_key)?.label ??
        column.field_key
      );
    }
    const relationship = relationships.find(
      (candidate) => candidate.key === column.relationship_key,
    );
    return (
      column.label ??
      (column.direction === "source"
        ? relationship?.source_label
        : relationship?.target_label) ??
      "Connection"
    );
  };
  const selectedConnectionLabel = connectionResults.find(
    (result) => result.id === connectionValue,
  )?.label;
  const staleFeedback = Boolean(
    feedback?.toLocaleLowerCase("en").includes("changed"),
  );

  return (
    <section
      aria-label="Saved view controls"
      className="table-view-controls"
      ref={controlsRef}
    >
      <div className="table-view-query-summary">
        {currentness ? (
          <button
            aria-expanded={open}
            aria-label={
              config.role === "saved" ? "Edit saved view" : "Create saved view"
            }
            className="table-view-query-button"
            onClick={() => setOpen((current) => !current)}
            type="button"
          >
            {config.role === "saved" ? (
              <>
                <span>{filterSummary}</span>
                <span>{sortSummary}</span>
                <span>{groupSummary}</span>
              </>
            ) : (
              <span aria-hidden="true">＋</span>
            )}
            <span aria-hidden="true" className="table-view-controls-chevron">
              ⌄
            </span>
          </button>
        ) : null}
      </div>
      {open && currentness ? (
        <div className="table-view-query-popover">
          <div className="table-view-draft-heading">
            <strong>
              {config.role === "saved" ? "Edit saved view" : "New saved view"}
            </strong>
            <span>Unsaved</span>
          </div>
          <label>
            View name
            <input
              maxLength={120}
              onChange={(event) => {
                setName(event.currentTarget.value);
                setPreview(null);
              }}
              placeholder="e.g. Needs confirming"
              value={name}
            />
          </label>
          <label>
            Filter property
            <select
              onChange={(event) => changeProperty(event.currentTarget.value)}
              value={propertyOption}
            >
              <option value="">No filter</option>
              {options.map((option) => (
                <option key={option.optionKey} value={option.optionKey}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {selectedProperty ? (
            <label>
              Filter rule
              <select
                onChange={(event) => {
                  setOperator(event.currentTarget.value as FilterOperator);
                  setFilterTouched(true);
                  setPreview(null);
                }}
                value={operator}
              >
                {filterOperators.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {selectedProperty?.kind === "connection" &&
          !noValueOperators.has(operator) ? (
            <div className="table-view-connection-filter">
              <input
                aria-label={`Search ${selectedProperty.label}`}
                onChange={(event) =>
                  setConnectionSearch(event.currentTarget.value)
                }
                placeholder={`Find ${selectedProperty.label}`}
                value={connectionSearch}
              />
              {connectionValue ? (
                <button
                  className="table-view-connection-selected"
                  onClick={() => {
                    setConnectionValue("");
                    setFilterTouched(true);
                    setPreview(null);
                  }}
                  type="button"
                >
                  {selectedConnectionLabel ?? "Selected Record"} ×
                </button>
              ) : null}
              {connectionResults.slice(0, 50).map((result) => (
                <button
                  className="table-view-connection-result"
                  key={result.id}
                  onClick={() => {
                    setConnectionValue(result.id);
                    setFilterTouched(true);
                    setPreview(null);
                  }}
                  type="button"
                >
                  {result.label}
                </button>
              ))}
            </div>
          ) : selectedProperty && !noValueOperators.has(operator) ? (
            <input
              aria-label="Filter value"
              onChange={(event) => {
                setValue(event.currentTarget.value);
                setFilterTouched(true);
                setPreview(null);
              }}
              placeholder={operator === "between" ? "First value" : "Value"}
              value={value}
            />
          ) : null}
          {operator === "between" ? (
            <input
              aria-label="Second filter value"
              onChange={(event) => {
                setSecondValue(event.currentTarget.value);
                setFilterTouched(true);
                setPreview(null);
              }}
              placeholder="Second value"
              value={secondValue}
            />
          ) : null}
          <label>
            Sort by
            <select
              onChange={(event) => {
                setSortOption(event.currentTarget.value);
                setSortTouched(true);
                setPreview(null);
              }}
              value={sortOption}
            >
              <option value="">Default order</option>
              {sortableOptions.map((option) => (
                <option key={option.optionKey} value={option.optionKey}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {sortOption ? (
            <select
              aria-label="Sort direction"
              onChange={(event) => {
                setSortDirection(
                  event.currentTarget.value as "ascending" | "descending",
                );
                setSortTouched(true);
                setPreview(null);
              }}
              value={sortDirection}
            >
              <option value="ascending">Ascending</option>
              <option value="descending">Descending</option>
            </select>
          ) : null}
          <label>
            Group by
            <select
              onChange={(event) => {
                setGroupOption(event.currentTarget.value);
                setPreview(null);
              }}
              value={groupOption}
            >
              <option value="">No grouping</option>
              {groupableOptions.map((option) => (
                <option key={option.optionKey} value={option.optionKey}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="table-view-column-picker">
            <legend>Properties shown</legend>
            {availableColumns.map((column) => {
              const id = columnId(column);
              const selectedIndex = columns.findIndex(
                (item) => columnId(item) === id,
              );
              const isTitle =
                column.kind === "field" &&
                column.field_key === config.title_field;
              return (
                <div key={id}>
                  <label>
                    <input
                      checked={selectedIndex >= 0}
                      disabled={isTitle}
                      onChange={(event) => {
                        setPreview(null);
                        setColumns(
                          event.currentTarget.checked
                            ? [...columns, column]
                            : columns.filter((item) => columnId(item) !== id),
                        );
                      }}
                      type="checkbox"
                    />{" "}
                    {columnLabel(column)}
                  </label>
                  {selectedIndex >= 0 ? (
                    <span>
                      <button
                        aria-label={`Move ${columnLabel(column)} earlier`}
                        disabled={selectedIndex === 0}
                        onClick={() => {
                          const next = [...columns];
                          const [item] = next.splice(selectedIndex, 1);
                          if (item) next.splice(selectedIndex - 1, 0, item);
                          setColumns(next);
                          setPreview(null);
                        }}
                        type="button"
                      >
                        ↑
                      </button>
                      <button
                        aria-label={`Move ${columnLabel(column)} later`}
                        disabled={selectedIndex === columns.length - 1}
                        onClick={() => {
                          const next = [...columns];
                          const [item] = next.splice(selectedIndex, 1);
                          if (item) next.splice(selectedIndex + 1, 0, item);
                          setColumns(next);
                          setPreview(null);
                        }}
                        type="button"
                      >
                        ↓
                      </button>
                    </span>
                  ) : null}
                </div>
              );
            })}
          </fieldset>
          {preview ? (
            <div
              aria-label="Unsaved View preview"
              className="table-view-draft-preview"
            >
              <strong>
                {preview.table.rows.length} of {preview.totalCount} matching
                Records
              </strong>
              <span>
                The unsaved filter, sort, group and Property order are live in
                the grid below.
              </span>
            </div>
          ) : null}
          {feedback ? (
            <p className="editor-structural-error" role="alert">
              {feedback}
            </p>
          ) : null}
          {staleFeedback ? (
            <button
              disabled={saving}
              onClick={() =>
                startTransition(() => {
                  void refreshProductionTableCurrentnessAction(
                    businessSlug,
                    primaryViewKey,
                  ).then((result) => {
                    if (result.status === "success") {
                      setDraftCurrentness(result.value);
                      setFeedback(
                        "Latest setup loaded. The grid will recheck this draft before you save it.",
                      );
                      setPreview(null);
                    } else setFeedback(result.message);
                  });
                })
              }
              type="button"
            >
              Refresh and recheck
            </button>
          ) : null}
          {config.role === "saved" ? (
            <div className="table-view-management-actions">
              <p>
                Archiving removes this shared tab without deleting its history
                or source Table.
              </p>
              <button
                disabled={saving}
                onClick={() =>
                  startTransition(() => {
                    if (!draftCurrentness) return;
                    void duplicateProductionSavedViewAction(
                      businessSlug,
                      viewKey,
                      {
                        currentness: draftCurrentness,
                        name: `${name.trim()} copy`.slice(0, 120),
                      },
                    ).then((result) => {
                      if (result.status === "success")
                        router.push(
                          `/app/${encodeURIComponent(businessSlug)}/workspace/${experienceKeyToPath(result.value.viewKey)}#table-view-tab-${result.value.viewKey}`,
                        );
                      else setFeedback(result.message);
                    });
                  })
                }
                type="button"
              >
                Duplicate view
              </button>
              <button
                disabled={saving}
                onClick={() =>
                  startTransition(() => {
                    if (!draftCurrentness) return;
                    void archiveProductionSavedViewAction(
                      businessSlug,
                      viewKey,
                      { currentness: draftCurrentness },
                    ).then((result) => {
                      if (result.status === "success")
                        router.push(
                          `/app/${encodeURIComponent(businessSlug)}/workspace/${experienceKeyToPath(primaryViewKey)}`,
                        );
                      else setFeedback(result.message);
                    });
                  })
                }
                type="button"
              >
                Archive view
              </button>
            </div>
          ) : null}
          <div className="table-view-draft-actions">
            <button
              onClick={() => {
                setOpen(false);
                setPreview(null);
                setFeedback(null);
              }}
              type="button"
            >
              Cancel
            </button>
            <button
              disabled={saving || staleFeedback || !name.trim() || !preview}
              onClick={save}
              type="button"
            >
              {saving ? "Saving…" : "Save view"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
