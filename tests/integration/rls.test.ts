import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database, Tables } from "../../src/db/supabase/database.types";
import { getLocalSupabaseSettings } from "./support/local-supabase";

type Client = SupabaseClient<Database>;
type Business = Tables<"businesses">;
type Location = Tables<"locations">;

interface TestIdentity {
  client: Client;
  user: User;
}

const password = "Milestone-1-test-password!";
const createdUserIds: string[] = [];

let admin: Client;
let ownerA: TestIdentity;
let ownerB: TestIdentity;
let staffA: TestIdentity;
let administratorA: TestIdentity;
let dualMember: TestIdentity;
let businessA: Business;
let businessB: Business;
let ownerLocation: Location;

async function createIdentity(label: string): Promise<TestIdentity> {
  const settings = getLocalSupabaseSettings();
  const email = `m1-${Date.now()}-${label}-${crypto.randomUUID()}@example.test`;
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

  if (createError || !created.user) {
    throw createError ?? new Error(`Could not create test identity ${label}`);
  }

  createdUserIds.push(created.user.id);

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

  return { client, user: created.user };
}

async function createOwnedBusiness(
  identity: TestIdentity,
  name: string,
): Promise<Business> {
  const { data, error } = await identity.client.rpc("create_business", {
    business_name: name,
    requested_business_type: "test",
    requested_timezone: "Europe/London",
  });

  if (error || !data) {
    throw error ?? new Error(`Could not create test business ${name}`);
  }

  return data;
}

describe("tenant row level security", () => {
  beforeAll(async () => {
    const settings = getLocalSupabaseSettings();
    admin = createClient<Database>(settings.apiUrl, settings.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });

    [ownerA, ownerB, staffA, administratorA, dualMember] = await Promise.all([
      createIdentity("owner-a"),
      createIdentity("owner-b"),
      createIdentity("staff-a"),
      createIdentity("admin-a"),
      createIdentity("dual-member"),
    ]);

    businessA = await createOwnedBusiness(
      ownerA,
      `Business A ${crypto.randomUUID()}`,
    );
    businessB = await createOwnedBusiness(
      ownerB,
      `Business B ${crypto.randomUUID()}`,
    );

    const { error: membershipError } = await admin
      .from("business_memberships")
      .insert([
        {
          business_id: businessA.id,
          user_id: staffA.user.id,
          role: "staff",
        },
        {
          business_id: businessA.id,
          user_id: administratorA.user.id,
          role: "admin",
        },
        {
          business_id: businessA.id,
          user_id: dualMember.user.id,
          role: "staff",
        },
        {
          business_id: businessB.id,
          user_id: dualMember.user.id,
          role: "staff",
        },
      ]);

    if (membershipError) {
      throw membershipError;
    }
  });

  afterAll(async () => {
    if (admin && businessA && businessB) {
      await admin
        .from("businesses")
        .delete()
        .in("id", [businessA.id, businessB.id]);
    }

    if (admin) {
      for (const userId of createdUserIds) {
        await admin.auth.admin.deleteUser(userId);
      }
    }
  });

  it("lets a Business A member read Business A", async () => {
    const { data, error } = await ownerA.client
      .from("businesses")
      .select("id, name")
      .eq("id", businessA.id)
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBe(businessA.id);
  });

  it("does not let a Business A member read Business B", async () => {
    const { data, error } = await ownerA.client
      .from("businesses")
      .select("id")
      .eq("id", businessB.id);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("does not let a Business A member update Business B", async () => {
    const originalName = businessB.name;
    const { data, error } = await ownerA.client
      .from("businesses")
      .update({ name: "Unauthorized change" })
      .eq("id", businessB.id)
      .select("id");

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: unchanged } = await admin
      .from("businesses")
      .select("name")
      .eq("id", businessB.id)
      .single();
    expect(unchanged?.name).toBe(originalName);
  });

  it("rejects a Location created with another tenant's business ID", async () => {
    const { error } = await ownerA.client.from("locations").insert({
      business_id: businessB.id,
      name: "Intruding location",
      slug: `intruding-${crypto.randomUUID()}`,
      timezone: "UTC",
    });

    expect(error?.code).toBe("42501");
  });

  it("lets an Owner create, edit, and deactivate their own Locations", async () => {
    const { data: created, error: createError } = await ownerA.client.rpc(
      "create_location",
      {
        target_business_id: businessA.id,
        location_name: "Owner location",
        requested_timezone: "Europe/London",
      },
    );

    expect(createError).toBeNull();
    expect(created?.business_id).toBe(businessA.id);
    if (!created) {
      throw new Error("Owner location was not created");
    }
    ownerLocation = created;

    const { data: updated, error: updateError } = await ownerA.client
      .from("locations")
      .update({ name: "Owner location updated", is_active: false })
      .eq("id", ownerLocation.id)
      .select("name, is_active")
      .single();

    expect(updateError).toBeNull();
    expect(updated).toEqual({
      name: "Owner location updated",
      is_active: false,
    });
  });

  it("prevents Staff from managing Locations or business configuration", async () => {
    const { data: visibleLocations, error: readError } = await staffA.client
      .from("locations")
      .select("id")
      .eq("id", ownerLocation.id);
    expect(readError).toBeNull();
    expect(visibleLocations).toEqual([{ id: ownerLocation.id }]);

    const { error: insertError } = await staffA.client
      .from("locations")
      .insert({
        business_id: businessA.id,
        name: "Staff location",
        slug: `staff-${crypto.randomUUID()}`,
        timezone: "UTC",
      });
    expect(insertError?.code).toBe("42501");

    const { data: locationUpdate, error: locationError } = await staffA.client
      .from("locations")
      .update({ name: "Staff changed this" })
      .eq("id", ownerLocation.id)
      .select("id");
    expect(locationError).toBeNull();
    expect(locationUpdate).toEqual([]);

    const { data: businessUpdate, error: businessError } = await staffA.client
      .from("businesses")
      .update({ timezone: "UTC" })
      .eq("id", businessA.id)
      .select("id");
    expect(businessError).toBeNull();
    expect(businessUpdate).toEqual([]);
  });

  it("lets one user legitimately access both of their businesses", async () => {
    const { data, error } = await dualMember.client
      .from("businesses")
      .select("id")
      .in("id", [businessA.id, businessB.id])
      .order("id");

    expect(error).toBeNull();
    expect(data?.map(({ id }) => id).sort()).toEqual(
      [businessA.id, businessB.id].sort(),
    );
  });

  it("does not grant access when another business slug is known", async () => {
    const { data, error } = await ownerA.client
      .from("businesses")
      .select("id")
      .eq("slug", businessB.slug);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("enforces globally unique business slugs", async () => {
    const { error } = await admin.from("businesses").insert({
      name: "Duplicate slug",
      slug: businessA.slug,
      business_type: "test",
      timezone: "UTC",
    });

    expect(error?.code).toBe("23505");
  });

  it("enforces immutable business slugs", async () => {
    const { error } = await ownerA.client
      .from("businesses")
      .update({ slug: `changed-${crypto.randomUUID()}` })
      .eq("id", businessA.id);

    expect(error?.code).toBe("22023");
  });

  it("lets Admin manage locations but not change ownership", async () => {
    const { data: location, error: locationError } =
      await administratorA.client.rpc("create_location", {
        target_business_id: businessA.id,
        location_name: "Admin location",
        requested_timezone: "UTC",
      });

    expect(locationError).toBeNull();
    expect(location?.business_id).toBe(businessA.id);

    const { data: configured, error: configurationError } =
      await administratorA.client
        .from("businesses")
        .update({ timezone: "UTC" })
        .eq("id", businessA.id)
        .select("timezone")
        .single();
    expect(configurationError).toBeNull();
    expect(configured?.timezone).toBe("UTC");

    const { data: ownerMembership } = await admin
      .from("business_memberships")
      .select("id")
      .eq("business_id", businessA.id)
      .eq("user_id", ownerA.user.id)
      .single();
    const { data: changed, error } = await administratorA.client
      .from("business_memberships")
      .update({ role: "staff" })
      .eq("id", ownerMembership?.id ?? "")
      .select("id");

    expect(error).toBeNull();
    expect(changed).toEqual([]);
  });

  it("does not allow the last Owner to orphan a business", async () => {
    const { data: ownerMembership } = await ownerA.client
      .from("business_memberships")
      .select("id")
      .eq("business_id", businessA.id)
      .eq("user_id", ownerA.user.id)
      .single();
    const { error } = await ownerA.client
      .from("business_memberships")
      .update({ role: "staff" })
      .eq("id", ownerMembership?.id ?? "");

    expect(error?.code).toBe("23514");
  });
});
