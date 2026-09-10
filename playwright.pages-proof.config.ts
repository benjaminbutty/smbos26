import { defineConfig } from "@playwright/test";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the isolated Page browser proof.`);
  }
  return value;
}

const appUrl = requiredEnvironment("SMBOS_PAGES_PROOF_APP_URL");
const apiUrl = requiredEnvironment("SMBOS_PAGES_PROOF_API_URL");
const publishableKey = requiredEnvironment("SMBOS_PAGES_PROOF_PUBLISHABLE_KEY");
const serviceRoleKey = requiredEnvironment(
  "SMBOS_PAGES_PROOF_SERVICE_ROLE_KEY",
);
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).flatMap(([key, value]) =>
    typeof value === "string" ? [[key, value]] : [],
  ),
);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "*.spec.ts",
  outputDir: "test-results/pages-proof",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [
    ["line"],
    ["html", { open: "never", outputFolder: "playwright-report/pages-proof" }],
  ],
  use: {
    baseURL: appUrl,
    browserName: "chromium",
    screenshot: "on",
    trace: "on",
    video: "on",
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    env: {
      ...inheritedEnvironment,
      ACQUISITION_RATE_LIMIT_SECRET: "pages-proof-local-acquisition-secret",
      BUILDER_OPERATIONAL_CONFIRMATION_SECRET:
        "pages-proof-local-confirmation-secret",
      NEXT_PUBLIC_APP_URL: appUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
      NEXT_PUBLIC_SUPABASE_URL: apiUrl,
      PREORDER_RATE_LIMIT_SECRET: "pages-proof-local-preorder-secret",
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: `${appUrl}/health`,
  },
  projects: [{ name: "chromium" }],
});
