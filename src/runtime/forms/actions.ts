"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveTenant } from "../../auth/authorization";
import { createServerClient } from "../../db/supabase/server";
import { ExperienceSubmissionError, submitExperienceForm } from "./submission";

function safeReturnPath(businessSlug: string, requestedPath: string): string {
  const expectedPrefix = `/app/${businessSlug}/`;
  return requestedPath.startsWith(expectedPrefix)
    ? requestedPath
    : `/app/${businessSlug}`;
}

function redirectWithMessage(
  path: string,
  key: "error" | "message",
  message: string,
): never {
  const separator = path.includes("?") ? "&" : "?";
  const params = new URLSearchParams({ [key]: message });
  redirect(`${path}${separator}${params.toString()}`);
}

export async function saveExperienceForm(
  businessSlug: string,
  formKey: string,
  recordId: string | null,
  requestedSuccessPath: string,
  requestedErrorPath: string,
  formData: FormData,
): Promise<never> {
  const successPath = safeReturnPath(businessSlug, requestedSuccessPath);
  const errorPath = safeReturnPath(businessSlug, requestedErrorPath);
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);

  try {
    await submitExperienceForm(
      supabase,
      { businessId: tenant.business.id },
      {
        formKey,
        formData,
        ...(recordId ? { recordId } : {}),
      },
    );
  } catch (error) {
    const message =
      error instanceof ExperienceSubmissionError
        ? error.message
        : "We could not save that information. Please try again.";
    redirectWithMessage(errorPath, "error", message);
  }

  revalidatePath(`/app/${businessSlug}`, "layout");
  redirectWithMessage(
    successPath,
    "message",
    recordId ? "Changes saved." : "Added successfully.",
  );
}
