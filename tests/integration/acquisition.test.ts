import { createHash } from "node:crypto";

import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { composeStarterComposition } from "../../src/core/acquisition/composer";
import { enhanceAcquisitionPayload } from "../../src/core/acquisition/capabilities";
import {
  createDirectTableRow,
  getDirectTableRowCreationAvailability,
} from "../../src/runtime/views/direct-table-record-service";
import type { Database, Json } from "../../src/db/supabase/database.types";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";

type Client = SupabaseClient<Database>;
const password = "Phase-5-acquisition-test-password!";
const createdBusinessIds: string[] = [];
const createdUserIds: string[] = [];
let admin: Client;
let owner: Client;
let user: User;

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function reservationResult(data: Json | null): {
  ok: boolean;
  code?: string;
} | null {
  return typeof data === "object" && data !== null && !Array.isArray(data)
    ? {
        ok: data.ok === true,
        ...(typeof data.code === "string" ? { code: data.code } : {}),
      }
    : null;
}

async function createIdentity(settings: LocalSupabaseSettings): Promise<void> {
  const email = `phase5-${crypto.randomUUID()}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw error ?? new Error("Could not create Phase 5 test identity.");
  }
  user = data.user;
  createdUserIds.push(user.id);
  owner = createClient<Database>(settings.apiUrl, settings.publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const { error: signInError } = await owner.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) {
    throw signInError;
  }
}

async function insertSession(
  token: string,
  payload: Json,
  expiresAt: string,
  clarification: Json | null = null,
): Promise<string> {
  const { data, error } = await admin
    .from("anonymous_build_sessions")
    .insert({
      expires_at: expiresAt,
      proposal_json: payload,
      clarification_json: clarification,
      request_text: "I need a clear starting workspace for my business.",
      requested_category: "appointments",
      session_token_hash: tokenHash(token),
    })
    .select("id")
    .single();
  if (error || !data) {
    throw error ?? new Error("Could not insert acquisition session.");
  }
  return data.id;
}

describe("Phase 5 anonymous acquisition boundary", () => {
  beforeAll(async () => {
    const settings = getLocalSupabaseSettings();
    admin = createClient<Database>(settings.apiUrl, settings.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    await createIdentity(settings);
  });

  afterAll(async () => {
    if (admin && createdBusinessIds.length > 0) {
      await admin.from("businesses").delete().in("id", createdBusinessIds);
    }
    if (admin) {
      for (const userId of createdUserIds) {
        await admin.auth.admin.deleteUser(userId);
      }
    }
  });

  it("rejects unknown tokens and prevents a different user from claiming an owned session", async () => {
    const unknown = await owner.rpc("claim_anonymous_build_session", {
      requested_business_name: "Unknown token",
      requested_session_token: `missing-${crypto.randomUUID()}`,
      requested_timezone: "UTC",
    });
    expect(unknown.data).toBeNull();
    expect(unknown.error?.message).toBe("anonymous_build_session_not_found");

    const settings = getLocalSupabaseSettings();
    const otherEmail = `phase5-other-${crypto.randomUUID()}@example.test`;
    const createdOther = await admin.auth.admin.createUser({
      email: otherEmail,
      password,
      email_confirm: true,
    });
    expect(createdOther.error).toBeNull();
    expect(createdOther.data.user).toBeTruthy();
    if (!createdOther.data.user) return;
    createdUserIds.push(createdOther.data.user.id);
    const otherOwner = createClient<Database>(
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
    const otherSignIn = await otherOwner.auth.signInWithPassword({
      email: otherEmail,
      password,
    });
    expect(otherSignIn.error).toBeNull();

    const token = `owned-${crypto.randomUUID()}`;
    await insertSession(
      token,
      composeStarterComposition(
        "appointments",
        "I need customers and appointments.",
      ) as unknown as Json,
      new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    );
    const claimed = await owner.rpc("claim_anonymous_build_session", {
      requested_business_name: `Owned ${crypto.randomUUID()}`,
      requested_session_token: token,
      requested_timezone: "UTC",
    });
    expect(claimed.error).toBeNull();
    expect(claimed.data).toBeTruthy();
    if (claimed.data) createdBusinessIds.push(claimed.data.id);

    const otherClaim = await otherOwner.rpc("claim_anonymous_build_session", {
      requested_business_name: "Must not replace owner",
      requested_session_token: token,
      requested_timezone: "UTC",
    });
    expect(otherClaim.data).toBeNull();
    expect(otherClaim.error?.message).toBe(
      "anonymous_build_session_already_claimed",
    );
  });

  it("claims a proposal atomically and applies the generated Page/runtime configuration", async () => {
    const payload = composeStarterComposition(
      "appointments",
      "I need customers, appointments and services.",
    );
    const token = `phase5-${crypto.randomUUID()}`;
    await insertSession(
      token,
      payload as unknown as Json,
      new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    );

    const { data: business, error } = await owner.rpc(
      "claim_anonymous_build_session",
      {
        requested_business_name: `Acquisition ${crypto.randomUUID()}`,
        requested_session_token: token,
        requested_timezone: "Europe/London",
      },
    );

    expect(error).toBeNull();
    expect(business).toBeTruthy();
    if (!business) return;
    createdBusinessIds.push(business.id);

    const objects = await owner
      .from("object_definitions")
      .select("key")
      .eq("business_id", business.id)
      .order("key");
    expect(objects.error).toBeNull();
    expect(objects.data?.map((row) => row.key)).toEqual([
      "appointment",
      "customer",
      "service",
    ]);

    const page = await owner
      .from("pages")
      .select("slug, title, audience, status, layout_json")
      .eq("business_id", business.id)
      .eq("slug", "overview")
      .single();
    expect(page.error).toBeNull();
    expect(page.data).toMatchObject({
      audience: "internal",
      slug: "overview",
      status: "published",
      title: "Overview",
    });
    expect(page.data?.layout_json).toMatchObject({
      blocks: expect.arrayContaining([
        expect.objectContaining({ type: "view", view_key: "appointment_view" }),
        expect.objectContaining({ type: "heading", text: "Start here" }),
      ]),
    });

    const pageBlocks = (
      page.data?.layout_json as {
        blocks?: Array<{ type: string; text?: string }>;
      }
    ).blocks;
    expect(
      pageBlocks?.findIndex((block) => block.text === "Start here"),
    ).toBeLessThan(
      pageBlocks?.findIndex((block) => block.type === "view") ?? -1,
    );

    const customerAvailability = await getDirectTableRowCreationAvailability(
      owner,
      { businessId: business.id },
      "customer_view",
    );
    expect(customerAvailability).toMatchObject({
      kind: "direct",
      formKey: "customer_create",
    });
    const customerFormData = new FormData();
    customerFormData.set("name", "Created from the Table");
    const directCustomer = await createDirectTableRow(
      owner,
      { businessId: business.id },
      { viewKey: "customer_view", formData: customerFormData },
    );
    expect(directCustomer.data_json).toEqual({
      name: "Created from the Table",
    });

    await expect(
      getDirectTableRowCreationAvailability(
        owner,
        { businessId: business.id },
        "appointment_view",
      ),
    ).resolves.toMatchObject({
      kind: "unavailable",
      formKey: "appointment_create",
    });

    const head = await owner
      .from("business_configuration_heads")
      .select("head_revision")
      .eq("business_id", business.id)
      .single();
    expect(head.error).toBeNull();
    expect(head.data?.head_revision).toBe(2);

    const customer = await owner
      .from("object_definitions")
      .select("id")
      .eq("business_id", business.id)
      .eq("key", "customer")
      .single();
    expect(customer.error).toBeNull();
    if (!customer.data) return;

    const createdRecord = await owner.rpc("create_graph_record", {
      expected_business_id: business.id,
      requested_data: { name: "A real customer" },
      target_object_definition_id: customer.data.id,
    });
    expect(createdRecord.error).toBeNull();
    expect(createdRecord.data?.data_json).toEqual({ name: "A real customer" });

    const appointmentView = await owner
      .from("views")
      .select("key, object_definition_id")
      .eq("business_id", business.id)
      .eq("key", "appointment_view")
      .single();
    expect(appointmentView.error).toBeNull();
    if (!appointmentView.data) return;
    const appointment = await owner.rpc("create_graph_record", {
      expected_business_id: business.id,
      requested_data: { title: "First real appointment", date: "2026-08-12" },
      target_object_definition_id: appointmentView.data.object_definition_id,
    });
    expect(appointment.error).toBeNull();
    expect(appointment.data?.data_json).toMatchObject({
      title: "First real appointment",
    });
    const visibleAppointments = await owner
      .from("records")
      .select("data_json")
      .eq("business_id", business.id)
      .eq("object_definition_id", appointmentView.data.object_definition_id);
    expect(visibleAppointments.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data_json: expect.objectContaining({
            title: "First real appointment",
          }),
        }),
      ]),
    );

    const { data: repeated, error: repeatError } = await owner.rpc(
      "claim_anonymous_build_session",
      {
        requested_business_name: "Ignored after claim",
        requested_session_token: token,
        requested_timezone: "UTC",
      },
    );
    expect(repeatError).toBeNull();
    expect(repeated?.id).toBe(business.id);

    const scrubbed = await admin
      .from("anonymous_build_sessions")
      .select("request_text, proposal_json, claim_status")
      .eq("session_token_hash", tokenHash(token))
      .single();
    expect(scrubbed.data).toEqual({
      claim_status: "claimed",
      proposal_json: null,
      request_text: null,
    });
  });

  it("keeps an invalid proposal from creating a partial Business", async () => {
    const token = `invalid-${crypto.randomUUID()}`;
    const sessionId = await insertSession(
      token,
      {
        proposal: { schema_version: 1 },
        operations: [{ op: "not_a_configuration_operation" }],
      },
      new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    );
    const name = `Should not exist ${crypto.randomUUID()}`;

    const { data, error } = await owner.rpc("claim_anonymous_build_session", {
      requested_business_name: name,
      requested_session_token: token,
      requested_timezone: "Europe/London",
    });
    expect(data).toBeNull();
    expect(error?.message).toContain("configuration");

    const business = await admin
      .from("businesses")
      .select("id")
      .eq("name", name)
      .maybeSingle();
    expect(business.error).toBeNull();
    expect(business.data).toBeNull();

    const session = await admin
      .from("anonymous_build_sessions")
      .select("claim_status")
      .eq("id", sessionId)
      .single();
    expect(session.data?.claim_status).toBe("active");
  });

  it("rejects an invalid Business timezone without partial claim state", async () => {
    const token = `invalid-timezone-${crypto.randomUUID()}`;
    const payload = composeStarterComposition(
      "jobs",
      "I need to keep customers, jobs and tasks together.",
    );
    const name = `Invalid timezone ${crypto.randomUUID()}`;
    const sessionId = await insertSession(
      token,
      payload as unknown as Json,
      new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    );

    const { data, error } = await owner.rpc("claim_anonymous_build_session", {
      requested_business_name: name,
      requested_session_token: token,
      requested_timezone: "Mars/Olympus",
    });
    expect(data).toBeNull();
    expect(error?.message).toBe("business_timezone_invalid");

    const business = await admin
      .from("businesses")
      .select("id")
      .eq("name", name)
      .maybeSingle();
    expect(business.error).toBeNull();
    expect(business.data).toBeNull();

    const session = await admin
      .from("anonymous_build_sessions")
      .select("claim_status, request_text, proposal_json")
      .eq("id", sessionId)
      .single();
    expect(session.data?.claim_status).toBe("active");
    expect(session.data?.request_text).toBeTruthy();
    expect(session.data?.proposal_json).toBeTruthy();
  });

  it("applies delivery and job compositions through the same claim boundary", async () => {
    for (const category of ["delivery", "jobs"] as const) {
      const payload = composeStarterComposition(
        category,
        `I need a ${category} workspace for customers and the work we deliver.`,
      );
      const token = `${category}-${crypto.randomUUID()}`;
      await insertSession(
        token,
        payload as unknown as Json,
        new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      );

      const { data, error } = await owner.rpc("claim_anonymous_build_session", {
        requested_business_name: `${category} ${crypto.randomUUID()}`,
        requested_session_token: token,
        requested_timezone: "Europe/London",
      });
      expect(error).toBeNull();
      expect(data).toBeTruthy();
      if (!data) continue;
      createdBusinessIds.push(data.id);

      const objects = await owner
        .from("object_definitions")
        .select("key")
        .eq("business_id", data.id);
      expect(objects.error).toBeNull();
      if (category === "delivery") {
        expect(objects.data?.map((row) => row.key)).toEqual(
          expect.arrayContaining([
            "order",
            "order_item",
            "delivery",
            "product",
          ]),
        );
        const quantity = await owner
          .from("field_definitions")
          .select("field_type, required")
          .eq("business_id", data.id)
          .eq(
            "object_definition_id",
            (
              await owner
                .from("object_definitions")
                .select("id")
                .eq("business_id", data.id)
                .eq("key", "order_item")
                .single()
            ).data?.id ?? "",
          )
          .eq("key", "quantity")
          .single();
        expect(quantity.data).toMatchObject({
          field_type: "number",
          required: true,
        });

        const deliveryViews = await owner
          .from("views")
          .select("key, config_json")
          .eq("business_id", data.id)
          .in("key", [
            "customer_view",
            "product_view",
            "order_view",
            "order_item_view",
            "delivery_view",
          ]);
        expect(deliveryViews.error).toBeNull();
        const columnsByView = new Map(
          deliveryViews.data?.map((view) => [
            view.key,
            (
              view.config_json as {
                columns?: Array<{ kind: string; label?: string }>;
              }
            ).columns ?? [],
          ]),
        );
        expect(columnsByView.get("customer_view")).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: "connection", label: "Orders" }),
          ]),
        );
        expect(columnsByView.get("order_view")).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: "connection", label: "Customer" }),
            expect.objectContaining({
              kind: "connection",
              label: "Order items",
            }),
            expect.objectContaining({
              kind: "connection",
              label: "Deliveries",
            }),
          ]),
        );
        expect(columnsByView.get("order_item_view")).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: "connection", label: "Order" }),
            expect.objectContaining({ kind: "connection", label: "Product" }),
          ]),
        );
        expect(columnsByView.get("product_view")).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: "connection",
              label: "Order items",
            }),
          ]),
        );
        expect(columnsByView.get("delivery_view")).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: "connection", label: "Order" }),
          ]),
        );
        await expect(
          getDirectTableRowCreationAvailability(
            owner,
            { businessId: data.id },
            "order_item_view",
          ),
        ).resolves.toMatchObject({
          kind: "configured_form",
          formKey: "order_item_create",
        });
      } else {
        expect(objects.data?.map((row) => row.key)).toEqual(
          expect.arrayContaining(["job", "quote", "task"]),
        );
      }
    }
  });

  it("claims bounded acquisition candidates with draft public capabilities", async () => {
    const bookingPayload = enhanceAcquisitionPayload(
      composeStarterComposition(
        "appointments",
        "I run a mobile dog grooming business.",
      ),
      {
        onlineBooking: true,
        usesServices: true,
        capacityPerSlot: 1,
        publicEnquiry: null,
      },
      "I run a mobile dog grooming business.",
    );
    const bookingToken = `journey1-booking-${crypto.randomUUID()}`;
    await insertSession(
      bookingToken,
      bookingPayload as unknown as Json,
      new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      {
        schema_version: 1,
        round: 2,
        asked_keys: ["online_booking", "booking_services", "booking_capacity"],
        answers: [
          { key: "online_booking", answer: "yes" },
          { key: "booking_services", answer: "yes" },
          { key: "booking_capacity", answer: "one per slot" },
        ],
        status: "ready",
      },
    );
    const bookingClaim = await owner.rpc("claim_anonymous_build_session", {
      requested_business_name: `Journey One Booking ${crypto.randomUUID()}`,
      requested_session_token: bookingToken,
      requested_timezone: "Europe/London",
    });
    expect(bookingClaim.error).toBeNull();
    expect(bookingClaim.data).toBeTruthy();
    if (!bookingClaim.data) return;
    createdBusinessIds.push(bookingClaim.data.id);

    const bookingPages = await owner
      .from("pages")
      .select("audience, status, layout_json")
      .eq("business_id", bookingClaim.data.id)
      .eq("audience", "public");
    expect(bookingPages.error).toBeNull();
    expect(bookingPages.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ audience: "public", status: "draft" }),
      ]),
    );

    const enquiryPayload = enhanceAcquisitionPayload(
      composeStarterComposition(
        "enquiries",
        "I need to organise enquiries for my service business.",
      ),
      {
        onlineBooking: null,
        usesServices: null,
        capacityPerSlot: 1,
        publicEnquiry: true,
      },
      "I need to organise enquiries for my service business.",
    );
    const enquiryToken = `journey1-form-${crypto.randomUUID()}`;
    await insertSession(
      enquiryToken,
      enquiryPayload as unknown as Json,
      new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    );
    const enquiryClaim = await owner.rpc("claim_anonymous_build_session", {
      requested_business_name: `Journey One Enquiry ${crypto.randomUUID()}`,
      requested_session_token: enquiryToken,
      requested_timezone: "Europe/London",
    });
    expect(enquiryClaim.error).toBeNull();
    expect(enquiryClaim.data).toBeTruthy();
    if (!enquiryClaim.data) return;
    createdBusinessIds.push(enquiryClaim.data.id);

    const publicForms = await owner
      .from("forms")
      .select("audience, mode")
      .eq("business_id", enquiryClaim.data.id)
      .eq("audience", "public");
    expect(publicForms.error).toBeNull();
    expect(publicForms.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ audience: "public", mode: "create" }),
      ]),
    );
  });

  it("rejects expired sessions without creating a Business", async () => {
    const token = `expired-${crypto.randomUUID()}`;
    const payload = composeStarterComposition(
      "jobs",
      "I need to keep track of jobs and tasks for customers.",
    );
    await insertSession(
      token,
      payload as unknown as Json,
      new Date(Date.now() - 1_000).toISOString(),
    );
    const name = `Expired ${crypto.randomUUID()}`;

    const { data, error } = await owner.rpc("claim_anonymous_build_session", {
      requested_business_name: name,
      requested_session_token: token,
      requested_timezone: "UTC",
    });
    expect(data).toBeNull();
    expect(error?.message).toContain("anonymous_build_session_expired");
  });

  it("does not expose acquisition rows to an authenticated PostgREST client", async () => {
    const result = await owner.from("anonymous_build_sessions").select("*");
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
    const quota = await owner.from("anonymous_build_daily_quotas").select("*");
    expect(quota.data).toBeNull();
    expect(quota.error).toBeTruthy();
  });

  it("atomically limits one session to two attempts before provider work", async () => {
    const sessionHash = tokenHash(`attempt-session-${crypto.randomUUID()}`);
    const rateKey = tokenHash(`attempt-rate-${crypto.randomUUID()}`);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
    const reserve = () =>
      admin.rpc("reserve_anonymous_build_attempt", {
        requested_category_value: "appointments",
        requested_expires_at: expiresAt,
        requested_rate_key: rateKey,
        requested_session_token_hash: sessionHash,
      });

    const results = await Promise.all([reserve(), reserve(), reserve()]);
    const allowed = results.filter(
      (result) => reservationResult(result.data)?.ok === true,
    );
    expect(allowed).toHaveLength(2);
    expect(
      results.some(
        (result) =>
          reservationResult(result.data)?.ok === false &&
          reservationResult(result.data)?.code === "session_limit_reached",
      ) || results.some((result) => result.error),
    ).toBe(true);

    const row = await admin
      .from("anonymous_build_sessions")
      .select("attempt_count")
      .eq("session_token_hash", sessionHash)
      .single();
    expect(row.data?.attempt_count).toBe(2);
  });

  it("enforces the daily ceiling across replacement session tokens", async () => {
    const rateKey = tokenHash(`daily-rate-${crypto.randomUUID()}`);
    const results = [];
    for (let index = 0; index < 7; index += 1) {
      results.push(
        await admin.rpc("reserve_anonymous_build_attempt", {
          requested_category_value: "other",
          requested_expires_at: new Date(
            Date.now() + 60 * 60 * 1_000,
          ).toISOString(),
          requested_rate_key: rateKey,
          requested_session_token_hash: tokenHash(
            `replacement-${index}-${crypto.randomUUID()}`,
          ),
        }),
      );
    }
    expect(
      results
        .slice(0, 6)
        .every((result) => reservationResult(result.data)?.ok === true),
    ).toBe(true);
    expect(results[6]?.data).toEqual({
      ok: false,
      code: "daily_limit_reached",
    });
  });

  it("scrubs expired prompt material opportunistically", async () => {
    const expiredToken = `cleanup-${crypto.randomUUID()}`;
    const payload = composeStarterComposition("jobs", requestForCleanup);
    const sessionId = await insertSession(
      expiredToken,
      payload as unknown as Json,
      new Date(Date.now() - 1_000).toISOString(),
      {
        schema_version: 1,
        round: 1,
        asked_keys: ["online_booking"],
        answers: [{ key: "online_booking", answer: "internal only" }],
        status: "ready",
      },
    );
    await admin.rpc("reserve_anonymous_build_attempt", {
      requested_category_value: "other",
      requested_expires_at: new Date(
        Date.now() + 60 * 60 * 1_000,
      ).toISOString(),
      requested_rate_key: tokenHash(`cleanup-rate-${crypto.randomUUID()}`),
      requested_session_token_hash: tokenHash(
        `cleanup-new-${crypto.randomUUID()}`,
      ),
    });
    const expired = await admin
      .from("anonymous_build_sessions")
      .select("claim_status, request_text, proposal_json, clarification_json")
      .eq("id", sessionId)
      .single();
    expect(expired.data).toEqual({
      claim_status: "expired",
      proposal_json: null,
      request_text: null,
      clarification_json: null,
    });
  });
});

const requestForCleanup =
  "I need to keep customer jobs and the work we do for them organised.";
