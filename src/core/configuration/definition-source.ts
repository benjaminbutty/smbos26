import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Json, Tables } from "../../db/supabase/database.types";
import {
  experienceAudienceSchema,
  experienceFormModeSchema,
  experiencePageStatusSchema,
  experienceViewTypeSchema,
  formConfigSchema,
  pageLayoutSchema,
} from "../experience/schemas";
import {
  graphFieldTypeSchema,
  jsonObjectSchema,
  jsonValueSchema,
  relationshipCardinalitySchema,
} from "../graph/schemas";
import { preorderConfigSchema } from "../preorder/schemas";

type ObjectDefinition = Tables<"object_definitions">;
type FieldDefinition = Tables<"field_definitions">;
type PageDefinition = Tables<"pages">;
type PreorderDefinition = Tables<"preorder_experiences">;
type PreorderLocation = Tables<"preorder_experience_locations">;
type RelationshipDefinition = Tables<"relationship_definitions">;

export type SourcedViewDefinition = Tables<"views"> & {
  object_key: string;
};
export type SourcedFormDefinition = Tables<"forms"> & {
  object_key: string;
};

export interface ConfigurationDefinitionSource {
  readonly kind: "live" | "snapshot";
  listPages(): Promise<PageDefinition[]>;
  listViews(): Promise<SourcedViewDefinition[]>;
  listRelationships(): Promise<RelationshipDefinition[]>;
  getPageByKey(pageKey: string): Promise<PageDefinition | null>;
  getPageBySlug(pageSlug: string): Promise<PageDefinition | null>;
  getViewById(viewId: string): Promise<SourcedViewDefinition | null>;
  getViewByKey(viewKey: string): Promise<SourcedViewDefinition | null>;
  getDetailViewForObjectId(
    objectId: string,
  ): Promise<SourcedViewDefinition | null>;
  getFormByKey(formKey: string): Promise<SourcedFormDefinition | null>;
  getObjectById(objectId: string): Promise<ObjectDefinition | null>;
  getObjectByKey(objectKey: string): Promise<ObjectDefinition | null>;
  listFieldsForObject(objectKey: string): Promise<FieldDefinition[]>;
  listPreorders(): Promise<PreorderDefinition[]>;
  getPreorderByKey(preorderKey: string): Promise<PreorderDefinition | null>;
  listPreorderLocations(preorderKey: string): Promise<PreorderLocation[]>;
}

const snapshotObjectSchema = z
  .object({
    id: z.uuid(),
    key: z.string(),
    singular_label: z.string(),
    plural_label: z.string(),
    description: z.string(),
    kind: z.enum(["template", "custom"]),
    semantic_type: z.string().nullable(),
    icon: z.string().nullable(),
    is_active: z.boolean(),
  })
  .strict();

const snapshotFieldSchema = z
  .object({
    id: z.uuid(),
    object_definition_id: z.uuid(),
    object_key: z.string(),
    key: z.string(),
    label: z.string(),
    field_type: graphFieldTypeSchema,
    required: z.boolean(),
    default_value: jsonValueSchema.nullable(),
    settings_json: jsonObjectSchema,
    position: z.number().int(),
    is_active: z.boolean(),
  })
  .strict();

const snapshotViewSchema = z
  .object({
    id: z.uuid(),
    key: z.string(),
    name: z.string(),
    view_type: experienceViewTypeSchema,
    object_definition_id: z.uuid(),
    object_key: z.string(),
    config_json: jsonObjectSchema,
    audience: experienceAudienceSchema,
    is_active: z.boolean(),
  })
  .strict();

const snapshotFormSchema = z
  .object({
    id: z.uuid(),
    key: z.string(),
    name: z.string(),
    object_definition_id: z.uuid(),
    object_key: z.string(),
    mode: experienceFormModeSchema,
    config_json: formConfigSchema,
    audience: experienceAudienceSchema,
    is_active: z.boolean(),
  })
  .strict();

const snapshotPageSchema = z
  .object({
    id: z.uuid(),
    key: z.string(),
    title: z.string(),
    slug: z.string(),
    audience: experienceAudienceSchema,
    layout_json: pageLayoutSchema,
    status: experiencePageStatusSchema,
    is_active: z.boolean(),
  })
  .strict();

const snapshotPreorderSchema = z
  .object({
    id: z.uuid(),
    key: z.string(),
    product_object_definition_id: z.uuid(),
    product_object_key: z.string(),
    customer_object_definition_id: z.uuid(),
    customer_object_key: z.string(),
    order_object_definition_id: z.uuid(),
    order_object_key: z.string(),
    order_item_object_definition_id: z.uuid(),
    order_item_object_key: z.string(),
    customer_places_order_relationship_definition_id: z.uuid(),
    customer_places_order_relationship_key: z.string(),
    order_contains_item_relationship_definition_id: z.uuid(),
    order_contains_item_relationship_key: z.string(),
    product_appears_in_item_relationship_definition_id: z.uuid(),
    product_appears_in_item_relationship_key: z.string(),
    config_json: preorderConfigSchema,
    is_active: z.boolean(),
  })
  .strict();

const snapshotPreorderLocationSchema = z
  .object({
    id: z.uuid(),
    preorder_experience_id: z.uuid(),
    preorder_key: z.string(),
    location_id: z.uuid(),
    is_active: z.boolean(),
  })
  .strict();

const snapshotRelationshipSchema = z
  .object({
    id: z.uuid(),
    key: z.string(),
    source_object_definition_id: z.uuid(),
    source_object_key: z.string(),
    target_object_definition_id: z.uuid(),
    target_object_key: z.string(),
    source_label: z.string(),
    target_label: z.string(),
    cardinality: relationshipCardinalitySchema,
    is_required: z.boolean(),
    is_active: z.boolean(),
  })
  .strict();

export const configurationSnapshotV1Schema = z
  .object({
    schema_version: z.literal(1),
    object_definitions: z.array(snapshotObjectSchema),
    field_definitions: z.array(snapshotFieldSchema),
    relationship_definitions: z.array(snapshotRelationshipSchema),
    views: z.array(snapshotViewSchema),
    forms: z.array(snapshotFormSchema),
    pages: z.array(snapshotPageSchema),
    preorder_experiences: z.array(snapshotPreorderSchema),
    preorder_experience_locations: z.array(snapshotPreorderLocationSchema),
  })
  .strict();

export type ConfigurationSnapshotV1 = z.infer<
  typeof configurationSnapshotV1Schema
>;

function requireRows<T>(
  data: T[] | null,
  error: PostgrestError | null,
  message: string,
): T[] {
  if (error || data === null) {
    throw new Error(message, { cause: error });
  }
  return data;
}

function requireOptional<T>(
  data: T | null,
  error: PostgrestError | null,
  message: string,
): T | null {
  if (error) {
    throw new Error(message, { cause: error });
  }
  return data;
}

export function createActiveConfigurationDefinitionSource(
  client: SupabaseClient<Database>,
  tenant: { businessId: string },
): ConfigurationDefinitionSource {
  const businessId = z.uuid().parse(tenant.businessId);
  const objectsById = new Map<string, ObjectDefinition | null>();
  const objectsByKey = new Map<string, ObjectDefinition | null>();
  const fieldsByObjectId = new Map<string, FieldDefinition[]>();
  const preordersByKey = new Map<string, PreorderDefinition | null>();
  const preorderLocationsByKey = new Map<string, PreorderLocation[]>();

  function rememberObject(object: ObjectDefinition | null): void {
    if (!object) {
      return;
    }
    objectsById.set(object.id, object);
    objectsByKey.set(object.key, object);
  }

  async function getObjectById(
    objectId: string,
  ): Promise<ObjectDefinition | null> {
    const parsedObjectId = z.uuid().parse(objectId);
    if (objectsById.has(parsedObjectId)) {
      return objectsById.get(parsedObjectId) ?? null;
    }
    const { data, error } = await client
      .from("object_definitions")
      .select("*")
      .eq("business_id", businessId)
      .eq("id", parsedObjectId)
      .eq("is_active", true)
      .maybeSingle();
    const object = requireOptional(
      data,
      error,
      "Could not load configured Object.",
    );
    objectsById.set(parsedObjectId, object);
    rememberObject(object);
    return object;
  }

  async function getObjectByKey(
    objectKey: string,
  ): Promise<ObjectDefinition | null> {
    if (objectsByKey.has(objectKey)) {
      return objectsByKey.get(objectKey) ?? null;
    }
    const { data, error } = await client
      .from("object_definitions")
      .select("*")
      .eq("business_id", businessId)
      .eq("key", objectKey)
      .eq("is_active", true)
      .maybeSingle();
    const object = requireOptional(
      data,
      error,
      "Could not load configured Object.",
    );
    objectsByKey.set(objectKey, object);
    rememberObject(object);
    return object;
  }

  async function preloadObjects(objectIds: string[]): Promise<void> {
    const missingIds = [
      ...new Set(objectIds.filter((objectId) => !objectsById.has(objectId))),
    ];
    if (missingIds.length === 0) {
      return;
    }
    const { data, error } = await client
      .from("object_definitions")
      .select("*")
      .eq("business_id", businessId)
      .in("id", missingIds)
      .eq("is_active", true);
    const objects = requireRows(
      data,
      error,
      "Could not load configured Objects.",
    );
    const loadedIds = new Set(objects.map((object) => object.id));
    for (const object of objects) {
      rememberObject(object);
    }
    for (const objectId of missingIds) {
      if (!loadedIds.has(objectId)) {
        objectsById.set(objectId, null);
      }
    }
  }

  async function withObjectKey<
    Definition extends Tables<"views"> | Tables<"forms">,
  >(
    definition: Definition | null,
  ): Promise<(Definition & { object_key: string }) | null> {
    if (!definition) {
      return null;
    }
    const object = await getObjectById(definition.object_definition_id);
    return object ? { ...definition, object_key: object.key } : null;
  }

  return {
    kind: "live",

    async listPages() {
      const { data, error } = await client
        .from("pages")
        .select("*")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .order("created_at");
      return requireRows(data, error, "Could not load configured Pages.");
    },

    async listViews() {
      const { data, error } = await client
        .from("views")
        .select("*")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .order("created_at");
      const definitions = requireRows(
        data,
        error,
        "Could not load configured Views.",
      );
      await preloadObjects(
        definitions.map((definition) => definition.object_definition_id),
      );
      return definitions.flatMap((definition) => {
        const object = objectsById.get(definition.object_definition_id);
        return object ? [{ ...definition, object_key: object.key }] : [];
      });
    },

    async listRelationships() {
      const { data, error } = await client
        .from("relationship_definitions")
        .select("*")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .order("created_at");
      return requireRows(data, error, "Could not load configured Connections.");
    },

    async listPreorders() {
      const { data, error } = await client
        .from("preorder_experiences")
        .select("*")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .order("created_at");
      return requireRows(data, error, "Could not load configured preorders.");
    },

    async getPageByKey(pageKey) {
      const { data, error } = await client
        .from("pages")
        .select("*")
        .eq("business_id", businessId)
        .eq("key", pageKey)
        .eq("is_active", true)
        .maybeSingle();
      return requireOptional(data, error, "Could not load configured Page.");
    },

    async getPageBySlug(pageSlug) {
      const { data, error } = await client
        .from("pages")
        .select("*")
        .eq("business_id", businessId)
        .eq("slug", pageSlug)
        .eq("is_active", true)
        .maybeSingle();
      return requireOptional(data, error, "Could not load configured Page.");
    },

    async getViewById(viewId) {
      const { data, error } = await client
        .from("views")
        .select("*")
        .eq("business_id", businessId)
        .eq("id", z.uuid().parse(viewId))
        .eq("is_active", true)
        .maybeSingle();
      return withObjectKey(
        requireOptional(data, error, "Could not load configured View."),
      );
    },

    async getViewByKey(viewKey) {
      const { data, error } = await client
        .from("views")
        .select("*")
        .eq("business_id", businessId)
        .eq("key", viewKey)
        .eq("is_active", true)
        .maybeSingle();
      return withObjectKey(
        requireOptional(data, error, "Could not load configured View."),
      );
    },

    async getDetailViewForObjectId(objectId) {
      const { data, error } = await client
        .from("views")
        .select("*")
        .eq("business_id", businessId)
        .eq("object_definition_id", z.uuid().parse(objectId))
        .eq("view_type", "detail")
        .eq("audience", "internal")
        .eq("is_active", true)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      return withObjectKey(
        requireOptional(data, error, "Could not load the detail screen."),
      );
    },

    async getFormByKey(formKey) {
      const { data, error } = await client
        .from("forms")
        .select("*")
        .eq("business_id", businessId)
        .eq("key", formKey)
        .eq("is_active", true)
        .maybeSingle();
      return withObjectKey(
        requireOptional(data, error, "Could not load configured Form."),
      );
    },

    async getObjectById(objectId) {
      return getObjectById(objectId);
    },

    async getObjectByKey(objectKey) {
      return getObjectByKey(objectKey);
    },

    async listFieldsForObject(objectKey) {
      const object = await getObjectByKey(objectKey);
      if (!object) {
        return [];
      }
      const cached = fieldsByObjectId.get(object.id);
      if (cached) {
        return cached;
      }
      const { data, error } = await client
        .from("field_definitions")
        .select("*")
        .eq("business_id", businessId)
        .eq("object_definition_id", object.id)
        .eq("is_active", true)
        .order("position");
      const fields = requireRows(
        data,
        error,
        "Could not load configured Fields.",
      );
      fieldsByObjectId.set(object.id, fields);
      return fields;
    },

    async getPreorderByKey(preorderKey) {
      if (preordersByKey.has(preorderKey)) {
        return preordersByKey.get(preorderKey) ?? null;
      }
      const { data, error } = await client
        .from("preorder_experiences")
        .select("*")
        .eq("business_id", businessId)
        .eq("key", preorderKey)
        .eq("is_active", true)
        .maybeSingle();
      const preorder = requireOptional(
        data,
        error,
        "Could not load configured preorder.",
      );
      preordersByKey.set(preorderKey, preorder);
      return preorder;
    },

    async listPreorderLocations(preorderKey) {
      const cached = preorderLocationsByKey.get(preorderKey);
      if (cached) {
        return cached;
      }
      const preorder = await this.getPreorderByKey(preorderKey);
      if (!preorder) {
        return [];
      }
      const { data, error } = await client
        .from("preorder_experience_locations")
        .select("*")
        .eq("business_id", businessId)
        .eq("preorder_experience_id", preorder.id)
        .eq("is_active", true);
      const locations = requireRows(
        data,
        error,
        "Could not load preorder Locations.",
      );
      preorderLocationsByKey.set(preorderKey, locations);
      return locations;
    },
  };
}

const snapshotTimestamp = "1970-01-01T00:00:00.000Z";

export function createSnapshotConfigurationDefinitionSource(
  candidate: Json,
  tenant: { businessId: string },
): ConfigurationDefinitionSource {
  const businessId = z.uuid().parse(tenant.businessId);
  const snapshot = configurationSnapshotV1Schema.parse(candidate);
  const objects = snapshot.object_definitions
    .filter((definition) => definition.is_active)
    .map((definition): ObjectDefinition => ({
      ...definition,
      business_id: businessId,
      created_at: snapshotTimestamp,
      updated_at: snapshotTimestamp,
    }));
  const objectByKey = new Map(
    objects.map((definition) => [definition.key, definition]),
  );
  const objectById = new Map(
    objects.map((definition) => [definition.id, definition]),
  );
  const fields = snapshot.field_definitions
    .filter(
      (definition) =>
        definition.is_active && objectByKey.has(definition.object_key),
    )
    .map((definition): FieldDefinition => ({
      id: definition.id,
      business_id: businessId,
      object_definition_id: definition.object_definition_id,
      key: definition.key,
      label: definition.label,
      field_type: definition.field_type,
      required: definition.required,
      default_value: definition.default_value as Json | null,
      settings_json: definition.settings_json as Json,
      position: definition.position,
      is_active: definition.is_active,
      created_at: snapshotTimestamp,
      updated_at: snapshotTimestamp,
    }));
  const views: SourcedViewDefinition[] = snapshot.views
    .filter(
      (definition) =>
        definition.is_active && objectByKey.has(definition.object_key),
    )
    .map((definition) => ({
      id: definition.id,
      business_id: businessId,
      key: definition.key,
      name: definition.name,
      view_type: definition.view_type,
      object_definition_id: definition.object_definition_id,
      object_key: definition.object_key,
      config_json: definition.config_json as Json,
      audience: definition.audience,
      is_active: definition.is_active,
      created_at: snapshotTimestamp,
      updated_at: snapshotTimestamp,
    }));
  const forms: SourcedFormDefinition[] = snapshot.forms
    .filter(
      (definition) =>
        definition.is_active && objectByKey.has(definition.object_key),
    )
    .map((definition) => ({
      id: definition.id,
      business_id: businessId,
      key: definition.key,
      name: definition.name,
      object_definition_id: definition.object_definition_id,
      object_key: definition.object_key,
      mode: definition.mode,
      config_json: definition.config_json as Json,
      audience: definition.audience,
      is_active: definition.is_active,
      created_at: snapshotTimestamp,
      updated_at: snapshotTimestamp,
    }));
  const pages: PageDefinition[] = snapshot.pages
    .filter((definition) => definition.is_active)
    .map((definition) => ({
      ...definition,
      business_id: businessId,
      layout_json: definition.layout_json as Json,
      created_at: snapshotTimestamp,
      updated_at: snapshotTimestamp,
    }));
  const preorders: PreorderDefinition[] = snapshot.preorder_experiences
    .filter((definition) => definition.is_active)
    .map((definition) => ({
      id: definition.id,
      business_id: businessId,
      key: definition.key,
      product_object_definition_id: definition.product_object_definition_id,
      customer_object_definition_id: definition.customer_object_definition_id,
      order_object_definition_id: definition.order_object_definition_id,
      order_item_object_definition_id:
        definition.order_item_object_definition_id,
      customer_places_order_relationship_definition_id:
        definition.customer_places_order_relationship_definition_id,
      order_contains_item_relationship_definition_id:
        definition.order_contains_item_relationship_definition_id,
      product_appears_in_item_relationship_definition_id:
        definition.product_appears_in_item_relationship_definition_id,
      config_json: definition.config_json as Json,
      is_active: definition.is_active,
      created_at: snapshotTimestamp,
      updated_at: snapshotTimestamp,
    }));
  const preorderByKey = new Map(
    preorders.map((definition) => [definition.key, definition]),
  );
  const preorderLocations: Array<PreorderLocation & { preorder_key: string }> =
    snapshot.preorder_experience_locations
      .filter(
        (definition) =>
          definition.is_active && preorderByKey.has(definition.preorder_key),
      )
      .map((definition) => ({
        id: definition.id,
        business_id: businessId,
        preorder_experience_id: definition.preorder_experience_id,
        preorder_key: definition.preorder_key,
        location_id: definition.location_id,
        is_active: definition.is_active,
        created_at: snapshotTimestamp,
      }));
  const relationships: RelationshipDefinition[] =
    snapshot.relationship_definitions
      .filter((definition) => definition.is_active)
      .map((definition) => ({
        id: definition.id,
        business_id: businessId,
        key: definition.key,
        source_object_definition_id: definition.source_object_definition_id,
        target_object_definition_id: definition.target_object_definition_id,
        source_label: definition.source_label,
        target_label: definition.target_label,
        cardinality: definition.cardinality,
        is_required: definition.is_required,
        is_active: definition.is_active,
        created_at: snapshotTimestamp,
        updated_at: snapshotTimestamp,
      }));

  return {
    kind: "snapshot",

    async listPages() {
      return pages;
    },
    async listViews() {
      return views;
    },
    async listRelationships() {
      return relationships;
    },
    async listPreorders() {
      return preorders;
    },
    async getPageByKey(pageKey) {
      return pages.find((definition) => definition.key === pageKey) ?? null;
    },
    async getPageBySlug(pageSlug) {
      return pages.find((definition) => definition.slug === pageSlug) ?? null;
    },
    async getViewById(viewId) {
      return views.find((definition) => definition.id === viewId) ?? null;
    },
    async getViewByKey(viewKey) {
      return views.find((definition) => definition.key === viewKey) ?? null;
    },
    async getDetailViewForObjectId(requestedObjectId) {
      return (
        views.find(
          (definition) =>
            definition.object_definition_id === requestedObjectId &&
            definition.view_type === "detail" &&
            definition.audience === "internal",
        ) ?? null
      );
    },
    async getFormByKey(formKey) {
      return forms.find((definition) => definition.key === formKey) ?? null;
    },
    async getObjectById(requestedObjectId) {
      return objectById.get(requestedObjectId) ?? null;
    },
    async getObjectByKey(requestedObjectKey) {
      return objectByKey.get(requestedObjectKey) ?? null;
    },
    async listFieldsForObject(requestedObjectKey) {
      const object = objectByKey.get(requestedObjectKey);
      return object
        ? fields
            .filter(
              (definition) => definition.object_definition_id === object.id,
            )
            .toSorted((left, right) => left.position - right.position)
        : [];
    },
    async getPreorderByKey(preorderKey) {
      return preorderByKey.get(preorderKey) ?? null;
    },
    async listPreorderLocations(preorderKey) {
      return preorderLocations
        .filter((definition) => definition.preorder_key === preorderKey)
        .map(({ preorder_key: preorderDefinitionKey, ...definition }) => {
          void preorderDefinitionKey;
          return definition;
        });
    },
  };
}
