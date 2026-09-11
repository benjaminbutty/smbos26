import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/db/supabase/admin";
import { SiteUploadRateLimitError } from "@/core/sites/upload-rate-limit";
import {
  SiteUploadServiceError,
  finalizeSitePublicUpload,
  resolveSitePublicUploadActionContext,
} from "@/core/sites/upload-service";
import { sitePublicUploadLimits } from "@/core/sites/upload-protocol";

interface RouteContext {
  params: Promise<{
    businessSlug: string;
    pageSlug: string;
    actionKey: string;
    grantId: string;
  }>;
}

const maximumBodyBytes = 16 * 1024;
const routeSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const finalizeBodySchema = z
  .object({
    releaseToken: z.string().regex(/^s_[a-f0-9]{64}$/),
    submissionAttemptId: z.uuid(),
  })
  .strict();

async function readJsonAtMost(request: Request): Promise<unknown | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > maximumBodyBytes) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maximumBodyBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(result.value);
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
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof SiteUploadServiceError) {
    const status =
      error.code === "rate_limited"
        ? 429
        : error.code === "provider_failed"
          ? 503
          : error.code === "unavailable" || error.code === "not_found"
            ? 404
            : error.code === "expired"
              ? 410
              : error.code === "quota_exceeded"
                ? 409
                : 400;
    return NextResponse.json(
      { ok: false, code: `site_upload_${error.code}` },
      { status, headers: { "cache-control": "no-store" } },
    );
  }
  if (error instanceof SiteUploadRateLimitError) {
    return NextResponse.json(
      { ok: false, code: "rate_limit_unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  return NextResponse.json(
    { ok: false, code: "site_upload_invalid_request" },
    { status: 400, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(
  request: Request,
  { params }: Readonly<RouteContext>,
): Promise<NextResponse> {
  const route = await params;
  if (
    !routeSlugSchema.safeParse(route.businessSlug).success ||
    !routeSlugSchema.safeParse(route.pageSlug).success ||
    !z.uuid().safeParse(route.grantId).success
  ) {
    return errorResponse(new SiteUploadServiceError("invalid_request"));
  }
  const body = finalizeBodySchema.safeParse(await readJsonAtMost(request));
  if (!body.success) {
    return errorResponse(new SiteUploadServiceError("invalid_request"));
  }

  try {
    const admin = createAdminClient();
    const context = await resolveSitePublicUploadActionContext(admin, {
      businessSlug: route.businessSlug,
      pageSlug: route.pageSlug,
      actionKey: route.actionKey,
      releaseToken: body.data.releaseToken,
      submissionAttemptId: body.data.submissionAttemptId,
      attemptExpiresAt: new Date(
        Date.now() +
          sitePublicUploadLimits.applicationGrantLifetimeMs +
          sitePublicUploadLimits.providerCapabilityLifetimeMs,
      ).toISOString(),
    });
    // The authoritative claim accepts an issued grant and performs the
    // binding check before any state mutation. Content inspection then runs
    // under that same grant claim.
    const result = await finalizeSitePublicUpload(
      admin,
      {
        grant_id: route.grantId,
        submission_attempt_id: body.data.submissionAttemptId,
      },
      context,
    );
    return NextResponse.json(
      {
        ok: true,
        outcome: result.outcome,
        attachmentKind: result.attachment_kind,
        observation: result.observation,
        submissionAttemptId: result.submission_attempt_id,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
