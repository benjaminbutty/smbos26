import "server-only";

import { z } from "zod";

import type { Json, Tables } from "../../db/supabase/database.types";
import { createServerClient } from "../../db/supabase/server";
import {
  bookingConfigSchema,
  type PublicBookingCatalogue,
} from "../booking/schemas";
import { resolvePublicBooking } from "../booking/service";
import {
  experienceAudienceSchema,
  experienceFormModeSchema,
  formConfigSchema,
  pageLayoutSchema,
  type PageLayout,
} from "../experience/schemas";
import { walkPageBlocks } from "../experience/page-blocks";
import type { ExperienceFormBundle } from "../experience/service";
import {
  sitePublicProjectionBrandingSchema,
  sitePublicProjectionPageSchema,
} from "../sites/schemas";
import { callPublicRpc } from "./rpc";

const publicPageResolverSchema = z.object({
  business: z.object({
    name: z.string(),
    slug: z.string(),
  }),
  page: z.object({
    key: z.string(),
    title: z.string(),
    slug: z.string(),
    layout: z.unknown(),
  }),
});

const publicSiteResolverSchema = z.object({
  business: z.object({ name: z.string(), slug: z.string() }),
  site: z.object({
    schema_version: z.literal(2),
    branding: z.unknown(),
    navigation: z.array(
      z.object({
        key: z.string(),
        title: z.string(),
        slug: z.string(),
        label: z.string(),
      }),
    ),
  }),
  page: z.object({
    key: z.string(),
    title: z.string(),
    slug: z.string(),
    navigation_label: z.string(),
    is_home: z.boolean(),
    is_in_navigation: z.boolean(),
    layout: z.unknown(),
  }),
});

const publicFormResolverSchema = z.object({
  definition: z.object({
    id: z.uuid(),
    business_id: z.uuid(),
    key: z.string(),
    name: z.string(),
    object_definition_id: z.uuid(),
    mode: experienceFormModeSchema,
    config_json: z.unknown(),
    audience: experienceAudienceSchema,
    is_active: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
  }),
  object: z.object({
    id: z.uuid(),
    business_id: z.uuid(),
    key: z.string(),
    singular_label: z.string(),
    plural_label: z.string(),
    description: z.string(),
    kind: z.enum(["template", "custom"]),
    semantic_type: z.string().nullable(),
    icon: z.string().nullable(),
    is_active: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
  }),
  fields: z.array(
    z.object({
      id: z.uuid(),
      business_id: z.uuid(),
      object_definition_id: z.uuid(),
      key: z.string(),
      label: z.string(),
      field_type: z.enum([
        "short_text",
        "long_text",
        "number",
        "currency",
        "boolean",
        "date",
        "datetime",
        "email",
        "phone",
        "url",
        "select",
        "multi_select",
        "file",
        "status",
      ]),
      required: z.boolean(),
      default_value: z.unknown().nullable(),
      settings_json: z.unknown(),
      position: z.number().int(),
      is_active: z.boolean(),
      created_at: z.string(),
      updated_at: z.string(),
    }),
  ),
});

function publicFormBundle(input: unknown): ExperienceFormBundle {
  const resolved = publicFormResolverSchema.parse(input);
  return {
    definition: resolved.definition as unknown as Tables<"forms">,
    object: resolved.object as unknown as Tables<"object_definitions">,
    fields: resolved.fields as unknown as Tables<"field_definitions">[],
    config: formConfigSchema.parse(resolved.definition.config_json),
  };
}

export interface PublicPageRuntime {
  kind: "legacy";
  business: { name: string; slug: string };
  page: {
    key: string;
    title: string;
    slug: string;
    layout: PageLayout;
  };
  forms: Readonly<Record<string, ExperienceFormBundle>>;
  bookings: Readonly<Record<string, PublicBookingCatalogue>>;
}

export interface PublicSiteRuntime {
  kind: "site";
  business: { name: string; slug: string };
  site: {
    branding: z.infer<typeof sitePublicProjectionBrandingSchema>;
    navigation: Array<{
      key: string;
      title: string;
      slug: string;
      label: string;
    }>;
  };
  page: {
    key: string;
    title: string;
    slug: string;
    navigation_label: string;
    is_home: boolean;
    is_in_navigation: boolean;
    layout: z.infer<typeof sitePublicProjectionPageSchema>["layout"];
  };
  forms: Readonly<Record<string, never>>;
  bookings: Readonly<Record<string, never>>;
}

export interface PublicSiteRecordRuntime extends PublicSiteRuntime {
  record: {
    public_id: string;
    values: Record<string, unknown>;
  };
}

export async function loadPublicPageRuntime(
  businessSlug: string,
  pageSlug: string,
): Promise<PublicPageRuntime | PublicSiteRuntime | null> {
  const supabase = await createServerClient();
  const pageResult = await callPublicRpc<Json>(
    supabase,
    "resolve_public_page",
    {
      requested_business_slug: businessSlug,
      requested_page_slug: pageSlug,
    },
  );
  if (pageResult.error) {
    throw new Error("Could not load the public Site.", {
      cause: pageResult.error,
    });
  }
  if (pageResult.data === null) return null;

  if (
    typeof pageResult.data === "object" &&
    pageResult.data !== null &&
    "site" in pageResult.data
  ) {
    const resolvedSite = publicSiteResolverSchema.parse(pageResult.data);
    const branding = sitePublicProjectionBrandingSchema.parse(
      resolvedSite.site.branding,
    );
    const projectionPage = sitePublicProjectionPageSchema.parse({
      public_key: resolvedSite.page.key,
      title: resolvedSite.page.title,
      slug: resolvedSite.page.slug,
      navigation_label: resolvedSite.page.navigation_label,
      is_home: resolvedSite.page.is_home,
      is_in_navigation: resolvedSite.page.is_in_navigation,
      layout: resolvedSite.page.layout,
    });
    return {
      kind: "site",
      business: resolvedSite.business,
      site: {
        branding,
        navigation: resolvedSite.site.navigation,
      },
      page: {
        key: resolvedSite.page.key,
        title: resolvedSite.page.title,
        slug: resolvedSite.page.slug,
        navigation_label: resolvedSite.page.navigation_label,
        is_home: resolvedSite.page.is_home,
        is_in_navigation: resolvedSite.page.is_in_navigation,
        layout: projectionPage.layout,
      },
      forms: {},
      bookings: {},
    };
  }

  const resolvedPage = publicPageResolverSchema.parse(pageResult.data);
  const layout = pageLayoutSchema.parse(resolvedPage.page.layout);
  const blocks = walkPageBlocks(layout);
  const formKeys = blocks.flatMap((block) =>
    block.type === "public_form" ? [block.form_key] : [],
  );
  const bookingKeys = blocks.flatMap((block) =>
    block.type === "booking" ? [block.booking_key] : [],
  );

  const forms = await Promise.all(
    [...new Set(formKeys)].map(async (formKey) => {
      const result = await callPublicRpc<Json>(
        supabase,
        "resolve_public_form",
        {
          requested_business_slug: businessSlug,
          requested_page_slug: pageSlug,
          requested_form_key: formKey,
        },
      );
      if (result.error) {
        throw new Error("Could not load the public Form.", {
          cause: result.error,
        });
      }
      if (result.data === null) {
        throw new Error("The public Form is not available.");
      }
      const bundle = publicFormBundle(result.data);
      if (bundle.definition.mode !== "create" || !bundle.definition.is_active) {
        throw new Error("The public Form is not available.");
      }
      return [formKey, bundle] as const;
    }),
  );
  const bookings = await Promise.all(
    [...new Set(bookingKeys)].map(async (bookingKey) => {
      const block = blocks.find(
        (candidate) =>
          candidate.type === "booking" && candidate.booking_key === bookingKey,
      );
      if (!block || block.type !== "booking") {
        throw new Error("The public Booking is not available.");
      }
      bookingConfigSchema.parse(block.config);
      const catalogue = await resolvePublicBooking(
        supabase,
        businessSlug,
        pageSlug,
        bookingKey,
      );
      if (!catalogue) throw new Error("The public Booking is not available.");
      return [bookingKey, catalogue] as const;
    }),
  );

  return {
    kind: "legacy",
    business: resolvedPage.business,
    page: {
      key: resolvedPage.page.key,
      title: resolvedPage.page.title,
      slug: resolvedPage.page.slug,
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
  return runtime?.kind === "legacy" ? (runtime.forms[formKey] ?? null) : null;
}

export async function loadPublicRecordRuntime(
  businessSlug: string,
  pageSlug: string,
  recordToken: string,
): Promise<PublicSiteRecordRuntime | null> {
  const runtime = await loadPublicPageRuntime(businessSlug, pageSlug);
  if (!runtime || runtime.kind !== "site") return null;
  const supabase = await createServerClient();
  const result = await callPublicRpc<Json>(
    supabase,
    "resolve_public_site_record",
    {
      requested_business_slug: businessSlug,
      requested_page_slug: pageSlug,
      requested_record_token: recordToken,
    },
  );
  if (result.error) {
    throw new Error("Could not load the public Record.", {
      cause: result.error,
    });
  }
  if (result.data === null) return null;
  const resolved = z
    .object({
      record: z
        .object({
          public_id: z.string().regex(/^r_[a-f0-9]{64}$/),
          values: z.record(z.string(), z.unknown()),
        })
        .strict(),
    })
    .passthrough()
    .parse(result.data);
  return { ...runtime, record: resolved.record };
}
