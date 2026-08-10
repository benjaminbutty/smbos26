import { execFileSync } from "node:child_process";
import { join } from "node:path";
import process from "node:process";
import { URL } from "node:url";

function parseEnvironmentOutput(output) {
  const values = {};
  for (const line of output.split("\n")) {
    const match = /^([A-Z0-9_]+)="(.*)"$/.exec(line.trim());
    if (match?.[1] && match[2] !== undefined) {
      values[match[1]] = match[2];
    }
  }
  return values;
}

function localSupabaseEnvironment() {
  const executable = join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "supabase.exe" : "supabase",
  );
  const values = parseEnvironmentOutput(
    execFileSync(executable, ["status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  const apiUrl = values.API_URL;
  const databaseUrl = values.DB_URL;
  if (!apiUrl || !databaseUrl) {
    throw new Error(
      "Refusing to seed: local Supabase is not running or did not report its URLs.",
    );
  }
  const api = new URL(apiUrl);
  const database = new URL(databaseUrl);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  if (
    api.protocol !== "http:" ||
    !localHosts.has(api.hostname) ||
    api.port !== "55321" ||
    database.protocol !== "postgresql:" ||
    !localHosts.has(database.hostname) ||
    database.port !== "55322"
  ) {
    throw new Error(
      "Refusing to seed: this command only operates on SMBOS local Supabase ports 55321/55322.",
    );
  }
}

localSupabaseEnvironment();

const vitest = join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vitest.cmd" : "vitest",
);
execFileSync(
  vitest,
  [
    "run",
    "--config",
    "vitest.integration.config.ts",
    "tests/integration/internal-workspace-engine.test.ts",
  ],
  {
    env: { ...process.env, INTERNAL_WORKSPACE_PROOF_PERSIST: "1" },
    stdio: "inherit",
  },
);
