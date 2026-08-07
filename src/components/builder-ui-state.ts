import { z } from "zod";

import {
  BUILDER_RECORD_LOCATION_MESSAGES,
  BUILDER_RECORD_LOCATION_REASON_CODES,
  BUILDER_RECORD_LOCATION_SUCCESS_MESSAGES,
  BUILDER_RECORD_UPDATE_MESSAGES,
} from "../ai/builder/contracts";

export const BUILDER_UI_INPUT_INVALID_MESSAGE =
  "Describe what you would like SMBOS to build in 4,000 characters or fewer.";
export const BUILDER_UI_CONTEXT_REQUIRED_MESSAGE =
  'To undo the latest setup change, open its applied Change or active Version and choose "Undo this change in Builder."';

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

export const BUILDER_UI_LOCATION_ACTIVE_DUPLICATE_MESSAGE =
  "That Location is already active. Review Locations to use the existing Location.";
export const BUILDER_UI_LOCATION_INACTIVE_DUPLICATE_MESSAGE =
  "That Location already exists but is inactive. Review Locations; Builder will not reactivate or rename it.";
export const BUILDER_UI_LOCATION_CREATED_MESSAGE =
  "The Location was added to your Business.";
export const BUILDER_UI_RECORD_UPDATED_MESSAGE = "The Record was updated.";
export const BUILDER_UI_RECORD_UPDATED_NO_VIEW_MESSAGE =
  "The Record was updated. No generated screen is currently configured for this information type.";
export const BUILDER_UI_RECORD_UPDATE_NOT_FOUND_MESSAGE =
  "No active Record matched those exact current details. Check the current value and submit the request again.";
export const BUILDER_UI_RECORD_UPDATE_AMBIGUOUS_MESSAGE =
  BUILDER_RECORD_UPDATE_MESSAGES.ambiguous;
export const BUILDER_UI_RECORD_UPDATE_INELIGIBLE_MESSAGE =
  "This type of Record cannot be changed through Builder safely. Use its existing operating screen.";
export const BUILDER_UI_RECORD_UPDATE_NO_CHANGE_MESSAGE =
  "This Record already has those values.";
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
      state: z.literal("context_required"),
      message: z.literal(BUILDER_UI_CONTEXT_REQUIRED_MESSAGE),
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
  z
    .object({
      state: z.literal("location_confirmation"),
      confirmation_token: z
        .string()
        .trim()
        .min(1)
        .max(64 * 1024),
      location_name: boundedText.max(120),
      timezone: z.string().trim().min(1).max(80),
      timezone_source: z.enum(["business_timezone", "explicit_timezone"]),
    })
    .strict(),
  z
    .object({
      state: z.literal("record_confirmation"),
      confirmation_token: z
        .string()
        .trim()
        .min(1)
        .max(64 * 1024),
      object_label: boundedText.max(120),
      explicit_fields: z
        .array(
          z
            .object({
              label: boundedText.max(120),
              formatted_value: boundedText,
              source: z.literal("explicit"),
            })
            .strict(),
        )
        .min(1)
        .max(50),
      default_fields: z
        .array(
          z
            .object({
              label: boundedText.max(120),
              formatted_value: boundedText,
              source: z.literal("default"),
            })
            .strict(),
        )
        .max(100),
    })
    .strict(),
  z
    .object({
      state: z.literal("record_update_confirmation"),
      confirmation_token: z
        .string()
        .trim()
        .min(1)
        .max(64 * 1024),
      object_label: boundedText.max(120),
      selector_presentation: z
        .object({
          label: boundedText.max(120),
          formatted_value: boundedText,
        })
        .strict(),
      change_rows: z
        .array(
          z
            .object({
              label: boundedText.max(120),
              formatted_before: boundedText,
              formatted_after: boundedText,
            })
            .strict(),
        )
        .min(1)
        .max(5),
    })
    .strict(),
  z
    .object({
      state: z.literal("record_location_confirmation"),
      confirmation_token: z
        .string()
        .trim()
        .min(1)
        .max(64 * 1024),
      action: z.enum(["link", "unlink"]),
      object_label: boundedText.max(120),
      location_name: boundedText.max(120),
      selector_presentation: z
        .object({
          label: boundedText.max(120),
          formatted_value: boundedText,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      state: z.literal("location_conflict"),
      location_name: boundedText.max(120),
      duplicate_kind: z.enum(["active", "inactive"]),
      message: z.union([
        z.literal(BUILDER_UI_LOCATION_ACTIVE_DUPLICATE_MESSAGE),
        z.literal(BUILDER_UI_LOCATION_INACTIVE_DUPLICATE_MESSAGE),
      ]),
    })
    .strict()
    .superRefine((value, context) => {
      const expected =
        value.duplicate_kind === "active"
          ? BUILDER_UI_LOCATION_ACTIVE_DUPLICATE_MESSAGE
          : BUILDER_UI_LOCATION_INACTIVE_DUPLICATE_MESSAGE;
      if (value.message !== expected) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["message"],
          message: "The Location conflict message is not fixed.",
        });
      }
    }),
  z
    .object({
      state: z.literal("location_created"),
      location_name: boundedText.max(120),
      timezone: z.string().trim().min(1).max(80),
      message: z.literal(BUILDER_UI_LOCATION_CREATED_MESSAGE),
    })
    .strict(),
  z
    .object({
      state: z.literal("record_created"),
      object_label: boundedText.max(120),
      message: boundedText.max(240),
      destination_path: z
        .string()
        .trim()
        .min(1)
        .max(2_048)
        .regex(/^\/app\/[a-z0-9-]+\/workspace\//)
        .optional(),
    })
    .strict(),
  z
    .object({
      state: z.literal("record_updated"),
      object_label: boundedText.max(120),
      message: z.union([
        z.literal(BUILDER_UI_RECORD_UPDATED_MESSAGE),
        z.literal(BUILDER_UI_RECORD_UPDATED_NO_VIEW_MESSAGE),
      ]),
      destination_path: z
        .string()
        .trim()
        .min(1)
        .max(2_048)
        .regex(/^\/app\/[a-z0-9-]+\/workspace\//)
        .optional(),
    })
    .strict()
    .superRefine((value, context) => {
      if (
        value.destination_path &&
        value.message !== BUILDER_UI_RECORD_UPDATED_MESSAGE
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["message"],
          message:
            "A generated destination requires the standard update message.",
        });
      }
    }),
  z
    .object({
      state: z.literal("record_update_not_found"),
      object_label: boundedText.max(120),
      message: z.literal(BUILDER_UI_RECORD_UPDATE_NOT_FOUND_MESSAGE),
    })
    .strict(),
  z
    .object({
      state: z.literal("record_update_ambiguous"),
      object_label: boundedText.max(120),
      message: z.literal(BUILDER_UI_RECORD_UPDATE_AMBIGUOUS_MESSAGE),
    })
    .strict(),
  z
    .object({
      state: z.literal("record_update_ineligible"),
      object_label: boundedText.max(120),
      message: z.literal(BUILDER_UI_RECORD_UPDATE_INELIGIBLE_MESSAGE),
    })
    .strict(),
  z
    .object({
      state: z.literal("record_update_no_change"),
      object_label: boundedText.max(120),
      message: z.literal(BUILDER_UI_RECORD_UPDATE_NO_CHANGE_MESSAGE),
    })
    .strict(),
  z
    .object({
      state: z.literal("record_location_unavailable"),
      object_label: boundedText.max(120),
      reason_code: z.enum(BUILDER_RECORD_LOCATION_REASON_CODES),
      message: boundedText.max(240),
    })
    .strict()
    .superRefine((value, context) => {
      if (
        value.message !== BUILDER_RECORD_LOCATION_MESSAGES[value.reason_code]
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["message"],
          message: "The Record Location unavailable message is not fixed.",
        });
      }
    }),
  z
    .object({
      state: z.literal("record_location_updated"),
      action: z.enum(["link", "unlink"]),
      object_label: boundedText.max(120),
      location_name: boundedText.max(120),
      message: boundedText.max(240),
      destination_path: z
        .string()
        .trim()
        .min(1)
        .max(2_048)
        .regex(/^\/app\/[a-z0-9-]+\/workspace\//)
        .optional(),
    })
    .strict()
    .superRefine((value, context) => {
      if (
        value.message !== BUILDER_RECORD_LOCATION_SUCCESS_MESSAGES[value.action]
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["message"],
          message: "The Record Location success message is not fixed.",
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
