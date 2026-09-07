import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { hasCapability } from "../../../../../../auth/capabilities";
import { resolveTenant } from "../../../../../../auth/authorization";
import { createAdminClient } from "../../../../../../db/supabase/admin";
import { createServerClient } from "../../../../../../db/supabase/server";
import {
  assetErrorMessage,
  decodePageAsset,
  PAGE_ASSET_BUCKET,
  type PageAssetMimeType,
} from "../../../../../../runtime/media/page-assets";

interface AssetRouteProps {
  params: Promise<{ businessSlug: string }>;
}

function errorResponse(message: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(
  request: Request,
  { params }: Readonly<AssetRouteProps>,
): Promise<NextResponse> {
  const { businessSlug } = await params;
  const supabase = await createServerClient();
  let tenant;
  try {
    tenant = await resolveTenant(businessSlug, supabase);
  } catch {
    return errorResponse("Sign in to add an image to this Page.", 401);
  }
  if (!hasCapability(tenant.membership.role, "manage_configuration")) {
    return errorResponse(
      "Owner or Admin access is required to add images.",
      403,
    );
  }

  const form = await request.formData();
  const uploaded = form.get("file");
  if (!(uploaded instanceof File)) {
    return errorResponse("Choose an image to upload.");
  }
  try {
    const decoded = await decodePageAsset({
      bytes: new Uint8Array(await uploaded.arrayBuffer()),
      mimeType: uploaded.type,
    });
    const assetId = randomUUID();
    const extension =
      decoded.mimeType === "image/jpeg" ? "jpg" : decoded.mimeType.slice(6);
    const storageKey = `${tenant.business.id}/${assetId}.${extension}`;
    const upload = await supabase.storage
      .from(PAGE_ASSET_BUCKET)
      .upload(storageKey, decoded.bytes, {
        cacheControl: "private, max-age=0, no-store",
        contentType: decoded.mimeType,
        upsert: false,
      });
    if (upload.error) {
      throw new Error(upload.error.message);
    }
    const { error: registryError } = await supabase
      .from("media_assets")
      .insert({
        business_id: tenant.business.id,
        byte_size: decoded.bytes.byteLength,
        height: decoded.height,
        id: assetId,
        mime_type: decoded.mimeType as PageAssetMimeType,
        storage_key: storageKey,
        width: decoded.width,
      });
    if (registryError) {
      try {
        await createAdminClient()
          .storage.from(PAGE_ASSET_BUCKET)
          .remove([storageKey]);
      } catch {
        // The registry is the reference boundary; a maintenance pass can
        // remove an orphaned immutable object if cleanup itself is unavailable.
      }
      return errorResponse(
        "The image could not be registered. Try again.",
        500,
      );
    }
    return NextResponse.json({
      assetId,
      alt: "",
      height: decoded.height,
      mimeType: decoded.mimeType,
      presentation: "content",
      src: `/api/app/${encodeURIComponent(businessSlug)}/pages/assets/${assetId}`,
      width: decoded.width,
    });
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "storage_failed";
    if (
      code === "unsupported_type" ||
      code === "too_large" ||
      code === "too_many_pixels" ||
      code === "invalid_image"
    ) {
      return errorResponse(assetErrorMessage(code));
    }
    return errorResponse(assetErrorMessage("storage_failed"), 500);
  }
}
