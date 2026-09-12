import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveTenant } from "@/auth/authorization";
import { createServerClient } from "@/db/supabase/server";
import { createAdminClient } from "@/db/supabase/admin";
import { detectSiteUploadMimeType } from "@/core/sites/upload-validation";
import { readSitePrivateStorageObject } from "@/core/sites/upload-service";

interface RouteContext {
  params: Promise<{ businessSlug: string; attachmentId: string }>;
}

type QueryResult<T> = PromiseLike<{ data: T | null; error: unknown | null }>;
type ReadQuery<T> = QueryResult<T> & {
  eq(column: string, value: string): ReadQuery<T>;
  maybeSingle(): QueryResult<T>;
};
type Reader = {
  from(table: string): { select(columns: string): ReadQuery<unknown> };
};

type AttachmentLocator = { record_id: string };
type AttachmentMetadata = {
  business_id: string;
  record_id: string;
  verified_storage_key: string;
  sha256: string;
  byte_size: number;
  mime_type: string;
};

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const attachmentIdSchema = z.uuid();
const metadataMimeSchema = z.enum([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function readQuery<T>(query: QueryResult<unknown>): QueryResult<T> {
  return query as unknown as QueryResult<T>;
}

function unavailable(): NextResponse {
  return NextResponse.json(
    { message: "Attachment unavailable." },
    { status: 404, headers: { "cache-control": "private, no-store" } },
  );
}

function extensionForMime(
  mimeType: z.infer<typeof metadataMimeSchema>,
): string {
  switch (mimeType) {
    case "application/pdf":
      return "pdf";
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
  }
}

/**
 * Download authority is the ordinary RLS Record read. The privileged client
 * only looks up immutable attachment metadata and reads the private object
 * after that ordinary read succeeds.
 */
export async function GET(
  _request: Request,
  { params }: Readonly<RouteContext>,
): Promise<NextResponse | Response> {
  const { businessSlug, attachmentId } = await params;
  if (
    !slugSchema.safeParse(businessSlug).success ||
    !attachmentIdSchema.safeParse(attachmentId).success
  ) {
    return unavailable();
  }

  const ordinaryClient = await createServerClient();
  let tenant;
  try {
    tenant = await resolveTenant(businessSlug, ordinaryClient);
  } catch {
    return unavailable();
  }

  const adminClient = createAdminClient();
  const adminReader = adminClient as unknown as Reader;
  const locatorResult = await readQuery<AttachmentLocator>(
    adminReader
      .from("site_public_submission_attachments")
      .select("record_id")
      .eq("business_id", tenant.business.id)
      .eq("id", attachmentId)
      .maybeSingle(),
  );
  if (locatorResult.error || !locatorResult.data) {
    return unavailable();
  }

  // This query intentionally uses the authenticated ordinary client. A
  // service-role record lookup would bypass the current Record policy.
  const visibleRecord = await ordinaryClient
    .from("records")
    .select("id")
    .eq("business_id", tenant.business.id)
    .eq("id", locatorResult.data.record_id)
    .maybeSingle();
  if (visibleRecord.error || !visibleRecord.data) {
    return unavailable();
  }

  const metadataResult = await readQuery<AttachmentMetadata>(
    adminReader
      .from("site_public_submission_attachments")
      .select(
        "business_id,record_id,verified_storage_key,sha256,byte_size,mime_type",
      )
      .eq("business_id", tenant.business.id)
      .eq("id", attachmentId)
      .maybeSingle(),
  );
  if (
    metadataResult.error ||
    !metadataResult.data ||
    metadataResult.data.business_id !== tenant.business.id ||
    metadataResult.data.record_id !== locatorResult.data.record_id
  ) {
    return unavailable();
  }

  const mimeType = metadataMimeSchema.safeParse(metadataResult.data.mime_type);
  if (!mimeType.success) return unavailable();

  const bytes = await readSitePrivateStorageObject(
    metadataResult.data.verified_storage_key,
    10 * 1024 * 1024,
  ).catch(() => null);
  if (!bytes) return unavailable();

  const digest = createHash("sha256").update(bytes).digest("hex");
  if (
    bytes.byteLength !== metadataResult.data.byte_size ||
    digest !== metadataResult.data.sha256 ||
    detectSiteUploadMimeType(bytes) !== mimeType.data
  ) {
    return unavailable();
  }

  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="site-attachment-${attachmentId}.${extensionForMime(mimeType.data)}"`,
      "Content-Length": String(metadataResult.data.byte_size),
      "Content-Type": mimeType.data,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
