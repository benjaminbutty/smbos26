import type { ConfigurationSnapshotV1 } from "../../src/core/configuration/definition-source";
import type { AiBusinessContextSource } from "../../src/ai/context/projector";
import { projectAiBusinessModelContext } from "../../src/ai/context/projector";
import type { AuthoritativeAiBusinessContext } from "../../src/core/configuration/builder-context-source";
import {
  builderPlanOutputSchema,
  type BuilderPlanOutput,
} from "../../src/ai/planning/schemas";
import {
  builderPreorderAmendmentOutputSchema,
  builderPreorderAmendmentTaskInputBaseSchema,
  type BuilderPreorderAmendmentOutput,
  type BuilderPreorderAmendmentTaskInput,
} from "../../src/ai/preorder-amendment/schemas";

export const preorderAmendmentFixtureIds = {
  actor: "70000000-0000-4000-8000-000000000001",
  business: "70000000-0000-4000-8000-000000000002",
  version: "70000000-0000-4000-8000-000000000003",
  proposal: "70000000-0000-4000-8000-000000000004",
  location: "70000000-0000-4000-8000-000000000005",
  preorder: "70000000-0000-4000-8000-000000000006",
  product: "70000000-0000-4000-8000-000000000007",
  customer: "70000000-0000-4000-8000-000000000008",
  order: "70000000-0000-4000-8000-000000000009",
  orderItem: "70000000-0000-4000-8000-000000000010",
} as const;

function object(
  id: string,
  key: string,
  singularLabel: string,
  semanticType: string,
): ConfigurationSnapshotV1["object_definitions"][number] {
  return {
    id,
    key,
    singular_label: singularLabel,
    plural_label: `${singularLabel}s`,
    description: `${singularLabel} fixture.`,
    kind: "template",
    semantic_type: semanticType,
    icon: null,
    is_active: true,
  };
}

function field(
  id: string,
  objectId: string,
  objectKey: string,
  key: string,
  label: string,
  fieldType: ConfigurationSnapshotV1["field_definitions"][number]["field_type"],
  required: boolean,
  position: number,
): ConfigurationSnapshotV1["field_definitions"][number] {
  return {
    id,
    object_definition_id: objectId,
    object_key: objectKey,
    key,
    label,
    field_type: fieldType,
    required,
    default_value: null,
    settings_json: {},
    position,
    is_active: true,
  };
}

const preorderConfig = {
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
      label: "Name",
      required: true,
      autocomplete: "name" as const,
    },
    {
      target: "customer" as const,
      field: "email",
      label: "Email",
      required: true,
      autocomplete: "email" as const,
    },
    {
      target: "customer" as const,
      field: "phone",
      label: "Phone",
      required: true,
      help_text: "We will only call about your order.",
      autocomplete: "tel" as const,
    },
    {
      target: "order" as const,
      field: "dietary_requirements",
      label: "Dietary requirements",
      required: false,
      help_text: "Tell us about dietary needs.",
      autocomplete: "off" as const,
    },
  ],
};

export function preorderAmendmentSnapshot(): ConfigurationSnapshotV1 {
  const ids = preorderAmendmentFixtureIds;
  return {
    schema_version: 1,
    object_definitions: [
      object(ids.product, "product", "Product", "product"),
      object(ids.customer, "customer", "Customer", "customer"),
      object(ids.order, "order", "Order", "order"),
      object(ids.orderItem, "order_item", "Order item", "order_item"),
    ],
    field_definitions: [
      field(
        "70000000-0000-4000-8000-000000000015",
        ids.customer,
        "customer",
        "name",
        "Name",
        "short_text",
        true,
        0,
      ),
      field(
        "70000000-0000-4000-8000-000000000016",
        ids.customer,
        "customer",
        "email",
        "Email",
        "email",
        true,
        1,
      ),
      field(
        "70000000-0000-4000-8000-000000000017",
        ids.customer,
        "customer",
        "phone",
        "Phone",
        "phone",
        true,
        2,
      ),
      field(
        "70000000-0000-4000-8000-000000000018",
        ids.order,
        "order",
        "dietary_requirements",
        "Dietary requirements",
        "long_text",
        false,
        0,
      ),
    ],
    relationship_definitions: [],
    views: [],
    forms: [],
    pages: [],
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
          "70000000-0000-4000-8000-000000000011",
        customer_places_order_relationship_key: "customer_places_order",
        order_contains_item_relationship_definition_id:
          "70000000-0000-4000-8000-000000000012",
        order_contains_item_relationship_key: "order_contains_order_item",
        product_appears_in_item_relationship_definition_id:
          "70000000-0000-4000-8000-000000000013",
        product_appears_in_item_relationship_key:
          "product_appears_in_order_item",
        config_json: structuredClone(preorderConfig),
        is_active: true,
      },
    ],
    preorder_experience_locations: [
      {
        id: "70000000-0000-4000-8000-000000000014",
        preorder_experience_id: ids.preorder,
        preorder_key: "bakery_preorder",
        location_id: ids.location,
        is_active: true,
      },
    ],
  };
}

export function preorderAmendmentSource(
  snapshot: ConfigurationSnapshotV1 = preorderAmendmentSnapshot(),
): AiBusinessContextSource {
  const ids = preorderAmendmentFixtureIds;
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
      versionNumber: 1,
      revision: 1,
      snapshot,
    },
    locations: [
      {
        reference: ids.location,
        name: "Bedford",
        timezone: "Europe/London",
        isActive: true,
      },
    ],
  };
}

export function preorderAmendmentAuthoritative(
  overrides: {
    source?: AiBusinessContextSource;
    businessId?: string;
    actorId?: string;
    baseVersionId?: string;
    headRevision?: number;
  } = {},
): AuthoritativeAiBusinessContext {
  const ids = preorderAmendmentFixtureIds;
  return {
    executionContext: {
      businessId: overrides.businessId ?? ids.business,
      actorId: overrides.actorId ?? ids.actor,
    },
    currentness: {
      baseVersionId: overrides.baseVersionId ?? ids.version,
      headRevision: overrides.headRevision ?? 1,
    },
    source: overrides.source ?? preorderAmendmentSource(),
  };
}

export function preorderAmendmentReadyPlan(): Extract<
  BuilderPlanOutput,
  { state: "ready" }
> {
  const parsed = builderPlanOutputSchema.parse({
    schema_version: 1,
    state: "ready",
    understanding: "The owner wants a bounded preorder amendment.",
    assumptions: [],
    plan: {
      outcome: "The owner can review the proposed preorder changes.",
      concepts: [],
      user_journeys: [],
      steps: [
        {
          reference: "step_1",
          sequence: 1,
          summary: "Update the existing preorder configuration.",
          dependencies: [],
          affected_concepts: [],
          existing_object_keys: ["customer", "order"],
          location_references: [],
          materiality: "low",
          requires_owner_confirmation: true,
          lane: "configuration",
          category: "configure_preorder",
        },
      ],
    },
    unsupported_requirements: [],
  });
  if (parsed.state !== "ready") {
    throw new Error("Expected a ready preorder amendment plan.");
  }
  return parsed;
}

export function preorderAmendmentDraft(
  overrides: Partial<BuilderPreorderAmendmentOutput> = {},
): BuilderPreorderAmendmentOutput {
  return builderPreorderAmendmentOutputSchema.parse({
    schema_version: 1,
    summary: "Make the phone question optional.",
    preorder_key: "bakery_preorder",
    amendments: [
      {
        type: "set_existing_question_requiredness",
        target: "customer",
        field_key: "phone",
        required: false,
        source_step_references: ["step_1"],
      },
    ],
    ...overrides,
  });
}

export function preorderAmendmentTaskInput(
  authoritative: AuthoritativeAiBusinessContext = preorderAmendmentAuthoritative(),
  overrides: {
    ownerRequest?: string;
    preorderScope?: {
      preorder_key: string;
      selection: "sole_active" | "explicit_request";
    };
  } = {},
): BuilderPreorderAmendmentTaskInput {
  return builderPreorderAmendmentTaskInputBaseSchema.parse({
    schema_version: 1,
    owner_request:
      overrides.ownerRequest ?? "Make the phone question optional.",
    business_context: projectAiBusinessModelContext(authoritative.source)
      .modelContext,
    ready_plan: preorderAmendmentReadyPlan(),
    preorder_scope: overrides.preorderScope ?? {
      preorder_key: "bakery_preorder",
      selection: "sole_active",
    },
  });
}
