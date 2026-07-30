import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AiBusinessContextError } from "../src/ai/context/errors";
import {
  projectAiBusinessModelContext,
  serializeAiBusinessModelContext,
  type AiBusinessContextSource,
} from "../src/ai/context/projector";
import {
  aiBusinessModelContextV1Schema,
  authoritativeConfigurationOperationNames,
  authoritativeFieldTypes,
  authoritativeFormModes,
  authoritativePageBlockTypes,
  authoritativeRelationshipCardinalities,
  authoritativeViewTypes,
} from "../src/ai/context/schemas";
import type { ConfigurationSnapshotV1 } from "../src/core/configuration/definition-source";

const ids = {
  actor: "90000000-0000-4000-8000-000000000001",
  business: "90000000-0000-4000-8000-000000000002",
  version: "90000000-0000-4000-8000-000000000003",
  customer: "10000000-0000-4000-8000-000000000001",
  product: "10000000-0000-4000-8000-000000000002",
  order: "10000000-0000-4000-8000-000000000003",
  orderItem: "10000000-0000-4000-8000-000000000004",
  customerName: "20000000-0000-4000-8000-000000000001",
  customerLegacy: "20000000-0000-4000-8000-000000000002",
  orderDietary: "20000000-0000-4000-8000-000000000003",
  productStatus: "20000000-0000-4000-8000-000000000004",
  relationshipCustomerOrder: "30000000-0000-4000-8000-000000000001",
  relationshipOrderItem: "30000000-0000-4000-8000-000000000002",
  relationshipProductItem: "30000000-0000-4000-8000-000000000003",
  view: "40000000-0000-4000-8000-000000000001",
  form: "50000000-0000-4000-8000-000000000001",
  page: "60000000-0000-4000-8000-000000000001",
  preorder: "70000000-0000-4000-8000-000000000001",
  preorderLocation: "80000000-0000-4000-8000-000000000001",
  activeLocation: "a0000000-0000-4000-8000-000000000001",
  inactiveLocation: "a0000000-0000-4000-8000-000000000002",
} as const;

function snapshot(): ConfigurationSnapshotV1 {
  const object = (
    id: string,
    key: string,
    singularLabel: string,
    isActive = true,
  ) => ({
    id,
    key,
    singular_label: singularLabel,
    plural_label: `${singularLabel}s`,
    description: `${singularLabel} configuration`,
    kind: "custom" as const,
    semantic_type: null,
    icon: null,
    is_active: isActive,
  });
  const preorderConfig = {
    schedule: {
      days_of_week: [6, 7],
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
        label: "Your name",
        required: true,
        autocomplete: "name" as const,
      },
      {
        target: "order" as const,
        field: "dietary_requirements",
        label: "Dietary requirements",
        required: false,
        help_text: "Tell us what we need to know.",
        autocomplete: "off" as const,
      },
    ],
  };

  return {
    schema_version: 1,
    object_definitions: [
      object(ids.product, "product", "Product"),
      object(ids.order, "order", "Order"),
      object(ids.customer, "customer", "Customer"),
      object(ids.orderItem, "order_item", "Order Item", false),
    ],
    field_definitions: [
      {
        id: ids.productStatus,
        object_definition_id: ids.product,
        object_key: "product",
        key: "status",
        label: "Status",
        field_type: "status",
        required: true,
        default_value: "Active",
        settings_json: {
          options: ["Active", "Inactive"],
          internal_note: "secret-setting-never-expose",
        },
        position: 1,
        is_active: true,
      },
      {
        id: ids.customerLegacy,
        object_definition_id: ids.customer,
        object_key: "customer",
        key: "legacy_note",
        label: "Legacy note",
        field_type: "long_text",
        required: false,
        default_value: "secret-default-never-expose",
        settings_json: { secret: "secret-setting-never-expose" },
        position: 9,
        is_active: false,
      },
      {
        id: ids.customerName,
        object_definition_id: ids.customer,
        object_key: "customer",
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
        id: ids.orderDietary,
        object_definition_id: ids.order,
        object_key: "order",
        key: "dietary_requirements",
        label: "Dietary requirements",
        field_type: "long_text",
        required: false,
        default_value: null,
        settings_json: {},
        position: 5,
        is_active: true,
      },
    ],
    relationship_definitions: [
      {
        id: ids.relationshipProductItem,
        key: "product_appears_in_order_item",
        source_object_definition_id: ids.product,
        source_object_key: "product",
        target_object_definition_id: ids.orderItem,
        target_object_key: "order_item",
        source_label: "appears in",
        target_label: "product",
        cardinality: "one_to_many",
        is_required: true,
        is_active: false,
      },
      {
        id: ids.relationshipCustomerOrder,
        key: "customer_places_order",
        source_object_definition_id: ids.customer,
        source_object_key: "customer",
        target_object_definition_id: ids.order,
        target_object_key: "order",
        source_label: "places",
        target_label: "customer",
        cardinality: "one_to_many",
        is_required: true,
        is_active: true,
      },
      {
        id: ids.relationshipOrderItem,
        key: "order_contains_order_item",
        source_object_definition_id: ids.order,
        source_object_key: "order",
        target_object_definition_id: ids.orderItem,
        target_object_key: "order_item",
        source_label: "contains",
        target_label: "order",
        cardinality: "one_to_many",
        is_required: true,
        is_active: true,
      },
    ],
    views: [
      {
        id: ids.view,
        key: "orders",
        name: "Orders",
        view_type: "table",
        object_definition_id: ids.order,
        object_key: "order",
        config_json: {
          fields: ["dietary_requirements"],
          include_archived: false,
        },
        audience: "internal",
        is_active: true,
      },
    ],
    forms: [
      {
        id: ids.form,
        key: "customer_form",
        name: "Customer form",
        object_definition_id: ids.customer,
        object_key: "customer",
        mode: "create",
        config_json: {
          fields: [
            {
              field: "name",
              label: "Your name",
              help_text: "How should we address you?",
              hidden: false,
            },
            {
              field: "legacy_note",
              hidden: true,
              default_value: "secret-form-default-never-expose",
            },
          ],
          submit_label: "Continue",
        },
        audience: "internal",
        is_active: false,
      },
    ],
    pages: [
      {
        id: ids.page,
        key: "public_preorder",
        title: "Preorder",
        slug: "preorder",
        audience: "public",
        layout_json: {
          blocks: [
            { type: "heading", text: "Preorder for collection", level: 1 },
            {
              type: "text",
              text: "Choose a collection location and tell us what you need.",
            },
            {
              type: "image",
              src: "https://example.test/preorder.jpg",
              alt: "A boxed preorder",
            },
            {
              type: "button",
              label: "Contact us",
              href: "mailto:hello@example.test",
              style: "secondary",
            },
            { type: "preorder", preorder_key: "bakery_preorder" },
          ],
        },
        status: "published",
        is_active: true,
      },
    ],
    preorder_experiences: [
      {
        id: ids.preorder,
        key: "bakery_preorder",
        product_object_definition_id: ids.product,
        product_object_key: "product",
        customer_object_definition_id: ids.customer,
        customer_object_key: "customer",
        order_object_definition_id: ids.order,
        order_object_key: "order",
        order_item_object_definition_id: ids.orderItem,
        order_item_object_key: "order_item",
        customer_places_order_relationship_definition_id:
          ids.relationshipCustomerOrder,
        customer_places_order_relationship_key: "customer_places_order",
        order_contains_item_relationship_definition_id:
          ids.relationshipOrderItem,
        order_contains_item_relationship_key: "order_contains_order_item",
        product_appears_in_item_relationship_definition_id:
          ids.relationshipProductItem,
        product_appears_in_item_relationship_key:
          "product_appears_in_order_item",
        config_json: preorderConfig,
        is_active: true,
      },
    ],
    preorder_experience_locations: [
      {
        id: ids.preorderLocation,
        preorder_experience_id: ids.preorder,
        preorder_key: "bakery_preorder",
        location_id: ids.activeLocation,
        is_active: true,
      },
    ],
  };
}

function source(): AiBusinessContextSource {
  return {
    business: {
      name: "Example Bakery",
      businessType: "bakery",
      timezone: "Europe/London",
    },
    access: {
      role: "owner",
      capabilities: ["manage_configuration"],
    },
    activeConfiguration: {
      versionNumber: 2,
      revision: 2,
      snapshot: snapshot(),
    },
    locations: [
      {
        reference: ids.inactiveLocation,
        name: "York",
        timezone: "Europe/London",
        isActive: false,
      },
      {
        reference: ids.activeLocation,
        name: "Bedford",
        timezone: "Europe/London",
        isActive: true,
      },
    ],
  };
}

function shuffledSource(): AiBusinessContextSource {
  const shuffled = structuredClone(source());
  shuffled.locations = [...shuffled.locations].reverse();
  const activeSnapshot = shuffled.activeConfiguration.snapshot;
  activeSnapshot.object_definitions.reverse();
  activeSnapshot.field_definitions.reverse();
  activeSnapshot.relationship_definitions.reverse();
  activeSnapshot.views.reverse();
  activeSnapshot.forms.reverse();
  activeSnapshot.pages.reverse();
  activeSnapshot.preorder_experiences.reverse();
  activeSnapshot.preorder_experience_locations.reverse();
  return shuffled;
}

describe("AI-safe Business model context projection", () => {
  it("produces byte-identical canonical JSON from equivalent shuffled sources", () => {
    const left = projectAiBusinessModelContext(source());
    const right = projectAiBusinessModelContext(shuffledSource());

    expect(serializeAiBusinessModelContext(left.modelContext)).toBe(
      serializeAiBusinessModelContext(right.modelContext),
    );
    expect(left.serializedBytes).toBe(right.serializedBytes);
  });

  it("strictly rejects unknown top-level and nested properties", () => {
    const projected = projectAiBusinessModelContext(source()).modelContext;
    expect(
      aiBusinessModelContextV1Schema.safeParse({
        ...projected,
        unexpected: true,
      }).success,
    ).toBe(false);
    expect(
      aiBusinessModelContextV1Schema.safeParse({
        ...projected,
        business: { ...projected.business, unexpected: true },
      }).success,
    ).toBe(false);
    expect(
      aiBusinessModelContextV1Schema.safeParse({
        ...projected,
        objects: [
          {
            ...projected.objects[0],
            fields: [{ ...projected.objects[0]!.fields[0], unexpected: true }],
          },
          ...projected.objects.slice(1),
        ],
      }).success,
    ).toBe(false);
  });

  it("excludes tenant, actor, configuration IDs, timestamps, checksums, raw settings, and raw defaults", () => {
    const projected = projectAiBusinessModelContext(source()).modelContext;
    const serialized = serializeAiBusinessModelContext(projected);

    for (const forbidden of [
      ids.business,
      ids.actor,
      ids.version,
      ids.customer,
      ids.customerName,
      ids.relationshipCustomerOrder,
      ids.view,
      ids.form,
      ids.page,
      ids.preorder,
      ids.preorderLocation,
      "secret-default-never-expose",
      "secret-form-default-never-expose",
      "secret-setting-never-expose",
      "snapshot_checksum",
      "created_at",
      "updated_at",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    const uuidValues = serialized.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
    );
    expect(new Set(uuidValues)).toEqual(
      new Set([ids.activeLocation, ids.inactiveLocation]),
    );
  });

  it("preserves archived identities, stable graph meaning, and allow-listed field settings", () => {
    const projected = projectAiBusinessModelContext(source()).modelContext;
    const customer = projected.objects.find(({ key }) => key === "customer");
    const legacy = customer?.fields.find(({ key }) => key === "legacy_note");
    const productStatus = projected.objects
      .find(({ key }) => key === "product")
      ?.fields.find(({ key }) => key === "status");

    expect(customer).toMatchObject({ is_active: true });
    expect(legacy).toEqual(
      expect.objectContaining({
        key: "legacy_note",
        is_active: false,
        has_default: true,
        settings: {},
      }),
    );
    expect(productStatus?.settings).toEqual({
      options: ["Active", "Inactive"],
    });
    expect(projected.relationships).toContainEqual(
      expect.objectContaining({
        key: "customer_places_order",
        source_object_key: "customer",
        target_object_key: "order",
      }),
    );
  });

  it("preserves safe View, Form, Page, preorder, and Location structure", () => {
    const projected = projectAiBusinessModelContext(source()).modelContext;

    expect(projected.views[0]).toMatchObject({
      key: "orders",
      view_type: "table",
      configuration: {
        fields: ["dietary_requirements"],
        include_archived: false,
      },
    });
    expect(projected.forms[0]).toMatchObject({
      fields: [
        {
          field: "name",
          label: "Your name",
          help_text: "How should we address you?",
          hidden: false,
          has_default: false,
        },
        {
          field: "legacy_note",
          hidden: true,
          has_default: true,
        },
      ],
    });
    expect(projected.pages[0]?.blocks).toContainEqual({
      type: "image",
      src: "https://example.test/preorder.jpg",
      alt: "A boxed preorder",
    });
    expect(projected.pages[0]?.blocks).toContainEqual({
      type: "button",
      label: "Contact us",
      href: "mailto:hello@example.test",
      style: "secondary",
    });

    const preorder = projected.preorder_experiences[0];
    expect(preorder).toMatchObject({
      schedule: { cutoff_hours: 48, slot_capacity: 10 },
      field_mappings: { order: { total: "total" } },
      public_fields: [
        { field: "name", required: true },
        { field: "dietary_requirements", required: false },
      ],
      allowed_locations: [
        {
          reference: ids.activeLocation,
          association_is_active: true,
          location_is_active: true,
        },
      ],
    });
    expect(
      projected.objects
        .find(({ key }) => key === "customer")
        ?.fields.find(({ key }) => key === "name")?.required,
    ).toBe(true);
    expect(preorder?.public_fields[1]?.required).toBe(false);
    expect(
      projected.locations.map(({ name, is_active }) => [name, is_active]),
    ).toEqual([
      ["Bedford", true],
      ["York", false],
    ]);
  });

  it("describes only current authoritative capabilities and separates change lanes", () => {
    const capabilities =
      projectAiBusinessModelContext(source()).modelContext
        .platform_capabilities;

    expect(capabilities.field_types).toEqual(
      [...authoritativeFieldTypes].sort(),
    );
    expect(capabilities.relationship_cardinalities).toEqual(
      [...authoritativeRelationshipCardinalities].sort(),
    );
    expect(capabilities.view_types).toEqual([...authoritativeViewTypes].sort());
    expect(capabilities.form_modes).toEqual([...authoritativeFormModes].sort());
    expect(capabilities.page_block_types).toEqual(
      [...authoritativePageBlockTypes].sort(),
    );
    expect(capabilities.configuration_operation_names).toEqual(
      [...authoritativeConfigurationOperationNames].sort(),
    );
    expect(capabilities.unavailable).toEqual({
      workflows: true,
      rules: true,
      arbitrary_code: true,
    });
    expect(capabilities.change_lanes).toEqual([
      expect.objectContaining({ name: "configuration" }),
      expect.objectContaining({ name: "operational" }),
    ]);
  });

  it("fails closed for missing Location references and for an oversized context without truncation", () => {
    const inconsistent = source();
    inconsistent.locations = inconsistent.locations.filter(
      ({ reference }) => reference !== ids.activeLocation,
    );
    expect(() => projectAiBusinessModelContext(inconsistent)).toThrowError(
      expect.objectContaining({ code: "ai_context_inconsistent" }),
    );

    const valid = projectAiBusinessModelContext(source());
    expect(() =>
      projectAiBusinessModelContext(source(), {
        maxBytes: valid.serializedBytes - 1,
      }),
    ).toThrowError(expect.objectContaining({ code: "ai_context_too_large" }));
  });

  it("serializes errors without their cause or raw context", () => {
    const secret = "context-secret-marker-never-expose";
    const error = new AiBusinessContextError("ai_context_inconsistent", {
      cause: { rawContext: source(), secret },
    });
    const serialized = JSON.stringify(error);

    expect(serialized).toBe(
      JSON.stringify({
        code: "ai_context_inconsistent",
        message: "This Business context could not be assembled safely.",
      }),
    );
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(ids.business);
  });
});

describe("AI Business context source boundaries", () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = path.resolve(testDirectory, "..");
  const projectorSource = fs.readFileSync(
    path.join(repositoryRoot, "src", "ai", "context", "projector.ts"),
    "utf8",
  );
  const loaderSource = fs.readFileSync(
    path.join(
      repositoryRoot,
      "src",
      "core",
      "configuration",
      "builder-context-source.ts",
    ),
    "utf8",
  );

  it("keeps I/O, mutation, provider execution, and accounting outside the pure projector", () => {
    expect(projectorSource).not.toMatch(
      /@supabase\/supabase-js|ConfigurationChangeService|createAdminClient|service[_-]?role|\.from\(|\.rpc\(|provider|reserve|settle/i,
    );
  });

  it("keeps the authenticated loader read-only and session-bound", () => {
    expect(loaderSource).toMatch(/auth\.getClaims\(\)/);
    expect(loaderSource).not.toMatch(
      /createAdminClient|service[_-]?role|proposeChangeSet|validateChangeSet|applyChangeSet|abandonChangeSet|prepareRollback|reserve|settle|create_graph_record|create_location|submit_public_preorder/i,
    );
  });
});
