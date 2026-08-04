import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database, Tables } from "../../src/db/supabase/database.types";
import { normalizeLocationName } from "../../src/core/locations/schemas";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";

type Client = SupabaseClient<Database>;

const password = "Milestone-10-location-boundary-test-password!";
let settings: LocalSupabaseSettings;
let serviceRole: Client;
let owner: { client: Client; user: User };
let business: Tables<"businesses">;

function requireData<T>(
  result: { data: T; error: { message: string } | null },
  message: string,
): NonNullable<T> {
  if (result.error || result.data === null) {
    throw new Error(`${message}: ${result.error?.message ?? "No data"}`);
  }
  return result.data as NonNullable<T>;
}

async function createStatefulClient(): Promise<{ client: Client; user: User }> {
  const email = `m10-location-${crypto.randomUUID()}@example.test`;
  const created = await serviceRole.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error("Could not create Location test Owner.");
  }
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
    throw signedIn.error ?? new Error("Could not sign in Location test Owner.");
  }
  return { client, user: signedIn.data.user };
}

async function readState() {
  const state = requireData(
    await owner.client.rpc("get_location_creation_state", {
      expected_actor_id: owner.user.id,
      expected_business_id: business.id,
    }),
    "Could not read Location creation state.",
  );
  const current = state[0];
  if (!current) {
    throw new Error("Location creation state returned no row.");
  }
  return current;
}

async function createWithState(
  name: string,
  timezone: string,
  state?: Awaited<ReturnType<typeof readState>>,
) {
  const current = state ?? (await readState());
  return owner.client.rpc("create_location", {
    expected_actor_id: owner.user.id,
    expected_business_id: business.id,
    expected_business_timezone: current.business_timezone,
    expected_location_state_digest: current.location_state_digest,
    location_name: name,
    requested_timezone: timezone,
  });
}

describe("Milestone 10 Location operational boundary", () => {
  beforeAll(async () => {
    settings = getLocalSupabaseSettings();
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
    owner = await createStatefulClient();
    business = requireData(
      await owner.client.rpc("create_business", {
        business_name: `Location boundary ${crypto.randomUUID()}`,
        requested_business_type: "test",
        requested_timezone: "Europe/London",
      }),
      "Could not create Location boundary Business.",
    );
  }, 120_000);

  afterAll(async () => {
    if (business) {
      await serviceRole.from("businesses").delete().eq("id", business.id);
    }
    const user = owner ? await owner.client.auth.getUser() : null;
    if (user?.data.user && serviceRole) {
      await serviceRole.auth.admin.deleteUser(user.data.user.id);
    }
  });

  it("reads bounded currentness and creates one ordinary Location", async () => {
    const state = await readState();
    expect(state.schema_version).toBe(1);
    expect(state.business_id).toBe(business.id);
    expect(state.actor_id).toBe(owner.user.id);
    expect(state.business_timezone).toBe("Europe/London");
    expect(state.location_state_digest).toMatch(/^[a-f0-9]{64}$/);

    const created = requireData(
      await createWithState("Cambridge", "Europe/London", state),
      "Could not create Cambridge.",
    );
    expect(created.business_id).toBe(business.id);
    expect(created.slug).toBe("cambridge");
    const afterCreate = await readState();
    expect(afterCreate.location_state_digest).not.toBe(
      state.location_state_digest,
    );
  });

  it("enforces active and inactive normalized-name identity reservation", async () => {
    const active = await createWithState("Cambridge", "Europe/London");
    expect(active.error?.message).toContain("location_active_duplicate");

    const deactivated = await owner.client
      .from("locations")
      .update({ is_active: false })
      .eq("business_id", business.id)
      .eq("name", "Cambridge")
      .select("id")
      .single();
    expect(deactivated.error).toBeNull();

    const inactive = await createWithState(" CAMBRIDGE ", "Europe/London");
    expect(inactive.error?.message).toContain("location_inactive_duplicate");

    const beforeTimezoneChange = await readState();
    const changed = await owner.client
      .from("locations")
      .update({ timezone: "America/New_York" })
      .eq("business_id", business.id)
      .eq("name", "Cambridge")
      .select("id")
      .single();
    expect(changed.error).toBeNull();
    const afterTimezoneChange = await readState();
    expect(afterTimezoneChange.location_state_digest).not.toBe(
      beforeTimezoneChange.location_state_digest,
    );
  });

  it("rejects invalid IANA timezones and direct authenticated inserts", async () => {
    const invalid = await createWithState("Leeds", "Mars/Olympus");
    expect(invalid.error?.message).toContain("location_timezone_invalid");

    const direct = await owner.client.from("locations").insert({
      business_id: business.id,
      name: "Direct insert",
      slug: `direct-${crypto.randomUUID()}`,
      timezone: "Europe/London",
    });
    expect(direct.error?.code).toBe("42501");

    const invalidUpdate = await owner.client
      .from("locations")
      .update({ timezone: "Mars/Olympus" })
      .eq("business_id", business.id)
      .eq("name", "Cambridge");
    expect(invalidUpdate.error?.message).toContain("location_timezone_invalid");

    const legacy = await owner.client.rpc("create_location", {
      expected_business_id: business.id,
      location_name: "Legacy signature",
      requested_timezone: "Europe/London",
    } as never);
    expect(legacy.error?.message).toMatch(
      /Could not find the function public\.create_location.*schema cache/i,
    );
  });

  it("uses one database-backed canonical identity for Unicode-equivalent names", async () => {
    const composed = await createWithState("Café", "Europe/London");
    expect(composed.error).toBeNull();

    const state = await readState();
    const summaries = state.locations as Array<{
      name: string;
      normalized_name: string;
    }>;
    expect(
      summaries.find((location) => location.name === "Café")?.normalized_name,
    ).toBe(normalizeLocationName("Café"));

    const decomposed = await createWithState("Cafe\u0301", "Europe/London");
    expect(decomposed.error?.message).toContain("location_active_duplicate");

    const fullWidth = await createWithState(
      "Ｆｕｌｌｗｉｄｔｈ",
      "Europe/London",
    );
    expect(fullWidth.error).toBeNull();
    const compatibilityDuplicate = await createWithState(
      "fullwidth",
      "Europe/London",
    );
    expect(compatibilityDuplicate.error?.message).toContain(
      "location_active_duplicate",
    );
  });

  it("serializes concurrent confirmations to one success and one bounded conflict", async () => {
    const state = await readState();
    const results = await Promise.all([
      createWithState("York", "Europe/London", state),
      createWithState("York", "Europe/London", state),
    ]);
    expect(results.filter((result) => !result.error)).toHaveLength(1);
    expect(results.filter((result) => result.error)).toHaveLength(1);
    expect(results.find((result) => result.error)?.error?.message).toMatch(
      /location_(?:creation_state_changed|active_duplicate)/,
    );
    const rows = requireData(
      await owner.client
        .from("locations")
        .select("id")
        .eq("business_id", business.id)
        .eq("name", "York"),
      "Could not read York Locations.",
    );
    expect(rows).toHaveLength(1);
  });
});
