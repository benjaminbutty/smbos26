import "server-only";

import { z } from "zod";

import { builderPlanQuestionSchema } from "../planning/schemas";
import {
  builderAdaptiveSolutionChoiceResultSchema,
  type BuilderAdaptiveSolutionChoiceResult,
} from "./contracts";
import {
  createOperationalConfirmationEnvelopeService,
  OPERATIONAL_CONFIRMATION_TTL_SECONDS,
  OperationalConfirmationEnvelopeError,
} from "./operational-confirmation-envelope";

export const BUILDER_CLARIFICATION_CONTINUATION_SCHEMA_VERSION = 1 as const;
export const BUILDER_CLARIFICATION_CONTINUATION_ACTION =
  "continue_clarification" as const;
export const BUILDER_CLARIFICATION_MAX_ROUNDS = 3;
export const BUILDER_CLARIFICATION_MAX_ANSWER_CHARACTERS = 1_000;
export const BUILDER_CLARIFICATION_MAX_TOTAL_ANSWER_CHARACTERS = 5_000;
export const BUILDER_CLARIFICATION_MAX_COMPOSED_REQUEST_CHARACTERS = 8_000;
// Must remain compatible with the Builder orchestration boundary. Character
// limits alone are not enough for multi-byte owner input.
export const BUILDER_CLARIFICATION_MAX_COMPOSED_REQUEST_BYTES = 16 * 1024;

const answerSchema = z.union([
  z.string().trim().min(1).max(BUILDER_CLARIFICATION_MAX_ANSWER_CHARACTERS),
  z.array(z.string().trim().min(1).max(120)).min(1).max(8),
]);

const answeredQuestionSchema = z
  .object({
    question: builderPlanQuestionSchema,
    answer: answerSchema,
  })
  .strict();

const selectedAdaptiveChoiceSchema = z
  .object({
    choice: builderAdaptiveSolutionChoiceResultSchema,
    option_id: z.enum(["work_from_primary", "simplify_around_primary"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.choice.options.some((option) => option.id === value.option_id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["option_id"],
        message: "The selected adaptive option must have been presented.",
      });
    }
  });

const payloadSchema = z
  .object({
    schema_version: z.literal(
      BUILDER_CLARIFICATION_CONTINUATION_SCHEMA_VERSION,
    ),
    action: z.literal(BUILDER_CLARIFICATION_CONTINUATION_ACTION),
    base_version_id: z.uuid(),
    head_revision: z.number().int().positive(),
    original_owner_request: z.string().trim().min(1).max(4_000),
    questions: z.array(builderPlanQuestionSchema).min(1).max(5),
    answers: z.array(answeredQuestionSchema).max(15),
    selected_adaptive_choice: selectedAdaptiveChoiceSchema.optional(),
    round: z.number().int().min(1).max(BUILDER_CLARIFICATION_MAX_ROUNDS),
    issued_at: z.number().int().nonnegative(),
    expires_at: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((payload, context) => {
    if (
      payload.expires_at - payload.issued_at !==
      OPERATIONAL_CONFIRMATION_TTL_SECONDS
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expires_at"],
        message: "Clarification continuation expiry must be 15 minutes.",
      });
    }
    const total = payload.answers.reduce(
      (count, answer) =>
        count +
        (typeof answer.answer === "string"
          ? answer.answer.length
          : answer.answer.join(", ").length),
      0,
    );
    if (total > BUILDER_CLARIFICATION_MAX_TOTAL_ANSWER_CHARACTERS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["answers"],
        message: "Clarification answers exceed the bounded continuation size.",
      });
    }
  });

export type BuilderClarificationContinuationPayload = z.infer<
  typeof payloadSchema
>;
export type BuilderClarificationAnswer = z.infer<typeof answeredQuestionSchema>;

export class BuilderClarificationContinuationTokenError extends Error {
  readonly code:
    | "clarification_continuation_token_invalid"
    | "clarification_continuation_secret_unavailable";
  override readonly cause: unknown;

  constructor(
    code:
      | "clarification_continuation_token_invalid"
      | "clarification_continuation_secret_unavailable",
    cause?: unknown,
  ) {
    super(
      code === "clarification_continuation_secret_unavailable"
        ? "Clarification is temporarily unavailable."
        : "This short clarification session is no longer available. Start again.",
    );
    this.name = "BuilderClarificationContinuationTokenError";
    this.code = code;
    this.cause = cause;
  }
}

const identitySchema = z
  .object({ businessId: z.uuid(), actorId: z.uuid() })
  .strict();

function nowSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

export interface BuilderClarificationContinuationTokenService {
  sign(input: {
    businessId: string;
    actorId: string;
    baseVersionId: string;
    headRevision: number;
    originalOwnerRequest: string;
    questions: readonly z.infer<typeof builderPlanQuestionSchema>[];
    answers: readonly BuilderClarificationAnswer[];
    round: number;
    selectedAdaptiveChoice?: {
      choice: BuilderAdaptiveSolutionChoiceResult;
      optionId: "work_from_primary" | "simplify_around_primary";
    };
  }): string;
  verify(
    token: string,
    identity: { businessId: string; actorId: string },
  ): BuilderClarificationContinuationPayload;
}

export function createBuilderClarificationContinuationTokenService(
  overrides: { secret?: string; now?: () => number } = {},
): BuilderClarificationContinuationTokenService {
  let envelope: ReturnType<typeof createOperationalConfirmationEnvelopeService>;
  try {
    envelope = createOperationalConfirmationEnvelopeService(overrides);
  } catch (cause) {
    throw new BuilderClarificationContinuationTokenError(
      "clarification_continuation_secret_unavailable",
      cause,
    );
  }
  const now = overrides.now ?? nowSeconds;

  return Object.freeze({
    sign(input: {
      businessId: string;
      actorId: string;
      baseVersionId: string;
      headRevision: number;
      originalOwnerRequest: string;
      questions: readonly z.infer<typeof builderPlanQuestionSchema>[];
      answers: readonly BuilderClarificationAnswer[];
      round: number;
      selectedAdaptiveChoice?: {
        choice: BuilderAdaptiveSolutionChoiceResult;
        optionId: "work_from_primary" | "simplify_around_primary";
      };
    }) {
      try {
        const issuedAt = now();
        const payload = payloadSchema.parse({
          schema_version: BUILDER_CLARIFICATION_CONTINUATION_SCHEMA_VERSION,
          action: BUILDER_CLARIFICATION_CONTINUATION_ACTION,
          base_version_id: input.baseVersionId,
          head_revision: input.headRevision,
          original_owner_request: input.originalOwnerRequest,
          questions: input.questions,
          answers: input.answers,
          round: input.round,
          ...(input.selectedAdaptiveChoice
            ? {
                selected_adaptive_choice: {
                  choice: input.selectedAdaptiveChoice.choice,
                  option_id: input.selectedAdaptiveChoice.optionId,
                },
              }
            : {}),
          issued_at: issuedAt,
          expires_at: issuedAt + OPERATIONAL_CONFIRMATION_TTL_SECONDS,
        });
        return envelope.sign({
          businessId: input.businessId,
          actorId: input.actorId,
          action: BUILDER_CLARIFICATION_CONTINUATION_ACTION,
          signingNamespace: "smbos-builder-clarification-v1",
          payload,
        });
      } catch (cause) {
        if (cause instanceof OperationalConfirmationEnvelopeError) {
          throw new BuilderClarificationContinuationTokenError(
            "clarification_continuation_secret_unavailable",
            cause,
          );
        }
        throw new BuilderClarificationContinuationTokenError(
          "clarification_continuation_token_invalid",
          cause,
        );
      }
    },

    verify(token: string, identity: { businessId: string; actorId: string }) {
      try {
        const trustedIdentity = identitySchema.parse(identity);
        return payloadSchema.parse(
          envelope.verify(token, trustedIdentity, {
            action: BUILDER_CLARIFICATION_CONTINUATION_ACTION,
            signingNamespace: "smbos-builder-clarification-v1",
          }),
        );
      } catch (cause) {
        if (
          cause instanceof OperationalConfirmationEnvelopeError &&
          cause.code === "confirmation_secret_unavailable"
        ) {
          throw new BuilderClarificationContinuationTokenError(
            "clarification_continuation_secret_unavailable",
            cause,
          );
        }
        throw new BuilderClarificationContinuationTokenError(
          "clarification_continuation_token_invalid",
          cause,
        );
      }
    },
  });
}

export function parseClarificationAnswers(
  payload: BuilderClarificationContinuationPayload,
  formData: FormData,
): readonly BuilderClarificationAnswer[] {
  const answers = payload.questions.map((question, index) => {
    const name = `clarificationAnswer_${index}`;
    const raw = formData
      .getAll(name)
      .filter((value): value is string => typeof value === "string");
    const options =
      question.response_style === "free_text" ? [] : question.options;
    let answer: string | string[];
    if (question.response_style === "free_text") {
      answer = z
        .string()
        .trim()
        .min(1)
        .max(BUILDER_CLARIFICATION_MAX_ANSWER_CHARACTERS)
        .parse(raw[0] ?? "");
    } else if (question.response_style === "single_choice") {
      answer = z
        .string()
        .trim()
        .min(1)
        .max(120)
        .parse(raw[0] ?? "");
      if (!options.includes(answer))
        throw new Error("An answer is no longer available.");
    } else {
      answer = z
        .array(z.string().trim().min(1).max(120))
        .min(1)
        .max(8)
        .parse(raw);
      if (answer.some((value) => !options.includes(value))) {
        throw new Error("An answer is no longer available.");
      }
    }
    return { question, answer };
  });
  return z
    .array(answeredQuestionSchema)
    .max(15)
    .parse([...payload.answers, ...answers]);
}

export function composeClarificationOwnerRequest(
  originalOwnerRequest: string,
  answers: readonly BuilderClarificationAnswer[],
): string {
  const composed = [
    "Original owner request:",
    originalOwnerRequest,
    "",
    "Clarification answers already established:",
    ...answers.flatMap((item) => [
      `Question: ${item.question.question}`,
      `Answer: ${typeof item.answer === "string" ? item.answer : item.answer.join(", ")}`,
    ]),
  ].join("\n");
  if (
    composed.length > BUILDER_CLARIFICATION_MAX_COMPOSED_REQUEST_CHARACTERS ||
    new TextEncoder().encode(composed).byteLength >
      BUILDER_CLARIFICATION_MAX_COMPOSED_REQUEST_BYTES
  ) {
    throw new BuilderClarificationContinuationTokenError(
      "clarification_continuation_token_invalid",
    );
  }
  return composed;
}
