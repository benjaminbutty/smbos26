import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Tables } from "../../db/supabase/database.types";
import {
  experienceAudienceSchema,
  formConfigSchema,
  pageLayoutSchema,
  parseViewConfig,
  type ExperienceAudience,
  type FormConfig,
  type PageLayout,
  type ViewConfig,
} from "./schemas";

export class ExperienceServiceError extends Error {
  readonly code: string | null;

  constructor(message: string, cause?: PostgrestError | null) {
    super(message, { cause });
    this.name = "ExperienceServiceError";
    this.code = cause?.code ?? null;
  }
}

function requireResult<T>(
  data: T | null,
  error: PostgrestError | null,
  message: string,
): T {
  if (error || data === null) {
    throw new ExperienceServiceError(message, error);
  }

  return data;
}

export interface ExperienceViewBundle {
  definition: Tables<"views">;
  object: Tables<"object_definitions">;
  fields: Tables<"field_definitions">[];
  records: Tables<"records">[];
  config: ViewConfig;
}

export interface ExperienceFormBundle {
  definition: Tables<"forms">;
  object: Tables<"object_definitions">;
  fields: Tables<"field_definitions">[];
  config: FormConfig;
}

export interface ExperiencePageBundle {
  definition: Tables<"pages">;
  layout: PageLayout;
}

export interface ExperienceNavigation {
  pages: Tables<"pages">[];
  views: Tables<"views">[];
}

export interface PublicPageBundle {
  business: { name: string; slug: string };
  page: { key: string; title: string; slug: string; layout: PageLayout };
}

export interface ExperienceService {
  getViewById(viewDefinitionId: string): Promise<Tables<"views">>;
  loadView(
    viewKey: string,
    audience?: ExperienceAudience,
  ): Promise<ExperienceViewBundle>;
  loadDetailViewForObject(
    objectDefinitionId: string,
  ): Promise<ExperienceViewBundle | null>;
  loadForm(
    formKey: string,
    audience?: ExperienceAudience,
  ): Promise<ExperienceFormBundle>;
  loadPage(
    pageSlug: string,
    audience?: ExperienceAudience,
  ): Promise<ExperiencePageBundle>;
  listNavigation(): Promise<ExperienceNavigation>;
}

export function createExperienceService(
  client: SupabaseClient<Database>,
  tenant: { businessId: string },
): ExperienceService {
  const businessId = z.uuid().parse(tenant.businessId);

  async function getActiveView(
    viewKey: string,
    audience: ExperienceAudience,
  ): Promise<Tables<"views">> {
    const { data, error } = await client
      .from("views")
      .select("*")
      .eq("business_id", businessId)
      .eq("key", viewKey)
      .eq("audience", audience)
      .eq("is_active", true)
      .maybeSingle();

    return requireResult(data, error, "That screen is not available.");
  }

  async function buildViewBundle(
    definition: Tables<"views">,
  ): Promise<ExperienceViewBundle> {
    const config = parseViewConfig(
      definition.view_type,
      definition.config_json,
    );
    const includeArchived = config.include_archived;
    let recordsQuery = client
      .from("records")
      .select("*")
      .eq("business_id", businessId)
      .eq("object_definition_id", definition.object_definition_id)
      .order("created_at", { ascending: false });

    if (!includeArchived) {
      recordsQuery = recordsQuery.eq("record_status", "active");
    }

    const [objectResult, fieldsResult, recordsResult] = await Promise.all([
      client
        .from("object_definitions")
        .select("*")
        .eq("business_id", businessId)
        .eq("id", definition.object_definition_id)
        .eq("is_active", true)
        .maybeSingle(),
      client
        .from("field_definitions")
        .select("*")
        .eq("business_id", businessId)
        .eq("object_definition_id", definition.object_definition_id)
        .eq("is_active", true)
        .order("position"),
      recordsQuery,
    ]);

    const object = requireResult(
      objectResult.data,
      objectResult.error,
      "This screen is not available.",
    );
    const fields = requireResult(
      fieldsResult.data,
      fieldsResult.error,
      "Could not load screen fields.",
    );
    const records = requireResult(
      recordsResult.data,
      recordsResult.error,
      "Could not load business information.",
    );

    return { definition, object, fields, records, config };
  }

  return {
    async getViewById(viewDefinitionId) {
      const { data, error } = await client
        .from("views")
        .select("*")
        .eq("business_id", businessId)
        .eq("id", z.uuid().parse(viewDefinitionId))
        .maybeSingle();

      return requireResult(data, error, "That screen was not found.");
    },

    async loadView(viewKey, audience = "internal") {
      const definition = await getActiveView(
        z.string().parse(viewKey),
        experienceAudienceSchema.parse(audience),
      );
      return buildViewBundle(definition);
    },

    async loadDetailViewForObject(objectDefinitionId) {
      const { data, error } = await client
        .from("views")
        .select("*")
        .eq("business_id", businessId)
        .eq("object_definition_id", z.uuid().parse(objectDefinitionId))
        .eq("view_type", "detail")
        .eq("audience", "internal")
        .eq("is_active", true)
        .order("created_at")
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new ExperienceServiceError(
          "Could not load the detail screen.",
          error,
        );
      }

      return data ? buildViewBundle(data) : null;
    },

    async loadForm(formKey, audience = "internal") {
      const { data: definition, error: definitionError } = await client
        .from("forms")
        .select("*")
        .eq("business_id", businessId)
        .eq("key", formKey)
        .eq("audience", experienceAudienceSchema.parse(audience))
        .eq("is_active", true)
        .maybeSingle();
      const form = requireResult(
        definition,
        definitionError,
        "That form is not available.",
      );

      const [objectResult, fieldsResult] = await Promise.all([
        client
          .from("object_definitions")
          .select("*")
          .eq("business_id", businessId)
          .eq("id", form.object_definition_id)
          .eq("is_active", true)
          .maybeSingle(),
        client
          .from("field_definitions")
          .select("*")
          .eq("business_id", businessId)
          .eq("object_definition_id", form.object_definition_id)
          .eq("is_active", true)
          .order("position"),
      ]);

      return {
        definition: form,
        object: requireResult(
          objectResult.data,
          objectResult.error,
          "That form is not available.",
        ),
        fields: requireResult(
          fieldsResult.data,
          fieldsResult.error,
          "Could not load form fields.",
        ),
        config: formConfigSchema.parse(form.config_json),
      };
    },

    async loadPage(pageSlug, audience = "internal") {
      const { data, error } = await client
        .from("pages")
        .select("*")
        .eq("business_id", businessId)
        .eq("slug", pageSlug)
        .eq("audience", experienceAudienceSchema.parse(audience))
        .eq("is_active", true)
        .maybeSingle();
      const definition = requireResult(
        data,
        error,
        "That page is not available.",
      );

      return {
        definition,
        layout: pageLayoutSchema.parse(definition.layout_json),
      };
    },

    async listNavigation() {
      const [viewsResult, pagesResult] = await Promise.all([
        client
          .from("views")
          .select("*")
          .eq("business_id", businessId)
          .eq("audience", "internal")
          .eq("is_active", true)
          .neq("view_type", "detail")
          .order("created_at"),
        client
          .from("pages")
          .select("*")
          .eq("business_id", businessId)
          .eq("audience", "internal")
          .eq("is_active", true)
          .order("created_at"),
      ]);

      return {
        views: requireResult(
          viewsResult.data,
          viewsResult.error,
          "Could not load workspace navigation.",
        ),
        pages: requireResult(
          pagesResult.data,
          pagesResult.error,
          "Could not load workspace navigation.",
        ),
      };
    },
  };
}

const publicPageBundleSchema = z.object({
  business: z.object({
    name: z.string(),
    slug: z.string(),
  }),
  page: z.object({
    key: z.string(),
    title: z.string(),
    slug: z.string(),
    layout: pageLayoutSchema,
  }),
});

export async function resolvePublicPage(
  client: SupabaseClient<Database>,
  businessSlug: string,
  pageSlug: string,
): Promise<PublicPageBundle | null> {
  const { data, error } = await client.rpc("resolve_public_page", {
    requested_business_slug: businessSlug,
    requested_page_slug: pageSlug,
  });

  if (error) {
    throw new ExperienceServiceError("Could not load the public page.", error);
  }

  if (data === null) {
    return null;
  }

  return publicPageBundleSchema.parse(data);
}
