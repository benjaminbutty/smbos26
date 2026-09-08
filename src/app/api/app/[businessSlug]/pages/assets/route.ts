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
  PAGE_ASSET_MAX_BYTES,
  PAGE_ASSET_MAX_PIXELS,
  type PageAssetMimeType,
} from "../../../../../../runtime/media/page-assets";

interface AssetRouteProps {
  params: Promise<{ businessSlug: string }>;
}

function errorResponse(message: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, message }, { status });
}

const PAGE_ASSET_MULTIPART_OVERHEAD = 64 * 1024;
const PAGE_ASSET_REQUEST_MAX_BYTES =
  PAGE_ASSET_MAX_BYTES + PAGE_ASSET_MULTIPART_OVERHEAD;

class AssetRequestTooLargeError extends Error {}

async function readBoundedFormData(request: Request): Promise<FormData> {
  if (!request.body) return request.formData();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > PAGE_ASSET_REQUEST_MAX_BYTES) {
        await reader.cancel();
        throw new AssetRequestTooLargeError();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request.url, {
    body: bytes,
    headers: request.headers,
    method: request.method,
  }).formData();
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

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 1 ||
      parsedLength > PAGE_ASSET_REQUEST_MAX_BYTES
    ) {
      return errorResponse("Images must be 3 MiB or smaller.", 413);
    }
  }

  let form: FormData;
  try {
    form = await readBoundedFormData(request);
  } catch (error) {
    if (error instanceof AssetRequestTooLargeError) {
      return errorResponse("Images must be 3 MiB or smaller.", 413);
    }
    return errorResponse("Choose a valid image upload.", 400);
  }
  const uploaded = form.get("file");
  if (!(uploaded instanceof File)) {
    return errorResponse("Choose an image to upload.");
  }
  if (uploaded.size > PAGE_ASSET_MAX_BYTES) {
    return errorResponse("Images must be 3 MiB or smaller.", 413);
  }
  try {
    const decoded = await decodePageAsset({
      bytes: new Uint8Array(await uploaded.arrayBuffer()),
      mimeType: uploaded.type,
    });
    if (decoded.bytes.byteLength > PAGE_ASSET_MAX_BYTES) {
      return errorResponse("Images must be 3 MiB or smaller.", 413);
    }
    if (
      !Number.isSafeInteger(decoded.width) ||
      !Number.isSafeInteger(decoded.height) ||
      decoded.width < 1 ||
      decoded.height < 1 ||
      decoded.width * decoded.height > PAGE_ASSET_MAX_PIXELS
    ) {
      return errorResponse(
        "That image is too large to place on a Page. Choose an image under 20 megapixels.",
        413,
      );
    }
    const assetId = randomUUID();
    const extension =
      decoded.mimeType === "image/jpeg" ? "jpg" : decoded.mimeType.slice(6);
    const storageKey = `${tenant.business.id}/${assetId}.${extension}`;
    const admin = createAdminClient();
    const upload = await admin.storage
      .from(PAGE_ASSET_BUCKET)
      .upload(storageKey, decoded.bytes, {
        cacheControl: "private, max-age=0, no-store",
        contentType: decoded.mimeType,
        upsert: false,
      });
    if (upload.error) {
      throw new Error(upload.error.message);
    }
    const { error: registryError } = await admin.from("media_assets").insert({
      business_id: tenant.business.id,
      byte_size: decoded.bytes.byteLength,
      created_by: tenant.user.id,
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
