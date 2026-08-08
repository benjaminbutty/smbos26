"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { resolveTenant } from "../../auth/authorization";
import { createServerClient } from "../../db/supabase/server";
import { ExperienceSubmissionError } from "../forms/submission";
import {
  inlineEditFieldKey,
  inlineEditRecordId,
  inlineEditViewKey,
  type InlineEditActionState,
} from "./inline-edit-contract";
import { applyInlineRecordCellEdit } from "./inline-edit-service";

const routeSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

function stringValue(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
}

function errorState(
  message: string,
  recordId?: string | null,
  fieldKey?: string | null,
): InlineEditActionState {
  return {
    status: "error",
    message,
    ...(recordId ? { recordId } : {}),
    ...(fieldKey ? { fieldKey } : {}),
  };
}

export async function updateInlineRecordCell(
  businessSlugInput: string,
  _previousState: InlineEditActionState,
  formData: FormData,
): Promise<InlineEditActionState> {
  const businessSlug = routeSlugSchema.safeParse(businessSlugInput);
  if (!businessSlug.success) {
    return errorState("That edit is no longer available.");
  }

  const viewKey = stringValue(formData, inlineEditViewKey);
  const recordId = stringValue(formData, inlineEditRecordId);
  const fieldKey = stringValue(formData, inlineEditFieldKey);
  const target = { recordId, fieldKey };

  if (!viewKey || !recordId || !fieldKey) {
    return errorState(
      "That edit is no longer available.",
      target.recordId,
      target.fieldKey,
    );
  }

  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug.data, supabase);

  try {
    const record = await applyInlineRecordCellEdit(
      supabase,
      { businessId: tenant.business.id },
      { viewKey, recordId, fieldKey, formData },
    );

    revalidatePath(`/app/${businessSlug.data}`, "layout");
    return { status: "success", record, fieldKey };
  } catch (error) {
    if (error instanceof ExperienceSubmissionError) {
      return errorState(error.message, recordId, fieldKey);
    }

    return errorState(
      "We could not save that value. Check it and try again.",
      recordId,
      fieldKey,
    );
  }
}
