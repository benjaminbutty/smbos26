import "server-only";

import { z } from "zod";

import {
  recordCreationFieldValueSchema,
  type RecordCreationFieldValue,
} from "../../core/graph/record-creation/schemas";
import {
  createOperationalConfirmationEnvelopeService,
  OPERATIONAL_CONFIRMATION_TTL_SECONDS,
  OperationalConfirmationEnvelopeError,
} from "./operational-confirmation-envelope";

export const BUILDER_RECORD_CONFIRMATION_SCHEMA_VERSION = 1 as const;
export const BUILDER_RECORD_CONFIRMATION_ACTION = "create_record" as const;
export const BUILDER_RECORD_CONFIRMATION_TTL_SECONDS =
  OPERATIONAL_CONFIRMATION_TTL_SECONDS;

const confirmationPayloadSchema = z
  .object({
    schema_version: z.literal(BUILDER_RECORD_CONFIRMATION_SCHEMA_VERSION),
    action: z.literal(BUILDER_RECORD_CONFIRMATION_ACTION),
    base_version_id: z.uuid(),
    head_revision: z.number().int().positive(),
    object_key: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z][a-z0-9_]*$/),
    object_schema_digest: z.string().regex(/^[a-f0-9]{64}$/),
    record_state_digest: z.string().regex(/^[a-f0-9]{64}$/),
    field_values: z.array(recordCreationFieldValueSchema).min(1).max(50),
    issued_at: z.number().int().nonnegative(),
    expires_at: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((payload, context) => {
    if (
      payload.expires_at - payload.issued_at !==
      BUILDER_RECORD_CONFIRMATION_TTL_SECONDS
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expires_at"],
        message: "Record confirmation expiry must be 15 minutes.",
      });
    }
    const keys = payload.field_values.map((value) => value.field_key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["field_values"],
        message: "Record confirmation Field values must be unique.",
      });
    }
  });

export type RecordConfirmationPayload = z.infer<
  typeof confirmationPayloadSchema
>;

export class RecordConfirmationTokenError extends Error {
  readonly code:
    | "record_confirmation_token_invalid"
    | "record_confirmation_secret_unavailable";
  override readonly cause: unknown;

  constructor(
    code:
      | "record_confirmation_token_invalid"
      | "record_confirmation_secret_unavailable",
    cause?: unknown,
  ) {
    super(
      code === "record_confirmation_secret_unavailable"
        ? "The operational confirmation boundary is unavailable."
        : "The operational confirmation is no longer valid.",
    );
    this.name = "RecordConfirmationTokenError";
    this.code = code;
    this.cause = cause;
  }
}

const identitySchema = z
  .object({ businessId: z.uuid(), actorId: z.uuid() })
  .strict();

export interface RecordConfirmationTokenService {
  sign(input: {
    businessId: string;
    actorId: string;
    baseVersionId: string;
    headRevision: number;
    objectKey: string;
    objectSchemaDigest: string;
    recordStateDigest: string;
    fieldValues: readonly RecordCreationFieldValue[];
  }): string;
  verify(
    token: string,
    identity: { businessId: string; actorId: string },
  ): RecordConfirmationPayload;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

export function createRecordConfirmationTokenService(
  overrides: { secret?: string; now?: () => number } = {},
): RecordConfirmationTokenService {
  let envelope: ReturnType<typeof createOperationalConfirmationEnvelopeService>;
  try {
    envelope = createOperationalConfirmationEnvelopeService(overrides);
  } catch (cause) {
    if (cause instanceof OperationalConfirmationEnvelopeError) {
      throw new RecordConfirmationTokenError(
        "record_confirmation_secret_unavailable",
        cause,
      );
    }
    throw cause;
  }
  const now = overrides.now ?? nowSeconds;

  const service: RecordConfirmationTokenService = {
    sign(input) {
      try {
        const issuedAt = now();
        const payload = confirmationPayloadSchema.parse({
          schema_version: BUILDER_RECORD_CONFIRMATION_SCHEMA_VERSION,
          action: BUILDER_RECORD_CONFIRMATION_ACTION,
          base_version_id: input.baseVersionId,
          head_revision: input.headRevision,
          object_key: input.objectKey,
          object_schema_digest: input.objectSchemaDigest,
          record_state_digest: input.recordStateDigest,
          field_values: input.fieldValues,
          issued_at: issuedAt,
          expires_at: issuedAt + BUILDER_RECORD_CONFIRMATION_TTL_SECONDS,
        });
        return envelope.sign({
          businessId: input.businessId,
          actorId: input.actorId,
          action: BUILDER_RECORD_CONFIRMATION_ACTION,
          signingNamespace: "smbos-record-confirmation-v1",
          payload,
        });
      } catch (cause) {
        if (
          cause instanceof OperationalConfirmationEnvelopeError &&
          cause.code === "confirmation_secret_unavailable"
        ) {
          throw new RecordConfirmationTokenError(
            "record_confirmation_secret_unavailable",
            cause,
          );
        }
        throw new RecordConfirmationTokenError(
          "record_confirmation_token_invalid",
          cause,
        );
      }
    },

    verify(token, identity) {
      try {
        const trustedIdentity = identitySchema.parse(identity);
        const payload = envelope.verify(token, trustedIdentity, {
          action: BUILDER_RECORD_CONFIRMATION_ACTION,
          signingNamespace: "smbos-record-confirmation-v1",
        });
        return confirmationPayloadSchema.parse(payload);
      } catch (cause) {
        if (
          cause instanceof OperationalConfirmationEnvelopeError &&
          cause.code === "confirmation_secret_unavailable"
        ) {
          throw new RecordConfirmationTokenError(
            "record_confirmation_secret_unavailable",
            cause,
          );
        }
        throw new RecordConfirmationTokenError(
          "record_confirmation_token_invalid",
          cause,
        );
      }
    },
  };
  return Object.freeze(service);
}
