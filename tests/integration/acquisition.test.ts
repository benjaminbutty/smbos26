import { createHash } from "node:crypto";

import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { composeStarterComposition } from "../../src/core/acquisition/composer";
import type { Database, Json } from "../../src/db/supabase/database.types";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";

type Client = SupabaseClient<Database>;
const password = "Phase-5-acquisition-test-password!";
const createdBusinessIds: string[] = [];
let admin: Client;
let owner: Client;
let user: User;

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
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
): Promise<string> {
  const { data, error } = await admin
    .from("anonymous_build_sessions")
    .insert({
      expires_at: expiresAt,
      proposal_json: payload,
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
    if (admin && user) {
      await admin.auth.admin.deleteUser(user.id);
    }
  });

  it("claims a proposal atomically and applies the generated Page/runtime configuration", async () => {
    const payload = composeStarterComposition(
      "appointments",
      "I run a dog grooming business and need customers, pets, appointments and services.",
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
      "pet",
      "service",
    ]);

    const page = await owner
      .from("pages")
      .select("slug, title, audience, status, layout_json")
      .eq("business_id", business.id)
      .eq("slug", "today")
      .single();
    expect(page.error).toBeNull();
    expect(page.data).toMatchObject({
      audience: "internal",
      slug: "today",
      status: "published",
      title: "Today",
    });
    expect(page.data?.layout_json).toMatchObject({
      blocks: expect.arrayContaining([
        expect.objectContaining({ type: "view", view_key: "appointment_view" }),
      ]),
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
      } else {
        expect(objects.data?.map((row) => row.key)).toEqual(
          expect.arrayContaining(["job", "quote", "task"]),
        );
      }
    }
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
  });
});
