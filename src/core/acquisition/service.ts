import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";

import { cookies, headers } from "next/headers";
import { z } from "zod";

import type { Json, Tables } from "../../db/supabase/database.types";
import { createAdminClient } from "../../db/supabase/admin";
import { getEnvironment } from "../../env";
import { composeStarterComposition } from "./composer";
import { emitAcquisitionEvent } from "./events";
import { interpretAcquisitionRequest } from "./interpreter";
import {
  acquisitionBuildPayloadSchema,
  acquisitionCategorySchema,
  acquisitionRequestSchema,
  type AcquisitionBuildPayload,
  type AcquisitionCategory,
} from "./schemas";

export const ACQUISITION_COOKIE_NAME = "smbos_acquisition_session";
export const ACQUISITION_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;
export const ACQUISITION_DAILY_ATTEMPT_LIMIT = 6;

type AcquisitionSessionRow = Tables<"anonymous_build_sessions">;

export type LoadedAcquisitionSession = {
  token: string;
  row: AcquisitionSessionRow;
  payload: AcquisitionBuildPayload;
  expired: false;
};

const reservationSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      session_id: z.uuid(),
      attempt_number: z.number().int().min(1).max(2),
      daily_attempt_number: z.number().int().min(1).max(6),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      code: z.enum([
        "session_unavailable",
        "session_limit_reached",
        "daily_limit_reached",
      ]),
    })
    .strict(),
]);

export class AcquisitionServiceError extends Error {
  readonly code:
    | "session_unavailable"
    | "session_invalid"
    | "proposal_limit_reached"
    | "needs_more_detail"
    | "proposal_write_failed";

  constructor(
    code: AcquisitionServiceError["code"],
    cause?: unknown,
    ownerMessage?: string,
  ) {
    super(
      ownerMessage ??
        (code === "proposal_limit_reached"
          ? "You’ve used your free Lenni builds for today."
          : code === "needs_more_detail"
            ? "Add a little more detail about the work you want to organise, then try once more."
            : "Lenni could not prepare that starting point. Please try again."),
      { cause },
    );
    this.name = "AcquisitionServiceError";
    this.code = code;
  }
}

function sessionTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function acquisitionRateKey(networkSignal: string): string {
  const environment = getEnvironment();
  const secret =
    environment.ACQUISITION_RATE_LIMIT_SECRET ??
    (environment.NODE_ENV === "production"
      ? undefined
      : "local-acquisition-rate-limit-secret");
  if (!secret) throw new AcquisitionServiceError("session_unavailable");
  return createHmac("sha256", secret)
    .update(networkSignal, "utf8")
    .digest("hex");
}

async function trustedNetworkSignal(): Promise<string> {
  const requestHeaders = await headers();
  if (process.env.VERCEL === "1") {
    return (
      requestHeaders.get("x-vercel-forwarded-for")?.split(",", 1)[0]?.trim() ||
      "vercel-origin-unavailable"
    );
  }
  if (process.env.NODE_ENV !== "production") {
    return (
      requestHeaders.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ||
      "local-development"
    );
  }
  // Fail closed for an unknown production proxy instead of trusting a
  // caller-controlled forwarding header.
  return "production-origin-unavailable";
}

export async function readAcquisitionCookieToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(ACQUISITION_COOKIE_NAME)?.value ?? null;
}

async function setCookieToken(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ACQUISITION_COOKIE_NAME, token, {
    httpOnly: true,
    maxAge: ACQUISITION_SESSION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function clearAcquisitionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ACQUISITION_COOKIE_NAME);
}

async function loadRowByToken(
  token: string,
): Promise<AcquisitionSessionRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("anonymous_build_sessions")
    .select("*")
    .eq("session_token_hash", sessionTokenHash(token))
    .maybeSingle();
  if (error) throw new AcquisitionServiceError("session_unavailable", error);
  return data;
}

export async function loadAcquisitionSession(): Promise<LoadedAcquisitionSession | null> {
  const token = await readAcquisitionCookieToken();
  if (!token) return null;
  const row = await loadRowByToken(token);
  if (!row || row.claim_status !== "active") return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    const admin = createAdminClient();
    await admin
      .from("anonymous_build_sessions")
      .update({
        claim_status: "expired",
        proposal_json: null,
        request_text: null,
      })
      .eq("id", row.id)
      .eq("claim_status", "active");
    return null;
  }
  const payload = acquisitionBuildPayloadSchema.safeParse(row.proposal_json);
  if (!payload.success) return null;
  return { token, row, payload: payload.data, expired: false };
}

async function reserveAttempt(category: AcquisitionCategory) {
  const existingToken = await readAcquisitionCookieToken();
  const existingRow = existingToken
    ? await loadRowByToken(existingToken)
    : null;
  const existingUsable =
    existingRow?.claim_status === "active" &&
    new Date(existingRow.expires_at).getTime() > Date.now();
  const token =
    existingUsable && existingToken ? existingToken : newSessionToken();
  const expiresAt = new Date(
    Date.now() + ACQUISITION_SESSION_MAX_AGE_SECONDS * 1_000,
  ).toISOString();
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("reserve_anonymous_build_attempt", {
    requested_category_value: category,
    requested_expires_at: expiresAt,
    requested_rate_key: acquisitionRateKey(await trustedNetworkSignal()),
    requested_session_token_hash: sessionTokenHash(token),
  });
  if (error) throw new AcquisitionServiceError("proposal_write_failed", error);
  const reservation = reservationSchema.safeParse(data);
  if (!reservation.success) {
    throw new AcquisitionServiceError(
      "proposal_write_failed",
      reservation.error,
    );
  }
  if (!reservation.data.ok) {
    throw new AcquisitionServiceError(
      reservation.data.code === "session_unavailable"
        ? "session_unavailable"
        : "proposal_limit_reached",
    );
  }
  await setCookieToken(token);
  return { token, ...reservation.data };
}

export async function createOrRegenerateProposal(
  categoryInput: unknown,
  requestInput: unknown,
): Promise<void> {
  const category = acquisitionCategorySchema.parse(categoryInput);
  const request = acquisitionRequestSchema
    .parse(requestInput)
    .replace(/\s+/g, " ");
  const reservation = await reserveAttempt(category);
  emitAcquisitionEvent("prompt_submitted", {
    category,
    attempt_number: reservation.attempt_number,
  });

  let payload: AcquisitionBuildPayload;
  try {
    payload = await interpretAcquisitionRequest(category, request);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "needs_more_detail"
    ) {
      emitAcquisitionEvent("proposal_failed", {
        category,
        reason: "needs_more_detail",
      });
      throw new AcquisitionServiceError(
        "needs_more_detail",
        error,
        error.message,
      );
    }
    emitAcquisitionEvent("proposal_failed", {
      category,
      reason: "tailoring_unavailable",
    });
    payload = composeStarterComposition(category, request);
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("anonymous_build_sessions")
    .update({
      proposal_count: reservation.attempt_number,
      regeneration_count: reservation.attempt_number > 1 ? 1 : 0,
      proposal_json: payload as unknown as Json,
      request_text: request,
      requested_category: category,
    })
    .eq("id", reservation.session_id)
    .eq("claim_status", "active")
    .eq("attempt_count", reservation.attempt_number)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    emitAcquisitionEvent("proposal_failed", {
      category,
      reason: "write_failed",
    });
    throw new AcquisitionServiceError("proposal_write_failed", error);
  }
  emitAcquisitionEvent(
    reservation.attempt_number > 1 ? "proposal_regenerated" : "proposal_ready",
    { category, source: payload.proposal.source },
  );
}
