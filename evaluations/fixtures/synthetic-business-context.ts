import {
  AI_BUSINESS_CONTEXT_MAX_BYTES,
  aiBusinessModelContextV1Schema,
  authoritativeConfigurationOperationNames,
  authoritativeFieldTypes,
  authoritativeFormModes,
  authoritativePageBlockTypes,
  authoritativeRelationshipCardinalities,
  authoritativeViewTypes,
  type AiBusinessModelContextV1,
} from "../../src/ai/context/schemas";
import { serializeAiBusinessModelContext } from "../../src/ai/context/projector";

export const SYNTHETIC_LOCATION_REFERENCES = Object.freeze({
  bedford: "11111111-1111-4111-8111-111111111111",
  miltonKeynes: "22222222-2222-4222-8222-222222222222",
});

const field = (
  key: string,
  label: string,
  fieldType:
    | "short_text"
    | "long_text"
    | "number"
    | "boolean"
    | "date"
    | "datetime"
    | "email"
    | "phone"
    | "currency"
    | "url"
    | "select"
    | "multi_select"
    | "status",
  position: number,
  options: {
    required?: boolean;
    settings?: { options?: string[]; currency?: string };
    hasDefault?: boolean;
  } = {},
) => ({
  key,
  label,
  field_type: fieldType,
  required: options.required ?? false,
  position,
  is_active: true,
  has_default: options.hasDefault ?? false,
  settings: options.settings ?? {},
});

const contextValue = {
  schema_version: 1,
  business: {
    name: "Synthetic Lantern Bakery",
    business_type: "bakery and local food business",
    timezone: "Europe/London",
  },
  access: {
    role: "owner",
    capabilities: ["manage_configuration"],
  },
  active_configuration: {
    version_number: 2,
    revision: 2,
  },
  locations: [
    {
      reference: SYNTHETIC_LOCATION_REFERENCES.bedford,
      name: "Bedford",
      timezone: "Europe/London",
      is_active: true,
    },
    {
      reference: SYNTHETIC_LOCATION_REFERENCES.miltonKeynes,
      name: "Milton Keynes",
      timezone: "Europe/London",
      is_active: true,
    },
  ],
  objects: [
    {
      key: "customer",
      singular_label: "Customer",
      plural_label: "Customers",
      description: "People and organisations who place orders.",
      kind: "custom",
      semantic_type: "customer",
      icon: "users",
      is_active: true,
      fields: [
        field("name", "Name", "short_text", 0, { required: true }),
        field("email", "Email", "email", 1, { required: true }),
        field("phone", "Phone", "phone", 2, { required: true }),
      ],
    },
    {
      key: "order",
      singular_label: "Order",
      plural_label: "Orders",
      description: "Customer orders prepared for collection.",
      kind: "custom",
      semantic_type: "order",
      icon: "clipboard",
      is_active: true,
      fields: [
        field("public_reference", "Reference", "short_text", 0, {
          required: true,
        }),
        field("status", "Status", "status", 1, {
          required: true,
          hasDefault: true,
          settings: { options: ["New", "Preparing", "Ready", "Collected"] },
        }),
        field("collection_at", "Collection time", "datetime", 2, {
          required: true,
        }),
        field(
          "collection_local_display",
          "Collection time display",
          "short_text",
          3,
          { required: true },
        ),
        field("collection_timezone", "Collection timezone", "short_text", 4, {
          required: true,
        }),
        field(
          "collection_location_name",
          "Collection Location",
          "short_text",
          5,
          { required: true },
        ),
        field("customer_name", "Customer name", "short_text", 6, {
          required: true,
        }),
        field("customer_email", "Customer email", "email", 7, {
          required: true,
        }),
        field("customer_phone", "Customer phone", "phone", 8),
        field("item_summary", "Items", "long_text", 9, { required: true }),
        field("total", "Total", "currency", 10, {
          required: true,
          settings: { currency: "GBP" },
        }),
        field("dietary_requirements", "Dietary requirements", "long_text", 11),
      ],
    },
    {
      key: "order_item",
      singular_label: "Order Item",
      plural_label: "Order Items",
      description: "A selected Product and quantity within an Order.",
      kind: "custom",
      semantic_type: null,
      icon: "list",
      is_active: true,
      fields: [
        field("product_name", "Product name", "short_text", 0, {
          required: true,
        }),
        field("quantity", "Quantity", "number", 1, { required: true }),
        field("unit_price", "Unit price", "currency", 2, {
          required: true,
          settings: { currency: "GBP" },
        }),
        field("line_total", "Line total", "currency", 3, {
          required: true,
          settings: { currency: "GBP" },
        }),
      ],
    },
    {
      key: "product",
      singular_label: "Product",
      plural_label: "Products",
      description: "Food products offered for preorder.",
      kind: "custom",
      semantic_type: "product",
      icon: "box",
      is_active: true,
      fields: [
        field("name", "Name", "short_text", 0, { required: true }),
        field("description", "Description", "long_text", 1, {
          required: true,
        }),
        field("price", "Price", "currency", 2, {
          required: true,
          settings: { currency: "GBP" },
        }),
        field("image", "Image", "url", 3),
        field("status", "Status", "status", 4, {
          required: true,
          hasDefault: true,
          settings: { options: ["Active", "Inactive"] },
        }),
      ],
    },
  ],
  relationships: [
    {
      key: "customer_places_order",
      source_object_key: "customer",
      target_object_key: "order",
      source_label: "places",
      target_label: "customer",
      cardinality: "one_to_many",
      is_required: true,
      is_active: true,
    },
    {
      key: "order_contains_order_item",
      source_object_key: "order",
      target_object_key: "order_item",
      source_label: "contains",
      target_label: "order",
      cardinality: "one_to_many",
      is_required: true,
      is_active: true,
    },
    {
      key: "product_appears_in_order_item",
      source_object_key: "product",
      target_object_key: "order_item",
      source_label: "appears in",
      target_label: "product",
      cardinality: "one_to_many",
      is_required: true,
      is_active: true,
    },
  ],
  views: [
    {
      key: "orders",
      name: "Orders",
      object_key: "order",
      audience: "internal",
      is_active: true,
      view_type: "table",
      configuration: {
        fields: [
          "public_reference",
          "collection_local_display",
          "customer_name",
          "status",
          "total",
        ],
        title_field: "public_reference",
        edit_form_key: "edit_order",
        include_archived: false,
      },
    },
    {
      key: "order_details",
      name: "Order details",
      object_key: "order",
      audience: "internal",
      is_active: true,
      view_type: "detail",
      configuration: {
        fields: [
          "public_reference",
          "collection_local_display",
          "collection_location_name",
          "customer_name",
          "customer_email",
          "customer_phone",
          "item_summary",
          "dietary_requirements",
          "total",
          "status",
        ],
        title_field: "public_reference",
        edit_form_key: "edit_order",
        include_archived: false,
      },
    },
  ],
  forms: [
    {
      key: "edit_order",
      name: "Edit Order",
      object_key: "order",
      mode: "edit",
      audience: "internal",
      is_active: true,
      fields: [
        {
          field: "status",
          label: "Order status",
          hidden: false,
          has_default: false,
        },
        {
          field: "dietary_requirements",
          hidden: false,
          has_default: false,
        },
      ],
      submit_label: "Save order",
    },
    {
      key: "customer_contact",
      name: "Customer contact",
      object_key: "customer",
      mode: "create",
      audience: "public",
      is_active: true,
      fields: [
        { field: "name", hidden: false, has_default: false },
        { field: "email", hidden: false, has_default: false },
        { field: "phone", hidden: false, has_default: false },
      ],
      submit_label: "Send details",
    },
  ],
  pages: [
    {
      key: "contact",
      title: "Contact us",
      slug: "contact",
      audience: "public",
      status: "draft",
      is_active: true,
      blocks: [
        { type: "heading", text: "Contact us", level: 1 },
        { type: "form", form_key: "customer_contact" },
      ],
    },
    {
      key: "preorder",
      title: "Preorder",
      slug: "preorder",
      audience: "public",
      status: "published",
      is_active: true,
      blocks: [
        { type: "heading", text: "Order for collection", level: 1 },
        {
          type: "text",
          text: "Choose food and a collection time.",
        },
        { type: "preorder", preorder_key: "bakery_preorder" },
      ],
    },
  ],
  preorder_experiences: [
    {
      key: "bakery_preorder",
      product_object_key: "product",
      customer_object_key: "customer",
      order_object_key: "order",
      order_item_object_key: "order_item",
      customer_places_order_relationship_key: "customer_places_order",
      order_contains_item_relationship_key: "order_contains_order_item",
      product_appears_in_item_relationship_key: "product_appears_in_order_item",
      schedule: {
        days_of_week: [5, 6, 7],
        start_time: "10:00",
        end_time: "16:00",
        slot_interval_minutes: 30,
        slot_capacity: 10,
        cutoff_hours: 48,
        booking_horizon_days: 60,
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
        customer: {
          name: "name",
          email: "email",
          phone: "phone",
        },
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
          target: "customer",
          field: "name",
          label: "Your name",
          required: true,
          autocomplete: "name",
        },
        {
          target: "customer",
          field: "email",
          label: "Email",
          required: true,
          autocomplete: "email",
        },
        {
          target: "customer",
          field: "phone",
          label: "Phone",
          required: true,
          autocomplete: "tel",
        },
        {
          target: "order",
          field: "dietary_requirements",
          label: "Dietary requirements",
          required: false,
          help_text: "Share anything the kitchen should know.",
          autocomplete: "off",
        },
      ],
      is_active: true,
      allowed_locations: [
        {
          reference: SYNTHETIC_LOCATION_REFERENCES.bedford,
          name: "Bedford",
          timezone: "Europe/London",
          association_is_active: true,
          location_is_active: true,
        },
        {
          reference: SYNTHETIC_LOCATION_REFERENCES.miltonKeynes,
          name: "Milton Keynes",
          timezone: "Europe/London",
          association_is_active: true,
          location_is_active: true,
        },
      ],
    },
  ],
  platform_capabilities: {
    registry_version: 1,
    field_types: [...authoritativeFieldTypes].sort(),
    relationship_cardinalities: [
      ...authoritativeRelationshipCardinalities,
    ].sort(),
    view_types: [...authoritativeViewTypes].sort(),
    form_modes: [...authoritativeFormModes].sort(),
    page_block_types: [...authoritativePageBlockTypes].sort(),
    configuration_operation_names: [
      ...authoritativeConfigurationOperationNames,
    ].sort(),
    reusable_capabilities: [
      "configuration_candidate_preview",
      "configured_views_forms_pages",
      "generic_graph",
      "generic_record_connections",
      "generic_records",
      "immutable_configuration_versions",
      "manual_preorder_question_amendments",
      "manual_preorder_schedule_amendments",
      "published_public_pages",
      "record_to_location_connections",
      "trusted_public_preorder",
    ],
    unavailable: {
      workflows: true,
      rules: true,
      arbitrary_code: true,
    },
    change_lanes: [
      {
        name: "configuration",
        supports: [
          "objects",
          "fields",
          "relationships",
          "views",
          "forms",
          "pages",
          "preorder_experiences",
        ],
        mechanism: "proposal_preview_validation_deliberate_application",
      },
      {
        name: "operational",
        supports: ["records", "locations", "record_to_location_connections"],
        mechanism: "narrow_deterministic_services",
      },
    ],
  },
};

export const syntheticBusinessContext: AiBusinessModelContextV1 = Object.freeze(
  aiBusinessModelContextV1Schema.parse(contextValue),
);

export const SYNTHETIC_BUSINESS_CONTEXT_BYTES = new TextEncoder().encode(
  serializeAiBusinessModelContext(syntheticBusinessContext),
).byteLength;

if (SYNTHETIC_BUSINESS_CONTEXT_BYTES > AI_BUSINESS_CONTEXT_MAX_BYTES) {
  throw new RangeError("The synthetic evaluation context is too large.");
}
