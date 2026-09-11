import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "../../db/supabase/database.types";
import { createAdminClient } from "../../db/supabase/admin";
import { getEnvironment } from "../../env";
import {
  sitePublicUploadActionContextSchema,
  sitePublicUploadCapabilitySchema,
  sitePublicUploadFinalizeResultSchema,
  sitePublicUploadFinalizeSchema,
  sitePublicUploadIssueRequestSchema,
  sitePublicUploadLimits,
  sitePublicUploadGrantSchema,
  sitePublicUploadBucket,
  sitePublicVerifiedKeyForObservation,
  type SitePublicUploadActionContext,
} from "./upload-protocol";
import {
  SiteUploadValidationError,
  validateSiteUploadBytes,
  type ValidatedSiteUpload,
} from "./upload-validation";
import {
  cleanupSitePublicUploadGrant as cleanupSitePublicUploadGrantCore,
  listSitePublicUploadStoragePaths,
} from "./upload-cleanup";
import { SiteUploadServiceError } from "./upload-errors";

export { SiteUploadServiceError } from "./upload-errors";

type RpcResult<T> = { data: T | null; error: unknown | null };
type RpcClient = {
  rpc<T = unknown>(
    functionName: string,
    parameters: Record<string, unknown>,
  ): Promise<RpcResult<T>>;
};

type StorageFileApi = {
  createSignedUploadUrl(
    path: string,
    options?: { upsert?: boolean },
  ): Promise<{
    data: { signedUrl: string; path: string; token: string } | null;
    error: unknown | null;
  }>;
  upload(
    path: string,
    body: Uint8Array,
    options?: {
      cacheControl?: string;
      contentType?: string;
      upsert?: boolean;
    },
  ): Promise<RpcResult<unknown>>;
  download(path: string): Promise<{ data: Blob | null; error: unknown | null }>;
  list(
    prefix?: string,
    options?: { limit?: number; offset?: number },
  ): Promise<{
    data: Array<{ name: string }> | null;
    error: unknown | null;
  }>;
  remove(paths: string[]): Promise<RpcResult<unknown>>;
};

type UploadAdminClient = RpcClient & {
  storage: { from(bucket: string): StorageFileApi };
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): unknown;
    };
  };
};

const rpcClient = (client: unknown): RpcClient => client as RpcClient;
const storageClient = (client: unknown): UploadAdminClient =>
  client as UploadAdminClient;

/*
 * These are the symbolic exceptions raised by the upload RPCs (and by the
 * Form action resolver they call). Keep this allow-list finite: a PostgREST
 * message is diagnostic input, not an authority to choose a public error.
 */
const siteUploadRpcFailureCodes = [
  "site_form_action_unavailable",
  "site_upload_action_context_mismatch",
  "site_upload_action_context_unavailable",
  "site_upload_action_unavailable",
  "site_upload_application_expired",
  "site_upload_attempt_binding_invalid",
  "site_upload_attempt_closed",
  "site_upload_attachment_duplicate",
  "site_upload_attachment_id_invalid",
  "site_upload_attachment_immutable",
  "site_upload_attachment_unavailable",
  "site_upload_attachment_value_invalid",
  "site_upload_claim_busy",
  "site_upload_claim_lost",
  "site_upload_committed_quota_exceeded",
  "site_upload_content_type_invalid",
  "site_upload_field_unavailable",
  "site_upload_finalization_invalid",
  "site_upload_grant_unavailable",
  "site_upload_issue_window_closed",
  "site_upload_not_found",
  "site_upload_question_file_limit",
  "site_upload_question_ordinal_duplicate",
  "site_upload_question_request_invalid",
  "site_upload_question_unavailable",
  "site_upload_quota_exceeded",
  "site_upload_rate_limited",
  "site_upload_record_data_invalid",
  "site_upload_reject_invalid_state",
  "site_upload_request_invalid",
  "site_upload_submission_attempt_expired",
  "site_upload_submission_file_limit",
  "site_upload_submit_invalid",
  "site_upload_verified_key_invalid",
] as const;

type SiteUploadRpcFailureCode = (typeof siteUploadRpcFailureCodes)[number];

function rpcFailureCode(error: unknown): SiteUploadRpcFailureCode | null {
  const values: unknown[] = [];
  if (typeof error === "string") values.push(error);
  if (error && typeof error === "object") {
    const fields = error as Record<string, unknown>;
    for (const key of ["message", "details", "hint"] as const) {
      if (key in fields) values.push(fields[key]);
    }
  }
  for (const value of values) {
    if (typeof value !== "string") continue;
    const code = siteUploadRpcFailureCodes.find((candidate) =>
      value.includes(candidate),
    );
    if (code) return code;
  }
  return null;
}

function mapRpcFailureCode(
  code: SiteUploadRpcFailureCode | null,
): SiteUploadServiceError["code"] {
  switch (code) {
    case "site_upload_rate_limited":
      return "rate_limited";
    case "site_upload_submission_attempt_expired":
    case "site_upload_application_expired":
    case "site_upload_issue_window_closed":
      return "expired";
    case "site_upload_quota_exceeded":
    case "site_upload_committed_quota_exceeded":
      return "quota_exceeded";
    case "site_upload_request_invalid":
    case "site_upload_question_request_invalid":
    case "site_upload_submission_file_limit":
    case "site_upload_question_file_limit":
    case "site_upload_submit_invalid":
    case "site_upload_question_ordinal_duplicate":
    case "site_upload_attachment_id_invalid":
    case "site_upload_attachment_duplicate":
    case "site_upload_attachment_value_invalid":
      return "invalid_request";
    case "site_upload_finalization_invalid":
    case "site_upload_content_type_invalid":
    case "site_upload_verified_key_invalid":
    case "site_upload_attachment_immutable":
    case "site_upload_record_data_invalid":
      return "integrity_failed";
    case "site_upload_claim_lost":
      return "claim_lost";
    case "site_form_action_unavailable":
    case "site_upload_action_context_mismatch":
    case "site_upload_action_context_unavailable":
    case "site_upload_action_unavailable":
    case "site_upload_attempt_binding_invalid":
    case "site_upload_attempt_closed":
    case "site_upload_attachment_unavailable":
    case "site_upload_field_unavailable":
    case "site_upload_grant_unavailable":
    case "site_upload_not_found":
    case "site_upload_question_unavailable":
    case "site_upload_reject_invalid_state":
      return "unavailable";
    case "site_upload_claim_busy":
    case null:
      return "provider_failed";
  }
}

async function callRpc<T>(
  client: unknown,
  functionName: string,
  parameters: Record<string, unknown>,
): Promise<T> {
  const result = await rpcClient(client).rpc<T>(functionName, parameters);
  if (result.error || result.data === null) {
    const code = rpcFailureCode(result.error);
    const mappedCode = mapRpcFailureCode(code);
    throw new SiteUploadServiceError(
      mappedCode,
      mappedCode === "provider_failed"
        ? "The upload service could not complete this request. Try again."
        : mappedCode === "quota_exceeded"
          ? "The upload storage limit has been reached."
          : "The upload session is unavailable.",
      { cause: result.error },
    );
  }
  return result.data;
}

function grantRows(value: unknown) {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    value.error === "site_upload_rate_limited"
  ) {
    throw new SiteUploadServiceError(
      "rate_limited",
      "Too many upload requests. Try again shortly.",
    );
  }
  const rows = Array.isArray(value)
    ? value
    : typeof value === "object" && value !== null && "grants" in value
      ? value.grants
      : null;
  return z.array(sitePublicUploadGrantSchema).parse(rows);
}

function normalizeIssueCounts(
  context: SitePublicUploadActionContext,
  requestInput: unknown,
): Array<{ question_key: string; count: number }> {
  const request = sitePublicUploadIssueRequestSchema.parse(requestInput);
  if (request.submission_attempt_id !== context.submissionAttemptId) {
    throw new SiteUploadServiceError("invalid_request");
  }
  const questions = new Map(
    context.questions.map((question) => [question.questionKey, question]),
  );
  const seen = new Set<string>();
  const counts: Array<{ question_key: string; count: number }> = [];
  let total = 0;
  for (const file of request.files) {
    const question = questions.get(file.question_key);
    if (!question || seen.has(file.question_key)) {
      throw new SiteUploadServiceError("invalid_request");
    }
    if (file.count > question.maxFiles) {
      throw new SiteUploadServiceError("invalid_request");
    }
    seen.add(file.question_key);
    total += file.count;
    counts.push(file);
  }
  if (total > sitePublicUploadLimits.maxFilesPerSubmission) {
    throw new SiteUploadServiceError("invalid_request");
  }
  return counts;
}

const resolvedUploadBindingSchema = z
  .object({
    question_key: z.string(),
    field_key: z.string(),
    field_id: z.uuid(),
    object_id: z.uuid(),
    field_type: z.string(),
    hidden: z.boolean().default(false),
    upload_kind: z.enum(["image", "pdf"]).nullable(),
    upload_count: z.number().int().min(1).max(5).nullable(),
  })
  .passthrough();

const resolvedUploadContextSchema = z
  .object({
    business_id: z.uuid(),
    release_id: z.uuid(),
    form_id: z.uuid(),
    object_definition_id: z.uuid(),
    action_key: z.string(),
    release_token: z.string(),
    bindings: z.array(resolvedUploadBindingSchema),
  })
  .passthrough();

/** Resolve the route's frozen action and retain only its file bindings. */
export async function resolveSitePublicUploadActionContext(
  client: SupabaseClient<Database> | unknown,
  input: {
    businessSlug: string;
    pageSlug: string;
    actionKey: string;
    releaseToken: string;
    submissionAttemptId: string;
    attemptExpiresAt: string;
  },
): Promise<SitePublicUploadActionContext> {
  const attemptId = z.uuid().parse(input.submissionAttemptId);
  const attemptExpiresAt = z
    .string()
    .datetime({ offset: true })
    .parse(input.attemptExpiresAt);
  const resolved = resolvedUploadContextSchema.parse(
    await callRpc<unknown>(client, "resolve_site_public_upload_context_v1", {
      requested_business_slug: input.businessSlug,
      requested_page_slug: input.pageSlug,
      requested_action_key: input.actionKey,
      requested_release_token: input.releaseToken,
    }),
  );
  if (
    resolved.business_id === undefined ||
    resolved.release_id === undefined ||
    resolved.form_id === undefined ||
    resolved.object_definition_id === undefined
  ) {
    throw new SiteUploadServiceError("unavailable");
  }
  const questions = resolved.bindings
    .filter((binding) => binding.field_type === "file" && !binding.hidden)
    .map((binding) => {
      if (!binding.upload_kind) {
        throw new SiteUploadServiceError("unavailable");
      }
      return {
        questionKey: binding.question_key,
        fieldKey: binding.field_key,
        objectDefinitionId: binding.object_id,
        fieldDefinitionId: binding.field_id,
        uploadKind: binding.upload_kind,
        maxFiles: binding.upload_count ?? 1,
      };
    });
  return sitePublicUploadActionContextSchema.parse({
    businessId: resolved.business_id,
    businessSlug: input.businessSlug,
    pageSlug: input.pageSlug,
    formId: resolved.form_id,
    actionKey: resolved.action_key,
    releaseId: resolved.release_id,
    releaseToken: resolved.release_token,
    submissionAttemptId: attemptId,
    attemptExpiresAt,
    questions,
  });
}

/**
 * Reserve one server-bound grant per frozen question ordinal and then mint a
 * two-hour create-only provider capability for each row.
 */
export async function issueSitePublicUploadGrants(
  client: SupabaseClient<Database> | unknown,
  contextInput: unknown,
  requestInput: unknown,
  clientSubjectHash: string,
): Promise<{
  capabilities: Array<z.infer<typeof sitePublicUploadCapabilitySchema>>;
}> {
  const context = sitePublicUploadActionContextSchema.parse(contextInput);
  const counts = normalizeIssueCounts(context, requestInput);
  if (!/^[a-f0-9]{64}$/.test(clientSubjectHash)) {
    throw new SiteUploadServiceError("invalid_request");
  }
  const admin = storageClient(client ?? createAdminClient());
  const issued = await callRpc<unknown>(
    admin,
    "issue_site_public_upload_grants_v1",
    {
      requested_business_id: context.businessId,
      requested_business_slug: context.businessSlug,
      requested_page_slug: context.pageSlug,
      requested_form_id: context.formId,
      requested_release_id: context.releaseId,
      requested_action_key: context.actionKey,
      requested_release_token: context.releaseToken,
      requested_submission_attempt_id: context.submissionAttemptId,
      requested_attempt_expires_at: context.attemptExpiresAt,
      requested_client_subject_hash: clientSubjectHash,
      requested_questions: context.questions,
      requested_files: counts,
    },
  );
  const grants = grantRows(issued);
  const capabilities: Array<z.infer<typeof sitePublicUploadCapabilitySchema>> =
    [];
  for (const grant of grants) {
    const applicationExpiresAt = Date.parse(grant.application_expires_at);
    if (
      !Number.isFinite(applicationExpiresAt) ||
      Date.now() >= applicationExpiresAt
    ) {
      throw new SiteUploadServiceError(
        "expired",
        "The upload application window has expired. Start a new response attempt.",
      );
    }
    if (
      [
        "finalizing",
        "finalized",
        "committed",
        "expired",
        "rejected",
        "cleaned",
      ].includes(grant.state)
    ) {
      throw new SiteUploadServiceError(
        "unavailable",
        "This upload response attempt is already closed.",
      );
    }

    // Replays receive the original database capability window. A reserved
    // row is the only state that may be marked for the first time; an issued
    // or uploaded row is never extended when a lost response is retried.
    let providerExpiresAt = grant.provider_expires_at;
    let providerIssuedAt = grant.provider_issued_at;
    if (grant.state === "reserved") {
      const issuedAt = new Date().toISOString();
      const issuedAtMs = Date.parse(issuedAt);
      const reservationExpiresAt = Date.parse(grant.reservation_expires_at);
      const nextProviderExpiresAt =
        issuedAtMs + sitePublicUploadLimits.providerCapabilityLifetimeMs;
      if (
        !Number.isFinite(issuedAtMs) ||
        !Number.isFinite(reservationExpiresAt) ||
        nextProviderExpiresAt > reservationExpiresAt
      ) {
        throw new SiteUploadServiceError(
          "expired",
          "The upload reservation has expired. Start a new response attempt.",
        );
      }
      providerIssuedAt = issuedAt;
      providerExpiresAt = new Date(nextProviderExpiresAt).toISOString();
    }
    if (!providerIssuedAt || !providerExpiresAt) {
      throw new SiteUploadServiceError("unavailable");
    }

    const upload = await admin.storage
      .from(sitePublicUploadBucket)
      .createSignedUploadUrl(grant.storage_key, { upsert: false });
    if (upload.error || !upload.data) {
      await callRpc(admin, "reject_site_public_upload_grant_v1", {
        requested_grant_id: grant.id,
        requested_reason: "provider_capability_failed",
      }).catch(() => undefined);
      throw new SiteUploadServiceError(
        "provider_failed",
        "The upload capability could not be created.",
        { cause: upload.error },
      );
    }
    if (grant.state === "reserved") {
      const marked = sitePublicUploadGrantSchema.parse(
        await callRpc(admin, "mark_site_public_upload_issued_v1", {
          requested_grant_id: grant.id,
          requested_provider_issued_at: providerIssuedAt,
          requested_provider_expires_at: providerExpiresAt,
        }),
      );
      providerExpiresAt = marked.provider_expires_at;
    }
    if (!providerExpiresAt) {
      throw new SiteUploadServiceError("unavailable");
    }
    capabilities.push(
      sitePublicUploadCapabilitySchema.parse({
        expires_at: providerExpiresAt,
        file_ordinal: grant.file_ordinal,
        grant_id: grant.id,
        question_key: grant.question_key,
        upload_url: upload.data.signedUrl,
      }),
    );
  }
  return { capabilities };
}

type FinalizationClaim = {
  outcome?: "claimed" | "already_finalized";
  claim_token?: string;
  claim_expires_at?: string;
  grant: z.infer<typeof sitePublicUploadGrantSchema>;
};

const finalizationClaimSchema = z.object({
  outcome: z.enum(["claimed", "already_finalized"]).default("claimed"),
  claim_token: z.uuid().nullable().optional(),
  claim_expires_at: z.string().datetime({ offset: true }).nullable().optional(),
  grant: sitePublicUploadGrantSchema,
});

function assertClaimLive(claimExpiresAt: string | null | undefined): void {
  if (!claimExpiresAt || Date.parse(claimExpiresAt) <= Date.now()) {
    throw new SiteUploadServiceError("claim_lost");
  }
}

type StorageRequestConfig = {
  baseUrl: string;
  serviceRoleKey: string;
};

function storageRequestConfig(): StorageRequestConfig {
  const environment = getEnvironment();
  if (!environment.SUPABASE_SERVICE_ROLE_KEY) {
    throw new SiteUploadServiceError(
      "unavailable",
      "Private upload storage is unavailable.",
    );
  }
  return {
    baseUrl: environment.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, ""),
    serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
  };
}

function storageObjectUrl(path: string, config: StorageRequestConfig): string {
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${config.baseUrl}/storage/v1/object/${encodeURIComponent(sitePublicUploadBucket)}/${encodedPath}`;
}

function providerFailure(
  message: string,
  cause?: unknown,
): SiteUploadServiceError {
  return new SiteUploadServiceError("provider_failed", message, { cause });
}

/**
 * Read a private object through an abortable bounded HTTP stream. The
 * Supabase Storage convenience API does not accept an AbortSignal, so the
 * finalizer uses the same service-role HTTP boundary while retaining the
 * database claim fence for a provider that completes after an abort.
 */
export async function readSitePrivateStorageObject(
  path: string,
  maximumBytes: number,
  timeoutMs = sitePublicUploadLimits.storageCallTimeoutMs,
): Promise<Uint8Array> {
  const config = storageRequestConfig();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(storageObjectUrl(path, config), {
        headers: {
          Authorization: `Bearer ${config.serviceRoleKey}`,
          apikey: config.serviceRoleKey,
        },
        signal: controller.signal,
      });
    } catch (error) {
      throw providerFailure(
        timedOut
          ? "Storage did not respond within its bounded deadline."
          : "The upload could not be read from storage.",
        error,
      );
    }
    if (!response.ok) {
      throw providerFailure(
        "The upload could not be read from storage.",
        new Error(`Storage returned HTTP ${response.status}.`),
      );
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
      throw new SiteUploadValidationError(
        "too_large",
        "The upload exceeds its bounded storage limit.",
      );
    }

    if (!response.body) {
      if (declaredLength === 0) return new Uint8Array();
      throw providerFailure("Storage returned an unstreamable response.");
    }

    const bounded = new Uint8Array(maximumBytes + 1);
    let offset = 0;
    const reader = response.body.getReader();
    try {
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          const chunk = next.value;
          if (offset + chunk.byteLength > maximumBytes) {
            await reader.cancel().catch(() => undefined);
            throw new SiteUploadValidationError(
              "too_large",
              "The upload exceeds its bounded storage limit.",
            );
          }
          bounded.set(chunk, offset);
          offset += chunk.byteLength;
        }
      } catch (error) {
        if (error instanceof SiteUploadValidationError) throw error;
        throw providerFailure(
          timedOut
            ? "Storage did not respond within its bounded deadline."
            : "The upload could not be read from storage.",
          error,
        );
      }
    } finally {
      reader.releaseLock();
    }
    return bounded.subarray(0, offset);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Promote bytes to an immutable destination using an abortable provider
 * request. A timeout still leaves the deterministic destination fenced and
 * eligible for the repeated cleanup sweep until its exact bytes are proven.
 */
async function writeSitePrivateStorageObject(
  path: string,
  bytes: Uint8Array,
  mimeType: string,
  timeoutMs = sitePublicUploadLimits.storageCallTimeoutMs,
): Promise<void> {
  const config = storageRequestConfig();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(storageObjectUrl(path, config), {
        body: bytes as unknown as BodyInit,
        headers: {
          Authorization: `Bearer ${config.serviceRoleKey}`,
          apikey: config.serviceRoleKey,
          "cache-control": "max-age=31536000",
          "content-type": mimeType,
          "x-upsert": "false",
        },
        method: "POST",
        signal: controller.signal,
      });
    } catch (error) {
      throw providerFailure(
        timedOut
          ? "Storage did not respond within its bounded deadline."
          : "The immutable verified object could not be written.",
        error,
      );
    }
    if (!response.ok) {
      throw providerFailure(
        "The immutable verified object could not be written.",
        new Error(`Storage returned HTTP ${response.status}.`),
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

async function assertFinalizationClaim(
  client: unknown,
  grantId: string,
  claimToken: string,
): Promise<void> {
  await callRpc(client, "assert_site_public_upload_finalization_claim_v1", {
    requested_grant_id: grantId,
    requested_claim_token: claimToken,
  });
}

async function readAndValidateProviderObject(
  admin: UploadAdminClient,
  grant: z.infer<typeof sitePublicUploadGrantSchema>,
  claimToken: string,
): Promise<ValidatedSiteUpload> {
  await assertFinalizationClaim(admin, grant.id, claimToken);
  const bytes = await readSitePrivateStorageObject(
    grant.storage_key,
    sitePublicUploadLimits.providerQuarantineMaximumBytes,
  );
  await assertFinalizationClaim(admin, grant.id, claimToken);
  try {
    return await validateSiteUploadBytes({
      bytes,
      expectedKind: grant.attachment_kind,
    });
  } catch (error) {
    await callRpc(admin, "reject_site_public_upload_grant_v1", {
      requested_grant_id: grant.id,
      requested_reason: "content_validation_failed",
      requested_claim_token: claimToken,
    }).catch(() => undefined);
    throw new SiteUploadServiceError(
      "integrity_failed",
      "The upload did not match its reserved type or limits.",
      { cause: error },
    );
  }
}

async function writeAndVerifyDestination(
  admin: UploadAdminClient,
  grant: z.infer<typeof sitePublicUploadGrantSchema>,
  claimToken: string,
  validated: ValidatedSiteUpload,
): Promise<string> {
  const key = sitePublicVerifiedKeyForObservation(
    grant.business_id,
    grant.id,
    validated.sha256,
  );
  await assertFinalizationClaim(admin, grant.id, claimToken);
  let uploadError: unknown;
  try {
    await writeSitePrivateStorageObject(
      key,
      validated.bytes,
      validated.mimeType,
    );
  } catch (error) {
    // A timeout or lost response does not prove that the provider did not
    // create the immutable object. Recheck the claim, then verify the exact
    // deterministic destination before treating this as a failure.
    uploadError = error;
  }
  await assertFinalizationClaim(admin, grant.id, claimToken);

  let destination: Uint8Array;
  try {
    destination = await readSitePrivateStorageObject(
      key,
      sitePublicUploadLimits.providerQuarantineMaximumBytes,
    );
  } catch (error) {
    throw new SiteUploadServiceError(
      "provider_failed",
      "The immutable verified object could not be read after promotion.",
      { cause: uploadError ?? error },
    );
  }
  const destinationHash = createHash("sha256")
    .update(destination)
    .digest("hex");
  const { detectSiteUploadMimeType } = await import("./upload-validation");
  if (
    destination.byteLength !== validated.byteSize ||
    destinationHash !== validated.sha256 ||
    detectSiteUploadMimeType(destination) !== validated.mimeType
  ) {
    throw new SiteUploadServiceError(
      "integrity_failed",
      "The immutable verified object did not match the validated upload.",
    );
  }
  // A failed upload response is recoverable only when the destination read
  // above proved the exact immutable bytes. Never overwrite a mismatch.
  return key;
}

/** Finalize one provider upload through the fenced immutable-object saga. */
export async function finalizeSitePublicUpload(
  client: SupabaseClient<Database> | unknown,
  input: unknown,
  contextInput: unknown,
): Promise<z.infer<typeof sitePublicUploadFinalizeResultSchema>> {
  const request = sitePublicUploadFinalizeSchema.parse(input);
  const context = sitePublicUploadActionContextSchema.parse(contextInput);
  if (context.submissionAttemptId !== request.submission_attempt_id) {
    throw new SiteUploadServiceError("invalid_request");
  }
  const admin = storageClient(client ?? createAdminClient());
  const claimed = await callRpc<unknown>(
    admin,
    "claim_site_public_upload_finalization_v1",
    {
      requested_business_slug: context.businessSlug,
      requested_page_slug: context.pageSlug,
      requested_release_token: context.releaseToken,
      requested_grant_id: request.grant_id,
      requested_submission_attempt_id: request.submission_attempt_id,
      requested_business_id: context.businessId,
      requested_release_id: context.releaseId,
      requested_form_id: context.formId,
      requested_action_key: context.actionKey,
      requested_claim_token: randomUUID(),
    },
  );
  const claim = finalizationClaimSchema.parse(claimed) as FinalizationClaim;
  if (
    claim.outcome === "already_finalized" ||
    claim.grant.state === "finalized" ||
    claim.grant.state === "committed"
  ) {
    if (!claim.grant.upload_observation || !claim.grant.verified_storage_key) {
      throw new SiteUploadServiceError("integrity_failed");
    }
    return sitePublicUploadFinalizeResultSchema.parse({
      attachment_kind: claim.grant.attachment_kind,
      observation: claim.grant.upload_observation,
      outcome: "already_finalized",
      submission_attempt_id: claim.grant.submission_attempt_id,
      verified_storage_key: claim.grant.verified_storage_key,
    });
  }
  if (!claim.claim_token || !claim.claim_expires_at) {
    throw new SiteUploadServiceError("claim_lost");
  }
  assertClaimLive(claim.claim_expires_at);
  const validated = await readAndValidateProviderObject(
    admin,
    claim.grant,
    claim.claim_token,
  );
  assertClaimLive(claim.claim_expires_at);
  const key = await writeAndVerifyDestination(
    admin,
    claim.grant,
    claim.claim_token,
    validated,
  );
  const observation = {
    detected_mime_type: validated.mimeType,
    observed_at: new Date().toISOString(),
    observed_byte_size: validated.byteSize,
    sha256: validated.sha256,
  };
  const completed = await callRpc<unknown>(
    admin,
    "complete_site_public_upload_finalization_v1",
    {
      requested_grant_id: claim.grant.id,
      requested_claim_token: claim.claim_token,
      requested_verified_storage_key: key,
      requested_observation: observation,
    },
  );
  const completion = z
    .object({
      outcome: z.enum(["finalized", "already_finalized"]),
      grant: sitePublicUploadGrantSchema,
    })
    .parse(completed);
  if (
    !completion.grant.upload_observation ||
    !completion.grant.verified_storage_key
  ) {
    throw new SiteUploadServiceError("integrity_failed");
  }
  return sitePublicUploadFinalizeResultSchema.parse({
    attachment_kind: completion.grant.attachment_kind,
    observation: completion.grant.upload_observation,
    outcome: completion.outcome,
    submission_attempt_id: completion.grant.submission_attempt_id,
    verified_storage_key: completion.grant.verified_storage_key,
  });
}

/**
 * Sweep a grant after the full 2h15 reservation deadline. A tombstone remains
 * selectable so later bounded maintenance repeats the exact prefixes.
 */
export async function cleanupSitePublicUploadGrant(
  client: SupabaseClient<Database> | unknown,
  grantId: string,
  options: { fenceWaitMs?: number } = {},
): Promise<void> {
  return cleanupSitePublicUploadGrantCore(
    client ?? createAdminClient(),
    grantId,
    options,
  );
}

/** Exposed for unit tests and the maintenance runner's bounded sweep. */
export const sitePublicUploadServiceInternals = {
  normalizeIssueCounts,
  readAndValidateProviderObject,
  writeAndVerifyDestination,
  listStoragePaths: listSitePublicUploadStoragePaths,
};
