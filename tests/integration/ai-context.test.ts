import { execFileSync } from "node:child_process";

import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildAiBusinessContext,
  loadAuthoritativeAiBusinessContext,
} from "../../src/core/configuration/builder-context-source";
import { ConfigurationChangeService } from "../../src/core/configuration/service";
import { createGraphService } from "../../src/core/graph/service";
import type {
  Database,
  Json,
  Tables,
} from "../../src/db/supabase/database.types";
import { serializeAiBusinessModelContext } from "../../src/ai/context/projector";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";

type Client = SupabaseClient<Database>;
type Identity = { client: Client; user: User };

const demoPassword = "Local-demo-2026!";
const piiMarker = `AI_CONTEXT_PII_${crypto.randomUUID()}`;
const createdUserIds: string[] = [];
const createdBusinessIds: string[] = [];

let settings: LocalSupabaseSettings;
let sql: Sql;
let serviceRole: Client;
let anonymous: Client;
let owner: Identity;
let administrator: Identity;
let staff: Identity;
let outsider: Identity;
let business: Tables<"businesses">;
let outsiderBusiness: Tables<"businesses">;
let bedfordBytes = 0;

function requireData<T>(
  result: { data: T; error: { message: string } | null },
  message: string,
): NonNullable<T> {
  if (result.error || result.data === null) {
    throw new Error(`${message}: ${result.error?.message ?? "No data"}`);
  }
  return result.data as NonNullable<T>;
}

async function signIn(
  email: string,
  password = demoPassword,
): Promise<Identity> {
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
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.user) {
    throw signedIn.error ?? new Error(`Could not sign in ${email}.`);
  }
  return { client, user: signedIn.data.user };
}

async function createIdentity(label: string): Promise<Identity> {
  const password = "Milestone-6-context-test-password!";
  const email = `m6-context-${label}-${crypto.randomUUID()}@example.test`;
  const created = await serviceRole.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error(`Could not create ${label}.`);
  }
  createdUserIds.push(created.data.user.id);
  return signIn(email, password);
}

async function captureReadState(): Promise<Record<string, Json>> {
  const [state] = await sql<Record<string, Json>[]>`
    select
      (
        select to_jsonb(head_value)
        from public.business_configuration_heads as head_value
        where head_value.business_id = ${business.id}::uuid
      ) as head,
      (
        select jsonb_agg(to_jsonb(version_value) order by version_number)
        from public.configuration_versions as version_value
        where version_value.business_id = ${business.id}::uuid
      ) as versions,
      private.configuration_snapshot_v1(${business.id}::uuid) as projection,
      (
        select count(*)::integer
        from public.configuration_change_sets
        where business_id = ${business.id}::uuid
      ) as proposals,
      (
        select count(*)::integer
        from public.records
        where business_id = ${business.id}::uuid
      ) as records,
      (
        select count(*)::integer
        from public.record_relationships
        where business_id = ${business.id}::uuid
      ) as record_relationships,
      (
        select count(*)::integer
        from public.record_location_links
        where business_id = ${business.id}::uuid
      ) as record_location_links,
      (
        select jsonb_agg(to_jsonb(location_value) order by id)
        from public.locations as location_value
        where location_value.business_id = ${business.id}::uuid
      ) as locations,
      (
        select count(*)::integer
        from public.ai_execution_runs
        where business_id = ${business.id}::uuid
      ) as ai_execution_runs
  `;
  if (!state) {
    throw new Error("Could not capture AI context read state.");
  }
  return state;
}

function completePreorderOperation(
  snapshot: Awaited<
    ReturnType<typeof loadAuthoritativeAiBusinessContext>
  >["source"]["activeConfiguration"]["snapshot"],
) {
  const preorder = snapshot.preorder_experiences.find(
    ({ key }) => key === "bakery_preorder",
  );
  if (!preorder) {
    throw new Error("Missing Bedford preorder.");
  }
  const locationIds = snapshot.preorder_experience_locations
    .filter(
      (association) =>
        association.preorder_key === preorder.key && association.is_active,
    )
    .map(({ location_id }) => location_id);
  return {
    op: "set_preorder_experience" as const,
    key: preorder.key,
    product_object_key: preorder.product_object_key,
    customer_object_key: preorder.customer_object_key,
    order_object_key: preorder.order_object_key,
    order_item_object_key: preorder.order_item_object_key,
    customer_places_order_relationship_key:
      preorder.customer_places_order_relationship_key,
    order_contains_item_relationship_key:
      preorder.order_contains_item_relationship_key,
    product_appears_in_item_relationship_key:
      preorder.product_appears_in_item_relationship_key,
    config_json: {
      ...preorder.config_json,
      schedule: {
        ...preorder.config_json.schedule,
        slot_capacity: 9,
      },
    },
    allowed_location_ids: locationIds,
    is_active: preorder.is_active,
  };
}

describe("Milestone 6 Phase 3A authenticated AI Business context", () => {
  beforeAll(async () => {
    settings = getLocalSupabaseSettings();
    execFileSync(process.execPath, ["scripts/demo-seed.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    sql = postgres(settings.databaseUrl, { max: 2 });
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
    [owner, staff, administrator, outsider] = await Promise.all([
      signIn("demo@smbos.local"),
      signIn("staff@smbos.local"),
      createIdentity("admin"),
      createIdentity("outsider"),
    ]);
    business = requireData(
      await owner.client
        .from("businesses")
        .select("*")
        .eq("slug", "bedford-bakery-demo")
        .single(),
      "Could not load Bedford Bakery.",
    );
    outsiderBusiness = requireData(
      await outsider.client.rpc("create_business", {
        business_name: `Context outsider ${crypto.randomUUID()}`,
        requested_business_type: "test",
        requested_timezone: "Europe/London",
      }),
      "Could not create the outsider Business.",
    );
    createdBusinessIds.push(outsiderBusiness.id);
    const membership = await serviceRole.from("business_memberships").insert({
      business_id: business.id,
      user_id: administrator.user.id,
      role: "admin",
    });
    if (membership.error) {
      throw membership.error;
    }

    const inactiveLocation = requireData(
      await owner.client.rpc("create_location", {
        target_business_id: business.id,
        location_name: "Closed kiosk",
        requested_timezone: "Europe/London",
      }),
      "Could not create the inactive context Location.",
    );
    const deactivated = await owner.client
      .from("locations")
      .update({ is_active: false })
      .eq("business_id", business.id)
      .eq("id", inactiveLocation.id);
    if (deactivated.error) {
      throw deactivated.error;
    }
  }, 180_000);

  afterAll(async () => {
    if (sql) {
      for (const businessId of [business?.id, ...createdBusinessIds]) {
        if (businessId) {
          await sql`
            delete from public.businesses
            where id = ${businessId}::uuid
          `;
        }
      }
      await sql.end();
    }
    if (serviceRole) {
      for (const userId of createdUserIds) {
        await serviceRole.auth.admin.deleteUser(userId);
      }
    }
  });

  it("loads clean Bedford Version 2 with complete safe configuration and no operational values", async () => {
    const beforeAiRuns = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from public.ai_execution_runs
      where business_id = ${business.id}::uuid
    `;
    const bundle = await buildAiBusinessContext(owner.client, {
      businessId: business.id,
    });
    const context = bundle.modelContext;
    const serialized = serializeAiBusinessModelContext(context);
    bedfordBytes = bundle.serializedBytes;

    expect(context.business).toEqual({
      name: "Bedford Bakery",
      business_type: "bakery",
      timezone: "Europe/London",
    });
    expect(context.access).toEqual({
      role: "owner",
      capabilities: ["manage_configuration"],
    });
    expect(context.active_configuration).toEqual({
      version_number: 2,
      revision: 2,
    });
    expect(bundle.currentness.baseVersionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(bundle.currentness.headRevision).toBe(2);
    expect(serialized).not.toContain(bundle.currentness.baseVersionId);

    expect(context.locations).toEqual([
      expect.objectContaining({ name: "Bedford", is_active: true }),
      expect.objectContaining({ name: "Closed kiosk", is_active: false }),
      expect.objectContaining({ name: "Milton Keynes", is_active: true }),
    ]);
    expect(context.objects.map(({ key }) => key)).toEqual([
      "customer",
      "order",
      "order_item",
      "product",
    ]);
    expect(context.relationships.map(({ key }) => key)).toEqual([
      "customer_places_order",
      "order_contains_order_item",
      "product_appears_in_order_item",
    ]);
    expect(context.views.map(({ key }) => key)).toEqual([
      "order_detail",
      "orders",
    ]);
    expect(context.forms.map(({ key }) => key)).toEqual(["order_status_edit"]);
    expect(context.pages.map(({ key }) => key)).toEqual([
      "orders_workspace",
      "public_preorder",
    ]);

    const publicPage = context.pages.find(
      ({ key }) => key === "public_preorder",
    );
    expect(publicPage).toMatchObject({
      status: "published",
      audience: "public",
    });
    const preorder = context.preorder_experiences.find(
      ({ key }) => key === "bakery_preorder",
    );
    expect(preorder).toMatchObject({
      schedule: {
        days_of_week: [6, 7],
        cutoff_hours: 48,
        slot_capacity: 10,
      },
      allowed_locations: [
        expect.objectContaining({ name: "Bedford" }),
        expect.objectContaining({ name: "Milton Keynes" }),
      ],
    });
    expect(preorder?.public_fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Phone", required: false }),
        expect.objectContaining({
          label: "Dietary requirements",
          required: false,
        }),
        expect.objectContaining({ label: "Occasion", required: false }),
      ]),
    );
    expect(
      context.objects
        .find(({ key }) => key === "customer")
        ?.fields.find(({ key }) => key === "phone")?.required,
    ).toBe(false);

    for (const forbidden of [
      "Afternoon Tea Box",
      "Celebration Box",
      "Kids Afternoon Tea",
      "candidate_snapshot_json",
      "semantic_diff_json",
      "validation_result_json",
      "business_ai_settings",
      "ai_execution_runs",
      "configuration_change_sets",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(bundle.serializedBytes).toBeLessThan(128 * 1024);
    expect(new TextEncoder().encode(serialized).byteLength).toBe(
      bundle.serializedBytes,
    );

    const afterAiRuns = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from public.ai_execution_runs
      where business_id = ${business.id}::uuid
    `;
    expect(beforeAiRuns[0]?.count).toBe(0);
    expect(afterAiRuns[0]?.count).toBe(0);
  });

  it("allows Owner/Admin and denies Staff, anonymous, cross-Business, and deleted membership", async () => {
    await expect(
      buildAiBusinessContext(owner.client, { businessId: business.id }),
    ).resolves.toMatchObject({
      modelContext: { access: { role: "owner" } },
    });
    await expect(
      buildAiBusinessContext(administrator.client, {
        businessId: business.id,
      }),
    ).resolves.toMatchObject({
      modelContext: { access: { role: "admin" } },
    });
    await expect(
      buildAiBusinessContext(staff.client, { businessId: business.id }),
    ).rejects.toMatchObject({ code: "ai_context_unauthorized" });
    await expect(
      buildAiBusinessContext(anonymous, { businessId: business.id }),
    ).rejects.toMatchObject({ code: "ai_context_unauthorized" });
    await expect(
      buildAiBusinessContext(outsider.client, { businessId: business.id }),
    ).rejects.toMatchObject({ code: "ai_context_not_found" });
    await expect(
      buildAiBusinessContext(owner.client, {
        businessId: outsiderBusiness.id,
      }),
    ).rejects.toMatchObject({ code: "ai_context_not_found" });

    const removed = await serviceRole
      .from("business_memberships")
      .delete()
      .eq("business_id", business.id)
      .eq("user_id", administrator.user.id);
    if (removed.error) {
      throw removed.error;
    }
    await expect(
      buildAiBusinessContext(administrator.client, {
        businessId: business.id,
      }),
    ).rejects.toMatchObject({ code: "ai_context_not_found" });
  });

  it("performs an exact read-only load with no head, version, projection, operational, proposal, Location, or AI write", async () => {
    const before = await captureReadState();
    const bundle = await buildAiBusinessContext(owner.client, {
      businessId: business.id,
    });
    const after = await captureReadState();

    expect(bundle.serializedBytes).toBe(bedfordBytes);
    expect(after).toEqual(before);
  });

  it("excludes a unique PII Record marker and is unchanged by operational Record writes", async () => {
    const before = await buildAiBusinessContext(owner.client, {
      businessId: business.id,
    });
    const customer = requireData(
      await owner.client
        .from("object_definitions")
        .select("id")
        .eq("business_id", business.id)
        .eq("key", "customer")
        .single(),
      "Could not load the Customer Object.",
    );
    await createGraphService(owner.client, {
      businessId: business.id,
    }).createRecord({
      objectDefinitionId: customer.id,
      data: {
        name: piiMarker,
        email: `${piiMarker.toLowerCase()}@example.test`,
      },
      recordStatus: "active",
    });
    const after = await buildAiBusinessContext(owner.client, {
      businessId: business.id,
    });
    const serialized = serializeAiBusinessModelContext(after.modelContext);

    expect(serialized).not.toContain(piiMarker);
    expect(serialized).not.toContain(piiMarker.toLowerCase());
    expect(after).toEqual(before);
  });

  it("ignores an open proposal, then reflects only its deliberate application as a new active version", async () => {
    const before = await buildAiBusinessContext(owner.client, {
      businessId: business.id,
    });
    const authoritative = await loadAuthoritativeAiBusinessContext(
      owner.client,
      { businessId: business.id },
    );
    const configuration = new ConfigurationChangeService(owner.client, {
      businessId: business.id,
      actorId: owner.user.id,
    });
    const proposal = await configuration.proposeChangeSet({
      expectedBaseVersionId: authoritative.currentness.baseVersionId,
      expectedHeadRevision: authoritative.currentness.headRevision,
      title: "Reduce preorder capacity for context acceptance",
      description: "A deliberate Phase 3A active-version proof.",
      operations: [
        completePreorderOperation(
          authoritative.source.activeConfiguration.snapshot,
        ),
      ],
    });
    expect(proposal.status).toBe("proposed");

    const whileOpen = await buildAiBusinessContext(owner.client, {
      businessId: business.id,
    });
    expect(whileOpen).toEqual(before);
    const validated = await configuration.validateChangeSet(proposal.id);
    expect(validated.status).toBe("validated");
    const applied = await configuration.applyChangeSet(proposal.id);
    expect(applied.status).toBe("applied");

    const after = await buildAiBusinessContext(owner.client, {
      businessId: business.id,
    });
    expect(after.currentness.baseVersionId).not.toBe(
      before.currentness.baseVersionId,
    );
    expect(after.currentness.headRevision).toBe(3);
    expect(after.modelContext.active_configuration).toEqual({
      version_number: 3,
      revision: 3,
    });
    expect(
      after.modelContext.preorder_experiences.find(
        ({ key }) => key === "bakery_preorder",
      )?.schedule.slot_capacity,
    ).toBe(9);
    expect(serializeAiBusinessModelContext(after.modelContext)).not.toContain(
      piiMarker,
    );
    const [aiRuns] = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from public.ai_execution_runs
      where business_id = ${business.id}::uuid
    `;
    expect(aiRuns?.count).toBe(0);
  });

  it("records the accepted Bedford serialized byte size", () => {
    expect(bedfordBytes).toBeGreaterThan(1_000);
    expect(bedfordBytes).toBeLessThan(128 * 1024);
    console.info(
      `Bedford AI model context: ${bedfordBytes} bytes (128 KiB hard limit).`,
    );
  });
});
