import { z } from "zod";

import type { Json } from "../../../db/supabase/database.types";
import {
  recordCreationFieldValueSchema,
  recordCreationStateSchema,
  type RecordCreationField,
  type RecordCreationFieldValue,
  type RecordCreationData,
  type RecordCreationState,
} from "./schemas";

export const recordCreationCompositionErrorCodes = [
  "state_invalid",
  "object_not_eligible",
  "object_not_current",
  "field_values_invalid",
  "field_unknown_or_inactive",
  "field_type_mismatch",
  "file_field_not_supported",
  "required_field_missing",
  "option_invalid",
  "option_duplicate",
  "value_invalid",
] as const;

export type RecordCreationCompositionErrorCode =
  (typeof recordCreationCompositionErrorCodes)[number];

const messages: Readonly<Record<RecordCreationCompositionErrorCode, string>> = {
  state_invalid: "The Record creation state was invalid.",
  object_not_eligible:
    "The Object is not eligible for standalone Record creation.",
  object_not_current: "The Record creation state is no longer current.",
  field_values_invalid: "The Record Field values were invalid.",
  field_unknown_or_inactive: "The Record Field is unavailable.",
  field_type_mismatch: "The Record Field type did not match configuration.",
  file_field_not_supported: "File Fields are not writable through Builder.",
  required_field_missing: "A required Record Field was omitted.",
  option_invalid: "The Record option is not configured for this Field.",
  option_duplicate: "A multi-select option was repeated.",
  value_invalid: "The Record Field value was invalid.",
};

export class RecordCreationCompositionError extends Error {
  readonly code: RecordCreationCompositionErrorCode;

  constructor(code: RecordCreationCompositionErrorCode) {
    super(messages[code]);
    this.name = "RecordCreationCompositionError";
    this.code = code;
  }
}

export interface RecordCreationPresentationField {
  readonly field_key: string;
  readonly label: string;
  readonly field_type: RecordCreationField["field_type"];
  readonly value: Json;
  readonly formatted_value: string;
  readonly source: "explicit" | "default";
}

export interface RecordCreationComposition {
  readonly object_key: string;
  readonly object_label: string;
  readonly explicit_fields: readonly RecordCreationPresentationField[];
  readonly default_fields: readonly RecordCreationPresentationField[];
  readonly field_values: readonly RecordCreationFieldValue[];
  readonly requested_data: Record<string, Json>;
}

function fail(code: RecordCreationCompositionErrorCode): never {
  throw new RecordCreationCompositionError(code);
}

function normalizeOption(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en");
}

function fieldOptions(field: RecordCreationField): string[] {
  const options = field.settings_json.options;
  return Array.isArray(options)
    ? options.filter((option): option is string => typeof option === "string")
    : [];
}

function canonicalOption(field: RecordCreationField, value: string): string {
  const normalized = normalizeOption(value);
  const match = fieldOptions(field).find(
    (option) => normalizeOption(option) === normalized,
  );
  if (!match) {
    fail("option_invalid");
  }
  return match;
}

function jsonValueForFieldValue(value: RecordCreationFieldValue): Json {
  switch (value.field_type) {
    case "short_text":
    case "long_text":
    case "phone":
    case "url":
      return value.string_value.normalize("NFKC").trim();
    case "email":
      return value.string_value;
    case "number":
    case "currency":
      return value.number_value;
    case "boolean":
      return value.boolean_value;
    case "date":
      return value.date_value;
    case "datetime":
      return value.datetime_value;
    case "select":
    case "status":
      return value.option_value;
    case "multi_select":
      return value.option_values;
  }
}

function formatDate(value: string, includeTime: boolean): string {
  const date = new Date(includeTime ? value : `${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) {
    fail("value_invalid");
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(includeTime
      ? { hour: "2-digit", minute: "2-digit" }
      : { timeZone: "UTC" }),
  }).format(date);
}

function formatValue(field: RecordCreationField, value: Json): string {
  if (value === null || value === "") {
    return "—";
  }
  switch (field.field_type) {
    case "currency": {
      const configuredCurrency = field.settings_json.currency;
      const currency =
        typeof configuredCurrency === "string" &&
        /^[A-Z]{3}$/.test(configuredCurrency)
          ? configuredCurrency
          : "GBP";
      if (typeof value !== "number") {
        return String(value);
      }
      try {
        return new Intl.NumberFormat("en-GB", {
          style: "currency",
          currency,
        }).format(value);
      } catch {
        return new Intl.NumberFormat("en-GB", {
          maximumFractionDigits: 2,
        }).format(value);
      }
    }
    case "number":
      return typeof value === "number"
        ? new Intl.NumberFormat("en-GB").format(value)
        : String(value);
    case "boolean":
      return value ? "Yes" : "No";
    case "date":
      return typeof value === "string"
        ? formatDate(value, false)
        : String(value);
    case "datetime":
      return typeof value === "string"
        ? formatDate(value, true)
        : String(value);
    case "multi_select":
      return Array.isArray(value)
        ? value.map(String).join(", ")
        : String(value);
    case "file":
      return "Configured default";
    default:
      return String(value);
  }
}

function canonicalizeValue(
  field: RecordCreationField,
  raw: RecordCreationFieldValue,
): RecordCreationFieldValue {
  switch (raw.field_type) {
    case "short_text":
    case "long_text":
    case "phone":
    case "url":
      return {
        ...raw,
        string_value: raw.string_value.normalize("NFKC").trim(),
      };
    case "email":
      return raw;
    case "number":
    case "currency":
    case "boolean":
    case "date":
    case "datetime":
      return raw;
    case "select":
    case "status":
      return { ...raw, option_value: canonicalOption(field, raw.option_value) };
    case "multi_select": {
      const values = raw.option_values.map((value) =>
        canonicalOption(field, value),
      );
      if (new Set(values.map(normalizeOption)).size !== values.length) {
        fail("option_duplicate");
      }
      return { ...raw, option_values: values };
    }
  }
}

function validateAndCanonicalizeValues(
  state: RecordCreationState,
  valuesInput: unknown,
): RecordCreationFieldValue[] {
  const parsed = z
    .array(recordCreationFieldValueSchema)
    .min(1)
    .max(50)
    .safeParse(valuesInput);
  if (!parsed.success) {
    fail("field_values_invalid");
  }
  const values = parsed.data;
  const keys = values.map((value) => value.field_key);
  if (new Set(keys).size !== keys.length) {
    fail("field_values_invalid");
  }
  const byKey = new Map(state.fields.map((field) => [field.key, field]));
  const canonical = values.map((value) => {
    const field = byKey.get(value.field_key);
    if (!field || !field.is_active) {
      fail("field_unknown_or_inactive");
    }
    if (field.field_type === "file") {
      fail("file_field_not_supported");
    }
    if (field.field_type !== value.field_type) {
      fail("field_type_mismatch");
    }
    return canonicalizeValue(field, value);
  });
  const canonicalKeys = new Set(canonical.map((value) => value.field_key));
  // Generic Record creation is progressive. Requiredness is evaluated by the
  // contextual Form or specialised trusted operation that invoked creation,
  // not by this generic confirmation composer.
  return state.fields
    .filter((field) => canonicalKeys.has(field.key))
    .map((field) => canonical.find((value) => value.field_key === field.key)!)
    .filter(Boolean);
}

export function composeConfirmedGraphRecordData(
  stateInput: unknown,
  valuesInput: unknown,
): RecordCreationData {
  const state = recordCreationStateSchema.safeParse(stateInput);
  if (!state.success) {
    fail("state_invalid");
  }
  if (!state.data.is_active || !state.data.eligibility.eligible) {
    fail("object_not_eligible");
  }
  const fieldValues = validateAndCanonicalizeValues(state.data, valuesInput);
  const requestedData: Record<string, Json> = {};
  for (const value of fieldValues) {
    requestedData[value.field_key] = jsonValueForFieldValue(value);
  }
  return { requestedData, fieldValues };
}

export function composeRecordCreationPresentation(
  stateInput: unknown,
  valuesInput: unknown,
): RecordCreationComposition {
  const state = recordCreationStateSchema.safeParse(stateInput);
  if (!state.success) {
    fail("state_invalid");
  }
  const composition = composeConfirmedGraphRecordData(state.data, valuesInput);
  const valueByKey = new Map(
    composition.fieldValues.map((value) => [value.field_key, value]),
  );
  const explicitFields: RecordCreationPresentationField[] = [];
  const defaultFields: RecordCreationPresentationField[] = [];
  for (const field of state.data.fields) {
    const explicit = valueByKey.get(field.key);
    if (explicit) {
      const value = jsonValueForFieldValue(explicit);
      explicitFields.push({
        field_key: field.key,
        label: field.label,
        field_type: field.field_type,
        value,
        formatted_value: formatValue(field, value),
        source: "explicit",
      });
      continue;
    }
    if (field.is_active && field.default_value !== null) {
      defaultFields.push({
        field_key: field.key,
        label: field.label,
        field_type: field.field_type,
        value: field.default_value,
        formatted_value: formatValue(field, field.default_value),
        source: "default",
      });
    }
  }
  return {
    object_key: state.data.object_key,
    object_label: state.data.singular_label,
    explicit_fields: explicitFields,
    default_fields: defaultFields,
    field_values: composition.fieldValues,
    requested_data: composition.requestedData,
  };
}
