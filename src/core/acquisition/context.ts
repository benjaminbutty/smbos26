import type { AiBusinessModelContextV1 } from "../../ai/context/schemas";
import type { AcquisitionCategory } from "./schemas";
import type { ConfigurationSnapshotV1 } from "../configuration/definition-source";

export function acquisitionBusinessContext(
  category: AcquisitionCategory,
): AiBusinessModelContextV1 {
  return {
    schema_version: 1,
    business: {
      name: "New business",
      business_type: category,
      timezone: "UTC",
    },
    access: { role: "owner", capabilities: ["manage_configuration"] },
    active_configuration: { version_number: 1, revision: 1 },
    locations: [],
    objects: [],
    relationships: [],
    views: [],
    forms: [],
    pages: [],
    preorder_experiences: [],
    platform_capabilities: {
      registry_version: 1,
      field_types: [
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
        "status",
      ],
      relationship_cardinalities: ["one_to_one", "one_to_many", "many_to_many"],
      view_types: ["table", "list", "cards", "detail"],
      form_modes: ["create", "edit"],
      page_block_types: ["heading", "text", "view", "form", "divider"],
      configuration_operation_names: [
        "set_object",
        "set_field",
        "set_relationship",
        "set_view",
        "set_form",
        "set_page",
      ],
      reusable_capabilities: [
        "generic_graph",
        "generic_records",
        "generic_record_connections",
        "configured_views_forms_pages",
        "immutable_configuration_versions",
        "configuration_candidate_preview",
      ],
      unavailable: { workflows: true, rules: true, arbitrary_code: true },
      change_lanes: [
        {
          name: "configuration",
          supports: [
            "objects",
            "fields",
            "relationships",
            "views",
            "forms",
            "pages",
          ],
          mechanism: "proposal_preview_validation_deliberate_application",
        },
        {
          name: "operational",
          supports: ["records"],
          mechanism: "narrow_deterministic_services",
        },
      ],
    },
  };
}

export const emptyAcquisitionSnapshot: ConfigurationSnapshotV1 = {
  schema_version: 1,
  object_definitions: [],
  field_definitions: [],
  relationship_definitions: [],
  views: [],
  forms: [],
  pages: [],
  preorder_experiences: [],
  preorder_experience_locations: [],
};
