import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  issueSitePublicUploadGrants,
  readSitePrivateStorageObject,
  SiteUploadServiceError,
} from "../src/core/sites/upload-service";
import {
  sitePublicUploadLimits,
  sitePublicUploadGrantSchema,
} from "../src/core/sites/upload-protocol";
import { SiteUploadValidationError } from "../src/core/sites/upload-validation";

const environmentKeys = [
  "NODE_ENV",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MARKETING_ONLY_MODE",
] as const;

const originalEnvironment = new Map(
  environmentKeys.map((key) => [key, process.env[key]]),
);

describe("Sites C3 private storage transport", () => {
  beforeEach(() => {
    const environment = process.env as Record<string, string | undefined>;
    environment.NODE_ENV = "test";
    environment.NEXT_PUBLIC_SUPABASE_URL = "https://storage.example.test/";
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-test-key";
    environment.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
    environment.MARKETING_ONLY_MODE = "false";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of environmentKeys) {
      const value = originalEnvironment.get(key);
      if (value === undefined) delete process.env[key];
      else (process.env as Record<string, string | undefined>)[key] = value;
    }
  });

  it("aborts a stalled provider read instead of leaving fetch in flight", async () => {
    let signal: AbortSignal | undefined;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_input, init) => {
        signal = init?.signal ?? undefined;
        return await new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      readSitePrivateStorageObject("quarantine/business/grant", 32, 10),
    ).rejects.toMatchObject({ code: "provider_failed" });
    expect(signal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://storage.example.test/storage/v1/object/submission-assets/quarantine/business/grant",
      expect.objectContaining({ signal }),
    );
  });

  it("streams only the configured byte bound and authenticates the private read", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-length": "3" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      readSitePrivateStorageObject("verified/business/grant/hash", 3),
    ).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(fetchMock).toHaveBeenCalledWith(
      "https://storage.example.test/storage/v1/object/submission-assets/verified/business/grant/hash",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer service-role-test-key",
          apikey: "service-role-test-key",
        },
      }),
    );
  });

  it("rejects a declared provider object over the bound before reading it", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-length": "3" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      readSitePrivateStorageObject("quarantine/business/grant", 2),
    ).rejects.toBeInstanceOf(SiteUploadValidationError);
  });

  it("fails closed when the private storage credential is unavailable", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    await expect(
      readSitePrivateStorageObject("quarantine/business/grant", 32),
    ).rejects.toBeInstanceOf(SiteUploadServiceError);
  });
});

describe("Sites C3 upload issuance retries", () => {
  const id = (suffix: number): string =>
    `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

  function issueContext() {
    return {
      businessId: id(2),
      businessSlug: "acme",
      pageSlug: "request",
      formId: id(3),
      actionKey: "submit",
      releaseId: id(4),
      releaseToken: `s_${"b".repeat(64)}`,
      submissionAttemptId: id(5),
      attemptExpiresAt: new Date(
        Date.now() +
          sitePublicUploadLimits.applicationGrantLifetimeMs +
          sitePublicUploadLimits.providerCapabilityLifetimeMs,
      ).toISOString(),
      questions: [
        {
          questionKey: "documents",
          fieldKey: "documents",
          objectDefinitionId: id(6),
          fieldDefinitionId: id(7),
          uploadKind: "pdf" as const,
          maxFiles: 1,
        },
      ],
    };
  }

  function grant(state: "reserved" | "issued") {
    const issuedAtMs = Date.now();
    const issuedAt = new Date(issuedAtMs).toISOString();
    const applicationExpiresAt = new Date(
      issuedAtMs + sitePublicUploadLimits.applicationGrantLifetimeMs,
    ).toISOString();
    const reservationExpiresAt = new Date(
      issuedAtMs +
        sitePublicUploadLimits.applicationGrantLifetimeMs +
        sitePublicUploadLimits.providerCapabilityLifetimeMs,
    ).toISOString();
    const providerIssuedAt = state === "issued" ? issuedAt : null;
    const providerExpiresAt = providerIssuedAt
      ? new Date(
          issuedAtMs + sitePublicUploadLimits.providerCapabilityLifetimeMs,
        ).toISOString()
      : null;
    return sitePublicUploadGrantSchema.parse({
      id: id(1),
      business_id: id(2),
      form_id: id(3),
      release_id: id(4),
      action_key: "submit",
      submission_attempt_id: id(5),
      question_key: "documents",
      field_key: "documents",
      object_definition_id: id(6),
      field_definition_id: id(7),
      file_ordinal: 1,
      max_files: 1,
      client_subject_hash: "a".repeat(64),
      storage_key: `quarantine/${id(2)}/${id(1)}`,
      attachment_kind: "pdf",
      maximum_bytes: sitePublicUploadLimits.maxPdfBytes,
      reserved_bytes: sitePublicUploadLimits.providerQuarantineMaximumBytes,
      issued_at: issuedAt,
      application_expires_at: applicationExpiresAt,
      provider_issued_at: providerIssuedAt,
      provider_expires_at: providerExpiresAt,
      reservation_expires_at: reservationExpiresAt,
      reservation_state: "reserved",
      reservation_released_at: null,
      state,
      upload_observation: null,
      verified_storage_key: null,
      finalization_claim_token: null,
      finalization_claim_expires_at: null,
      submission_attachment_id: null,
      finalized_at: null,
      cleanup_claim_token: null,
      cleanup_claim_expires_at: null,
      cleanup_next_at: null,
      cleanup_verified_prefix: `verified/${id(2)}/${id(1)}`,
      cleaned_at: null,
      created_at: issuedAt,
    });
  }

  function fakeUploadClient(
    originalGrant: ReturnType<typeof grant>,
    markedGrant: ReturnType<typeof grant> = originalGrant,
  ) {
    const rpc = vi.fn(
      async (functionName: string, parameters?: Record<string, unknown>) => {
        void parameters;
        if (functionName === "issue_site_public_upload_grants_v1") {
          return { data: [originalGrant], error: null };
        }
        if (functionName === "mark_site_public_upload_issued_v1") {
          return { data: markedGrant, error: null };
        }
        return { data: {}, error: null };
      },
    );
    const createSignedUploadUrl = vi.fn(async () => ({
      data: {
        path: originalGrant.storage_key,
        signedUrl: "https://storage.example.test/upload",
        token: "signed-token",
      },
      error: null,
    }));
    return {
      client: {
        rpc,
        storage: {
          from: () => ({ createSignedUploadUrl }),
        },
      },
      createSignedUploadUrl,
      rpc,
    };
  }

  it("reuses an issued grant window without re-marking or extending it", async () => {
    const originalGrant = grant("issued");
    const fake = fakeUploadClient(originalGrant);
    const result = await issueSitePublicUploadGrants(
      fake.client,
      issueContext(),
      {
        submission_attempt_id: id(5),
        files: [{ question_key: "documents", count: 1 }],
      },
      "a".repeat(64),
    );

    expect(result.capabilities).toEqual([
      {
        expires_at: originalGrant.provider_expires_at,
        file_ordinal: 1,
        grant_id: originalGrant.id,
        question_key: "documents",
        upload_url: "https://storage.example.test/upload",
      },
    ]);
    expect(fake.createSignedUploadUrl).toHaveBeenCalledWith(
      originalGrant.storage_key,
      { upsert: false },
    );
    expect(
      fake.rpc.mock.calls.some(
        ([functionName]) =>
          functionName === "mark_site_public_upload_issued_v1",
      ),
    ).toBe(false);
  });

  it("marks a first issuance only within the original reservation", async () => {
    const originalGrant = grant("reserved");
    const issuedAtMs = Date.parse(originalGrant.issued_at) + 1_000;
    const markedGrant = sitePublicUploadGrantSchema.parse({
      ...originalGrant,
      state: "issued",
      provider_issued_at: new Date(issuedAtMs).toISOString(),
      provider_expires_at: new Date(
        issuedAtMs + sitePublicUploadLimits.providerCapabilityLifetimeMs,
      ).toISOString(),
    });
    const fake = fakeUploadClient(originalGrant, markedGrant);
    const result = await issueSitePublicUploadGrants(
      fake.client,
      issueContext(),
      {
        submission_attempt_id: id(5),
        files: [{ question_key: "documents", count: 1 }],
      },
      "a".repeat(64),
    );

    expect(result.capabilities[0]?.expires_at).toBe(
      markedGrant.provider_expires_at,
    );
    expect(
      fake.rpc.mock.calls.filter(
        ([functionName]) =>
          functionName === "mark_site_public_upload_issued_v1",
      ),
    ).toHaveLength(1);
    const rpcCalls = fake.rpc.mock.calls as Array<
      [string, Record<string, unknown>?]
    >;
    const markCall = rpcCalls.find(
      ([functionName]) => functionName === "mark_site_public_upload_issued_v1",
    );
    const markParameters = markCall?.[1] as
      | {
          requested_provider_issued_at?: string;
          requested_provider_expires_at?: string;
        }
      | undefined;
    expect(markParameters?.requested_provider_issued_at).toBeTruthy();
    expect(markParameters?.requested_provider_expires_at).toBeTruthy();
    expect(
      Date.parse(markParameters!.requested_provider_expires_at!) -
        Date.parse(markParameters!.requested_provider_issued_at!),
    ).toBe(sitePublicUploadLimits.providerCapabilityLifetimeMs);
    expect(
      Date.parse(markParameters!.requested_provider_expires_at!),
    ).toBeLessThanOrEqual(Date.parse(originalGrant.reservation_expires_at));
  });
});
