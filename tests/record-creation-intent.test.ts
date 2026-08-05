import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { aiBusinessModelContextV1Schema } from "../src/ai/context/schemas";
import {
  builderRecordCreationFieldValueSchema,
  builderRecordCreationIntentOutputSchema,
  builderRecordCreationIntentTaskInputSchema,
} from "../src/ai/record-creation-intent/schemas";
import { recordCreationUrlValueSchema } from "../src/core/graph/record-creation/schemas";
import { BUILDER_RECORD_CREATION_INTENT_INSTRUCTION } from "../src/ai/record-creation-intent/task";
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

const booleanContext = aiBusinessModelContextV1Schema.parse({
  ...context,
  objects: [
    {
      ...context.objects[0]!,
      fields: [
        ...context.objects[0]!.fields,
        {
          key: "available",
          label: "Available",
          field_type: "boolean" as const,
          required: false,
          position: 4,
          is_active: true,
          has_default: false,
          settings: {},
        },
        {
          key: "featured",
          label: "Featured",
          field_type: "boolean" as const,
          required: false,
          position: 5,
          is_active: true,
          has_default: false,
          settings: {},
        },
      ],
    },
  ],
});

function booleanInput(ownerRequest: string) {
  return builderRecordCreationIntentTaskInputSchema.parse({
    ...input,
    owner_request: ownerRequest,
    business_context: booleanContext,
  });
}

function booleanOutput(fieldKey: "available" | "featured", value: boolean) {
  return {
    schema_version: 1 as const,
    state: "ready" as const,
    summary: "Add Tea.",
    source_step_references: ["step_1"],
    object_key: "product",
    field_values: [
      {
        field_key: "name",
        field_type: "short_text" as const,
        string_value: "Tea",
      },
      {
        field_key: fieldKey,
        field_type: "boolean" as const,
        boolean_value: value,
      },
    ],
  };
}

describe("generic Record creation intent", () => {
  it("states the owner-supply, status and hidden-default rules", () => {
    expect(BUILDER_RECORD_CREATION_INTENT_INSTRUCTION).toContain(
      "Omit a Field with a configured default when the owner did not explicitly supply a value for it.",
    );
    expect(BUILDER_RECORD_CREATION_INTENT_INSTRUCTION).toContain(
      "If the owner explicitly supplied a value for that configured Field, return that exact value.",
    );
    expect(BUILDER_RECORD_CREATION_INTENT_INSTRUCTION).not.toContain(
      "Omit Fields that have configured defaults",
    );
    expect(BUILDER_RECORD_CREATION_INTENT_INSTRUCTION).toContain(
      "Do not output or choose the platform-owned Record lifecycle value record_status.",
    );
    expect(BUILDER_RECORD_CREATION_INTENT_INSTRUCTION).toContain(
      "A normal configured Field whose field_type is status may be returned only when the owner explicitly supplied one of its configured options.",
    );
    expect(BUILDER_RECORD_CREATION_INTENT_INSTRUCTION).toContain(
      "Do not request, expose or invent a hidden default value",
    );
  });

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

  it("keeps URL transport structural while enforcing the shared runtime contract", () => {
    const accepted = [
      "https://example.test",
      "http://example.test/path",
      "https://example.test/path?query=value",
    ];
    for (const value of accepted) {
      expect(recordCreationUrlValueSchema.parse(value)).toBe(value);
      expect(
        builderRecordCreationFieldValueSchema.parse({
          field_key: "website",
          field_type: "url",
          string_value: value,
        }),
      ).toMatchObject({ string_value: value });
    }

    const rejected = [
      "ftp://example.test",
      "javascript:alert(1)",
      "https://",
      "example.test",
      "arbitrary text",
      "https://[example.test",
      `https://example.test/${"a".repeat(2_040)}`,
    ];
    for (const value of rejected) {
      expect(recordCreationUrlValueSchema.safeParse(value).success).toBe(false);
    }

    const urlContext = aiBusinessModelContextV1Schema.parse({
      ...context,
      objects: [
        {
          ...context.objects[0]!,
          fields: [
            ...context.objects[0]!.fields,
            {
              key: "website",
              label: "Website",
              field_type: "url" as const,
              required: false,
              position: 4,
              is_active: true,
              has_default: false,
              settings: {},
            },
          ],
        },
      ],
    });
    const ownerUrl = "https://example.test/path?query=value";
    const urlInput = builderRecordCreationIntentTaskInputSchema.parse({
      ...input,
      owner_request: `Add a Product named Tea with website ${ownerUrl}.`,
      business_context: urlContext,
    });
    const output = {
      schema_version: 1 as const,
      state: "ready" as const,
      summary: "Add Tea.",
      source_step_references: ["step_1"],
      object_key: "product",
      field_values: [
        {
          field_key: "name",
          field_type: "short_text" as const,
          string_value: "Tea",
        },
        {
          field_key: "website",
          field_type: "url" as const,
          string_value: ownerUrl,
        },
      ],
    };
    expect(validateBuilderRecordCreationIntentOutput(urlInput, output)).toEqual(
      output,
    );
    expect(
      (output.field_values[1] as { string_value: string }).string_value,
    ).toBe(ownerUrl);
    expect(() =>
      validateBuilderRecordCreationIntentOutput(urlInput, {
        ...output,
        field_values: [
          output.field_values[0],
          { ...output.field_values[1], string_value: "https://other.test" },
        ],
      }),
    ).toThrow(/owner|supplied/i);
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
    if (output.state !== "ready") {
      throw new Error("Expected a ready Record intent.");
    }
    expect(output.field_values).not.toContainEqual(
      expect.objectContaining({ field_key: "status" }),
    );
  });

  it("returns an explicitly supplied configured status and never the platform lifecycle value", () => {
    const statusInput = builderRecordCreationIntentTaskInputSchema.parse({
      ...input,
      owner_request:
        "Add a Product named Afternoon Tea Box with a price of 30. Its status is Active.",
    });
    const output = {
      schema_version: 1 as const,
      state: "ready" as const,
      summary: "Add Afternoon Tea Box at £30 and set it Active.",
      source_step_references: ["step_1"],
      object_key: "product",
      field_values: [
        {
          field_key: "name",
          field_type: "short_text" as const,
          string_value: "Afternoon Tea Box",
        },
        {
          field_key: "price",
          field_type: "currency" as const,
          number_value: 30,
        },
        {
          field_key: "status",
          field_type: "status" as const,
          option_value: "Active",
        },
      ],
    };
    expect(
      validateBuilderRecordCreationIntentOutput(statusInput, output),
    ).toEqual(output);

    expect(() =>
      validateBuilderRecordCreationIntentOutput(statusInput, {
        ...output,
        field_values: [
          ...output.field_values,
          {
            field_key: "record_status",
            field_type: "status",
            option_value: "Active",
          },
        ],
      }),
    ).toThrow(/unknown|unavailable|Field/i);
  });

  it("requires Boolean evidence to name the target Field", () => {
    const availableTrueInput = booleanInput(
      "Add a Product named Tea; it is available.",
    );
    const availableFalseInput = booleanInput(
      "Add a Product named Tea; it is not available.",
    );
    const activeStatusInput = booleanInput(
      "Add a Product named Tea; its status is Active.",
    );
    const featuredInput = booleanInput(
      "Add a Product named Tea; it is featured.",
    );

    expect(
      validateBuilderRecordCreationIntentOutput(
        availableTrueInput,
        booleanOutput("available", true),
      ),
    ).toEqual(booleanOutput("available", true));
    expect(
      validateBuilderRecordCreationIntentOutput(
        availableFalseInput,
        booleanOutput("available", false),
      ),
    ).toEqual(booleanOutput("available", false));
    expect(
      validateBuilderRecordCreationIntentOutput(
        featuredInput,
        booleanOutput("featured", true),
      ),
    ).toEqual(booleanOutput("featured", true));
    expect(() =>
      validateBuilderRecordCreationIntentOutput(
        activeStatusInput,
        booleanOutput("available", true),
      ),
    ).toThrow(/owner|supplied/i);
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
