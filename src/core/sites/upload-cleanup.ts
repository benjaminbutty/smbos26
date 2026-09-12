import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  sitePublicUploadBucket,
  sitePublicUploadLimits,
} from "./upload-protocol";
import { SiteUploadServiceError } from "./upload-errors";

type RpcResult<T> = { data: T | null; error: unknown | null };
type RpcClient = {
  rpc<T = unknown>(
    functionName: string,
    parameters: Record<string, unknown>,
  ): Promise<RpcResult<T>>;
};

type StorageFileApi = {
  list(
    prefix?: string,
    options?: { limit?: number; offset?: number },
  ): Promise<{
    data: Array<{ name: string }> | null;
    error: unknown | null;
  }>;
  remove(paths: string[]): Promise<RpcResult<unknown>>;
};

type UploadAdminClient = RpcClient & {
  storage: { from(bucket: string): StorageFileApi };
};

type CleanupClaim = {
  state: string;
  cleanup_claim_token: string;
  verified_storage_key: string | null;
  quarantine_key: string;
  quarantine_prefix: string;
  verified_prefix: string;
};

const cleanupClaimSchema = z.object({
  state: z.string(),
  cleanup_claim_token: z.uuid(),
  verified_storage_key: z.string().nullable(),
  quarantine_key: z.string(),
  quarantine_prefix: z.string(),
  verified_prefix: z.string(),
});

const uuidSource =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuidPattern = new RegExp(`^${uuidSource}$`, "i");

const rpcClient = (client: unknown): RpcClient => client as RpcClient;
const storageClient = (client: unknown): UploadAdminClient =>
  client as UploadAdminClient;

async function callRpc<T>(
  client: unknown,
  functionName: string,
  parameters: Record<string, unknown>,
): Promise<T> {
  const result = await rpcClient(client).rpc<T>(functionName, parameters);
  if (result.error || result.data === null) {
    throw new SiteUploadServiceError(
      "unavailable",
      "The upload cleanup request was rejected.",
      { cause: result.error },
    );
  }
  return result.data;
}

function assertClaimPrefixes(claim: CleanupClaim, grantId: string): void {
  if (!uuidPattern.test(grantId)) {
    throw new SiteUploadServiceError(
      "provider_failed",
      "The upload cleanup grant identity is invalid.",
    );
  }
  const quarantinePattern = new RegExp(
    `^quarantine/(${uuidSource})/${grantId}$`,
    "i",
  );
  const verifiedPattern = new RegExp(
    `^verified/(${uuidSource})/${grantId}$`,
    "i",
  );
  const quarantineMatch = claim.quarantine_prefix.match(quarantinePattern);
  const verifiedMatch = claim.verified_prefix.match(verifiedPattern);
  if (
    !quarantineMatch ||
    !verifiedMatch ||
    quarantineMatch[1] !== verifiedMatch[1] ||
    claim.quarantine_key !== claim.quarantine_prefix
  ) {
    throw new SiteUploadServiceError(
      "provider_failed",
      "The upload cleanup claim was not bound to its grant.",
    );
  }
  if (
    claim.verified_storage_key !== null &&
    !new RegExp(`^${claim.verified_prefix}/[a-f0-9]{64}$`).test(
      claim.verified_storage_key,
    )
  ) {
    throw new SiteUploadServiceError(
      "provider_failed",
      "The retained upload object was not bound to its grant.",
    );
  }
}

const withStorageDeadline = async <T>(
  operation: Promise<T>,
  timeoutMs = sitePublicUploadLimits.storageCallTimeoutMs,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new SiteUploadServiceError(
                "provider_failed",
                "Storage did not respond within its bounded deadline.",
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export async function listSitePublicUploadStoragePaths(
  storage: StorageFileApi,
  prefix: string,
): Promise<string[]> {
  if (!new RegExp(`^verified/${uuidSource}/${uuidSource}$`, "i").test(prefix)) {
    throw new SiteUploadServiceError(
      "provider_failed",
      "Storage cleanup received an invalid verified prefix.",
    );
  }
  const paths: string[] = [];
  const pageSize = 100;
  const maxPages = 10;
  for (let page = 0; page < maxPages; page += 1) {
    const listing = await withStorageDeadline(
      storage.list(prefix, { limit: pageSize, offset: page * pageSize }),
    );
    if (listing.error || !listing.data) {
      throw new SiteUploadServiceError(
        "provider_failed",
        "Storage cleanup could not list its bounded prefix.",
        { cause: listing.error },
      );
    }
    for (const entry of listing.data) {
      if (
        !entry ||
        typeof entry.name !== "string" ||
        entry.name.length === 0 ||
        entry.name.includes("..")
      ) {
        throw new SiteUploadServiceError(
          "provider_failed",
          "Storage cleanup found an invalid object name.",
        );
      }
      const path = entry.name.startsWith(`${prefix}/`)
        ? entry.name
        : `${prefix}/${entry.name}`;
      if (!path.startsWith(`${prefix}/`)) {
        throw new SiteUploadServiceError(
          "provider_failed",
          "Storage cleanup found an object outside its claimed prefix.",
        );
      }
      paths.push(path);
    }
    if (listing.data.length < pageSize) return paths;
  }
  throw new SiteUploadServiceError(
    "provider_failed",
    "Storage cleanup found more objects than its bounded prefix sweep allows.",
  );
}

function isNotFoundStorageError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    Number(error.status) === 404
  );
}

/**
 * Sweep one claimed grant after the reservation deadline. The database claim
 * supplies the only storage prefixes; committed attachments retain their
 * verified object while quarantine and orphaned verified objects are removed.
 */
export async function cleanupSitePublicUploadGrant(
  client: SupabaseClient | unknown,
  grantId: string,
  options: { fenceWaitMs?: number } = {},
): Promise<void> {
  if (!client) {
    throw new SiteUploadServiceError("unavailable");
  }
  const admin = storageClient(client);
  const claim = cleanupClaimSchema.parse(
    await callRpc<unknown>(admin, "claim_site_public_upload_cleanup_v1", {
      requested_grant_id: grantId,
    }),
  ) as CleanupClaim;
  assertClaimPrefixes(claim, grantId);
  const fenceWaitMs =
    options.fenceWaitMs ?? sitePublicUploadLimits.storageCallTimeoutMs;
  await new Promise<void>((resolve) => setTimeout(resolve, fenceWaitMs));
  const storage = admin.storage.from(sitePublicUploadBucket);
  const quarantineRemoved = await withStorageDeadline(
    storage.remove([claim.quarantine_key]),
  );
  if (
    quarantineRemoved.error &&
    !isNotFoundStorageError(quarantineRemoved.error)
  ) {
    throw new SiteUploadServiceError(
      "provider_failed",
      "Storage cleanup could not confirm quarantine removal.",
      { cause: quarantineRemoved.error },
    );
  }

  let paths = await listSitePublicUploadStoragePaths(
    storage,
    claim.verified_prefix,
  );
  if (claim.verified_storage_key) {
    paths = paths.filter((path) => path !== claim.verified_storage_key);
  }
  if (paths.length > 0) {
    const removed = await withStorageDeadline(storage.remove(paths));
    if (removed.error) {
      throw new SiteUploadServiceError(
        "provider_failed",
        "Storage cleanup could not confirm verified-orphan removal.",
        { cause: removed.error },
      );
    }
  }
  const remaining = await listSitePublicUploadStoragePaths(
    storage,
    claim.verified_prefix,
  );
  const unexpected = remaining.filter(
    (path) => path !== claim.verified_storage_key,
  );
  if (unexpected.length > 0) {
    throw new SiteUploadServiceError(
      "provider_failed",
      "Storage cleanup found a late object after removal.",
    );
  }
  await callRpc(admin, "finalize_site_public_upload_cleanup_v1", {
    requested_grant_id: grantId,
    requested_cleanup_claim_token: claim.cleanup_claim_token,
  });
}
