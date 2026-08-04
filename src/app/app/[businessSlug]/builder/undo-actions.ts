"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { hasCapability, resolveTenant } from "../../../../auth/authorization";
import {
  BuilderUndoError,
  isBuilderUndoStaleError,
  prepareLatestConfigurationUndo,
} from "../../../../core/configuration/builder-undo/service";
import {
  ConfigurationChangeServiceError,
  isControlledConfigurationReadError,
} from "../../../../core/configuration/service";
import { createServerClient } from "../../../../db/supabase/server";

const routeSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const sourceVersionIdSchema = z.uuid();

function contextualBuilderPath(
  businessSlug: string,
  sourceVersionId: string,
): string {
  const query = new URLSearchParams({ undoVersion: sourceVersionId });
  return `/app/${encodeURIComponent(businessSlug)}/builder?${query.toString()}`;
}

function proposalPath(businessSlug: string, proposalId: string): string {
  return `/app/${encodeURIComponent(businessSlug)}/changes/${encodeURIComponent(proposalId)}?notice=rollback_prepared`;
}

export async function prepareBuilderUndoAction(
  businessSlugInput: string,
  sourceVersionIdInput: string,
  _formData: FormData,
): Promise<never> {
  void _formData;
  const businessSlug = routeSlugSchema.safeParse(businessSlugInput);
  const sourceVersionId = sourceVersionIdSchema.safeParse(sourceVersionIdInput);
  if (!businessSlug.success || !sourceVersionId.success) {
    notFound();
  }

  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug.data, supabase);
  if (!hasCapability(tenant.membership.role, "manage_configuration")) {
    notFound();
  }

  try {
    const result = await prepareLatestConfigurationUndo(supabase, {
      actorId: tenant.user.id,
      businessId: tenant.business.id,
      sourceVersionId: sourceVersionId.data,
    });
    revalidatePath(`/app/${businessSlug.data}/changes`);
    revalidatePath(
      `/app/${businessSlug.data}/changes/${encodeURIComponent(result.proposalId)}`,
    );
    redirect(proposalPath(businessSlug.data, result.proposalId));
  } catch (error) {
    if (
      isBuilderUndoStaleError(error) ||
      (error instanceof BuilderUndoError &&
        error.code === "builder_undo_not_eligible")
    ) {
      redirect(contextualBuilderPath(businessSlug.data, sourceVersionId.data));
    }
    if (
      error instanceof BuilderUndoError &&
      (error.code === "builder_undo_not_found" ||
        error.code === "builder_undo_invalid")
    ) {
      notFound();
    }
    if (
      error instanceof ConfigurationChangeServiceError &&
      (isControlledConfigurationReadError(error) ||
        error.code === "configuration_owner_or_admin_required")
    ) {
      notFound();
    }
    throw error;
  }
}
