import { z } from "zod";

/**
 * The public upload boundary is deliberately finite. The browser receives an
 * opaque grant and a create-only quarantine capability; it never receives a
 * Storage key that can be used as an attachment value.
 */
export const sitePublicUploadLimits = {
  applicationGrantLifetimeMs: 15 * 60 * 1000,
  grantsPerClientFormMinute: 10,
  maxInFlightReservedBytesPerBusiness: 512 * 1024 * 1024,
  maxInFlightReservedBytesPerClient: 100 * 1024 * 1024,
  maxInFlightReservedBytesPerForm: 256 * 1024 * 1024,
  maxFilesPerSubmission: 5,
  maxFilesPerQuestion: 5,
  maxImageBytes: 3 * 1024 * 1024,
  maxPdfBytes: 10 * 1024 * 1024,
  maxPdfPages: 100,
  providerQuarantineMaximumBytes: 10 * 1024 * 1024,
  maxReservedBytesPerSubmission: 50 * 1024 * 1024,
  providerCapabilityLifetimeMs: 2 * 60 * 60 * 1000,
  finalizationClaimLifetimeMs: 5 * 60 * 1000,
  storageCallTimeoutMs: 60 * 1000,
  maxCommittedBytesPerBusiness: 2 * 1024 * 1024 * 1024,
} as const;

export const sitePublicUploadBucket = "submission-assets" as const;
export const sitePublicUploadMaxQuestions = 50;
export const sitePublicUploadMimeTypes = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type SitePublicUploadMimeType =
  (typeof sitePublicUploadMimeTypes)[number];
export type SitePublicUploadKind = "image" | "pdf";

const attachmentKindSchema = z.enum(["image", "pdf"]);
const uploadMimeTypeSchema = z.enum(sitePublicUploadMimeTypes);
const actionKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_-]{0,79}$/);
const routeSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const graphKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{0,79}$/);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const dateSchema = z.string().datetime({ offset: true });

export const sitePublicUploadQuestionSchema = z
  .object({
    questionKey: graphKeySchema,
    fieldKey: graphKeySchema,
    objectDefinitionId: z.uuid(),
    fieldDefinitionId: z.uuid(),
    uploadKind: attachmentKindSchema,
    maxFiles: z
      .number()
      .int()
      .min(1)
      .max(sitePublicUploadLimits.maxFilesPerQuestion),
  })
  .strict();

export type SitePublicUploadQuestion = z.infer<
  typeof sitePublicUploadQuestionSchema
>;

/** Server-resolved context passed from the Form boundary to this subsystem. */
export const sitePublicUploadActionContextSchema = z
  .object({
    businessId: z.uuid(),
    businessSlug: routeSlugSchema,
    pageSlug: routeSlugSchema,
    formId: z.uuid(),
    actionKey: actionKeySchema,
    releaseId: z.uuid(),
    releaseToken: z.string().regex(/^s_[a-f0-9]{64}$/),
    submissionAttemptId: z.uuid(),
    attemptExpiresAt: dateSchema,
    questions: z
      .array(sitePublicUploadQuestionSchema)
      .max(sitePublicUploadMaxQuestions),
  })
  .strict()
  .superRefine((context, refinement) => {
    const questionKeys = new Set<string>();
    const fieldKeys = new Set<string>();
    const fieldIdentities = new Set<string>();
    for (const [index, question] of context.questions.entries()) {
      if (questionKeys.has(question.questionKey)) {
        refinement.addIssue({
          code: "custom",
          message: "Each upload question must have one frozen identity.",
          path: ["questions", index, "questionKey"],
        });
      }
      questionKeys.add(question.questionKey);
      if (fieldKeys.has(question.fieldKey)) {
        refinement.addIssue({
          code: "custom",
          message: "Each upload Field key must have one frozen identity.",
          path: ["questions", index, "fieldKey"],
        });
      }
      fieldKeys.add(question.fieldKey);
      const fieldIdentity = `${question.objectDefinitionId}:${question.fieldDefinitionId}:${question.fieldKey}`;
      if (fieldIdentities.has(fieldIdentity)) {
        refinement.addIssue({
          code: "custom",
          message: "A file Field cannot be bound to two upload questions.",
          path: ["questions", index],
        });
      }
      fieldIdentities.add(fieldIdentity);
    }
  });

export type SitePublicUploadActionContext = z.infer<
  typeof sitePublicUploadActionContextSchema
>;

const uploadObservationSchema = z
  .object({
    observed_at: dateSchema,
    observed_byte_size: z.number().int().positive(),
    detected_mime_type: uploadMimeTypeSchema,
    sha256: hashSchema,
  })
  .strict();

const grantStateSchema = z.enum([
  "reserved",
  "issued",
  "uploaded",
  "finalizing",
  "finalized",
  "committed",
  "expired",
  "rejected",
  "cleaned",
]);
export type SitePublicUploadGrantState = z.infer<typeof grantStateSchema>;

const reservationStateSchema = z.enum(["reserved", "released"]);

function parseTime(value: string): number {
  return Date.parse(value);
}

function verifiedStorageKey(businessId: string, grantId: string, hash: string) {
  return `verified/${businessId}/${grantId}/${hash}`;
}

function quarantineStorageKey(businessId: string, grantId: string) {
  return `quarantine/${businessId}/${grantId}`;
}

/**
 * A grant is a database row, rather than a client capability itself. The
 * claim and attachment IDs are nullable until their corresponding fenced
 * transitions occur.
 */
export const sitePublicUploadGrantSchema = z
  .object({
    id: z.uuid(),
    business_id: z.uuid(),
    form_id: z.uuid(),
    release_id: z.uuid(),
    action_key: actionKeySchema,
    submission_attempt_id: z.uuid(),
    question_key: graphKeySchema,
    field_key: graphKeySchema,
    object_definition_id: z.uuid(),
    field_definition_id: z.uuid(),
    file_ordinal: z
      .number()
      .int()
      .min(1)
      .max(sitePublicUploadLimits.maxFilesPerQuestion),
    max_files: z
      .number()
      .int()
      .min(1)
      .max(sitePublicUploadLimits.maxFilesPerQuestion),
    client_subject_hash: hashSchema,
    storage_key: z.string(),
    attachment_kind: attachmentKindSchema,
    maximum_bytes: z.number().int().positive(),
    reserved_bytes: z.number().int().positive(),
    issued_at: dateSchema,
    application_expires_at: dateSchema,
    provider_issued_at: dateSchema.nullable(),
    provider_expires_at: dateSchema.nullable(),
    reservation_expires_at: dateSchema,
    reservation_state: reservationStateSchema,
    reservation_released_at: dateSchema.nullable(),
    state: grantStateSchema,
    upload_observation: uploadObservationSchema.nullable(),
    verified_storage_key: z.string().nullable(),
    finalization_claim_token: z.uuid().nullable(),
    finalization_claim_expires_at: dateSchema.nullable(),
    submission_attachment_id: z.uuid().nullable(),
    finalized_at: dateSchema.nullable(),
    cleanup_claim_token: z.uuid().nullable(),
    cleanup_claim_expires_at: dateSchema.nullable(),
    cleanup_next_at: dateSchema.nullable(),
    cleanup_verified_prefix: z.string(),
    cleaned_at: dateSchema.nullable(),
    created_at: dateSchema,
  })
  .strict()
  .superRefine((grant, context) => {
    const issuedAt = parseTime(grant.issued_at);
    const applicationExpiry = parseTime(grant.application_expires_at);
    const providerIssuedAt = grant.provider_issued_at
      ? parseTime(grant.provider_issued_at)
      : null;
    const providerExpiry = grant.provider_expires_at
      ? parseTime(grant.provider_expires_at)
      : null;
    const reservationExpiry = parseTime(grant.reservation_expires_at);
    const kindLimit =
      grant.attachment_kind === "pdf"
        ? sitePublicUploadLimits.maxPdfBytes
        : sitePublicUploadLimits.maxImageBytes;

    if (grant.maximum_bytes > kindLimit) {
      context.addIssue({
        code: "custom",
        message: "The grant exceeds its attachment-kind byte limit.",
        path: ["maximum_bytes"],
      });
    }
    if (grant.file_ordinal > grant.max_files) {
      context.addIssue({
        code: "custom",
        message: "The file ordinal is outside this question's frozen count.",
        path: ["file_ordinal"],
      });
    }
    if (
      grant.reserved_bytes !==
      sitePublicUploadLimits.providerQuarantineMaximumBytes
    ) {
      context.addIssue({
        code: "custom",
        message: "Every grant reserves the full bounded quarantine object.",
        path: ["reserved_bytes"],
      });
    }
    if (
      grant.storage_key !== quarantineStorageKey(grant.business_id, grant.id)
    ) {
      context.addIssue({
        code: "custom",
        message: "The quarantine key must bind this Business and grant.",
        path: ["storage_key"],
      });
    }
    if (
      applicationExpiry - issuedAt !==
      sitePublicUploadLimits.applicationGrantLifetimeMs
    ) {
      context.addIssue({
        code: "custom",
        message: "The application grant has an exact 15-minute lifetime.",
        path: ["application_expires_at"],
      });
    }
    const providerPair = providerIssuedAt !== null && providerExpiry !== null;
    if ((providerIssuedAt === null) !== (providerExpiry === null)) {
      context.addIssue({
        code: "custom",
        message: "Provider issue and expiry timestamps must be paired.",
        path: ["provider_expires_at"],
      });
    }
    if (
      ["issued", "uploaded", "finalizing", "finalized", "committed"].includes(
        grant.state,
      ) &&
      !providerPair
    ) {
      context.addIssue({
        code: "custom",
        message:
          "An active provider grant must have its complete capability window.",
        path: ["provider_expires_at"],
      });
    }
    if (
      providerPair &&
      (providerIssuedAt! < issuedAt ||
        providerIssuedAt! > applicationExpiry ||
        providerExpiry! - providerIssuedAt! !==
          sitePublicUploadLimits.providerCapabilityLifetimeMs)
    ) {
      context.addIssue({
        code: "custom",
        message: "The provider capability retains its full two-hour lifetime.",
        path: ["provider_expires_at"],
      });
    }
    if (
      reservationExpiry - issuedAt !==
      sitePublicUploadLimits.applicationGrantLifetimeMs +
        sitePublicUploadLimits.providerCapabilityLifetimeMs
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The reservation covers the complete two-hour-and-15-minute window.",
        path: ["reservation_expires_at"],
      });
    }
    const releasedAt = grant.reservation_released_at
      ? parseTime(grant.reservation_released_at)
      : null;
    if (
      (grant.reservation_state === "released" &&
        (releasedAt === null || releasedAt < reservationExpiry)) ||
      (grant.reservation_state === "reserved" && releasedAt !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "A reservation releases only after its conservative deadline.",
        path: ["reservation_released_at"],
      });
    }

    const observation = grant.upload_observation;
    if (
      observation &&
      (observation.observed_byte_size > grant.maximum_bytes ||
        (grant.attachment_kind === "pdf" &&
          observation.detected_mime_type !== "application/pdf") ||
        (grant.attachment_kind === "image" &&
          observation.detected_mime_type === "application/pdf"))
    ) {
      context.addIssue({
        code: "custom",
        message: "Observed content does not match this grant.",
        path: ["upload_observation"],
      });
    }

    const hasObservation = observation !== null;
    const hasVerifiedKey = grant.verified_storage_key !== null;
    const hasFinalizedAt = grant.finalized_at !== null;
    const hasAttachment = grant.submission_attachment_id !== null;
    const hasFinalizationClaim =
      grant.finalization_claim_token !== null ||
      grant.finalization_claim_expires_at !== null;
    if (
      grant.state === "reserved" &&
      (hasObservation ||
        hasVerifiedKey ||
        hasFinalizedAt ||
        hasAttachment ||
        hasFinalizationClaim)
    ) {
      context.addIssue({
        code: "custom",
        message: "A reserved grant has no finalized content.",
      });
    }
    if (
      grant.state === "issued" &&
      (hasObservation ||
        hasVerifiedKey ||
        hasFinalizedAt ||
        hasAttachment ||
        hasFinalizationClaim)
    ) {
      context.addIssue({
        code: "custom",
        message: "An issued grant has no finalized content.",
      });
    }
    if (
      grant.state === "uploaded" &&
      (hasVerifiedKey ||
        hasFinalizedAt ||
        hasAttachment ||
        hasFinalizationClaim)
    ) {
      context.addIssue({
        code: "custom",
        message: "An uploaded grant has no finalization claim or attachment.",
      });
    }
    if (
      grant.state === "finalizing" &&
      (!hasFinalizationClaim ||
        hasObservation ||
        hasVerifiedKey ||
        hasFinalizedAt ||
        hasAttachment)
    ) {
      context.addIssue({
        code: "custom",
        message: "A finalizing grant needs exactly one live claim.",
      });
    }
    if (
      grant.state === "finalized" &&
      (!hasObservation ||
        !hasVerifiedKey ||
        !hasFinalizedAt ||
        hasAttachment ||
        hasFinalizationClaim)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A finalized grant needs one verified object and no receipt owner yet.",
      });
    }
    if (
      grant.state === "committed" &&
      (!hasObservation ||
        !hasVerifiedKey ||
        !hasFinalizedAt ||
        !hasAttachment ||
        hasFinalizationClaim)
    ) {
      context.addIssue({
        code: "custom",
        message: "A committed grant needs its immutable attachment owner.",
      });
    }
    if (
      ["expired", "rejected", "cleaned"].includes(grant.state) &&
      (hasVerifiedKey ||
        hasFinalizedAt ||
        hasAttachment ||
        hasFinalizationClaim)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "An uncommitted terminal grant cannot retain a verified owner.",
      });
    }
    if (grant.state === "cleaned" && grant.reservation_state !== "released") {
      context.addIssue({
        code: "custom",
        message: "Cleanup must release the expired reservation.",
        path: ["reservation_state"],
      });
    }
    if (grant.state === "cleaned" && grant.cleaned_at === null) {
      context.addIssue({
        code: "custom",
        message: "A cleaned grant remains an auditable tombstone.",
      });
    }
    if (
      grant.verified_storage_key !== null &&
      observation !== null &&
      grant.verified_storage_key !==
        verifiedStorageKey(grant.business_id, grant.id, observation.sha256)
    ) {
      context.addIssue({
        code: "custom",
        message: "The verified key must bind the observed digest.",
        path: ["verified_storage_key"],
      });
    }
    if (
      grant.cleanup_verified_prefix !==
      `verified/${grant.business_id}/${grant.id}`
    ) {
      context.addIssue({
        code: "custom",
        message: "The cleanup prefix must bind this Business and grant.",
        path: ["cleanup_verified_prefix"],
      });
    }
  });

export type SitePublicUploadGrant = z.infer<typeof sitePublicUploadGrantSchema>;

/** Values accepted by the public Form transport; file bytes never appear here. */
export const sitePublicUploadIssueRequestSchema = z
  .object({
    submission_attempt_id: z.uuid(),
    files: z
      .array(
        z
          .object({
            question_key: graphKeySchema,
            count: z
              .number()
              .int()
              .min(1)
              .max(sitePublicUploadLimits.maxFilesPerQuestion),
          })
          .strict(),
      )
      .min(1)
      .max(sitePublicUploadLimits.maxFilesPerSubmission),
  })
  .strict();

export type SitePublicUploadIssueRequest = z.infer<
  typeof sitePublicUploadIssueRequestSchema
>;

export const sitePublicUploadInFlightQuotaSchema = z
  .object({
    business_reserved_bytes_before_issue: z.number().int().nonnegative(),
    form_reserved_bytes_before_issue: z.number().int().nonnegative(),
    client_reserved_bytes_before_issue: z.number().int().nonnegative(),
    grant: sitePublicUploadGrantSchema,
  })
  .strict()
  .superRefine((quota, context) => {
    if (quota.grant.reservation_state !== "reserved") {
      context.addIssue({
        code: "custom",
        message: "Only an active reservation consumes issue quota.",
        path: ["grant", "reservation_state"],
      });
    }
    const limits = [
      [
        "business_reserved_bytes_before_issue",
        quota.business_reserved_bytes_before_issue,
        sitePublicUploadLimits.maxInFlightReservedBytesPerBusiness,
      ],
      [
        "form_reserved_bytes_before_issue",
        quota.form_reserved_bytes_before_issue,
        sitePublicUploadLimits.maxInFlightReservedBytesPerForm,
      ],
      [
        "client_reserved_bytes_before_issue",
        quota.client_reserved_bytes_before_issue,
        sitePublicUploadLimits.maxInFlightReservedBytesPerClient,
      ],
    ] as const;
    for (const [path, current, limit] of limits) {
      if (current + quota.grant.reserved_bytes > limit) {
        context.addIssue({
          code: "custom",
          message: "Issuing this grant exceeds the in-flight byte limit.",
          path: [path],
        });
      }
    }
  });

/** A single attempt may contain five total grants, with ordinals scoped per question. */
export const sitePublicUploadAttemptSchema = z
  .object({
    business_id: z.uuid(),
    form_id: z.uuid(),
    release_id: z.uuid(),
    action_key: actionKeySchema,
    submission_attempt_id: z.uuid(),
    client_subject_hash: hashSchema,
    grants: z
      .array(sitePublicUploadGrantSchema)
      .min(1)
      .max(sitePublicUploadLimits.maxFilesPerSubmission),
  })
  .strict()
  .superRefine((attempt, context) => {
    const positions = new Set<string>();
    const reservedBytes = attempt.grants.reduce(
      (sum, grant) => sum + grant.reserved_bytes,
      0,
    );
    for (const [index, grant] of attempt.grants.entries()) {
      if (
        grant.business_id !== attempt.business_id ||
        grant.form_id !== attempt.form_id ||
        grant.release_id !== attempt.release_id ||
        grant.action_key !== attempt.action_key ||
        grant.submission_attempt_id !== attempt.submission_attempt_id ||
        grant.client_subject_hash !== attempt.client_subject_hash
      ) {
        context.addIssue({
          code: "custom",
          message: "Every grant must belong to this exact action attempt.",
          path: ["grants", index],
        });
      }
      const position = `${grant.question_key}:${grant.file_ordinal}`;
      if (positions.has(position)) {
        context.addIssue({
          code: "custom",
          message: "An attempt cannot reserve one question position twice.",
          path: ["grants", index, "file_ordinal"],
        });
      }
      positions.add(position);
    }
    if (reservedBytes > sitePublicUploadLimits.maxReservedBytesPerSubmission) {
      context.addIssue({
        code: "custom",
        message: "The submission attempt reserves too many bytes.",
        path: ["grants"],
      });
    }
  });

const allowedTransitions: Record<
  SitePublicUploadGrantState,
  readonly SitePublicUploadGrantState[]
> = {
  reserved: ["issued", "expired", "rejected"],
  issued: ["uploaded", "expired", "rejected"],
  uploaded: ["finalizing", "expired", "rejected"],
  finalizing: ["finalized", "expired", "rejected"],
  finalized: ["committed", "expired"],
  committed: [],
  expired: ["cleaned"],
  rejected: ["cleaned"],
  cleaned: [],
};

export const sitePublicUploadTransitionSchema = z
  .object({ from: grantStateSchema, to: grantStateSchema })
  .strict()
  .superRefine(({ from, to }, context) => {
    if (!allowedTransitions[from].includes(to)) {
      context.addIssue({
        code: "custom",
        message: "The public upload transition is not allowed.",
        path: ["to"],
      });
    }
  });

export const sitePublicUploadFinalizeSchema = z
  .object({ grant_id: z.uuid(), submission_attempt_id: z.uuid() })
  .strict();

export const sitePublicUploadFinalizeResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("finalized"),
        submission_attempt_id: z.uuid(),
        attachment_kind: attachmentKindSchema,
        verified_storage_key: z.string(),
        observation: uploadObservationSchema,
      })
      .strict(),
    z
      .object({
        outcome: z.literal("already_finalized"),
        submission_attempt_id: z.uuid(),
        attachment_kind: attachmentKindSchema,
        verified_storage_key: z.string(),
        observation: uploadObservationSchema,
      })
      .strict(),
  ],
);

export const sitePublicUploadCapabilitySchema = z
  .object({
    question_key: graphKeySchema,
    file_ordinal: z
      .number()
      .int()
      .min(1)
      .max(sitePublicUploadLimits.maxFilesPerQuestion),
    grant_id: z.uuid(),
    upload_url: z.url(),
    expires_at: dateSchema,
  })
  .strict();

export const sitePublicSubmissionAttachmentSchema = z
  .object({
    id: z.uuid(),
    business_id: z.uuid(),
    grant_id: z.uuid(),
    receipt_id: z.uuid(),
    record_id: z.uuid(),
    release_id: z.uuid(),
    form_id: z.uuid(),
    action_key: actionKeySchema,
    submission_attempt_id: z.uuid(),
    question_key: graphKeySchema,
    field_key: graphKeySchema,
    object_definition_id: z.uuid(),
    field_definition_id: z.uuid(),
    file_ordinal: z
      .number()
      .int()
      .min(1)
      .max(sitePublicUploadLimits.maxFilesPerQuestion),
    verified_storage_key: z.string(),
    sha256: hashSchema,
    byte_size: z
      .number()
      .int()
      .positive()
      .max(sitePublicUploadLimits.maxPdfBytes),
    mime_type: uploadMimeTypeSchema,
    created_at: dateSchema,
  })
  .strict()
  .superRefine((attachment, context) => {
    if (
      attachment.verified_storage_key !==
      verifiedStorageKey(
        attachment.business_id,
        attachment.grant_id,
        attachment.sha256,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "The attachment key must bind its grant and digest.",
        path: ["verified_storage_key"],
      });
    }
  });

export type SitePublicSubmissionAttachment = z.infer<
  typeof sitePublicSubmissionAttachmentSchema
>;

/** The only file value that may enter a public-submission Record. */
export const sitePublicFileValueSchema = z
  .object({
    attachment_ids: z
      .array(z.uuid())
      .min(1)
      .max(sitePublicUploadLimits.maxFilesPerQuestion)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Attachment IDs must be unique.",
      ),
  })
  .strict();

export type SitePublicFileValue = z.infer<typeof sitePublicFileValueSchema>;

/**
 * Construct file values from rows created in the same submit transaction. A
 * caller can provide no storage path, ordinal, or attachment ID authority;
 * all of those values originate in the verified attachment rows.
 */
export function buildSitePublicFileValues(
  questions: readonly SitePublicUploadQuestion[],
  attachments: readonly Pick<
    SitePublicSubmissionAttachment,
    "id" | "question_key" | "field_key" | "file_ordinal"
  >[],
): Record<string, SitePublicFileValue> {
  const questionByKey = new Map(
    questions.map((question) => [question.questionKey, question]),
  );
  const grouped = new Map<
    string,
    Array<
      Pick<
        SitePublicSubmissionAttachment,
        "id" | "question_key" | "field_key" | "file_ordinal"
      >
    >
  >();
  for (const attachment of attachments) {
    const question = questionByKey.get(attachment.question_key);
    if (!question || question.fieldKey !== attachment.field_key) {
      throw new Error("site_upload_attachment_binding_invalid");
    }
    const current = grouped.get(attachment.question_key) ?? [];
    if (current.some((item) => item.file_ordinal === attachment.file_ordinal)) {
      throw new Error("site_upload_attachment_ordinal_duplicate");
    }
    current.push(attachment);
    grouped.set(attachment.question_key, current);
  }

  const values: Record<string, SitePublicFileValue> = {};
  for (const [questionKey, questionAttachments] of grouped) {
    const question = questionByKey.get(questionKey)!;
    if (questionAttachments.length > question.maxFiles) {
      throw new Error("site_upload_question_file_limit");
    }
    const ordered = [...questionAttachments].sort(
      (left, right) => left.file_ordinal - right.file_ordinal,
    );
    if (
      ordered.some((attachment, index) => attachment.file_ordinal !== index + 1)
    ) {
      throw new Error("site_upload_attachment_ordinals_not_contiguous");
    }
    values[question.fieldKey] = sitePublicFileValueSchema.parse({
      attachment_ids: ordered.map((attachment) => attachment.id),
    });
  }
  return values;
}

/** Rejects public answers that try to smuggle a file value or storage identity. */
export function assertNoPublicFileAnswers(
  answers: Record<string, unknown>,
  questions: readonly SitePublicUploadQuestion[],
): void {
  const fileKeys = new Set(questions.map((question) => question.fieldKey));
  for (const [key, value] of Object.entries(answers)) {
    if (!fileKeys.has(key)) continue;
    if (value !== undefined && value !== null) {
      throw new Error("site_upload_file_answer_forbidden");
    }
  }
}

export function isSitePublicUploadTransition(
  from: SitePublicUploadGrantState,
  to: SitePublicUploadGrantState,
): boolean {
  return allowedTransitions[from].includes(to);
}

export function sitePublicUploadKeyForGrant(
  businessId: string,
  grantId: string,
): string {
  return quarantineStorageKey(businessId, grantId);
}

export function sitePublicVerifiedKeyForObservation(
  businessId: string,
  grantId: string,
  sha256: string,
): string {
  return verifiedStorageKey(businessId, grantId, sha256);
}
