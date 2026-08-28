import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Database } from "../../src/db/supabase/database.types";
import { getLocalSupabaseSettings } from "./support/local-supabase";

vi.mock("server-only", () => ({}));

import { joinEarlyAccess } from "../../src/app/actions/marketing";
import { EARLY_ACCESS_INITIAL_STATE } from "../../src/components/early-access-form-state";

type Client = SupabaseClient<Database>;

const email = `marketing-${crypto.randomUUID()}@example.test`;
const environmentKeys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;
const previousEnvironment = new Map<string, string | undefined>();

let anonymous: Client;
let databaseUrl: string;

function formData(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) {
    form.set(key, value);
  }
  return form;
}

describe("marketing waitlist production boundary", () => {
  beforeAll(() => {
    const settings = getLocalSupabaseSettings();

    for (const key of environmentKeys) {
      previousEnvironment.set(key, process.env[key]);
    }
    process.env.NEXT_PUBLIC_SUPABASE_URL = settings.apiUrl;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = settings.publishableKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = settings.serviceRoleKey;

    databaseUrl = settings.databaseUrl;
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
  });

  afterAll(async () => {
    if (databaseUrl) {
      const sql = postgres(databaseUrl, { max: 1 });
      try {
        await sql`
          delete from public.marketing_waitlist_signups
          where email = ${email}
        `;
      } finally {
        await sql.end();
      }
    }

    for (const key of environmentKeys) {
      const previous = previousEnvironment.get(key);
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  });

  it("writes only early-access interest through the server action", async () => {
    const sql = postgres(databaseUrl, { max: 1 });
    try {
      const [before] = await sql<{ count: number }[]>`
        select count(*)::integer as count from public.businesses
      `;

      await expect(
        joinEarlyAccess(
          EARLY_ACCESS_INITIAL_STATE,
          formData({
            email,
            businessType: "Catering studio",
          }),
        ),
      ).resolves.toMatchObject({ status: "success" });

      await expect(
        joinEarlyAccess(
          EARLY_ACCESS_INITIAL_STATE,
          formData({
            email,
            businessType: "Different business type",
          }),
        ),
      ).resolves.toMatchObject({ status: "success" });

      const signup = await sql<
        { business_type: string | null; email: string }[]
      >`
        select email, business_type
        from public.marketing_waitlist_signups
        where email = ${email}
      `;
      expect(signup).toEqual([
        {
          email,
          business_type: "Catering studio",
        },
      ]);

      const [after] = await sql<{ count: number }[]>`
        select count(*)::integer as count from public.businesses
      `;
      expect(after?.count).toBe(before?.count);
    } finally {
      await sql.end();
    }

    const publicRead = await anonymous
      .from("marketing_waitlist_signups")
      .select("email");
    expect(publicRead.error).not.toBeNull();
    expect(publicRead.data).toBeNull();
  });
});
