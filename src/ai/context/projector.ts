import {
  configurationSnapshotV1Schema,
  type ConfigurationSnapshotV1,
} from "../../core/configuration/definition-source";
import {
  parseViewConfig,
  type TableViewConfig,
} from "../../core/experience/schemas";
import { AiBusinessContextError } from "./errors";
import {
  AI_BUSINESS_CONTEXT_MAX_BYTES,
  aiBusinessModelContextV1Schema,
  aiContextFieldSettingsSchema,
  authoritativeConfigurationOperationNames,
  authoritativeFieldTypes,
  authoritativeFormModes,
  authoritativePageBlockTypes,
  authoritativeRelationshipCardinalities,
  authoritativeViewTypes,
  type AiBusinessModelContextV1,
} from "./schemas";

export interface AiBusinessContextSource {
  business: {
    name: string;
    businessType: string;
    timezone: string;
  };
  access: {
    role: "owner" | "admin";
    capabilities: readonly ["manage_configuration"];
  };
  activeConfiguration: {
    versionNumber: number;
    revision: number;
    snapshot: ConfigurationSnapshotV1;
  };
  locations: ReadonlyArray<{
    reference: string;
    name: string;
    timezone: string;
    isActive: boolean;
  }>;
}

export interface AiBusinessContextCurrentness {
  baseVersionId: string;
  headRevision: number;
}

export interface AiBusinessContextBundle {
  currentness: AiBusinessContextCurrentness;
  modelContext: AiBusinessModelContextV1;
  serializedBytes: number;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" });
}

function compareKey(left: { key: string }, right: { key: string }): number {
  return left.key.localeCompare(right.key);
}

function requireUnique(values: string[]): void {
  if (new Set(values).size !== values.length) {
    throw new AiBusinessContextError("ai_context_inconsistent");
  }
}

function stableJsonValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }
  if (
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableJsonValue(item)]),
    );
  }
  throw new TypeError("AI Business context must be JSON serialisable.");
}

export function serializeAiBusinessModelContext(
  context: AiBusinessModelContextV1,
): string {
  return JSON.stringify(
    stableJsonValue(aiBusinessModelContextV1Schema.parse(context)),
  );
}

function projectFieldSettings(
  field: ConfigurationSnapshotV1["field_definitions"][number],
) {
  const settings = field.settings_json as Record<string, unknown>;
  const projected: { options?: string[]; currency?: string } = {};
  if (["select", "multi_select", "status"].includes(field.field_type)) {
    if (
      !Array.isArray(settings.options) ||
      !settings.options.every((option) => typeof option === "string")
    ) {
      throw new AiBusinessContextError("ai_context_inconsistent");
    }
    projected.options = [...settings.options];
  }
  if (
    field.field_type === "currency" &&
    typeof settings.currency === "string"
  ) {
    projected.currency = settings.currency;
  }
  return aiContextFieldSettingsSchema.parse(projected);
}

export type AiPageDestinationKind =
  "internal_path" | "external_web" | "email" | "telephone";

export function classifyAiPageDestination(
  value: string,
): AiPageDestinationKind {
  if (value.startsWith("/")) {
    return "internal_path";
  }
  if (/^https?:\/\//i.test(value)) {
    return "external_web";
  }
  if (/^mailto:/i.test(value)) {
    return "email";
  }
  if (/^tel:/i.test(value)) {
    return "telephone";
  }
  throw new AiBusinessContextError("ai_context_inconsistent");
}

function projectPageBlock(
  block: ConfigurationSnapshotV1["pages"][number]["layout_json"]["blocks"][number],
) {
  switch (block.type) {
    case "heading":
      return { type: block.type, text: block.text, level: block.level };
    case "text":
      return { type: block.type, text: block.text };
    case "image": {
      if (classifyAiPageDestination(block.src) !== "external_web") {
        throw new AiBusinessContextError("ai_context_inconsistent");
      }
      return {
        type: block.type,
        alt: block.alt,
        ...(block.caption ? { caption: block.caption } : {}),
        source_kind: "external_web" as const,
      };
    }
    case "button":
      return {
        type: block.type,
        label: block.label,
        style: block.style,
        destination_kind: classifyAiPageDestination(block.href),
      };
    case "view":
      return { type: block.type, view_key: block.view_key };
    case "form":
      return { type: block.type, form_key: block.form_key };
    case "public_form":
      return { type: block.type, form_key: block.form_key };
    case "booking":
      return {
        type: block.type,
        booking_key: block.booking_key,
        config: block.config,
      };
    case "preorder":
      return { type: block.type, preorder_key: block.preorder_key };
    case "divider":
      return { type: block.type };
    case "callout":
      return { type: block.type, text: block.text, tone: block.tone };
  }
}

function projectViewConfiguration(
  view: ConfigurationSnapshotV1["views"][number],
) {
  const configuration = parseViewConfig(view.view_type, view.config_json);
  if (view.view_type !== "table") {
    return configuration;
  }

  const table = configuration as TableViewConfig;
  return {
    fields: table.fields,
    ...(table.title_field ? { title_field: table.title_field } : {}),
    ...(table.create_form_key
      ? { create_form_key: table.create_form_key }
      : {}),
    ...(table.edit_form_key ? { edit_form_key: table.edit_form_key } : {}),
    include_archived: table.include_archived,
  };
}

function platformCapabilities() {
  return {
    registry_version: 1 as const,
    field_types: [...authoritativeFieldTypes].sort(),
    relationship_cardinalities: [
      ...authoritativeRelationshipCardinalities,
    ].sort(),
    view_types: [...authoritativeViewTypes].sort(),
    form_modes: [...authoritativeFormModes].sort(),
    page_block_types: [...authoritativePageBlockTypes].sort(),
    configuration_operation_names: [
      ...authoritativeConfigurationOperationNames,
    ].sort(),
    reusable_capabilities: [
      "configuration_candidate_preview",
      "configured_views_forms_pages",
      "generic_graph",
      "generic_record_connections",
      "generic_records",
      "immutable_configuration_versions",
      "manual_preorder_question_amendments",
      "manual_preorder_schedule_amendments",
      "public_create_forms",
      "published_public_pages",
      "record_to_location_connections",
      "scheduling_booking",
      "sites_public_pages",
      "trusted_public_preorder",
    ] as const,
    unavailable: {
      workflows: true as const,
      rules: true as const,
      arbitrary_code: true as const,
    },
    change_lanes: [
      {
        name: "configuration" as const,
        supports: [
          "objects",
          "fields",
          "relationships",
          "views",
          "forms",
          "pages",
          "preorder_experiences",
        ],
        mechanism:
          "proposal_preview_validation_deliberate_application" as const,
      },
      {
        name: "operational" as const,
        supports: ["records", "locations", "record_to_location_connections"],
        mechanism: "narrow_deterministic_services" as const,
      },
    ],
  };
}

export function projectAiBusinessModelContext(
  sourceInput: AiBusinessContextSource,
  options: { maxBytes?: number } = {},
): { modelContext: AiBusinessModelContextV1; serializedBytes: number } {
  try {
    const snapshot = configurationSnapshotV1Schema.parse(
      sourceInput.activeConfiguration.snapshot,
    );
    requireUnique(sourceInput.locations.map(({ reference }) => reference));
    requireUnique(snapshot.object_definitions.map(({ key }) => key));
    requireUnique(
      snapshot.field_definitions.map(
        ({ object_key, key }) => `${object_key}:${key}`,
      ),
    );
    requireUnique(snapshot.relationship_definitions.map(({ key }) => key));
    requireUnique(snapshot.views.map(({ key }) => key));
    requireUnique(snapshot.forms.map(({ key }) => key));
    requireUnique(snapshot.pages.map(({ key }) => key));
    requireUnique(snapshot.preorder_experiences.map(({ key }) => key));
    const locations = sourceInput.locations
      .map((location) => ({
        reference: location.reference,
        name: location.name,
        timezone: location.timezone,
        is_active: location.isActive,
      }))
      .toSorted(
        (left, right) =>
          compareText(left.name, right.name) ||
          left.reference.localeCompare(right.reference),
      );
    const locationsByReference = new Map(
      locations.map((location) => [location.reference, location]),
    );

    const fieldsByObject = new Map<
      string,
      ConfigurationSnapshotV1["field_definitions"]
    >();
    for (const field of snapshot.field_definitions) {
      const fields = fieldsByObject.get(field.object_key) ?? [];
      fields.push(field);
      fieldsByObject.set(field.object_key, fields);
    }

    const objects = snapshot.object_definitions
      .map((object) => ({
        key: object.key,
        singular_label: object.singular_label,
        plural_label: object.plural_label,
        description: object.description,
        kind: object.kind,
        semantic_type: object.semantic_type,
        icon: object.icon,
        is_active: object.is_active,
        fields: (fieldsByObject.get(object.key) ?? [])
          .map((field) => {
            if (field.object_definition_id !== object.id) {
              throw new AiBusinessContextError("ai_context_inconsistent");
            }
            return {
              key: field.key,
              label: field.label,
              field_type: field.field_type,
              required: field.required,
              position: field.position,
              is_active: field.is_active,
              has_default: field.default_value !== null,
              settings: projectFieldSettings(field),
            };
          })
          .toSorted(
            (left, right) =>
              left.position - right.position || compareKey(left, right),
          ),
      }))
      .toSorted(compareKey);
    if (
      objects.reduce((total, object) => total + object.fields.length, 0) !==
      snapshot.field_definitions.length
    ) {
      throw new AiBusinessContextError("ai_context_inconsistent");
    }

    const relationships = snapshot.relationship_definitions
      .map((relationship) => ({
        key: relationship.key,
        source_object_key: relationship.source_object_key,
        target_object_key: relationship.target_object_key,
        source_label: relationship.source_label,
        target_label: relationship.target_label,
        cardinality: relationship.cardinality,
        is_required: relationship.is_required,
        is_active: relationship.is_active,
      }))
      .toSorted(compareKey);

    const views = snapshot.views
      .map((view) => ({
        key: view.key,
        name: view.name,
        view_type: view.view_type,
        object_key: view.object_key,
        audience: view.audience,
        is_active: view.is_active,
        configuration: projectViewConfiguration(view),
      }))
      .toSorted(compareKey);

    const forms = snapshot.forms
      .map((form) => ({
        key: form.key,
        name: form.name,
        object_key: form.object_key,
        mode: form.mode,
        audience: form.audience,
        is_active: form.is_active,
        fields: form.config_json.fields.map((field) => ({
          field: field.field,
          ...(field.label ? { label: field.label } : {}),
          ...(field.help_text ? { help_text: field.help_text } : {}),
          hidden: field.hidden,
          has_default: field.default_value !== undefined,
        })),
        ...(form.config_json.submit_label
          ? { submit_label: form.config_json.submit_label }
          : {}),
      }))
      .toSorted(compareKey);

    const pages = snapshot.pages
      .map((page) => ({
        key: page.key,
        title: page.title,
        slug: page.slug,
        audience: page.audience,
        status: page.status,
        is_active: page.is_active,
        blocks: page.layout_json.blocks.map(projectPageBlock),
      }))
      .toSorted(compareKey);

    const associationsByPreorder = new Map<
      string,
      ConfigurationSnapshotV1["preorder_experience_locations"]
    >();
    for (const association of snapshot.preorder_experience_locations) {
      const associations =
        associationsByPreorder.get(association.preorder_key) ?? [];
      associations.push(association);
      associationsByPreorder.set(association.preorder_key, associations);
    }

    const preorderExperiences = snapshot.preorder_experiences
      .map((preorder) => ({
        key: preorder.key,
        product_object_key: preorder.product_object_key,
        customer_object_key: preorder.customer_object_key,
        order_object_key: preorder.order_object_key,
        order_item_object_key: preorder.order_item_object_key,
        customer_places_order_relationship_key:
          preorder.customer_places_order_relationship_key,
        order_contains_item_relationship_key:
          preorder.order_contains_item_relationship_key,
        product_appears_in_item_relationship_key:
          preorder.product_appears_in_item_relationship_key,
        schedule: preorder.config_json.schedule,
        field_mappings: preorder.config_json.field_mappings,
        public_fields: preorder.config_json.public_fields,
        is_active: preorder.is_active,
        allowed_locations: (associationsByPreorder.get(preorder.key) ?? [])
          .map((association) => {
            if (association.preorder_experience_id !== preorder.id) {
              throw new AiBusinessContextError("ai_context_inconsistent");
            }
            const location = locationsByReference.get(association.location_id);
            if (!location) {
              throw new AiBusinessContextError("ai_context_inconsistent");
            }
            return {
              reference: location.reference,
              name: location.name,
              timezone: location.timezone,
              association_is_active: association.is_active,
              location_is_active: location.is_active,
            };
          })
          .toSorted(
            (left, right) =>
              compareText(left.name, right.name) ||
              left.reference.localeCompare(right.reference),
          ),
      }))
      .toSorted(compareKey);
    if (
      preorderExperiences.reduce(
        (total, preorder) => total + preorder.allowed_locations.length,
        0,
      ) !== snapshot.preorder_experience_locations.length
    ) {
      throw new AiBusinessContextError("ai_context_inconsistent");
    }

    const modelContext = aiBusinessModelContextV1Schema.parse({
      schema_version: 1,
      business: {
        name: sourceInput.business.name,
        business_type: sourceInput.business.businessType,
        timezone: sourceInput.business.timezone,
      },
      access: {
        role: sourceInput.access.role,
        capabilities: [...sourceInput.access.capabilities],
      },
      active_configuration: {
        version_number: sourceInput.activeConfiguration.versionNumber,
        revision: sourceInput.activeConfiguration.revision,
      },
      locations,
      objects,
      relationships,
      views,
      forms,
      pages,
      preorder_experiences: preorderExperiences,
      platform_capabilities: platformCapabilities(),
    });
    const serializedBytes = new TextEncoder().encode(
      serializeAiBusinessModelContext(modelContext),
    ).byteLength;
    if (serializedBytes > (options.maxBytes ?? AI_BUSINESS_CONTEXT_MAX_BYTES)) {
      throw new AiBusinessContextError("ai_context_too_large");
    }
    return Object.freeze({ modelContext, serializedBytes });
  } catch (cause) {
    if (cause instanceof AiBusinessContextError) {
      throw cause;
    }
    throw new AiBusinessContextError("ai_context_inconsistent", { cause });
  }
}
