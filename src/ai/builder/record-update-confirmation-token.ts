import "server-only";

import { z } from "zod";

import { recordUpdateCanonicalSelectorSchema } from "../../core/graph/record-update/schemas";
import { graphKeySchema, jsonObjectSchema } from "../../core/graph/schemas";
import {
  createOperationalConfirmationEnvelopeService,
  OPERATIONAL_CONFIRMATION_TTL_SECONDS,
  OperationalConfirmationEnvelopeError,
} from "./operational-confirmation-envelope";

export const BUILDER_RECORD_UPDATE_CONFIRMATION_SCHEMA_VERSION = 1 as const;
export const BUILDER_RECORD_UPDATE_CONFIRMATION_ACTION =
  "update_record" as const;
export const BUILDER_RECORD_UPDATE_CONFIRMATION_TTL_SECONDS =
  OPERATIONAL_CONFIRMATION_TTL_SECONDS;

const confirmationPayloadSchema = z
  .object({
    schema_version: z.literal(
      BUILDER_RECORD_UPDATE_CONFIRMATION_SCHEMA_VERSION,
    ),
    action: z.literal(BUILDER_RECORD_UPDATE_CONFIRMATION_ACTION),
    base_version_id: z.uuid(),
    head_revision: z.number().int().positive(),
    object_definition_id: z.uuid(),
    object_key: graphKeySchema,
    object_schema_digest: z.string().regex(/^[a-f0-9]{64}$/),
    canonical_selector: recordUpdateCanonicalSelectorSchema,
    selector_digest: z.string().regex(/^[a-f0-9]{64}$/),
    target_record_id: z.uuid(),
    target_record_digest: z.string().regex(/^[a-f0-9]{64}$/),
    data_patch: jsonObjectSchema,
    destination_view_key: graphKeySchema.nullable(),
    issued_at: z.number().int().nonnegative(),
    expires_at: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((payload, context) => {
    if (
      payload.expires_at - payload.issued_at !==
      BUILDER_RECORD_UPDATE_CONFIRMATION_TTL_SECONDS
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expires_at"],
        message: "Record update confirmation expiry must be 15 minutes.",
      });
    }
    if (
      payload.canonical_selector.object_definition_id !==
      payload.object_definition_id
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["canonical_selector"],
        message: "Record update selector Object identity must match.",
      });
    }
  });

export type RecordUpdateConfirmationPayload = z.infer<
  typeof confirmationPayloadSchema
>;

export class RecordUpdateConfirmationTokenError extends Error {
  readonly code:
    | "record_update_confirmation_token_invalid"
    | "record_update_confirmation_secret_unavailable";
  override readonly cause: unknown;

  constructor(
    code:
      | "record_update_confirmation_token_invalid"
      | "record_update_confirmation_secret_unavailable",
    cause?: unknown,
  ) {
    super(
      code === "record_update_confirmation_secret_unavailable"
        ? "The operational confirmation boundary is unavailable."
        : "The operational confirmation is no longer valid.",
    );
    this.name = "RecordUpdateConfirmationTokenError";
    this.code = code;
    this.cause = cause;
  }
}

const identitySchema = z
  .object({ businessId: z.uuid(), actorId: z.uuid() })
  .strict();

export interface RecordUpdateConfirmationTokenService {
  sign(input: {
    businessId: string;
    actorId: string;
    baseVersionId: string;
    headRevision: number;
    objectDefinitionId: string;
    objectKey: string;
    objectSchemaDigest: string;
    canonicalSelector: unknown;
    selectorDigest: string;
    targetRecordId: string;
    targetRecordDigest: string;
    dataPatch: Record<string, unknown>;
    destinationViewKey: string | null;
  }): string;
  verify(
    token: string,
    identity: { businessId: string; actorId: string },
  ): RecordUpdateConfirmationPayload;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

export function createRecordUpdateConfirmationTokenService(
  overrides: { secret?: string; now?: () => number } = {},
): RecordUpdateConfirmationTokenService {
  let envelope: ReturnType<typeof createOperationalConfirmationEnvelopeService>;
  try {
    envelope = createOperationalConfirmationEnvelopeService(overrides);
  } catch (cause) {
    if (cause instanceof OperationalConfirmationEnvelopeError) {
      throw new RecordUpdateConfirmationTokenError(
        "record_update_confirmation_secret_unavailable",
        cause,
      );
    }
    throw cause;
  }
  const now = overrides.now ?? nowSeconds;

  const service: RecordUpdateConfirmationTokenService = {
    sign(input) {
      try {
        const issuedAt = now();
        const payload = confirmationPayloadSchema.parse({
          schema_version: BUILDER_RECORD_UPDATE_CONFIRMATION_SCHEMA_VERSION,
          action: BUILDER_RECORD_UPDATE_CONFIRMATION_ACTION,
          base_version_id: input.baseVersionId,
          head_revision: input.headRevision,
          object_definition_id: input.objectDefinitionId,
          object_key: input.objectKey,
          object_schema_digest: input.objectSchemaDigest,
          canonical_selector: input.canonicalSelector,
          selector_digest: input.selectorDigest,
          target_record_id: input.targetRecordId,
          target_record_digest: input.targetRecordDigest,
          data_patch: input.dataPatch,
          destination_view_key: input.destinationViewKey,
          issued_at: issuedAt,
          expires_at: issuedAt + BUILDER_RECORD_UPDATE_CONFIRMATION_TTL_SECONDS,
        });
        return envelope.sign({
          businessId: input.businessId,
          actorId: input.actorId,
          action: BUILDER_RECORD_UPDATE_CONFIRMATION_ACTION,
          signingNamespace: "smbos-record-update-confirmation-v1",
          payload,
        });
      } catch (cause) {
        if (
          cause instanceof OperationalConfirmationEnvelopeError &&
          cause.code === "confirmation_secret_unavailable"
        ) {
          throw new RecordUpdateConfirmationTokenError(
            "record_update_confirmation_secret_unavailable",
            cause,
          );
        }
        throw new RecordUpdateConfirmationTokenError(
          "record_update_confirmation_token_invalid",
          cause,
        );
      }
    },

    verify(token, identity) {
      try {
        const trustedIdentity = identitySchema.parse(identity);
        const payload = envelope.verify(token, trustedIdentity, {
          action: BUILDER_RECORD_UPDATE_CONFIRMATION_ACTION,
          signingNamespace: "smbos-record-update-confirmation-v1",
        });
        return confirmationPayloadSchema.parse(payload);
      } catch (cause) {
        if (
          cause instanceof OperationalConfirmationEnvelopeError &&
          cause.code === "confirmation_secret_unavailable"
        ) {
          throw new RecordUpdateConfirmationTokenError(
            "record_update_confirmation_secret_unavailable",
            cause,
          );
        }
        throw new RecordUpdateConfirmationTokenError(
          "record_update_confirmation_token_invalid",
          cause,
        );
      }
    },
  };
  return Object.freeze(service);
}
