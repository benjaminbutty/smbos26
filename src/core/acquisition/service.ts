import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";

import { cookies, headers } from "next/headers";
import { z } from "zod";

import type { Json, Tables } from "../../db/supabase/database.types";
import { createAdminClient } from "../../db/supabase/admin";
import { getEnvironment } from "../../env";
import {
  addClarificationAnswer,
  assessAcquisitionClarifications,
  acquisitionClarificationKeySchema,
  acquisitionClarificationStateSchema,
  buildEnrichedAcquisitionRequest,
  type AcquisitionClarificationState,
} from "./clarification";
import { enhanceAcquisitionPayload } from "./capabilities";
import { candidateChecksum } from "./preview";
import { composeStarterComposition } from "./composer";
import { emitAcquisitionEvent } from "./events";
import { interpretAcquisitionRequest } from "./interpreter";
import { validateAcquisitionCandidate } from "./quality";
import { reconcileAcquisitionRefinement } from "./refinement";
import { emitAcquisitionRefinementDiagnostic } from "./refinement-diagnostics";
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
export const ACQUISITION_SESSION_ATTEMPT_LIMIT = 6;
export const ACQUISITION_SUCCESSFUL_REFINEMENT_LIMIT = 2;

type AcquisitionSessionRow = Tables<"anonymous_build_sessions">;

export type LoadedAcquisitionSession = {
  token: string;
  row: AcquisitionSessionRow;
  payload: AcquisitionBuildPayload | null;
  clarification: AcquisitionClarificationState | null;
  expired: false;
};

const reservationSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      session_id: z.uuid(),
      attempt_number: z
        .number()
        .int()
        .min(1)
        .max(ACQUISITION_SESSION_ATTEMPT_LIMIT),
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
    | "session_limit_reached"
    | "proposal_limit_reached"
    | "refinement_limit_reached"
    | "refinement_failed"
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
          : code === "session_limit_reached"
            ? "This Lenni session has reached its retry limit. Start a fresh starting point to continue."
            : code === "refinement_limit_reached"
              ? "You’ve used the two successful refinements available in this starting session."
              : code === "refinement_failed"
                ? "Lenni couldn’t apply that change safely. Your refinement allowance is still available; try a smaller change."
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
        clarification_json: null,
      })
      .eq("id", row.id)
      .eq("claim_status", "active");
    return null;
  }
  const payload = acquisitionBuildPayloadSchema.safeParse(row.proposal_json);
  const clarification = acquisitionClarificationStateSchema.safeParse(
    row.clarification_json,
  );
  if (!payload.success && !clarification.success) return null;
  return {
    token,
    row,
    payload: payload.success ? payload.data : null,
    clarification: clarification.success ? clarification.data : null,
    expired: false,
  };
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
        : reservation.data.code === "session_limit_reached"
          ? "session_limit_reached"
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

  const assessment = assessAcquisitionClarifications(category, request);
  if (assessment.nextQuestion) {
    await writeClarificationState({
      sessionId: reservation.session_id,
      attemptNumber: reservation.attempt_number,
      category,
      request,
      state: assessment.state,
    });
    emitAcquisitionEvent("clarification_question_shown", {
      category,
      question_key: assessment.nextQuestion,
      round: assessment.state.round,
    });
    return;
  }

  const payload = await generateCandidate(
    category,
    request,
    assessment.decisions,
  );
  await writeProposal({
    sessionId: reservation.session_id,
    attemptNumber: reservation.attempt_number,
    category,
    request,
    payload,
    clarification: assessment.state,
  });
  emitAcquisitionEvent(
    reservation.attempt_number > 1 ? "proposal_regenerated" : "proposal_ready",
    { category, source: payload.proposal.source },
  );
}

export async function acceptAcquisitionSetup(): Promise<string> {
  const session = await loadAcquisitionSession();
  if (!session?.payload) {
    throw new AcquisitionServiceError(
      "session_invalid",
      undefined,
      "This starting workspace is no longer available. Return to Lenni and prepare a fresh one.",
    );
  }
  const checksum = candidateChecksum(
    session.payload,
    Math.max(1, session.row.proposal_count),
  );
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("anonymous_build_sessions")
    .update({
      accepted_candidate_checksum: checksum,
      accepted_at: new Date().toISOString(),
    })
    .eq("id", session.row.id)
    .eq("claim_status", "active")
    .select("accepted_candidate_checksum")
    .maybeSingle();
  if (error || !data || data.accepted_candidate_checksum !== checksum) {
    throw new AcquisitionServiceError("proposal_write_failed", error);
  }
  emitAcquisitionEvent("candidate_accepted", {
    category: session.row.requested_category,
  });
  return checksum;
}

export async function refineAcquisitionProposal(
  refinementInput: unknown,
): Promise<void> {
  const refinement = z.string().trim().min(1).max(500).parse(refinementInput);
  const session = await loadAcquisitionSession();
  if (!session?.payload || !session.clarification) {
    throw new AcquisitionServiceError(
      "session_invalid",
      undefined,
      "This Lenni conversation is no longer available. Return to Lenni and start again.",
    );
  }
  const category = acquisitionCategorySchema.parse(
    session.row.requested_category,
  );
  if (!session.row.request_text) {
    throw new AcquisitionServiceError("session_invalid");
  }
  const originalRequest = acquisitionRequestSchema.parse(
    session.row.request_text,
  );
  if (
    session.row.successful_refinement_count >=
    ACQUISITION_SUCCESSFUL_REFINEMENT_LIMIT
  ) {
    throw new AcquisitionServiceError("refinement_limit_reached");
  }
  const reservation = await reserveAttempt(category);
  const request = `${originalRequest.slice(0, 3_400)}

${refinement}`
    .replace(/\s+/g, " ")
    .slice(0, 4_000);
  const refinementAssessment = assessAcquisitionClarifications(
    category,
    request,
    session.clarification,
  );
  let suggestedPayload: AcquisitionBuildPayload;
  try {
    suggestedPayload = await generateCandidate(
      category,
      request,
      refinementAssessment.decisions,
      { allowFallback: false },
    );
  } catch (error) {
    emitAcquisitionRefinementDiagnostic(error, "candidate_generation");
    emitAcquisitionEvent("proposal_failed", {
      category,
      reason: "candidate_quality_rejected",
    });
    throw new AcquisitionServiceError("refinement_failed", error);
  }
  let payload: AcquisitionBuildPayload;
  try {
    payload = reconcileAcquisitionRefinement(
      session.payload,
      suggestedPayload,
      refinement,
    );
  } catch (error) {
    emitAcquisitionRefinementDiagnostic(error, "reconciliation");
    emitAcquisitionEvent("proposal_failed", {
      category,
      reason: "candidate_quality_rejected",
    });
    throw new AcquisitionServiceError("refinement_failed", error);
  }
  const summary = payload.proposal.refinement_summary;
  if (
    !summary ||
    (summary.added.length === 0 &&
      summary.updated.length === 0 &&
      summary.removed.length === 0)
  ) {
    emitAcquisitionEvent("proposal_failed", {
      category,
      reason: "candidate_quality_rejected",
    });
    throw new AcquisitionServiceError(
      "refinement_failed",
      new Error("The requested refinement produced no safe change."),
    );
  }
  await writeProposal({
    sessionId: reservation.session_id,
    attemptNumber: reservation.attempt_number,
    category,
    request: originalRequest,
    payload,
    clarification: refinementAssessment.state,
    isRefinement: true,
    previousSuccessfulRefinementCount: session.row.successful_refinement_count,
  });
  emitAcquisitionEvent("proposal_regenerated", {
    category,
    source: payload.proposal.source,
  });
}

async function generateCandidate(
  category: AcquisitionCategory,
  request: string,
  decisions: Parameters<typeof enhanceAcquisitionPayload>[1],
  options: { allowFallback?: boolean } = {},
): Promise<AcquisitionBuildPayload> {
  const allowFallback = options.allowFallback ?? true;
  const enrichedRequest = buildEnrichedAcquisitionRequest(request, decisions);
  let payload: AcquisitionBuildPayload;
  try {
    payload = await interpretAcquisitionRequest(category, enrichedRequest);
  } catch (error) {
    emitAcquisitionEvent("proposal_failed", {
      category,
      reason:
        error instanceof Error &&
        "code" in error &&
        error.code === "needs_more_detail"
          ? "discovery_needs_detail"
          : "tailoring_unavailable",
    });
    if (!allowFallback) throw error;
    payload = composeStarterComposition(category, request);
  }
  try {
    return validateAcquisitionCandidate(
      enhanceAcquisitionPayload(payload, decisions, request),
    );
  } catch (error) {
    emitAcquisitionEvent("proposal_failed", {
      category,
      reason: "candidate_quality_rejected",
    });
    if (!allowFallback) throw error;
    const fallback = composeStarterComposition(category, request);
    return validateAcquisitionCandidate(
      enhanceAcquisitionPayload(fallback, decisions, request),
    );
  }
}

async function writeClarificationState(input: {
  sessionId: string;
  attemptNumber: number;
  category: AcquisitionCategory;
  request: string;
  state: AcquisitionClarificationState;
}): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("anonymous_build_sessions")
    .update({
      proposal_count: 0,
      proposal_json: null,
      request_text: input.request,
      requested_category: input.category,
      clarification_json: input.state as unknown as Json,
    })
    .eq("id", input.sessionId)
    .eq("claim_status", "active")
    .eq("attempt_count", input.attemptNumber)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    emitAcquisitionEvent("proposal_failed", {
      category: input.category,
      reason: "write_failed",
    });
    throw new AcquisitionServiceError("proposal_write_failed", error);
  }
}

async function writeProposal(input: {
  sessionId: string;
  attemptNumber: number;
  category: AcquisitionCategory;
  request: string;
  payload: AcquisitionBuildPayload;
  clarification: AcquisitionClarificationState;
  isRefinement?: boolean;
  previousSuccessfulRefinementCount?: number;
}): Promise<void> {
  const admin = createAdminClient();
  const update = {
    proposal_count: input.attemptNumber,
    regeneration_count: input.attemptNumber > 1 ? 1 : 0,
    proposal_json: input.payload as unknown as Json,
    request_text: input.request,
    requested_category: input.category,
    clarification_json: input.clarification as unknown as Json,
    ...(input.isRefinement
      ? {
          successful_refinement_count:
            (input.previousSuccessfulRefinementCount ?? 0) + 1,
        }
      : {}),
  };
  let proposalUpdate = admin
    .from("anonymous_build_sessions")
    .update(update)
    .eq("id", input.sessionId)
    .eq("claim_status", "active")
    .eq("attempt_count", input.attemptNumber);
  if (input.isRefinement) {
    proposalUpdate = proposalUpdate.eq(
      "successful_refinement_count",
      input.previousSuccessfulRefinementCount ?? 0,
    );
  }
  const { data, error } = await proposalUpdate.select("id").maybeSingle();
  if (error || !data) {
    emitAcquisitionEvent("proposal_failed", {
      category: input.category,
      reason: "write_failed",
    });
    throw new AcquisitionServiceError("proposal_write_failed", error);
  }
}

export async function answerAcquisitionQuestion(
  questionKeyInput: unknown,
  answerInput: unknown,
): Promise<void> {
  const questionKey = acquisitionClarificationKeySchema.parse(questionKeyInput);
  const answer = z.string().trim().min(1).max(500).parse(answerInput);
  const session = await loadAcquisitionSession();
  if (!session?.clarification || !session.row.request_text) {
    throw new AcquisitionServiceError("session_invalid");
  }
  const currentQuestion = session.clarification.asked_keys.find(
    (key) => !session.clarification?.answers.some((entry) => entry.key === key),
  );
  if (currentQuestion !== questionKey) {
    throw new AcquisitionServiceError("session_invalid");
  }

  const withAnswer = addClarificationAnswer(
    session.clarification,
    questionKey,
    answer,
  );
  const category = acquisitionCategorySchema.parse(
    session.row.requested_category,
  );
  const assessment = assessAcquisitionClarifications(
    category,
    session.row.request_text,
    withAnswer,
  );
  emitAcquisitionEvent("clarification_answered", {
    category,
    question_key: questionKey,
    round: withAnswer.round,
  });

  if (assessment.nextQuestion) {
    await writeClarificationState({
      sessionId: session.row.id,
      attemptNumber: session.row.attempt_count,
      category,
      request: session.row.request_text,
      state: assessment.state,
    });
    emitAcquisitionEvent("clarification_question_shown", {
      category,
      question_key: assessment.nextQuestion,
      round: assessment.state.round,
    });
    return;
  }

  const payload = await generateCandidate(
    category,
    session.row.request_text,
    assessment.decisions,
  );
  await writeProposal({
    sessionId: session.row.id,
    attemptNumber: session.row.attempt_count,
    category,
    request: session.row.request_text,
    payload,
    clarification: assessment.state,
  });
  emitAcquisitionEvent("clarification_completed", {
    category,
    round: assessment.state.round,
  });
  emitAcquisitionEvent("proposal_ready", {
    category,
    source: payload.proposal.source,
  });
}
