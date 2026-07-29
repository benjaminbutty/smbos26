"use server";

import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { hasCapability, resolveTenant } from "../../../../auth/authorization";
import {
  composePreorderScheduleAmendment,
  loadActiveManualAmendmentSnapshot,
  ManualAmendmentError,
} from "../../../../core/configuration/manual-amendments/service";
import { manualPreorderScheduleFormSchema } from "../../../../core/configuration/manual-amendments/schemas";
import {
  ConfigurationChangeService,
  ConfigurationChangeServiceError,
  isControlledConfigurationReadError,
} from "../../../../core/configuration/service";
import { createServerClient } from "../../../../db/supabase/server";

const routeSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

function setupPath(businessSlug: string, preorderKey: string): string {
  return `/app/${encodeURIComponent(businessSlug)}/setup/preorder/${encodeURIComponent(preorderKey)}`;
}

function redirectWithNotice(
  businessSlug: string,
  preorderKey: string,
  notice: "input_invalid" | "nothing_changed" | "stale",
): never {
  const query = new URLSearchParams({ notice });
  redirect(`${setupPath(businessSlug, preorderKey)}?${query.toString()}`);
}

function stringValue(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
}

function integerValue(formData: FormData, name: string): number {
  const value = stringValue(formData, name);
  return value !== null && /^-?\d+$/.test(value)
    ? Number.parseInt(value, 10)
    : Number.NaN;
}

export async function preparePreorderScheduleProposalAction(
  businessSlugInput: string,
  preorderKeyInput: string,
  formData: FormData,
): Promise<never> {
  const businessSlug = routeSlugSchema.safeParse(businessSlugInput);
  if (!businessSlug.success) {
    notFound();
  }
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug.data, supabase);
  if (!hasCapability(tenant.membership.role, "manage_configuration")) {
    notFound();
  }

  const parsed = manualPreorderScheduleFormSchema.safeParse({
    expectedBaseVersionId: stringValue(formData, "expectedBaseVersionId"),
    expectedHeadRevision: integerValue(formData, "expectedHeadRevision"),
    preorderKey: preorderKeyInput,
    daysOfWeek: formData
      .getAll("daysOfWeek")
      .map((value) =>
        typeof value === "string" && /^\d+$/.test(value)
          ? Number.parseInt(value, 10)
          : Number.NaN,
      ),
    startTime: stringValue(formData, "startTime"),
    endTime: stringValue(formData, "endTime"),
    slotIntervalMinutes: integerValue(formData, "slotIntervalMinutes"),
    slotCapacity: integerValue(formData, "slotCapacity"),
    cutoffHours: integerValue(formData, "cutoffHours"),
    bookingHorizonDays: integerValue(formData, "bookingHorizonDays"),
  });
  if (!parsed.success) {
    redirectWithNotice(businessSlug.data, preorderKeyInput, "input_invalid");
  }

  const configuration = new ConfigurationChangeService(supabase, {
    businessId: tenant.business.id,
    actorId: tenant.user.id,
  });
  let active;
  try {
    active = await loadActiveManualAmendmentSnapshot(configuration);
  } catch (error) {
    if (isControlledConfigurationReadError(error)) {
      notFound();
    }
    throw error;
  }
  if (
    active.baseVersionId !== parsed.data.expectedBaseVersionId ||
    active.headRevision !== parsed.data.expectedHeadRevision
  ) {
    redirectWithNotice(businessSlug.data, preorderKeyInput, "stale");
  }

  let amendment;
  try {
    amendment = composePreorderScheduleAmendment(
      active.snapshot,
      parsed.data.intent,
    );
  } catch (error) {
    if (error instanceof ManualAmendmentError) {
      notFound();
    }
    throw error;
  }
  if (amendment.noOp) {
    redirectWithNotice(businessSlug.data, preorderKeyInput, "nothing_changed");
  }

  try {
    const proposal = await configuration.proposeChangeSet({
      expectedBaseVersionId: parsed.data.expectedBaseVersionId,
      expectedHeadRevision: parsed.data.expectedHeadRevision,
      title: amendment.title,
      description: amendment.description,
      operations: [amendment.operation],
    });
    redirect(
      `/app/${encodeURIComponent(businessSlug.data)}/changes/${encodeURIComponent(proposal.id)}`,
    );
  } catch (error) {
    if (
      error instanceof ConfigurationChangeServiceError &&
      error.code === "configuration_proposal_stale"
    ) {
      redirectWithNotice(businessSlug.data, preorderKeyInput, "stale");
    }
    throw error;
  }
}
