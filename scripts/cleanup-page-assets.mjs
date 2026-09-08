/* global console, process */

import { createClient } from "@supabase/supabase-js";

const bucket = "page-assets";
const maxPageSize = 1_000;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const args = process.argv.slice(2);
const businessIndex = args.indexOf("--business-id");
const hoursIndex = args.indexOf("--older-than-hours");
const businessId = businessIndex >= 0 ? args[businessIndex + 1] : undefined;
const olderThanHours = hoursIndex >= 0 ? Number(args[hoursIndex + 1]) : 24;

if (!Number.isFinite(olderThanHours) || olderThanHours < 24) {
  throw new Error("--older-than-hours must be at least 24.");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
  );
}

const client = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function readAll(table, select, filters = []) {
  const rows = [];
  for (let offset = 0; ; offset += maxPageSize) {
    let query = client
      .from(table)
      .select(select)
      .range(offset, offset + maxPageSize - 1);
    for (const [column, value] of filters) query = query.eq(column, value);
    const result = await query;
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data ?? []).length < maxPageSize) return rows;
  }
}

function referencedAssetIds(versions) {
  const ids = new Set();
  const visit = (blocks) => {
    if (!Array.isArray(blocks)) {
      throw new Error("A historical Page layout has an invalid blocks array.");
    }
    for (const block of blocks) {
      if (
        !block ||
        typeof block !== "object" ||
        typeof block.type !== "string"
      ) {
        throw new Error(
          "A historical Page has an invalid block; cleanup stopped.",
        );
      }
      if (block?.type === "image" && typeof block.asset_id === "string") {
        if (
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            block.asset_id,
          )
        ) {
          throw new Error(
            "A historical Page has an invalid image reference; cleanup stopped.",
          );
        }
        ids.add(block.asset_id);
      }
      if (
        block?.type === "image" &&
        block.asset_id !== undefined &&
        typeof block.asset_id !== "string"
      ) {
        throw new Error(
          "A historical Page has an invalid image reference; cleanup stopped.",
        );
      }
      if (block?.type === "collapsible") visit(block.blocks);
    }
  };
  for (const version of versions) {
    const pages = version.snapshot_json?.pages;
    if (!Array.isArray(pages)) {
      throw new Error(
        "A historical configuration snapshot has an invalid pages array; cleanup stopped.",
      );
    }
    for (const page of pages) {
      if (!page || typeof page !== "object") {
        throw new Error("A historical Page is invalid; cleanup stopped.");
      }
      if (!Array.isArray(page?.layout_json?.blocks)) {
        throw new Error(
          "A historical Page has an invalid layout blocks array; cleanup stopped.",
        );
      }
      visit(page.layout_json?.blocks);
    }
  }
  return ids;
}

const versionFilters = businessId ? [["business_id", businessId]] : [];
const assetFilters = businessId ? [["business_id", businessId]] : [];
const versions = await readAll(
  "configuration_versions",
  "snapshot_json",
  versionFilters,
);
const references = referencedAssetIds(versions);
const cutoff = new Date(
  Date.now() - olderThanHours * 60 * 60 * 1_000,
).toISOString();
let assets = await readAll(
  "media_assets",
  "id,business_id,storage_key,created_at",
  assetFilters,
);
assets = assets.filter((asset) => {
  if (!uuidPattern.test(asset.id)) {
    throw new Error("A Page asset has an invalid identity; cleanup stopped.");
  }
  if (
    typeof asset.business_id !== "string" ||
    !uuidPattern.test(asset.business_id) ||
    typeof asset.storage_key !== "string" ||
    !asset.storage_key.startsWith(`${asset.business_id}/`)
  ) {
    throw new Error(
      "A Page asset has an invalid tenant storage key; cleanup stopped.",
    );
  }
  return asset.created_at < cutoff && !references.has(asset.id);
});

if (assets.length === 0) {
  console.log("No unreferenced Page assets are eligible for cleanup.");
  process.exit(0);
}

const storage = await client.storage
  .from(bucket)
  .remove(assets.map((asset) => asset.storage_key));
if (storage.error) throw storage.error;
const ids = assets.map((asset) => asset.id);
let query = client.from("media_assets").delete().in("id", ids);
if (businessId) query = query.eq("business_id", businessId);
const deleted = await query;
if (deleted.error) throw deleted.error;
console.log(`Removed ${assets.length} unreferenced Page asset(s).`);
