import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BUILDER_LOCATION_CONFIRMATION_TTL_SECONDS,
  LocationConfirmationTokenError,
  createLocationConfirmationTokenService,
} from "../src/ai/builder/location-confirmation-token";

const businessId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const secret = "0123456789abcdef0123456789abcdef";
const input = {
  businessId,
  actorId,
  locationName: "Cambridge",
  timezone: "Europe/London",
  timezoneSource: "business_timezone" as const,
  businessTimezone: "Europe/London",
  locationStateDigest: "a".repeat(64),
};

describe("transient Builder Location confirmation token", () => {
  it("binds the token to Business and actor and expires after 15 minutes", () => {
    let now = 1_000;
    const service = createLocationConfirmationTokenService({
      secret,
      now: () => now,
    });
    const token = service.sign(input);
    expect(service.verify(token, { businessId, actorId })).toMatchObject({
      schema_version: 1,
      action: "create_location",
      location_name: "Cambridge",
      expires_at: now + BUILDER_LOCATION_CONFIRMATION_TTL_SECONDS,
    });
    expect(() =>
      service.verify(token, { businessId, actorId: businessId }),
    ).toThrow(LocationConfirmationTokenError);
    now += BUILDER_LOCATION_CONFIRMATION_TTL_SECONDS;
    expect(() => service.verify(token, { businessId, actorId })).toThrow(
      LocationConfirmationTokenError,
    );
  });

  it("fails closed when the server-only secret is missing or too short", () => {
    expect(() =>
      createLocationConfirmationTokenService({ secret: "too-short" }),
    ).toThrowError(
      expect.objectContaining<Partial<LocationConfirmationTokenError>>({
        code: "location_confirmation_secret_unavailable",
      }),
    );
  });

  it("does not place identity, slug or token fields in the signed payload", () => {
    const service = createLocationConfirmationTokenService({
      secret,
      now: () => 1_000,
    });
    const token = service.sign(input);
    expect(token).not.toContain(businessId);
    expect(token).not.toContain(actorId);
    expect(token).not.toContain("slug");
    expect(token).not.toContain("confirmationToken");
  });
});
