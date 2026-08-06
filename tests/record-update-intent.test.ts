import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { aiBusinessModelContextV1Schema } from "../src/ai/context/schemas";
import {
  builderRecordUpdateIntentOutputSchema,
  builderRecordUpdateIntentTaskInputSchema,
} from "../src/ai/record-update-intent/schemas";
import { BUILDER_RECORD_UPDATE_INTENT_INSTRUCTION } from "../src/ai/record-update-intent/task";
import { validateBuilderRecordUpdateIntentOutput } from "../src/ai/record-update-intent/validation";

const context = aiBusinessModelContextV1Schema.parse({
  schema_version: 1,
  business: {
    name: "Tea Business",
    business_type: "cafe",
    timezone: "Europe/London",
  },
  access: { role: "owner", capabilities: ["manage_configuration"] },
  active_configuration: { version_number: 1, revision: 1 },
  locations: [],
  objects: [
    {
      key: "product",
      singular_label: "Product",
      plural_label: "Products",
      description: "Products",
      kind: "template",
      semantic_type: "product",
      icon: null,
      is_active: true,
      fields: [
        {
          key: "name",
          label: "Name",
          field_type: "short_text",
          required: true,
          position: 1,
          is_active: true,
          has_default: false,
          settings: {},
        },
        {
          key: "price",
          label: "Price",
          field_type: "currency",
          required: false,
          position: 2,
          is_active: true,
          has_default: false,
          settings: { currency: "GBP" },
        },
        {
          key: "available",
          label: "Available",
          field_type: "boolean",
          required: false,
          position: 3,
          is_active: true,
          has_default: false,
          settings: {},
        },
        {
          key: "status",
          label: "Status",
          field_type: "status",
          required: false,
          position: 4,
          is_active: true,
          has_default: true,
          settings: { options: ["Active", "Paused"] },
        },
      ],
    },
  ],
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
      "file",
      "status",
    ],
    relationship_cardinalities: ["one_to_one", "one_to_many", "many_to_many"],
    view_types: ["table", "list", "cards", "detail"],
    form_modes: ["create", "edit"],
    page_block_types: [
      "heading",
      "text",
      "image",
      "button",
      "view",
      "form",
      "preorder",
      "divider",
    ],
    configuration_operation_names: [
      "set_object",
      "set_field",
      "set_relationship",
      "set_view",
      "set_form",
      "set_page",
      "set_preorder_experience",
    ],
    reusable_capabilities: [
      "generic_graph",
      "generic_records",
      "generic_record_connections",
      "record_to_location_connections",
      "configured_views_forms_pages",
      "published_public_pages",
      "trusted_public_preorder",
      "immutable_configuration_versions",
      "configuration_candidate_preview",
      "manual_preorder_schedule_amendments",
      "manual_preorder_question_amendments",
    ],
    unavailable: { workflows: true, rules: true, arbitrary_code: true },
    change_lanes: [
      {
        name: "configuration",
        supports: ["objects"],
        mechanism: "proposal_preview_validation_deliberate_application",
      },
      {
        name: "operational",
        supports: ["records"],
        mechanism: "narrow_deterministic_services",
      },
    ],
  },
});

const readyPlan = {
  schema_version: 1 as const,
  state: "ready" as const,
  understanding: "Update one Product.",
  assumptions: [],
  unsupported_requirements: [],
  plan: {
    outcome: "One Product is updated.",
    concepts: [
      {
        reference: "concept_1",
        label: "Product",
        disposition: "existing" as const,
        existing_object_key: "product",
        purpose: "The Product to update.",
      },
    ],
    user_journeys: [],
    steps: [
      {
        reference: "step_1",
        sequence: 1,
        summary: "Update one Product.",
        dependencies: [],
        affected_concepts: ["concept_1"],
        existing_object_keys: ["product"],
        location_references: [],
        materiality: "medium" as const,
        requires_owner_confirmation: true as const,
        lane: "operational" as const,
        category: "update_record" as const,
      },
    ],
  },
};

function input(ownerRequest: string) {
  return builderRecordUpdateIntentTaskInputSchema.parse({
    schema_version: 1,
    owner_request: ownerRequest,
    business_context: context,
    ready_plan: readyPlan,
  });
}

describe("generic Record update intent", () => {
  it("requires an exact selector and supports a selector Field update", () => {
    const taskInput = input(
      "Rename Celebration Box to Celebration Platter and set available to false.",
    );
    const output = {
      schema_version: 1 as const,
      state: "ready" as const,
      summary: "Rename one Product and make it unavailable.",
      source_step_reference: "step_1",
      object_key: "product",
      selector: {
        field_key: "name",
        field_type: "short_text" as const,
        string_value: "Celebration Box",
      },
      field_updates: [
        {
          field_key: "name",
          field_type: "short_text" as const,
          string_value: "Celebration Platter",
        },
        {
          field_key: "available",
          field_type: "boolean" as const,
          boolean_value: false,
        },
      ],
    };

    expect(validateBuilderRecordUpdateIntentOutput(taskInput, output)).toEqual(
      output,
    );
  });

  it("leaves actual-value no-op detection to the server-owned composer", () => {
    const taskInput = input("Rename Celebration Box to Celebration Box.");
    expect(
      validateBuilderRecordUpdateIntentOutput(taskInput, {
        schema_version: 1,
        state: "ready",
        summary: "No-op rename.",
        source_step_reference: "step_1",
        object_key: "product",
        selector: {
          field_key: "name",
          field_type: "short_text",
          string_value: "Celebration Box",
        },
        field_updates: [
          {
            field_key: "name",
            field_type: "short_text",
            string_value: "Celebration Box",
          },
        ],
      }),
    ).toMatchObject({ state: "ready" });
  });

  it("rejects relative arithmetic even when the model invents a numeric result", () => {
    const taskInput = input("Increase the Celebration Box price by 10% to 33.");
    expect(() =>
      validateBuilderRecordUpdateIntentOutput(taskInput, {
        schema_version: 1,
        state: "ready",
        summary: "Increase a price.",
        source_step_reference: "step_1",
        object_key: "product",
        selector: {
          field_key: "name",
          field_type: "short_text",
          string_value: "Celebration Box",
        },
        field_updates: [
          {
            field_key: "price",
            field_type: "currency",
            number_value: 33,
          },
        ],
      }),
    ).toThrow("absolute");
  });

  it("does not use broad language-grounding heuristics", () => {
    const taskInput = input("Change Celebration Box to a new name.");
    expect(
      validateBuilderRecordUpdateIntentOutput(taskInput, {
        schema_version: 1,
        state: "ready",
        summary: "Rename a Product.",
        source_step_reference: "step_1",
        object_key: "product",
        selector: {
          field_key: "name",
          field_type: "short_text",
          string_value: "Celebration Box",
        },
        field_updates: [
          {
            field_key: "available",
            field_type: "boolean",
            boolean_value: false,
          },
        ],
      }),
    ).toMatchObject({ state: "ready" });

    const grounded = input(
      "Rename Celebration Box to Celebration Platter and mark it unavailable.",
    );
    expect(
      validateBuilderRecordUpdateIntentOutput(grounded, {
        schema_version: 1,
        state: "ready",
        summary: "Rename a Product and make it unavailable.",
        source_step_reference: "step_1",
        object_key: "product",
        selector: {
          field_key: "name",
          field_type: "short_text",
          string_value: "Celebration Box",
        },
        field_updates: [
          {
            field_key: "available",
            field_type: "boolean",
            boolean_value: false,
          },
          {
            field_key: "name",
            field_type: "short_text",
            string_value: "Celebration Platter",
          },
        ],
      }),
    ).toMatchObject({ state: "ready" });
  });

  it("returns a bounded clarification without querying operational data", () => {
    const taskInput = input("Change the Product price to £30.");
    const clarification = {
      schema_version: 1,
      state: "needs_clarification" as const,
      understanding: "The new price is clear, but the exact Product is not.",
      question: "Which Product currently needs its price changed?",
      reason:
        "Builder needs one exact current detail before it can target a Record.",
      source_step_reference: "step_1",
    };
    expect(
      validateBuilderRecordUpdateIntentOutput(taskInput, clarification),
    ).toEqual(clarification);
  });

  it("keeps the task instruction explicit about the no-Record model boundary", () => {
    expect(BUILDER_RECORD_UPDATE_INTENT_INSTRUCTION).toContain(
      "Never invent IDs, UUIDs, Records, current values, defaults",
    );
    expect(builderRecordUpdateIntentOutputSchema.safeParse({}).success).toBe(
      false,
    );
  });
});
