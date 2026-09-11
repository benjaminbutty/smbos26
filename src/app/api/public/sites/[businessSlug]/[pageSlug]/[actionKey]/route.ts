import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "../../../../../../../db/supabase/admin";
import {
  submitPublicSiteForm,
  type PublicSiteFormResult,
} from "../../../../../../../core/public/site-form";
import { jsonObjectSchema } from "../../../../../../../core/graph/schemas";
import {
  SiteUploadRateLimitError,
  trustedSiteUploadSubjectHash,
} from "../../../../../../../core/sites/upload-rate-limit";

interface RouteContext {
  params: Promise<{
    businessSlug: string;
    pageSlug: string;
    actionKey: string;
  }>;
}

async function readBodyAtMost(
  request: Request,
  maximumBytes: number,
): Promise<string | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      totalBytes += result.value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

const publicSiteFormBodySchema = z
  .object({
    releaseToken: z.string().regex(/^s_[a-f0-9]{64}$/),
    idempotencyToken: z.uuid(),
    submissionAttemptId: z.uuid().optional(),
    answers: jsonObjectSchema,
    grantIds: z.array(z.uuid()).max(5).default([]),
    website: z.string().max(200).default(""),
  })
  .strict()
  .superRefine((body, context) => {
    if (Object.keys(body.answers).length > 50) {
      context.addIssue({
        code: "custom",
        message: "A Form can contain at most 50 answers.",
        path: ["answers"],
      });
    }
  });

function responseForResult(result: PublicSiteFormResult): NextResponse {
  if (!result.ok) {
    const status =
      result.code === "rate_limited"
        ? 429
        : result.code === "not_found" || result.code === "action_unavailable"
          ? 404
          : result.code === "idempotency_conflict"
            ? 409
            : 400;
    return NextResponse.json(
      {
        ok: false,
        code: result.code,
        ...(result.message ? { message: result.message } : {}),
      },
      { status, headers: { "cache-control": "no-store" } },
    );
  }
  const publicReference =
    result.public_reference ?? result.confirmation?.public_reference;
  return NextResponse.json(
    {
      ok: true,
      idempotent: result.idempotent,
      ...(publicReference ? { publicReference } : {}),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { businessSlug, pageSlug, actionKey } = await context.params;
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > 65536) {
    return NextResponse.json(
      { ok: false, code: "invalid_submission" },
      { status: 413 },
    );
  }

  try {
    const raw = await readBodyAtMost(request, 65536);
    if (raw === null) {
      return NextResponse.json(
        { ok: false, code: "invalid_submission" },
        { status: 413 },
      );
    }
    const parsed = publicSiteFormBodySchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.website.trim() !== "") {
      return NextResponse.json(
        { ok: false, code: "invalid_submission" },
        { status: 400 },
      );
    }
    const requestHash = await trustedSiteUploadSubjectHash();
    const result = await submitPublicSiteForm(createAdminClient(), {
      businessSlug,
      pageSlug,
      actionKey,
      releaseToken: parsed.data.releaseToken,
      idempotencyToken: parsed.data.idempotencyToken,
      submissionAttemptId:
        parsed.data.submissionAttemptId ?? parsed.data.idempotencyToken,
      answers: parsed.data.answers,
      grantIds: parsed.data.grantIds,
      requestHash,
    });
    return responseForResult(result);
  } catch (error) {
    if (error instanceof SiteUploadRateLimitError) {
      return NextResponse.json(
        { ok: false, code: "rate_limit_unavailable" },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
    return NextResponse.json(
      { ok: false, code: "invalid_submission" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
