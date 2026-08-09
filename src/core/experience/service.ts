import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Json, Tables } from "../../db/supabase/database.types";
import {
  createActiveConfigurationDefinitionSource,
  type ConfigurationDefinitionSource,
  type SourcedViewDefinition,
} from "../configuration/definition-source";
import {
  experienceAudienceSchema,
  formConfigSchema,
  pageLayoutSchema,
  parseViewConfig,
  type ExperienceAudience,
  type FormConfig,
  type PageLayout,
  type TableViewConfig,
  type ViewConfig,
} from "./schemas";
import {
  inlineEditableFieldKeys,
  type InlineEditEligibility,
} from "./inline-edit";

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

function valueMatchesField(
  value: Json,
  field: Tables<"field_definitions">,
): boolean {
  switch (field.field_type) {
    case "boolean":
      return typeof value === "boolean";
    case "number":
    case "currency":
      return typeof value === "number" && Number.isFinite(value);
    case "multi_select":
      return (
        Array.isArray(value) && value.every((item) => typeof item === "string")
      );
    case "short_text":
    case "long_text":
    case "date":
    case "datetime":
    case "email":
    case "phone":
    case "url":
    case "select":
    case "file":
    case "status":
      return typeof value === "string" || field.field_type === "file";
  }
}

function recordMatchesDefinitions(
  record: Tables<"records">,
  fields: Tables<"field_definitions">[],
): boolean {
  const data = record.data_json;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return false;
  }
  return fields.every((field) => {
    const value = data[field.key];
    if (value === undefined || value === null || value === "") {
      return !field.required;
    }
    return valueMatchesField(value, field);
  });
}

export interface ExperienceViewBundle {
  definition: Tables<"views">;
  object: Tables<"object_definitions">;
  fields: Tables<"field_definitions">[];
  records: Tables<"records">[];
  config: ViewConfig;
  inlineEdit?: InlineEditEligibility;
  warnings?: string[];
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

type NavigationView = Pick<
  Tables<"views">,
  "key" | "name" | "view_type" | "audience" | "is_active"
>;

export function normalizeNavigationDisplayText(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFKC")
    .toLocaleLowerCase("en");
}

export function isSimpleViewWrapperPage(
  page: Tables<"pages">,
  views: readonly NavigationView[],
): string | null {
  if (!page.is_active || page.audience !== "internal") {
    return null;
  }

  const layout = pageLayoutSchema.safeParse(page.layout_json);
  if (!layout.success || layout.data.blocks.length !== 2) {
    return null;
  }

  const [heading, viewBlock] = layout.data.blocks;
  if (
    heading?.type !== "heading" ||
    heading.level !== 1 ||
    viewBlock?.type !== "view" ||
    normalizeNavigationDisplayText(heading.text) !==
      normalizeNavigationDisplayText(page.title)
  ) {
    return null;
  }

  const view = views.find((candidate) => candidate.key === viewBlock.view_key);
  if (
    !view ||
    !view.is_active ||
    view.audience !== "internal" ||
    view.view_type === "detail" ||
    normalizeNavigationDisplayText(page.title) !==
      normalizeNavigationDisplayText(view.name)
  ) {
    return null;
  }

  return view.key;
}

export async function resolveInlineEditEligibility(
  source: ConfigurationDefinitionSource,
  definition: SourcedViewDefinition,
  config: ViewConfig,
  fields: Tables<"field_definitions">[],
): Promise<InlineEditEligibility | undefined> {
  if (
    source.kind !== "live" ||
    definition.audience !== "internal" ||
    !definition.is_active ||
    definition.view_type !== "table"
  ) {
    return undefined;
  }

  const tableConfig = config as TableViewConfig;
  const formKey = tableConfig.edit_form_key;
  if (!formKey) {
    return undefined;
  }

  const form = await source.getFormByKey(formKey);
  if (
    !form ||
    !form.is_active ||
    form.audience !== "internal" ||
    form.mode !== "edit" ||
    form.business_id !== definition.business_id ||
    form.object_definition_id !== definition.object_definition_id
  ) {
    return undefined;
  }

  const parsedFormConfig = formConfigSchema.safeParse(form.config_json);
  if (!parsedFormConfig.success) {
    return undefined;
  }

  const tableFields = fields.filter(
    (field) =>
      field.business_id === definition.business_id &&
      field.object_definition_id === definition.object_definition_id,
  );

  return {
    formKey,
    fieldKeys: inlineEditableFieldKeys(
      tableConfig.fields,
      tableFields,
      parsedFormConfig.data,
    ),
  };
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
  loadPageByKey(
    pageKey: string,
    audience?: ExperienceAudience,
  ): Promise<ExperiencePageBundle>;
  listNavigation(): Promise<ExperienceNavigation>;
}

export function createExperienceService(
  client: SupabaseClient<Database>,
  tenant: { businessId: string },
  definitionSource?: ConfigurationDefinitionSource,
): ExperienceService {
  const businessId = z.uuid().parse(tenant.businessId);
  const source =
    definitionSource ??
    createActiveConfigurationDefinitionSource(client, { businessId });

  async function getActiveView(
    viewKey: string,
    audience: ExperienceAudience,
  ): Promise<SourcedViewDefinition> {
    const definition = await source.getViewByKey(viewKey);
    if (!definition || definition.audience !== audience) {
      throw new ExperienceServiceError("That screen is not available.");
    }
    return definition;
  }

  async function buildViewBundle(
    sourcedDefinition: SourcedViewDefinition,
  ): Promise<ExperienceViewBundle> {
    const { object_key: objectKey, ...definition } = sourcedDefinition;
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

    const [object, fields, recordsResult] = await Promise.all([
      source.getObjectByKey(objectKey),
      source.listFieldsForObject(objectKey),
      recordsQuery,
    ]);
    if (!object) {
      throw new ExperienceServiceError("This screen is not available.");
    }
    const records = requireResult(
      recordsResult.data,
      recordsResult.error,
      "Could not load business information.",
    );
    const warnings =
      source.kind === "snapshot" &&
      records.some((record) => !recordMatchesDefinitions(record, fields))
        ? [
            "Some existing information does not match this proposed configuration and is shown without changing it.",
          ]
        : [];
    const inlineEdit = await resolveInlineEditEligibility(
      source,
      sourcedDefinition,
      config,
      fields,
    );

    return {
      definition,
      object,
      fields,
      records,
      config,
      ...(inlineEdit ? { inlineEdit } : {}),
      warnings,
    };
  }

  return {
    async getViewById(viewDefinitionId) {
      const sourcedDefinition = await source.getViewById(
        z.uuid().parse(viewDefinitionId),
      );
      if (!sourcedDefinition) {
        throw new ExperienceServiceError("That screen was not found.");
      }
      const { object_key: objectKey, ...definition } = sourcedDefinition;
      void objectKey;
      return definition;
    },

    async loadView(viewKey, audience = "internal") {
      const definition = await getActiveView(
        z.string().parse(viewKey),
        experienceAudienceSchema.parse(audience),
      );
      return buildViewBundle(definition);
    },

    async loadDetailViewForObject(objectDefinitionId) {
      const definition = await source.getDetailViewForObjectId(
        z.uuid().parse(objectDefinitionId),
      );
      return definition ? buildViewBundle(definition) : null;
    },

    async loadForm(formKey, audience = "internal") {
      const parsedAudience = experienceAudienceSchema.parse(audience);
      const sourcedForm = await source.getFormByKey(formKey);
      if (!sourcedForm || sourcedForm.audience !== parsedAudience) {
        throw new ExperienceServiceError("That form is not available.");
      }
      const { object_key: objectKey, ...form } = sourcedForm;
      const [object, fields] = await Promise.all([
        source.getObjectByKey(objectKey),
        source.listFieldsForObject(objectKey),
      ]);
      if (!object) {
        throw new ExperienceServiceError("That form is not available.");
      }

      return {
        definition: form,
        object,
        fields,
        config: formConfigSchema.parse(form.config_json),
      };
    },

    async loadPage(pageSlug, audience = "internal") {
      const definition = await source.getPageBySlug(pageSlug);
      if (
        !definition ||
        definition.audience !== experienceAudienceSchema.parse(audience)
      ) {
        throw new ExperienceServiceError("That page is not available.");
      }

      return {
        definition,
        layout: pageLayoutSchema.parse(definition.layout_json),
      };
    },

    async loadPageByKey(pageKey, audience = "internal") {
      const definition = await source.getPageByKey(pageKey);
      if (
        !definition ||
        definition.audience !== experienceAudienceSchema.parse(audience)
      ) {
        throw new ExperienceServiceError("That page is not available.");
      }
      return {
        definition,
        layout: pageLayoutSchema.parse(definition.layout_json),
      };
    },

    async listNavigation() {
      const [sourcedViews, pages] = await Promise.all([
        source.listViews(),
        source.listPages(),
      ]);

      const views = sourcedViews.filter(
        (view) => view.audience === "internal" && view.view_type !== "detail",
      );
      const wrapperPageKeys = new Set(
        pages.flatMap((page) => {
          const viewKey = isSimpleViewWrapperPage(page, views);
          return viewKey ? [page.key] : [];
        }),
      );

      return {
        views: views.map(({ object_key: objectKey, ...view }) => {
          void objectKey;
          return view;
        }),
        pages: pages.filter(
          (page) =>
            page.audience === "internal" && !wrapperPageKeys.has(page.key),
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
