"use server";

import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { hasCapability, resolveTenant } from "../../../../auth/authorization";
import {
  ConfigurationChangeService,
  ConfigurationChangeServiceError,
} from "../../../../core/configuration/service";
import {
  preparePublicPagePublicationProposal,
  PublicPagePublicationError,
} from "../../../../core/configuration/publication/page-service";
import { publicPagePublicationFormSchema } from "../../../../core/configuration/publication/schemas";
import { createServerClient } from "../../../../db/supabase/server";

const routeSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

function stringValue(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
}

function integerValue(formData: FormData, name: string): number {
  const value = stringValue(formData, name);
  return value !== null && /^\d+$/.test(value)
    ? Number.parseInt(value, 10)
    : Number.NaN;
}

function redirectWithNotice(
  path: string,
  notice:
    "input_invalid" | "stale" | "publication_unavailable" | "already_published",
): never {
  redirect(`${path}?${new URLSearchParams({ notice }).toString()}`);
}

export async function preparePublicPagePublicationAction(
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

  const path = `/app/${encodeURIComponent(parsedSlug.data)}/sites/${encodeURIComponent(
    stringValue(formData, "pageSlug") ?? "",
  )}`;
  const input = publicPagePublicationFormSchema.safeParse({
    pageKey: stringValue(formData, "pageKey"),
    expectedBaseVersionId: stringValue(formData, "expectedBaseVersionId"),
    expectedHeadRevision: integerValue(formData, "expectedHeadRevision"),
  });
  if (!input.success) redirectWithNotice(path, "input_invalid");

  const configuration = new ConfigurationChangeService(supabase, {
    businessId: tenant.business.id,
    actorId: tenant.user.id,
  });
  try {
    const proposal = await preparePublicPagePublicationProposal(
      configuration,
      input.data,
    );
    redirect(
      `/app/${encodeURIComponent(parsedSlug.data)}/changes/${encodeURIComponent(proposal.id)}`,
    );
  } catch (error) {
    if (error instanceof PublicPagePublicationError) {
      redirectWithNotice(
        path,
        error.code === "public_page_stale"
          ? "stale"
          : error.code === "public_page_already_published"
            ? "already_published"
            : "publication_unavailable",
      );
    }
    if (
      error instanceof ConfigurationChangeServiceError &&
      error.code === "configuration_proposal_stale"
    ) {
      redirectWithNotice(path, "stale");
    }
    throw error;
  }
}
