import { execFileSync } from "node:child_process";
import { join } from "node:path";

export interface LocalSupabaseSettings {
  apiUrl: string;
  databaseUrl: string;
  publishableKey: string;
  serviceRoleKey: string;
}

function parseEnvironmentOutput(output: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of output.split("\n")) {
    const match = /^([A-Z0-9_]+)="(.*)"$/.exec(line.trim());
    if (match?.[1] && match[2] !== undefined) {
      values[match[1]] = match[2];
    }
  }

  return values;
}

export function getLocalSupabaseSettings(): LocalSupabaseSettings {
  const executable = join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "supabase.exe" : "supabase",
  );
  const output = execFileSync(executable, ["status", "-o", "env"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const values = parseEnvironmentOutput(output);
  const apiUrl = values.API_URL;
  const databaseUrl = values.DB_URL;
  const publishableKey = values.PUBLISHABLE_KEY ?? values.ANON_KEY;
  const serviceRoleKey = values.SERVICE_ROLE_KEY;

  if (!apiUrl || !databaseUrl || !publishableKey || !serviceRoleKey) {
    throw new Error(
      "Local Supabase is running but did not report all required test credentials.",
    );
  }

  return { apiUrl, databaseUrl, publishableKey, serviceRoleKey };
}
