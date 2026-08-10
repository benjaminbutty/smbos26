"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import type {
  TableViewConfigV2,
  TableViewFilter,
  TableViewQuery,
} from "../../core/experience/schemas";
import {
  tableViewConnectionPropertyKey,
  tableViewFieldPropertyKey,
} from "../../core/experience/schemas";
import type { Tables } from "../../db/supabase/database.types";
import type { ProductionConfigurationCurrentness } from "../editor-kernel/production/action-types";
import {
  searchProductionTableConnectionTargetsAction,
  updateProductionSavedViewQueryAction,
} from "../editor-kernel/production/production-table-actions";

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
  relationships = [],
  viewKey,
}: Readonly<{
  businessSlug: string;
  config: TableViewConfigV2;
  currentness?: ProductionConfigurationCurrentness | undefined;
  fields: readonly Tables<"field_definitions">[];
  relationships?: readonly Tables<"relationship_definitions">[];
  viewKey: string;
}>): React.ReactNode {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, startTransition] = useTransition();
  const options = useMemo(
    () => propertyOptions(fields, config, relationships),
    [config, fields, relationships],
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
  const [sortOption, setSortOption] = useState(() =>
    optionForQueryProperty(config.sorts[0]?.property, options),
  );
  const [sortDirection, setSortDirection] = useState<
    "ascending" | "descending"
  >(config.sorts[0]?.direction ?? "ascending");
  const [groupOption, setGroupOption] = useState(() =>
    optionForQueryProperty(config.group, options),
  );

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

  if (config.role !== "saved") {
    return null;
  }

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
  };

  const save = (): void => {
    const filters: TableViewQuery["filters"] = [];
    const filterValue =
      selectedProperty?.kind === "connection" ? connectionValue : value;
    const filterBase = selectedProperty
      ? {
          property: selectedProperty.optionKey,
          operator,
        }
      : null;
    if (filterBase) {
      if (noValueOperators.has(operator)) {
        filters.push(filterBase);
      } else if (listOperators.has(operator)) {
        const list = valuesFromText(
          operator === "between" ? `${value},${secondValue}` : filterValue,
        );
        if (list.length > 0 && (operator !== "between" || list.length === 2)) {
          filters.push({ ...filterBase, values: list });
        }
      } else if (filterValue) {
        filters.push({ ...filterBase, value: filterValue });
      }
    }
    const sortProperty = options.find(
      (option) => option.optionKey === sortOption,
    );
    const groupProperty = options.find(
      (option) => option.optionKey === groupOption,
    );
    const query: TableViewQuery = {
      filters,
      filter_match: "all",
      sorts: sortProperty
        ? [{ property: sortProperty.optionKey, direction: sortDirection }]
        : [],
      group: groupProperty?.optionKey ?? null,
    };
    if (!currentness) return;
    startTransition(() => {
      void updateProductionSavedViewQueryAction(businessSlug, viewKey, {
        currentness,
        query,
      }).then((result) => {
        if (result.status === "success") {
          setOpen(false);
          router.refresh();
        }
      });
    });
  };

  const selectedConnectionLabel = connectionResults.find(
    (result) => result.id === connectionValue,
  )?.label;

  return (
    <section aria-label="Saved view controls" className="table-view-controls">
      <div className="table-view-query-summary">
        <span>
          {config.filters.length > 0
            ? `${config.filters.length} filter${config.filters.length === 1 ? "" : "s"}`
            : "No filters"}
        </span>
        <span aria-hidden="true">·</span>
        <span>{config.sorts.length > 0 ? "Sorted" : "Default order"}</span>
        <span aria-hidden="true">·</span>
        <span>{config.group ? "Grouped" : "No grouping"}</span>
        {currentness ? (
          <button
            aria-expanded={open}
            className="table-view-query-button"
            onClick={() => setOpen((current) => !current)}
            type="button"
          >
            Filter, sort, group
          </button>
        ) : null}
      </div>
      {open && currentness ? (
        <div className="table-view-query-popover">
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
                onChange={(event) =>
                  setOperator(event.currentTarget.value as FilterOperator)
                }
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
                  onClick={() => setConnectionValue("")}
                  type="button"
                >
                  {selectedConnectionLabel ?? "Selected Record"} ×
                </button>
              ) : null}
              {connectionResults.slice(0, 50).map((result) => (
                <button
                  className="table-view-connection-result"
                  key={result.id}
                  onClick={() => setConnectionValue(result.id)}
                  type="button"
                >
                  {result.label}
                </button>
              ))}
            </div>
          ) : selectedProperty && !noValueOperators.has(operator) ? (
            <input
              aria-label="Filter value"
              onChange={(event) => setValue(event.currentTarget.value)}
              placeholder={operator === "between" ? "First value" : "Value"}
              value={value}
            />
          ) : null}
          {operator === "between" ? (
            <input
              aria-label="Second filter value"
              onChange={(event) => setSecondValue(event.currentTarget.value)}
              placeholder="Second value"
              value={secondValue}
            />
          ) : null}
          <label>
            Sort by
            <select
              onChange={(event) => setSortOption(event.currentTarget.value)}
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
              onChange={(event) =>
                setSortDirection(
                  event.currentTarget.value as "ascending" | "descending",
                )
              }
              value={sortDirection}
            >
              <option value="ascending">Ascending</option>
              <option value="descending">Descending</option>
            </select>
          ) : null}
          <label>
            Group by
            <select
              onChange={(event) => setGroupOption(event.currentTarget.value)}
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
          <button disabled={saving} onClick={save} type="button">
            {saving ? "Saving…" : "Save view"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
