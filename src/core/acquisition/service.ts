import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { cookies } from "next/headers";

import type { Json, Tables } from "../../db/supabase/database.types";
import { createAdminClient } from "../../db/supabase/admin";
import { composeStarterComposition } from "./composer";
import {
  acquisitionBuildPayloadSchema,
  acquisitionCategorySchema,
  acquisitionRequestSchema,
  type AcquisitionBuildPayload,
  type AcquisitionCategory,
} from "./schemas";

export const ACQUISITION_COOKIE_NAME = "smbos_acquisition_session";
export const ACQUISITION_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;

type AcquisitionSessionRow = Tables<"anonymous_build_sessions">;

export type LoadedAcquisitionSession = {
  token: string;
  row: AcquisitionSessionRow;
  payload: AcquisitionBuildPayload;
  expired: boolean;
};

export class AcquisitionServiceError extends Error {
  readonly code:
    | "session_unavailable"
    | "session_invalid"
    | "proposal_limit_reached"
    | "proposal_write_failed";

  constructor(code: AcquisitionServiceError["code"], cause?: unknown) {
    super(
      code === "proposal_limit_reached"
        ? "You’ve used your free Lenni builds for today."
        : "Lenni could not prepare that starting point. Please try again.",
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
  if (error) {
    throw new AcquisitionServiceError("session_unavailable", error);
  }
  return data;
}

function parsePayload(row: AcquisitionSessionRow): AcquisitionBuildPayload {
  const result = acquisitionBuildPayloadSchema.safeParse(row.proposal_json);
  if (!result.success) {
    throw new AcquisitionServiceError("session_invalid", result.error);
  }
  return result.data;
}

export async function loadAcquisitionSession(): Promise<LoadedAcquisitionSession | null> {
  const token = await readAcquisitionCookieToken();
  if (!token) {
    return null;
  }

  const row = await loadRowByToken(token);
  if (!row) {
    return null;
  }

  const expired =
    row.claim_status === "expired" ||
    (row.claim_status === "active" &&
      new Date(row.expires_at).getTime() <= Date.now());
  if (expired && row.claim_status === "active") {
    const admin = createAdminClient();
    await admin
      .from("anonymous_build_sessions")
      .update({ claim_status: "expired" })
      .eq("id", row.id)
      .eq("claim_status", "active");
  }

  let payload: AcquisitionBuildPayload;
  try {
    payload = parsePayload(row);
  } catch (error) {
    // A damaged temporary session must not turn the public entry route into a
    // server error. Regeneration can replace it with a fresh server payload.
    if (
      error instanceof AcquisitionServiceError &&
      error.code === "session_invalid"
    ) {
      return null;
    }
    throw error;
  }

  return {
    token,
    row: expired ? { ...row, claim_status: "expired" } : row,
    payload,
    expired,
  };
}

export async function createOrRegenerateProposal(
  categoryInput: unknown,
  requestInput: unknown,
): Promise<void> {
  const category = acquisitionCategorySchema.parse(categoryInput);
  const request = acquisitionRequestSchema
    .parse(requestInput)
    .replace(/\s+/g, " ");
  const payload = composeStarterComposition(category, request);
  const existingToken = await readAcquisitionCookieToken();
  const existingRow = existingToken
    ? await loadRowByToken(existingToken)
    : null;
  const existingIsUsable =
    existingRow?.claim_status === "active" &&
    new Date(existingRow.expires_at).getTime() > Date.now();
  const admin = createAdminClient();

  if (existingRow && existingIsUsable) {
    if (existingRow.regeneration_count >= 1) {
      throw new AcquisitionServiceError("proposal_limit_reached");
    }

    const { data, error } = await admin
      .from("anonymous_build_sessions")
      .update({
        proposal_count: existingRow.proposal_count + 1,
        regeneration_count: existingRow.regeneration_count + 1,
        proposal_json: payload as unknown as Json,
        request_text: request,
        requested_category: category,
      })
      .eq("id", existingRow.id)
      .eq("claim_status", "active")
      .eq("regeneration_count", existingRow.regeneration_count)
      .select("id")
      .maybeSingle();
    if (error || !data) {
      throw new AcquisitionServiceError("proposal_write_failed", error);
    }
    return;
  }

  const token = newSessionToken();
  const expiresAt = new Date(
    Date.now() + ACQUISITION_SESSION_MAX_AGE_SECONDS * 1_000,
  ).toISOString();
  const { error } = await admin.from("anonymous_build_sessions").insert({
    expires_at: expiresAt,
    proposal_json: payload as unknown as Json,
    request_text: request,
    requested_category: category,
    session_token_hash: sessionTokenHash(token),
  });
  if (error) {
    throw new AcquisitionServiceError("proposal_write_failed", error);
  }
  await setCookieToken(token);
}

export function parseAcquisitionCategory(value: unknown): AcquisitionCategory {
  return acquisitionCategorySchema.parse(value);
}
