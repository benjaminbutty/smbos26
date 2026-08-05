import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const OPERATIONAL_CONFIRMATION_TTL_SECONDS = 15 * 60;
export const OPERATIONAL_CONFIRMATION_MAX_TOKEN_BYTES = 64 * 1024;

export class OperationalConfirmationEnvelopeError extends Error {
  readonly code:
    "confirmation_token_invalid" | "confirmation_secret_unavailable";
  override readonly cause: unknown;

  constructor(
    code: "confirmation_token_invalid" | "confirmation_secret_unavailable",
    cause?: unknown,
  ) {
    super(
      code === "confirmation_secret_unavailable"
        ? "The operational confirmation boundary is unavailable."
        : "The operational confirmation is no longer valid.",
    );
    this.name = "OperationalConfirmationEnvelopeError";
    this.code = code;
    this.cause = cause;
  }
}

const identitySchema = z
  .object({ businessId: z.uuid(), actorId: z.uuid() })
  .strict();

const envelopeInputSchema = z
  .object({
    businessId: z.uuid(),
    actorId: z.uuid(),
    action: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z][a-z0-9_]*$/),
    signingNamespace: z.string().trim().min(1).max(120),
    includeActionInMessage: z.boolean().optional(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

const encodedTokenSchema = z
  .string()
  .trim()
  .min(1)
  .max(OPERATIONAL_CONFIRMATION_MAX_TOKEN_BYTES);

const timedPayloadSchema = z
  .object({
    issued_at: z.number().int().nonnegative(),
    expires_at: z.number().int().nonnegative(),
  })
  .passthrough()
  .superRefine((payload, context) => {
    if (payload.expires_at <= payload.issued_at) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expires_at"],
        message: "Confirmation expiry must be after issue time.",
      });
    }
    if (
      payload.expires_at - payload.issued_at !==
      OPERATIONAL_CONFIRMATION_TTL_SECONDS
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expires_at"],
        message: "Confirmation expiry must be 15 minutes.",
      });
    }
  });

function secretFromEnvironment(): string {
  const secret = process.env.BUILDER_OPERATIONAL_CONFIRMATION_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new OperationalConfirmationEnvelopeError(
      "confirmation_secret_unavailable",
    );
  }
  return secret;
}

function parseSecret(secret: string): string {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new OperationalConfirmationEnvelopeError(
      "confirmation_secret_unavailable",
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

function nowSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

export interface OperationalConfirmationEnvelopeService {
  sign(input: {
    businessId: string;
    actorId: string;
    action: string;
    payload: Record<string, unknown>;
    signingNamespace: string;
    includeActionInMessage?: boolean;
  }): string;
  verify(
    token: string,
    identity: { businessId: string; actorId: string },
    expected: {
      action: string;
      signingNamespace: string;
      includeActionInMessage?: boolean;
    },
  ): Record<string, unknown>;
}

export function createOperationalConfirmationEnvelopeService(
  overrides: { secret?: string; now?: () => number } = {},
): OperationalConfirmationEnvelopeService {
  let secret: string;
  try {
    secret = parseSecret(overrides.secret ?? secretFromEnvironment());
  } catch (cause) {
    if (cause instanceof OperationalConfirmationEnvelopeError) {
      throw cause;
    }
    throw new OperationalConfirmationEnvelopeError(
      "confirmation_secret_unavailable",
      cause,
    );
  }
  const now = overrides.now ?? nowSeconds;

  function signMessage(
    encodedPayload: string,
    businessId: string,
    actorId: string,
    action: string,
    signingNamespace: string,
    includeActionInMessage: boolean,
  ): string {
    const messageParts = [signingNamespace];
    if (includeActionInMessage) messageParts.push(action);
    messageParts.push(businessId, actorId, encodedPayload);
    return createHmac("sha256", secret)
      .update(messageParts.join("|"), "utf8")
      .digest("base64url");
  }

  const service: OperationalConfirmationEnvelopeService = {
    sign(input) {
      try {
        const parsed = envelopeInputSchema.parse(input);
        const timed = timedPayloadSchema.parse(parsed.payload);
        const encodedPayload = encode(JSON.stringify(timed));
        const token = `${encodedPayload}.${signMessage(
          encodedPayload,
          parsed.businessId,
          parsed.actorId,
          parsed.action,
          parsed.signingNamespace,
          parsed.includeActionInMessage ?? true,
        )}`;
        if (
          Buffer.byteLength(token, "utf8") >
          OPERATIONAL_CONFIRMATION_MAX_TOKEN_BYTES
        ) {
          throw new Error("Confirmation token exceeds the maximum size.");
        }
        return token;
      } catch (cause) {
        if (cause instanceof OperationalConfirmationEnvelopeError) {
          throw cause;
        }
        throw new OperationalConfirmationEnvelopeError(
          "confirmation_token_invalid",
          cause,
        );
      }
    },

    verify(token, identity, expected) {
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
        const expectedSignature = signMessage(
          payloadPart,
          trustedIdentity.businessId,
          trustedIdentity.actorId,
          expected.action,
          expected.signingNamespace,
          expected.includeActionInMessage ?? true,
        );
        const expectedBytes = Buffer.from(expectedSignature, "utf8");
        const actualBytes = Buffer.from(signaturePart, "utf8");
        if (
          expectedBytes.length !== actualBytes.length ||
          !timingSafeEqual(expectedBytes, actualBytes)
        ) {
          throw new Error("Invalid token signature.");
        }
        const payload = timedPayloadSchema.parse(
          JSON.parse(decode(payloadPart)),
        );
        if (now() >= payload.expires_at) {
          throw new Error("Expired token.");
        }
        return payload;
      } catch (cause) {
        if (cause instanceof OperationalConfirmationEnvelopeError) {
          throw cause;
        }
        throw new OperationalConfirmationEnvelopeError(
          "confirmation_token_invalid",
          cause,
        );
      }
    },
  };
  return Object.freeze(service);
}
