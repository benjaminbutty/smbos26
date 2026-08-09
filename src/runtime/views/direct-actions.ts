"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { hasCapability, resolveTenant } from "../../auth/authorization";
import {
  DirectTableComposerError,
  directTableOwnerMessage,
} from "../../core/configuration/direct-tables/composer";
import {
  applyDirectTableAction,
  DirectTableServiceError,
  undoDirectTableAction as undoDirectTableConfigurationAction,
} from "../../core/configuration/direct-tables/service";
import {
  directTableCurrentnessSchema,
  directTableIntentSchema,
  directTableUndoIntentSchema,
} from "../../core/configuration/direct-tables/schemas";
import { createServerClient } from "../../db/supabase/server";
import { ExperienceSubmissionError } from "../forms/submission";
import { experienceKeyToPath } from "../routing";
import {
  applyDirectTableRecordCellEdit,
  DirectTableRecordCellEditInput,
} from "./inline-edit-service";
import { createDirectTableRow } from "./direct-table-record-service";
import type { Tables } from "../../db/supabase/database.types";

const routeSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const keySchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_]*$/);

export interface DirectTableFormState {
  status: "idle" | "error";
  message?: string;
}

export interface DirectTableCellActionState {
  status: "idle" | "success" | "error";
  record?: Tables<"records">;
  recordId?: string;
  fieldKey?: string;
  message?: string;
}

export interface DirectTableRowActionState {
  status: "idle" | "success" | "error";
  record?: Tables<"records">;
  message?: string;
}

function formString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" ? value : null;
}

function routePath(businessSlug: string, viewKey?: string): string {
  const parsedViewKey = viewKey ? keySchema.safeParse(viewKey) : null;
  return parsedViewKey?.success
    ? `/app/${encodeURIComponent(businessSlug)}/workspace/${experienceKeyToPath(parsedViewKey.data)}`
    : `/app/${encodeURIComponent(businessSlug)}`;
}

function ownerMessage(error: unknown): string {
  if (error instanceof DirectTableComposerError) {
    return directTableOwnerMessage(error.code);
  }
  if (error instanceof DirectTableServiceError) {
    return error.message;
  }
  if (error instanceof ExperienceSubmissionError) {
    return error.message;
  }
  if (error instanceof z.ZodError) {
    return "Check the Table details and try again.";
  }
  return "That Table change could not be completed safely. Reload and try again.";
}

function currentnessFromForm(formData: FormData) {
  return directTableCurrentnessSchema.parse({
    expectedBaseVersionId: formString(formData, "expectedBaseVersionId"),
    expectedHeadRevision: Number(
      formString(formData, "expectedHeadRevision") ?? "",
    ),
  });
}

async function requireConfigurationActor(businessSlugInput: string) {
  const businessSlug = routeSlugSchema.parse(businessSlugInput);
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  if (!hasCapability(tenant.membership.role, "manage_configuration")) {
    throw new DirectTableServiceError(
      "Owner or Admin access is required for Table changes.",
      { message: "configuration_owner_or_admin_required" },
    );
  }
  return { businessSlug, supabase, tenant };
}

async function applyStructuralAction(
  businessSlugInput: string,
  formData: FormData,
  intentInput: unknown,
): Promise<never> {
  const viewKey = formString(formData, "viewKey") ?? undefined;
  const businessSlug = routeSlugSchema.parse(businessSlugInput);
  let result: Awaited<ReturnType<typeof applyDirectTableAction>>;
  try {
    const { supabase, tenant } = await requireConfigurationActor(businessSlug);
    result = await applyDirectTableAction(
      supabase,
      { businessId: tenant.business.id, actorId: tenant.user.id },
      { currentness: currentnessFromForm(formData), intent: intentInput },
    );
  } catch (error) {
    redirect(
      `${routePath(businessSlug, viewKey)}?error=${encodeURIComponent(ownerMessage(error))}`,
    );
  }
  if (!result) {
    redirect(
      `${routePath(businessSlug, viewKey)}?error=${encodeURIComponent("That Table change could not be completed safely.")}`,
    );
  }
  revalidatePath(routePath(businessSlug, result.composed?.viewKey), "page");
  revalidatePath(`/app/${businessSlug}`, "layout");
  const destination = routePath(
    businessSlug,
    result.composed?.viewKey ?? viewKey,
  );
  redirect(
    `${destination}?message=${encodeURIComponent("Table updated")}&undoVersion=${encodeURIComponent(result.changeSet.applied_version_id ?? "")}`,
  );
}

export async function createDirectTableAction(
  businessSlugInput: string,
  _previousState: DirectTableFormState,
  formData: FormData,
): Promise<DirectTableFormState> {
  const businessSlug = routeSlugSchema.safeParse(businessSlugInput);
  if (!businessSlug.success) {
    return { status: "error", message: "That Table is no longer available." };
  }
  const title = formString(formData, "title");
  let result: Awaited<ReturnType<typeof applyDirectTableAction>>;
  try {
    const intent = directTableIntentSchema.parse({
      action: "create_table",
      title,
    });
    const { supabase, tenant } = await requireConfigurationActor(
      businessSlug.data,
    );
    result = await applyDirectTableAction(
      supabase,
      { businessId: tenant.business.id, actorId: tenant.user.id },
      { currentness: currentnessFromForm(formData), intent },
    );
  } catch (error) {
    return { status: "error", message: ownerMessage(error) };
  }
  const viewKey = result?.composed?.viewKey;
  if (!viewKey || !result) {
    return { status: "error", message: "The new Table could not be opened." };
  }
  revalidatePath(`/app/${businessSlug.data}`, "layout");
  redirect(
    `${routePath(businessSlug.data, viewKey)}?message=${encodeURIComponent("Table created")}&undoVersion=${encodeURIComponent(result.changeSet.applied_version_id ?? "")}`,
  );
}

export async function renameDirectTableAction(
  businessSlug: string,
  formData: FormData,
): Promise<never> {
  return applyStructuralAction(businessSlug, formData, {
    action: "rename_table",
    viewKey: formString(formData, "viewKey"),
    title: formString(formData, "title"),
  });
}

export async function addDirectTableColumnAction(
  businessSlug: string,
  formData: FormData,
): Promise<never> {
  const optionsJson = formString(formData, "options");
  let options: unknown;
  try {
    options = optionsJson ? JSON.parse(optionsJson) : undefined;
  } catch {
    options = undefined;
  }
  return applyStructuralAction(businessSlug, formData, {
    action: "add_column",
    viewKey: formString(formData, "viewKey"),
    label: formString(formData, "label"),
    columnType: formString(formData, "columnType"),
    ...(options === undefined ? {} : { options }),
  });
}

export async function renameDirectTableColumnAction(
  businessSlug: string,
  formData: FormData,
): Promise<never> {
  return applyStructuralAction(businessSlug, formData, {
    action: "rename_column",
    viewKey: formString(formData, "viewKey"),
    fieldKey: formString(formData, "fieldKey"),
    label: formString(formData, "label"),
  });
}

export async function updateDirectTableOptionsAction(
  businessSlug: string,
  formData: FormData,
): Promise<never> {
  const optionsJson = formString(formData, "options");
  let options: unknown;
  try {
    options = optionsJson ? JSON.parse(optionsJson) : undefined;
  } catch {
    options = undefined;
  }
  return applyStructuralAction(businessSlug, formData, {
    action: "update_column_options",
    viewKey: formString(formData, "viewKey"),
    fieldKey: formString(formData, "fieldKey"),
    options,
  });
}

export async function reorderDirectTableColumnsAction(
  businessSlug: string,
  formData: FormData,
): Promise<never> {
  const fieldKeysJson = formString(formData, "fieldKeys");
  let fieldKeys: unknown;
  try {
    fieldKeys = fieldKeysJson ? JSON.parse(fieldKeysJson) : undefined;
  } catch {
    fieldKeys = undefined;
  }
  return applyStructuralAction(businessSlug, formData, {
    action: "reorder_columns",
    viewKey: formString(formData, "viewKey"),
    fieldKeys,
  });
}

export async function resizeDirectTableColumnAction(
  businessSlug: string,
  formData: FormData,
): Promise<never> {
  return applyStructuralAction(businessSlug, formData, {
    action: "resize_column",
    viewKey: formString(formData, "viewKey"),
    fieldKey: formString(formData, "fieldKey"),
    width: Number(formString(formData, "width") ?? ""),
  });
}

export async function undoDirectTableAction(
  businessSlugInput: string,
  formData: FormData,
): Promise<never> {
  const businessSlug = routeSlugSchema.parse(businessSlugInput);
  const viewKey = keySchema.safeParse(formString(formData, "viewKey"));
  let result: Awaited<
    ReturnType<typeof undoDirectTableConfigurationAction>
  > | null = null;
  try {
    const { supabase, tenant } = await requireConfigurationActor(businessSlug);
    const input = directTableUndoIntentSchema.parse({
      expectedActiveSourceVersionId: formString(
        formData,
        "expectedActiveSourceVersionId",
      ),
      expectedHeadRevision: Number(
        formString(formData, "expectedHeadRevision") ?? "",
      ),
    });
    result = await undoDirectTableConfigurationAction(
      supabase,
      { businessId: tenant.business.id, actorId: tenant.user.id },
      input,
    );
  } catch (error) {
    redirect(
      `${routePath(businessSlug, viewKey.success ? viewKey.data : undefined)}?error=${encodeURIComponent(ownerMessage(error))}`,
    );
  }
  if (!result) {
    redirect(
      `${routePath(businessSlug, viewKey.success ? viewKey.data : undefined)}?error=${encodeURIComponent("That change could not be undone.")}`,
    );
  }
  revalidatePath(`/app/${businessSlug}`, "layout");
  const destination = routePath(
    businessSlug,
    viewKey.success ? viewKey.data : undefined,
  );
  redirect(
    `${destination}?message=${encodeURIComponent("Table change undone")}`,
  );
}

export async function updateDirectTableCellAction(
  businessSlugInput: string,
  _previousState: DirectTableCellActionState,
  formData: FormData,
): Promise<DirectTableCellActionState> {
  const businessSlug = routeSlugSchema.safeParse(businessSlugInput);
  const viewKey = formString(formData, "viewKey");
  const recordId = formString(formData, "recordId");
  const fieldKey = formString(formData, "fieldKey");
  if (!businessSlug.success || !viewKey || !recordId || !fieldKey) {
    return { status: "error", message: "That value is no longer available." };
  }
  try {
    const supabase = await createServerClient();
    const tenant = await resolveTenant(businessSlug.data, supabase);
    const record = await applyDirectTableRecordCellEdit(
      supabase,
      { businessId: tenant.business.id },
      {
        viewKey,
        recordId,
        fieldKey,
        formData,
      } satisfies DirectTableRecordCellEditInput,
    );
    revalidatePath(routePath(businessSlug.data, viewKey), "page");
    return { status: "success", record, recordId, fieldKey };
  } catch (error) {
    return {
      status: "error",
      recordId,
      fieldKey,
      message: ownerMessage(error),
    };
  }
}

export async function createDirectTableRowAction(
  businessSlugInput: string,
  _previousState: DirectTableRowActionState,
  formData: FormData,
): Promise<DirectTableRowActionState> {
  const businessSlug = routeSlugSchema.safeParse(businessSlugInput);
  const viewKey = formString(formData, "viewKey");
  if (!businessSlug.success || !viewKey) {
    return { status: "error", message: "That Table is no longer available." };
  }
  try {
    const supabase = await createServerClient();
    const tenant = await resolveTenant(businessSlug.data, supabase);
    const record = await createDirectTableRow(
      supabase,
      { businessId: tenant.business.id },
      { viewKey, formData },
    );
    revalidatePath(routePath(businessSlug.data, viewKey), "page");
    return { status: "success", record };
  } catch (error) {
    return { status: "error", message: ownerMessage(error) };
  }
}
