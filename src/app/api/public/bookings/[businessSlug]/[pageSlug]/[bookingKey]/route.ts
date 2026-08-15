import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { createAdminClient } from "../../../../../../../db/supabase/admin";
import {
  resolvePublicBooking,
  submitPublicBooking,
} from "../../../../../../../core/booking/service";
import {
  bookingSubmissionSchema,
  type PublicBookingResult,
} from "../../../../../../../core/booking/schemas";

interface RouteContext {
  params: Promise<{
    businessSlug: string;
    pageSlug: string;
    bookingKey: string;
  }>;
}

function requestFingerprint(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const clientAddress =
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const configuredSecret = process.env.BOOKING_RATE_LIMIT_SECRET;
  if (process.env.NODE_ENV === "production" && !configuredSecret) {
    throw new Error("BOOKING_RATE_LIMIT_SECRET is required in production.");
  }
  return createHash("sha256")
    .update(
      `${configuredSecret ?? "smbos-local-booking"}:${clientAddress}`,
      "utf8",
    )
    .digest("hex");
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { businessSlug, pageSlug, bookingKey } = await context.params;
  try {
    const catalogue = await resolvePublicBooking(
      createAdminClient(),
      businessSlug,
      pageSlug,
      bookingKey,
    );
    return catalogue
      ? NextResponse.json(catalogue, {
          headers: { "cache-control": "no-store" },
        })
      : NextResponse.json({ error: "Not found." }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { businessSlug, pageSlug, bookingKey } = await context.params;
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > 65536) {
    return NextResponse.json(
      { ok: false, code: "invalid_submission" },
      { status: 413 },
    );
  }
  try {
    const body = await request.text();
    if (body.length > 65536) {
      return NextResponse.json(
        { ok: false, code: "invalid_submission" },
        { status: 413 },
      );
    }
    const input = bookingSubmissionSchema.safeParse(JSON.parse(body));
    if (!input.success || input.data.website.trim() !== "") {
      return NextResponse.json(
        { ok: false, code: "invalid_submission" },
        { status: 400 },
      );
    }
    const result: PublicBookingResult = await submitPublicBooking(
      createAdminClient(),
      {
        businessSlug,
        pageSlug,
        bookingKey,
        submission: input.data,
        requestHash: requestFingerprint(request),
      },
    );
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
