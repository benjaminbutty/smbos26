import { execFileSync } from "node:child_process";
import console from "node:console";
import { join } from "node:path";
import process from "node:process";
import { URL } from "node:url";

import {
  LocalAuthReadinessError,
  createLocalAuthAdminProbe,
  formatLocalSupabaseDiagnostics,
  runLocalAuthReadinessBoundary,
  waitForLocalAuthReadiness,
} from "./support/local-auth-readiness.mjs";

const projectId = "smbos26";
const componentContainers = Object.freeze({
  auth: `supabase_auth_${projectId}`,
  database: `supabase_db_${projectId}`,
  gateway: `supabase_kong_${projectId}`,
});

function localSupabaseExecutable() {
  return join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "supabase.exe" : "supabase",
  );
}

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

function runQuietly(executable, args, timeout = 180_000) {
  return execFileSync(executable, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      SUPABASE_TELEMETRY_DISABLED: "1",
    },
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
  });
}

function loadLocalSupabase() {
  let output;
  try {
    output = runQuietly(localSupabaseExecutable(), ["status", "-o", "env"]);
  } catch {
    throw new LocalAuthReadinessError({
      attempt: 0,
      code: "local_stack_unavailable",
      reason: "unknown",
    });
  }

  const values = parseEnvironmentOutput(output);
  const apiUrl = values.API_URL;
  const serviceRoleKey = values.SERVICE_ROLE_KEY;
  if (!apiUrl || !serviceRoleKey) {
    throw new LocalAuthReadinessError({
      attempt: 0,
      code: "local_settings_unavailable",
      reason: "unknown",
    });
  }

  const api = new URL(apiUrl);
  if (
    api.protocol !== "http:" ||
    !new Set(["127.0.0.1", "localhost", "::1"]).has(api.hostname) ||
    api.port !== "55321"
  ) {
    throw new LocalAuthReadinessError({
      attempt: 0,
      code: "non_local_target",
      reason: "unknown",
    });
  }
  return { apiUrl, serviceRoleKey };
}

function inspectContainer(container) {
  try {
    const output = runQuietly(
      "docker",
      [
        "inspect",
        "--format",
        "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
        container,
      ],
      10_000,
    ).trim();
    const [state, health] = output.split("|");
    return { health, state };
  } catch {
    return { health: "unknown", state: "unknown" };
  }
}

function collectSafeDiagnostics(error) {
  const snapshots = Object.fromEntries(
    Object.entries(componentContainers).map(([component, container]) => [
      component,
      inspectContainer(container),
    ]),
  );
  for (const line of formatLocalSupabaseDiagnostics({ error, snapshots })) {
    console.error(line);
  }
}

async function waitForReady() {
  const { apiUrl, serviceRoleKey } = loadLocalSupabase();
  return waitForLocalAuthReadiness({
    probe: createLocalAuthAdminProbe({ apiUrl, serviceRoleKey }),
  });
}

async function recoverLocalStack() {
  const executable = localSupabaseExecutable();
  try {
    runQuietly(executable, ["stop"]);
    runQuietly(executable, ["start"]);
    runQuietly(executable, ["db", "reset", "--local"]);
  } catch {
    throw new LocalAuthReadinessError({
      attempt: 0,
      code: "recovery_failed",
      reason: "unknown",
    });
  }
}

const unknownArguments = process.argv
  .slice(2)
  .filter((arg) => arg !== "--recover");
if (unknownArguments.length > 0) {
  console.error(
    "Local Auth readiness attempt=0 status=none delay_ms=0 code=invalid_arguments",
  );
  process.exitCode = 1;
} else {
  const allowRecovery = process.argv.includes("--recover");
  try {
    await runLocalAuthReadinessBoundary({
      diagnose: collectSafeDiagnostics,
      recover: allowRecovery ? recoverLocalStack : undefined,
      waitForReady,
    });
  } catch (error) {
    const safeError =
      error instanceof LocalAuthReadinessError
        ? error
        : new LocalAuthReadinessError({
            attempt: 0,
            code: "unknown_failure",
            reason: "unknown",
          });
    console.error(safeError.message);
    process.exitCode = 1;
  }
}
