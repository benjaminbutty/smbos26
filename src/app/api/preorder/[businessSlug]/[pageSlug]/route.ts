import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import {
  claimPreorderConfirmationEmail,
  completePreorderConfirmationEmail,
  resolvePublicPreorder,
  submitPublicPreorder,
} from "../../../../../core/preorder/service";
import {
  publicPreorderSubmissionSchema,
  type PublicPreorderResult,
} from "../../../../../core/preorder/schemas";
import {
  defaultPreorderEmailAdapter,
  type PreorderEmailAdapter,
} from "../../../../../core/preorder/email";
import type { Database } from "../../../../../db/supabase/database.types";
import { createAdminClient } from "../../../../../db/supabase/admin";
import { createServerClient } from "../../../../../db/supabase/server";
import { graphKeySchema } from "../../../../../core/graph/schemas";

interface RouteContext {
  params: Promise<{ businessSlug: string; pageSlug: string }>;
}

function requestFingerprint(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const clientAddress =
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const configuredSecret = process.env.PREORDER_RATE_LIMIT_SECRET;
  if (process.env.NODE_ENV === "production" && !configuredSecret) {
    throw new Error("PREORDER_RATE_LIMIT_SECRET is required in production.");
  }
  return createHash("sha256")
    .update(
      `${configuredSecret ?? "smbos-local-preorder"}:${clientAddress}`,
      "utf8",
    )
    .digest("hex");
}

export async function processPreorderSubmission(options: {
  client: SupabaseClient<Database>;
  businessSlug: string;
  pageSlug: string;
  preorderKey: string;
  body: unknown;
  requestHash: string;
  emailAdapter: PreorderEmailAdapter;
}): Promise<PublicPreorderResult> {
  const input = publicPreorderSubmissionSchema.parse(options.body);
  const result = await submitPublicPreorder(
    options.client,
    options.businessSlug,
    options.pageSlug,
    options.preorderKey,
    input,
    options.requestHash,
  );
  if (!result.ok || result.email_status !== "pending") {
    return result;
  }

  const claimed = await claimPreorderConfirmationEmail(
    options.client,
    options.businessSlug,
    options.pageSlug,
    options.preorderKey,
    input.idempotency_token,
  );
  if (!claimed) {
    return result;
  }

  try {
    await options.emailAdapter.sendConfirmation(claimed);
    await completePreorderConfirmationEmail(
      options.client,
      options.businessSlug,
      options.preorderKey,
      input.idempotency_token,
      { succeeded: true },
    );
    return { ...result, email_status: "delivered" };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Email delivery failed.";
    await completePreorderConfirmationEmail(
      options.client,
      options.businessSlug,
      options.preorderKey,
      input.idempotency_token,
      { succeeded: false, error: message },
    );
    console.error("[SMBOS confirmation email failed]", {
      publicReference: result.confirmation.public_reference,
      error: message,
    });
    return { ...result, email_status: "failed" };
  }
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { businessSlug, pageSlug } = await context.params;
  const preorderKey = graphKeySchema.safeParse(
    new URL(request.url).searchParams.get("preorderKey"),
  );
  if (!preorderKey.success) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const client = await createServerClient();
  const catalogue = await resolvePublicPreorder(
    client,
    businessSlug,
    pageSlug,
    preorderKey.data,
  );
  return catalogue
    ? NextResponse.json(catalogue, {
        headers: { "cache-control": "no-store" },
      })
    : NextResponse.json({ error: "Not found." }, { status: 404 });
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { businessSlug, pageSlug } = await context.params;
  const preorderKey = graphKeySchema.safeParse(
    new URL(request.url).searchParams.get("preorderKey"),
  );
  if (!preorderKey.success) {
    return NextResponse.json({ ok: false, code: "not_found" }, { status: 404 });
  }

  let body: unknown;
  try {
    const contentLength = request.headers.get("content-length");
    if (contentLength && Number(contentLength) > 50000) {
      return NextResponse.json(
        { ok: false, code: "invalid_submission" },
        { status: 413 },
      );
    }
    const text = await request.text();
    if (text.length > 50000) {
      return NextResponse.json(
        { ok: false, code: "invalid_submission" },
        { status: 413 },
      );
    }
    body = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { ok: false, code: "invalid_submission" },
      { status: 400 },
    );
  }

  const parsed = publicPreorderSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "invalid_submission" },
      { status: 400 },
    );
  }

  try {
    const client = createAdminClient();
    const result = await processPreorderSubmission({
      client,
      businessSlug,
      pageSlug,
      preorderKey: preorderKey.data,
      body: parsed.data,
      requestHash: requestFingerprint(request),
      emailAdapter: defaultPreorderEmailAdapter(),
    });
    const status =
      result.ok || result.code === "sold_out"
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
  } catch (error) {
    console.error("[SMBOS preorder submission failed]", error);
    return NextResponse.json(
      { ok: false, code: "invalid_submission" },
      { status: 500 },
    );
  }
}
