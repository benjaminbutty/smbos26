import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ConfigurationSnapshotV1 } from "../src/core/configuration/definition-source";
import {
  composePreorderScheduleAmendment,
  describePreorderScheduleChange,
  listPreorderScheduleSetups,
  ManualAmendmentError,
} from "../src/core/configuration/manual-amendments/service";
import { updatePreorderScheduleIntentSchema } from "../src/core/configuration/manual-amendments/schemas";
import { setPreorderExperienceOperationSchema } from "../src/core/configuration/schemas";

const preorderId = "00000000-0000-4000-8000-000000000001";
const activeLocationId = "00000000-0000-4000-8000-000000000002";
const inactiveLocationId = "00000000-0000-4000-8000-000000000003";

const config = {
  schedule: {
    days_of_week: [6, 7],
    start_time: "09:00",
    end_time: "15:00",
    slot_interval_minutes: 30,
    slot_capacity: 10,
    cutoff_hours: 48,
    booking_horizon_days: 30,
  },
  field_mappings: {
    product: {
      name: "name",
      description: "description",
      price: "price",
      image: "image",
      status: "status",
      active_status_value: "Active",
    },
    customer: { name: "name", email: "email", phone: "phone" },
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
      customer_phone: "customer_phone",
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
      label: "Your name",
      required: true,
      help_text: "Who is collecting?",
      autocomplete: "name" as const,
    },
    {
      target: "customer" as const,
      field: "email",
      label: "Email",
      required: true,
      autocomplete: "email" as const,
    },
  ],
};

function snapshot(): ConfigurationSnapshotV1 {
  return {
    schema_version: 1,
    object_definitions: [],
    field_definitions: [],
    relationship_definitions: [],
    views: [],
    forms: [],
    pages: [
      {
        id: "00000000-0000-4000-8000-000000000004",
        key: "public_preorder",
        title: "Celebration boxes",
        slug: "preorder",
        audience: "public",
        layout_json: {
          blocks: [{ type: "preorder", preorder_key: "bakery_preorder" }],
        },
        status: "published",
        is_active: true,
      },
    ],
    preorder_experiences: [
      {
        id: preorderId,
        key: "bakery_preorder",
        product_object_definition_id: "00000000-0000-4000-8000-000000000010",
        product_object_key: "product",
        customer_object_definition_id: "00000000-0000-4000-8000-000000000011",
        customer_object_key: "customer",
        order_object_definition_id: "00000000-0000-4000-8000-000000000012",
        order_object_key: "order",
        order_item_object_definition_id: "00000000-0000-4000-8000-000000000013",
        order_item_object_key: "order_item",
        customer_places_order_relationship_definition_id:
          "00000000-0000-4000-8000-000000000014",
        customer_places_order_relationship_key: "customer_places_order",
        order_contains_item_relationship_definition_id:
          "00000000-0000-4000-8000-000000000015",
        order_contains_item_relationship_key: "order_contains_order_item",
        product_appears_in_item_relationship_definition_id:
          "00000000-0000-4000-8000-000000000016",
        product_appears_in_item_relationship_key:
          "product_appears_in_order_item",
        config_json: structuredClone(config),
        is_active: true,
      },
    ],
    preorder_experience_locations: [
      {
        id: "00000000-0000-4000-8000-000000000020",
        preorder_experience_id: preorderId,
        preorder_key: "bakery_preorder",
        location_id: activeLocationId,
        is_active: true,
      },
      {
        id: "00000000-0000-4000-8000-000000000021",
        preorder_experience_id: preorderId,
        preorder_key: "bakery_preorder",
        location_id: inactiveLocationId,
        is_active: false,
      },
    ],
  };
}

function intent(
  changes: Partial<(typeof config)["schedule"]> = {},
): Parameters<typeof composePreorderScheduleAmendment>[1] {
  return {
    intent: "update_preorder_schedule",
    preorderKey: "bakery_preorder",
    schedule: { ...config.schedule, ...changes },
  };
}

describe("deterministic manual preorder schedule amendments", () => {
  it("composes exactly one authoritative operation and preserves every non-schedule property", () => {
    const active = snapshot();
    const composed = composePreorderScheduleAmendment(
      active,
      intent({
        days_of_week: [6],
        cutoff_hours: 72,
        slot_capacity: 15,
      }),
    );

    expect(
      setPreorderExperienceOperationSchema.parse(composed.operation),
    ).toEqual(composed.operation);
    expect(composed.operation.allowed_location_ids).toEqual([activeLocationId]);
    expect(composed.operation.allowed_location_ids).not.toContain(
      inactiveLocationId,
    );
    expect(composed.operation.config_json.field_mappings).toEqual(
      config.field_mappings,
    );
    expect(composed.operation.config_json.public_fields).toEqual(
      config.public_fields,
    );
    expect(composed.operation).toMatchObject({
      op: "set_preorder_experience",
      key: "bakery_preorder",
      product_object_key: "product",
      customer_object_key: "customer",
      order_object_key: "order",
      order_item_object_key: "order_item",
      customer_places_order_relationship_key: "customer_places_order",
      order_contains_item_relationship_key: "order_contains_order_item",
      product_appears_in_item_relationship_key: "product_appears_in_order_item",
      is_active: true,
    });
    expect(composed.operation.config_json.schedule).toMatchObject({
      days_of_week: [6],
      cutoff_hours: 72,
      slot_capacity: 15,
    });
  });

  it("changes capacity, interval, hours and horizon independently", () => {
    const cases = [
      { slot_capacity: 11 },
      { slot_interval_minutes: 45 },
      { start_time: "10:00" },
      { end_time: "16:00" },
      { booking_horizon_days: 60 },
    ];
    for (const change of cases) {
      const composed = composePreorderScheduleAmendment(
        snapshot(),
        intent(change),
      );
      expect(composed.noOp).toBe(false);
      expect(composed.operation.config_json.schedule).toMatchObject(change);
    }
  });

  it("rejects duplicate, empty, invalid-time and out-of-range owner values", () => {
    for (const schedule of [
      { ...config.schedule, days_of_week: [6, 6] },
      { ...config.schedule, days_of_week: [] },
      { ...config.schedule, start_time: "16:00", end_time: "15:00" },
      { ...config.schedule, slot_interval_minutes: 4 },
      { ...config.schedule, slot_capacity: 0 },
      { ...config.schedule, cutoff_hours: 8761 },
      { ...config.schedule, booking_horizon_days: 366 },
    ]) {
      expect(
        updatePreorderScheduleIntentSchema.safeParse({
          intent: "update_preorder_schedule",
          preorderKey: "bakery_preorder",
          schedule,
        }).success,
      ).toBe(false);
    }
  });

  it("fails safely for missing, archived, ambiguous or locationless setups", () => {
    const missing = snapshot();
    expect(() =>
      composePreorderScheduleAmendment(missing, {
        ...intent(),
        preorderKey: "missing",
      }),
    ).toThrowError(ManualAmendmentError);

    const archived = snapshot();
    archived.preorder_experiences[0]!.is_active = false;
    expect(() =>
      composePreorderScheduleAmendment(archived, intent()),
    ).toThrowError("no longer available");

    const ambiguous = snapshot();
    ambiguous.preorder_experiences.push(
      structuredClone(ambiguous.preorder_experiences[0]!),
    );
    expect(() =>
      composePreorderScheduleAmendment(ambiguous, intent()),
    ).toThrowError("could not be identified safely");

    const locationless = snapshot();
    locationless.preorder_experience_locations = [];
    expect(() =>
      composePreorderScheduleAmendment(locationless, intent()),
    ).toThrowError("no available collection location");
  });

  it("detects semantic no-ops even when days arrive in another order", () => {
    const composed = composePreorderScheduleAmendment(
      snapshot(),
      intent({ days_of_week: [7, 6] }),
    );
    expect(composed.noOp).toBe(true);
    expect(composed.description).toBe("");
  });

  it("builds bounded owner-readable metadata without technical grammar", () => {
    const description = describePreorderScheduleChange(
      config.schedule,
      intent({
        days_of_week: [6],
        cutoff_hours: 72,
        slot_capacity: 15,
      }).schedule,
    );
    expect(description).toContain("Remove Sunday collection");
    expect(description).toContain("Change notice from 48 hours to 72 hours");
    expect(description).toContain(
      "Change capacity from 10 orders per slot to 15 orders per slot",
    );
    expect(description).not.toMatch(
      /bakery_preorder|config_json|set_preorder_experience|[{}[\]"]/,
    );
  });

  it("uses a linked public Page title and a neutral fallback label", () => {
    const active = snapshot();
    expect(listPreorderScheduleSetups(active)[0]?.label).toBe(
      "Celebration boxes",
    );
    active.pages = [];
    expect(listPreorderScheduleSetups(active)[0]?.label).toBe(
      "Preorder collection settings",
    );
  });

  it("does not accept caller-owned mappings, fields, locations or activation", () => {
    expect(
      updatePreorderScheduleIntentSchema.safeParse({
        ...intent(),
        field_mappings: {},
        public_fields: [],
        allowed_location_ids: [inactiveLocationId],
        is_active: false,
      }).success,
    ).toBe(false);
  });

  it("keeps the source boundary free of direct DML, AI and service-role access", () => {
    const serviceSource = readFileSync(
      new URL(
        "../src/core/configuration/manual-amendments/service.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const actionSource = readFileSync(
      new URL(
        "../src/app/app/[businessSlug]/setup/actions.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const source = `${serviceSource}\n${actionSource}`;
    expect(source).not.toMatch(
      /\.(?:insert|update|upsert|delete)\(|service[_-]?role|src\/ai|from ["'][^"']*\/ai\//i,
    );
    expect(source).not.toMatch(
      /\.from\(\s*["'](?:object_definitions|field_definitions|relationship_definitions|views|forms|pages|preorder_experiences|preorder_experience_locations)["']\s*\)/,
    );
    expect(actionSource).toContain(".proposeChangeSet(");
    expect(actionSource).not.toMatch(
      /\.validateChangeSet\(|\.applyChangeSet\(|ai_execution_runs/,
    );
  });

  it("keeps setup GET routes no-store, owner-facing and separate from lifecycle mutation", () => {
    const overview = readFileSync(
      new URL("../src/app/app/[businessSlug]/setup/page.tsx", import.meta.url),
      "utf8",
    );
    const editor = readFileSync(
      new URL(
        "../src/app/app/[businessSlug]/setup/preorder/[preorderKey]/page.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const layout = readFileSync(
      new URL("../src/app/app/[businessSlug]/layout.tsx", import.meta.url),
      "utf8",
    );
    for (const route of [overview, editor]) {
      expect(route).toContain('dynamic = "force-dynamic"');
      expect(route).toContain("revalidate = 0");
      expect(route).not.toMatch(
        /\.proposeChangeSet\(|\.validateChangeSet\(|\.applyChangeSet\(/,
      );
    }
    expect(editor).toContain("Collection days");
    expect(editor).toContain("First collection");
    expect(editor).toContain("Last collection");
    expect(editor).toContain("Time between collection slots");
    expect(editor).toContain("Maximum orders per slot");
    expect(editor).toContain("Notice required before collection");
    expect(editor).toContain("How far ahead customers can order");
    expect(editor).toContain("Review change");
    expect(layout).toContain(
      "<Link href={`/app/${businessSlug}/setup`}>Edit setup</Link>",
    );
    expect(layout).toContain(
      'hasCapability(tenant.membership.role, "manage_configuration")',
    );
    expect(layout).toContain(
      "<Link href={`/app/${businessSlug}/changes`}>Changes</Link>",
    );
  });
});
