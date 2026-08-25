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
  | {
      kind: "direct";
      fields: Tables<"field_definitions">[];
      formKey?: string;
    }
  | { kind: "configured_form"; formKey: string }
  | { kind: "unavailable"; message: string; formKey?: string };

// The production row draft supplies one string primary value. Keep structured
// and numeric primary properties on their configured Form until the editor can
// submit those values with their native controls.
const directRowPrimaryFieldTypes = new Set<
  Tables<"field_definitions">["field_type"]
>(["short_text", "long_text", "email", "phone", "url"]);

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

  if (!directRowPrimaryFieldTypes.has(primary.field_type)) {
    return config.create_form_key
      ? { kind: "configured_form", formKey: config.create_form_key }
      : {
          kind: "unavailable",
          message:
            "Add row is not available because this Table's primary property needs a full creation screen.",
        };
  }

  // A Table is an ordinary operational surface: creating a Record captures
  // what the owner knows now. `field.required` remains meaningful to a
  // configured Form, but does not make an ordinary Record unable to exist.
  return {
    kind: "direct",
    fields,
    ...(config.create_form_key ? { formKey: config.create_form_key } : {}),
  };
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

  const availability = await getDirectTableRowCreationAvailability(
    client,
    tenant,
    input.viewKey,
  );
  if (availability.kind !== "direct") {
    throw new ExperienceSubmissionError(
      availability.kind === "unavailable"
        ? availability.message
        : "Use this Table's configured creation screen to add a record.",
    );
  }

  const primary = primaryField(
    activeObjectFields(view),
    view.config as TableViewConfig,
  );
  if (!primary) {
    throw new ExperienceSubmissionError(
      "This Table has no usable primary property.",
    );
  }
  const formConfig = { fields: [{ field: primary.key, hidden: false }] };
  const data = buildConfiguredSubmission(
    [primary],
    formConfig,
    "create",
    input.formData,
  );

  return createGraphService(client, tenant).createRecord({
    objectDefinitionId: view.definition.object_definition_id,
    data,
  });
}
