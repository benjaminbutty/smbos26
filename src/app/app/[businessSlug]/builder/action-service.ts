import "server-only";

import { z } from "zod";

import {
  AiBusinessContextError,
  type AiBusinessContextErrorCode,
} from "../../../../ai/context/errors";
import {
  AiBuilderError,
  type AiBuilderErrorCode,
} from "../../../../ai/builder/errors";
import {
  builderOrchestrationResultSchema,
  type NeedsClarificationPlanningOutput,
  type BuilderOrchestrationResult,
} from "../../../../ai/builder/contracts";
import {
  AiExecutionError,
  type AiExecutionErrorCode,
} from "../../../../ai/errors";
import {
  BuilderConfigurationProposalError,
  type BuilderConfigurationProposalErrorCode,
} from "../../../../ai/configuration-proposal/errors";
import { BUILDER_PLAN_MAX_OWNER_REQUEST_CHARACTERS } from "../../../../ai/planning/schemas";
import {
  BUILDER_INITIAL_STATE,
  BUILDER_UI_INPUT_INVALID_MESSAGE,
  BUILDER_UI_UNAVAILABLE_MESSAGES,
  freezeBuilderUiState,
  type BuilderResultUiState,
  type BuilderUiState,
  type BuilderUnavailableReason,
} from "../../../../components/builder-ui-state";

export const builderRouteSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const ownerRequestSchema = z
  .string()
  .trim()
  .min(1)
  .max(BUILDER_PLAN_MAX_OWNER_REQUEST_CHARACTERS);

export function parseBuilderRouteSlug(value: unknown): string | null {
  const parsed = builderRouteSlugSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseBuilderOwnerRequest(
  formData: FormData,
): { success: true; ownerRequest: string } | { success: false } {
  const value = formData.get("ownerRequest");
  if (typeof value !== "string") {
    return { success: false };
  }
  const parsed = ownerRequestSchema.safeParse(value);
  if (!parsed.success) {
    return { success: false };
  }
  if (new TextEncoder().encode(parsed.data).byteLength > 16 * 1024) {
    return { success: false };
  }
  return { success: true, ownerRequest: parsed.data };
}

export function invalidBuilderInputState(): BuilderResultUiState {
  return freezeBuilderUiState({
    state: "input_invalid",
    message: BUILDER_UI_INPUT_INVALID_MESSAGE,
  });
}

function unavailableState(
  reason: BuilderUnavailableReason,
): BuilderResultUiState {
  return freezeBuilderUiState({
    state: "unavailable",
    reason,
    message: BUILDER_UI_UNAVAILABLE_MESSAGES[reason],
  });
}

function mapClarification(
  result: Extract<
    BuilderOrchestrationResult,
    { state: "needs_clarification" }
  > & {
    clarification: NeedsClarificationPlanningOutput;
  },
): BuilderResultUiState {
  const clarification = result.clarification;
  return freezeBuilderUiState({
    state: "needs_clarification",
    understanding: clarification.understanding,
    known_requirements: clarification.known_requirements,
    assumptions: clarification.assumptions.map(
      ({ statement, requires_owner_confirmation }) => ({
        statement,
        requires_owner_confirmation,
      }),
    ),
    questions: clarification.questions.map((question) => ({
      question: question.question,
      reason: question.reason,
      response_style: question.response_style,
      options: question.response_style === "free_text" ? [] : question.options,
    })),
    unsupported_requirements: clarification.unsupported_requirements.map(
      ({ requirement, explanation }) => ({ requirement, explanation }),
    ),
  });
}

export function mapBuilderOrchestrationResult(
  input: unknown,
): BuilderResultUiState {
  const result = builderOrchestrationResultSchema.parse(input);
  if (result.state === "needs_clarification") {
    return mapClarification(
      result as Extract<
        BuilderOrchestrationResult,
        { state: "needs_clarification" }
      > & {
        clarification: NeedsClarificationPlanningOutput;
      },
    );
  }
  if (result.state === "unsupported") {
    return freezeBuilderUiState({
      state: "unsupported",
      message: result.message,
    });
  }
  return freezeBuilderUiState({
    state: "proposed",
    proposal_id: result.proposal_id,
    summary: result.summary,
    operation_count: result.operation_count,
  });
}

type KnownBuilderErrorCode =
  | AiBuilderErrorCode
  | AiExecutionErrorCode
  | AiBusinessContextErrorCode
  | BuilderConfigurationProposalErrorCode;

function isKnownBuilderErrorCode(code: string): code is KnownBuilderErrorCode {
  return (
    code.startsWith("ai_builder_") ||
    code.startsWith("ai_") ||
    code.startsWith("ai_context_")
  );
}

export type BuilderActionErrorMapping =
  | { kind: "not_found" }
  | { kind: "state"; state: BuilderResultUiState }
  | { error: unknown; kind: "unexpected" };

export function mapBuilderActionError(
  error: unknown,
): BuilderActionErrorMapping {
  if (error instanceof AiBuilderError) {
    switch (error.code) {
      case "ai_builder_request_invalid":
        return { kind: "state", state: invalidBuilderInputState() };
      case "ai_builder_context_stale":
        return { kind: "state", state: unavailableState("stale") };
      case "ai_builder_runtime_invalid":
        return {
          kind: "state",
          state: unavailableState("temporarily_unavailable"),
        };
      case "ai_builder_internal_failed":
        return { kind: "state", state: unavailableState("could_not_prepare") };
      default:
        return { kind: "unexpected", error };
    }
  }

  if (error instanceof AiExecutionError) {
    switch (error.code) {
      case "ai_disabled":
        return { kind: "state", state: unavailableState("ai_disabled") };
      case "ai_budget_exceeded":
        return { kind: "state", state: unavailableState("budget_reached") };
      case "ai_rate_limited":
      case "ai_provider_unavailable":
      case "ai_timeout":
      case "ai_attempts_exhausted":
      case "ai_accounting_unavailable":
      case "ai_accounting_failed":
        return {
          kind: "state",
          state: unavailableState("temporarily_unavailable"),
        };
      case "ai_input_invalid":
      case "ai_input_too_large":
      case "ai_output_invalid":
      case "ai_refused":
      case "ai_incomplete":
      case "ai_content_filtered":
      case "ai_execution_failed":
      case "ai_task_not_found":
        return { kind: "state", state: unavailableState("could_not_prepare") };
      default:
        return { kind: "unexpected", error };
    }
  }

  if (error instanceof BuilderConfigurationProposalError) {
    switch (error.code) {
      case "ai_configuration_proposal_context_stale":
        return { kind: "state", state: unavailableState("stale") };
      case "ai_configuration_proposal_no_changes":
        return {
          kind: "state",
          state: unavailableState("nothing_to_propose"),
        };
      case "ai_configuration_proposal_request_invalid":
      case "ai_configuration_proposal_compile_failed":
      case "ai_configuration_proposal_failed":
        return { kind: "state", state: unavailableState("could_not_prepare") };
      default:
        return { kind: "unexpected", error };
    }
  }

  if (error instanceof AiBusinessContextError) {
    switch (error.code) {
      case "ai_context_unauthorized":
      case "ai_context_not_found":
        return { kind: "not_found" };
      case "ai_context_too_large":
      case "ai_context_failed":
        return {
          kind: "state",
          state: unavailableState("temporarily_unavailable"),
        };
      case "ai_context_inconsistent":
        return { kind: "state", state: unavailableState("could_not_prepare") };
      default:
        return { kind: "unexpected", error };
    }
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    isKnownBuilderErrorCode(error.code)
  ) {
    return { kind: "unexpected", error };
  }

  return { kind: "unexpected", error };
}

export function mapBuilderActionResult(input: unknown): BuilderUiState {
  return mapBuilderOrchestrationResult(input);
}

export function initialBuilderUiState(): BuilderUiState {
  return BUILDER_INITIAL_STATE;
}
