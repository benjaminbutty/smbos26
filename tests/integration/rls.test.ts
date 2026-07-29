import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database, Tables } from "../../src/db/supabase/database.types";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";

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
let membershipTarget: TestIdentity;
let concurrentOwnerA: TestIdentity;
let concurrentOwnerB: TestIdentity;
let businessA: Business;
let businessB: Business;
let concurrentBusiness: Business;
let ownerLocation: Location;
let databaseUrl: string;

async function createIdentity(
  label: string,
  settings: LocalSupabaseSettings,
): Promise<TestIdentity> {
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

function createBarrier(participants: number): () => Promise<void> {
  let arrived = 0;
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  return async () => {
    arrived += 1;
    if (arrived === participants) {
      release();
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for concurrent transactions."));
      }, 5_000);

      void released.then(() => {
        clearTimeout(timeout);
        resolve();
      }, reject);
    });
  };
}

async function demoteOwnerInTransaction(
  identity: TestIdentity,
  businessId: string,
  waitAtBarrier: () => Promise<void>,
): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    await sql.begin(async (transaction) => {
      await transaction.unsafe("set local role authenticated");
      await transaction`
        select set_config(
          'request.jwt.claim.sub',
          ${identity.user.id},
          true
        )
      `;
      await transaction`
        select set_config(
          'request.jwt.claim.role',
          'authenticated',
          true
        )
      `;
      await transaction`
        select set_config(
          'request.jwt.claims',
          ${JSON.stringify({
            role: "authenticated",
            sub: identity.user.id,
          })},
          true
        )
      `;

      const updated = await transaction`
        update public.business_memberships
        set role = 'staff'::public.business_role
        where business_id = ${businessId}::uuid
          and user_id = ${identity.user.id}::uuid
        returning id
      `;

      if (updated.length !== 1) {
        throw new Error("The authenticated Owner membership was not updated.");
      }

      await waitAtBarrier();
    });
  } finally {
    await sql.end();
  }
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
    databaseUrl = settings.databaseUrl;
    admin = createClient<Database>(settings.apiUrl, settings.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });

    [
      ownerA,
      ownerB,
      staffA,
      administratorA,
      dualMember,
      membershipTarget,
      concurrentOwnerA,
      concurrentOwnerB,
    ] = await Promise.all([
      createIdentity("owner-a", settings),
      createIdentity("owner-b", settings),
      createIdentity("staff-a", settings),
      createIdentity("admin-a", settings),
      createIdentity("dual-member", settings),
      createIdentity("membership-target", settings),
      createIdentity("concurrent-owner-a", settings),
      createIdentity("concurrent-owner-b", settings),
    ]);

    businessA = await createOwnedBusiness(
      ownerA,
      `Business A ${crypto.randomUUID()}`,
    );
    businessB = await createOwnedBusiness(
      ownerB,
      `Business B ${crypto.randomUUID()}`,
    );
    concurrentBusiness = await createOwnedBusiness(
      concurrentOwnerA,
      `Concurrent Owners ${crypto.randomUUID()}`,
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

    const { error: concurrentOwnerError } = await concurrentOwnerA.client
      .from("business_memberships")
      .insert({
        business_id: concurrentBusiness.id,
        user_id: concurrentOwnerB.user.id,
        role: "owner",
      });

    if (concurrentOwnerError) {
      throw concurrentOwnerError;
    }
  });

  afterAll(async () => {
    if (admin && businessA && businessB && concurrentBusiness) {
      await admin
        .from("businesses")
        .delete()
        .in("id", [businessA.id, businessB.id, concurrentBusiness.id]);
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

  it("does not let an authenticated user insert a Business directly", async () => {
    const { error } = await ownerA.client.from("businesses").insert({
      name: "Directly inserted business",
      slug: `direct-${crypto.randomUUID()}`,
      business_type: "test",
      timezone: "UTC",
    });

    expect(error?.code).toBe("42501");
  });

  it("does not let a Business A Owner create a membership in Business B", async () => {
    const { error } = await ownerA.client.from("business_memberships").insert({
      business_id: businessB.id,
      user_id: membershipTarget.user.id,
      role: "staff",
    });

    expect(error?.code).toBe("42501");
  });

  it("does not let Staff insert, update, or delete memberships", async () => {
    const { error: insertError } = await staffA.client
      .from("business_memberships")
      .insert({
        business_id: businessA.id,
        user_id: membershipTarget.user.id,
        role: "staff",
      });
    expect(insertError?.code).toBe("42501");

    const { data: administratorMembership } = await admin
      .from("business_memberships")
      .select("id")
      .eq("business_id", businessA.id)
      .eq("user_id", administratorA.user.id)
      .single();
    const membershipId = administratorMembership?.id ?? "";

    const { data: updated, error: updateError } = await staffA.client
      .from("business_memberships")
      .update({ role: "staff" })
      .eq("id", membershipId)
      .select("id");
    expect(updateError).toBeNull();
    expect(updated).toEqual([]);

    const { data: deleted, error: deleteError } = await staffA.client
      .from("business_memberships")
      .delete()
      .eq("id", membershipId)
      .select("id");
    expect(deleteError).toBeNull();
    expect(deleted).toEqual([]);

    const { data: unchanged } = await admin
      .from("business_memberships")
      .select("role")
      .eq("id", membershipId)
      .single();
    expect(unchanged?.role).toBe("admin");
  });

  it("does not let Admin create or promote an Owner membership", async () => {
    const { error: insertError } = await administratorA.client
      .from("business_memberships")
      .insert({
        business_id: businessA.id,
        user_id: membershipTarget.user.id,
        role: "owner",
      });
    expect(insertError?.code).toBe("42501");

    const { data: dualMembership } = await admin
      .from("business_memberships")
      .select("id")
      .eq("business_id", businessA.id)
      .eq("user_id", dualMember.user.id)
      .single();
    const { error: promoteError } = await administratorA.client
      .from("business_memberships")
      .update({ role: "owner" })
      .eq("id", dualMembership?.id ?? "");
    expect(promoteError?.code).toBe("42501");

    const { data: unchanged } = await admin
      .from("business_memberships")
      .select("role")
      .eq("id", dualMembership?.id ?? "")
      .single();
    expect(unchanged?.role).toBe("staff");
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

  it("uses archival as the only authenticated per-Location removal path", async () => {
    const permissionSql = postgres(databaseUrl, { max: 1 });
    let permissions:
      | {
          authenticated_can_delete: boolean;
          authenticated_delete_policies: number;
        }
      | undefined;
    try {
      [permissions] = await permissionSql<
        {
          authenticated_can_delete: boolean;
          authenticated_delete_policies: number;
        }[]
      >`
        select
          has_table_privilege(
            'authenticated',
            'public.locations',
            'delete'
          ) as authenticated_can_delete,
          (
            select count(*)::integer
            from pg_policies
            where schemaname = 'public'
              and tablename = 'locations'
              and cmd = 'DELETE'
          ) as authenticated_delete_policies
      `;
    } finally {
      await permissionSql.end();
    }
    expect(permissions).toEqual({
      authenticated_can_delete: false,
      authenticated_delete_policies: 0,
    });

    for (const identity of [ownerA, administratorA]) {
      const attempted = await identity.client
        .from("locations")
        .delete()
        .eq("business_id", businessA.id)
        .eq("id", ownerLocation.id)
        .select("id");
      expect(attempted.error?.code).toBe("42501");
      expect(attempted.data).toBeNull();
    }

    const retained = await admin
      .from("locations")
      .select("id, is_active")
      .eq("business_id", businessA.id)
      .eq("id", ownerLocation.id)
      .single();
    expect(retained.error).toBeNull();
    expect(retained.data).toEqual({
      id: ownerLocation.id,
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

  it("serializes concurrent Owner demotions and retains an Owner", async () => {
    const waitAtBarrier = createBarrier(2);
    const results = await Promise.allSettled([
      demoteOwnerInTransaction(
        concurrentOwnerA,
        concurrentBusiness.id,
        waitAtBarrier,
      ),
      demoteOwnerInTransaction(
        concurrentOwnerB,
        concurrentBusiness.id,
        waitAtBarrier,
      ),
    ]);
    const succeeded = results.filter(({ status }) => status === "fulfilled");
    const failed = results.filter(({ status }) => status === "rejected");

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      reason: { code: "23514" },
      status: "rejected",
    });

    const { data: memberships, error } = await admin
      .from("business_memberships")
      .select("role, user_id")
      .eq("business_id", concurrentBusiness.id);

    expect(error).toBeNull();
    expect(memberships?.filter(({ role }) => role === "owner")).toHaveLength(1);
  });

  it("allows normal Business deletion to cascade memberships", async () => {
    const { data: memberships } = await admin
      .from("business_memberships")
      .select("role, user_id")
      .eq("business_id", concurrentBusiness.id);
    const remainingOwnerId = memberships?.find(
      ({ role }) => role === "owner",
    )?.user_id;
    const remainingOwner =
      remainingOwnerId === concurrentOwnerA.user.id
        ? concurrentOwnerA
        : concurrentOwnerB;

    const { data: deleted, error } = await remainingOwner.client
      .from("businesses")
      .delete()
      .eq("id", concurrentBusiness.id)
      .select("id")
      .single();

    expect(error).toBeNull();
    expect(deleted?.id).toBe(concurrentBusiness.id);

    const { count } = await admin
      .from("business_memberships")
      .select("id", { count: "exact", head: true })
      .eq("business_id", concurrentBusiness.id);
    expect(count).toBe(0);
  });
});
