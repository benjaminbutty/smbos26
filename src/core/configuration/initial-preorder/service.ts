import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Tables } from "../../../db/supabase/database.types";
import {
  configurationSnapshotV1Schema,
  type ConfigurationSnapshotV1,
} from "../definition-source";
import {
  configurationOperationsSchema,
  type ConfigurationOperation,
} from "../schemas";
import { ConfigurationChangeService } from "../service";
import {
  preorderConfigSchema,
  preorderScheduleSchema,
  type PreorderConfig,
} from "../../preorder/schemas";
import {
  initialPreorderSetupRequestSchema,
  type InitialPreorderSetupRequest,
} from "./schemas";

type SessionClient = SupabaseClient<Database>;
type ConfigurationChangeSet = Tables<"configuration_change_sets">;
type ConfigurationObject = Extract<
  ConfigurationOperation,
  { op: "set_object" }
>;
type ConfigurationField = Extract<ConfigurationOperation, { op: "set_field" }>;
type PreorderSchedule = z.infer<typeof preorderScheduleSchema>;

const starterPreorderKey = "preorder";

export const initialPreorderSetupErrorCodes = [
  "initial_preorder_no_active_locations",
  "initial_preorder_location_unavailable",
  "initial_preorder_already_installed",
  "initial_preorder_business_not_clean",
  "initial_preorder_stale",
] as const;

export type InitialPreorderSetupErrorCode =
  (typeof initialPreorderSetupErrorCodes)[number];

const ownerMessages: Readonly<Record<InitialPreorderSetupErrorCode, string>> = {
  initial_preorder_no_active_locations:
    "Add at least one active Location before setting up preorders.",
  initial_preorder_location_unavailable:
    "One of the selected collection Locations is no longer active. Reload and choose from the current Locations.",
  initial_preorder_already_installed:
    "This Business already has a preorder setup. Open the existing setup to make a change.",
  initial_preorder_business_not_clean:
    "The initial preorder starter is available only for a clean Business. Existing configuration was left unchanged.",
  initial_preorder_stale:
    "Setup changed after this page was loaded. Reload and try again.",
};

export class InitialPreorderSetupError extends Error {
  readonly code: InitialPreorderSetupErrorCode;
  override readonly cause: unknown;

  constructor(code: InitialPreorderSetupErrorCode, cause?: unknown) {
    super(ownerMessages[code]);
    this.name = "InitialPreorderSetupError";
    this.code = code;
    this.cause = cause;
  }
}

export function initialPreorderSetupOwnerMessage(
  code: InitialPreorderSetupErrorCode,
): string {
  return ownerMessages[code];
}

export type InitialPreorderStarterState =
  "ready" | "no_active_locations" | "already_installed" | "business_not_clean";

function hasAnyConfiguration(snapshot: ConfigurationSnapshotV1): boolean {
  return [
    snapshot.object_definitions,
    snapshot.field_definitions,
    snapshot.relationship_definitions,
    snapshot.views,
    snapshot.forms,
    snapshot.pages,
    snapshot.preorder_experiences,
    snapshot.preorder_experience_locations,
  ].some((collection) => collection.length > 0);
}

export function getInitialPreorderStarterState(
  snapshotInput: ConfigurationSnapshotV1,
  activeLocationCount: number,
): InitialPreorderStarterState {
  const snapshot = configurationSnapshotV1Schema.parse(snapshotInput);
  if (
    snapshot.preorder_experiences.some(
      (preorder) => preorder.key === starterPreorderKey,
    )
  ) {
    return "already_installed";
  }
  if (hasAnyConfiguration(snapshot)) {
    return "business_not_clean";
  }
  if (activeLocationCount < 1) {
    return "no_active_locations";
  }
  return "ready";
}

function assertInitialPreorderSnapshotEligible(
  snapshot: ConfigurationSnapshotV1,
): void {
  const state = getInitialPreorderStarterState(snapshot, 1);
  if (state === "already_installed") {
    throw new InitialPreorderSetupError("initial_preorder_already_installed");
  }
  if (state === "business_not_clean") {
    throw new InitialPreorderSetupError("initial_preorder_business_not_clean");
  }
}

function field(
  objectKey: string,
  key: string,
  label: string,
  fieldType: ConfigurationField["field_type"],
  required: boolean,
  position: number,
  options: {
    defaultValue?: ConfigurationField["default_value"];
    settings?: ConfigurationField["settings_json"];
  } = {},
): ConfigurationField {
  return {
    op: "set_field",
    object_key: objectKey,
    key,
    label,
    field_type: fieldType,
    required,
    default_value: options.defaultValue ?? null,
    settings_json: options.settings ?? {},
    position,
    is_active: true,
  };
}

function neutralPreorderConfig(schedule: PreorderSchedule): PreorderConfig {
  return preorderConfigSchema.parse({
    schedule,
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
        target: "customer",
        field: "name",
        label: "Name",
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
        required: false,
        help_text: "Optional",
        autocomplete: "tel",
      },
    ],
  });
}

function productFormFields() {
  return [
    { field: "name", hidden: false },
    { field: "description", hidden: false },
    { field: "price", hidden: false },
    { field: "image", hidden: false, help_text: "Optional image URL." },
    { field: "status", hidden: false },
  ];
}

function productDetailFields() {
  return ["name", "description", "image", "price", "status"];
}

export function composeInitialPreorderOperations(
  input: InitialPreorderSetupRequest,
): ConfigurationOperation[] {
  const parsed = initialPreorderSetupRequestSchema.parse(input);
  const schedule = {
    ...parsed.schedule,
    days_of_week: parsed.schedule.days_of_week.toSorted(
      (left, right) => left - right,
    ),
  };
  const config = neutralPreorderConfig(schedule);
  const operations: ConfigurationOperation[] = [
    {
      op: "set_object",
      key: "customer",
      singular_label: "Customer",
      plural_label: "Customers",
      description: "People who place preorders",
      icon: null,
      is_active: true,
    } satisfies ConfigurationObject,
    {
      op: "set_object",
      key: "product",
      singular_label: "Product",
      plural_label: "Products",
      description: "Items customers can preorder",
      icon: null,
      is_active: true,
    } satisfies ConfigurationObject,
    {
      op: "set_object",
      key: "order",
      singular_label: "Order",
      plural_label: "Orders",
      description: "Customer collection orders",
      icon: null,
      is_active: true,
    } satisfies ConfigurationObject,
    {
      op: "set_object",
      key: "order_item",
      singular_label: "Order Item",
      plural_label: "Order Items",
      description: "Products within an order",
      icon: null,
      is_active: true,
    } satisfies ConfigurationObject,
    field("customer", "name", "Name", "short_text", true, 0),
    field("customer", "email", "Email", "email", true, 1),
    field("customer", "phone", "Phone", "phone", false, 2),
    field("product", "name", "Name", "short_text", true, 0),
    field("product", "description", "Description", "long_text", true, 1),
    field("product", "price", "Price", "currency", true, 2),
    field("product", "image", "Image", "file", false, 3),
    field("product", "status", "Status", "status", true, 4, {
      defaultValue: "Active",
      settings: { options: ["Active", "Inactive"] },
    }),
    field("order", "public_reference", "Reference", "short_text", true, 0),
    field("order", "status", "Status", "status", true, 1, {
      defaultValue: "New",
      settings: {
        options: ["New", "Confirmed", "Ready", "Collected", "Cancelled"],
      },
    }),
    field(
      "order",
      "collection_at",
      "Collection Timestamp",
      "datetime",
      true,
      2,
    ),
    field(
      "order",
      "collection_local_display",
      "Collection",
      "short_text",
      true,
      3,
    ),
    field(
      "order",
      "collection_timezone",
      "Collection Timezone",
      "short_text",
      true,
      4,
    ),
    field(
      "order",
      "collection_location_name",
      "Collection Location",
      "short_text",
      true,
      5,
    ),
    field("order", "customer_name", "Customer", "short_text", true, 6),
    field("order", "customer_email", "Customer Email", "email", true, 7),
    field("order", "customer_phone", "Customer Phone", "phone", false, 8),
    field("order", "item_summary", "Items", "long_text", true, 9),
    field("order", "total", "Total", "currency", true, 10),
    field("order_item", "product_name", "Product", "short_text", true, 0),
    field("order_item", "quantity", "Quantity", "number", true, 1),
    field("order_item", "unit_price", "Unit Price", "currency", true, 2),
    field("order_item", "line_total", "Line Total", "currency", true, 3),
    {
      op: "set_relationship",
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
      op: "set_relationship",
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
      op: "set_relationship",
      key: "product_appears_in_order_item",
      source_object_key: "product",
      target_object_key: "order_item",
      source_label: "appears in",
      target_label: "product",
      cardinality: "one_to_many",
      is_required: true,
      is_active: true,
    },
    {
      op: "set_form",
      key: "product_create",
      name: "Add product",
      object_key: "product",
      mode: "create",
      config_json: {
        fields: productFormFields(),
        submit_label: "Save product",
      },
      audience: "internal",
      is_active: true,
    },
    {
      op: "set_form",
      key: "product_edit",
      name: "Edit product",
      object_key: "product",
      mode: "edit",
      config_json: {
        fields: productFormFields(),
        submit_label: "Save product",
      },
      audience: "internal",
      is_active: true,
    },
    {
      op: "set_form",
      key: "order_status_edit",
      name: "Update order status",
      object_key: "order",
      mode: "edit",
      config_json: {
        fields: [
          {
            field: "status",
            hidden: false,
            help_text: "Keep the collection team up to date.",
          },
        ],
        submit_label: "Save status",
      },
      audience: "internal",
      is_active: true,
    },
    {
      op: "set_view",
      key: "product_detail",
      name: "Product",
      view_type: "detail",
      object_key: "product",
      config_json: {
        fields: productDetailFields(),
        title_field: "name",
        edit_form_key: "product_edit",
        include_archived: false,
      },
      audience: "internal",
      is_active: true,
    },
    {
      op: "set_view",
      key: "products",
      name: "Products",
      view_type: "table",
      object_key: "product",
      config_json: {
        fields: ["name", "description", "price", "status"],
        title_field: "name",
        create_form_key: "product_create",
        edit_form_key: "product_edit",
        include_archived: false,
      },
      audience: "internal",
      is_active: true,
    },
    {
      op: "set_view",
      key: "order_detail",
      name: "Order",
      view_type: "detail",
      object_key: "order",
      config_json: {
        fields: [
          "public_reference",
          "status",
          "customer_name",
          "customer_email",
          "customer_phone",
          "collection_location_name",
          "collection_local_display",
          "collection_timezone",
          "item_summary",
          "total",
        ],
        title_field: "public_reference",
        edit_form_key: "order_status_edit",
        include_archived: false,
      },
      audience: "internal",
      is_active: true,
    },
    {
      op: "set_view",
      key: "orders",
      name: "Orders",
      view_type: "table",
      object_key: "order",
      config_json: {
        fields: [
          "public_reference",
          "customer_name",
          "collection_location_name",
          "collection_local_display",
          "item_summary",
          "total",
          "status",
        ],
        title_field: "public_reference",
        edit_form_key: "order_status_edit",
        include_archived: false,
      },
      audience: "internal",
      is_active: true,
    },
    {
      op: "set_page",
      key: "products_workspace",
      title: "Products",
      slug: "products",
      audience: "internal",
      layout_json: {
        blocks: [
          { type: "heading", text: "Products", level: 1 },
          { type: "view", view_key: "products" },
        ],
      },
      status: "draft",
      is_active: true,
    },
    {
      op: "set_page",
      key: "orders_workspace",
      title: "Orders",
      slug: "orders",
      audience: "internal",
      layout_json: {
        blocks: [
          { type: "heading", text: "Orders", level: 1 },
          { type: "view", view_key: "orders" },
        ],
      },
      status: "draft",
      is_active: true,
    },
    {
      op: "set_page",
      key: "public_preorder",
      title: "Preorder for collection",
      slug: "preorder",
      audience: "public",
      layout_json: {
        blocks: [
          { type: "heading", text: "Order ahead for collection", level: 1 },
          {
            type: "text",
            text: "Choose your items, collection Location and time.",
          },
          { type: "preorder", preorder_key: starterPreorderKey },
        ],
      },
      status: "draft",
      is_active: true,
    },
    {
      op: "set_preorder_experience",
      key: starterPreorderKey,
      product_object_key: "product",
      customer_object_key: "customer",
      order_object_key: "order",
      order_item_object_key: "order_item",
      customer_places_order_relationship_key: "customer_places_order",
      order_contains_item_relationship_key: "order_contains_order_item",
      product_appears_in_item_relationship_key: "product_appears_in_order_item",
      config_json: config,
      allowed_location_ids: parsed.locationIds.toSorted(),
      is_active: true,
    },
  ];

  return configurationOperationsSchema.parse(operations);
}

function dayNames(schedule: PreorderSchedule): string {
  const names = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ];
  return schedule.days_of_week.map((day) => names[day - 1]).join(", ");
}

function proposalDescription(
  schedule: PreorderSchedule,
  locations: ReadonlyArray<{ name: string }>,
): string {
  const locationNames = locations.map((location) => location.name).join(", ");
  return [
    `Create the initial preorder setup for collection at ${locationNames}.`,
    `Collection days: ${dayNames(schedule)}; ${schedule.start_time}–${schedule.end_time}; ${schedule.slot_interval_minutes}-minute slots; ${schedule.slot_capacity} orders per slot; ${schedule.cutoff_hours} hours' notice; ${schedule.booking_horizon_days}-day booking horizon.`,
    "Include the generic Product and Order workspace surfaces. The public preorder Page remains a draft.",
  ].join(" ");
}

export async function prepareInitialPreorderProposal(
  client: SessionClient,
  configuration: ConfigurationChangeService,
  input: InitialPreorderSetupRequest,
): Promise<ConfigurationChangeSet> {
  const parsed = initialPreorderSetupRequestSchema.parse(input);
  const currentHead = await configuration.getActiveHead();
  if (
    currentHead.active_version_id !== parsed.expectedBaseVersionId ||
    currentHead.head_revision !== parsed.expectedHeadRevision
  ) {
    throw new InitialPreorderSetupError("initial_preorder_stale");
  }

  const activeVersion = await configuration.getVersion(
    currentHead.active_version_id,
  );
  const snapshot = configurationSnapshotV1Schema.parse(
    activeVersion.snapshot_json,
  );
  assertInitialPreorderSnapshotEligible(snapshot);

  const { data: locations, error } = await client
    .from("locations")
    .select("id,name,is_active")
    .eq("business_id", currentHead.business_id)
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (error || !locations) {
    throw new Error("Could not load active collection Locations.", {
      cause: error,
    });
  }
  if (locations.length === 0) {
    throw new InitialPreorderSetupError("initial_preorder_no_active_locations");
  }

  const selectedIds = new Set(parsed.locationIds);
  const selectedLocations = locations.filter((location) =>
    selectedIds.has(location.id),
  );
  if (selectedLocations.length !== selectedIds.size) {
    throw new InitialPreorderSetupError(
      "initial_preorder_location_unavailable",
    );
  }

  const operations = composeInitialPreorderOperations({
    ...parsed,
    locationIds: selectedLocations.map((location) => location.id),
  });
  return configuration.proposeChangeSet({
    expectedBaseVersionId: currentHead.active_version_id,
    expectedHeadRevision: currentHead.head_revision,
    title: "Set up preorders",
    description: proposalDescription(parsed.schedule, selectedLocations),
    operations,
  });
}
