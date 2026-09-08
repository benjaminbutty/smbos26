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
  const removed = await client.storage
    .from(PAGE_ASSET_BUCKET)
    .remove(candidates.map((asset) => asset.storage_key));
  if (removed.error) {
    throw new Error("Could not remove unreferenced Page asset objects.", {
      cause: removed.error,
    });
  }
  const deleted = await client
    .from("media_assets")
    .delete()
    .eq("business_id", input.businessId)
    .in(
      "id",
      candidates.map((asset) => asset.id),
    );
  if (deleted.error) {
    throw new Error("Could not remove unreferenced Page asset metadata.", {
      cause: deleted.error,
    });
  }
  return {
    deletedAssetIds: candidates.map((asset) => asset.id),
    inspectedAssets: assets.length,
    retainedAssetIds: retained,
  };
}
