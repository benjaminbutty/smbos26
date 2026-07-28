import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type {
  Database,
  Tables,
  TablesUpdate,
} from "../../db/supabase/database.types";
import {
  createFormDefinitionSchema,
  createPageDefinitionSchema,
  createViewDefinitionSchema,
  experienceAudienceSchema,
  formConfigSchema,
  pageLayoutSchema,
  parseViewConfig,
  toJson,
  updateFormDefinitionSchema,
  updatePageDefinitionSchema,
  updateViewDefinitionSchema,
  type CreateFormDefinitionInput,
  type CreatePageDefinitionInput,
  type CreateViewDefinitionInput,
  type ExperienceAudience,
  type FormConfig,
  type PageLayout,
  type UpdateFormDefinitionInput,
  type UpdatePageDefinitionInput,
  type UpdateViewDefinitionInput,
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
  createView(input: CreateViewDefinitionInput): Promise<Tables<"views">>;
  updateView(input: UpdateViewDefinitionInput): Promise<Tables<"views">>;
  createForm(input: CreateFormDefinitionInput): Promise<Tables<"forms">>;
  updateForm(input: UpdateFormDefinitionInput): Promise<Tables<"forms">>;
  createPage(input: CreatePageDefinitionInput): Promise<Tables<"pages">>;
  updatePage(input: UpdatePageDefinitionInput): Promise<Tables<"pages">>;
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
    async createView(input) {
      const value = createViewDefinitionSchema.parse(input);
      const config = parseViewConfig(value.viewType, value.config);
      const { data, error } = await client
        .from("views")
        .insert({
          business_id: businessId,
          key: value.key,
          name: value.name,
          view_type: value.viewType,
          object_definition_id: value.objectDefinitionId,
          config_json: toJson(config),
          audience: value.audience,
          is_active: value.isActive,
        })
        .select("*")
        .single();

      return requireResult(data, error, "Could not create the screen.");
    },

    async updateView(input) {
      const value = updateViewDefinitionSchema.parse(input);
      const { data: existing, error: existingError } = await client
        .from("views")
        .select("*")
        .eq("business_id", businessId)
        .eq("id", value.viewDefinitionId)
        .maybeSingle();
      const current = requireResult(
        existing,
        existingError,
        "That screen was not found.",
      );
      const changes: TablesUpdate<"views"> = {};

      if (value.changes.name !== undefined) {
        changes.name = value.changes.name;
      }
      if (value.changes.viewType !== undefined) {
        changes.view_type = value.changes.viewType;
      }
      if (value.changes.config !== undefined) {
        changes.config_json = toJson(
          parseViewConfig(
            value.changes.viewType ?? current.view_type,
            value.changes.config,
          ),
        );
      }
      if (value.changes.audience !== undefined) {
        changes.audience = value.changes.audience;
      }
      if (value.changes.isActive !== undefined) {
        changes.is_active = value.changes.isActive;
      }

      const { data, error } = await client
        .from("views")
        .update(changes)
        .eq("business_id", businessId)
        .eq("id", value.viewDefinitionId)
        .select("*")
        .maybeSingle();

      return requireResult(data, error, "Could not update the screen.");
    },

    async createForm(input) {
      const value = createFormDefinitionSchema.parse(input);
      const { data, error } = await client
        .from("forms")
        .insert({
          business_id: businessId,
          key: value.key,
          name: value.name,
          object_definition_id: value.objectDefinitionId,
          mode: value.mode,
          config_json: toJson(value.config),
          audience: value.audience,
          is_active: value.isActive,
        })
        .select("*")
        .single();

      return requireResult(data, error, "Could not create the form.");
    },

    async updateForm(input) {
      const value = updateFormDefinitionSchema.parse(input);
      const changes: TablesUpdate<"forms"> = {};

      if (value.changes.name !== undefined) {
        changes.name = value.changes.name;
      }
      if (value.changes.config !== undefined) {
        changes.config_json = toJson(value.changes.config);
      }
      if (value.changes.audience !== undefined) {
        changes.audience = value.changes.audience;
      }
      if (value.changes.isActive !== undefined) {
        changes.is_active = value.changes.isActive;
      }

      const { data, error } = await client
        .from("forms")
        .update(changes)
        .eq("business_id", businessId)
        .eq("id", value.formDefinitionId)
        .select("*")
        .maybeSingle();

      return requireResult(data, error, "Could not update the form.");
    },

    async createPage(input) {
      const value = createPageDefinitionSchema.parse(input);
      const { data, error } = await client
        .from("pages")
        .insert({
          business_id: businessId,
          key: value.key,
          title: value.title,
          slug: value.slug,
          audience: value.audience,
          layout_json: toJson(value.layout),
          status: value.status,
          is_active: value.isActive,
        })
        .select("*")
        .single();

      return requireResult(data, error, "Could not create the page.");
    },

    async updatePage(input) {
      const value = updatePageDefinitionSchema.parse(input);
      const changes: TablesUpdate<"pages"> = {};

      if (value.changes.title !== undefined) {
        changes.title = value.changes.title;
      }
      if (value.changes.slug !== undefined) {
        changes.slug = value.changes.slug;
      }
      if (value.changes.audience !== undefined) {
        changes.audience = value.changes.audience;
      }
      if (value.changes.layout !== undefined) {
        changes.layout_json = toJson(value.changes.layout);
      }
      if (value.changes.status !== undefined) {
        changes.status = value.changes.status;
      }
      if (value.changes.isActive !== undefined) {
        changes.is_active = value.changes.isActive;
      }

      const { data, error } = await client
        .from("pages")
        .update(changes)
        .eq("business_id", businessId)
        .eq("id", value.pageDefinitionId)
        .select("*")
        .maybeSingle();

      return requireResult(data, error, "Could not update the page.");
    },

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
