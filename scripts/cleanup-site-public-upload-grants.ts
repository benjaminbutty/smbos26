import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { cleanupSitePublicUploadGrant } from "../src/core/sites/upload-cleanup";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 100;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CleanupRpcResult<T = unknown> = {
  data: T | null;
  error: unknown | null;
};

type CleanupClient = {
  rpc(
    functionName: string,
    parameters: Record<string, unknown>,
  ): PromiseLike<CleanupRpcResult<unknown>>;
};

type CleanupGrant = (client: unknown, grantId: string) => Promise<void>;

/**
 * Parse the deliberately small maintenance surface. Run through the package
 * `sites:cleanup-uploads` command with an explicit `--limit`, for example:
 * `NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run
 * sites:cleanup-uploads -- --limit 100`. The database candidate RPC remains
 * the only source of grant identities.
 */
export function parseUploadCleanupArgs(args: readonly string[] = []): {
  limit: number;
} {
  const limitIndex = args.indexOf("--limit");
  if (args.filter((arg) => arg === "--limit").length > 1) {
    throw new Error("--limit may be provided only once.");
  }
  const rawLimit = limitIndex >= 0 ? args[limitIndex + 1] : undefined;
  if (limitIndex >= 0 && rawLimit === undefined) {
    throw new Error("--limit requires a positive integer.");
  }
  const limit = rawLimit === undefined ? DEFAULT_BATCH_SIZE : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) {
    throw new Error(
      `--limit must be an integer between 1 and ${MAX_BATCH_SIZE}.`,
    );
  }
  const unexpected = args.filter((arg, index) => {
    if (index === limitIndex) return false;
    if (limitIndex >= 0 && index === limitIndex + 1) return false;
    return true;
  });
  if (unexpected.length > 0) {
    throw new Error(`Unknown maintenance argument: ${unexpected[0]}`);
  }
  return { limit };
}

function configuredClient(): CleanupClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "The upload grant cleanup failed.";
}

function candidateIds(data: unknown): string[] {
  if (!Array.isArray(data)) {
    throw new Error("The cleanup candidate response was not a list.");
  }
  return data.map((candidate: unknown, index: number) => {
    const candidateRecord =
      typeof candidate === "object" && candidate !== null
        ? (candidate as { id?: unknown })
        : null;
    if (
      !candidateRecord ||
      typeof candidateRecord.id !== "string" ||
      !uuidPattern.test(candidateRecord.id)
    ) {
      throw new Error(
        `Cleanup candidate ${index + 1} has an invalid grant id.`,
      );
    }
    return candidateRecord.id;
  });
}

/**
 * Select and sweep one bounded batch. The cleanup service claims each grant
 * and derives its exact quarantine/verified prefixes from that claim. This
 * runner never accepts or constructs a storage prefix and never releases a
 * reservation itself; a failed sweep leaves the service claim available for
 * the next bounded run.
 */
export async function runSitePublicUploadCleanup({
  client,
  limit = DEFAULT_BATCH_SIZE,
  cleanupGrant = cleanupSitePublicUploadGrant,
  log = () => {},
}: {
  client: CleanupClient;
  limit?: number;
  cleanupGrant?: CleanupGrant;
  log?: (message: string) => void;
}): Promise<{
  selected: number;
  cleaned: number;
  failed: number;
  failures: Array<{ grantId: string; message: string }>;
}> {
  if (!client || typeof client.rpc !== "function") {
    throw new Error("A configured Supabase client is required.");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) {
    throw new Error(`Cleanup limit must be between 1 and ${MAX_BATCH_SIZE}.`);
  }
  if (typeof cleanupGrant !== "function") {
    throw new Error("A cleanup service is required.");
  }

  const listed = await client.rpc(
    "list_site_public_upload_cleanup_candidates_v1",
    { requested_limit: limit },
  );
  if (listed.error) throw listed.error;
  const ids = candidateIds(listed.data);
  const failures: Array<{ grantId: string; message: string }> = [];
  let cleaned = 0;
  for (const grantId of ids) {
    try {
      await cleanupGrant(client, grantId);
      cleaned += 1;
      log(`Cleaned upload grant ${grantId}.`);
    } catch (error) {
      failures.push({ grantId, message: errorMessage(error) });
      log(`Upload grant ${grantId} remains pending cleanup.`);
    }
  }
  return {
    selected: ids.length,
    cleaned,
    failed: failures.length,
    failures,
  };
}

async function main(): Promise<void> {
  const { limit } = parseUploadCleanupArgs(process.argv.slice(2));
  const result = await runSitePublicUploadCleanup({
    client: configuredClient(),
    limit,
    log: console.log,
  });
  console.log(
    `Upload grant cleanup selected ${result.selected}; cleaned ${result.cleaned}; failed ${result.failed}.`,
  );
  if (result.failed > 0) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
const modulePath = resolve(fileURLToPath(import.meta.url));
if (invokedPath === modulePath) {
  main().catch((error) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
