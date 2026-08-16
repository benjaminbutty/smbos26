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
import type { ExperienceFormBundle } from "../experience/service";
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

export async function loadPublicPageRuntime(
  businessSlug: string,
  pageSlug: string,
): Promise<PublicPageRuntime | null> {
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

  const resolvedPage = publicPageResolverSchema.parse(pageResult.data);
  const layout = pageLayoutSchema.parse(resolvedPage.page.layout);
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
    bookingBlocks.map(async (block) => {
      bookingConfigSchema.parse(block.config);
      const catalogue = await resolvePublicBooking(
        supabase,
        businessSlug,
        pageSlug,
        block.booking_key,
      );
      if (!catalogue) throw new Error("The public Booking is not available.");
      return [block.booking_key, catalogue] as const;
    }),
  );

  return {
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
  return runtime?.forms[formKey] ?? null;
}
