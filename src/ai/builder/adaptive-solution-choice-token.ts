import "server-only";

import { z } from "zod";

import { builderAdaptiveSolutionChoiceResultSchema } from "./contracts";
import {
  createOperationalConfirmationEnvelopeService,
  OPERATIONAL_CONFIRMATION_TTL_SECONDS,
  OperationalConfirmationEnvelopeError,
} from "./operational-confirmation-envelope";

export const BUILDER_ADAPTIVE_SOLUTION_CHOICE_ACTION =
  "continue_adaptive_solution_choice" as const;

const payloadSchema = z
  .object({
    schema_version: z.literal(1),
    action: z.literal(BUILDER_ADAPTIVE_SOLUTION_CHOICE_ACTION),
    original_owner_request: z.string().trim().min(1).max(4_000),
    choice: builderAdaptiveSolutionChoiceResultSchema,
    issued_at: z.number().int().nonnegative(),
    expires_at: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.expires_at - value.issued_at !==
      OPERATIONAL_CONFIRMATION_TTL_SECONDS
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Adaptive choice expiry must be 15 minutes.",
      });
    }
  });

export type BuilderAdaptiveSolutionChoicePayload = z.infer<
  typeof payloadSchema
>;

export class BuilderAdaptiveSolutionChoiceTokenError extends Error {
  constructor(
    readonly code:
      | "adaptive_solution_choice_invalid"
      | "adaptive_solution_choice_secret_unavailable",
    cause?: unknown,
  ) {
    super(
      code === "adaptive_solution_choice_secret_unavailable"
        ? "Adaptive choice is temporarily unavailable."
        : "This choice is no longer available. Start again.",
    );
    this.name = "BuilderAdaptiveSolutionChoiceTokenError";
    this.cause = cause;
  }
}

export interface BuilderAdaptiveSolutionChoiceTokenService {
  sign(input: {
    businessId: string;
    actorId: string;
    originalOwnerRequest: string;
    choice: z.infer<typeof builderAdaptiveSolutionChoiceResultSchema>;
  }): string;
  verify(
    token: string,
    identity: { businessId: string; actorId: string },
  ): BuilderAdaptiveSolutionChoicePayload;
}

export function createBuilderAdaptiveSolutionChoiceTokenService(
  overrides: { secret?: string; now?: () => number } = {},
): BuilderAdaptiveSolutionChoiceTokenService {
  let envelope: ReturnType<typeof createOperationalConfirmationEnvelopeService>;
  try {
    envelope = createOperationalConfirmationEnvelopeService(overrides);
  } catch (cause) {
    throw new BuilderAdaptiveSolutionChoiceTokenError(
      "adaptive_solution_choice_secret_unavailable",
      cause,
    );
  }
  const now = overrides.now ?? (() => Math.floor(Date.now() / 1_000));
  return Object.freeze({
    sign(input: {
      businessId: string;
      actorId: string;
      originalOwnerRequest: string;
      choice: z.infer<typeof builderAdaptiveSolutionChoiceResultSchema>;
    }) {
      try {
        const issuedAt = now();
        const payload = payloadSchema.parse({
          schema_version: 1,
          action: BUILDER_ADAPTIVE_SOLUTION_CHOICE_ACTION,
          original_owner_request: input.originalOwnerRequest,
          choice: input.choice,
          issued_at: issuedAt,
          expires_at: issuedAt + OPERATIONAL_CONFIRMATION_TTL_SECONDS,
        });
        return envelope.sign({
          businessId: input.businessId,
          actorId: input.actorId,
          action: BUILDER_ADAPTIVE_SOLUTION_CHOICE_ACTION,
          signingNamespace: "smbos-builder-adaptive-solution-choice-v1",
          payload,
        });
      } catch (cause) {
        if (cause instanceof OperationalConfirmationEnvelopeError) {
          throw new BuilderAdaptiveSolutionChoiceTokenError(
            "adaptive_solution_choice_secret_unavailable",
            cause,
          );
        }
        throw new BuilderAdaptiveSolutionChoiceTokenError(
          "adaptive_solution_choice_invalid",
          cause,
        );
      }
    },
    verify(token: string, identity: { businessId: string; actorId: string }) {
      try {
        return payloadSchema.parse(
          envelope.verify(token, identity, {
            action: BUILDER_ADAPTIVE_SOLUTION_CHOICE_ACTION,
            signingNamespace: "smbos-builder-adaptive-solution-choice-v1",
          }),
        );
      } catch (cause) {
        if (
          cause instanceof OperationalConfirmationEnvelopeError &&
          cause.code === "confirmation_secret_unavailable"
        ) {
          throw new BuilderAdaptiveSolutionChoiceTokenError(
            "adaptive_solution_choice_secret_unavailable",
            cause,
          );
        }
        throw new BuilderAdaptiveSolutionChoiceTokenError(
          "adaptive_solution_choice_invalid",
          cause,
        );
      }
    },
  });
}
