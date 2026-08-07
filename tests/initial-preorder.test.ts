import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ConfigurationSnapshotV1 } from "../src/core/configuration/definition-source";
import {
  composeInitialPreorderOperations,
  getInitialPreorderStarterState,
} from "../src/core/configuration/initial-preorder/service";
import {
  initialPreorderSetupFormSchema,
  initialPreorderSetupRequestSchema,
} from "../src/core/configuration/initial-preorder/schemas";
import { configurationOperationSchema } from "../src/core/configuration/schemas";

const baseVersionId = "00000000-0000-4000-8000-000000000001";
const locationOne = "00000000-0000-4000-8000-000000000002";
const locationTwo = "00000000-0000-4000-8000-000000000003";

const request = {
  expectedBaseVersionId: baseVersionId,
  expectedHeadRevision: 1,
  locationIds: [locationTwo, locationOne],
  schedule: {
    days_of_week: [7, 2],
    start_time: "09:00",
    end_time: "15:00",
    slot_interval_minutes: 45,
    slot_capacity: 12,
    cutoff_hours: 36,
    booking_horizon_days: 60,
  },
};

function emptySnapshot(): ConfigurationSnapshotV1 {
  return {
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
}

describe("Milestone 13 Phase 13A initial preorder starter", () => {
  it("accepts only the minimum owner inputs and normalizes collection identity", () => {
    const parsed = initialPreorderSetupRequestSchema.parse(request);
    const operations = composeInitialPreorderOperations(parsed);

    expect(operations).toHaveLength(41);
    for (const operation of operations) {
      expect(configurationOperationSchema.parse(operation)).toEqual(operation);
    }

    const preorder = operations.find(
      (operation) => operation.op === "set_preorder_experience",
    );
    expect(
      preorder?.op === "set_preorder_experience" ? preorder : null,
    ).toEqual(
      expect.objectContaining({
        key: "preorder",
        allowed_location_ids: [locationOne, locationTwo],
        is_active: true,
      }),
    );
    expect(
      preorder?.op === "set_preorder_experience"
        ? preorder.config_json.schedule
        : null,
    ).toMatchObject({
      days_of_week: [2, 7],
      start_time: "09:00",
      end_time: "15:00",
      slot_interval_minutes: 45,
      slot_capacity: 12,
      cutoff_hours: 36,
      booking_horizon_days: 60,
    });
  });

  it("creates generic Product and Order operating surfaces without operational data", () => {
    const operations = composeInitialPreorderOperations(request);
    const objects = operations.filter(
      (operation) => operation.op === "set_object",
    );
    const views = operations.filter((operation) => operation.op === "set_view");
    const forms = operations.filter((operation) => operation.op === "set_form");
    const pages = operations.filter((operation) => operation.op === "set_page");

    expect(objects.map((operation) => operation.key)).toEqual([
      "customer",
      "product",
      "order",
      "order_item",
    ]);
    expect(views.map((operation) => operation.key)).toEqual([
      "product_detail",
      "products",
      "order_detail",
      "orders",
    ]);
    expect(forms.map((operation) => operation.key)).toEqual([
      "product_create",
      "product_edit",
      "order_status_edit",
    ]);
    expect(pages.map((operation) => operation.status)).toEqual([
      "draft",
      "draft",
      "draft",
    ]);

    const publicPage = pages.find(
      (operation) => operation.key === "public_preorder",
    );
    expect(publicPage?.audience).toBe("public");
    expect(publicPage?.layout_json.blocks).toContainEqual({
      type: "preorder",
      preorder_key: "preorder",
    });

    const serialized = JSON.stringify(operations);
    expect(serialized).not.toMatch(
      /Bedford|Milton Keynes|bakery|Afternoon Tea/i,
    );
    expect(serialized).not.toMatch(/record|product data|seed/i);
  });

  it("rejects invalid schedule and duplicate locations before composition", () => {
    expect(
      initialPreorderSetupRequestSchema.safeParse({
        ...request,
        locationIds: [locationOne, locationOne],
      }).success,
    ).toBe(false);
    expect(
      initialPreorderSetupRequestSchema.safeParse({
        ...request,
        schedule: { ...request.schedule, days_of_week: [] },
      }).success,
    ).toBe(false);
    expect(
      initialPreorderSetupRequestSchema.safeParse({
        ...request,
        schedule: {
          ...request.schedule,
          start_time: "15:00",
          end_time: "09:00",
        },
      }).success,
    ).toBe(false);
  });

  it("parses the owner form values while keeping currentness server-bound", () => {
    const parsed = initialPreorderSetupFormSchema.safeParse({
      expectedBaseVersionId: baseVersionId,
      expectedHeadRevision: 1,
      locationIds: [locationOne],
      daysOfWeek: [1, 5],
      startTime: "10:00",
      endTime: "16:00",
      slotIntervalMinutes: 30,
      slotCapacity: 10,
      cutoffHours: 48,
      bookingHorizonDays: 90,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success ? parsed.data.schedule : null).toEqual({
      days_of_week: [1, 5],
      start_time: "10:00",
      end_time: "16:00",
      slot_interval_minutes: 30,
      slot_capacity: 10,
      cutoff_hours: 48,
      booking_horizon_days: 90,
    });
  });

  it("keeps request-level form invariants inside safeParse", () => {
    const form = {
      expectedBaseVersionId: baseVersionId,
      expectedHeadRevision: 1,
      locationIds: [locationOne],
      daysOfWeek: [1, 5],
      startTime: "10:00",
      endTime: "16:00",
      slotIntervalMinutes: 30,
      slotCapacity: 10,
      cutoffHours: 48,
      bookingHorizonDays: 90,
    };

    expect(
      initialPreorderSetupFormSchema.safeParse({ ...form, locationIds: [] })
        .success,
    ).toBe(false);
    expect(
      initialPreorderSetupFormSchema.safeParse({
        ...form,
        startTime: "16:00",
        endTime: "10:00",
      }).success,
    ).toBe(false);
  });

  it("only offers the starter to a clean Business with an active Location", () => {
    expect(getInitialPreorderStarterState(emptySnapshot(), 1)).toBe("ready");
    expect(getInitialPreorderStarterState(emptySnapshot(), 0)).toBe(
      "no_active_locations",
    );

    const installed = emptySnapshot();
    installed.preorder_experiences.push({
      id: "00000000-0000-4000-8000-000000000010",
      key: "preorder",
      product_object_definition_id: "00000000-0000-4000-8000-000000000011",
      product_object_key: "product",
      customer_object_definition_id: "00000000-0000-4000-8000-000000000012",
      customer_object_key: "customer",
      order_object_definition_id: "00000000-0000-4000-8000-000000000013",
      order_object_key: "order",
      order_item_object_definition_id: "00000000-0000-4000-8000-000000000014",
      order_item_object_key: "order_item",
      customer_places_order_relationship_definition_id:
        "00000000-0000-4000-8000-000000000015",
      customer_places_order_relationship_key: "customer_places_order",
      order_contains_item_relationship_definition_id:
        "00000000-0000-4000-8000-000000000016",
      order_contains_item_relationship_key: "order_contains_order_item",
      product_appears_in_item_relationship_definition_id:
        "00000000-0000-4000-8000-000000000017",
      product_appears_in_item_relationship_key: "product_appears_in_order_item",
      config_json: {
        schedule: {
          days_of_week: [1],
          start_time: "09:00",
          end_time: "10:00",
          slot_interval_minutes: 30,
          slot_capacity: 1,
          cutoff_hours: 1,
          booking_horizon_days: 1,
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
          { target: "customer", field: "name", label: "Name", required: true },
          {
            target: "customer",
            field: "email",
            label: "Email",
            required: true,
          },
        ],
      },
      is_active: true,
    });
    expect(getInitialPreorderStarterState(installed, 1)).toBe(
      "already_installed",
    );

    const existingConfiguration = emptySnapshot();
    existingConfiguration.object_definitions.push({
      id: "00000000-0000-4000-8000-000000000020",
      key: "product",
      singular_label: "Product",
      plural_label: "Products",
      description: "Existing",
      kind: "custom",
      semantic_type: null,
      icon: null,
      is_active: true,
    });
    expect(getInitialPreorderStarterState(existingConfiguration, 1)).toBe(
      "business_not_clean",
    );
    expect(getInitialPreorderStarterState(existingConfiguration, 0)).toBe(
      "business_not_clean",
    );
  });

  it("keeps the production boundary deterministic and free of demo, AI, and direct configuration DML", () => {
    const source = readFileSync(
      new URL(
        "../src/core/configuration/initial-preorder/service.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).not.toMatch(
      /demo-seed|Bedford|Milton Keynes|bakery|src\/ai/i,
    );
    expect(source).not.toMatch(/\.(?:insert|update|upsert|delete)\(/);
    expect(source).not.toMatch(/\.rpc\(/);
    expect(source).toContain("configuration.proposeChangeSet");
  });
});
