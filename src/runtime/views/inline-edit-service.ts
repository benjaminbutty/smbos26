import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { createExperienceService } from "../../core/experience/service";
import {
  isDirectTableEditableFieldType,
  isInlineEditableFieldType,
} from "../../core/experience/inline-edit";
import type {
  FormFieldConfig,
  TableViewConfig,
} from "../../core/experience/schemas";
import { graphKeySchema } from "../../core/graph/schemas";
import {
  buildConfiguredFieldPatch,
  ExperienceSubmissionError,
} from "../forms/submission";
import {
  createGraphService,
  GraphServiceError,
} from "../../core/graph/service";
import type { Database, Tables } from "../../db/supabase/database.types";

const inlineRecordCellEditInputSchema = z.object({
  viewKey: graphKeySchema,
  recordId: z.uuid(),
  fieldKey: graphKeySchema,
});

export interface InlineRecordCellEditInput {
  viewKey: string;
  recordId: string;
  fieldKey: string;
  formData: FormData;
}

export async function applyInlineRecordCellEdit(
  client: SupabaseClient<Database>,
  tenant: { businessId: string },
  input: InlineRecordCellEditInput,
): Promise<Tables<"records">> {
  const value = inlineRecordCellEditInputSchema.parse(input);
  const experience = createExperienceService(client, tenant);
  const view = await experience.loadView(value.viewKey, "internal");

  if (view.definition.view_type !== "table") {
    throw new ExperienceSubmissionError(
      "Inline editing is only available in Table screens.",
    );
  }

  const tableConfig = view.config as TableViewConfig;
  const editFormKey = tableConfig.edit_form_key;
  if (!editFormKey) {
    throw new ExperienceSubmissionError(
      "This screen does not have an inline edit form.",
    );
  }

  const form = await experience.loadForm(editFormKey, "internal");
  if (
    form.definition.mode !== "edit" ||
    form.definition.business_id !== view.definition.business_id ||
    form.definition.object_definition_id !==
      view.definition.object_definition_id
  ) {
    throw new ExperienceSubmissionError(
      "This screen's edit form is not available.",
    );
  }

  if (!tableConfig.fields.includes(value.fieldKey)) {
    throw new ExperienceSubmissionError(
      "That value is not part of this screen.",
    );
  }

  const field = view.fields.find(
    (candidate) =>
      candidate.key === value.fieldKey &&
      candidate.business_id === view.definition.business_id &&
      candidate.object_definition_id === view.definition.object_definition_id &&
      candidate.is_active,
  );
  if (!field || !isInlineEditableFieldType(field.field_type)) {
    throw new ExperienceSubmissionError(
      "That value is available through the full edit form.",
    );
  }

  const configuredField = form.config.fields.find(
    (candidate) => candidate.field === value.fieldKey,
  );
  if (!configuredField || configuredField.hidden) {
    throw new ExperienceSubmissionError(
      "That value is not available for inline editing.",
    );
  }

  const { data: record, error: recordError } = await client
    .from("records")
    .select("*")
    .eq("business_id", tenant.businessId)
    .eq("id", value.recordId)
    .eq("object_definition_id", view.definition.object_definition_id)
    .eq("record_status", "active")
    .maybeSingle();
  if (recordError || !record) {
    throw new ExperienceSubmissionError(
      "That item is no longer available for editing.",
    );
  }

  const patch = buildConfiguredFieldPatch(
    field,
    configuredField,
    input.formData,
  );

  try {
    return await createGraphService(client, tenant).updateRecord({
      recordId: record.id,
      dataPatch: patch,
    });
  } catch (error) {
    if (error instanceof GraphServiceError) {
      throw new ExperienceSubmissionError(
        "We could not save that value. Check it and try again.",
      );
    }
    throw error;
  }
}

export interface DirectTableRecordCellEditInput {
  viewKey: string;
  recordId: string;
  fieldKey: string;
  formData: FormData;
}

const editorValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);

export interface DirectTableRecordTypedCellEditInput {
  viewKey: string;
  recordId: string;
  fieldKey: string;
  value: string | number | boolean | readonly string[] | null;
}

export async function applyDirectTableRecordCellEditValue(
  client: SupabaseClient<Database>,
  tenant: { businessId: string },
  input: DirectTableRecordTypedCellEditInput,
): Promise<Tables<"records">> {
  const value = z
    .object({
      viewKey: graphKeySchema,
      recordId: z.uuid(),
      fieldKey: graphKeySchema,
      value: editorValueSchema,
    })
    .parse(input);
  const formData = new FormData();
  if (Array.isArray(value.value)) {
    for (const item of value.value) {
      formData.append(value.fieldKey, item);
    }
  } else if (value.value === null) {
    formData.set(value.fieldKey, "");
  } else if (typeof value.value === "boolean") {
    formData.set(value.fieldKey, value.value ? "true" : "false");
  } else {
    formData.set(value.fieldKey, String(value.value));
  }

  return applyDirectTableRecordCellEditWithScope(
    client,
    tenant,
    {
      viewKey: value.viewKey,
      recordId: value.recordId,
      fieldKey: value.fieldKey,
      formData,
    },
    false,
  );
}

export async function applyDirectTableRecordCellEdit(
  client: SupabaseClient<Database>,
  tenant: { businessId: string },
  input: DirectTableRecordCellEditInput,
): Promise<Tables<"records">> {
  return applyDirectTableRecordCellEditWithScope(client, tenant, input, false);
}

export async function applyProductionTableRecordCellEditValue(
  client: SupabaseClient<Database>,
  tenant: { businessId: string },
  input: DirectTableRecordTypedCellEditInput,
): Promise<Tables<"records">> {
  const value = z
    .object({
      viewKey: graphKeySchema,
      recordId: z.uuid(),
      fieldKey: graphKeySchema,
      value: editorValueSchema,
    })
    .parse(input);
  const formData = new FormData();
  if (Array.isArray(value.value)) {
    for (const item of value.value) {
      formData.append(value.fieldKey, item);
    }
  } else if (value.value === null) {
    formData.set(value.fieldKey, "");
  } else if (typeof value.value === "boolean") {
    formData.set(value.fieldKey, value.value ? "true" : "false");
  } else {
    formData.set(value.fieldKey, String(value.value));
  }

  return applyDirectTableRecordCellEditWithScope(
    client,
    tenant,
    {
      viewKey: value.viewKey,
      recordId: value.recordId,
      fieldKey: value.fieldKey,
      formData,
    },
    true,
  );
}

async function applyDirectTableRecordCellEditWithScope(
  client: SupabaseClient<Database>,
  tenant: { businessId: string },
  input: DirectTableRecordCellEditInput,
  allowAdditionalTableFields: boolean,
): Promise<Tables<"records">> {
  const value = inlineRecordCellEditInputSchema.parse(input);
  const experience = createExperienceService(client, tenant);
  const view = await experience.loadView(value.viewKey, "internal");

  if (view.definition.view_type !== "table") {
    throw new ExperienceSubmissionError(
      "Direct editing is only available in Table screens.",
    );
  }

  const tableConfig = view.config as TableViewConfig;
  if (
    !allowAdditionalTableFields &&
    !tableConfig.fields.includes(value.fieldKey)
  ) {
    throw new ExperienceSubmissionError(
      "That value is not part of this screen.",
    );
  }

  const field = view.fields.find(
    (candidate) =>
      candidate.key === value.fieldKey &&
      candidate.business_id === view.definition.business_id &&
      candidate.object_definition_id === view.definition.object_definition_id &&
      candidate.is_active,
  );
  if (!field || !isDirectTableEditableFieldType(field.field_type)) {
    throw new ExperienceSubmissionError(
      "That value cannot be edited directly in this Table.",
    );
  }

  let configuredField: FormFieldConfig = {
    field: value.fieldKey,
    hidden: false,
  };
  if (tableConfig.edit_form_key) {
    let form;
    try {
      form = await experience.loadForm(tableConfig.edit_form_key, "internal");
    } catch {
      throw new ExperienceSubmissionError(
        "This Table's edit Form is not available.",
      );
    }
    if (
      form.definition.mode !== "edit" ||
      form.definition.business_id !== view.definition.business_id ||
      form.definition.object_definition_id !==
        view.definition.object_definition_id
    ) {
      throw new ExperienceSubmissionError(
        "This Table's edit Form is not available.",
      );
    }
    const formField = form.config.fields.find(
      (candidate) => candidate.field === value.fieldKey,
    );
    if (!formField || formField.hidden) {
      throw new ExperienceSubmissionError(
        "That value is not available through this Table's edit Form.",
      );
    }
    configuredField = formField;
  }

  const { data: record, error: recordError } = await client
    .from("records")
    .select("*")
    .eq("business_id", tenant.businessId)
    .eq("id", value.recordId)
    .eq("object_definition_id", view.definition.object_definition_id)
    .eq("record_status", "active")
    .maybeSingle();
  if (recordError || !record) {
    throw new ExperienceSubmissionError(
      "That item is no longer available for editing.",
    );
  }

  const patch = buildConfiguredFieldPatch(
    field,
    configuredField,
    input.formData,
    { enforceRequired: false },
  );

  try {
    return await createGraphService(client, tenant).updateRecord({
      recordId: record.id,
      dataPatch: patch,
    });
  } catch (error) {
    if (error instanceof GraphServiceError) {
      throw new ExperienceSubmissionError(
        "We could not save that value. Check it and try again.",
      );
    }
    throw error;
  }
}
