import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { expect, test as base } from "@playwright/test";
import type { Page } from "@playwright/test";

import type { Database } from "../../../src/db/supabase/database.types";

interface ProofSettings {
  apiUrl: string;
  appUrl: string;
  databaseUrl: string;
  projectId: string;
  publishableKey: string;
  serviceRoleKey: string;
  workdir: string;
}

interface BrowserProofBusiness {
  id: string;
  slug: string;
}

interface PagesProofFixture {
  readonly businessName: string;
  readonly email: string;
  readonly password: string;
  createBusinessThroughOwnerUi(page: Page): Promise<BrowserProofBusiness>;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the isolated Page browser proof.`);
  }
  return value;
}

function proofSettings(): ProofSettings {
  const appUrl = new URL(requiredEnvironment("SMBOS_PAGES_PROOF_APP_URL"));
  const apiUrl = new URL(requiredEnvironment("SMBOS_PAGES_PROOF_API_URL"));
  const apiPort = requiredEnvironment("SMBOS_PAGES_PROOF_API_PORT");
  const databaseUrl = new URL(requiredEnvironment("SMBOS_PAGES_PROOF_DB_URL"));
  const databasePort = requiredEnvironment("SMBOS_PAGES_PROOF_DB_PORT");
  const projectId = requiredEnvironment("SMBOS_PAGES_PROOF_PROJECT_ID");
  const workdir = requiredEnvironment("SMBOS_PAGES_PROOF_WORKDIR");
  const runId = requiredEnvironment("GITHUB_RUN_ID");
  const attempt = requiredEnvironment("GITHUB_RUN_ATTEMPT");
  const expectedTarget = `smbos-pages-proof-${runId}-${attempt}`;

  if (
    appUrl.protocol !== "http:" ||
    appUrl.hostname !== "127.0.0.1" ||
    appUrl.port !== "3100" ||
    apiUrl.protocol !== "http:" ||
    apiUrl.hostname !== "127.0.0.1" ||
    apiUrl.port !== apiPort ||
    !["postgres:", "postgresql:"].includes(databaseUrl.protocol) ||
    databaseUrl.hostname !== "127.0.0.1" ||
    databaseUrl.port !== databasePort ||
    projectId !== expectedTarget ||
    !workdir.endsWith(`/${expectedTarget}`)
  ) {
    throw new Error(
      "The Page browser proof accepts only its runner-owned loopback target.",
    );
  }

  return {
    apiUrl: apiUrl.toString().replace(/\/$/, ""),
    appUrl: appUrl.toString().replace(/\/$/, ""),
    databaseUrl: databaseUrl.toString(),
    projectId,
    publishableKey: requiredEnvironment("SMBOS_PAGES_PROOF_PUBLISHABLE_KEY"),
    serviceRoleKey: requiredEnvironment("SMBOS_PAGES_PROOF_SERVICE_ROLE_KEY"),
    workdir,
  };
}

async function removeFixture(
  admin: ReturnType<typeof createClient<Database>>,
  databaseUrl: string,
  businessId: string | null,
  userId: string,
): Promise<void> {
  const failures: string[] = [];

  if (businessId) {
    const fixtureSql = postgres(databaseUrl, { max: 1 });
    try {
      await fixtureSql.unsafe(
        "delete from public.site_states where business_id = $1::uuid",
        [businessId],
      );
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "unknown";
      failures.push(`Site cleanup failed (${code})`);
    } finally {
      await fixtureSql.end({ timeout: 5 });
    }
    const { error } = await admin
      .from("businesses")
      .delete()
      .eq("id", businessId);
    if (error)
      failures.push(`business cleanup failed (${error.code ?? "unknown"})`);
  }

  const { error: userError } = await admin.auth.admin.deleteUser(userId);
  if (userError) {
    failures.push(`account cleanup failed (${userError.status ?? "unknown"})`);
  }

  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }
}

export const test = base.extend<{ pagesProof: PagesProofFixture }>({
  pagesProof: async ({ browser }, provideFixture) => {
    void browser;
    const settings = proofSettings();
    const suffix = randomUUID().replaceAll("-", "");
    const email = `pages-proof-${suffix}@example.test`;
    const password = `BrowserProof-${suffix.slice(0, 20)}!`;
    const businessName = `Browser proof ${suffix.slice(0, 8)}`;
    const admin = createClient<Database>(
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
    const created = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password,
    });
    if (created.error || !created.data.user) {
      throw (
        created.error ?? new Error("Could not create the browser-proof owner.")
      );
    }

    let businessId: string | null = null;
    const fixture: PagesProofFixture = {
      businessName,
      email,
      password,
      async createBusinessThroughOwnerUi(page): Promise<BrowserProofBusiness> {
        await page.goto(`${settings.appUrl}/sign-in`);
        await page.getByLabel("Email").fill(email);
        await page.getByLabel("Password").fill(password);
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "Create a business" }),
        ).toBeVisible();

        await page.getByLabel("Business name").fill(businessName);
        await page.getByLabel("Business type").fill("other");
        await page.getByLabel("Timezone").fill("UTC");
        await page
          .getByRole("button", { name: "Create business", exact: true })
          .click();
        await page.waitForURL(/\/app\/[^/?#]+$/);

        const match = new URL(page.url()).pathname.match(/^\/app\/([^/]+)$/);
        if (!match?.[1]) {
          throw new Error(
            "The normal owner onboarding flow did not open its Business.",
          );
        }
        const slug = decodeURIComponent(match[1]);
        const { data, error } = await admin
          .from("businesses")
          .select("id")
          .eq("slug", slug)
          .maybeSingle();
        if (error || !data) {
          throw error ?? new Error("The browser-proof Business was not found.");
        }
        businessId = data.id;
        return { id: data.id, slug };
      },
    };

    try {
      await provideFixture(fixture);
    } finally {
      await removeFixture(
        admin,
        settings.databaseUrl,
        businessId,
        created.data.user.id,
      );
    }
  },
});

export { expect };
