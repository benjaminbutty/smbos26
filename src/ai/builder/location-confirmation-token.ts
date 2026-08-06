import "server-only";

import { z } from "zod";

import {
  createOperationalConfirmationEnvelopeService,
  OPERATIONAL_CONFIRMATION_TTL_SECONDS,
  OperationalConfirmationEnvelopeError,
} from "./operational-confirmation-envelope";
import {
  isValidIanaTimezone,
  locationNameSchema,
  locationTimezoneSchema,
} from "../../core/locations/schemas";

export const BUILDER_LOCATION_CONFIRMATION_SCHEMA_VERSION = 1 as const;
export const BUILDER_LOCATION_CONFIRMATION_ACTION = "create_location" as const;
export const BUILDER_LOCATION_CONFIRMATION_TTL_SECONDS =
  OPERATIONAL_CONFIRMATION_TTL_SECONDS;

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
  let envelope: ReturnType<typeof createOperationalConfirmationEnvelopeService>;
  try {
    envelope = createOperationalConfirmationEnvelopeService(overrides);
  } catch (cause) {
    if (cause instanceof OperationalConfirmationEnvelopeError) {
      throw new LocationConfirmationTokenError(
        "location_confirmation_secret_unavailable",
        cause,
      );
    }
    throw cause;
  }
  const now = overrides.now ?? nowSeconds;

  const service: LocationConfirmationTokenService = {
    sign(input) {
      try {
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
        return envelope.sign({
          businessId: parsed.businessId,
          actorId: parsed.actorId,
          action: BUILDER_LOCATION_CONFIRMATION_ACTION,
          signingNamespace: "smbos-location-confirmation-v1",
          includeActionInMessage: false,
          payload: parsed.payload,
        });
      } catch (cause) {
        if (cause instanceof LocationConfirmationTokenError) {
          throw cause;
        }
        if (
          cause instanceof OperationalConfirmationEnvelopeError &&
          cause.code === "confirmation_secret_unavailable"
        ) {
          throw new LocationConfirmationTokenError(
            "location_confirmation_secret_unavailable",
            cause,
          );
        }
        throw new LocationConfirmationTokenError(
          "location_confirmation_token_invalid",
          cause,
        );
      }
    },

    verify(token, identity) {
      try {
        const trustedIdentity = identitySchema.parse(identity);
        const payload = envelope.verify(token, trustedIdentity, {
          action: BUILDER_LOCATION_CONFIRMATION_ACTION,
          signingNamespace: "smbos-location-confirmation-v1",
          includeActionInMessage: false,
        });
        return confirmationPayloadSchema.parse(payload);
      } catch (cause) {
        if (cause instanceof LocationConfirmationTokenError) {
          throw cause;
        }
        if (
          cause instanceof OperationalConfirmationEnvelopeError &&
          cause.code === "confirmation_secret_unavailable"
        ) {
          throw new LocationConfirmationTokenError(
            "location_confirmation_secret_unavailable",
            cause,
          );
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
