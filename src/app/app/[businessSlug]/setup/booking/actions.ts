"use server";

import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import {
  hasCapability,
  resolveTenant,
} from "../../../../../auth/authorization";
import {
  BookingSetupError,
  bookingSetupRequestSchema,
  composeBookingScheduleAmendmentOperations,
  composeBookingSetupOperations,
  findPublicBookingPage,
  updateSiteBookingScheduleDraft,
} from "../../../../../core/acquisition/booking-setup";
import { loadActiveManualAmendmentSnapshot } from "../../../../../core/configuration/manual-amendments/service";
import {
  ConfigurationChangeService,
  ConfigurationChangeServiceError,
} from "../../../../../core/configuration/service";
import { createServerClient } from "../../../../../db/supabase/server";
import {
  saveSiteDraft,
  siteStateSchema,
} from "../../../../../core/sites/service";

const routeSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

function value(formData: FormData, name: string): string | null {
  const candidate = formData.get(name);
  return typeof candidate === "string" ? candidate : null;
}

function integer(formData: FormData, name: string): number {
  const candidate = value(formData, name);
  return candidate !== null && /^\d+$/.test(candidate)
    ? Number.parseInt(candidate, 10)
    : Number.NaN;
}

async function readSiteState(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  businessId: string,
): Promise<z.infer<typeof siteStateSchema> | null> {
  type SiteStateQuery = {
    eq(column: string, value: string): SiteStateQuery;
    maybeSingle(): PromiseLike<{ data: unknown; error: unknown | null }>;
  };
  const reader = supabase as unknown as {
    from(table: string): {
      select(columns: string): SiteStateQuery;
    };
  };
  const result = await reader
    .from("site_states")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data ? siteStateSchema.parse(result.data) : null;
}

function redirectWithNotice(
  businessSlug: string,
  notice: "input_invalid" | "stale" | "already_installed" | "existing_setup",
): never {
  const query = new URLSearchParams({ notice });
  redirect(`/app/${encodeURIComponent(businessSlug)}/setup/booking?${query}`);
}

export async function prepareBookingSetupProposalAction(
  businessSlugInput: string,
  formData: FormData,
): Promise<never> {
  const parsedSlug = routeSlugSchema.safeParse(businessSlugInput);
  if (!parsedSlug.success) notFound();
  const supabase = await createServerClient();
  const tenant = await resolveTenant(parsedSlug.data, supabase);
  if (!hasCapability(tenant.membership.role, "manage_configuration")) {
    notFound();
  }
  const configuration = new ConfigurationChangeService(supabase, {
    businessId: tenant.business.id,
    actorId: tenant.user.id,
  });
  const parsed = bookingSetupRequestSchema.safeParse({
    expectedBaseVersionId: value(formData, "expectedBaseVersionId"),
    expectedHeadRevision: integer(formData, "expectedHeadRevision"),
    daysOfWeek: formData
      .getAll("daysOfWeek")
      .map((candidate) =>
        typeof candidate === "string" && /^\d+$/.test(candidate)
          ? Number.parseInt(candidate, 10)
          : Number.NaN,
      ),
    firstTime: value(formData, "firstTime"),
    lastTime: value(formData, "lastTime"),
    slotIntervalMinutes: integer(formData, "slotIntervalMinutes"),
    capacityPerSlot: integer(formData, "capacityPerSlot"),
    minimumNoticeMinutes: integer(formData, "minimumNoticeMinutes"),
    bookingHorizonDays: integer(formData, "bookingHorizonDays"),
  });
  if (!parsed.success) {
    redirectWithNotice(parsedSlug.data, "input_invalid");
  }
  const renderedSiteId = z.uuid().safeParse(value(formData, "siteId"));
  const renderedDraftRevision = z.coerce
    .number()
    .int()
    .positive()
    .safeParse(value(formData, "expectedDraftRevision"));

  try {
    const active = await loadActiveManualAmendmentSnapshot(configuration);
    if (
      active.baseVersionId !== parsed.data.expectedBaseVersionId ||
      active.headRevision !== parsed.data.expectedHeadRevision
    ) {
      redirectWithNotice(parsedSlug.data, "stale");
    }
    const installedPage = findPublicBookingPage(active.snapshot);
    const siteState = await readSiteState(supabase, tenant.business.id);
    if (installedPage && siteState?.migration_state === "adopted") {
      if (
        !renderedSiteId.success ||
        !renderedDraftRevision.success ||
        renderedSiteId.data !== siteState.id ||
        renderedDraftRevision.data !== siteState.draft_revision
      ) {
        redirectWithNotice(parsedSlug.data, "stale");
      }
      const updatedDraft = updateSiteBookingScheduleDraft(
        siteState.draft_json,
        installedPage.id,
        "booking",
        parsed.data,
      );
      await saveSiteDraft(
        supabase,
        { businessId: tenant.business.id, actorId: tenant.user.id },
        {
          siteId: siteState.id,
          expectedDraftRevision: siteState.draft_revision,
          draft: updatedDraft,
        },
      );
      redirect(
        `/app/${encodeURIComponent(parsedSlug.data)}/sites?${new URLSearchParams({ notice: "saved" }).toString()}`,
      );
    }
    const operations = installedPage
      ? composeBookingScheduleAmendmentOperations(active.snapshot, parsed.data)
      : composeBookingSetupOperations(active.snapshot, parsed.data);
    const proposal = await configuration.proposeChangeSet({
      expectedBaseVersionId: parsed.data.expectedBaseVersionId,
      expectedHeadRevision: parsed.data.expectedHeadRevision,
      title: findPublicBookingPage(active.snapshot)
        ? "Update appointment booking hours"
        : "Set up appointments and public booking",
      description:
        "Create an appointments workspace and a private public booking Page for review.",
      operations,
    });
    redirect(
      `/app/${encodeURIComponent(parsedSlug.data)}/changes/${encodeURIComponent(proposal.id)}`,
    );
  } catch (error) {
    if (error instanceof BookingSetupError) {
      redirectWithNotice(
        parsedSlug.data,
        error.code === "booking_already_installed"
          ? "already_installed"
          : "existing_setup",
      );
    }
    if (
      error instanceof ConfigurationChangeServiceError &&
      error.code === "configuration_proposal_stale"
    ) {
      redirectWithNotice(parsedSlug.data, "stale");
    }
    throw error;
  }
}
