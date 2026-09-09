import { describe, expect, it } from "vitest";

import {
  sitePublicUploadAttemptSchema,
  sitePublicUploadFinalizeSchema,
  sitePublicUploadFinalizeResultSchema,
  sitePublicUploadGrantSchema,
  sitePublicUploadInFlightQuotaSchema,
  sitePublicUploadLimits,
  sitePublicUploadTransitionSchema,
} from "../src/core/sites/upload-protocol";

const issuedAt = "2026-09-09T10:00:00.000Z";
const appExpiry = "2026-09-09T10:15:00.000Z";
const providerExpiry = "2026-09-09T12:00:00.000Z";
const clientSubjectHash = "a".repeat(64);

function validGrant() {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    business_id: "00000000-0000-4000-8000-000000000002",
    form_id: "00000000-0000-4000-8000-000000000003",
    release_id: "00000000-0000-4000-8000-000000000004",
    submission_attempt_id: "00000000-0000-4000-8000-000000000005",
    file_ordinal: 1,
    client_subject_hash: clientSubjectHash,
    storage_key:
      "quarantine/00000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-000000000001",
    attachment_kind: "pdf" as const,
    maximum_bytes: sitePublicUploadLimits.maxPdfBytes,
    reserved_bytes: sitePublicUploadLimits.maxPdfBytes,
    issued_at: issuedAt,
    application_expires_at: appExpiry,
    provider_issued_at: issuedAt,
    provider_expires_at: providerExpiry,
    reservation_expires_at: "2026-09-09T12:15:00.000Z",
    reservation_state: "reserved" as const,
    reservation_released_at: null,
    state: "issued" as const,
    upload_observation: null,
    managed_asset_id: null,
    finalized_at: null,
  };
}

describe("Sites C1 public-upload contract", () => {
  it("bounds an immutable private PDF reservation without reducing the 10 MiB limit", () => {
    expect(sitePublicUploadGrantSchema.parse(validGrant())).toMatchObject({
      maximum_bytes: 10 * 1024 * 1024,
      reserved_bytes: 10 * 1024 * 1024,
      state: "issued",
    });
  });

  it("requires attempt identity, bounded file positions, and exact grant/provider lifetimes", () => {
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
        state: "reserved",
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
        storage_key: `quarantine/${grant.business_id}/00000000-0000-4000-8000-000000000099`,
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
        maximum_bytes: sitePublicUploadLimits.maxPdfBytes + 1,
      }).success,
    ).toBe(false);
    expect(
      sitePublicUploadGrantSchema.safeParse({
        ...grant,
        attachment_kind: "image",
        maximum_bytes: sitePublicUploadLimits.maxImageBytes,
        reserved_bytes: sitePublicUploadLimits.maxImageBytes,
      }).success,
    ).toBe(false);
    expect(
      sitePublicUploadGrantSchema.safeParse({
        ...grant,
        attachment_kind: "image",
        maximum_bytes: sitePublicUploadLimits.maxImageBytes + 1,
        reserved_bytes: sitePublicUploadLimits.providerQuarantineMaximumBytes,
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

  it("rejects aggregate in-flight reservations above the Business, Form, or client cap", () => {
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
          reservation_released_at: "2026-09-09T12:15:00.000Z",
        },
      }).success,
    ).toBe(false);
  });

  it("limits five unique grants to one attempt and preserves the full reservation", () => {
    const first = validGrant();
    const grants = Array.from({ length: 5 }, (_, index) => {
      const id = `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`;
      return {
        ...first,
        id,
        storage_key: `quarantine/${first.business_id}/${id}`,
        file_ordinal: index + 1,
        attachment_kind: "image" as const,
        maximum_bytes: sitePublicUploadLimits.maxImageBytes,
        reserved_bytes: sitePublicUploadLimits.providerQuarantineMaximumBytes,
      };
    });
    const attempt = {
      business_id: first.business_id,
      form_id: first.form_id,
      release_id: first.release_id,
      submission_attempt_id: first.submission_attempt_id,
      client_subject_hash: first.client_subject_hash,
      grants,
    };
    expect(sitePublicUploadAttemptSchema.safeParse(attempt).success).toBe(true);
    expect(
      sitePublicUploadAttemptSchema.safeParse({
        ...attempt,
        grants: [...grants, { ...grants[4], id: crypto.randomUUID() }],
      }).success,
    ).toBe(false);
    expect(
      sitePublicUploadAttemptSchema.safeParse({
        ...attempt,
        grants: [{ ...first }, { ...first, id: crypto.randomUUID() }],
      }).success,
    ).toBe(false);
  });

  it("permits only finite observation/finalization transitions and idempotent finalization results", () => {
    expect(
      sitePublicUploadTransitionSchema.safeParse({
        from: "reserved",
        to: "issued",
      }).success,
    ).toBe(true);
    expect(
      sitePublicUploadTransitionSchema.safeParse({
        from: "reserved",
        to: "expired",
      }).success,
    ).toBe(true);
    expect(
      sitePublicUploadTransitionSchema.safeParse({
        from: "issued",
        to: "uploaded",
      }).success,
    ).toBe(true);
    expect(
      sitePublicUploadTransitionSchema.safeParse({
        from: "uploaded",
        to: "finalized",
      }).success,
    ).toBe(true);
    expect(
      sitePublicUploadTransitionSchema.safeParse({
        from: "finalized",
        to: "uploaded",
      }).success,
    ).toBe(false);
    expect(
      sitePublicUploadFinalizeResultSchema.safeParse({
        outcome: "already_finalized",
        managed_asset_id: "00000000-0000-4000-8000-000000000099",
        submission_attempt_id: validGrant().submission_attempt_id,
      }).success,
    ).toBe(true);
    expect(
      sitePublicUploadFinalizeSchema.safeParse({
        grant_id: validGrant().id,
        submission_attempt_id: validGrant().submission_attempt_id,
        declared_mime_type: "application/pdf",
      }).success,
    ).toBe(true);
    expect(
      sitePublicUploadFinalizeSchema.safeParse({
        grant_id: validGrant().id,
        declared_mime_type: "application/pdf",
      }).success,
    ).toBe(false);
    expect(
      sitePublicUploadGrantSchema.safeParse({
        ...validGrant(),
        state: "finalized",
        upload_observation: {
          observed_at: "2026-09-09T10:01:00.000Z",
          observed_byte_size: 10,
          detected_mime_type: "application/pdf",
          sha256: "b".repeat(64),
        },
        managed_asset_id: "00000000-0000-4000-8000-000000000099",
        finalized_at: "2026-09-09T10:01:00.000Z",
      }).success,
    ).toBe(true);
    const expiredBeforeProviderIssue = {
      ...validGrant(),
      state: "expired" as const,
      provider_issued_at: null,
      provider_expires_at: null,
    };
    expect(
      sitePublicUploadGrantSchema.safeParse(expiredBeforeProviderIssue).success,
    ).toBe(true);
    expect(
      sitePublicUploadGrantSchema.safeParse({
        ...expiredBeforeProviderIssue,
        state: "cleaned",
        reservation_state: "released",
        reservation_released_at: "2026-09-09T12:15:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("distinguishes deterministic contract validation from provider enforcement", () => {
    // These tests do not mock Supabase Storage. C3 must prove provider signed
    // URL replay/expiry, byte inspection, private download headers, proxy
    // identity and storage cleanup against a disposable provider target.
    expect(sitePublicUploadLimits.grantsPerClientFormMinute).toBe(10);
  });
});
