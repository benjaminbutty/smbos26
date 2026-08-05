import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { aiBusinessModelContextV1Schema } from "../src/ai/context/schemas";
import {
  builderRecordCreationFieldValueSchema,
  builderRecordCreationIntentOutputSchema,
  builderRecordCreationIntentTaskInputSchema,
} from "../src/ai/record-creation-intent/schemas";
import {
  validateBuilderRecordCreationIntentInput,
  validateBuilderRecordCreationIntentOutput,
} from "../src/ai/record-creation-intent/validation";

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
          key: "status",
          label: "Status",
          field_type: "status",
          required: true,
          position: 3,
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
  understanding: "Add one Product.",
  assumptions: [],
  unsupported_requirements: [],
  plan: {
    outcome: "One Product is added.",
    concepts: [
      {
        reference: "concept_1",
        label: "Product",
        disposition: "existing" as const,
        existing_object_key: "product",
        purpose: "The Product to add.",
      },
    ],
    user_journeys: [],
    steps: [
      {
        reference: "step_1",
        sequence: 1,
        summary: "Add one Product.",
        dependencies: [],
        affected_concepts: ["concept_1"],
        existing_object_keys: ["product"],
        location_references: [],
        materiality: "medium" as const,
        requires_owner_confirmation: true as const,
        lane: "operational" as const,
        category: "create_initial_record" as const,
      },
    ],
  },
};

const input = builderRecordCreationIntentTaskInputSchema.parse({
  schema_version: 1,
  owner_request: "Add a Product named Afternoon Tea Box with a price of 30.",
  business_context: context,
  ready_plan: readyPlan,
});

describe("generic Record creation intent", () => {
  it("supports every typed Field variant and rejects invalid temporal or URL values", () => {
    const validValues = [
      { field_key: "name", field_type: "short_text", string_value: "Tea" },
      { field_key: "name", field_type: "long_text", string_value: "Tea" },
      {
        field_key: "email",
        field_type: "email",
        string_value: "owner@example.test",
      },
      {
        field_key: "phone",
        field_type: "phone",
        string_value: "+441234567890",
      },
      {
        field_key: "website",
        field_type: "url",
        string_value: "https://example.test/menu",
      },
      { field_key: "amount", field_type: "number", number_value: 12.5 },
      { field_key: "price", field_type: "currency", number_value: 30 },
      { field_key: "available", field_type: "boolean", boolean_value: true },
      { field_key: "date", field_type: "date", date_value: "2026-08-20" },
      {
        field_key: "starts_at",
        field_type: "datetime",
        datetime_value: "2026-08-20T10:30:00+01:00",
      },
      { field_key: "status", field_type: "status", option_value: "Active" },
      { field_key: "size", field_type: "select", option_value: "Large" },
      {
        field_key: "tags",
        field_type: "multi_select",
        option_values: ["Tea", "Cake"],
      },
    ] as const;

    for (const value of validValues) {
      expect(
        builderRecordCreationFieldValueSchema.safeParse(value).success,
      ).toBe(true);
    }

    expect(
      builderRecordCreationFieldValueSchema.safeParse({
        field_key: "website",
        field_type: "url",
        string_value: "ftp://example.test/menu",
      }).success,
    ).toBe(false);
    expect(
      builderRecordCreationFieldValueSchema.safeParse({
        field_key: "date",
        field_type: "date",
        date_value: "2026-02-30",
      }).success,
    ).toBe(false);
    expect(
      builderRecordCreationFieldValueSchema.safeParse({
        field_key: "starts_at",
        field_type: "datetime",
        datetime_value: "2026-08-20T10:30:00",
      }).success,
    ).toBe(false);
    expect(
      builderRecordCreationFieldValueSchema.safeParse({
        field_key: "name",
        field_type: "short_text",
        string_value: "Tea",
        extra: "rejected",
      }).success,
    ).toBe(false);
  });

  it("accepts one typed owner-supplied Record and omits configured defaults", () => {
    const output = builderRecordCreationIntentOutputSchema.parse({
      schema_version: 1,
      state: "ready",
      summary: "Add Afternoon Tea Box at £30.",
      source_step_references: ["step_1"],
      object_key: "product",
      field_values: [
        {
          field_key: "name",
          field_type: "short_text",
          string_value: "Afternoon Tea Box",
        },
        { field_key: "price", field_type: "currency", number_value: 30 },
      ],
    });

    expect(validateBuilderRecordCreationIntentOutput(input, output)).toEqual(
      output,
    );
  });

  it("rejects guessed values, configuration scope and duplicate Field values", () => {
    expect(() =>
      validateBuilderRecordCreationIntentOutput(input, {
        schema_version: 1,
        state: "ready",
        summary: "Add a Product.",
        source_step_references: ["step_1"],
        object_key: "product",
        field_values: [
          {
            field_key: "name",
            field_type: "short_text",
            string_value: "Guessed Product",
          },
          {
            field_key: "name",
            field_type: "short_text",
            string_value: "Afternoon Tea Box",
          },
        ],
      }),
    ).toThrow(/contract|owner|duplicate|Field/i);

    expect(() =>
      validateBuilderRecordCreationIntentInput({
        ...input,
        ready_plan: {
          ...readyPlan,
          plan: {
            ...readyPlan.plan,
            steps: [
              readyPlan.plan.steps[0],
              {
                ...readyPlan.plan.steps[0],
                reference: "step_2",
                category: "define_field",
                lane: "configuration",
              },
            ],
          },
        },
      }),
    ).toThrow();
  });

  it("rejects a file variant and a required value omitted without a default", () => {
    expect(() =>
      validateBuilderRecordCreationIntentOutput(input, {
        schema_version: 1,
        state: "ready",
        summary: "Add a Product.",
        source_step_references: ["step_1"],
        object_key: "product",
        field_values: [
          {
            field_key: "price",
            field_type: "currency",
            number_value: 30,
          },
        ],
      }),
    ).toThrow(/required/i);

    expect(
      builderRecordCreationIntentOutputSchema.safeParse({
        schema_version: 1,
        state: "ready",
        summary: "Add a Product.",
        source_step_references: ["step_1"],
        object_key: "product",
        field_values: [
          {
            field_key: "attachment",
            field_type: "file",
            string_value: "https://example.test/file.pdf",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects inactive, unknown, mismatched, unmentioned and invalid-option Fields", () => {
    const inactiveInput = builderRecordCreationIntentTaskInputSchema.parse({
      ...input,
      business_context: {
        ...context,
        objects: [
          {
            ...context.objects[0]!,
            fields: [
              ...context.objects[0]!.fields,
              {
                key: "archived",
                label: "Archived",
                field_type: "short_text",
                required: false,
                position: 4,
                is_active: false,
                has_default: false,
                settings: {},
              },
            ],
          },
        ],
      },
    });
    const baseOutput = {
      schema_version: 1 as const,
      state: "ready" as const,
      summary: "Add a Product.",
      source_step_references: ["step_1"],
      object_key: "product",
      field_values: [
        {
          field_key: "name",
          field_type: "short_text" as const,
          string_value: "Afternoon Tea Box",
        },
      ],
    };

    expect(() =>
      validateBuilderRecordCreationIntentOutput(input, {
        ...baseOutput,
        field_values: [
          ...baseOutput.field_values,
          {
            field_key: "unknown",
            field_type: "short_text",
            string_value: "Unknown",
          },
        ],
      }),
    ).toThrow(/unknown|inactive|Field/i);
    expect(() =>
      validateBuilderRecordCreationIntentOutput(inactiveInput, {
        ...baseOutput,
        field_values: [
          ...baseOutput.field_values,
          {
            field_key: "archived",
            field_type: "short_text",
            string_value: "Archived",
          },
        ],
      }),
    ).toThrow(/unknown|inactive|Field/i);
    expect(() =>
      validateBuilderRecordCreationIntentOutput(input, {
        ...baseOutput,
        field_values: [
          {
            field_key: "name",
            field_type: "currency",
            number_value: 30,
          },
        ],
      }),
    ).toThrow(/type|Field/i);
    expect(() =>
      validateBuilderRecordCreationIntentOutput(input, {
        ...baseOutput,
        field_values: [
          ...baseOutput.field_values,
          {
            field_key: "status",
            field_type: "status",
            option_value: "Draft",
          },
        ],
      }),
    ).toThrow(/option/i);
    expect(() =>
      validateBuilderRecordCreationIntentOutput(input, {
        ...baseOutput,
        field_values: [
          {
            field_key: "name",
            field_type: "short_text",
            string_value: "Not in the request",
          },
          {
            field_key: "price",
            field_type: "currency",
            number_value: 31,
          },
        ],
      }),
    ).toThrow(/owner|supplied/i);
  });
});
