import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createExperienceService } from "../../core/experience/service";
import type { TableViewConfig } from "../../core/experience/schemas";
import {
  buildConfiguredSubmission,
  ExperienceSubmissionError,
} from "../forms/submission";
import { createGraphService } from "../../core/graph/service";
import type { Database, Tables } from "../../db/supabase/database.types";

export type DirectTableRowCreationAvailability =
  | { kind: "direct"; fields: Tables<"field_definitions">[] }
  | { kind: "configured_form"; formKey: string }
  | { kind: "unavailable"; message: string };

function activeTableFields(
  view: Awaited<
    ReturnType<ReturnType<typeof createExperienceService>["loadView"]>
  >,
  config: TableViewConfig,
): Tables<"field_definitions">[] {
  const fieldsByKey = new Map(view.fields.map((field) => [field.key, field]));
  return config.fields.flatMap((fieldKey) => {
    const field = fieldsByKey.get(fieldKey);
    return field?.is_active ? [field] : [];
  });
}

function activeObjectFields(
  view: Awaited<
    ReturnType<ReturnType<typeof createExperienceService>["loadView"]>
  >,
): Tables<"field_definitions">[] {
  return view.fields.filter((field) => field.is_active);
}

function primaryField(
  fields: Tables<"field_definitions">[],
  config: TableViewConfig,
): Tables<"field_definitions"> | null {
  const key = config.title_field ?? config.fields[0];
  return fields.find((field) => field.key === key) ?? null;
}

function usableDefault(
  value: Tables<"field_definitions">["default_value"],
): boolean {
  if (value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return !Array.isArray(value) || value.length > 0;
}

export async function getDirectTableRowCreationAvailability(
  client: SupabaseClient<Database>,
  tenant: { businessId: string },
  viewKey: string,
): Promise<DirectTableRowCreationAvailability> {
  const experience = createExperienceService(client, tenant);
  const view = await experience.loadView(viewKey, "internal");
  if (view.definition.view_type !== "table") {
    return {
      kind: "unavailable",
      message: "Add row is only available in Tables.",
    };
  }
  const config = view.config as TableViewConfig;
  if (config.create_form_key) {
    return { kind: "configured_form", formKey: config.create_form_key };
  }

  const fields = activeTableFields(view, config);
  const activeFields = activeObjectFields(view);
  const primary = primaryField(activeFields, config);
  if (
    !primary ||
    fields.length === 0 ||
    !fields.some((field) => field.key === primary.key)
  ) {
    return {
      kind: "unavailable",
      message:
        "Add row is not available because this Table has no usable primary column.",
    };
  }

  const missingDefault = activeFields.find(
    (field) =>
      field.key !== primary.key &&
      field.required &&
      !usableDefault(field.default_value),
  );
  return missingDefault
    ? {
        kind: "unavailable",
        message: `Add row needs a value for ${missingDefault.label}. Use the configured creation screen for this Table.`,
      }
    : { kind: "direct", fields };
}

export async function createDirectTableRow(
  client: SupabaseClient<Database>,
  tenant: { businessId: string },
  input: { viewKey: string; formData: FormData },
): Promise<Tables<"records">> {
  const experience = createExperienceService(client, tenant);
  const view = await experience.loadView(input.viewKey, "internal");
  if (view.definition.view_type !== "table") {
    throw new ExperienceSubmissionError("Add row is only available in Tables.");
  }

  const config = view.config as TableViewConfig;
  if (config.create_form_key) {
    throw new ExperienceSubmissionError(
      "This Table uses its configured creation screen.",
    );
  }

  const fields = activeObjectFields(view);
  const formConfig = {
    fields: fields.map((field) => ({
      field: field.key,
      hidden: false,
      ...(field.default_value !== null
        ? { default_value: field.default_value }
        : {}),
    })),
  };
  const data = buildConfiguredSubmission(
    fields,
    formConfig,
    "create",
    input.formData,
  );

  return createGraphService(client, tenant).createRecord({
    objectDefinitionId: view.definition.object_definition_id,
    data,
  });
}
