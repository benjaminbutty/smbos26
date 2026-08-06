import { z } from "zod";

import type { Json } from "../../../db/supabase/database.types";
import {
  recordUpdateFieldValueSchema,
  recordUpdateSelectorSchema,
  recordUpdateTargetStateSchema,
  type RecordUpdateField,
  type RecordUpdateFieldValue,
  type RecordUpdateReadyState,
} from "./schemas";

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
    selector: recordUpdateSelectorSchema,
    field_updates: z.array(recordUpdateFieldValueSchema).min(1).max(3),
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
  readonly selector: RecordUpdateSelectorPresentation;
  readonly changes: readonly RecordUpdateChangeRow[];
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

function jsonValueForFieldValue(value: RecordUpdateFieldValue): Json {
  switch (value.field_type) {
    case "short_text":
    case "long_text":
    case "phone":
    case "url":
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

function validateValue(
  field: RecordUpdateField,
  value: RecordUpdateFieldValue,
): RecordUpdateFieldValue {
  if (field.field_type === "file") fail("file_field_not_supported");
  if (field.field_type !== value.field_type) fail("field_type_mismatch");

  switch (value.field_type) {
    case "select":
    case "status":
      if (!optionsForField(field).includes(value.option_value)) {
        fail("option_invalid");
      }
      return value;
    case "multi_select": {
      const options = optionsForField(field);
      if (value.option_values.some((option) => !options.includes(option))) {
        fail("option_invalid");
      }
      if (new Set(value.option_values).size !== value.option_values.length) {
        fail("option_duplicate");
      }
      return value;
    }
    default:
      return value;
  }
}

function valueEqual(left: Json | undefined, right: Json): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
  if (
    intent.data.selector.field_key !== readyState.selector.field_key ||
    intent.data.selector.field_type !== readyState.selector.field_type
  ) {
    fail("selector_mismatch");
  }

  const fieldsByKey = new Map(
    readyState.update_fields.map((field) => [field.key, field]),
  );
  const currentByKey = new Map(
    readyState.current_update_values.map((value) => [
      value.field_key,
      value.value,
    ]),
  );
  const dataPatch: Record<string, Json> = {};
  const changes: RecordUpdateChangeRow[] = [];

  for (const rawValue of intent.data.field_updates) {
    const field = fieldsByKey.get(rawValue.field_key);
    if (!field || !field.is_active) fail("field_unknown_or_inactive");
    let value: RecordUpdateFieldValue;
    try {
      value = validateValue(field, rawValue);
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

  return {
    object_label: readyState.singular_label,
    selector: {
      field_key: readyState.selector.field_key,
      label: readyState.selector.label,
      formatted_value: formatValue(
        readyState.selector.field_type,
        readyState.selector.value,
        readyState.selector.settings_json,
      ),
    },
    changes,
    data_patch: dataPatch,
    destination_view_key: readyState.destination_view_key,
  };
}

export { formatValue as formatRecordUpdateValue };
