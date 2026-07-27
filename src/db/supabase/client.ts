"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getEnvironment } from "../../env";
import type { Database } from "./database.types";

export function createClient() {
  const env = getEnvironment();

  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
