import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import {
  isValidIanaTimezone,
  locationNameSchema,
  locationTimezoneSchema,
} from "../../core/locations/schemas";

export const BUILDER_LOCATION_CONFIRMATION_SCHEMA_VERSION = 1 as const;
export const BUILDER_LOCATION_CONFIRMATION_ACTION = "create_location" as const;
export const BUILDER_LOCATION_CONFIRMATION_TTL_SECONDS = 15 * 60;

const confirmationPayloadSchema = z
  .object({
    schema_version: z.literal(BUILDER_LOCATION_CONFIRMATION_SCHEMA_VERSION),
    action: z.literal(BUILDER_LOCATION_CONFIRMATION_ACTION),
    location_name: locationNameSchema,
    timezone: locationTimezoneSchema,
    timezone_source: z.enum(["business_timezone", "explicit_timezone"]),
    business_timezone: locationTimezoneSchema,
    location_state_digest: z.string().regex(/^[a-f0-9]{64}$/),
    issued_at: z.number().int().nonnegative(),
    expires_at: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((payload, context) => {
    if (
      payload.expires_at - payload.issued_at !==
      BUILDER_LOCATION_CONFIRMATION_TTL_SECONDS
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expires_at"],
        message: "Location confirmation expiry must be 15 minutes.",
      });
    }
    if (!isValidIanaTimezone(payload.timezone)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["timezone"],
        message: "The confirmation timezone is invalid.",
      });
    }
    if (!isValidIanaTimezone(payload.business_timezone)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["business_timezone"],
        message: "The Business timezone is invalid.",
      });
    }
  });

export type LocationConfirmationPayload = z.infer<
  typeof confirmationPayloadSchema
>;

export class LocationConfirmationTokenError extends Error {
  readonly code:
    | "location_confirmation_token_invalid"
    | "location_confirmation_secret_unavailable";
  override readonly cause: unknown;

  constructor(
    code:
      | "location_confirmation_token_invalid"
      | "location_confirmation_secret_unavailable",
    cause?: unknown,
  ) {
    super(
      code === "location_confirmation_secret_unavailable"
        ? "The operational confirmation boundary is unavailable."
        : "The operational confirmation is no longer valid.",
    );
    this.name = "LocationConfirmationTokenError";
    this.code = code;
    this.cause = cause;
  }
}

const identitySchema = z
  .object({ businessId: z.uuid(), actorId: z.uuid() })
  .strict();

const signingInputSchema = z
  .object({
    businessId: z.uuid(),
    actorId: z.uuid(),
    payload: confirmationPayloadSchema,
  })
  .strict();

const encodedTokenSchema = z.string().trim().min(1).max(20_000);

function secretFromEnvironment(): string {
  const secret = process.env.BUILDER_OPERATIONAL_CONFIRMATION_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new LocationConfirmationTokenError(
      "location_confirmation_secret_unavailable",
    );
  }
  return secret;
}

function parseSecret(secret: string): string {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new LocationConfirmationTokenError(
      "location_confirmation_secret_unavailable",
    );
  }
  return secret;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signingMessage(
  encodedPayload: string,
  businessId: string,
  actorId: string,
): string {
  return [
    "smbos-location-confirmation-v1",
    businessId,
    actorId,
    encodedPayload,
  ].join("|");
}

function signature(
  encodedPayload: string,
  businessId: string,
  actorId: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(signingMessage(encodedPayload, businessId, actorId), "utf8")
    .digest("base64url");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

export interface LocationConfirmationTokenService {
  sign(input: {
    businessId: string;
    actorId: string;
    locationName: string;
    timezone: string;
    timezoneSource: "business_timezone" | "explicit_timezone";
    businessTimezone: string;
    locationStateDigest: string;
  }): string;
  verify(
    token: string,
    identity: { businessId: string; actorId: string },
  ): LocationConfirmationPayload;
}

export function createLocationConfirmationTokenService(
  overrides: {
    secret?: string;
    now?: () => number;
  } = {},
): LocationConfirmationTokenService {
  const secret = parseSecret(overrides.secret ?? secretFromEnvironment());
  const now = overrides.now ?? nowSeconds;

  const service: LocationConfirmationTokenService = {
    sign(input) {
      const issuedAt = now();
      const parsed = signingInputSchema.parse({
        businessId: input.businessId,
        actorId: input.actorId,
        payload: {
          schema_version: BUILDER_LOCATION_CONFIRMATION_SCHEMA_VERSION,
          action: BUILDER_LOCATION_CONFIRMATION_ACTION,
          location_name: input.locationName,
          timezone: input.timezone,
          timezone_source: input.timezoneSource,
          business_timezone: input.businessTimezone,
          location_state_digest: input.locationStateDigest,
          issued_at: issuedAt,
          expires_at: issuedAt + BUILDER_LOCATION_CONFIRMATION_TTL_SECONDS,
        },
      });
      const encodedPayload = encode(JSON.stringify(parsed.payload));
      return `${encodedPayload}.${signature(
        encodedPayload,
        parsed.businessId,
        parsed.actorId,
        secret,
      )}`;
    },

    verify(token, identity) {
      let encodedPayload: string;
      let encodedSignature: string;
      try {
        const trustedIdentity = identitySchema.parse(identity);
        const parsedToken = encodedTokenSchema.parse(token);
        const parts = parsedToken.split(".");
        if (parts.length !== 2) {
          throw new Error("Malformed token.");
        }
        const [payloadPart, signaturePart] = parts;
        if (!payloadPart || !signaturePart) {
          throw new Error("Malformed token.");
        }
        encodedPayload = payloadPart;
        encodedSignature = signaturePart;
        const expectedSignature = signature(
          encodedPayload,
          trustedIdentity.businessId,
          trustedIdentity.actorId,
          secret,
        );
        const expectedBytes = Buffer.from(expectedSignature, "utf8");
        const actualBytes = Buffer.from(encodedSignature, "utf8");
        if (
          expectedBytes.length !== actualBytes.length ||
          !timingSafeEqual(expectedBytes, actualBytes)
        ) {
          throw new Error("Invalid token signature.");
        }
        const payload = confirmationPayloadSchema.parse(
          JSON.parse(decode(encodedPayload)),
        );
        if (now() >= payload.expires_at) {
          throw new Error("Expired token.");
        }
        return payload;
      } catch (cause) {
        if (cause instanceof LocationConfirmationTokenError) {
          throw cause;
        }
        throw new LocationConfirmationTokenError(
          "location_confirmation_token_invalid",
          cause,
        );
      }
    },
  };
  return Object.freeze(service);
}
