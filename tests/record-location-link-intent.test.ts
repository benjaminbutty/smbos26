import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { aiBusinessModelContextV1Schema } from "../src/ai/context/schemas";
import {
  builderRecordLocationLinkIntentOutputSchema,
  builderRecordLocationLinkIntentTaskInputSchema,
} from "../src/ai/record-location-link-intent/schemas";
import { BUILDER_RECORD_LOCATION_LINK_INTENT_INSTRUCTION } from "../src/ai/record-location-link-intent/task";
import { validateBuilderRecordLocationLinkIntentOutput } from "../src/ai/record-location-link-intent/validation";

const locationIds = {
  bedford: "11111111-1111-4111-8111-111111111111",
  cambridge: "22222222-2222-4222-8222-222222222222",
} as const;

const context = aiBusinessModelContextV1Schema.parse({
  schema_version: 1,
  business: {
    name: "Tea Business",
    business_type: "cafe",
    timezone: "Europe/London",
  },
  access: { role: "owner", capabilities: ["manage_configuration"] },
  active_configuration: { version_number: 1, revision: 1 },
  locations: [
    {
      reference: locationIds.bedford,
      name: "Bedford",
      timezone: "Europe/London",
      is_active: true,
    },
    {
      reference: locationIds.cambridge,
      name: "Cambridge",
      timezone: "Europe/London",
      is_active: true,
    },
  ],
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
      ],
    },
    {
      key: "equipment",
      singular_label: "Equipment",
      plural_label: "Equipment",
      description: "Equipment available for hire",
      kind: "custom",
      semantic_type: null,
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
        supports: ["records", "record_to_location_connections"],
        mechanism: "narrow_deterministic_services",
      },
    ],
  },
});

function readyPlan(
  objectKey: "product" | "equipment" | "order",
  locationId: string,
) {
  return {
    schema_version: 1 as const,
    state: "ready" as const,
    understanding: "Change one Record's Location availability.",
    assumptions: [],
    unsupported_requirements: [],
    plan: {
      outcome: "One Record's Location availability changes.",
      concepts: [
        {
          reference: "concept_1",
          label: objectKey,
          disposition: "existing" as const,
          existing_object_key: objectKey,
          purpose: "The existing Record.",
        },
      ],
      user_journeys: [],
      steps: [
        {
          reference: "step_1",
          sequence: 1,
          summary: "Change one Record's Location availability.",
          dependencies: [],
          affected_concepts: ["concept_1"],
          existing_object_keys: [objectKey],
          location_references: [locationId],
          materiality: "medium" as const,
          requires_owner_confirmation: true as const,
          lane: "operational" as const,
          category: "link_record_to_location" as const,
        },
      ],
    },
  };
}

function input(
  ownerRequest: string,
  objectKey: "product" | "equipment" | "order",
  locationId: string,
) {
  return builderRecordLocationLinkIntentTaskInputSchema.parse({
    schema_version: 1,
    owner_request: ownerRequest,
    business_context: context,
    ready_plan: readyPlan(objectKey, locationId),
  });
}

describe("generic Record-to-Location availability intent", () => {
  it("instructs inactive Location clarification without substitution", () => {
    expect(BUILDER_RECORD_LOCATION_LINK_INTENT_INSTRUCTION).toContain(
      "A Location may be used in a ready intent only when it exists in the supplied Business context and is active.",
    );
    expect(BUILDER_RECORD_LOCATION_LINK_INTENT_INSTRUCTION).toContain(
      "If the exact Location referenced by the ready plan is inactive, return needs_clarification and ask the owner to choose an active Location.",
    );
    expect(BUILDER_RECORD_LOCATION_LINK_INTENT_INSTRUCTION).toContain(
      "Never substitute or invent another Location.",
    );
  });

  it("accepts the Product unlink request without Product-specific semantics", () => {
    expect(BUILDER_RECORD_LOCATION_LINK_INTENT_INSTRUCTION).not.toMatch(
      /Kids Afternoon Tea|Product|Equipment|Bedford|Cambridge/i,
    );
    const taskInput = input(
      "Change one existing product's availability at the selected site.",
      "product",
      locationIds.bedford,
    );
    const output = {
      schema_version: 1 as const,
      state: "ready" as const,
      summary: "Remove one Product from one Location.",
      source_step_reference: "step_1",
      action: "unlink" as const,
      object_key: "product",
      selector: {
        field_key: "name",
        field_type: "short_text" as const,
        string_value: "Kids Afternoon Tea",
      },
      location_reference: locationIds.bedford,
    };

    expect(
      validateBuilderRecordLocationLinkIntentOutput(taskInput, output),
    ).toEqual(output);
  });

  it("accepts the generic Equipment link request through the same contract", () => {
    const taskInput = input(
      "Update the selected equipment availability.",
      "equipment",
      locationIds.cambridge,
    );
    const output = {
      schema_version: 1 as const,
      state: "ready" as const,
      summary: "Make one Record available at one Location.",
      source_step_reference: "step_1",
      action: "link" as const,
      object_key: "equipment",
      selector: {
        field_key: "name",
        field_type: "short_text" as const,
        string_value: "Projector",
      },
      location_reference: locationIds.cambridge,
    };

    const validated = validateBuilderRecordLocationLinkIntentOutput(
      taskInput,
      output,
    );
    expect(validated).toMatchObject({
      state: "ready",
      action: "link",
      object_key: "equipment",
      location_reference: locationIds.cambridge,
    });
  });

  it("requires the exact Location reference from the one planning step", () => {
    const taskInput = input(
      "Update the selected equipment availability.",
      "equipment",
      locationIds.cambridge,
    );
    const output = {
      schema_version: 1 as const,
      state: "ready" as const,
      summary: "Make one Record available at one Location.",
      source_step_reference: "step_1",
      action: "link" as const,
      object_key: "equipment",
      selector: {
        field_key: "name",
        field_type: "short_text" as const,
        string_value: "Projector",
      },
      location_reference: locationIds.bedford,
    };

    expect(() =>
      validateBuilderRecordLocationLinkIntentOutput(taskInput, output),
    ).toThrowError(
      expect.objectContaining({
        code: "location_reference_invalid",
      }),
    );
  });

  it("rejects inactive Locations but does not parse owner prose for selection", () => {
    const inactiveContext = aiBusinessModelContextV1Schema.parse({
      ...context,
      locations: context.locations.map((location) =>
        location.reference === locationIds.cambridge
          ? { ...location, is_active: false }
          : location,
      ),
    });
    const inactiveInput = builderRecordLocationLinkIntentTaskInputSchema.parse({
      schema_version: 1,
      owner_request: "Update the selected equipment availability.",
      business_context: inactiveContext,
      ready_plan: readyPlan("equipment", locationIds.cambridge),
    });
    const ready = {
      schema_version: 1 as const,
      state: "ready" as const,
      summary: "Make one Record available at one Location.",
      source_step_reference: "step_1",
      action: "link" as const,
      object_key: "equipment",
      selector: {
        field_key: "name",
        field_type: "short_text" as const,
        string_value: "Projector",
      },
      location_reference: locationIds.cambridge,
    };
    expect(() =>
      validateBuilderRecordLocationLinkIntentOutput(inactiveInput, ready),
    ).toThrowError(
      expect.objectContaining({ code: "location_reference_invalid" }),
    );

    const multipleLocationInput = input(
      "Update the selected equipment availability.",
      "equipment",
      locationIds.cambridge,
    );
    expect(
      validateBuilderRecordLocationLinkIntentOutput(
        multipleLocationInput,
        ready,
      ),
    ).toEqual(ready);
  });

  it("rejects active preorder Order and Order Item Objects", () => {
    const protectedContext = aiBusinessModelContextV1Schema.parse({
      ...context,
      objects: [
        ...context.objects,
        {
          key: "order",
          singular_label: "Order",
          plural_label: "Orders",
          description: "Trusted order records",
          kind: "template",
          semantic_type: "order",
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
          ],
        },
      ],
      preorder_experiences: [
        {
          key: "preorder",
          product_object_key: "product",
          customer_object_key: "customer",
          order_object_key: "order",
          order_item_object_key: "order_item",
          customer_places_order_relationship_key: "customer_places_order",
          order_contains_item_relationship_key: "order_contains_item",
          product_appears_in_item_relationship_key: "product_appears_in_item",
          schedule: {
            days_of_week: [1, 2, 3, 4, 5],
            start_time: "09:00",
            end_time: "17:00",
            slot_interval_minutes: 30,
            slot_capacity: 10,
            cutoff_hours: 2,
            booking_horizon_days: 30,
          },
          field_mappings: {
            product: {
              name: "name",
              description: "description",
              price: "price",
              image: null,
              status: "status",
              active_status_value: "Active",
            },
            customer: { name: "name", email: "email", phone: null },
            order: {
              public_reference: "public_reference",
              status: "status",
              new_status_value: "New",
              collection_at: "collection_at",
              collection_local_display: "collection_local_display",
              collection_timezone: "collection_timezone",
              collection_location_name: "collection_location_name",
              customer_name: "customer_name",
              customer_email: "customer_email",
              customer_phone: null,
              item_summary: "item_summary",
              total: "total",
            },
            order_item: {
              product_name: "product_name",
              quantity: "quantity",
              unit_price: "unit_price",
              line_total: "line_total",
            },
          },
          public_fields: [
            {
              target: "customer",
              field: "name",
              label: "Name",
              required: true,
            },
            {
              target: "customer",
              field: "email",
              label: "Email",
              required: true,
            },
          ],
          is_active: true,
          allowed_locations: [],
        },
      ],
    });
    const protectedInput = builderRecordLocationLinkIntentTaskInputSchema.parse(
      {
        schema_version: 1,
        owner_request: "Update the selected order availability.",
        business_context: protectedContext,
        ready_plan: readyPlan("order", locationIds.cambridge),
      },
    );
    const output = {
      schema_version: 1 as const,
      state: "ready" as const,
      summary: "Make one Record available at one Location.",
      source_step_reference: "step_1",
      action: "link" as const,
      object_key: "order",
      selector: {
        field_key: "name",
        field_type: "short_text" as const,
        string_value: "Order",
      },
      location_reference: locationIds.cambridge,
    };

    expect(() =>
      validateBuilderRecordLocationLinkIntentOutput(protectedInput, output),
    ).toThrowError(
      expect.objectContaining({
        code: "target_object_ineligible",
      }),
    );
  });

  it("keeps clarification bounded and does not invent a Record ID", () => {
    const taskInput = input(
      "Make something available at Cambridge.",
      "equipment",
      locationIds.cambridge,
    );
    const clarification = {
      schema_version: 1 as const,
      state: "needs_clarification" as const,
      understanding: "The exact Record is missing.",
      question: "Which Record should be changed?",
      reason: "Builder needs one exact current selector.",
      source_step_reference: "step_1",
    };

    expect(
      builderRecordLocationLinkIntentOutputSchema.parse(clarification),
    ).toEqual(clarification);
    expect(
      validateBuilderRecordLocationLinkIntentOutput(taskInput, clarification),
    ).toEqual(clarification);
    expect(JSON.stringify(clarification)).not.toMatch(/record_id|candidate/i);
  });
});
