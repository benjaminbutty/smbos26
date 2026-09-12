import { NextResponse } from "next/server";
import { z } from "zod";

import type { Json } from "../../../../../../../db/supabase/database.types";
import { createAdminClient } from "../../../../../../../db/supabase/admin";
import {
  submitPublicSiteForm,
  type PublicSiteFormResult,
} from "../../../../../../../core/public/site-form";
import { callPublicRpc } from "../../../../../../../core/public/rpc";
import {
  bookingSubmissionSchema,
  publicBookingResultSchema,
} from "../../../../../../../core/booking/schemas";
import {
  publicPreorderResultSchema,
  publicPreorderSubmissionSchema,
} from "../../../../../../../core/preorder/schemas";
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

const opaqueReleaseTokenSchema = z.string().regex(/^s_[a-f0-9]{64}$/);

const operationalResolverSchema = z.object({
  kind: z.enum(["booking", "preorder"]),
  action_key: z.string().regex(/^o_[a-f0-9]{64}$/),
  release_token: opaqueReleaseTokenSchema,
  action: z.record(z.string(), z.unknown()),
  catalogue: z.unknown(),
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
    const rawBody: unknown = JSON.parse(raw);
    const parsed = publicSiteFormBodySchema.safeParse(rawBody);
    const looksLikeForm =
      typeof rawBody === "object" && rawBody !== null && "answers" in rawBody;
    if (
      looksLikeForm &&
      (!parsed.success || parsed.data.website.trim() !== "")
    ) {
      return NextResponse.json(
        { ok: false, code: "invalid_submission" },
        { status: 400 },
      );
    }
    const requestHash = await trustedSiteUploadSubjectHash();
    const client = createAdminClient();
    if (parsed.success) {
      const result = await submitPublicSiteForm(client, {
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
    }

    const releaseToken = opaqueReleaseTokenSchema.safeParse(
      new URL(request.url).searchParams.get("releaseToken"),
    );
    if (!releaseToken.success) {
      return NextResponse.json(
        { ok: false, code: "invalid_submission" },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    // Operational submitters perform the receipt lookup before resolving the
    // currently published action.  Do not resolve the live action here: a
    // retry may deliberately carry a token from a release that has since been
    // republished or withdrawn, and the immutable receipt is the authority for
    // that retry.  The finite submission grammar provides the only kind
    // discriminator needed at this boundary.
    const rawRecord =
      typeof rawBody === "object" && rawBody !== null && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>)
        : null;
    const looksLikeBooking =
      rawRecord !== null &&
      ["start_at", "customer", "subject", "booking"].some(
        (key) => key in rawRecord,
      );
    const looksLikePreorder =
      rawRecord !== null &&
      ["location_id", "collection_at", "items", "fields"].some(
        (key) => key in rawRecord,
      );
    if (looksLikeBooking) {
      const submission = bookingSubmissionSchema.safeParse(rawBody);
      if (!submission.success || submission.data.website.trim() !== "") {
        return NextResponse.json(
          { ok: false, code: "invalid_submission" },
          { status: 400, headers: { "cache-control": "no-store" } },
        );
      }
      const result = await callPublicRpc<Json>(
        client,
        "submit_public_site_booking_v4",
        {
          requested_business_slug: businessSlug,
          requested_page_slug: pageSlug,
          requested_action_key: actionKey,
          requested_release_token: releaseToken.data,
          requested_idempotency_token: submission.data.idempotency_token,
          requested_submission: submission.data as unknown as Json,
          requested_request_hash: requestHash,
        },
      );
      if (result.error || result.data === null) {
        return NextResponse.json(
          { ok: false, code: "retry" },
          { status: 503, headers: { "cache-control": "no-store" } },
        );
      }
      const parsedResult = publicBookingResultSchema.safeParse(result.data);
      if (!parsedResult.success) {
        return NextResponse.json(
          { ok: false, code: "retry" },
          { status: 503, headers: { "cache-control": "no-store" } },
        );
      }
      return NextResponse.json(parsedResult.data, {
        status: parsedResult.data.ok
          ? 200
          : parsedResult.data.code === "rate_limited"
            ? 429
            : parsedResult.data.code === "not_found"
              ? 404
              : 400,
        headers: { "cache-control": "no-store" },
      });
    }
    if (!looksLikePreorder) {
      return NextResponse.json(
        { ok: false, code: "invalid_submission" },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    const submission = publicPreorderSubmissionSchema.safeParse(rawBody);
    if (!submission.success || submission.data.website.trim() !== "") {
      return NextResponse.json(
        { ok: false, code: "invalid_submission" },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    const result = await callPublicRpc<Json>(
      client,
      "submit_public_site_preorder_v4",
      {
        requested_business_slug: businessSlug,
        requested_page_slug: pageSlug,
        requested_action_key: actionKey,
        requested_release_token: releaseToken.data,
        requested_idempotency_token: submission.data.idempotency_token,
        submission: submission.data as unknown as Json,
        requested_request_hash: requestHash,
      },
    );
    if (result.error || result.data === null) {
      return NextResponse.json(
        { ok: false, code: "retry" },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
    const parsedResult = publicPreorderResultSchema.safeParse(result.data);
    if (!parsedResult.success) {
      return NextResponse.json(
        { ok: false, code: "retry" },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
    return NextResponse.json(parsedResult.data, {
      status: parsedResult.data.ok
        ? 200
        : parsedResult.data.code === "rate_limited"
          ? 429
          : parsedResult.data.code === "not_found"
            ? 404
            : 400,
      headers: { "cache-control": "no-store" },
    });
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

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { businessSlug, pageSlug, actionKey } = await context.params;
  const releaseToken = opaqueReleaseTokenSchema.safeParse(
    new URL(request.url).searchParams.get("releaseToken"),
  );
  if (!releaseToken.success) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  try {
    const resolved = await callPublicRpc<Json>(
      createAdminClient(),
      "resolve_public_site_operational_action_v4",
      {
        requested_business_slug: businessSlug,
        requested_page_slug: pageSlug,
        requested_action_key: actionKey,
        requested_release_token: releaseToken.data,
      },
    );
    const parsed = operationalResolverSchema.safeParse(resolved.data);
    return parsed.success
      ? NextResponse.json(parsed.data.catalogue, {
          headers: { "cache-control": "no-store" },
        })
      : NextResponse.json({ error: "Not found." }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
}
