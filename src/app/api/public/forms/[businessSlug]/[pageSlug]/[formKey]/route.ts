import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "../../../../../../../db/supabase/admin";
import { loadPublicFormRuntime } from "../../../../../../../core/public/page";
import { submitPublicCreateForm } from "../../../../../../../core/public/form";
import { buildConfiguredSubmission } from "../../../../../../../runtime/forms/submission";
import { jsonValueSchema } from "../../../../../../../core/graph/schemas";

interface RouteContext {
  params: Promise<{ businessSlug: string; pageSlug: string; formKey: string }>;
}

function requestFingerprint(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const clientAddress =
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const configuredSecret = process.env.PUBLIC_FORM_RATE_LIMIT_SECRET;
  if (process.env.NODE_ENV === "production" && !configuredSecret) {
    throw new Error("PUBLIC_FORM_RATE_LIMIT_SECRET is required in production.");
  }
  return createHash("sha256")
    .update(
      `${configuredSecret ?? "smbos-local-public-form"}:${clientAddress}`,
      "utf8",
    )
    .digest("hex");
}

const jsonSubmissionSchema = z
  .object({
    idempotency_token: z.uuid(),
    website: z.string().max(200).default(""),
  })
  .catchall(jsonValueSchema);

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { businessSlug, pageSlug, formKey } = await context.params;
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > 65536) {
    return NextResponse.json(
      { ok: false, code: "invalid_submission" },
      { status: 413 },
    );
  }

  try {
    const runtime = await loadPublicFormRuntime(
      businessSlug,
      pageSlug,
      formKey,
    );
    if (!runtime) {
      return NextResponse.json(
        { ok: false, code: "not_found" },
        { status: 404 },
      );
    }

    let idempotencyToken: string;
    let data: Record<
      string,
      import("../../../../../../../db/supabase/database.types").Json
    >;
    let website = "";
    if (request.headers.get("content-type")?.includes("application/json")) {
      const raw = await request.text();
      if (raw.length > 65536) {
        return NextResponse.json(
          { ok: false, code: "invalid_submission" },
          { status: 413 },
        );
      }
      const parsed = jsonSubmissionSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        return NextResponse.json(
          { ok: false, code: "invalid_submission" },
          { status: 400 },
        );
      }
      idempotencyToken = parsed.data.idempotency_token;
      website = parsed.data.website;
      const { idempotency_token: _, website: __, ...submitted } = parsed.data;
      void _;
      void __;
      data = submitted;
    } else {
      const formData = await request.formData();
      const parsedToken = z.uuid().safeParse(formData.get("idempotency_token"));
      if (!parsedToken.success) {
        return NextResponse.json(
          { ok: false, code: "invalid_submission" },
          { status: 400 },
        );
      }
      idempotencyToken = parsedToken.data;
      const rawWebsite = formData.get("website");
      website = typeof rawWebsite === "string" ? rawWebsite : "";
      data = buildConfiguredSubmission(
        runtime.fields,
        runtime.config,
        "create",
        formData,
      );
    }

    if (website.trim() !== "") {
      return NextResponse.json(
        { ok: false, code: "invalid_submission" },
        { status: 400 },
      );
    }

    const result = await submitPublicCreateForm(createAdminClient(), {
      businessSlug,
      pageSlug,
      formKey,
      idempotencyToken,
      data,
      requestHash: requestFingerprint(request),
    });
    const status = result.ok
      ? 200
      : result.code === "rate_limited"
        ? 429
        : result.code === "not_found"
          ? 404
          : 400;
    return NextResponse.json(result, {
      status,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { ok: false, code: "invalid_submission" },
      { status: 400 },
    );
  }
}
