import { z } from "zod";

export const BUILDER_UI_INPUT_INVALID_MESSAGE =
  "Describe what you would like SMBOS to build in 4,000 characters or fewer.";

export const BUILDER_UI_UNAVAILABLE_MESSAGES = Object.freeze({
  ai_disabled: "Builder is not enabled for this Business.",
  budget_reached: "This Business has reached its AI usage limit for today.",
  temporarily_unavailable:
    "Builder is temporarily unavailable. Your live Business setup has not changed.",
  stale:
    "Your Business changed while Builder was preparing this request. Review the current setup and submit the request again.",
  nothing_to_propose:
    "Builder did not find a configuration change to propose from this request.",
  could_not_prepare:
    "Builder could not prepare a safe proposal from this request. Your live Business setup has not changed.",
} as const);

export type BuilderUnavailableReason =
  keyof typeof BUILDER_UI_UNAVAILABLE_MESSAGES;

const boundedText = z.string().trim().min(1).max(5_000);
const clarificationQuestionBase = {
  question: boundedText,
  reason: boundedText,
};

const freeTextQuestionSchema = z
  .object({
    ...clarificationQuestionBase,
    response_style: z.literal("free_text"),
    options: z.array(z.string().trim().min(1).max(120)).length(0),
  })
  .strict();

const choiceQuestionSchema = z
  .object({
    ...clarificationQuestionBase,
    response_style: z.enum(["single_choice", "multiple_choice"]),
    options: z.array(z.string().trim().min(1).max(120)).min(2).max(8),
  })
  .strict();

const builderUiStateSchemas = [
  z.object({ state: z.literal("idle") }).strict(),
  z
    .object({
      state: z.literal("input_invalid"),
      message: z.literal(BUILDER_UI_INPUT_INVALID_MESSAGE),
    })
    .strict(),
  z
    .object({
      state: z.literal("needs_clarification"),
      understanding: z.string().trim().min(1).max(2_000),
      known_requirements: z.array(boundedText).max(20),
      assumptions: z
        .array(
          z
            .object({
              statement: boundedText,
              requires_owner_confirmation: z.boolean(),
            })
            .strict(),
        )
        .max(20),
      questions: z
        .array(
          z.discriminatedUnion("response_style", [
            freeTextQuestionSchema,
            choiceQuestionSchema,
          ]),
        )
        .min(1)
        .max(5),
      unsupported_requirements: z
        .array(
          z
            .object({
              requirement: boundedText,
              explanation: boundedText,
            })
            .strict(),
        )
        .max(20),
    })
    .strict(),
  z
    .object({
      state: z.literal("unsupported"),
      message: boundedText.max(240),
    })
    .strict(),
  z
    .object({
      state: z.literal("proposed"),
      proposal_id: z.uuid(),
      summary: boundedText,
      operation_count: z.number().int().min(1).max(100),
    })
    .strict(),
  z
    .object({
      state: z.literal("unavailable"),
      reason: z.enum([
        "ai_disabled",
        "budget_reached",
        "temporarily_unavailable",
        "stale",
        "nothing_to_propose",
        "could_not_prepare",
      ]),
      message: boundedText.max(240),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.message !== BUILDER_UI_UNAVAILABLE_MESSAGES[value.reason]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["message"],
          message: "The Builder unavailable message is not fixed.",
        });
      }
    }),
] as const;

export const builderUiStateSchema = z.discriminatedUnion(
  "state",
  builderUiStateSchemas,
);

export type BuilderUiState = z.infer<typeof builderUiStateSchema>;
export type BuilderResultUiState = Exclude<BuilderUiState, { state: "idle" }>;

export const BUILDER_INITIAL_STATE: BuilderUiState = Object.freeze({
  state: "idle",
});

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

export function freezeBuilderUiState<T extends BuilderUiState>(value: T): T {
  return deepFreeze(builderUiStateSchema.parse(value)) as T;
}
