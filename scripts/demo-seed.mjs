import { execFileSync } from "node:child_process";
import console from "node:console";
import { join } from "node:path";
import process from "node:process";
import { URL } from "node:url";

import { createClient } from "@supabase/supabase-js";

const demoEmail = "demo@smbos.local";
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
  if (result.error || !result.data) {
    throw result.error ?? new Error(message);
  }

  return result.data;
}

const { apiUrl, publishableKey, serviceRoleKey } = loadLocalSupabase();
const admin = createClient(apiUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

const users = requireData(
  await admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  "Could not inspect local demo users.",
).users;
let demoUser = users.find((user) => user.email === demoEmail);

if (demoUser) {
  demoUser = requireData(
    await admin.auth.admin.updateUserById(demoUser.id, {
      password: demoPassword,
      email_confirm: true,
    }),
    "Could not refresh the local demo user.",
  ).user;
} else {
  demoUser = requireData(
    await admin.auth.admin.createUser({
      email: demoEmail,
      password: demoPassword,
      email_confirm: true,
    }),
    "Could not create the local demo user.",
  ).user;
}

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
  "Could not create the demo business.",
);

requireData(
  await admin
    .from("business_memberships")
    .insert({
      business_id: business.id,
      user_id: demoUser.id,
      role: "owner",
    })
    .select("id")
    .single(),
  "Could not create the demo membership.",
);

const demo = createClient(apiUrl, publishableKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});
const { error: signInError } = await demo.auth.signInWithPassword({
  email: demoEmail,
  password: demoPassword,
});
if (signInError) {
  throw signInError;
}

const cateringEnquiry = requireData(
  await demo
    .from("object_definitions")
    .insert({
      business_id: business.id,
      key: "catering_enquiry",
      singular_label: "Catering Enquiry",
      plural_label: "Catering Enquiries",
      description: "Corporate and private event enquiries",
      kind: "custom",
      icon: "inbox",
    })
    .select("*")
    .single(),
  "Could not configure Catering Enquiries.",
);

requireData(
  await demo
    .from("field_definitions")
    .insert([
      {
        business_id: business.id,
        object_definition_id: cateringEnquiry.id,
        key: "company_name",
        label: "Company",
        field_type: "short_text",
        required: true,
        settings_json: {},
        position: 0,
      },
      {
        business_id: business.id,
        object_definition_id: cateringEnquiry.id,
        key: "event_date",
        label: "Event date",
        field_type: "date",
        required: true,
        settings_json: {},
        position: 1,
      },
      {
        business_id: business.id,
        object_definition_id: cateringEnquiry.id,
        key: "guest_count",
        label: "Guests",
        field_type: "number",
        required: true,
        settings_json: {},
        position: 2,
      },
      {
        business_id: business.id,
        object_definition_id: cateringEnquiry.id,
        key: "budget",
        label: "Budget",
        field_type: "currency",
        required: false,
        settings_json: { currency: "GBP" },
        position: 3,
      },
      {
        business_id: business.id,
        object_definition_id: cateringEnquiry.id,
        key: "notes",
        label: "Notes",
        field_type: "long_text",
        required: false,
        settings_json: {},
        position: 4,
      },
      {
        business_id: business.id,
        object_definition_id: cateringEnquiry.id,
        key: "status",
        label: "Status",
        field_type: "status",
        required: false,
        default_value: "New",
        settings_json: {
          options: ["New", "Contacted", "Booked", "Declined"],
        },
        position: 5,
      },
    ])
    .select("id"),
  "Could not configure Catering Enquiry details.",
);

const configuredFields = [
  { field: "company_name", help_text: "Who is the enquiry for?" },
  { field: "event_date" },
  { field: "guest_count" },
  { field: "budget" },
  { field: "notes" },
  { field: "status" },
];

requireData(
  await demo
    .from("forms")
    .insert([
      {
        business_id: business.id,
        key: "catering_enquiry_create",
        name: "New catering enquiry",
        object_definition_id: cateringEnquiry.id,
        mode: "create",
        audience: "internal",
        config_json: {
          fields: configuredFields,
          submit_label: "Add enquiry",
        },
      },
      {
        business_id: business.id,
        key: "catering_enquiry_edit",
        name: "Edit catering enquiry",
        object_definition_id: cateringEnquiry.id,
        mode: "edit",
        audience: "internal",
        config_json: {
          fields: configuredFields,
          submit_label: "Save enquiry",
        },
      },
    ])
    .select("id"),
  "Could not configure Catering Enquiry forms.",
);

requireData(
  await demo
    .from("views")
    .insert([
      {
        business_id: business.id,
        key: "catering_enquiries",
        name: "Catering Enquiries",
        view_type: "table",
        object_definition_id: cateringEnquiry.id,
        audience: "internal",
        config_json: {
          fields: [
            "company_name",
            "event_date",
            "guest_count",
            "budget",
            "status",
          ],
          title_field: "company_name",
          create_form_key: "catering_enquiry_create",
          edit_form_key: "catering_enquiry_edit",
          include_archived: false,
        },
      },
      {
        business_id: business.id,
        key: "catering_enquiry_detail",
        name: "Catering Enquiry",
        view_type: "detail",
        object_definition_id: cateringEnquiry.id,
        audience: "internal",
        config_json: {
          fields: [
            "company_name",
            "event_date",
            "guest_count",
            "budget",
            "notes",
            "status",
          ],
          title_field: "company_name",
          edit_form_key: "catering_enquiry_edit",
          include_archived: false,
        },
      },
    ])
    .select("id"),
  "Could not configure Catering Enquiry screens.",
);

requireData(
  await demo
    .from("records")
    .insert([
      {
        business_id: business.id,
        object_definition_id: cateringEnquiry.id,
        data_json: {
          company_name: "Acme Ltd",
          event_date: "2026-11-10",
          guest_count: 80,
          budget: 4000,
          notes: "Lunch service and welcome drinks.",
          status: "New",
        },
      },
      {
        business_id: business.id,
        object_definition_id: cateringEnquiry.id,
        data_json: {
          company_name: "Example Co",
          event_date: "2026-12-05",
          guest_count: 45,
          budget: 2250,
          notes: "Evening reception.",
          status: "Contacted",
        },
      },
    ])
    .select("id"),
  "Could not create Catering Enquiry examples.",
);

console.log("Local SMBOS demo is ready.");
console.log(`Email: ${demoEmail}`);
console.log(`Password: ${demoPassword}`);
console.log(
  "Route: http://localhost:3000/app/bedford-bakery-demo/workspace/catering-enquiries",
);
