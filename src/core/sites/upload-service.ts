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

export class SiteUploadServiceError extends Error {
  readonly code:
    | "unavailable"
    | "invalid_request"
    | "rate_limited"
    | "expired"
    | "not_found"
    | "integrity_failed"
    | "quota_exceeded"
    | "claim_lost"
    | "provider_failed";

  constructor(
    code: SiteUploadServiceError["code"],
    message = "The upload session is unavailable.",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SiteUploadServiceError";
    this.code = code;
  }
}

function rpcFailureCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const message = "message" in error ? String(error.message) : "";
  return message.match(/site_[a-z0-9_]+/)?.[0] ?? null;
}

async function callRpc<T>(
  client: unknown,
  functionName: string,
  parameters: Record<string, unknown>,
): Promise<T> {
  const result = await rpcClient(client).rpc<T>(functionName, parameters);
  if (result.error || result.data === null) {
    const code = rpcFailureCode(result.error);
    const mappedCode =
      code === "site_upload_rate_limited"
        ? "rate_limited"
        : code === "site_upload_submission_attempt_expired" ||
            code === "site_upload_application_expired"
          ? "expired"
          : "unavailable";
    throw new SiteUploadServiceError(
      mappedCode,
      "The upload session is unavailable.",
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

async function withStorageDeadline<T>(
  operation: Promise<T>,
  timeoutMs = sitePublicUploadLimits.storageCallTimeoutMs,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new SiteUploadServiceError(
                "provider_failed",
                "Storage did not respond within its bounded deadline.",
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
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

type CleanupClaim = {
  state: string;
  cleanup_claim_token: string;
  verified_storage_key: string | null;
  quarantine_key: string;
  quarantine_prefix: string;
  verified_prefix: string;
};

const cleanupClaimSchema = z.object({
  state: z.string(),
  cleanup_claim_token: z.uuid(),
  verified_storage_key: z.string().nullable(),
  quarantine_key: z.string(),
  quarantine_prefix: z.string(),
  verified_prefix: z.string(),
});

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function listStoragePaths(
  storage: StorageFileApi,
  prefix: string,
): Promise<string[]> {
  const paths: string[] = [];
  const pageSize = 100;
  const maxPages = 10;
  for (let page = 0; page < maxPages; page += 1) {
    const listing = await withStorageDeadline(
      storage.list(prefix, { limit: pageSize, offset: page * pageSize }),
    );
    if (listing.error || !listing.data) {
      throw new SiteUploadServiceError(
        "provider_failed",
        "Storage cleanup could not list its bounded prefix.",
        { cause: listing.error },
      );
    }
    paths.push(
      ...listing.data.map((entry) =>
        entry.name.startsWith(`${prefix}/`)
          ? entry.name
          : `${prefix}/${entry.name}`,
      ),
    );
    if (listing.data.length < pageSize) return paths;
  }
  throw new SiteUploadServiceError(
    "provider_failed",
    "Storage cleanup found more objects than its bounded prefix sweep allows.",
  );
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
  const admin = storageClient(client ?? createAdminClient());
  const claim = cleanupClaimSchema.parse(
    await callRpc<unknown>(admin, "claim_site_public_upload_cleanup_v1", {
      requested_grant_id: grantId,
    }),
  ) as CleanupClaim;
  const fenceWaitMs =
    options.fenceWaitMs ?? sitePublicUploadLimits.storageCallTimeoutMs;
  await wait(fenceWaitMs);
  const storage = admin.storage.from(sitePublicUploadBucket);
  // The quarantine key is one exact object, not a folder. Remove it directly;
  // listing the key as a prefix would leave the provider object behind.
  const quarantineRemoved = await withStorageDeadline(
    storage.remove([claim.quarantine_key]),
  );
  if (
    quarantineRemoved.error &&
    !isNotFoundStorageError(quarantineRemoved.error)
  ) {
    throw new SiteUploadServiceError(
      "provider_failed",
      "Storage cleanup could not confirm quarantine removal.",
      { cause: quarantineRemoved.error },
    );
  }

  let paths = await listStoragePaths(storage, claim.verified_prefix);
  if (claim.verified_storage_key) {
    paths = paths.filter((path) => path !== claim.verified_storage_key);
  }
  if (paths.length > 0) {
    const removed = await withStorageDeadline(storage.remove(paths));
    if (removed.error) {
      throw new SiteUploadServiceError(
        "provider_failed",
        "Storage cleanup could not confirm verified-orphan removal.",
        { cause: removed.error },
      );
    }
  }
  const remaining = await listStoragePaths(storage, claim.verified_prefix);
  const unexpected = remaining.filter(
    (path) => path !== claim.verified_storage_key,
  );
  if (unexpected.length > 0) {
    throw new SiteUploadServiceError(
      "provider_failed",
      "Storage cleanup found a late object after removal.",
    );
  }
  await callRpc(admin, "finalize_site_public_upload_cleanup_v1", {
    requested_grant_id: grantId,
    requested_cleanup_claim_token: claim.cleanup_claim_token,
  });
}

function isNotFoundStorageError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    Number(error.status) === 404
  );
}

/** Exposed for unit tests and the maintenance runner's bounded sweep. */
export const sitePublicUploadServiceInternals = {
  normalizeIssueCounts,
  readAndValidateProviderObject,
  writeAndVerifyDestination,
  listStoragePaths,
};
