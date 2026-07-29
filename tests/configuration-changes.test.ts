import { describe, expect, it } from "vitest";

import {
  configurationDisplayContextSchema,
  configurationValidationResultSchema,
  configurationOperationsSchema,
  prepareConfigurationRollbackSchema,
  proposeConfigurationChangeSchema,
} from "../src/core/configuration/schemas";

const locationId = "00000000-0000-4000-8000-000000000001";

const preorderConfig = {
  schedule: {
    days_of_week: [6],
    start_time: "11:00",
    end_time: "16:00",
    slot_interval_minutes: 30,
    slot_capacity: 10,
    cutoff_hours: 48,
    booking_horizon_days: 90,
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
      target: "customer" as const,
      field: "name",
      label: "Name",
      required: true,
    },
    {
      target: "customer" as const,
      field: "email",
      label: "Email",
      required: true,
    },
  ],
};

const operations = [
  {
    op: "set_object",
    key: "catering_enquiry",
    singular_label: "Catering enquiry",
    plural_label: "Catering enquiries",
    description: "",
    icon: null,
    is_active: true,
  },
  {
    op: "set_field",
    object_key: "catering_enquiry",
    key: "name",
    label: "Name",
    field_type: "short_text",
    required: true,
    default_value: null,
    settings_json: {},
    position: 0,
    is_active: true,
  },
  {
    op: "set_relationship",
    key: "customer_submits_enquiry",
    source_object_key: "customer",
    target_object_key: "catering_enquiry",
    source_label: "Catering enquiries",
    target_label: "Customer",
    cardinality: "one_to_many",
    is_required: false,
    is_active: true,
  },
  {
    op: "set_view",
    key: "catering_enquiries",
    name: "Catering enquiries",
    view_type: "table",
    object_key: "catering_enquiry",
    config_json: { fields: ["name"] },
    audience: "internal",
    is_active: true,
  },
  {
    op: "set_form",
    key: "catering_enquiry_create",
    name: "New catering enquiry",
    object_key: "catering_enquiry",
    mode: "create",
    config_json: { fields: [{ field: "name" }] },
    audience: "internal",
    is_active: true,
  },
  {
    op: "set_page",
    key: "catering_workspace",
    title: "Catering",
    slug: "catering",
    audience: "internal",
    layout_json: {
      blocks: [{ type: "view", view_key: "catering_enquiries" }],
    },
    status: "draft",
    is_active: true,
  },
  {
    op: "set_preorder_experience",
    key: "bakery_preorder",
    product_object_key: "product",
    customer_object_key: "customer",
    order_object_key: "order",
    order_item_object_key: "order_item",
    customer_places_order_relationship_key: "customer_places_order",
    order_contains_item_relationship_key: "order_contains_item",
    product_appears_in_item_relationship_key: "product_appears_in_item",
    config_json: preorderConfig,
    allowed_location_ids: [locationId],
    is_active: true,
  },
] as const;

describe("configuration change operation grammar", () => {
  it("accepts every complete operation discriminator", () => {
    const parsed = configurationOperationsSchema.parse(operations);
    expect(parsed.map(({ op }) => op)).toEqual([
      "set_object",
      "set_field",
      "set_relationship",
      "set_view",
      "set_form",
      "set_page",
      "set_preorder_experience",
    ]);
  });

  it.each(["id", "business_id", "kind", "semantic_type"])(
    "rejects caller-controlled %s properties",
    (property) => {
      expect(() =>
        configurationOperationsSchema.parse([
          { ...operations[0], [property]: crypto.randomUUID() },
        ]),
      ).toThrow();
    },
  );

  it("rejects unknown operations and unknown properties", () => {
    expect(() =>
      configurationOperationsSchema.parse([{ op: "run_sql", sql: "select 1" }]),
    ).toThrow();
    expect(() =>
      configurationOperationsSchema.parse([
        { ...operations[5], unexpected: true },
      ]),
    ).toThrow();
  });

  it("rejects duplicate semantic targets and duplicate Location IDs", () => {
    expect(() =>
      configurationOperationsSchema.parse([operations[0], operations[0]]),
    ).toThrow(/one operation/i);
    expect(() =>
      configurationOperationsSchema.parse([
        {
          ...operations[6],
          allowed_location_ids: [locationId, locationId],
        },
      ]),
    ).toThrow(/unique/i);
  });

  it("enforces operation count and serialized payload limits", () => {
    expect(() =>
      configurationOperationsSchema.parse(
        Array.from({ length: 101 }, (_, index) => ({
          ...operations[0],
          key: `object_${index}`,
        })),
      ),
    ).toThrow();

    expect(() =>
      configurationOperationsSchema.parse([
        ...Array.from({ length: 60 }, (_, index) => ({
          ...operations[0],
          key: `large_object_${index}`,
          description: "x".repeat(5000),
        })),
      ]),
    ).toThrow(/256 KiB/);
  });

  it("requires bounded proposal metadata and rejects embedded engine output", () => {
    expect(
      proposeConfigurationChangeSchema.parse({
        title: "Saturday collection only",
        description: null,
        operations: [operations[0]],
      }),
    ).toMatchObject({ title: "Saturday collection only" });
    expect(() =>
      proposeConfigurationChangeSchema.parse({
        title: "Unsafe",
        description: null,
        operations: [operations[0]],
        candidate_snapshot_json: {},
      }),
    ).toThrow();
  });

  it("accepts only the narrow rollback request surface", () => {
    expect(
      prepareConfigurationRollbackSchema.parse({
        targetVersionId: locationId,
        title: "Restore weekend collection",
        description: null,
      }),
    ).toEqual({
      targetVersionId: locationId,
      title: "Restore weekend collection",
      description: null,
    });
    expect(() =>
      prepareConfigurationRollbackSchema.parse({
        targetVersionId: locationId,
        title: "Unsafe rollback",
        description: null,
        candidate_snapshot_json: {},
      }),
    ).toThrow();
  });

  it("strictly validates immutable proposal display context", () => {
    expect(
      configurationDisplayContextSchema.parse({
        schema_version: 1,
        locations: {
          [locationId]: { name: "Bedford" },
        },
      }),
    ).toEqual({
      schema_version: 1,
      locations: {
        [locationId]: { name: "Bedford" },
      },
    });
    expect(() =>
      configurationDisplayContextSchema.parse({
        schema_version: 1,
        locations: {
          [locationId]: { name: "Bedford", is_active: true },
        },
      }),
    ).toThrow();
  });

  it("strictly validates owner-facing configuration validation results", () => {
    const base = {
      schema_version: 1,
      base_version_id: "00000000-0000-4000-8000-000000000002",
      base_head_revision: 1,
      candidate_checksum: "a".repeat(64),
      warnings: [],
    };
    expect(
      configurationValidationResultSchema.parse({
        ...base,
        outcome: "valid",
        errors: [],
      }),
    ).toMatchObject({ outcome: "valid" });
    expect(
      configurationValidationResultSchema.parse({
        ...base,
        outcome: "invalid",
        errors: [
          {
            code: "existing_records_incompatible",
            message:
              "This change is not compatible with existing business information.",
          },
        ],
      }),
    ).toMatchObject({ outcome: "invalid" });
    expect(() =>
      configurationValidationResultSchema.parse({
        ...base,
        outcome: "valid",
        errors: [{ code: "raw_sql", message: "select * from records" }],
      }),
    ).toThrow();
    expect(() =>
      configurationValidationResultSchema.parse({
        ...base,
        outcome: "invalid",
        errors: [],
        internal_function: "private.project_configuration_candidate_v1",
      }),
    ).toThrow();
  });
});
