import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createExperienceService } from "../../core/experience/service";
import type {
  FormFieldConfig,
  FormConfig,
} from "../../core/experience/schemas";
import {
  createGraphService,
  GraphServiceError,
} from "../../core/graph/service";
import type { Database, Json, Tables } from "../../db/supabase/database.types";

export class ExperienceSubmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExperienceSubmissionError";
  }
}

function fieldLabel(
  field: Tables<"field_definitions">,
  config: FormFieldConfig,
): string {
  return config.label ?? field.label;
}

function settingsOptions(field: Tables<"field_definitions">): string[] {
  const settings = field.settings_json;

  if (
    typeof settings !== "object" ||
    settings === null ||
    Array.isArray(settings)
  ) {
    return [];
  }

  const options = settings.options;
  return Array.isArray(options)
    ? options.filter((option): option is string => typeof option === "string")
    : [];
}

function valueIsPresent(value: Json | undefined): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return true;
}

function coerceString(
  field: Tables<"field_definitions">,
  config: FormFieldConfig,
  rawValue: FormDataEntryValue | null,
): string | null {
  if (rawValue === null || typeof rawValue !== "string") {
    return null;
  }

  const value = rawValue.trim();
  if (value === "") {
    return null;
  }

  const label = fieldLabel(field, config);
  if (
    field.field_type === "email" &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  ) {
    throw new ExperienceSubmissionError(`Enter a valid ${label}.`);
  }
  if (
    (field.field_type === "url" || field.field_type === "file") &&
    !/^https?:\/\/\S+$/i.test(value)
  ) {
    throw new ExperienceSubmissionError(
      `Enter a complete web address for ${label}.`,
    );
  }
  if (field.field_type === "date") {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(parsed.valueOf()) ||
      parsed.toISOString().slice(0, 10) !== value
    ) {
      throw new ExperienceSubmissionError(`Enter a valid ${label}.`);
    }
  }
  if (
    field.field_type === "datetime" &&
    (!/^\d{4}-\d{2}-\d{2}T/.test(value) ||
      Number.isNaN(new Date(value).valueOf()))
  ) {
    throw new ExperienceSubmissionError(`Enter a valid ${label}.`);
  }
  if (
    (field.field_type === "select" || field.field_type === "status") &&
    !settingsOptions(field).includes(value)
  ) {
    throw new ExperienceSubmissionError(`Choose a valid ${label}.`);
  }

  return value;
}

export function parseConfiguredFieldValue(
  field: Tables<"field_definitions">,
  config: FormFieldConfig,
  formData: FormData,
): Json | undefined {
  if (config.hidden) {
    return config.default_value;
  }

  if (field.field_type === "boolean") {
    const rawValue = formData.get(field.key);
    return (
      typeof rawValue === "string" &&
      ["1", "on", "true", "yes"].includes(rawValue.toLowerCase())
    );
  }

  if (field.field_type === "multi_select") {
    const values = formData
      .getAll(field.key)
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);
    const allowed = settingsOptions(field);

    if (values.some((value) => !allowed.includes(value))) {
      throw new ExperienceSubmissionError(
        `Choose valid options for ${fieldLabel(field, config)}.`,
      );
    }

    return values;
  }

  if (field.field_type === "number" || field.field_type === "currency") {
    const rawValue = formData.get(field.key);
    if (rawValue === null || rawValue === "") {
      return undefined;
    }
    if (typeof rawValue !== "string") {
      throw new ExperienceSubmissionError(
        `Enter a valid ${fieldLabel(field, config)}.`,
      );
    }

    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      throw new ExperienceSubmissionError(
        `Enter a valid ${fieldLabel(field, config)}.`,
      );
    }

    return value;
  }

  const value = coerceString(field, config, formData.get(field.key));
  return value ?? undefined;
}

export function buildConfiguredSubmission(
  fields: Tables<"field_definitions">[],
  config: FormConfig,
  mode: Tables<"forms">["mode"],
  formData: FormData,
  existingValues: Record<string, Json | undefined> = {},
): Record<string, Json> {
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  const submission: Record<string, Json> = {};

  for (const configuredField of config.fields) {
    const field = fieldsByKey.get(configuredField.field);
    if (!field) {
      throw new ExperienceSubmissionError("This form is no longer available.");
    }

    let value = parseConfiguredFieldValue(field, configuredField, formData);
    if (
      value === undefined &&
      mode === "create" &&
      configuredField.default_value !== undefined
    ) {
      value = configuredField.default_value;
    }

    const preservesExistingFile =
      mode === "edit" &&
      field.field_type === "file" &&
      !configuredField.hidden &&
      value === undefined;
    const effectiveValue = preservesExistingFile
      ? existingValues[field.key]
      : value;

    if (field.required && !valueIsPresent(effectiveValue)) {
      throw new ExperienceSubmissionError(
        `${fieldLabel(field, configuredField)} is required.`,
      );
    }

    if (value !== undefined) {
      submission[field.key] = value;
    } else if (mode === "edit" && !preservesExistingFile) {
      submission[field.key] = null;
    }
  }

  return submission;
}

export function buildConfiguredFieldPatch(
  field: Tables<"field_definitions">,
  config: FormFieldConfig,
  formData: FormData,
): Record<string, Json> {
  const value = parseConfiguredFieldValue(field, config, formData);

  if (field.required && !valueIsPresent(value)) {
    throw new ExperienceSubmissionError(
      `${fieldLabel(field, config)} is required.`,
    );
  }

  return { [field.key]: value ?? null };
}

export interface SubmitExperienceFormInput {
  formKey: string;
  formData: FormData;
  recordId?: string;
}

export async function submitExperienceForm(
  client: SupabaseClient<Database>,
  tenant: { businessId: string },
  input: SubmitExperienceFormInput,
): Promise<Tables<"records">> {
  const experience = createExperienceService(client, tenant);
  const form = await experience.loadForm(input.formKey, "internal");
  const isEdit = form.definition.mode === "edit";
  let existingValues: Record<string, Json | undefined> = {};

  if (isEdit !== (input.recordId !== undefined)) {
    throw new ExperienceSubmissionError("This form cannot be used here.");
  }

  if (isEdit) {
    const { data: existing, error } = await client
      .from("records")
      .select("id, data_json")
      .eq("business_id", tenant.businessId)
      .eq("id", input.recordId ?? "")
      .eq("object_definition_id", form.definition.object_definition_id)
      .maybeSingle();

    if (error || !existing) {
      throw new ExperienceSubmissionError(
        "The item you wanted to edit is not available.",
      );
    }

    existingValues =
      typeof existing.data_json === "object" &&
      existing.data_json !== null &&
      !Array.isArray(existing.data_json)
        ? existing.data_json
        : {};
  }

  const data = buildConfiguredSubmission(
    form.fields,
    form.config,
    form.definition.mode,
    input.formData,
    existingValues,
  );
  const graph = createGraphService(client, tenant);

  try {
    if (isEdit) {
      return await graph.updateRecord({
        recordId: input.recordId ?? "",
        dataPatch: data,
      });
    }

    return await graph.createRecord({
      objectDefinitionId: form.definition.object_definition_id,
      data,
    });
  } catch (error) {
    if (error instanceof GraphServiceError) {
      throw new ExperienceSubmissionError(
        "Check the information and try again.",
      );
    }

    throw error;
  }
}
