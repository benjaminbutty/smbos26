import { z } from "zod";

import {
  recordUpdateSelectorClausesSchema,
  type RecordUpdateCanonicalSelector,
  type RecordUpdateField,
  type RecordUpdateSelectorClause,
} from "./schemas";

export const recordUpdateSelectorErrorCodes = [
  "selector_invalid",
  "field_unknown_or_inactive",
  "field_type_mismatch",
  "selector_type_not_supported",
  "option_invalid",
  "option_ambiguous",
] as const;

export type RecordUpdateSelectorErrorCode =
  (typeof recordUpdateSelectorErrorCodes)[number];

const messages: Readonly<Record<RecordUpdateSelectorErrorCode, string>> = {
  selector_invalid: "The Record selector was invalid.",
  field_unknown_or_inactive: "The selected Field is unavailable.",
  field_type_mismatch: "The selected Field type did not match configuration.",
  selector_type_not_supported: "That Field type cannot be used for targeting.",
  option_invalid: "The selected option is not configured for this Field.",
  option_ambiguous: "The selected option is ambiguous in this Field.",
};

export class RecordUpdateSelectorError extends Error {
  readonly code: RecordUpdateSelectorErrorCode;

  constructor(code: RecordUpdateSelectorErrorCode, cause?: unknown) {
    super(messages[code]);
    this.name = "RecordUpdateSelectorError";
    this.code = code;
    this.cause = cause;
  }

  override readonly cause: unknown;
}

const supportedSelectorTypes = new Set([
  "short_text",
  "email",
  "phone",
  "url",
  "number",
  "currency",
  "boolean",
  "date",
  "datetime",
  "select",
  "status",
]);

function normalizeSelectorText(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en");
}

function configuredOptions(field: RecordUpdateField): string[] {
  const options = field.settings_json.options;
  return Array.isArray(options)
    ? options.filter((option): option is string => typeof option === "string")
    : [];
}

function resolveOption(field: RecordUpdateField, requested: string): string {
  const normalized = normalizeSelectorText(requested);
  const matches = configuredOptions(field).filter(
    (option) => normalizeSelectorText(option) === normalized,
  );
  if (matches.length === 0) {
    throw new RecordUpdateSelectorError("option_invalid");
  }
  if (matches.length !== 1) {
    throw new RecordUpdateSelectorError("option_ambiguous");
  }
  return matches[0]!;
}

function canonicalizeClause(
  field: RecordUpdateField,
  clause: RecordUpdateSelectorClause,
): RecordUpdateSelectorClause {
  if (field.field_type !== clause.field_type) {
    throw new RecordUpdateSelectorError("field_type_mismatch");
  }
  if (!supportedSelectorTypes.has(field.field_type)) {
    throw new RecordUpdateSelectorError("selector_type_not_supported");
  }

  switch (clause.field_type) {
    case "short_text":
      return {
        ...clause,
        string_value: normalizeSelectorText(clause.string_value),
      };
    case "select":
    case "status":
      return {
        ...clause,
        option_value: resolveOption(field, clause.option_value),
      };
    case "email":
    case "phone":
    case "url":
    case "number":
    case "currency":
    case "boolean":
    case "date":
    case "datetime":
      return clause;
  }
}

export function parseRecordUpdateSelector(
  input: unknown,
  fields: readonly RecordUpdateField[],
): RecordUpdateSelectorClause[] {
  const parsed = recordUpdateSelectorClausesSchema.safeParse(input);
  if (!parsed.success) {
    throw new RecordUpdateSelectorError("selector_invalid", parsed.error);
  }
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  try {
    return parsed.data
      .map((clause) => {
        const field = fieldsByKey.get(clause.field_key);
        if (!field || !field.is_active) {
          throw new RecordUpdateSelectorError("field_unknown_or_inactive");
        }
        return canonicalizeClause(field, clause);
      })
      .sort((left, right) => left.field_key.localeCompare(right.field_key));
  } catch (cause) {
    if (cause instanceof RecordUpdateSelectorError) {
      throw cause;
    }
    throw new RecordUpdateSelectorError("selector_invalid", cause);
  }
}

export function canonicalizeRecordUpdateSelector(
  objectDefinitionId: string,
  input: unknown,
  fields: readonly RecordUpdateField[],
): RecordUpdateCanonicalSelector {
  const parsedObjectDefinitionId = z.uuid().safeParse(objectDefinitionId);
  if (!parsedObjectDefinitionId.success) {
    throw new RecordUpdateSelectorError(
      "selector_invalid",
      parsedObjectDefinitionId.error,
    );
  }
  return {
    schema_version: 1,
    object_definition_id: parsedObjectDefinitionId.data,
    clauses: parseRecordUpdateSelector(input, fields),
  };
}

export function canonicalRecordUpdateSelectorClausesEqual(
  left: readonly RecordUpdateSelectorClause[],
  right: readonly RecordUpdateSelectorClause[],
): boolean {
  if (left.length !== right.length) return false;
  const canonicalLeft = [...left].sort((a, b) =>
    a.field_key.localeCompare(b.field_key),
  );
  const canonicalRight = [...right].sort((a, b) =>
    a.field_key.localeCompare(b.field_key),
  );
  return JSON.stringify(canonicalLeft) === JSON.stringify(canonicalRight);
}

export { normalizeSelectorText };
