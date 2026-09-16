import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../db/supabase/database.types";
import { configurationSnapshotV1Schema } from "../../core/configuration/definition-source";
import { pageBlockReferencesMedia } from "../../core/experience/page-blocks";
import { PAGE_ASSET_BUCKET } from "./page-assets";

const PAGE_SIZE = 1_000;

async function readAllSnapshots(
  client: SupabaseClient<Database>,
  businessId: string,
): Promise<unknown[]> {
  const snapshots: unknown[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await client
      .from("configuration_versions")
      .select("snapshot_json")
      .eq("business_id", businessId)
      .range(offset, offset + PAGE_SIZE - 1);
    if (result.error) {
      throw new Error("Could not inspect historical configuration Versions.", {
        cause: result.error,
      });
    }
    snapshots.push(
      ...(result.data ?? []).map((version) => version.snapshot_json),
    );
    if ((result.data ?? []).length < PAGE_SIZE) return snapshots;
  }
}

async function readAllAssets(
  client: SupabaseClient<Database>,
  businessId: string,
  cutoff: string,
): Promise<{ id: string; storage_key: string; created_at: string }[]> {
  const assets: { id: string; storage_key: string; created_at: string }[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await client
      .from("media_assets")
      .select("id,storage_key,created_at")
      .eq("business_id", businessId)
      .lt("created_at", cutoff)
      .range(offset, offset + PAGE_SIZE - 1);
    if (result.error) {
      throw new Error("Could not inspect private Page assets.", {
        cause: result.error,
      });
    }
    assets.push(...(result.data ?? []));
    if ((result.data ?? []).length < PAGE_SIZE) return assets;
  }
}

export function referencedPageAssetIds(
  snapshots: readonly unknown[],
): ReadonlySet<string> {
  const references = new Set<string>();
  for (const input of snapshots) {
    const snapshot = configurationSnapshotV1Schema.parse(input);
    for (const page of snapshot.pages) {
      for (const assetId of pageBlockReferencesMedia(page.layout_json)) {
        references.add(assetId);
      }
    }
  }
  return references;
}

export interface PageAssetCleanupResult {
  deletedAssetIds: readonly string[];
  inspectedAssets: number;
  retainedAssetIds: readonly string[];
}

type CleanupRpcClient = {
  rpc<T>(
    functionName: string,
    parameters: Record<string, string>,
  ): Promise<{ data: T | null; error: unknown | null }>;
};

function cleanupRpc(client: SupabaseClient<Database>): CleanupRpcClient {
  // C1 deliberately keeps this narrow adapter local until generated database
  // types include the additive retention RPCs.
  return client as unknown as CleanupRpcClient;
}

export async function cleanupUnreferencedPageAssets(
  client: SupabaseClient<Database>,
  input: {
    businessId: string;
    olderThan?: Date;
  },
): Promise<PageAssetCleanupResult> {
  const cutoff = input.olderThan ?? new Date(Date.now() - 24 * 60 * 60 * 1_000);
  const [snapshots, assets] = await Promise.all([
    readAllSnapshots(client, input.businessId),
    readAllAssets(client, input.businessId, cutoff.toISOString()),
  ]);
  const references = referencedPageAssetIds(snapshots);
  const retained = assets
    .filter((asset) => references.has(asset.id))
    .map((asset) => asset.id);
  const candidates = assets.filter((asset) => !references.has(asset.id));
  if (candidates.length === 0) {
    return {
      deletedAssetIds: [],
      inspectedAssets: assets.length,
      retainedAssetIds: retained,
    };
  }
  const rpc = cleanupRpc(client);
  const deletedAssetIds: string[] = [];
  for (const asset of candidates) {
    const claim = await rpc.rpc<string>("claim_site_media_asset_for_cleanup", {
      expected_business_id: input.businessId,
      requested_asset_id: asset.id,
    });
    if (claim.error) {
      throw new Error("Could not claim a Page asset for cleanup.", {
        cause: claim.error,
      });
    }
    if (!claim.data) {
      retained.push(asset.id);
      continue;
    }
    const removed = await client.storage
      .from(PAGE_ASSET_BUCKET)
      .remove([asset.storage_key]);
    if (removed.error) {
      // A network failure can arrive after object deletion. Keep the exclusive
      // claim so no draft or Page can attach potentially missing bytes; retry
      // remove/finalize with this token rather than releasing it speculatively.
      throw new Error("Could not remove an unreferenced Page asset object.", {
        cause: removed.error,
      });
    }
    const finalized = await rpc.rpc<boolean>("finalize_site_media_cleanup", {
      expected_business_id: input.businessId,
      requested_asset_id: asset.id,
      requested_claim_token: claim.data,
    });
    if (finalized.error || !finalized.data) {
      // Storage may already be gone. Retain the claim to prevent an attachment
      // to missing bytes; the worker can retry finalization with this token.
      throw new Error("Could not finalize Page asset cleanup safely.", {
        cause: finalized.error,
      });
    }
    deletedAssetIds.push(asset.id);
  }
  return {
    deletedAssetIds,
    inspectedAssets: assets.length,
    retainedAssetIds: retained,
  };
}
