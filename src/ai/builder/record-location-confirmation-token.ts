import "server-only";

import { z } from "zod";

import { graphKeySchema } from "../../core/graph/schemas";
import {
  recordLocationLinkActionSchema,
  recordLocationLinkPairStateSchema,
  type RecordLocationLinkAction,
  type RecordLocationLinkPairState,
} from "../../core/graph/record-location-availability/schemas";
import {
  createOperationalConfirmationEnvelopeService,
  OPERATIONAL_CONFIRMATION_TTL_SECONDS,
  OperationalConfirmationEnvelopeError,
} from "./operational-confirmation-envelope";

export const BUILDER_RECORD_LOCATION_CONFIRMATION_SCHEMA_VERSION = 1 as const;
export const BUILDER_RECORD_LOCATION_CONFIRMATION_ACTION =
  "record_location_availability" as const;
export const BUILDER_RECORD_LOCATION_CONFIRMATION_TTL_SECONDS =
  OPERATIONAL_CONFIRMATION_TTL_SECONDS;

const confirmationPayloadSchema = z
  .object({
    schema_version: z.literal(
      BUILDER_RECORD_LOCATION_CONFIRMATION_SCHEMA_VERSION,
    ),
    action: recordLocationLinkActionSchema,
    object_definition_id: z.uuid(),
    object_key: graphKeySchema,
    target_record_id: z.uuid(),
    target_location_id: z.uuid(),
    expected_pair_state: recordLocationLinkPairStateSchema,
    destination_view_key: graphKeySchema.nullable(),
    issued_at: z.number().int().nonnegative(),
    expires_at: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((payload, context) => {
    if (
      payload.expires_at - payload.issued_at !==
      BUILDER_RECORD_LOCATION_CONFIRMATION_TTL_SECONDS
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expires_at"],
        message:
          "Location availability confirmation expiry must be 15 minutes.",
      });
    }
    const expectedPairState: RecordLocationLinkPairState =
      payload.action === "link" ? "unlinked" : "linked";
    if (payload.expected_pair_state !== expectedPairState) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expected_pair_state"],
        message: "The confirmation action and expected pair state must agree.",
      });
    }
  });

export type RecordLocationConfirmationPayload = z.infer<
  typeof confirmationPayloadSchema
>;

export class RecordLocationConfirmationTokenError extends Error {
  readonly code:
    | "record_location_confirmation_token_invalid"
    | "record_location_confirmation_secret_unavailable";
  override readonly cause: unknown;

  constructor(
    code:
      | "record_location_confirmation_token_invalid"
      | "record_location_confirmation_secret_unavailable",
    cause?: unknown,
  ) {
    super(
      code === "record_location_confirmation_secret_unavailable"
        ? "The operational confirmation boundary is unavailable."
        : "The operational confirmation is no longer valid.",
    );
    this.name = "RecordLocationConfirmationTokenError";
    this.code = code;
    this.cause = cause;
  }
}

const identitySchema = z
  .object({ businessId: z.uuid(), actorId: z.uuid() })
  .strict();

export interface RecordLocationConfirmationTokenService {
  sign(input: {
    businessId: string;
    actorId: string;
    objectDefinitionId: string;
    objectKey: string;
    targetRecordId: string;
    targetLocationId: string;
    action: RecordLocationLinkAction;
    expectedPairState: RecordLocationLinkPairState;
    destinationViewKey: string | null;
  }): string;
  verify(
    token: string,
    identity: { businessId: string; actorId: string },
  ): RecordLocationConfirmationPayload;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

export function createRecordLocationConfirmationTokenService(
  overrides: { secret?: string; now?: () => number } = {},
): RecordLocationConfirmationTokenService {
  let envelope: ReturnType<typeof createOperationalConfirmationEnvelopeService>;
  try {
    envelope = createOperationalConfirmationEnvelopeService(overrides);
  } catch (cause) {
    if (cause instanceof OperationalConfirmationEnvelopeError) {
      throw new RecordLocationConfirmationTokenError(
        "record_location_confirmation_secret_unavailable",
        cause,
      );
    }
    throw cause;
  }
  const now = overrides.now ?? nowSeconds;

  const service: RecordLocationConfirmationTokenService = {
    sign(input) {
      try {
        const issuedAt = now();
        const payload = confirmationPayloadSchema.parse({
          schema_version: BUILDER_RECORD_LOCATION_CONFIRMATION_SCHEMA_VERSION,
          action: input.action,
          object_definition_id: input.objectDefinitionId,
          object_key: input.objectKey,
          target_record_id: input.targetRecordId,
          target_location_id: input.targetLocationId,
          expected_pair_state: input.expectedPairState,
          destination_view_key: input.destinationViewKey,
          issued_at: issuedAt,
          expires_at:
            issuedAt + BUILDER_RECORD_LOCATION_CONFIRMATION_TTL_SECONDS,
        });
        return envelope.sign({
          businessId: input.businessId,
          actorId: input.actorId,
          action: BUILDER_RECORD_LOCATION_CONFIRMATION_ACTION,
          signingNamespace: "smbos-record-location-confirmation-v1",
          payload,
        });
      } catch (cause) {
        if (
          cause instanceof OperationalConfirmationEnvelopeError &&
          cause.code === "confirmation_secret_unavailable"
        ) {
          throw new RecordLocationConfirmationTokenError(
            "record_location_confirmation_secret_unavailable",
            cause,
          );
        }
        throw new RecordLocationConfirmationTokenError(
          "record_location_confirmation_token_invalid",
          cause,
        );
      }
    },

    verify(token, identity) {
      try {
        const trustedIdentity = identitySchema.parse(identity);
        const payload = envelope.verify(token, trustedIdentity, {
          action: BUILDER_RECORD_LOCATION_CONFIRMATION_ACTION,
          signingNamespace: "smbos-record-location-confirmation-v1",
        });
        return confirmationPayloadSchema.parse(payload);
      } catch (cause) {
        if (
          cause instanceof OperationalConfirmationEnvelopeError &&
          cause.code === "confirmation_secret_unavailable"
        ) {
          throw new RecordLocationConfirmationTokenError(
            "record_location_confirmation_secret_unavailable",
            cause,
          );
        }
        throw new RecordLocationConfirmationTokenError(
          "record_location_confirmation_token_invalid",
          cause,
        );
      }
    },
  };
  return Object.freeze(service);
}
