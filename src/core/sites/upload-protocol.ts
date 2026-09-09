import { z } from "zod";

/** C3 must preserve this PDF limit; hosted request bodies are not the path. */
export const sitePublicUploadLimits = {
  applicationGrantLifetimeMs: 15 * 60 * 1000,
  grantsPerClientFormMinute: 10,
  maxInFlightReservedBytesPerBusiness: 512 * 1024 * 1024,
  maxInFlightReservedBytesPerClient: 100 * 1024 * 1024,
  maxInFlightReservedBytesPerForm: 256 * 1024 * 1024,
  maxFilesPerSubmission: 5,
  maxImageBytes: 3 * 1024 * 1024,
  maxPdfBytes: 10 * 1024 * 1024,
  providerQuarantineMaximumBytes: 10 * 1024 * 1024,
  maxReservedBytesPerSubmission: 50 * 1024 * 1024,
  providerCapabilityLifetimeMs: 2 * 60 * 60 * 1000,
} as const;

const attachmentKindSchema = z.enum(["image", "pdf"]);
const grantStateSchema = z.enum([
  "reserved",
  "issued",
  "uploaded",
  "finalized",
  "expired",
  "rejected",
  "cleaned",
]);
const reservationStateSchema = z.enum(["reserved", "released"]);

const uploadObservationSchema = z
  .object({
    observed_at: z.string().datetime({ offset: true }),
    observed_byte_size: z.number().int().positive(),
    detected_mime_type: z.enum([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

/**
 * A finite server-issued reservation. This is a deterministic contract, not a
 * public route or Storage capability implementation. `client_subject_hash` is
 * an HMAC of a trusted server-derived network signal, never a browser header.
 */
export const sitePublicUploadGrantSchema = z
  .object({
    id: z.uuid(),
    business_id: z.uuid(),
    form_id: z.uuid(),
    release_id: z.uuid(),
    submission_attempt_id: z.uuid(),
    file_ordinal: z.number().int().min(1).max(5),
    client_subject_hash: z.string().regex(/^[a-f0-9]{64}$/),
    storage_key: z.string().regex(/^quarantine\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/),
    attachment_kind: attachmentKindSchema,
    maximum_bytes: z.number().int().positive(),
    reserved_bytes: z.number().int().positive(),
    issued_at: z.string().datetime({ offset: true }),
    application_expires_at: z.string().datetime({ offset: true }),
    provider_issued_at: z.string().datetime({ offset: true }).nullable(),
    provider_expires_at: z.string().datetime({ offset: true }).nullable(),
    reservation_expires_at: z.string().datetime({ offset: true }),
    reservation_state: reservationStateSchema,
    reservation_released_at: z.string().datetime({ offset: true }).nullable(),
    state: grantStateSchema,
    upload_observation: uploadObservationSchema.nullable(),
    managed_asset_id: z.uuid().nullable(),
    finalized_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict()
  .superRefine((grant, context) => {
    const issuedAt = Date.parse(grant.issued_at);
    const applicationExpiry = Date.parse(grant.application_expires_at);
    const providerIssuedAt = grant.provider_issued_at
      ? Date.parse(grant.provider_issued_at)
      : null;
    const providerExpiry = grant.provider_expires_at
      ? Date.parse(grant.provider_expires_at)
      : null;
    const reservationExpiry = Date.parse(grant.reservation_expires_at);
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
    if (
      grant.reserved_bytes !==
      sitePublicUploadLimits.providerQuarantineMaximumBytes
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The grant must reserve the shared quarantine bucket's full maximum size.",
        path: ["reserved_bytes"],
      });
    }
    if (grant.storage_key !== `quarantine/${grant.business_id}/${grant.id}`) {
      context.addIssue({
        code: "custom",
        message:
          "The managed quarantine key must bind this Business and grant.",
        path: ["storage_key"],
      });
    }
    if (
      applicationExpiry - issuedAt !==
      sitePublicUploadLimits.applicationGrantLifetimeMs
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The application grant must have its exact 15-minute lifetime.",
        path: ["application_expires_at"],
      });
    }
    const hasProviderIssuedAt = providerIssuedAt !== null;
    const hasProviderExpiry = providerExpiry !== null;
    const providerIssued = hasProviderIssuedAt && hasProviderExpiry;
    if (
      hasProviderIssuedAt !== hasProviderExpiry ||
      (grant.state === "reserved" && providerIssued) ||
      (["issued", "uploaded", "finalized"].includes(grant.state) &&
        !providerIssued) ||
      (providerIssued &&
        (providerIssuedAt < issuedAt ||
          providerIssuedAt > applicationExpiry ||
          providerExpiry - providerIssuedAt !==
            sitePublicUploadLimits.providerCapabilityLifetimeMs))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The provider capability must retain Supabase's full two-hour lifetime.",
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
          "Reservation must cover capability creation and its full provider lifetime.",
        path: ["reservation_expires_at"],
      });
    }
    const reservationReleasedAt = grant.reservation_released_at
      ? Date.parse(grant.reservation_released_at)
      : null;
    if (
      (grant.reservation_state === "released" &&
        (reservationReleasedAt === null ||
          reservationReleasedAt < reservationExpiry)) ||
      (grant.reservation_state === "reserved" && reservationReleasedAt !== null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A reservation releases only after its conservative capability window closes.",
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
        message: "Observed upload content does not match this grant.",
        path: ["upload_observation"],
      });
    }
    const hasObservation = observation !== null;
    const hasAsset = grant.managed_asset_id !== null;
    const hasFinalizedAt = grant.finalized_at !== null;
    if (
      grant.state === "reserved" &&
      (hasObservation || hasAsset || hasFinalizedAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "A reserved grant has no provider capability or content yet.",
      });
    }
    if (
      grant.state === "issued" &&
      (hasObservation || hasAsset || hasFinalizedAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "An issued grant cannot have observed or finalized content.",
      });
    }
    if (
      grant.state === "uploaded" &&
      (!hasObservation || hasAsset || hasFinalizedAt)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "An uploaded grant needs one verified object and no asset yet.",
      });
    }
    if (
      grant.state === "finalized" &&
      (!hasObservation || !hasAsset || !hasFinalizedAt)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A finalized grant needs its verified object and immutable asset.",
      });
    }
    if (
      ["expired", "rejected", "cleaned"].includes(grant.state) &&
      (hasAsset || hasFinalizedAt)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A terminal unfinalized grant cannot point to a managed asset.",
      });
    }
    if (grant.state === "cleaned" && grant.reservation_state !== "released") {
      context.addIssue({
        code: "custom",
        message: "Cleanup must release its expired reservation.",
        path: ["reservation_state"],
      });
    }
  });

/**
 * A locked issue transaction supplies aggregate reservations for all
 * unreleased reservations, including finalized quarantine objects, before adding
 * this grant. These are short-lived attachment reservations, not a Business's
 * long-term Storage quota.
 */
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
        message: "Only an active reservation can consume issue quota.",
        path: ["grant", "reservation_state"],
      });
    }
    const additional = quota.grant.reserved_bytes;
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
      if (current + additional > limit) {
        context.addIssue({
          code: "custom",
          message: "Issuing this grant would exceed the in-flight byte limit.",
          path: [path],
        });
      }
    }
  });

/** A single attempt bounds five unique server-issued file positions. */
export const sitePublicUploadAttemptSchema = z
  .object({
    business_id: z.uuid(),
    form_id: z.uuid(),
    release_id: z.uuid(),
    submission_attempt_id: z.uuid(),
    client_subject_hash: z.string().regex(/^[a-f0-9]{64}$/),
    grants: z.array(sitePublicUploadGrantSchema).min(1).max(5),
  })
  .strict()
  .superRefine((attempt, context) => {
    const ordinals = new Set<number>();
    let reservedBytes = 0;
    for (const [index, grant] of attempt.grants.entries()) {
      if (
        grant.business_id !== attempt.business_id ||
        grant.form_id !== attempt.form_id ||
        grant.release_id !== attempt.release_id ||
        grant.submission_attempt_id !== attempt.submission_attempt_id ||
        grant.client_subject_hash !== attempt.client_subject_hash
      ) {
        context.addIssue({
          code: "custom",
          message: "Every grant must belong to this exact submission attempt.",
          path: ["grants", index],
        });
      }
      if (ordinals.has(grant.file_ordinal)) {
        context.addIssue({
          code: "custom",
          message:
            "A submission attempt cannot reserve one file position twice.",
          path: ["grants", index, "file_ordinal"],
        });
      }
      ordinals.add(grant.file_ordinal);
      reservedBytes += grant.reserved_bytes;
    }
    if (reservedBytes > sitePublicUploadLimits.maxReservedBytesPerSubmission) {
      context.addIssue({
        code: "custom",
        message: "The submission attempt reserves too many bytes.",
        path: ["grants"],
      });
    }
  });

const allowedTransitions = {
  reserved: ["issued", "expired", "rejected", "cleaned"],
  issued: ["uploaded", "expired", "rejected", "cleaned"],
  uploaded: ["finalized", "expired", "rejected", "cleaned"],
  finalized: [],
  expired: ["cleaned"],
  rejected: ["cleaned"],
  cleaned: [],
} as const;

/** The only persisted state transitions; a finalization retry returns state. */
export const sitePublicUploadTransitionSchema = z
  .object({ from: grantStateSchema, to: grantStateSchema })
  .strict()
  .superRefine(({ from, to }, context) => {
    if (!(allowedTransitions[from] as readonly string[]).includes(to)) {
      context.addIssue({
        code: "custom",
        message: "The public-upload grant transition is not allowed.",
        path: ["to"],
      });
    }
  });

/**
 * Internal finalizer result. The public receipt stays opaque and never exposes
 * this managed asset identifier.
 */
export const sitePublicUploadFinalizeResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("finalized"),
        managed_asset_id: z.uuid(),
        submission_attempt_id: z.uuid(),
      })
      .strict(),
    z
      .object({
        outcome: z.literal("already_finalized"),
        managed_asset_id: z.uuid(),
        submission_attempt_id: z.uuid(),
      })
      .strict(),
  ],
);

export const sitePublicUploadFinalizeSchema = z
  .object({
    grant_id: z.uuid(),
    submission_attempt_id: z.uuid(),
    declared_mime_type: z.enum([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]),
  })
  .strict();
