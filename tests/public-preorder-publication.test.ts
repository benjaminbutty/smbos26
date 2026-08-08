import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  configurationSnapshotV1Schema,
  type ConfigurationSnapshotV1,
} from "../src/core/configuration/definition-source";
import {
  composePublicPreorderPublicationOperation,
  getPublicPreorderPublicationState,
  PublicPreorderPublicationError,
} from "../src/core/configuration/publication/service";
import { publicPreorderPublicationFormSchema } from "../src/core/configuration/publication/schemas";

const pageId = "00000000-0000-4000-8000-000000000001";
const preorderId = "00000000-0000-4000-8000-000000000002";

const preorderConfig = {
  schedule: {
    days_of_week: [1],
    start_time: "09:00",
    end_time: "15:00",
    slot_interval_minutes: 30,
    slot_capacity: 10,
    cutoff_hours: 24,
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
    { target: "customer", field: "name", label: "Name", required: true },
    { target: "customer", field: "email", label: "Email", required: true },
  ],
};

function basePage(
  overrides: Partial<ConfigurationSnapshotV1["pages"][number]> = {},
) {
  return {
    id: pageId,
    key: "public_preorder",
    title: "Order ahead",
    slug: "preorder",
    audience: "public" as const,
    layout_json: {
      blocks: [
        { type: "heading" as const, text: "Order ahead", level: 1 as const },
        { type: "preorder" as const, preorder_key: "preorder" },
      ],
    },
    status: "draft" as const,
    is_active: true,
    ...overrides,
  };
}

function publicationSnapshot(
  page = basePage(),
  preorderActive = true,
): ConfigurationSnapshotV1 {
  return configurationSnapshotV1Schema.parse({
    schema_version: 1,
    object_definitions: [],
    field_definitions: [],
    relationship_definitions: [],
    views: [],
    forms: [],
    pages: [page],
    preorder_experiences: [
      {
        id: preorderId,
        key: "preorder",
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
        config_json: preorderConfig,
        is_active: preorderActive,
      },
    ],
    preorder_experience_locations: [],
  });
}

describe("Milestone 13 Phase 13B deliberate public preorder publication", () => {
  it("composes one complete set_page operation and changes only status", () => {
    const snapshot = publicationSnapshot();
    const page = snapshot.pages[0]!;

    expect(getPublicPreorderPublicationState(snapshot)).toEqual({
      kind: "ready",
      pageSlug: page.slug,
    });

    const operation = composePublicPreorderPublicationOperation(snapshot);
    expect(operation).toEqual({
      op: "set_page",
      key: page.key,
      title: page.title,
      slug: page.slug,
      audience: page.audience,
      layout_json: page.layout_json,
      status: "published",
      is_active: page.is_active,
    });
    expect({ ...operation, status: "draft" }).toEqual({
      op: "set_page",
      key: page.key,
      title: page.title,
      slug: page.slug,
      audience: page.audience,
      layout_json: page.layout_json,
      status: page.status,
      is_active: page.is_active,
    });
  });

  it("fails closed for missing, ambiguous, internal, inactive, and published pages", () => {
    const missing = publicationSnapshot(
      basePage({
        layout_json: {
          blocks: [{ type: "heading", text: "Private", level: 1 }],
        },
      }),
      false,
    );
    expect(getPublicPreorderPublicationState(missing)).toEqual({
      kind: "unavailable",
      reason: "missing",
    });

    const ambiguous = publicationSnapshot();
    ambiguous.pages.push({
      ...basePage(),
      id: "00000000-0000-4000-8000-000000000003",
    });
    expect(getPublicPreorderPublicationState(ambiguous)).toEqual({
      kind: "unavailable",
      reason: "ambiguous",
    });

    for (const page of [
      basePage({ audience: "internal" }),
      basePage({ is_active: false }),
    ]) {
      const state = getPublicPreorderPublicationState(
        publicationSnapshot(page),
      );
      expect(state).toEqual({ kind: "unavailable", reason: "ineligible" });
      expect(() =>
        composePublicPreorderPublicationOperation(publicationSnapshot(page)),
      ).toThrow(PublicPreorderPublicationError);
    }

    const published = publicationSnapshot(basePage({ status: "published" }));
    expect(getPublicPreorderPublicationState(published)).toEqual({
      kind: "published",
      pageSlug: "preorder",
    });
    expect(() =>
      composePublicPreorderPublicationOperation(published),
    ).toThrowError(
      expect.objectContaining({ code: "public_preorder_already_published" }),
    );
  });

  it("accepts only the expected active version and head currentness", () => {
    expect(
      publicPreorderPublicationFormSchema.safeParse({
        expectedBaseVersionId: "00000000-0000-4000-8000-000000000020",
        expectedHeadRevision: 2,
      }).success,
    ).toBe(true);
    expect(
      publicPreorderPublicationFormSchema.safeParse({
        expectedBaseVersionId: "00000000-0000-4000-8000-000000000020",
        expectedHeadRevision: 2,
        pageKey: "public_preorder",
      }).success,
    ).toBe(false);
  });
});
