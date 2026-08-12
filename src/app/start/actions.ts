"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createServerClient } from "../../db/supabase/server";
import {
  AcquisitionServiceError,
  clearAcquisitionCookie,
  createOrRegenerateProposal,
  loadAcquisitionSession,
  readAcquisitionCookieToken,
} from "../../core/acquisition/service";
import { emitAcquisitionEvent } from "../../core/acquisition/events";
import {
  acquisitionCategorySchema,
  acquisitionRequestSchema,
} from "../../core/acquisition/schemas";

const workspaceDetailsSchema = z.object({
  businessName: z.string().trim().min(1).max(120),
  timezone: z.string().trim().min(1).max(80),
  timezoneConfirmed: z.literal("yes"),
});

function redirectWithError(path: string, message: string): never {
  redirect(`${path}?${new URLSearchParams({ error: message }).toString()}`);
}

function acquisitionErrorMessage(error: unknown): string {
  if (error instanceof AcquisitionServiceError) {
    return error.message;
  }
  return "Lenni could not prepare that starting point. Please try again.";
}

function claimErrorMessage(error: { message?: string } | null): string {
  const message = error?.message ?? "";
  if (message.includes("anonymous_build_session_expired")) {
    return "This Lenni proposal has expired. Start again to create a fresh proposal.";
  }
  if (
    message.includes("anonymous_build_session_not_found") ||
    message.includes("anonymous_build_proposal_invalid")
  ) {
    return "This Lenni proposal is no longer available. Start again to prepare a new one.";
  }
  if (message.includes("anonymous_build_session_already_claimed")) {
    return "This proposal has already been claimed. Start again if you want another workspace.";
  }
  if (
    message.includes("anonymous_build_configuration") ||
    message.includes("configuration_")
  ) {
    return "We could not finish creating that workspace. Nothing was created, so you can try again.";
  }
  return "We could not create the workspace. Nothing was created, so you can try again.";
}

export async function createProposalAction(formData: FormData): Promise<never> {
  const category = acquisitionCategorySchema.safeParse(
    formData.get("category"),
  );
  const request = acquisitionRequestSchema.safeParse(formData.get("request"));
  if (!category.success || !request.success) {
    redirectWithError(
      "/start",
      "Choose the closest kind of work and describe what you need in a little more detail.",
    );
  }

  try {
    await createOrRegenerateProposal(category.data, request.data);
  } catch (error) {
    redirectWithError("/start", acquisitionErrorMessage(error));
  }

  redirect("/start");
}

export async function claimWorkspaceAction(formData: FormData): Promise<never> {
  const details = workspaceDetailsSchema.safeParse({
    businessName: formData.get("businessName"),
    timezone: formData.get("timezone"),
    timezoneConfirmed: formData.get("timezoneConfirmed"),
  });
  if (!details.success) {
    redirectWithError(
      "/start/business",
      "Enter a business name and confirm the timezone.",
    );
  }

  const supabase = await createServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (typeof claims?.claims?.sub !== "string") {
    redirect("/sign-up?returnTo=%2Fstart%2Fbusiness");
  }

  const sessionToken = await readAcquisitionCookieToken();
  if (!sessionToken) {
    redirectWithError(
      "/start/business",
      "Your Lenni session could not be read. Start again to prepare a fresh proposal.",
    );
  }
  const session = await loadAcquisitionSession();
  const landingPageKey =
    session?.payload.proposal.landing_page_key ?? "overview";

  emitAcquisitionEvent("workspace_apply_started", {
    category: session?.payload.proposal.category ?? "unknown",
  });
  const { data, error } = await supabase.rpc("claim_anonymous_build_session", {
    requested_business_name: details.data.businessName,
    requested_session_token: sessionToken,
    requested_timezone: details.data.timezone,
  });

  if (error || !data) {
    emitAcquisitionEvent("workspace_apply_failed", {
      reason: "claim_failed",
    });
    redirectWithError("/start/business", claimErrorMessage(error));
  }

  emitAcquisitionEvent("proposal_claimed");
  emitAcquisitionEvent("workspace_apply_succeeded");
  await clearAcquisitionCookie();
  revalidatePath(`/app/${data.slug}`, "layout");
  redirect(
    `/app/${encodeURIComponent(data.slug)}/pages/${encodeURIComponent(landingPageKey)}`,
  );
}
