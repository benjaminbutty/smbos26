import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export interface C1LocalSupabaseSettings {
  apiUrl: string;
  databaseUrl: string;
  publishableKey: string;
  serviceRoleKey: string;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required for the isolated Sites C1 integration suite.`,
    );
  }
  return value;
}

function parseEnvironmentOutput(output: string): Record<string, string> {
  return Object.fromEntries(
    output
      .split("\n")
      .map((line) => /^([A-Z0-9_]+)="(.*)"$/.exec(line.trim()))
      .flatMap((match) =>
        match?.[1] && match[2] ? [[match[1], match[2]]] : [],
      ),
  );
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost"
  );
}

/**
 * This opt-in helper cannot infer a local target from the working directory.
 * CI supplies its own fresh project/workdir/ports; developer machines supply
 * the same values explicitly, so C1 never falls back to a retained demo DB.
 */
export function getC1LocalSupabaseSettings(): C1LocalSupabaseSettings {
  const workdir = requiredEnvironment("SMBOS_TEST_SUPABASE_WORKDIR");
  const expectedProjectId = requiredEnvironment(
    "SMBOS_TEST_SUPABASE_PROJECT_ID",
  );
  const expectedApiPort = requiredEnvironment("SMBOS_TEST_SUPABASE_API_PORT");
  const expectedDatabasePort = requiredEnvironment(
    "SMBOS_TEST_SUPABASE_DB_PORT",
  );
  if (!isAbsolute(workdir)) {
    throw new Error("SMBOS_TEST_SUPABASE_WORKDIR must be an absolute path.");
  }
  const config = readFileSync(join(workdir, "supabase", "config.toml"), "utf8");
  if (!new RegExp(`project_id\\s*=\\s*"${expectedProjectId}"`).test(config)) {
    throw new Error(
      "The Sites C1 workdir does not match its requested project ID.",
    );
  }
  const executable = join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "supabase.exe" : "supabase",
  );
  const values = parseEnvironmentOutput(
    execFileSync(executable, ["status", "--workdir", workdir, "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  const apiUrl = values.API_URL;
  const databaseUrl = values.DB_URL;
  const publishableKey = values.PUBLISHABLE_KEY ?? values.ANON_KEY;
  const serviceRoleKey = values.SERVICE_ROLE_KEY;
  if (!apiUrl || !databaseUrl || !publishableKey || !serviceRoleKey) {
    throw new Error(
      "The requested Sites C1 target did not report local credentials.",
    );
  }
  const api = new URL(apiUrl);
  const database = new URL(databaseUrl);
  if (
    api.protocol !== "http:" ||
    database.protocol !== "postgresql:" ||
    !isLoopbackHost(api.hostname) ||
    !isLoopbackHost(database.hostname)
  ) {
    throw new Error(
      "The requested Sites C1 target must use loopback local URLs.",
    );
  }
  if (api.port !== expectedApiPort || database.port !== expectedDatabasePort) {
    throw new Error("The requested Sites C1 target reported unexpected ports.");
  }
  return { apiUrl, databaseUrl, publishableKey, serviceRoleKey };
}
