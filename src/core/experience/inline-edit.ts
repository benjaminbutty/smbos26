import type { FormConfig } from "./schemas";
import type { Tables } from "../../db/supabase/database.types";

export const inlineEditableFieldTypes = [
  "short_text",
  "number",
  "currency",
  "boolean",
  "select",
  "status",
] as const satisfies readonly Tables<"field_definitions">["field_type"][];

export type InlineEditableFieldType = (typeof inlineEditableFieldTypes)[number];

export interface InlineEditEligibility {
  formKey: string;
  fieldKeys: string[];
}

export function isInlineEditableFieldType(
  fieldType: Tables<"field_definitions">["field_type"],
): fieldType is InlineEditableFieldType {
  return (inlineEditableFieldTypes as readonly string[]).includes(fieldType);
}

export function inlineEditableFieldKeys(
  tableFieldKeys: readonly string[],
  fields: readonly Tables<"field_definitions">[],
  formConfig: FormConfig,
): string[] {
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  const formFieldsByKey = new Map(
    formConfig.fields.map((configuredField) => [
      configuredField.field,
      configuredField,
    ]),
  );

  return tableFieldKeys.filter((fieldKey) => {
    const field = fieldsByKey.get(fieldKey);
    const configuredField = formFieldsByKey.get(fieldKey);

    return Boolean(
      field &&
      field.is_active &&
      isInlineEditableFieldType(field.field_type) &&
      configuredField &&
      !configuredField.hidden,
    );
  });
}
