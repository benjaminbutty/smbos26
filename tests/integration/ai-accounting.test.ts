import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Database, Tables } from "../../src/db/supabase/database.types";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";

type Client = SupabaseClient<Database>;
type Business = Tables<"businesses">;

interface TestIdentity {
  client: Client;
  user: User;
}

const password = "Milestone-6-accounting-test!";
const createdUserIds: string[] = [];
const createdBusinessIds: string[] = [];

let serviceRole: Client;
let anonymous: Client;
let database: Sql;
let ownerA: TestIdentity;
let ownerB: TestIdentity;
let adminA: TestIdentity;
let staffA: TestIdentity;
let outsider: TestIdentity;
let businessA: Business;
let businessB: Business;

async function createIdentity(
  label: string,
  settings: LocalSupabaseSettings,
): Promise<TestIdentity> {
  const email = `m6-ai-${label}-${crypto.randomUUID()}@example.test`;
  const { data, error } = await serviceRole.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw error ?? new Error(`Could not create ${label}`);
  }
  createdUserIds.push(data.user.id);

  const client = createClient<Database>(
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
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) {
    throw signInError;
  }
  return { client, user: data.user };
}

async function createOwnedBusiness(
  identity: TestIdentity,
  label: string,
): Promise<Business> {
  const { data, error } = await identity.client.rpc("create_business", {
    business_name: `${label} ${crypto.randomUUID()}`,
    requested_business_type: "test",
    requested_timezone: "Europe/London",
  });
  if (error || !data) {
    throw error ?? new Error(`Could not create ${label}`);
  }
  createdBusinessIds.push(data.id);
  return data;
}

function reservationArgs(
  overrides: Partial<
    Database["public"]["Functions"]["reserve_business_ai_execution"]["Args"]
  > = {},
) {
  return {
    requested_execution_id: crypto.randomUUID(),
    expected_business_id: businessA.id,
    expected_actor_id: ownerA.user.id,
    requested_task_key: "contract_probe_v1",
    requested_task_version: 1,
    requested_purpose_label: "Verify structured AI execution readiness",
    requested_policy_key: "bounded_structured_v1",
    requested_provider_key: "disabled",
    requested_model_key: "unconfigured",
    requested_reserved_input_tokens: 100,
    requested_reserved_output_tokens: 50,
    requested_input_microusd_per_million: 0,
    requested_output_microusd_per_million: 0,
    ...overrides,
  };
}

function settlementArgs(
  executionId: string,
  overrides: Partial<{
    expected_business_id: string;
    requested_status: "succeeded" | "failed" | "cancelled";
    requested_outcome_code: string;
    requested_actual_input_tokens: number | null;
    requested_actual_output_tokens: number | null;
    requested_provider_attempt_count: number;
    requested_provider_invocation_started: boolean;
    requested_usage_complete: boolean;
  }> = {},
) {
  return {
    requested_execution_id: executionId,
    expected_business_id: businessA.id,
    requested_status: "succeeded" as const,
    requested_outcome_code: "ai_succeeded",
    requested_actual_input_tokens: 10,
    requested_actual_output_tokens: 5,
    requested_provider_attempt_count: 1,
    requested_provider_invocation_started: true,
    requested_usage_complete: true,
    ...overrides,
  };
}

async function reserve(args = reservationArgs(), client = serviceRole) {
  return client.rpc("reserve_business_ai_execution", args);
}

async function settle(
  args: ReturnType<typeof settlementArgs>,
  client = serviceRole,
) {
  return client.rpc(
    "settle_business_ai_execution",
    args as unknown as Database["public"]["Functions"]["settle_business_ai_execution"]["Args"],
  );
}

async function setLimits(input: {
  businessId?: string;
  enabled?: boolean;
  requests?: number;
  inputTokens?: number;
  outputTokens?: number;
  costMicrousd?: number;
}) {
  await database`
    update public.business_ai_settings
    set
      is_enabled = ${input.enabled ?? true},
      daily_request_limit = ${input.requests ?? 1000},
      daily_input_token_limit = ${input.inputTokens ?? 100000000},
      daily_output_token_limit = ${input.outputTokens ?? 50000000},
      daily_cost_limit_microusd = ${input.costMicrousd ?? 1000000000},
      updated_by = null
    where business_id = ${input.businessId ?? businessA.id}::uuid
  `;
}

function expectAccountingCode(
  error: { code?: string; message?: string } | null,
  code: string,
) {
  expect(error).not.toBeNull();
  expect(`${error?.code ?? ""} ${error?.message ?? ""}`).toContain(code);
}

describe("Milestone 6 Phase 1B durable AI accounting", () => {
  beforeAll(async () => {
    const settings = getLocalSupabaseSettings();
    serviceRole = createClient<Database>(
      settings.apiUrl,
      settings.serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      },
    );
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
    database = postgres(settings.databaseUrl, { max: 5 });

    [ownerA, ownerB, adminA, staffA, outsider] = await Promise.all([
      createIdentity("owner-a", settings),
      createIdentity("owner-b", settings),
      createIdentity("admin-a", settings),
      createIdentity("staff-a", settings),
      createIdentity("outsider", settings),
    ]);
    businessA = await createOwnedBusiness(ownerA, "AI Business A");
    businessB = await createOwnedBusiness(ownerB, "AI Business B");

    const { error } = await serviceRole.from("business_memberships").insert([
      {
        business_id: businessA.id,
        user_id: adminA.user.id,
        role: "admin",
      },
      {
        business_id: businessA.id,
        user_id: staffA.user.id,
        role: "staff",
      },
    ]);
    if (error) {
      throw error;
    }
  });

  beforeEach(async () => {
    await database`
      delete from public.ai_execution_runs
      where business_id in (${businessA.id}::uuid, ${businessB.id}::uuid)
    `;
    await database`
      update public.business_ai_settings
      set
        is_enabled = false,
        daily_request_limit = 25,
        daily_input_token_limit = 250000,
        daily_output_token_limit = 100000,
        daily_cost_limit_microusd = 5000000,
        updated_by = null
      where business_id in (${businessA.id}::uuid, ${businessB.id}::uuid)
    `;
  });

  afterAll(async () => {
    if (database) {
      for (const businessId of createdBusinessIds) {
        await database`
          delete from public.businesses
          where id = ${businessId}::uuid
        `;
      }
      await database.end();
    }
    if (serviceRole) {
      for (const userId of createdUserIds) {
        await serviceRole.auth.admin.deleteUser(userId);
      }
    }
  });

  it("backfills every Business with finite default-disabled settings", async () => {
    const [result] = await database<
      {
        missing_count: number;
        enabled_count: number;
      }[]
    >`
      select
        count(*) filter (where settings.business_id is null)::integer
          as missing_count,
        count(*) filter (where settings.is_enabled)::integer
          as enabled_count
      from public.businesses as business
      left join public.business_ai_settings as settings
        on settings.business_id = business.id
    `;
    expect(result).toEqual({ missing_count: 0, enabled_count: 0 });

    const { data, error } = await ownerA.client.rpc(
      "get_business_ai_settings",
      {
        expected_business_id: businessA.id,
        expected_actor_id: ownerA.user.id,
      },
    );
    expect(error).toBeNull();
    expect(data).toEqual([
      expect.objectContaining({
        is_enabled: false,
        daily_request_limit: 25,
        daily_input_token_limit: 250_000,
        daily_output_token_limit: 100_000,
        daily_cost_limit_microusd: 5_000_000,
      }),
    ]);
  });

  it("creates settings synchronously with a newly created Business", async () => {
    const created = await createOwnedBusiness(
      outsider,
      "Synchronous AI settings",
    );
    const { data, error } = await outsider.client.rpc(
      "get_business_ai_settings",
      {
        expected_business_id: created.id,
        expected_actor_id: outsider.user.id,
      },
    );
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({
      business_id: created.id,
      is_enabled: false,
    });
  });

  it("allows Owner and Admin settings reads and bounded updates", async () => {
    for (const identity of [ownerA, adminA]) {
      const read = await identity.client.rpc("get_business_ai_settings", {
        expected_business_id: businessA.id,
        expected_actor_id: identity.user.id,
      });
      expect(read.error).toBeNull();
      expect(read.data?.[0]?.business_id).toBe(businessA.id);
    }

    const updated = await adminA.client.rpc("update_business_ai_settings", {
      expected_business_id: businessA.id,
      expected_actor_id: adminA.user.id,
      requested_is_enabled: true,
      requested_daily_request_limit: 1000,
      requested_daily_input_token_limit: 100_000_000,
      requested_daily_output_token_limit: 50_000_000,
      requested_daily_cost_limit_microusd: 1_000_000_000,
    });
    expect(updated.error).toBeNull();
    expect(updated.data?.[0]).toMatchObject({
      is_enabled: true,
      updated_by: adminA.user.id,
    });

    const invalid = await ownerA.client.rpc("update_business_ai_settings", {
      expected_business_id: businessA.id,
      expected_actor_id: ownerA.user.id,
      requested_is_enabled: true,
      requested_daily_request_limit: 1001,
      requested_daily_input_token_limit: 100_000_000,
      requested_daily_output_token_limit: 50_000_000,
      requested_daily_cost_limit_microusd: 1_000_000_000,
    });
    expect(invalid.error?.code).toBe("23514");
  });

  it("denies Staff, anonymous, forged actor, and cross-Business settings access", async () => {
    const staffRead = await staffA.client.rpc("get_business_ai_settings", {
      expected_business_id: businessA.id,
      expected_actor_id: staffA.user.id,
    });
    expectAccountingCode(staffRead.error, "ai_owner_or_admin_required");

    const anonymousRead = await anonymous.rpc("get_business_ai_settings", {
      expected_business_id: businessA.id,
      expected_actor_id: ownerA.user.id,
    });
    expect(anonymousRead.error?.code).toBe("42501");

    const crossBusiness = await ownerA.client.rpc("get_business_ai_settings", {
      expected_business_id: businessB.id,
      expected_actor_id: ownerA.user.id,
    });
    expectAccountingCode(crossBusiness.error, "ai_owner_or_admin_required");

    const forgedActor = await ownerA.client.rpc("get_business_ai_settings", {
      expected_business_id: businessA.id,
      expected_actor_id: adminA.user.id,
    });
    expectAccountingCode(forgedActor.error, "ai_actor_context_mismatch");
  });

  it("denies all direct new-table access to application roles", async () => {
    for (const client of [
      anonymous,
      ownerA.client,
      adminA.client,
      staffA.client,
      serviceRole,
    ]) {
      const settingsRead = await client
        .from("business_ai_settings")
        .select("business_id");
      expect(settingsRead.error?.code).toBe("42501");
      const settingsUpdate = await client
        .from("business_ai_settings")
        .update({ is_enabled: true })
        .eq("business_id", businessA.id);
      expect(settingsUpdate.error?.code).toBe("42501");
      const settingsDelete = await client
        .from("business_ai_settings")
        .delete()
        .eq("business_id", businessA.id);
      expect(settingsDelete.error?.code).toBe("42501");

      const runRead = await client
        .from("ai_execution_runs")
        .select("id")
        .eq("business_id", businessA.id);
      expect(runRead.error?.code).toBe("42501");
      const runInsert = await client.from("ai_execution_runs").insert({
        id: crypto.randomUUID(),
        business_id: businessA.id,
        actor_id: ownerA.user.id,
        usage_day: "2026-07-29",
        task_key: "contract_probe_v1",
        task_version: 1,
        purpose_label: "Forbidden",
        policy_key: "bounded_structured_v1",
        provider_key: "disabled",
        model_key: "unconfigured",
        input_microusd_per_million: 0,
        output_microusd_per_million: 0,
        reserved_cost_microusd: 0,
        reserved_input_tokens: 1,
        reserved_output_tokens: 1,
      });
      expect(runInsert.error?.code).toBe("42501");
      const runUpdate = await client
        .from("ai_execution_runs")
        .update({ outcome_code: "ai_forged" })
        .eq("business_id", businessA.id);
      expect(runUpdate.error?.code).toBe("42501");
      const runDelete = await client
        .from("ai_execution_runs")
        .delete()
        .eq("business_id", businessA.id);
      expect(runDelete.error?.code).toBe("42501");
    }
  });

  it("denies reserve and settle RPCs to normal authenticated callers", async () => {
    const args = reservationArgs();
    const ownerReserve = await reserve(args, ownerA.client);
    expect(ownerReserve.error?.code).toBe("42501");
    const ownerSettle = await settle(
      settlementArgs(args.requested_execution_id),
      ownerA.client,
    );
    expect(ownerSettle.error?.code).toBe("42501");
  });

  it("rechecks current Owner/Admin membership inside trusted reservation", async () => {
    await setLimits({});
    const staffReservation = await reserve(
      reservationArgs({ expected_actor_id: staffA.user.id }),
    );
    expectAccountingCode(staffReservation.error, "ai_owner_or_admin_required");
    const outsiderReservation = await reserve(
      reservationArgs({ expected_actor_id: outsider.user.id }),
    );
    expectAccountingCode(
      outsiderReservation.error,
      "ai_owner_or_admin_required",
    );
  });

  it("rejects disabled AI without creating an audit row", async () => {
    const result = await reserve();
    expectAccountingCode(result.error, "ai_disabled");
    const [count] = await database<{ count: number }[]>`
      select count(*)::integer as count
      from public.ai_execution_runs
      where business_id = ${businessA.id}::uuid
    `;
    expect(count?.count).toBe(0);
  });

  it("enforces request, input, output, and monetary limits", async () => {
    await setLimits({
      requests: 1,
      inputTokens: 10_000,
      outputTokens: 10_000,
      costMicrousd: 10_000,
    });
    expect((await reserve()).error).toBeNull();
    expectAccountingCode((await reserve()).error, "ai_budget_exceeded");

    await database`delete from public.ai_execution_runs where business_id = ${businessA.id}::uuid`;
    await setLimits({ inputTokens: 99 });
    expectAccountingCode((await reserve()).error, "ai_budget_exceeded");

    await setLimits({ inputTokens: 10_000, outputTokens: 49 });
    expectAccountingCode((await reserve()).error, "ai_budget_exceeded");

    await setLimits({
      inputTokens: 10_000,
      outputTokens: 10_000,
      costMicrousd: 199,
    });
    expectAccountingCode(
      (
        await reserve(
          reservationArgs({
            requested_input_microusd_per_million: 1_000_000,
            requested_output_microusd_per_million: 2_000_000,
          }),
        )
      ).error,
      "ai_budget_exceeded",
    );
  });

  it("serializes concurrent reservations against one remaining request", async () => {
    await setLimits({
      requests: 1,
      inputTokens: 10_000,
      outputTokens: 10_000,
      costMicrousd: 10_000,
    });
    const [left, right] = await Promise.all([
      reserve(reservationArgs()),
      reserve(reservationArgs()),
    ]);
    expect([left, right].filter(({ error }) => error === null)).toHaveLength(1);
    expect(
      [left, right].filter(({ error }) =>
        error?.message.includes("ai_budget_exceeded"),
      ),
    ).toHaveLength(1);
  });

  it("isolates limits and locks between Businesses", async () => {
    await setLimits({ requests: 1 });
    await setLimits({ businessId: businessB.id, requests: 1 });
    const [first, second] = await Promise.all([
      reserve(reservationArgs()),
      reserve(
        reservationArgs({
          expected_business_id: businessB.id,
          expected_actor_id: ownerB.user.id,
        }),
      ),
    ]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
  });

  it("makes identical reservation replay idempotent and rejects altered replay", async () => {
    await setLimits({});
    const args = reservationArgs();
    const first = await reserve(args);
    const retry = await reserve(args);
    expect(first.error).toBeNull();
    expect(retry.error).toBeNull();
    expect(retry.data).toEqual(first.data);

    const conflict = await reserve({
      ...args,
      requested_task_key: "altered_task_v1",
    });
    expectAccountingCode(conflict.error, "ai_reservation_idempotency_conflict");
  });

  it("makes identical settlement retry idempotent and rejects conflicts", async () => {
    await setLimits({});
    const reservation = reservationArgs();
    expect((await reserve(reservation)).error).toBeNull();
    const args = settlementArgs(reservation.requested_execution_id);
    const first = await settle(args);
    const retry = await settle(args);
    expect(first.error).toBeNull();
    expect(retry.data).toEqual(first.data);

    const conflict = await settle(
      settlementArgs(reservation.requested_execution_id, {
        requested_actual_output_tokens: 6,
      }),
    );
    expectAccountingCode(conflict.error, "ai_settlement_idempotency_conflict");
  });

  it("releases unused reservation amounts after known settlement", async () => {
    await setLimits({
      requests: 2,
      inputTokens: 100,
      outputTokens: 100,
      costMicrousd: 1000,
    });
    const first = reservationArgs({
      requested_reserved_input_tokens: 100,
      requested_reserved_output_tokens: 50,
    });
    expect((await reserve(first)).error).toBeNull();
    expect(
      (
        await settle(
          settlementArgs(first.requested_execution_id, {
            requested_actual_input_tokens: 10,
            requested_actual_output_tokens: 5,
          }),
        )
      ).error,
    ).toBeNull();

    const second = await reserve(
      reservationArgs({
        requested_reserved_input_tokens: 90,
        requested_reserved_output_tokens: 95,
      }),
    );
    expect(second.error).toBeNull();
  });

  it("charges unknown usage conservatively at the reservation", async () => {
    await setLimits({
      requests: 2,
      inputTokens: 100,
      outputTokens: 50,
      costMicrousd: 1000,
    });
    const first = reservationArgs();
    expect((await reserve(first)).error).toBeNull();
    const settled = await settle(
      settlementArgs(first.requested_execution_id, {
        requested_status: "failed",
        requested_outcome_code: "ai_timeout",
        requested_actual_input_tokens: null,
        requested_actual_output_tokens: null,
        requested_usage_complete: false,
      }),
    );
    expect(settled.error).toBeNull();
    expect(settled.data?.[0]).toMatchObject({
      charged_input_tokens: 100,
      charged_output_tokens: 50,
      usage_complete: false,
    });
    expectAccountingCode(
      (
        await reserve(
          reservationArgs({
            requested_reserved_input_tokens: 1,
            requested_reserved_output_tokens: 1,
          }),
        )
      ).error,
      "ai_budget_exceeded",
    );
  });

  it("never undercounts actual overrun and denies later budget", async () => {
    await setLimits({
      requests: 2,
      inputTokens: 120,
      outputTokens: 120,
      costMicrousd: 1000,
    });
    const first = reservationArgs({
      requested_reserved_input_tokens: 100,
      requested_reserved_output_tokens: 50,
    });
    expect((await reserve(first)).error).toBeNull();
    const settled = await settle(
      settlementArgs(first.requested_execution_id, {
        requested_actual_input_tokens: 150,
        requested_actual_output_tokens: 60,
      }),
    );
    expect(settled.error).toBeNull();
    expect(settled.data?.[0]).toMatchObject({
      actual_input_tokens: 150,
      charged_input_tokens: 150,
      actual_output_tokens: 60,
      charged_output_tokens: 60,
      usage_overrun: true,
    });
    expectAccountingCode(
      (
        await reserve(
          reservationArgs({
            requested_reserved_input_tokens: 1,
            requested_reserved_output_tokens: 1,
          }),
        )
      ).error,
      "ai_budget_exceeded",
    );
  });

  it("returns bounded Owner/Admin usage summaries and latest-50 audit", async () => {
    await setLimits({});
    for (let index = 0; index < 55; index += 1) {
      const result = await reserve(
        reservationArgs({
          requested_execution_id: crypto.randomUUID(),
          requested_reserved_input_tokens: 1,
          requested_reserved_output_tokens: 1,
        }),
      );
      expect(result.error).toBeNull();
    }

    for (const identity of [ownerA, adminA]) {
      const audit = await identity.client.rpc(
        "list_business_ai_execution_runs",
        {
          expected_business_id: businessA.id,
          expected_actor_id: identity.user.id,
        },
      );
      expect(audit.error).toBeNull();
      expect(audit.data).toHaveLength(50);

      const summary = await identity.client.rpc(
        "get_business_ai_usage_summary",
        {
          expected_business_id: businessA.id,
          expected_actor_id: identity.user.id,
        },
      );
      expect(summary.error).toBeNull();
      expect(summary.data?.[0]).toMatchObject({
        request_count: 55,
        input_tokens: 55,
        output_tokens: 55,
      });
    }

    const staffAudit = await staffA.client.rpc(
      "list_business_ai_execution_runs",
      {
        expected_business_id: businessA.id,
        expected_actor_id: staffA.user.id,
      },
    );
    expectAccountingCode(staffAudit.error, "ai_owner_or_admin_required");
  });

  it("stores metadata-only audit columns and preserves M5 grants", async () => {
    const columns = await database<{ column_name: string }[]>`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'ai_execution_runs'
      order by ordinal_position
    `;
    const names = columns.map(({ column_name }) => column_name);
    for (const forbidden of [
      "prompt",
      "raw_input",
      "instruction",
      "raw_output",
      "response",
      "headers",
      "api_key",
      "provider_metadata",
      "stack_trace",
    ]) {
      expect(names.some((name) => name.includes(forbidden))).toBe(false);
    }

    const protectedTables = [
      "object_definitions",
      "field_definitions",
      "relationship_definitions",
      "views",
      "forms",
      "pages",
      "preorder_experiences",
      "preorder_experience_locations",
    ];
    for (const table of protectedTables) {
      const [privileges] = await database<
        {
          can_insert: boolean;
          can_update: boolean;
          can_delete: boolean;
        }[]
      >`
        select
          has_table_privilege(
            'service_role',
            ${`public.${table}`},
            'insert'
          ) as can_insert,
          has_table_privilege(
            'service_role',
            ${`public.${table}`},
            'update'
          ) as can_update,
          has_table_privilege(
            'service_role',
            ${`public.${table}`},
            'delete'
          ) as can_delete
      `;
      expect(privileges).toEqual({
        can_insert: false,
        can_update: false,
        can_delete: false,
      });
    }
  });
});
