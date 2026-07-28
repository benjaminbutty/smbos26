import { execFileSync } from "node:child_process";
import console from "node:console";
import { join } from "node:path";
import process from "node:process";
import { URL } from "node:url";

import { createClient } from "@supabase/supabase-js";

const ownerEmail = "demo@smbos.local";
const staffEmail = "staff@smbos.local";
const demoPassword = "Local-demo-2026!";
const demoBusinessSlug = "bedford-bakery-demo";

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

  return { apiUrl, publishableKey, serviceRoleKey };
}

function requireData(result, message) {
  if (result.error || result.data === null) {
    throw result.error ?? new Error(message);
  }
  return result.data;
}

async function upsertLocalUser(admin, email) {
  const users = requireData(
    await admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    "Could not inspect local demo users.",
  ).users;
  const existing = users.find((user) => user.email === email);
  if (existing) {
    return requireData(
      await admin.auth.admin.updateUserById(existing.id, {
        password: demoPassword,
        email_confirm: true,
      }),
      `Could not refresh ${email}.`,
    ).user;
  }
  return requireData(
    await admin.auth.admin.createUser({
      email,
      password: demoPassword,
      email_confirm: true,
    }),
    `Could not create ${email}.`,
  ).user;
}

const { apiUrl, publishableKey, serviceRoleKey } = loadLocalSupabase();
const admin = createClient(apiUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});
const [ownerUser, staffUser] = await Promise.all([
  upsertLocalUser(admin, ownerEmail),
  upsertLocalUser(admin, staffEmail),
]);

const existingBusiness = await admin
  .from("businesses")
  .select("id")
  .eq("slug", demoBusinessSlug)
  .maybeSingle();
if (existingBusiness.error) {
  throw existingBusiness.error;
}
if (existingBusiness.data) {
  const deleted = await admin
    .from("businesses")
    .delete()
    .eq("id", existingBusiness.data.id);
  if (deleted.error) {
    throw deleted.error;
  }
}

const business = requireData(
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

requireData(
  await admin
    .from("business_memberships")
    .insert([
      { business_id: business.id, user_id: ownerUser.id, role: "owner" },
      { business_id: business.id, user_id: staffUser.id, role: "staff" },
    ])
    .select("id"),
  "Could not create the demo memberships.",
);

const owner = createClient(apiUrl, publishableKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});
const { error: signInError } = await owner.auth.signInWithPassword({
  email: ownerEmail,
  password: demoPassword,
});
if (signInError) {
  throw signInError;
}

const [bedford, miltonKeynes] = await Promise.all(
  ["Bedford", "Milton Keynes"].map(async (name) =>
    requireData(
      await owner.rpc("create_location", {
        target_business_id: business.id,
        location_name: name,
        requested_timezone: "Europe/London",
      }),
      `Could not create ${name}.`,
    ),
  ),
);

const objects = requireData(
  await owner
    .from("object_definitions")
    .insert([
      {
        business_id: business.id,
        key: "customer",
        singular_label: "Customer",
        plural_label: "Customers",
        description: "People who place bakery preorders",
        kind: "template",
        semantic_type: "customer",
      },
      {
        business_id: business.id,
        key: "product",
        singular_label: "Product",
        plural_label: "Products",
        description: "Products available to preorder",
        kind: "template",
        semantic_type: "product",
      },
      {
        business_id: business.id,
        key: "order",
        singular_label: "Order",
        plural_label: "Orders",
        description: "Collection preorders",
        kind: "template",
        semantic_type: "order",
      },
      {
        business_id: business.id,
        key: "order_item",
        singular_label: "Order Item",
        plural_label: "Order Items",
        description: "Immutable product snapshots within Orders",
        kind: "template",
      },
    ])
    .select("*"),
  "Could not configure preorder Objects.",
);
const objectByKey = Object.fromEntries(
  objects.map((object) => [object.key, object]),
);
const customerObject = objectByKey.customer;
const productObject = objectByKey.product;
const orderObject = objectByKey.order;
const orderItemObject = objectByKey.order_item;
if (!customerObject || !productObject || !orderObject || !orderItemObject) {
  throw new Error("Preorder Object configuration is incomplete.");
}

const fieldRows = [
  [customerObject.id, "name", "Name", "short_text", true, null, {}, 0],
  [customerObject.id, "email", "Email", "email", true, null, {}, 1],
  [customerObject.id, "phone", "Phone", "phone", false, null, {}, 2],
  [productObject.id, "name", "Name", "short_text", true, null, {}, 0],
  [
    productObject.id,
    "description",
    "Description",
    "long_text",
    true,
    null,
    {},
    1,
  ],
  [
    productObject.id,
    "price",
    "Price",
    "currency",
    true,
    null,
    { currency: "GBP" },
    2,
  ],
  [productObject.id, "image", "Image", "file", false, null, {}, 3],
  [
    productObject.id,
    "status",
    "Status",
    "status",
    true,
    "Active",
    { options: ["Active", "Inactive"] },
    4,
  ],
  [
    orderObject.id,
    "public_reference",
    "Reference",
    "short_text",
    true,
    null,
    {},
    0,
  ],
  [
    orderObject.id,
    "status",
    "Status",
    "status",
    true,
    "New",
    { options: ["New", "Confirmed", "Ready", "Collected", "Cancelled"] },
    1,
  ],
  [
    orderObject.id,
    "collection_at",
    "Collection Timestamp",
    "datetime",
    true,
    null,
    {},
    2,
  ],
  [
    orderObject.id,
    "collection_local_display",
    "Collection",
    "short_text",
    true,
    null,
    {},
    3,
  ],
  [
    orderObject.id,
    "collection_timezone",
    "Collection Timezone",
    "short_text",
    true,
    null,
    {},
    4,
  ],
  [
    orderObject.id,
    "collection_location_name",
    "Collection Location",
    "short_text",
    true,
    null,
    {},
    5,
  ],
  [
    orderObject.id,
    "customer_name",
    "Customer",
    "short_text",
    true,
    null,
    {},
    6,
  ],
  [
    orderObject.id,
    "customer_email",
    "Customer Email",
    "email",
    true,
    null,
    {},
    7,
  ],
  [
    orderObject.id,
    "customer_phone",
    "Customer Phone",
    "phone",
    false,
    null,
    {},
    8,
  ],
  [
    orderObject.id,
    "dietary_requirements",
    "Dietary Requirements",
    "long_text",
    false,
    null,
    {},
    9,
  ],
  [orderObject.id, "occasion", "Occasion", "short_text", false, null, {}, 10],
  [orderObject.id, "item_summary", "Items", "long_text", true, null, {}, 11],
  [
    orderObject.id,
    "total",
    "Total",
    "currency",
    true,
    null,
    { currency: "GBP" },
    12,
  ],
  [
    orderItemObject.id,
    "product_name",
    "Product",
    "short_text",
    true,
    null,
    {},
    0,
  ],
  [orderItemObject.id, "quantity", "Quantity", "number", true, null, {}, 1],
  [
    orderItemObject.id,
    "unit_price",
    "Unit Price",
    "currency",
    true,
    null,
    { currency: "GBP" },
    2,
  ],
  [
    orderItemObject.id,
    "line_total",
    "Line Total",
    "currency",
    true,
    null,
    { currency: "GBP" },
    3,
  ],
];
requireData(
  await owner
    .from("field_definitions")
    .insert(
      fieldRows.map(
        ([
          object_definition_id,
          key,
          label,
          field_type,
          required,
          default_value,
          settings_json,
          position,
        ]) => ({
          business_id: business.id,
          object_definition_id,
          key,
          label,
          field_type,
          required,
          default_value,
          settings_json,
          position,
        }),
      ),
    )
    .select("id"),
  "Could not configure preorder Fields.",
);

const relationships = requireData(
  await owner
    .from("relationship_definitions")
    .insert([
      {
        business_id: business.id,
        key: "customer_places_order",
        source_object_definition_id: customerObject.id,
        target_object_definition_id: orderObject.id,
        source_label: "places",
        target_label: "customer",
        cardinality: "one_to_many",
        is_required: true,
      },
      {
        business_id: business.id,
        key: "order_contains_order_item",
        source_object_definition_id: orderObject.id,
        target_object_definition_id: orderItemObject.id,
        source_label: "contains",
        target_label: "order",
        cardinality: "one_to_many",
        is_required: true,
      },
      {
        business_id: business.id,
        key: "product_appears_in_order_item",
        source_object_definition_id: productObject.id,
        target_object_definition_id: orderItemObject.id,
        source_label: "appears in",
        target_label: "product",
        cardinality: "one_to_many",
        is_required: true,
      },
    ])
    .select("*"),
  "Could not configure preorder Relationships.",
);
const relationshipByKey = Object.fromEntries(
  relationships.map((relationship) => [relationship.key, relationship]),
);

const products = requireData(
  await owner
    .from("records")
    .insert([
      {
        business_id: business.id,
        object_definition_id: productObject.id,
        data_json: {
          name: "Afternoon Tea Box",
          description: "Finger sandwiches, scones and hand-finished cakes.",
          price: 30,
          image:
            "https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=900&q=80",
          status: "Active",
        },
      },
      {
        business_id: business.id,
        object_definition_id: productObject.id,
        data_json: {
          name: "Celebration Box",
          description: "A generous selection for birthdays and good news.",
          price: 25,
          image:
            "https://images.unsplash.com/photo-1571115177098-24ec42ed204d?auto=format&fit=crop&w=900&q=80",
          status: "Active",
        },
      },
      {
        business_id: business.id,
        object_definition_id: productObject.id,
        data_json: {
          name: "Kids Afternoon Tea",
          description: "A playful little feast made for younger guests.",
          price: 15,
          image:
            "https://images.unsplash.com/photo-1486427944299-d1955d23e34d?auto=format&fit=crop&w=900&q=80",
          status: "Active",
        },
      },
    ])
    .select("*"),
  "Could not create preorder Products.",
);
const productByName = Object.fromEntries(
  products.map((product) => [product.data_json.name, product]),
);
const locationLinks = [
  [productByName["Afternoon Tea Box"]?.id, bedford.id],
  [productByName["Afternoon Tea Box"]?.id, miltonKeynes.id],
  [productByName["Celebration Box"]?.id, bedford.id],
  [productByName["Celebration Box"]?.id, miltonKeynes.id],
  [productByName["Kids Afternoon Tea"]?.id, bedford.id],
];
for (const [recordId, locationId] of locationLinks) {
  if (!recordId) {
    throw new Error("Product Location configuration is incomplete.");
  }
  requireData(
    await owner.rpc("create_record_location_link", {
      expected_business_id: business.id,
      target_record_id: recordId,
      target_location_id: locationId,
    }),
    "Could not configure Product availability.",
  );
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
const preorder = requireData(
  await owner.rpc("create_preorder_experience", {
    expected_business_id: business.id,
    requested_key: "bakery_preorder",
    requested_product_object_definition_id: productObject.id,
    requested_customer_object_definition_id: customerObject.id,
    requested_order_object_definition_id: orderObject.id,
    requested_order_item_object_definition_id: orderItemObject.id,
    requested_customer_places_order_relationship_definition_id:
      relationshipByKey.customer_places_order.id,
    requested_order_contains_item_relationship_definition_id:
      relationshipByKey.order_contains_order_item.id,
    requested_product_appears_in_item_relationship_definition_id:
      relationshipByKey.product_appears_in_order_item.id,
    requested_config: preorderConfig,
    requested_location_ids: [bedford.id, miltonKeynes.id],
    requested_is_active: true,
  }),
  "Could not create preorder configuration.",
);

requireData(
  await owner
    .from("forms")
    .insert({
      business_id: business.id,
      key: "order_status_edit",
      name: "Update order status",
      object_definition_id: orderObject.id,
      mode: "edit",
      audience: "internal",
      config_json: {
        fields: [
          {
            field: "status",
            help_text: "Keep the collection team up to date.",
          },
        ],
        submit_label: "Save status",
      },
    })
    .select("id")
    .single(),
  "Could not configure the Order status Form.",
);

requireData(
  await owner
    .from("views")
    .insert([
      {
        business_id: business.id,
        key: "orders",
        name: "Orders",
        view_type: "table",
        object_definition_id: orderObject.id,
        audience: "internal",
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
      },
      {
        business_id: business.id,
        key: "order_detail",
        name: "Order",
        view_type: "detail",
        object_definition_id: orderObject.id,
        audience: "internal",
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
      },
    ])
    .select("id"),
  "Could not configure generic Order screens.",
);

requireData(
  await owner
    .from("pages")
    .insert({
      business_id: business.id,
      key: "public_preorder",
      title: "Preorder for collection",
      slug: "preorder",
      audience: "public",
      status: "published",
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
          { type: "preorder", preorder_key: preorder.key },
        ],
      },
    })
    .select("id")
    .single(),
  "Could not publish the preorder Page.",
);

console.log("Local Bedford Bakery preorder demo is ready.");
console.log(
  `Public preorder: http://localhost:3000/p/${demoBusinessSlug}/preorder`,
);
console.log(`Staff email: ${staffEmail}`);
console.log(`Staff password: ${demoPassword}`);
console.log(
  `Staff Orders: http://localhost:3000/app/${demoBusinessSlug}/workspace/orders`,
);
console.log(
  "Confirmation email: the terminal running `npm run dev` (local console email adapter).",
);
