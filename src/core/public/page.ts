import "server-only";

import { createAdminClient } from "../../db/supabase/admin";
import {
  createExperienceService,
  type ExperienceFormBundle,
} from "../experience/service";
import { pageLayoutSchema, type PageLayout } from "../experience/schemas";
import {
  bookingConfigSchema,
  type PublicBookingCatalogue,
} from "../booking/schemas";
import { resolvePublicBooking } from "../booking/service";

export interface PublicPageRuntime {
  business: { id: string; name: string; slug: string };
  page: {
    key: string;
    title: string;
    slug: string;
    layout: PageLayout;
  };
  forms: Readonly<Record<string, ExperienceFormBundle>>;
  bookings: Readonly<Record<string, PublicBookingCatalogue>>;
}

export async function loadPublicPageRuntime(
  businessSlug: string,
  pageSlug: string,
): Promise<PublicPageRuntime | null> {
  const admin = createAdminClient();
  const { data: business, error: businessError } = await admin
    .from("businesses")
    .select("id, name, slug")
    .eq("slug", businessSlug)
    .maybeSingle();
  if (businessError)
    throw new Error("Could not load the public Site.", {
      cause: businessError,
    });
  if (!business) return null;

  const { data: page, error: pageError } = await admin
    .from("pages")
    .select("key, title, slug, layout_json, audience, status, is_active")
    .eq("business_id", business.id)
    .eq("slug", pageSlug)
    .eq("audience", "public")
    .eq("status", "published")
    .eq("is_active", true)
    .maybeSingle();
  if (pageError)
    throw new Error("Could not load the public Site.", { cause: pageError });
  if (!page) return null;

  const layout = pageLayoutSchema.parse(page.layout_json);
  const experience = createExperienceService(admin, {
    businessId: business.id,
  });
  const formKeys = layout.blocks.flatMap((block) =>
    block.type === "public_form" ? [block.form_key] : [],
  );
  const bookingBlocks = layout.blocks.filter(
    (
      block,
    ): block is Extract<PageLayout["blocks"][number], { type: "booking" }> =>
      block.type === "booking",
  );

  const forms = await Promise.all(
    [...new Set(formKeys)].map(async (formKey) => {
      const bundle = await experience.loadForm(formKey, "public");
      if (bundle.definition.mode !== "create" || !bundle.definition.is_active) {
        throw new Error("The public Form is not available.");
      }
      return [formKey, bundle] as const;
    }),
  );
  const bookings = await Promise.all(
    bookingBlocks.map(async (block) => {
      bookingConfigSchema.parse(block.config);
      const catalogue = await resolvePublicBooking(
        admin,
        businessSlug,
        pageSlug,
        block.booking_key,
      );
      if (!catalogue) throw new Error("The public Booking is not available.");
      return [block.booking_key, catalogue] as const;
    }),
  );

  return {
    business: { id: business.id, name: business.name, slug: business.slug },
    page: {
      key: page.key,
      title: page.title,
      slug: page.slug,
      layout,
    },
    forms: Object.fromEntries(forms),
    bookings: Object.fromEntries(bookings),
  };
}

export async function loadPublicFormRuntime(
  businessSlug: string,
  pageSlug: string,
  formKey: string,
): Promise<ExperienceFormBundle | null> {
  const runtime = await loadPublicPageRuntime(businessSlug, pageSlug);
  return runtime?.forms[formKey] ?? null;
}
