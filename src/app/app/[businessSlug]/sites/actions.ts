"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { hasCapability, resolveTenant } from "../../../../auth/authorization";
import {
  ConfigurationChangeService,
  ConfigurationChangeServiceError,
} from "../../../../core/configuration/service";
import {
  publishPublicPage,
  preparePublicPagePublicationProposal,
  PublicPagePublicationError,
} from "../../../../core/configuration/publication/page-service";
import { publicPagePublicationFormSchema } from "../../../../core/configuration/publication/schemas";
import { graphKeySchema } from "../../../../core/graph/schemas";
import {
  createSiteDraft,
  reenableSiteField,
  reenableSiteMedia,
  reenableSiteObject,
  reenableSiteRecord,
  prepareSiteReleaseV3,
  publishSiteReleaseV3,
  prepareSiteReleaseV2,
  publishSiteReleaseV2,
  rebaseSiteDraft,
  resolveSiteDraftConflict,
  stageSiteAdoption,
  unpublishSite,
  withdrawSiteField,
  withdrawSiteMedia,
  withdrawSiteObject,
  withdrawSiteRecord,
  SiteFoundationServiceError,
} from "../../../../core/sites/service";
import {
  siteDraftConflictResolutionSchema,
  siteDraftV1Schema,
  siteDraftRebaseSchema,
  siteReleasePreparationSchema,
  siteReleasePublishSchema,
} from "../../../../core/sites/schemas";
import { createServerClient } from "../../../../db/supabase/server";

const routeSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const siteRootPath = (businessSlug: string) =>
  `/app/${encodeURIComponent(businessSlug)}/sites`;

function siteNotice(
  businessSlug: string,
  notice:
    | "saved"
    | "rebased"
    | "created"
    | "prepared"
    | "published"
    | "adopted"
    | "unpublished"
    | "availability_changed"
    | "input_invalid"
    | "stale"
    | "link_not_ready"
    | "failed",
): never {
  redirect(
    `${siteRootPath(businessSlug)}?${new URLSearchParams({ notice }).toString()}`,
  );
}

type AvailabilityKind = "record" | "object" | "field" | "media";
type AvailabilityStatus = "withdrawn" | "available";

async function changeSiteAvailabilityAction(
  businessSlugInput: string,
  formData: FormData,
  kind: AvailabilityKind,
  status: AvailabilityStatus,
): Promise<never> {
  const parsedSlug = routeSlugSchema.safeParse(businessSlugInput);
  if (!parsedSlug.success) notFound();
  const targetId = z.uuid().safeParse(stringValue(formData, "targetId"));
  const siteId = z.uuid().safeParse(stringValue(formData, "siteId"));
  const activeReleaseRevision = z.coerce
    .number()
    .int()
    .nonnegative()
    .safeParse(stringValue(formData, "expectedActiveReleaseRevision"));
  const availabilityRevision = z.coerce
    .number()
    .int()
    .nonnegative()
    .safeParse(stringValue(formData, "expectedAvailabilityRevision"));
  if (
    !targetId.success ||
    !siteId.success ||
    !activeReleaseRevision.success ||
    !availabilityRevision.success
  ) {
    siteNotice(parsedSlug.data, "input_invalid");
  }
  const supabase = await createServerClient();
  const tenant = await resolveTenant(parsedSlug.data, supabase);
  if (!hasCapability(tenant.membership.role, "manage_configuration"))
    notFound();
  const input = {
    siteId: siteId.data,
    targetId: targetId.data,
    expectedActiveReleaseRevision: activeReleaseRevision.data,
    expectedAvailabilityRevision: availabilityRevision.data,
  };
  try {
    if (kind === "record") {
      if (status === "withdrawn")
        await withdrawSiteRecord(
          supabase,
          { businessId: tenant.business.id, actorId: tenant.user.id },
          input,
        );
      else
        await reenableSiteRecord(
          supabase,
          { businessId: tenant.business.id, actorId: tenant.user.id },
          input,
        );
    } else if (kind === "object") {
      if (status === "withdrawn")
        await withdrawSiteObject(
          supabase,
          { businessId: tenant.business.id, actorId: tenant.user.id },
          input,
        );
      else
        await reenableSiteObject(
          supabase,
          { businessId: tenant.business.id, actorId: tenant.user.id },
          input,
        );
    } else if (kind === "field") {
      if (status === "withdrawn")
        await withdrawSiteField(
          supabase,
          { businessId: tenant.business.id, actorId: tenant.user.id },
          input,
        );
      else
        await reenableSiteField(
          supabase,
          { businessId: tenant.business.id, actorId: tenant.user.id },
          input,
        );
    } else if (status === "withdrawn") {
      await withdrawSiteMedia(
        supabase,
        { businessId: tenant.business.id, actorId: tenant.user.id },
        input,
      );
    } else {
      await reenableSiteMedia(
        supabase,
        { businessId: tenant.business.id, actorId: tenant.user.id },
        input,
      );
    }
  } catch (error) {
    siteNotice(parsedSlug.data, siteErrorNotice(error));
  }
  siteNotice(parsedSlug.data, "availability_changed");
}

export async function withdrawSiteRecordAction(
  businessSlug: string,
  formData: FormData,
): Promise<never> {
  return changeSiteAvailabilityAction(
    businessSlug,
    formData,
    "record",
    "withdrawn",
  );
}

export async function reenableSiteRecordAction(
  businessSlug: string,
  formData: FormData,
): Promise<never> {
  return changeSiteAvailabilityAction(
    businessSlug,
    formData,
    "record",
    "available",
  );
}

export async function withdrawSiteObjectAction(
  businessSlug: string,
  formData: FormData,
): Promise<never> {
  return changeSiteAvailabilityAction(
    businessSlug,
    formData,
    "object",
    "withdrawn",
  );
}

export async function reenableSiteObjectAction(
  businessSlug: string,
  formData: FormData,
): Promise<never> {
  return changeSiteAvailabilityAction(
    businessSlug,
    formData,
    "object",
    "available",
  );
}

export async function withdrawSiteFieldAction(
  businessSlug: string,
  formData: FormData,
): Promise<never> {
  return changeSiteAvailabilityAction(
    businessSlug,
    formData,
    "field",
    "withdrawn",
  );
}

export async function reenableSiteFieldAction(
  businessSlug: string,
  formData: FormData,
): Promise<never> {
  return changeSiteAvailabilityAction(
    businessSlug,
    formData,
    "field",
    "available",
  );
}

export async function withdrawSiteMediaAction(
  businessSlug: string,
  formData: FormData,
): Promise<never> {
  return changeSiteAvailabilityAction(
    businessSlug,
    formData,
    "media",
    "withdrawn",
  );
}

export async function reenableSiteMediaAction(
  businessSlug: string,
  formData: FormData,
): Promise<never> {
  return changeSiteAvailabilityAction(
    businessSlug,
    formData,
    "media",
    "available",
  );
}

function siteErrorNotice(
  error: unknown,
): "stale" | "link_not_ready" | "failed" {
  if (error instanceof SiteFoundationServiceError) {
    if (error.code === "site_page_link_not_ready") return "link_not_ready";
    if (/stale|rebase/.test(error.code)) return "stale";
  }
  return "failed";
}

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

async function siteDraftHasForms(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  businessId: string,
): Promise<boolean> {
  const reader = supabase as unknown as {
    from(table: string): {
      select(columns: string): {
        eq(
          column: string,
          value: string,
        ): {
          maybeSingle(): PromiseLike<{ data: unknown; error: unknown | null }>;
        };
      };
    };
  };
  const result = await reader
    .from("site_states")
    .select("draft_json")
    .eq("business_id", businessId)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data || typeof result.data !== "object") return false;
  const draft = siteDraftV1Schema.parse(
    (result.data as { draft_json: unknown }).draft_json,
  );
  return Boolean(draft.forms?.length);
}

function redirectWithNotice(
  path: string,
  notice:
    | "input_invalid"
    | "stale"
    | "publication_unavailable"
    | "already_published"
    | "published"
    | "publication_failed",
): never {
  redirect(`${path}?${new URLSearchParams({ notice }).toString()}`);
}

export async function publishPublicPageAction(
  businessSlugInput: string,
  formData: FormData,
): Promise<never> {
  const parsedSlug = routeSlugSchema.safeParse(businessSlugInput);
  if (!parsedSlug.success) notFound();

  const pageSlug = routeSlugSchema.safeParse(stringValue(formData, "pageSlug"));
  const pageKey = graphKeySchema.safeParse(stringValue(formData, "pageKey"));
  if (!pageSlug.success || !pageKey.success) {
    redirectWithNotice(
      `/app/${encodeURIComponent(parsedSlug.data)}/sites/${encodeURIComponent(
        pageSlug.success ? pageSlug.data : "",
      )}`,
      "input_invalid",
    );
  }

  const supabase = await createServerClient();
  const tenant = await resolveTenant(parsedSlug.data, supabase);
  if (!hasCapability(tenant.membership.role, "manage_configuration")) {
    notFound();
  }

  const path = `/app/${encodeURIComponent(parsedSlug.data)}/sites/${encodeURIComponent(pageSlug.data)}`;
  const configuration = new ConfigurationChangeService(supabase, {
    businessId: tenant.business.id,
    actorId: tenant.user.id,
  });
  try {
    await publishPublicPage(configuration, { pageKey: pageKey.data });
    redirectWithNotice(path, "published");
  } catch (error) {
    if (error instanceof PublicPagePublicationError) {
      const notice =
        error.code === "public_page_stale"
          ? "stale"
          : error.code === "public_page_already_published"
            ? "already_published"
            : error.code === "public_page_validation_failed" ||
                error.code === "public_page_application_failed"
              ? "publication_failed"
              : "publication_unavailable";
      redirectWithNotice(path, notice);
    }
    if (error instanceof ConfigurationChangeServiceError) {
      redirectWithNotice(path, "publication_failed");
    }
    throw error;
  }
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

function starterSiteDraft(businessName: string) {
  const pageId = randomUUID();
  return siteDraftV1Schema.parse({
    schema_version: 1,
    branding: { name: businessName, accent: "forest" },
    pages: [
      {
        id: pageId,
        title: "Home",
        slug: "home",
        navigation_label: "Home",
        is_home: true,
        is_in_navigation: true,
        is_included: true,
        layout: {
          blocks: [
            {
              type: "heading",
              id: randomUUID(),
              text: `Welcome to ${businessName}`,
              level: 1,
            },
            {
              type: "text",
              id: randomUUID(),
              text: "Tell visitors what makes your business useful to them.",
            },
          ],
        },
      },
    ],
  });
}

export async function createSiteAction(
  businessSlugInput: string,
): Promise<never> {
  const parsedSlug = routeSlugSchema.safeParse(businessSlugInput);
  if (!parsedSlug.success) notFound();
  const supabase = await createServerClient();
  const tenant = await resolveTenant(parsedSlug.data, supabase);
  if (!hasCapability(tenant.membership.role, "manage_configuration"))
    notFound();
  try {
    await createSiteDraft(
      supabase,
      { businessId: tenant.business.id, actorId: tenant.user.id },
      { draft: starterSiteDraft(tenant.business.name) },
    );
  } catch (error) {
    if (
      error instanceof SiteFoundationServiceError &&
      error.code === "site_already_exists"
    ) {
      siteNotice(parsedSlug.data, "saved");
    }
    siteNotice(parsedSlug.data, "failed");
  }
  siteNotice(parsedSlug.data, "created");
}

export async function rebaseSiteDraftAction(
  businessSlugInput: string,
  formData: FormData,
): Promise<never> {
  const parsedSlug = routeSlugSchema.safeParse(businessSlugInput);
  if (!parsedSlug.success) notFound();
  const input = siteDraftRebaseSchema.safeParse({
    siteId: stringValue(formData, "siteId"),
    expectedDraftRevision: integerValue(formData, "expectedDraftRevision"),
    expectedBaseVersionId: stringValue(formData, "expectedBaseVersionId"),
    expectedHeadRevision: integerValue(formData, "expectedHeadRevision"),
  });
  if (!input.success) siteNotice(parsedSlug.data, "input_invalid");
  const supabase = await createServerClient();
  const tenant = await resolveTenant(parsedSlug.data, supabase);
  if (!hasCapability(tenant.membership.role, "manage_configuration"))
    notFound();
  try {
    await rebaseSiteDraft(
      supabase,
      { businessId: tenant.business.id, actorId: tenant.user.id },
      input.data,
    );
  } catch (error) {
    siteNotice(parsedSlug.data, siteErrorNotice(error));
  }
  siteNotice(parsedSlug.data, "rebased");
}

export async function resolveSiteDraftConflictAction(
  businessSlugInput: string,
  formData: FormData,
): Promise<never> {
  const parsedSlug = routeSlugSchema.safeParse(businessSlugInput);
  if (!parsedSlug.success) notFound();
  const input = siteDraftConflictResolutionSchema.safeParse({
    siteId: stringValue(formData, "siteId"),
    expectedDraftRevision: integerValue(formData, "expectedDraftRevision"),
    expectedBaseVersionId: stringValue(formData, "expectedBaseVersionId"),
    expectedHeadRevision: integerValue(formData, "expectedHeadRevision"),
    expectedTargetVersionId: stringValue(formData, "expectedTargetVersionId"),
    expectedTargetHeadRevision: integerValue(
      formData,
      "expectedTargetHeadRevision",
    ),
    resolution: "keep_site_draft",
  });
  if (!input.success) siteNotice(parsedSlug.data, "input_invalid");
  const supabase = await createServerClient();
  const tenant = await resolveTenant(parsedSlug.data, supabase);
  if (!hasCapability(tenant.membership.role, "manage_configuration"))
    notFound();
  try {
    await resolveSiteDraftConflict(
      supabase,
      { businessId: tenant.business.id, actorId: tenant.user.id },
      input.data,
    );
  } catch (error) {
    siteNotice(parsedSlug.data, siteErrorNotice(error));
  }
  siteNotice(parsedSlug.data, "rebased");
}

export async function prepareSiteReleaseAction(
  businessSlugInput: string,
  formData: FormData,
): Promise<never> {
  const parsedSlug = routeSlugSchema.safeParse(businessSlugInput);
  if (!parsedSlug.success) notFound();
  const input = siteReleasePreparationSchema.safeParse({
    siteId: stringValue(formData, "siteId"),
    expectedDraftRevision: integerValue(formData, "expectedDraftRevision"),
    expectedBaseVersionId: stringValue(formData, "expectedBaseVersionId"),
    expectedHeadRevision: integerValue(formData, "expectedHeadRevision"),
  });
  if (!input.success) siteNotice(parsedSlug.data, "input_invalid");
  const supabase = await createServerClient();
  const tenant = await resolveTenant(parsedSlug.data, supabase);
  if (!hasCapability(tenant.membership.role, "manage_configuration"))
    notFound();
  let candidate;
  try {
    const hasForms = await siteDraftHasForms(supabase, tenant.business.id);
    candidate = hasForms
      ? await prepareSiteReleaseV3(
          supabase,
          { businessId: tenant.business.id, actorId: tenant.user.id },
          input.data,
        )
      : await prepareSiteReleaseV2(
          supabase,
          { businessId: tenant.business.id, actorId: tenant.user.id },
          input.data,
        );
  } catch (error) {
    siteNotice(parsedSlug.data, siteErrorNotice(error));
  }
  redirect(
    `${siteRootPath(parsedSlug.data)}?candidate=${encodeURIComponent(candidate.id)}`,
  );
}

export async function publishSiteReleaseAction(
  businessSlugInput: string,
  formData: FormData,
): Promise<never> {
  const parsedSlug = routeSlugSchema.safeParse(businessSlugInput);
  if (!parsedSlug.success) notFound();
  const input = siteReleasePublishSchema.safeParse({
    siteId: stringValue(formData, "siteId"),
    candidateId: stringValue(formData, "candidateId"),
    expectedDraftRevision: integerValue(formData, "expectedDraftRevision"),
    expectedBaseVersionId: stringValue(formData, "expectedBaseVersionId"),
    expectedHeadRevision: integerValue(formData, "expectedHeadRevision"),
  });
  if (!input.success) siteNotice(parsedSlug.data, "input_invalid");
  const supabase = await createServerClient();
  const tenant = await resolveTenant(parsedSlug.data, supabase);
  if (!hasCapability(tenant.membership.role, "manage_configuration"))
    notFound();
  try {
    const hasForms = await siteDraftHasForms(supabase, tenant.business.id);
    if (hasForms) {
      await publishSiteReleaseV3(
        supabase,
        { businessId: tenant.business.id, actorId: tenant.user.id },
        input.data,
      );
    } else {
      await publishSiteReleaseV2(
        supabase,
        { businessId: tenant.business.id, actorId: tenant.user.id },
        input.data,
      );
    }
  } catch (error) {
    if (error instanceof SiteFoundationServiceError) {
      console.error("Sites publish failed", { code: error.code });
    }
    siteNotice(parsedSlug.data, siteErrorNotice(error));
  }
  revalidatePath(`/app/${parsedSlug.data}`, "layout");
  siteNotice(parsedSlug.data, "published");
}

export async function stageSiteAdoptionAction(
  businessSlugInput: string,
  formData: FormData,
): Promise<never> {
  const parsedSlug = routeSlugSchema.safeParse(businessSlugInput);
  if (!parsedSlug.success) notFound();
  const input = siteReleasePreparationSchema.safeParse({
    siteId: stringValue(formData, "siteId"),
    expectedDraftRevision: integerValue(formData, "expectedDraftRevision"),
    expectedBaseVersionId: stringValue(formData, "expectedBaseVersionId"),
    expectedHeadRevision: integerValue(formData, "expectedHeadRevision"),
  });
  if (!input.success) siteNotice(parsedSlug.data, "input_invalid");
  const supabase = await createServerClient();
  const tenant = await resolveTenant(parsedSlug.data, supabase);
  if (!hasCapability(tenant.membership.role, "manage_configuration"))
    notFound();
  try {
    await stageSiteAdoption(
      supabase,
      { businessId: tenant.business.id, actorId: tenant.user.id },
      input.data,
    );
  } catch (error) {
    siteNotice(parsedSlug.data, siteErrorNotice(error));
  }
  siteNotice(parsedSlug.data, "adopted");
}

export async function unpublishSiteAction(
  businessSlugInput: string,
  formData: FormData,
): Promise<never> {
  const parsedSlug = routeSlugSchema.safeParse(businessSlugInput);
  if (!parsedSlug.success) notFound();
  const siteId = z.uuid().safeParse(stringValue(formData, "siteId"));
  const revision = z.coerce
    .number()
    .int()
    .nonnegative()
    .safeParse(stringValue(formData, "expectedActiveReleaseRevision"));
  if (!siteId.success || !revision.success)
    siteNotice(parsedSlug.data, "input_invalid");
  const supabase = await createServerClient();
  const tenant = await resolveTenant(parsedSlug.data, supabase);
  if (!hasCapability(tenant.membership.role, "manage_configuration"))
    notFound();
  try {
    await unpublishSite(
      supabase,
      { businessId: tenant.business.id, actorId: tenant.user.id },
      { siteId: siteId.data, expectedActiveReleaseRevision: revision.data },
    );
  } catch (error) {
    siteNotice(parsedSlug.data, siteErrorNotice(error));
  }
  siteNotice(parsedSlug.data, "unpublished");
}
