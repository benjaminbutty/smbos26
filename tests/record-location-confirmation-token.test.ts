import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BUILDER_RECORD_LOCATION_CONFIRMATION_TTL_SECONDS,
  RecordLocationConfirmationTokenError,
  createRecordLocationConfirmationTokenService,
} from "../src/ai/builder/record-location-confirmation-token";

const businessId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const objectDefinitionId = "33333333-3333-4333-8333-333333333333";
const recordId = "44444444-4444-4444-8444-444444444444";
const locationId = "55555555-5555-4555-8555-555555555555";
const secret = "0123456789abcdef0123456789abcdef";

const input = {
  businessId,
  actorId,
  objectDefinitionId,
  objectKey: "equipment",
  targetRecordId: recordId,
  targetLocationId: locationId,
  action: "link" as const,
  expectedPairState: "unlinked" as const,
  destinationViewKey: "equipment" as string | null,
};

describe("Builder Record-to-Location confirmation token", () => {
  it("binds the operational pair to Business and actor for 15 minutes", () => {
    let now = 1_000;
    const service = createRecordLocationConfirmationTokenService({
      secret,
      now: () => now,
    });
    const token = service.sign(input);

    expect(service.verify(token, { businessId, actorId })).toMatchObject({
      schema_version: 1,
      action: "link",
      object_key: "equipment",
      target_record_id: recordId,
      target_location_id: locationId,
      expected_pair_state: "unlinked",
      expires_at: now + BUILDER_RECORD_LOCATION_CONFIRMATION_TTL_SECONDS,
    });
    expect(() =>
      service.verify(token, { businessId, actorId: businessId }),
    ).toThrow(RecordLocationConfirmationTokenError);
    now += BUILDER_RECORD_LOCATION_CONFIRMATION_TTL_SECONDS;
    expect(() => service.verify(token, { businessId, actorId })).toThrow(
      RecordLocationConfirmationTokenError,
    );
  });

  it("rejects tampering with the expected pair state", () => {
    const service = createRecordLocationConfirmationTokenService({
      secret,
      now: () => 1_000,
    });
    const token = service.sign(input);
    const [encodedPayload, signature] = token.split(".");
    expect(encodedPayload).toBeDefined();
    expect(signature).toBeDefined();

    const tamperedPayload = Buffer.from(
      JSON.stringify({
        ...JSON.parse(
          Buffer.from(encodedPayload!, "base64url").toString("utf8"),
        ),
        expected_pair_state: "linked",
      }),
      "utf8",
    ).toString("base64url");
    const tampered = `${tamperedPayload}.${signature}`;
    expect(() => service.verify(tampered, { businessId, actorId })).toThrow(
      RecordLocationConfirmationTokenError,
    );
  });

  it("does not sign complete Records, link rows, or browser field names", () => {
    const service = createRecordLocationConfirmationTokenService({
      secret,
      now: () => 1_000,
    });
    const token = service.sign({
      ...input,
      action: "unlink",
      expectedPairState: "linked",
    });
    expect(token).not.toContain("data_json");
    expect(token).not.toContain("recordLocationConfirmationToken");
    expect(token).not.toContain("candidate");
  });

  it("fails closed when the server-only secret is unavailable", () => {
    expect(() =>
      createRecordLocationConfirmationTokenService({ secret: "too-short" }),
    ).toThrowError(
      expect.objectContaining<Partial<RecordLocationConfirmationTokenError>>({
        code: "record_location_confirmation_secret_unavailable",
      }),
    );
  });
});
