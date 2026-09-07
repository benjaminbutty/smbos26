import { NextResponse } from "next/server";

import { resolveTenant } from "../../../../../../../auth/authorization";
import { createServerClient } from "../../../../../../../db/supabase/server";
import { PAGE_ASSET_BUCKET } from "../../../../../../../runtime/media/page-assets";

interface AssetRouteProps {
  params: Promise<{ businessSlug: string; assetId: string }>;
}

export async function GET(
  _request: Request,
  { params }: Readonly<AssetRouteProps>,
): Promise<Response> {
  const { assetId, businessSlug } = await params;
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
  const { data: asset, error } = await supabase
    .from("media_assets")
    .select("storage_key,mime_type,byte_size")
    .eq("business_id", tenant.business.id)
    .eq("id", assetId)
    .maybeSingle();
  if (error || !asset) {
    return NextResponse.json(
      { message: "Image unavailable." },
      { status: 404 },
    );
  }
  const downloaded = await supabase.storage
    .from(PAGE_ASSET_BUCKET)
    .download(asset.storage_key);
  if (downloaded.error || !downloaded.data) {
    return NextResponse.json(
      { message: "Image unavailable." },
      { status: 404 },
    );
  }
  return new Response(downloaded.data, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Length": String(asset.byte_size),
      "Content-Type": asset.mime_type,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
