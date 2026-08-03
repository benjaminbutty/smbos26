import { execFileSync } from "node:child_process";
import console from "node:console";
import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import process from "node:process";
import { URL } from "node:url";

import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

import { upsertLocalAuthUser } from "./support/local-auth-retry.mjs";

const ownerEmail = "demo@smbos.local";
const staffEmail = "staff@smbos.local";
const demoPassword = "Local-demo-2026!";
const demoBusinessSlug = "bedford-bakery-demo";
const initialChangeTitle = "Install Bedford Bakery configuration";
const configurationCollections = [
  "object_definitions",
  "field_definitions",
  "relationship_definitions",
  "views",
  "forms",
  "pages",
  "preorder_experiences",
  "preorder_experience_locations",
];

function parseEnvironmentOutput(output) {
  const values = {};
  for (const line of output.split("\n")) {
    const match = /^([A-Z0-9_]+)="(.*)"$/.exec(line.trim());
    if (match?.[1] && match[2] !== undefined) {
      values[match[1]] = match[2];
    }
  }
  return values;
}

function loadLocalSupabase() {
  const executable = join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "supabase.exe" : "supabase",
  );
  const values = parseEnvironmentOutput(
    execFileSync(executable, ["status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  const apiUrl = values.API_URL;
  const serviceRoleKey = values.SERVICE_ROLE_KEY;
  const publishableKey = values.PUBLISHABLE_KEY ?? values.ANON_KEY;
  const databaseUrl = values.DB_URL;
  if (!apiUrl || !serviceRoleKey || !publishableKey || !databaseUrl) {
    throw new Error(
      "Local Supabase is not running or did not report its local credentials.",
    );
  }

  const api = new URL(apiUrl);
  const database = new URL(databaseUrl);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  if (
    api.protocol !== "http:" ||
    !localHosts.has(api.hostname) ||
    api.port !== "55321" ||
    !localHosts.has(database.hostname) ||
    database.port !== "55322"
  ) {
    throw new Error(
      "Refusing to seed: this command only operates on the SMBOS local Supabase ports.",
    );
  }

  return { apiUrl, databaseUrl, publishableKey, serviceRoleKey };
}

function requireData(result, message) {
  if (result.error || result.data === null) {
    throw result.error ?? new Error(message);
  }
  return result.data;
}

async function upsertLocalUser(admin, email) {
  return upsertLocalAuthUser({
    authAdmin: admin.auth.admin,
    email,
    password: demoPassword,
  });
}

function field(
  objectKey,
  key,
  label,
  fieldType,
  required,
  position,
  { defaultValue = null, settings = {} } = {},
) {
  return {
    op: "set_field",
    object_key: objectKey,
    key,
    label,
    field_type: fieldType,
    required,
    default_value: defaultValue,
    settings_json: settings,
    position,
    is_active: true,
  };
}

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
    {
      target: "order",
      field: "dietary_requirements",
      label: "Dietary requirements",
      required: false,
      help_text: "Tell us about allergies or dietary needs.",
      autocomplete: "off",
    },
    {
      target: "order",
      field: "occasion",
      label: "Occasion",
      required: false,
      help_text: "Optional",
      autocomplete: "off",
    },
  ],
};

function buildBedfordConfigurationOperations(locationIds) {
  return [
    {
      op: "set_object",
      key: "customer",
      singular_label: "Customer",
      plural_label: "Customers",
      description: "People who place bakery preorders",
      icon: null,
      is_active: true,
    },
    {
      op: "set_object",
      key: "order",
      singular_label: "Order",
      plural_label: "Orders",
      description: "Collection preorders",
      icon: null,
      is_active: true,
    },
    {
      op: "set_object",
      key: "order_item",
      singular_label: "Order Item",
      plural_label: "Order Items",
      description: "Immutable product snapshots within Orders",
      icon: null,
      is_active: true,
    },
    {
      op: "set_object",
      key: "product",
      singular_label: "Product",
      plural_label: "Products",
      description: "Products available to preorder",
      icon: null,
      is_active: true,
    },
    field("customer", "email", "Email", "email", true, 1),
    field("customer", "name", "Name", "short_text", true, 0),
    field("customer", "phone", "Phone", "phone", false, 2),
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
      "collection_location_name",
      "Collection Location",
      "short_text",
      true,
      5,
    ),
    field(
      "order",
      "collection_timezone",
      "Collection Timezone",
      "short_text",
      true,
      4,
    ),
    field("order", "customer_email", "Customer Email", "email", true, 7),
    field("order", "customer_name", "Customer", "short_text", true, 6),
    field("order", "customer_phone", "Customer Phone", "phone", false, 8),
    field(
      "order",
      "dietary_requirements",
      "Dietary Requirements",
      "long_text",
      false,
      9,
    ),
    field("order", "item_summary", "Items", "long_text", true, 11),
    field("order", "occasion", "Occasion", "short_text", false, 10),
    field("order", "public_reference", "Reference", "short_text", true, 0),
    field("order", "status", "Status", "status", true, 1, {
      defaultValue: "New",
      settings: {
        options: ["New", "Confirmed", "Ready", "Collected", "Cancelled"],
      },
    }),
    field("order", "total", "Total", "currency", true, 12, {
      settings: { currency: "GBP" },
    }),
    field("order_item", "line_total", "Line Total", "currency", true, 3, {
      settings: { currency: "GBP" },
    }),
    field("order_item", "product_name", "Product", "short_text", true, 0),
    field("order_item", "quantity", "Quantity", "number", true, 1),
    field("order_item", "unit_price", "Unit Price", "currency", true, 2, {
      settings: { currency: "GBP" },
    }),
    field("product", "description", "Description", "long_text", true, 1),
    field("product", "image", "Image", "file", false, 3),
    field("product", "name", "Name", "short_text", true, 0),
    field("product", "price", "Price", "currency", true, 2, {
      settings: { currency: "GBP" },
    }),
    field("product", "status", "Status", "status", true, 4, {
      defaultValue: "Active",
      settings: { options: ["Active", "Inactive"] },
    }),
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
      key: "order_status_edit",
      name: "Update order status",
      object_key: "order",
      mode: "edit",
      config_json: {
        fields: [
          {
            field: "status",
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
          "dietary_requirements",
          "occasion",
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
          {
            type: "heading",
            text: "A little celebration, boxed and ready",
            level: 1,
          },
          {
            type: "text",
            text: "Choose your favourites and collect from Bedford or Milton Keynes. We prepare every box to order.",
          },
          { type: "preorder", preorder_key: "bakery_preorder" },
        ],
      },
      status: "published",
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
      order_contains_item_relationship_key: "order_contains_order_item",
      product_appears_in_item_relationship_key: "product_appears_in_order_item",
      config_json: preorderConfig,
      allowed_location_ids: locationIds,
      is_active: true,
    },
  ];
}

function isEmptyBaseline(snapshot) {
  return (
    snapshot?.schema_version === 1 &&
    configurationCollections.every(
      (collection) =>
        Array.isArray(snapshot[collection]) &&
        snapshot[collection].length === 0,
    )
  );
}

async function ensureLocation(owner, businessId, name) {
  const existing = await owner
    .from("locations")
    .select("*")
    .eq("business_id", businessId)
    .eq("name", name);
  const rows = requireData(existing, `Could not inspect ${name}.`);
  if (rows.length > 1) {
    throw new Error(`Bedford demo has duplicate ${name} Locations.`);
  }
  if (rows[0]) {
    if (!rows[0].is_active || rows[0].timezone !== "Europe/London") {
      throw new Error(
        `${name} exists but is not an active Europe/London Location.`,
      );
    }
    return rows[0];
  }
  return requireData(
    await owner.rpc("create_location", {
      target_business_id: businessId,
      location_name: name,
      requested_timezone: "Europe/London",
    }),
    `Could not create ${name}.`,
  );
}

async function ensureConfiguredVersionTwo({
  admin,
  owner,
  ownerId,
  sql,
  businessId,
  locationIds,
}) {
  const head = requireData(
    await admin
      .from("business_configuration_heads")
      .select("*")
      .eq("business_id", businessId)
      .single(),
    "Could not inspect Bedford configuration head.",
  );
  const activeVersion = requireData(
    await admin
      .from("configuration_versions")
      .select("*")
      .eq("business_id", businessId)
      .eq("id", head.active_version_id)
      .single(),
    "Could not inspect Bedford active configuration version.",
  );

  if (activeVersion.version_number === 1) {
    if (
      head.head_revision !== 1 ||
      !isEmptyBaseline(activeVersion.snapshot_json)
    ) {
      throw new Error(
        "Bedford Version 1 must be the empty revision-1 Business baseline.",
      );
    }
    const proposed = requireData(
      await owner.rpc("propose_configuration_change", {
        expected_business_id: businessId,
        expected_actor_id: ownerId,
        expected_base_version_id: activeVersion.id,
        expected_head_revision: head.head_revision,
        requested_title: initialChangeTitle,
        requested_description:
          "Create the complete Bedford Bakery preorder and staff workspace configuration.",
        requested_operations: buildBedfordConfigurationOperations(locationIds),
      }),
      "Could not propose the Bedford configuration.",
    );
    const validated = requireData(
      await owner.rpc("validate_configuration_change", {
        expected_business_id: businessId,
        expected_actor_id: ownerId,
        requested_change_set_id: proposed.id,
      }),
      "Could not validate the Bedford configuration.",
    );
    if (validated.status !== "validated") {
      throw new Error(
        `Bedford configuration validation ended as ${validated.status}.`,
      );
    }
    const applied = requireData(
      await owner.rpc("apply_configuration_change", {
        expected_business_id: businessId,
        expected_actor_id: ownerId,
        requested_change_set_id: proposed.id,
      }),
      "Could not apply the Bedford configuration.",
    );
    if (applied.status !== "applied") {
      throw new Error(
        `Bedford configuration application ended as ${applied.status}.`,
      );
    }
  } else if (activeVersion.version_number !== 2 || head.head_revision !== 2) {
    throw new Error(
      "Bedford already has configuration history beyond the expected Version 2.",
    );
  }

  const refreshedHead = requireData(
    await admin
      .from("business_configuration_heads")
      .select("*")
      .eq("business_id", businessId)
      .single(),
    "Could not verify the Bedford configuration head.",
  );
  const versions = requireData(
    await admin
      .from("configuration_versions")
      .select("*")
      .eq("business_id", businessId)
      .order("version_number"),
    "Could not verify Bedford configuration versions.",
  );
  if (
    versions.length !== 2 ||
    versions[0]?.version_number !== 1 ||
    versions[0]?.kind !== "baseline" ||
    !isEmptyBaseline(versions[0]?.snapshot_json) ||
    versions[1]?.version_number !== 2 ||
    versions[1]?.kind !== "change" ||
    versions[1]?.parent_version_id !== versions[0]?.id ||
    versions[1]?.created_by !== ownerId ||
    refreshedHead.active_version_id !== versions[1]?.id ||
    refreshedHead.head_revision !== 2
  ) {
    throw new Error(
      "Bedford configuration history is not empty V1 → configured V2.",
    );
  }
  const changeSets = requireData(
    await admin
      .from("configuration_change_sets")
      .select("*")
      .eq("business_id", businessId)
      .eq("title", initialChangeTitle),
    "Could not verify the Bedford initial change set.",
  );
  if (
    changeSets.length !== 1 ||
    changeSets[0]?.status !== "applied" ||
    changeSets[0]?.requested_by !== ownerId ||
    changeSets[0]?.applied_version_id !== versions[1]?.id ||
    versions[1]?.source_change_set_id !== changeSets[0]?.id
  ) {
    throw new Error(
      "Bedford Version 2 is not sourced by its applied change set.",
    );
  }
  const [liveProjection] = await sql`
    select private.configuration_snapshot_v1(${businessId}::uuid) as snapshot
  `;
  if (
    !isDeepStrictEqual(liveProjection?.snapshot, versions[1]?.snapshot_json)
  ) {
    throw new Error("Bedford live projection does not equal Version 2.");
  }
  return versions[1];
}

const productFixtures = [
  {
    name: "Afternoon Tea Box",
    description: "Finger sandwiches, scones and hand-finished cakes.",
    price: 30,
    image:
      "https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=900&q=80",
    status: "Active",
    locations: ["Bedford", "Milton Keynes"],
  },
  {
    name: "Celebration Box",
    description: "A generous selection for birthdays and good news.",
    price: 25,
    image:
      "https://images.unsplash.com/photo-1571115177098-24ec42ed204d?auto=format&fit=crop&w=900&q=80",
    status: "Active",
    locations: ["Bedford", "Milton Keynes"],
  },
  {
    name: "Kids Afternoon Tea",
    description: "A playful little feast made for younger guests.",
    price: 15,
    image:
      "https://images.unsplash.com/photo-1486427944299-d1955d23e34d?auto=format&fit=crop&w=900&q=80",
    status: "Active",
    locations: ["Bedford"],
  },
];

async function ensureOperationalProducts(owner, businessId, locationsByName) {
  const productObject = requireData(
    await owner
      .from("object_definitions")
      .select("*")
      .eq("business_id", businessId)
      .eq("key", "product")
      .single(),
    "Could not load the configured Product Object.",
  );
  const records = requireData(
    await owner
      .from("records")
      .select("*")
      .eq("business_id", businessId)
      .eq("object_definition_id", productObject.id),
    "Could not inspect demo Products.",
  );

  for (const fixture of productFixtures) {
    const matching = records.filter(
      (record) => record.data_json?.name === fixture.name,
    );
    if (matching.length > 1) {
      throw new Error(`Bedford demo has duplicate ${fixture.name} Products.`);
    }
    let product = matching[0];
    const desiredData = {
      name: fixture.name,
      description: fixture.description,
      price: fixture.price,
      image: fixture.image,
      status: fixture.status,
    };
    if (!product) {
      product = requireData(
        await owner.rpc("create_graph_record", {
          expected_business_id: businessId,
          target_object_definition_id: productObject.id,
          requested_data: desiredData,
          requested_record_status: "active",
        }),
        `Could not create ${fixture.name}.`,
      );
    } else if (
      product.record_status !== "active" ||
      !isDeepStrictEqual(product.data_json, desiredData)
    ) {
      product = requireData(
        await owner.rpc("update_graph_record", {
          expected_business_id: businessId,
          target_record_id: product.id,
          data_patch: desiredData,
          requested_record_status: "active",
        }),
        `Could not refresh ${fixture.name}.`,
      );
    }

    const existingLinks = requireData(
      await owner
        .from("record_location_links")
        .select("*")
        .eq("business_id", businessId)
        .eq("record_id", product.id),
      `Could not inspect ${fixture.name} availability.`,
    );
    for (const locationName of fixture.locations) {
      const location = locationsByName.get(locationName);
      if (!location) {
        throw new Error(`Missing ${locationName} for ${fixture.name}.`);
      }
      if (!existingLinks.some((link) => link.location_id === location.id)) {
        requireData(
          await owner.rpc("create_record_location_link", {
            expected_business_id: businessId,
            target_record_id: product.id,
            target_location_id: location.id,
          }),
          `Could not configure ${fixture.name} at ${locationName}.`,
        );
      }
    }
  }
}

const { apiUrl, databaseUrl, publishableKey, serviceRoleKey } =
  loadLocalSupabase();
const sql = postgres(databaseUrl, { max: 1 });
try {
  const admin = createClient(apiUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const ownerUser = await upsertLocalUser(admin, ownerEmail);
  const staffUser = await upsertLocalUser(admin, staffEmail);

  let business = requireData(
    await admin.from("businesses").select("*").eq("slug", demoBusinessSlug),
    "Could not inspect Bedford Bakery.",
  )[0];
  if (!business) {
    business = requireData(
      await admin
        .from("businesses")
        .insert({
          name: "Bedford Bakery",
          slug: demoBusinessSlug,
          business_type: "bakery",
          timezone: "Europe/London",
        })
        .select("*")
        .single(),
      "Could not create Bedford Bakery.",
    );
  }

  requireData(
    await admin
      .from("business_memberships")
      .upsert(
        [
          { business_id: business.id, user_id: ownerUser.id, role: "owner" },
          { business_id: business.id, user_id: staffUser.id, role: "staff" },
        ],
        { onConflict: "business_id,user_id" },
      )
      .select("id"),
    "Could not ensure the demo memberships.",
  );

  const owner = createClient(apiUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const signedIn = requireData(
    await owner.auth.signInWithPassword({
      email: ownerEmail,
      password: demoPassword,
    }),
    "Could not authenticate the Bedford demo Owner.",
  );
  if (signedIn.user.id !== ownerUser.id) {
    throw new Error("The authenticated Bedford demo Owner identity changed.");
  }

  const [bedford, miltonKeynes] = await Promise.all([
    ensureLocation(owner, business.id, "Bedford"),
    ensureLocation(owner, business.id, "Milton Keynes"),
  ]);
  await ensureConfiguredVersionTwo({
    admin,
    owner,
    ownerId: ownerUser.id,
    sql,
    businessId: business.id,
    locationIds: [bedford.id, miltonKeynes.id],
  });
  await ensureOperationalProducts(
    owner,
    business.id,
    new Map([
      [bedford.name, bedford],
      [miltonKeynes.name, miltonKeynes],
    ]),
  );

  console.log("Local Bedford Bakery preorder demo is ready at Version 2.");
  console.log(
    `Public preorder: http://localhost:3000/p/${demoBusinessSlug}/preorder`,
  );
  console.log(`Owner email: ${ownerEmail}`);
  console.log(`Staff email: ${staffEmail}`);
  console.log(`Password: ${demoPassword}`);
  console.log(
    `Staff Orders: http://localhost:3000/app/${demoBusinessSlug}/workspace/orders`,
  );
  console.log(
    "Confirmation email: the terminal running `npm run dev` (local console email adapter).",
  );
} finally {
  await sql.end();
}
