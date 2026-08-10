import type { Json, Tables } from "../../../db/supabase/database.types";

import type { DirectTableColumnType } from "./schemas";

/**
 * This is deliberately a small, deterministic mirror of the database graph
 * value validator. It is used for the owner-facing explanation before the M5
 * configuration transaction runs; PostgreSQL remains authoritative.
 */
export interface DirectTableTypeCompatibilityInput {
  from: Tables<"field_definitions">["field_type"];
  to: Tables<"field_definitions">["field_type"];
  settings: Json;
  values: readonly (Json | undefined)[];
}

export interface DirectTableTypeCompatibilityResult {
  compatible: boolean;
  incompatibleCount: number;
  examples: readonly string[];
}

function settingsObject(value: Json): Record<string, Json | undefined> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : {};
}

function optionValues(settings: Json): ReadonlySet<string> {
  const options = settingsObject(settings).options;
  return new Set(
    Array.isArray(options)
      ? options.filter((option): option is string => typeof option === "string")
      : [],
  );
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T12:00:00Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

function isValidDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
}

function isValidValue(
  value: Json | undefined,
  fieldType: Tables<"field_definitions">["field_type"],
  settings: Json,
): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  switch (fieldType) {
    case "short_text":
    case "long_text":
    case "phone":
      return typeof value === "string";
    case "number":
    case "currency":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "date":
      return typeof value === "string" && isValidDate(value);
    case "datetime":
      return typeof value === "string" && isValidDateTime(value);
    case "email":
      return (
        typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      );
    case "url":
      return typeof value === "string" && /^https?:\/\/\S+$/i.test(value);
    case "file":
      return (
        typeof value === "string" ||
        (typeof value === "object" && value !== null && !Array.isArray(value))
      );
    case "select":
    case "status":
      return typeof value === "string" && optionValues(settings).has(value);
    case "multi_select":
      return (
        Array.isArray(value) &&
        value.every(
          (item): item is string =>
            typeof item === "string" && optionValues(settings).has(item),
        ) &&
        new Set(value).size === value.length
      );
  }
}

export function directTableSettingsForTypeChange(
  columnType: DirectTableColumnType,
  currentSettings: Json,
  options?: readonly string[],
  currency?: string,
): Record<string, Json> {
  if (columnType === "select" || columnType === "status") {
    return { options: [...(options ?? optionValues(currentSettings))] };
  }
  if (columnType === "currency") {
    const currentCurrency = settingsObject(currentSettings).currency;
    if (currency) {
      return { currency };
    }
    return typeof currentCurrency === "string" &&
      /^[A-Z]{3}$/.test(currentCurrency)
      ? { currency: currentCurrency }
      : {};
  }
  return {};
}

export function assessDirectTableTypeCompatibility(
  input: DirectTableTypeCompatibilityInput,
): DirectTableTypeCompatibilityResult {
  const incompatible = input.values.filter(
    (value) => !isValidValue(value, input.to, input.settings),
  );
  return {
    compatible: incompatible.length === 0,
    incompatibleCount: incompatible.length,
    examples: incompatible.slice(0, 3).map((value) => {
      if (value === undefined || value === null) return "empty";
      if (typeof value === "string") return value.slice(0, 40);
      return JSON.stringify(value).slice(0, 40);
    }),
  };
}

export function directTableTypeLabel(
  fieldType: Tables<"field_definitions">["field_type"],
): string {
  switch (fieldType) {
    case "short_text":
      return "Text";
    case "long_text":
      return "Long text";
    case "number":
      return "Number";
    case "currency":
      return "Currency";
    case "boolean":
      return "Yes / No";
    case "date":
      return "Date";
    case "datetime":
      return "Date and time";
    case "email":
      return "Email";
    case "phone":
      return "Phone";
    case "url":
      return "Website";
    case "select":
      return "Choice";
    case "status":
      return "Status";
    case "multi_select":
      return "Multiple choice";
    case "file":
      return "File";
  }
}
