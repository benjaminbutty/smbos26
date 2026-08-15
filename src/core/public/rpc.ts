import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "../../db/supabase/database.types";

export interface PublicRpcResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

export async function callPublicRpc<T>(
  client: SupabaseClient<Database>,
  functionName: string,
  args: Record<string, Json>,
): Promise<PublicRpcResult<T>> {
  const rpc = client.rpc as unknown as (
    name: string,
    parameters: Record<string, Json>,
  ) => Promise<PublicRpcResult<T>>;
  return rpc.call(client, functionName, args);
}
