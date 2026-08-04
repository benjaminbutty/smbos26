import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Tables } from "../../../src/db/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * Test-only helper that exercises the same currentness-bound Location RPC
 * sequence used by the application service.
 */
export async function createLocationWithCurrentness(
  client: Client,
  actorId: string | undefined,
  businessId: string,
  name: string,
  timezone: string,
): Promise<{
  data: Tables<"locations"> | null;
  error: { message: string } | null;
}> {
  const resolvedActorId =
    actorId ?? (await client.auth.getUser()).data.user?.id;
  if (!resolvedActorId) {
    return {
      data: null,
      error: { message: "Authenticated actor was missing." },
    };
  }
  const state = await client.rpc("get_location_creation_state", {
    expected_actor_id: resolvedActorId,
    expected_business_id: businessId,
  });
  const current = state.data?.[0];
  if (state.error || !current) {
    return {
      data: null,
      error: state.error ?? { message: "Location creation state was empty." },
    };
  }

  return client.rpc("create_location", {
    expected_actor_id: resolvedActorId,
    expected_business_id: businessId,
    expected_business_timezone: current.business_timezone,
    expected_location_state_digest: current.location_state_digest,
    location_name: name,
    requested_timezone: timezone,
  });
}
