import { z } from "zod";

import type { Json } from "../../../db/supabase/database.types";
import {
  recordUpdateFieldValueSchema,
  recordUpdateSelectorClausesSchema,
  recordUpdateTargetStateSchema,
  type RecordUpdateCanonicalSelector,
  type RecordUpdateField,
  type RecordUpdateFieldValue,
  type RecordUpdateReadyState,
  type RecordUpdateSelectorClause,
} from "./schemas";
import {
  canonicalRecordUpdateSelectorClausesEqual,
  normalizeSelectorText,
} from "./selector";

export const recordUpdateCompositionErrorCodes = [
  "state_invalid",
  "intent_invalid",
  "object_mismatch",
  "selector_mismatch",
  "field_values_invalid",
  "field_unknown_or_inactive",
  "field_type_mismatch",
  "file_field_not_supported",
  "option_invalid",
  "option_ambiguous",
  "option_duplicate",
  "value_invalid",
  "no_change",
] as const;

export type RecordUpdateCompositionErrorCode =
  (typeof recordUpdateCompositionErrorCodes)[number];

const messages: Readonly<Record<RecordUpdateCompositionErrorCode, string>> = {
  state_invalid: "The Record update state was invalid.",
  intent_invalid: "The Record update intent was invalid.",
  object_mismatch: "The Record update Object did not match the target.",
  selector_mismatch: "The Record selector did not match the server target.",
  field_values_invalid: "The Record update Field values were invalid.",
  field_unknown_or_inactive: "The Record update Field is unavailable.",
  field_type_mismatch:
    "The Record update Field type did not match configuration.",
  file_field_not_supported: "File Fields are not writable through Builder.",
  option_invalid: "The Record option is not configured for this Field.",
  option_ambiguous: "The configured Record option is ambiguous.",
  option_duplicate: "A multi-select option was repeated.",
  value_invalid: "The Record update value was invalid.",
  no_change: "This Record already has those values.",
};

export class RecordUpdateCompositionError extends Error {
  readonly code: RecordUpdateCompositionErrorCode;

  constructor(code: RecordUpdateCompositionErrorCode, cause?: unknown) {
    super(messages[code]);
    this.name = "RecordUpdateCompositionError";
    this.code = code;
    this.cause = cause;
  }

  override readonly cause: unknown;
}

const intentReadyShapeSchema = z
  .object({
    object_key: z.string().min(1).max(80),
    selector_clauses: recordUpdateSelectorClausesSchema,
    field_updates: z.array(recordUpdateFieldValueSchema).min(1).max(5),
  })
  .strict()
  .superRefine((value, context) => {
    const keys = value.field_updates.map((field) => field.field_key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["field_updates"],
        message: "Update Field keys must be unique.",
      });
    }
  });

export interface RecordUpdateSelectorPresentation {
  readonly field_key: string;
  readonly label: string;
  readonly formatted_value: string;
}

export interface RecordUpdateChangeRow {
  readonly field_key: string;
  readonly label: string;
  readonly field_type: RecordUpdateField["field_type"];
  readonly formatted_before: string;
  readonly formatted_after: string;
  readonly new_value: Json;
}

export interface RecordUpdateComposition {
  readonly object_label: string;
  readonly selector_fields: readonly RecordUpdateSelectorPresentation[];
  readonly changes: readonly RecordUpdateChangeRow[];
  readonly canonical_selector: RecordUpdateCanonicalSelector;
  readonly data_patch: Record<string, Json>;
  readonly destination_view_key: string | null;
}

function fail(code: RecordUpdateCompositionErrorCode, cause?: unknown): never {
  throw new RecordUpdateCompositionError(code, cause);
}

function optionsForField(field: RecordUpdateField): string[] {
  const options = field.settings_json.options;
  return Array.isArray(options)
    ? options.filter((option): option is string => typeof option === "string")
    : [];
}

function normalizeOption(value: string): string {
  return normalizeSelectorText(value);
}

function canonicalOption(field: RecordUpdateField, value: string): string {
  const normalized = normalizeOption(value);
  const matches = optionsForField(field).filter(
    (option) => normalizeOption(option) === normalized,
  );
  if (matches.length === 0) fail("option_invalid");
  if (matches.length !== 1) fail("option_ambiguous");
  return matches[0]!;
}

function jsonValueForFieldValue(value: RecordUpdateFieldValue): Json {
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

function canonicalizeValue(
  field: RecordUpdateField,
  value: RecordUpdateFieldValue,
): RecordUpdateFieldValue {
  if (field.field_type === "file") fail("file_field_not_supported");
  if (field.field_type !== value.field_type) fail("field_type_mismatch");
  switch (value.field_type) {
    case "short_text":
    case "long_text":
    case "phone":
    case "url":
      return {
        ...value,
        string_value: value.string_value.normalize("NFKC").trim(),
      };
    case "email":
    case "number":
    case "currency":
    case "boolean":
    case "date":
    case "datetime":
      return value;
    case "select":
    case "status":
      return {
        ...value,
        option_value: canonicalOption(field, value.option_value),
      };
    case "multi_select": {
      const optionValues = value.option_values.map((option) =>
        canonicalOption(field, option),
      );
      if (
        new Set(optionValues.map(normalizeOption)).size !== optionValues.length
      ) {
        fail("option_duplicate");
      }
      return { ...value, option_values: optionValues };
    }
  }
}

function valueEqual(left: Json | undefined, right: Json): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right);
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) fail("value_invalid");
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatValue(
  fieldType: RecordUpdateField["field_type"],
  value: Json,
  settings: Record<string, Json> = {},
): string {
  if (value === null || value === "") return "—";
  switch (fieldType) {
    case "currency": {
      const configuredCurrency = settings.currency;
      const currency =
        typeof configuredCurrency === "string" &&
        /^[A-Z]{3}$/.test(configuredCurrency)
          ? configuredCurrency
          : "GBP";
      if (typeof value !== "number") return String(value);
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
      return typeof value === "string" ? formatDate(value) : String(value);
    case "datetime":
      return typeof value === "string" ? value : String(value);
    case "multi_select":
      return Array.isArray(value)
        ? value.map(String).join(", ")
        : String(value);
    default:
      return String(value);
  }
}

function canonicalizeAgainstServerSelector(
  input: unknown,
  serverSelector: RecordUpdateCanonicalSelector,
): RecordUpdateSelectorClause[] {
  const parsed = recordUpdateSelectorClausesSchema.safeParse(input);
  if (!parsed.success) fail("selector_mismatch", parsed.error);
  const serverByKey = new Map(
    serverSelector.clauses.map((clause) => [clause.field_key, clause]),
  );
  const canonical = parsed.data.map((clause) => {
    const expected = serverByKey.get(clause.field_key);
    if (!expected || expected.field_type !== clause.field_type) {
      fail("selector_mismatch");
    }
    switch (clause.field_type) {
      case "short_text":
        return {
          ...clause,
          string_value: normalizeSelectorText(clause.string_value),
        };
      case "select":
      case "status":
        if (!("option_value" in expected)) fail("selector_mismatch");
        if (
          normalizeOption(clause.option_value) !==
          normalizeOption(expected.option_value)
        ) {
          fail("selector_mismatch");
        }
        return { ...clause, option_value: expected.option_value };
      default:
        return clause;
    }
  });
  if (
    !canonicalRecordUpdateSelectorClausesEqual(
      canonical,
      serverSelector.clauses,
    )
  ) {
    fail("selector_mismatch");
  }
  return canonical.sort((left, right) =>
    left.field_key.localeCompare(right.field_key),
  );
}

export function composeConfirmedGraphRecordUpdate(
  stateInput: unknown,
  intentInput: unknown,
): RecordUpdateComposition {
  const state = recordUpdateTargetStateSchema.safeParse(stateInput);
  if (!state.success || state.data.state !== "ready") {
    fail("state_invalid", state.success ? undefined : state.error);
  }
  const readyState: RecordUpdateReadyState = state.data;
  const intent = intentReadyShapeSchema.safeParse(intentInput);
  if (!intent.success) fail("intent_invalid", intent.error);
  if (intent.data.object_key !== readyState.object_key) {
    fail("object_mismatch");
  }
  const canonicalSelectorClauses = canonicalizeAgainstServerSelector(
    intent.data.selector_clauses,
    readyState.canonical_selector,
  );
  const fieldsByKey = new Map(
    readyState.update_fields.map((field) => [field.key, field]),
  );
  const currentByKey = new Map(
    readyState.current_update_values.map((value) => [
      value.field_key,
      value.value,
    ]),
  );
  const seen = new Set<string>();
  const dataPatch: Record<string, Json> = {};
  const changes: RecordUpdateChangeRow[] = [];
  for (const rawValue of intent.data.field_updates) {
    if (seen.has(rawValue.field_key)) fail("field_values_invalid");
    seen.add(rawValue.field_key);
    const field = fieldsByKey.get(rawValue.field_key);
    if (!field || !field.is_active) fail("field_unknown_or_inactive");
    let value: RecordUpdateFieldValue;
    try {
      value = canonicalizeValue(field, rawValue);
    } catch (cause) {
      if (cause instanceof RecordUpdateCompositionError) throw cause;
      fail("value_invalid", cause);
    }
    const jsonValue = jsonValueForFieldValue(value);
    const currentValue = currentByKey.get(field.key);
    if (valueEqual(currentValue, jsonValue)) continue;
    dataPatch[field.key] = jsonValue;
    changes.push({
      field_key: field.key,
      label: field.label,
      field_type: field.field_type,
      formatted_before: formatValue(
        field.field_type,
        currentValue ?? null,
        field.settings_json,
      ),
      formatted_after: formatValue(
        field.field_type,
        jsonValue,
        field.settings_json,
      ),
      new_value: jsonValue,
    });
  }
  if (changes.length === 0) fail("no_change");
  const selectorFields = readyState.selector_current_values
    .slice()
    .sort((left, right) => left.field_key.localeCompare(right.field_key))
    .map((value) => ({
      field_key: value.field_key,
      label: value.label,
      formatted_value: formatValue(
        value.field_type,
        value.value,
        value.settings_json,
      ),
    }));
  return {
    object_label: readyState.singular_label,
    selector_fields: selectorFields,
    changes,
    canonical_selector: {
      ...readyState.canonical_selector,
      clauses: canonicalSelectorClauses,
    },
    data_patch: dataPatch,
    destination_view_key: readyState.internal_views[0]?.key ?? null,
  };
}

export { formatValue as formatRecordUpdateValue };
