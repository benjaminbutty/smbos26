import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getEnvironment } from "../../env";
import type { Database } from "./database.types";

export function createAdminClient() {
  const environment = getEnvironment();
  if (!environment.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required for trusted preorder writes.",
    );
  }

  return createClient<Database>(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
}
