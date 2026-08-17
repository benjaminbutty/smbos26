import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  publicBookingCatalogueSchema,
  publicBookingResultSchema,
} from "../../src/core/booking/schemas";
import { resolvePublicBooking } from "../../src/core/booking/service";
import { submitPublicCreateForm } from "../../src/core/public/form";
import type { Database, Json } from "../../src/db/supabase/database.types";

vi.mock("server-only", () => ({}));

type Client = SupabaseClient<Database>;

interface LocalSettings {
  apiUrl: string;
  databaseUrl: string;
  publishableKey: string;
  serviceRoleKey: string;
}

function localSettings(): LocalSettings {
  const output = execFileSync(
    process.execPath,
    [
      join(process.cwd(), "node_modules/supabase/dist/supabase.js"),
      "status",
      "-o",
      "env",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
    },
  );
  const values = Object.fromEntries(
    output.split("\n").flatMap((line) => {
      const match = /^([A-Z0-9_]+)="(.*)"$/.exec(line.trim());
      return match?.[1] && match[2] !== undefined ? [[match[1], match[2]]] : [];
    }),
  );
  return {
    apiUrl: values.API_URL ?? "",
    databaseUrl: values.DB_URL ?? "",
    publishableKey: values.PUBLISHABLE_KEY ?? values.ANON_KEY ?? "",
    serviceRoleKey: values.SERVICE_ROLE_KEY ?? "",
  };
}

async function rpc<T>(
  client: Client,
  name: string,
  args: Record<string, Json>,
): Promise<T> {
  const invoke = client.rpc as unknown as (
    functionName: string,
    parameters: Record<string, Json>,
  ) => Promise<{ data: T | null; error: { message: string } | null }>;
  const result = await invoke.call(client, name, args);
  if (result.error || result.data === null) {
    throw new Error(result.error?.message ?? `RPC ${name} returned no data.`);
  }
  return result.data;
}

async function rpcNullable<T>(
  client: Client,
  name: string,
  args: Record<string, Json>,
): Promise<T | null> {
  const invoke = client.rpc as unknown as (
    functionName: string,
    parameters: Record<string, Json>,
  ) => Promise<{ data: T | null; error: { message: string } | null }>;
  const result = await invoke.call(client, name, args);
  if (result.error) {
    throw new Error(result.error.message);
  }
  return result.data;
}

const bookingConfig = {
  booking_object_key: "appointments",
  customer_object_key: "customers",
  subject_object_key: null,
  service_object_key: null,
  relationships: {
    customer_booking: "customer_booking",
    customer_subject: null,
    subject_booking: null,
    service_booking: null,
  },
  field_mappings: {
    customer: { name: "name", email: null, phone: null },
    booking: {
      start_at: "starts_at",
      status: "status",
      default_status: "requested",
    },
    subject: null,
    service: null,
  },
  public_fields: [
    { target: "customer", field: "name", label: "Your name", required: true },
  ],
  schedule: {
    timezone_source: "business",
    location_id: null,
    days_of_week: [1, 2, 3, 4, 5, 6, 7],
    first_time: "09:00",
    last_time: "11:00",
    slot_interval_minutes: 60,
    capacity_per_slot: 1,
    minimum_notice_minutes: 0,
    booking_horizon_days: 3,
  },
};

describe("Journey 1 public Form and Booking boundaries", () => {
  let sql: Sql;
  let anonymous: Client;
  let trusted: Client;
  let businessId: string;
  let publicFormPageSlug: string;
  let bookingPageSlug: string;

  beforeAll(async () => {
    const settings = localSettings();
    sql = postgres(settings.databaseUrl, { max: 2 });
    anonymous = createClient<Database>(
      settings.apiUrl,
      settings.publishableKey,
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      },
    );
    trusted = createClient<Database>(settings.apiUrl, settings.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    businessId = crypto.randomUUID();
    const slug = `journey-one-${businessId.slice(0, 8)}`;
    publicFormPageSlug = "enquiry";
    bookingPageSlug = "book";
    await sql`
      insert into public.businesses (id, name, slug, business_type, timezone)
      values (${businessId}, 'Journey One Test Business', ${slug}, 'service', 'Europe/London')
    `;

    const customerObjectId = crypto.randomUUID();
    const bookingObjectId = crypto.randomUUID();
    const enquiryObjectId = crypto.randomUUID();
    await sql`
      insert into public.object_definitions
        (id, business_id, key, singular_label, plural_label, description, kind)
      values
        (${customerObjectId}, ${businessId}, 'customers', 'Customer', 'Customers', '', 'custom'),
        (${bookingObjectId}, ${businessId}, 'appointments', 'Appointment', 'Appointments', '', 'custom'),
        (${enquiryObjectId}, ${businessId}, 'enquiries', 'Enquiry', 'Enquiries', '', 'custom')
    `;
    await sql`
      insert into public.field_definitions
        (business_id, object_definition_id, key, label, field_type, required, settings_json, position)
      values
        (${businessId}, ${customerObjectId}, 'name', 'Name', 'short_text', true, '{}'::jsonb, 0),
        (${businessId}, ${bookingObjectId}, 'starts_at', 'Starts at', 'datetime', true, '{}'::jsonb, 0),
        (${businessId}, ${bookingObjectId}, 'status', 'Status', 'status', true, '{"options":["requested","confirmed"]}'::jsonb, 1),
        (${businessId}, ${enquiryObjectId}, 'message', 'Message', 'long_text', true, '{}'::jsonb, 0)
    `;
    const relationshipId = crypto.randomUUID();
    await sql`
      insert into public.relationship_definitions
        (id, business_id, key, source_object_definition_id, target_object_definition_id,
         source_label, target_label, cardinality)
      values
        (${relationshipId}, ${businessId}, 'customer_booking', ${customerObjectId}, ${bookingObjectId},
         'Bookings', 'Customer', 'one_to_many')
    `;
    const enquiryFormId = crypto.randomUUID();
    await sql`
      insert into public.forms
        (id, business_id, key, name, object_definition_id, mode, config_json, audience)
      values
        (${enquiryFormId}, ${businessId}, 'enquiry_form', 'Send an enquiry', ${enquiryObjectId},
         'create', '{"fields":[{"field":"message"}]}'::jsonb, 'public')
    `;
    const publicFormPageId = crypto.randomUUID();
    const bookingPageId = crypto.randomUUID();
    await sql`
      insert into public.pages
        (id, business_id, key, title, slug, audience, layout_json, status)
      values
        (${publicFormPageId}, ${businessId}, 'enquiry_page', 'Enquiries', ${publicFormPageSlug}, 'public',
          '{"blocks":[{"type":"public_form","form_key":"enquiry_form"}]}'::jsonb, 'published')
    `;
    await sql`
      insert into public.pages
        (id, business_id, key, title, slug, audience, layout_json, status)
      values
        (${bookingPageId}, ${businessId}, 'booking_page', 'Book an appointment', ${bookingPageSlug}, 'public',
          ${sql.json({
            blocks: [
              {
                type: "booking",
                booking_key: "appointments",
                config: bookingConfig,
              },
            ],
          })},
          'published')
    `;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from public.businesses where id = ${businessId}`;
    await sql.end();
  });

  it("creates one generic Record through the public Form boundary and is idempotent", async () => {
    const token = crypto.randomUUID();
    const first = await rpc<Json>(anonymous, "submit_public_create_form", {
      requested_business_slug:
        (
          await sql<
            { slug: string }[]
          >`select slug from public.businesses where id = ${businessId}`
        )[0]?.slug ?? "",
      requested_page_slug: publicFormPageSlug,
      requested_form_key: "enquiry_form",
      requested_idempotency_token: token,
      requested_data: { message: "Please call me" },
      requested_request_hash: "a".repeat(64),
    });
    expect(first).toMatchObject({ ok: true, idempotent: false });
    const second = await rpc<Json>(anonymous, "submit_public_create_form", {
      requested_business_slug:
        (
          await sql<
            { slug: string }[]
          >`select slug from public.businesses where id = ${businessId}`
        )[0]?.slug ?? "",
      requested_page_slug: publicFormPageSlug,
      requested_form_key: "enquiry_form",
      requested_idempotency_token: token,
      requested_data: { message: "Please call me" },
      requested_request_hash: "a".repeat(64),
    });
    expect(second).toMatchObject({ ok: true, idempotent: true });
    const trustedRetry = await submitPublicCreateForm(trusted, {
      businessSlug:
        (
          await sql<
            { slug: string }[]
          >`select slug from public.businesses where id = ${businessId}`
        )[0]?.slug ?? "",
      pageSlug: publicFormPageSlug,
      formKey: "enquiry_form",
      idempotencyToken: token,
      data: { message: "Please call me" },
      requestHash: "a".repeat(64),
    });
    expect(trustedRetry).toMatchObject({ ok: true, idempotent: true });
    const countRows = await sql<{ count: number }[]>`
      select count(*)::int as count
      from public.records
      where business_id = ${businessId}
    `;
    expect(countRows[0]?.count).toBe(1);
  });

  it("resolves slots, creates configured Booking graph data and rejects a forged capability key", async () => {
    const business = (
      await sql<
        { slug: string }[]
      >`select slug from public.businesses where id = ${businessId}`
    )[0];
    if (!business) throw new Error("Journey One test Business is missing.");
    const pageRows = await sql<{ layout_json: Json }[]>`
      select layout_json
      from public.pages
      where business_id = ${businessId}
        and slug = ${bookingPageSlug}
    `;
    expect(pageRows[0]?.layout_json).toMatchObject({
      blocks: [
        {
          type: "booking",
          booking_key: "appointments",
          config: { schedule: { timezone_source: "business" } },
        },
      ],
    });
    const trustedCatalogue = await resolvePublicBooking(
      trusted,
      business.slug,
      bookingPageSlug,
      "appointments",
    );
    expect(trustedCatalogue).not.toBeNull();
    const catalogue = publicBookingCatalogueSchema.parse(
      await rpc<Json>(anonymous, "resolve_public_booking", {
        requested_business_slug: business.slug,
        requested_page_slug: bookingPageSlug,
        requested_booking_key: "appointments",
      }),
    );
    expect(catalogue.booking.customer_label).toBe("Customer");
    expect(catalogue.booking.subject_label).toBeNull();
    const slot = catalogue.booking.slots[0];
    if (!slot) throw new Error("The Booking resolver returned no slot.");
    const token = crypto.randomUUID();
    const result = publicBookingResultSchema.parse(
      await rpc<Json>(anonymous, "submit_public_booking", {
        requested_business_slug: business.slug,
        requested_page_slug: bookingPageSlug,
        requested_booking_key: "appointments",
        requested_idempotency_token: token,
        requested_submission: {
          idempotency_token: token,
          start_at: slot.start_at,
          customer: { name: "Sarah Evans" },
          subject: {},
          booking: {},
          service_record_id: null,
          website: "",
        },
        requested_request_hash: "b".repeat(64),
      }),
    );
    expect(result).toMatchObject({ ok: true, idempotent: false });
    const duplicate = publicBookingResultSchema.parse(
      await rpc<Json>(anonymous, "submit_public_booking", {
        requested_business_slug: business.slug,
        requested_page_slug: bookingPageSlug,
        requested_booking_key: "appointments",
        requested_idempotency_token: token,
        requested_submission: {
          idempotency_token: token,
          start_at: slot.start_at,
          customer: { name: "Sarah Evans" },
          subject: {},
          booking: {},
          service_record_id: null,
          website: "",
        },
        requested_request_hash: "b".repeat(64),
      }),
    );
    expect(duplicate).toMatchObject({ ok: true, idempotent: true });

    const [recordRows, edgeRows] = await Promise.all([
      sql<
        { records: number }[]
      >`select count(*)::int as records from public.records where business_id = ${businessId}`,
      sql<
        { edges: number }[]
      >`select count(*)::int as edges from public.record_relationships where business_id = ${businessId}`,
    ]);
    expect(recordRows[0]?.records).toBe(3);
    expect(edgeRows[0]?.edges).toBe(1);

    const forged = await rpcNullable<Json>(
      anonymous,
      "resolve_public_booking",
      {
        requested_business_slug: business.slug,
        requested_page_slug: bookingPageSlug,
        requested_booking_key: "other_business_booking",
      },
    );
    expect(forged).toBeNull();
    const { error } = await anonymous.from("records").select("id").limit(1);
    expect(error).not.toBeNull();
  });
});
