import { NextResponse } from "next/server";
import { z } from "zod";

import { hasCapability } from "../../../../../../../../auth/capabilities";
import { resolveTenant } from "../../../../../../../../auth/authorization";
import { createServerClient } from "../../../../../../../../db/supabase/server";
import { PAGE_ASSET_BUCKET } from "../../../../../../../../runtime/media/page-assets";

interface PreviewMediaRouteProps {
  params: Promise<{
    businessSlug: string;
    candidateId: string;
    mediaToken: string;
  }>;
}

type QueryResult<T> = PromiseLike<{ data: T | null; error: unknown | null }>;
type ReadQuery<T> = QueryResult<T> & {
  eq(column: string, value: string | boolean): ReadQuery<T>;
  in(column: string, values: string[]): ReadQuery<T>;
  maybeSingle(): QueryResult<T>;
};
type PreviewReader = {
  from(table: string): { select(columns: string): ReadQuery<unknown> };
};

type ReleaseRow = {
  site_id: string;
  status: "prepared" | "published" | "invalidated" | "expired";
  projection_schema_version: 2 | 3;
};

type TokenRow = { asset_id: string };
type ReleaseAssetReferenceRow = { asset_id: string };
type AssetRow = { storage_key: string; mime_type: string; byte_size: number };

const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(120);
const mediaTokenSchema = z.string().regex(/^m_[a-f0-9]{64}$/);
const previewProjectionSchemaVersionSchema = z.union([
  z.literal(2),
  z.literal(3),
]);

function readQuery<T>(query: QueryResult<unknown>): QueryResult<T> {
  return query as unknown as QueryResult<T>;
}

export async function GET(
  _request: Request,
  { params }: Readonly<PreviewMediaRouteProps>,
): Promise<Response> {
  const { businessSlug, candidateId, mediaToken } = await params;
  if (
    !slugSchema.safeParse(businessSlug).success ||
    !z.uuid().safeParse(candidateId).success ||
    !mediaTokenSchema.safeParse(mediaToken).success
  ) {
    return NextResponse.json(
      { message: "Image unavailable." },
      { status: 404 },
    );
  }

  const supabase = await createServerClient();
  let tenant;
  try {
    tenant = await resolveTenant(businessSlug, supabase);
  } catch {
    return NextResponse.json(
      { message: "Image unavailable." },
      { status: 404 },
    );
  }
  if (!hasCapability(tenant.membership.role, "manage_configuration")) {
    return NextResponse.json(
      { message: "Image unavailable." },
      { status: 404 },
    );
  }

  const reader = supabase as unknown as PreviewReader;
  const releaseResult = await readQuery<ReleaseRow>(
    reader
      .from("site_releases")
      .select("site_id,status,projection_schema_version")
      .eq("business_id", tenant.business.id)
      .eq("id", candidateId)
      .maybeSingle(),
  );
  const releaseProjectionVersion = releaseResult.data
    ? previewProjectionSchemaVersionSchema.safeParse(
        releaseResult.data.projection_schema_version,
      )
    : null;
  if (
    releaseResult.error ||
    !releaseResult.data ||
    !releaseProjectionVersion?.success ||
    !["prepared", "published"].includes(releaseResult.data.status)
  ) {
    return NextResponse.json(
      { message: "Image unavailable." },
      { status: 404 },
    );
  }

  const tokenResult = await readQuery<TokenRow>(
    reader
      .from("site_public_media_tokens")
      .select("asset_id")
      .eq("business_id", tenant.business.id)
      .eq("site_id", releaseResult.data.site_id)
      .eq("token", mediaToken)
      .maybeSingle(),
  );
  if (tokenResult.error || !tokenResult.data) {
    return NextResponse.json(
      { message: "Image unavailable." },
      { status: 404 },
    );
  }

  const referenceResult = await readQuery<ReleaseAssetReferenceRow>(
    reader
      .from("site_release_asset_references")
      .select("asset_id")
      .eq("business_id", tenant.business.id)
      .eq("release_id", candidateId)
      .eq("asset_id", tokenResult.data.asset_id)
      .maybeSingle(),
  );
  if (referenceResult.error || !referenceResult.data) {
    return NextResponse.json(
      { message: "Image unavailable." },
      { status: 404 },
    );
  }

  const assetResult = await readQuery<AssetRow>(
    reader
      .from("media_assets")
      .select("storage_key,mime_type,byte_size")
      .eq("business_id", tenant.business.id)
      .eq("id", tokenResult.data.asset_id)
      .maybeSingle(),
  );
  if (assetResult.error || !assetResult.data) {
    return NextResponse.json(
      { message: "Image unavailable." },
      { status: 404 },
    );
  }

  const downloaded = await supabase.storage
    .from(PAGE_ASSET_BUCKET)
    .download(assetResult.data.storage_key);
  if (downloaded.error || !downloaded.data) {
    return NextResponse.json(
      { message: "Image unavailable." },
      { status: 404 },
    );
  }
  return new Response(downloaded.data, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Length": String(assetResult.data.byte_size),
      "Content-Type": assetResult.data.mime_type,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
