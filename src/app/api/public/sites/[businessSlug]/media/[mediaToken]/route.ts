import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "../../../../../../../db/supabase/admin";
import { PAGE_ASSET_BUCKET } from "../../../../../../../runtime/media/page-assets";

interface MediaRouteProps {
  params: Promise<{ businessSlug: string; mediaToken: string }>;
}

type MediaMetadata = {
  storage_key: string;
  mime_type: string;
  byte_size: number;
};

type MediaResolver = {
  rpc<T>(
    functionName: string,
    parameters: Record<string, string>,
  ): Promise<{ data: T | null; error: unknown | null }>;
};

const mediaMetadataSchema = z
  .object({
    storage_key: z.string(),
    mime_type: z.string(),
    byte_size: z.number().int().nonnegative(),
  })
  .strict();

export async function GET(
  _request: Request,
  { params }: Readonly<MediaRouteProps>,
): Promise<Response> {
  const { businessSlug, mediaToken } = await params;
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(businessSlug) ||
    !/^m_[a-f0-9]{64}$/.test(mediaToken)
  ) {
    return NextResponse.json(
      { message: "Image unavailable." },
      { status: 404 },
    );
  }

  const adminClient = createAdminClient();
  const admin = adminClient as unknown as MediaResolver;
  const resolved = await admin.rpc<MediaMetadata>("resolve_public_site_media", {
    requested_business_slug: businessSlug,
    requested_media_token: mediaToken,
  });
  if (resolved.error || resolved.data === null) {
    return NextResponse.json(
      { message: "Image unavailable." },
      { status: 404 },
    );
  }
  const metadata = mediaMetadataSchema.safeParse(resolved.data);
  if (!metadata.success) {
    return NextResponse.json(
      { message: "Image unavailable." },
      { status: 404 },
    );
  }

  const downloaded = await adminClient.storage
    .from(PAGE_ASSET_BUCKET)
    .download(metadata.data.storage_key);
  if (downloaded.error || !downloaded.data) {
    return NextResponse.json(
      { message: "Image unavailable." },
      { status: 404 },
    );
  }
  return new Response(downloaded.data, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Length": String(metadata.data.byte_size),
      "Content-Type": metadata.data.mime_type,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
