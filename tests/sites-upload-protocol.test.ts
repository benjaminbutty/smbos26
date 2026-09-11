import { describe, expect, it } from "vitest";

import {
  assertNoPublicFileAnswers,
  buildSitePublicFileValues,
  sitePublicFileValueSchema,
  sitePublicSubmissionAttachmentSchema,
  sitePublicUploadActionContextSchema,
  sitePublicUploadAttemptSchema,
  sitePublicUploadCapabilitySchema,
  sitePublicUploadFinalizeResultSchema,
  sitePublicUploadFinalizeSchema,
  sitePublicUploadGrantSchema,
  sitePublicUploadInFlightQuotaSchema,
  sitePublicUploadLimits,
  sitePublicUploadTransitionSchema,
  type SitePublicUploadGrant,
} from "../src/core/sites/upload-protocol";

const issuedAt = "2026-09-09T10:00:00.000Z";
const appExpiry = "2026-09-09T10:15:00.000Z";
const providerExpiry = "2026-09-09T12:00:00.000Z";
const reservationExpiry = "2026-09-09T12:15:00.000Z";
const clientSubjectHash = "a".repeat(64);

const id = (suffix: number): string =>
  `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

const businessId = id(2);
const formId = id(3);
const releaseId = id(4);
const attemptId = id(5);
const objectId = id(6);
const fieldId = id(7);
const releaseToken = `s_${"b".repeat(64)}`;

function validGrant(overrides: Partial<SitePublicUploadGrant> = {}) {
  const base = validGrantBase();
  const grant = { ...base, ...overrides };
  return {
    ...grant,
    storage_key:
      overrides.storage_key ?? `quarantine/${grant.business_id}/${grant.id}`,
    cleanup_verified_prefix:
      overrides.cleanup_verified_prefix ??
      `verified/${grant.business_id}/${grant.id}`,
  };
}

function validGrantBase(): SitePublicUploadGrant {
  return {
    id: id(1),
    business_id: businessId,
    form_id: formId,
    release_id: releaseId,
    action_key: "submit",
    submission_attempt_id: attemptId,
    question_key: "documents",
    field_key: "documents",
    object_definition_id: objectId,
    field_definition_id: fieldId,
    file_ordinal: 1,
    max_files: 2,
    client_subject_hash: clientSubjectHash,
    storage_key: "",
    attachment_kind: "pdf" as const,
    maximum_bytes: sitePublicUploadLimits.maxPdfBytes,
    reserved_bytes: sitePublicUploadLimits.providerQuarantineMaximumBytes,
    issued_at: issuedAt,
    application_expires_at: appExpiry,
    provider_issued_at: issuedAt,
    provider_expires_at: providerExpiry,
    reservation_expires_at: reservationExpiry,
    reservation_state: "reserved" as const,
    reservation_released_at: null,
    state: "issued" as const,
    upload_observation: null,
    verified_storage_key: null,
    finalization_claim_token: null,
    finalization_claim_expires_at: null,
    submission_attachment_id: null,
    finalized_at: null,
    cleanup_claim_token: null,
    cleanup_claim_expires_at: null,
    cleanup_next_at: null,
    cleanup_verified_prefix: `verified/${businessId}/${id(1)}`,
    cleaned_at: null,
    created_at: issuedAt,
  };
}

const uploadQuestions = [
  {
    questionKey: "documents",
    fieldKey: "documents",
    objectDefinitionId: objectId,
    fieldDefinitionId: fieldId,
    uploadKind: "pdf" as const,
    maxFiles: 2,
  },
  {
    questionKey: "photos",
    fieldKey: "photos",
    objectDefinitionId: objectId,
    fieldDefinitionId: id(8),
    uploadKind: "image" as const,
    maxFiles: 3,
  },
];

const actionContext = {
  businessId,
  businessSlug: "acme",
  pageSlug: "request",
  formId,
  actionKey: "submit",
  releaseId,
  releaseToken,
  submissionAttemptId: attemptId,
  attemptExpiresAt: reservationExpiry,
  questions: uploadQuestions,
};

describe("Sites C3 public-upload contract", () => {
  it("binds an immutable private PDF reservation to its exact question Field", () => {
    expect(sitePublicUploadGrantSchema.parse(validGrant())).toMatchObject({
      action_key: "submit",
      question_key: "documents",
      field_key: "documents",
      maximum_bytes: 10 * 1024 * 1024,
      reserved_bytes: 10 * 1024 * 1024,
      state: "issued",
    });
    expect(sitePublicUploadActionContextSchema.parse(actionContext)).toEqual(
      actionContext,
    );
    expect(
      sitePublicUploadActionContextSchema.safeParse({
        ...actionContext,
        questions: [uploadQuestions[0], uploadQuestions[0]],
      }).success,
    ).toBe(false);
    expect(
      sitePublicUploadActionContextSchema.safeParse({
        ...actionContext,
        questions: [
          uploadQuestions[0],
          { ...uploadQuestions[1], fieldKey: "documents" },
        ],
      }).success,
    ).toBe(false);
  });

  it("keeps the 15-minute application, two-hour capability, and full 2h15 reservation windows", () => {
    const grant = validGrant();
    expect(
      sitePublicUploadGrantSchema.safeParse({
        ...grant,
        storage_key: "existing-public-key",
      }).success,
    ).toBe(false);
    expect(
      sitePublicUploadGrantSchema.safeParse({
        ...grant,
        state: "reserved",
        provider_issued_at: null,
        provider_expires_at: null,
      }).success,
    ).toBe(true);
    expect(
      sitePublicUploadGrantSchema.safeParse({
        ...grant,
        state: "issued",
        provider_issued_at: null,
        provider_expires_at: null,
      }).success,
    ).toBe(false);
    expect(
      sitePublicUploadGrantSchema.safeParse({
        ...grant,
        reservation_state: "released",
        reservation_released_at: "2026-09-09T12:14:59.999Z",
      }).success,
    ).toBe(false);
    expect(
      sitePublicUploadGrantSchema.safeParse({
        ...grant,
        reserved_bytes:
          sitePublicUploadLimits.providerQuarantineMaximumBytes - 1,
      }).success,
    ).toBe(false);
    expect(
      sitePublicUploadGrantSchema.safeParse({
        ...grant,
        attachment_kind: "image",
        maximum_bytes: sitePublicUploadLimits.maxImageBytes + 1,
      }).success,
    ).toBe(false);
    expect(
      sitePublicUploadGrantSchema.safeParse({
        ...grant,
        provider_expires_at: "2026-09-09T10:01:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      sitePublicUploadGrantSchema.safeParse({
        ...grant,
        application_expires_at: "2026-09-09T10:14:59.999Z",
      }).success,
    ).toBe(false);
  });

  it("rejects aggregate reservations above Business, Form, or client caps", () => {
    const grant = validGrant();
    expect(
      sitePublicUploadInFlightQuotaSchema.safeParse({
        business_reserved_bytes_before_issue:
          sitePublicUploadLimits.maxInFlightReservedBytesPerBusiness -
          grant.reserved_bytes +
          1,
        form_reserved_bytes_before_issue: 0,
        client_reserved_bytes_before_issue: 0,
        grant,
      }).success,
    ).toBe(false);
    expect(
      sitePublicUploadInFlightQuotaSchema.safeParse({
        business_reserved_bytes_before_issue: 0,
        form_reserved_bytes_before_issue: 0,
        client_reserved_bytes_before_issue:
          sitePublicUploadLimits.maxInFlightReservedBytesPerClient -
          grant.reserved_bytes +
          1,
        grant,
      }).success,
    ).toBe(false);
    expect(
      sitePublicUploadInFlightQuotaSchema.safeParse({
        business_reserved_bytes_before_issue: 0,
        form_reserved_bytes_before_issue: 0,
        client_reserved_bytes_before_issue: 0,
        grant: {
          ...grant,
          reservation_state: "released",
          reservation_released_at: reservationExpiry,
        },
      }).success,
    ).toBe(false);
  });

  it("scopes ordinals to each frozen question while keeping five files per attempt", () => {
    const grants = [
      validGrant({ id: id(10), file_ordinal: 1 }),
      validGrant({ id: id(11), file_ordinal: 2 }),
      validGrant({
        id: id(12),
        question_key: "photos",
        field_key: "photos",
        field_definition_id: id(8),
        attachment_kind: "image",
        maximum_bytes: sitePublicUploadLimits.maxImageBytes,
        max_files: 3,
        file_ordinal: 1,
      }),
      validGrant({
        id: id(13),
        question_key: "photos",
        field_key: "photos",
        field_definition_id: id(8),
        attachment_kind: "image",
        maximum_bytes: sitePublicUploadLimits.maxImageBytes,
        max_files: 3,
        file_ordinal: 2,
      }),
      validGrant({
        id: id(14),
        question_key: "photos",
        field_key: "photos",
        field_definition_id: id(8),
        attachment_kind: "image",
        maximum_bytes: sitePublicUploadLimits.maxImageBytes,
        max_files: 3,
        file_ordinal: 3,
      }),
    ];
    const attempt = {
      business_id: businessId,
      form_id: formId,
      release_id: releaseId,
      action_key: "submit",
      submission_attempt_id: attemptId,
      client_subject_hash: clientSubjectHash,
      grants,
    };
    expect(sitePublicUploadAttemptSchema.safeParse(attempt).success).toBe(true);
    expect(
      sitePublicUploadAttemptSchema.safeParse({
        ...attempt,
        grants: [
          ...grants,
          validGrant({ id: id(15), file_ordinal: 3, max_files: 3 }),
        ],
      }).success,
    ).toBe(false);
    expect(
      sitePublicUploadAttemptSchema.safeParse({
        ...attempt,
        grants: [...grants, validGrant({ id: id(16), file_ordinal: 1 })],
      }).success,
    ).toBe(false);
    expect(
      sitePublicUploadAttemptSchema.safeParse({
        ...attempt,
        grants: [
          ...grants.slice(0, 4),
          validGrant({ id: id(17), action_key: "another-action" }),
        ],
      }).success,
    ).toBe(false);
  });

  it("allows only forward lifecycle transitions and idempotent finalized results", () => {
    for (const transition of [
      { from: "reserved", to: "issued" },
      { from: "issued", to: "uploaded" },
      { from: "uploaded", to: "finalizing" },
      { from: "finalizing", to: "finalized" },
      { from: "finalized", to: "committed" },
      { from: "expired", to: "cleaned" },
    ]) {
      expect(
        sitePublicUploadTransitionSchema.safeParse(transition).success,
      ).toBe(true);
    }
    expect(
      sitePublicUploadTransitionSchema.safeParse({
        from: "finalized",
        to: "uploaded",
      }).success,
    ).toBe(false);
    expect(
      sitePublicUploadTransitionSchema.safeParse({
        from: "committed",
        to: "cleaned",
      }).success,
    ).toBe(false);

    const observation = {
      observed_at: "2026-09-09T10:01:00.000Z",
      observed_byte_size: 10,
      detected_mime_type: "application/pdf" as const,
      sha256: "b".repeat(64),
    };
    const finalized = validGrant({
      state: "finalized",
      upload_observation: observation,
      verified_storage_key: `verified/${businessId}/${id(1)}/${observation.sha256}`,
      finalized_at: observation.observed_at,
    });
    expect(sitePublicUploadGrantSchema.safeParse(finalized).success).toBe(true);
    expect(
      sitePublicUploadGrantSchema.safeParse({
        ...finalized,
        state: "committed",
        submission_attachment_id: id(90),
      }).success,
    ).toBe(true);
    expect(
      sitePublicUploadFinalizeResultSchema.safeParse({
        outcome: "already_finalized",
        attachment_kind: "pdf",
        observation,
        submission_attempt_id: attemptId,
        verified_storage_key: finalized.verified_storage_key,
      }).success,
    ).toBe(true);
    expect(
      sitePublicUploadFinalizeSchema.safeParse({
        grant_id: id(1),
        submission_attempt_id: attemptId,
      }).success,
    ).toBe(true);
    expect(
      sitePublicUploadFinalizeSchema.safeParse({ grant_id: id(1) }).success,
    ).toBe(false);
  });

  it("constructs the finite attachment_ids value from verified rows and rejects caller file values", () => {
    const attachments = [
      {
        id: id(101),
        question_key: "documents",
        field_key: "documents",
        file_ordinal: 2,
      },
      {
        id: id(100),
        question_key: "documents",
        field_key: "documents",
        file_ordinal: 1,
      },
      {
        id: id(102),
        question_key: "photos",
        field_key: "photos",
        file_ordinal: 1,
      },
    ];
    expect(buildSitePublicFileValues(uploadQuestions, attachments)).toEqual({
      documents: { attachment_ids: [id(100), id(101)] },
      photos: { attachment_ids: [id(102)] },
    });
    expect(
      sitePublicFileValueSchema.safeParse({
        attachment_ids: [id(100), id(100)],
      }).success,
    ).toBe(false);
    expect(() =>
      buildSitePublicFileValues(uploadQuestions, [
        ...attachments,
        {
          id: id(103),
          question_key: "documents",
          field_key: "other_field",
          file_ordinal: 3,
        },
      ]),
    ).toThrow("site_upload_attachment_binding_invalid");
    expect(() =>
      assertNoPublicFileAnswers(
        { documents: { attachment_ids: [id(100)] } },
        uploadQuestions,
      ),
    ).toThrow("site_upload_file_answer_forbidden");
    expect(() =>
      assertNoPublicFileAnswers(
        { name: "Ada", documents: null },
        uploadQuestions,
      ),
    ).not.toThrow();
  });

  it("binds committed attachment metadata to its immutable verified object", () => {
    const digest = "c".repeat(64);
    const attachment = {
      id: id(110),
      business_id: businessId,
      grant_id: id(1),
      receipt_id: id(111),
      record_id: id(112),
      release_id: releaseId,
      form_id: formId,
      action_key: "submit",
      submission_attempt_id: attemptId,
      question_key: "documents",
      field_key: "documents",
      object_definition_id: objectId,
      field_definition_id: fieldId,
      file_ordinal: 1,
      verified_storage_key: `verified/${businessId}/${id(1)}/${digest}`,
      sha256: digest,
      byte_size: 100,
      mime_type: "application/pdf" as const,
      created_at: issuedAt,
    };
    expect(sitePublicSubmissionAttachmentSchema.parse(attachment)).toEqual(
      attachment,
    );
    expect(
      sitePublicSubmissionAttachmentSchema.safeParse({
        ...attachment,
        verified_storage_key: "verified/other-business/grant/hash",
      }).success,
    ).toBe(false);
  });

  it("keeps the reservation and rate limit boundaries explicit", () => {
    expect(sitePublicUploadLimits.maxFilesPerSubmission).toBe(5);
    expect(sitePublicUploadLimits.maxReservedBytesPerSubmission).toBe(
      50 * 1024 * 1024,
    );
    expect(sitePublicUploadLimits.grantsPerClientFormMinute).toBe(10);
    expect(sitePublicUploadLimits.maxCommittedBytesPerBusiness).toBe(
      2 * 1024 * 1024 * 1024,
    );
    expect(
      sitePublicUploadCapabilitySchema.parse({
        expires_at: providerExpiry,
        file_ordinal: 1,
        grant_id: id(1),
        question_key: "documents",
        upload_url: "https://storage.example.test/upload",
      }),
    ).toMatchObject({ question_key: "documents", file_ordinal: 1 });
  });
});
