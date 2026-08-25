import "server-only";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { notFound } from "next/navigation";
import { z } from "zod";

import { builderOrchestrationService } from "../../../../ai/builder/service";
import {
  AiBusinessContextError,
  type AiBusinessContextErrorCode,
} from "../../../../ai/context/errors";
import {
  AiBuilderError,
  type AiBuilderErrorCode,
} from "../../../../ai/builder/errors";
import {
  BUILDER_RECORD_LOCATION_MESSAGES,
  BUILDER_RECORD_LOCATION_SUCCESS_MESSAGES,
  BUILDER_RECORD_UPDATE_MESSAGES,
  builderOrchestrationResultSchema,
  type BuilderAdaptiveSolutionChoiceResult,
  type BuilderRecordLocationReasonCode,
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
import {
  BuilderPreorderAmendmentProposalError,
  type BuilderPreorderAmendmentProposalErrorCode,
} from "../../../../ai/preorder-amendment/errors";
import {
  LocationConfirmationTokenError,
  createLocationConfirmationTokenService,
  type LocationConfirmationTokenService,
} from "../../../../ai/builder/location-confirmation-token";
import {
  createRecordConfirmationTokenService,
  RecordConfirmationTokenError,
  type RecordConfirmationTokenService,
} from "../../../../ai/builder/record-confirmation-token";
import {
  createRecordUpdateConfirmationTokenService,
  RecordUpdateConfirmationTokenError,
  type RecordUpdateConfirmationTokenService,
} from "../../../../ai/builder/record-update-confirmation-token";
import {
  createRecordLocationConfirmationTokenService,
  RecordLocationConfirmationTokenError,
  type RecordLocationConfirmationTokenService,
} from "../../../../ai/builder/record-location-confirmation-token";
import {
  BuilderClarificationContinuationTokenError,
  BUILDER_CLARIFICATION_MAX_ROUNDS,
  composeClarificationOwnerRequest,
  createBuilderClarificationContinuationTokenService,
  parseClarificationAnswers,
  type BuilderClarificationAnswer,
  type BuilderClarificationContinuationTokenService,
} from "../../../../ai/builder/clarification-continuation-token";
import {
  BuilderAdaptiveSolutionChoiceTokenError,
  createBuilderAdaptiveSolutionChoiceTokenService,
  type BuilderAdaptiveSolutionChoiceTokenService,
} from "../../../../ai/builder/adaptive-solution-choice-token";
import {
  createLocationService,
  LocationServiceError,
} from "../../../../core/locations/service";
import { composeConfirmedGraphRecordData } from "../../../../core/graph/record-creation/composer";
import {
  createConfirmedRecordCreationService,
  RecordCreationServiceError,
} from "../../../../core/graph/record-creation/service";
import {
  createConfirmedRecordUpdateService,
  RecordUpdateServiceError,
} from "../../../../core/graph/record-update/service";
import {
  createRecordLocationLinkService,
  RecordLocationLinkError,
} from "../../../../core/graph/location-links";
import { experienceKeyToPath } from "../../../../runtime/routing";
import {
  BUILDER_UI_CLARIFICATION_EXPIRED_MESSAGE,
  BUILDER_UI_CLARIFICATION_LIMIT_REACHED_MESSAGE,
  BUILDER_INITIAL_STATE,
  BUILDER_UI_CONTEXT_REQUIRED_MESSAGE,
  BUILDER_UI_INPUT_INVALID_MESSAGE,
  BUILDER_UI_UNAVAILABLE_MESSAGES,
  BUILDER_UI_LOCATION_ACTIVE_DUPLICATE_MESSAGE,
  BUILDER_UI_LOCATION_INACTIVE_DUPLICATE_MESSAGE,
  BUILDER_UI_LOCATION_CREATED_MESSAGE,
  freezeBuilderUiState,
  type BuilderResultUiState,
  type BuilderUiState,
  type BuilderUnavailableReason,
} from "../../../../components/builder-ui-state";
import { hasCapability, resolveTenant } from "../../../../auth/authorization";
import { createServerClient } from "../../../../db/supabase/server";

export const builderRouteSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const ownerRequestSchema = z.string().trim().min(1).max(4_000);

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

type BuilderTenantDependencies = {
  notFound: typeof notFound;
  resolveTenant: typeof resolveTenant;
};

const productionBuilderTenantDependencies: BuilderTenantDependencies = {
  notFound,
  resolveTenant,
};

function redirectDestination(error: unknown): string | null {
  if (error instanceof Error && error.name === "ActionRedirect") {
    return error.message;
  }
  if (!isRedirectError(error)) {
    return null;
  }
  return error.digest.split(";").slice(2, -2).join(";");
}

function isUnauthenticatedRedirect(error: unknown): boolean {
  return redirectDestination(error) === "/sign-in";
}

export async function resolveBuilderTenant(
  businessSlug: string,
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  overrides: Partial<BuilderTenantDependencies> = {},
) {
  const dependencies = {
    ...productionBuilderTenantDependencies,
    ...overrides,
  };
  try {
    return await dependencies.resolveTenant(businessSlug, supabase);
  } catch (error) {
    if (isUnauthenticatedRedirect(error)) {
      dependencies.notFound();
    }
    throw error;
  }
}

export function invalidBuilderInputState(): BuilderResultUiState {
  return freezeBuilderUiState({
    state: "input_invalid",
    message: BUILDER_UI_INPUT_INVALID_MESSAGE,
  });
}

export function contextRequiredBuilderState(): BuilderResultUiState {
  return freezeBuilderUiState({
    state: "context_required",
    message: BUILDER_UI_CONTEXT_REQUIRED_MESSAGE,
  });
}

function clarificationExpiredState(): BuilderResultUiState {
  return freezeBuilderUiState({
    state: "clarification_expired",
    message: BUILDER_UI_CLARIFICATION_EXPIRED_MESSAGE,
  });
}

function clarificationLimitReachedState(): BuilderResultUiState {
  return freezeBuilderUiState({
    state: "clarification_limit_reached",
    message: BUILDER_UI_CLARIFICATION_LIMIT_REACHED_MESSAGE,
  });
}

export function isUncontextualizedUndoPhrase(ownerRequest: string): boolean {
  return /^undo that[.!?]*$/i.test(ownerRequest.trim());
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

function recordLocationUnavailableState(
  reasonCode: BuilderRecordLocationReasonCode,
  objectLabel = "Record",
): BuilderResultUiState {
  return freezeBuilderUiState({
    state: "record_location_unavailable",
    object_label: objectLabel,
    reason_code: reasonCode,
    message: BUILDER_RECORD_LOCATION_MESSAGES[reasonCode],
  });
}

function mapClarification(
  result: Extract<
    BuilderOrchestrationResult,
    { state: "needs_clarification" }
  > & {
    clarification: NeedsClarificationPlanningOutput;
  },
  continuation?: {
    tokenService: BuilderClarificationContinuationTokenService;
    businessId: string;
    actorId: string;
    originalOwnerRequest: string;
    answers: readonly BuilderClarificationAnswer[];
    round: number;
    selectedAdaptiveChoice?: {
      choice: BuilderAdaptiveSolutionChoiceResult;
      optionId: "work_from_primary" | "simplify_around_primary";
    };
  },
): BuilderResultUiState {
  const clarification = result.clarification;
  const continuationToken =
    continuation && result.base_version_id && result.head_revision
      ? continuation.tokenService.sign({
          businessId: continuation.businessId,
          actorId: continuation.actorId,
          baseVersionId: result.base_version_id,
          headRevision: result.head_revision,
          originalOwnerRequest: continuation.originalOwnerRequest,
          questions: clarification.questions,
          answers: continuation.answers,
          round: continuation.round,
          ...(continuation.selectedAdaptiveChoice
            ? { selectedAdaptiveChoice: continuation.selectedAdaptiveChoice }
            : {}),
        })
      : undefined;
  const clarificationRound = continuationToken
    ? continuation?.round
    : undefined;
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
    ...(continuationToken && clarificationRound
      ? {
          continuation_token: continuationToken,
          clarification_round: clarificationRound,
        }
      : {}),
  });
}

export function mapBuilderOrchestrationResult(
  input: unknown,
  confirmation?: {
    businessId: string;
    actorId: string;
    tokenService?: LocationConfirmationTokenService;
    recordTokenService?: RecordConfirmationTokenService;
    recordUpdateTokenService?: RecordUpdateConfirmationTokenService;
    recordLocationTokenService?: RecordLocationConfirmationTokenService;
    clarificationTokenService?: BuilderClarificationContinuationTokenService;
    adaptiveSolutionChoiceTokenService?: BuilderAdaptiveSolutionChoiceTokenService;
    originalOwnerRequest?: string;
    clarificationAnswers?: readonly BuilderClarificationAnswer[];
    clarificationRound?: number;
    selectedAdaptiveChoice?: {
      choice: BuilderAdaptiveSolutionChoiceResult;
      optionId: "work_from_primary" | "simplify_around_primary";
    };
  },
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
      confirmation?.clarificationTokenService &&
        confirmation.originalOwnerRequest !== undefined
        ? {
            tokenService: confirmation.clarificationTokenService,
            businessId: confirmation.businessId,
            actorId: confirmation.actorId,
            originalOwnerRequest: confirmation.originalOwnerRequest,
            answers: confirmation.clarificationAnswers ?? [],
            round: confirmation.clarificationRound ?? 1,
            ...(confirmation.selectedAdaptiveChoice
              ? { selectedAdaptiveChoice: confirmation.selectedAdaptiveChoice }
              : {}),
          }
        : undefined,
    );
  }
  if (result.state === "adaptive_solution_choice") {
    if (!confirmation?.adaptiveSolutionChoiceTokenService) {
      return unavailableState("temporarily_unavailable");
    }
    return freezeBuilderUiState({
      state: "adaptive_solution_choice",
      understanding: result.understanding,
      current_approach: result.current_approach,
      options: result.options.map(
        ({ id, label, summary, benefits, tradeoffs }) => ({
          id,
          label,
          summary,
          benefits,
          tradeoffs,
        }),
      ),
      ...(result.recommendation
        ? { recommendation: result.recommendation }
        : {}),
      question: result.question,
      continuation_token: confirmation.adaptiveSolutionChoiceTokenService.sign({
        businessId: confirmation.businessId,
        actorId: confirmation.actorId,
        originalOwnerRequest:
          confirmation.originalOwnerRequest ?? "Your request",
        choice: result,
      }),
    });
  }
  if (result.state === "unsupported") {
    return freezeBuilderUiState({
      state: "unsupported",
      message: result.message,
    });
  }
  if (result.state === "location_confirmation") {
    if (!confirmation?.tokenService) {
      return unavailableState("temporarily_unavailable");
    }
    return freezeBuilderUiState({
      state: "location_confirmation",
      confirmation_token: confirmation.tokenService.sign({
        businessId: confirmation.businessId,
        actorId: confirmation.actorId,
        locationName: result.location_name,
        timezone: result.timezone,
        timezoneSource: result.timezone_source,
        businessTimezone: result.business_timezone,
        locationStateDigest: result.location_state_digest,
      }),
      location_name: result.location_name,
      timezone: result.timezone,
      timezone_source: result.timezone_source,
    });
  }
  if (result.state === "record_confirmation") {
    if (!confirmation?.recordTokenService) {
      return unavailableState("temporarily_unavailable");
    }
    return freezeBuilderUiState({
      state: "record_confirmation",
      confirmation_token: confirmation.recordTokenService.sign({
        businessId: confirmation.businessId,
        actorId: confirmation.actorId,
        baseVersionId: result.base_version_id,
        headRevision: result.head_revision,
        objectKey: result.object_key,
        objectSchemaDigest: result.object_schema_digest,
        recordStateDigest: result.record_state_digest,
        fieldValues: result.field_values,
      }),
      object_label: result.object_label,
      explicit_fields: result.explicit_fields.map(
        ({ label, formatted_value }) => ({
          label,
          formatted_value,
          source: "explicit" as const,
        }),
      ),
      default_fields: result.default_fields.map(
        ({ label, formatted_value }) => ({
          label,
          formatted_value,
          source: "default" as const,
        }),
      ),
    });
  }
  if (result.state === "record_update_confirmation") {
    if (!confirmation?.recordUpdateTokenService) {
      return unavailableState("temporarily_unavailable");
    }
    return freezeBuilderUiState({
      state: "record_update_confirmation",
      confirmation_token: confirmation.recordUpdateTokenService.sign({
        businessId: confirmation.businessId,
        actorId: confirmation.actorId,
        baseVersionId: result.base_version_id,
        headRevision: result.head_revision,
        objectDefinitionId: result.object_definition_id,
        objectKey: result.object_key,
        targetRecordId: result.target_record_id,
        expectedRecordCurrentness: {
          updatedAt: result.expected_updated_at,
        },
        dataPatch: result.data_patch,
        destinationViewKey: result.destination_view_key,
      }),
      object_label: result.object_label,
      selector_presentation: {
        label: result.selector_presentation.label,
        formatted_value: result.selector_presentation.formatted_value,
      },
      change_rows: result.change_rows.map(
        ({ label, formatted_before, formatted_after }) => ({
          label,
          formatted_before,
          formatted_after,
        }),
      ),
    });
  }
  if (result.state === "record_location_confirmation") {
    if (!confirmation?.recordLocationTokenService) {
      return unavailableState("temporarily_unavailable");
    }
    return freezeBuilderUiState({
      state: "record_location_confirmation",
      confirmation_token: confirmation.recordLocationTokenService.sign({
        businessId: confirmation.businessId,
        actorId: confirmation.actorId,
        objectDefinitionId: result.object_definition_id,
        objectKey: result.object_key,
        targetRecordId: result.target_record_id,
        targetLocationId: result.target_location_id,
        action: result.action,
        expectedPairState: result.expected_pair_state,
        destinationViewKey: result.destination_view_key,
      }),
      action: result.action,
      object_label: result.object_label,
      location_name: result.location_name,
      selector_presentation: result.selector_presentation,
    });
  }
  if (result.state === "record_update_not_found") {
    return freezeBuilderUiState({
      state: "record_update_not_found",
      object_label: result.object_label,
      message: result.message,
    });
  }
  if (result.state === "record_update_ambiguous") {
    return freezeBuilderUiState({
      state: "record_update_ambiguous",
      object_label: result.object_label,
      message: result.message,
    });
  }
  if (result.state === "record_update_ineligible") {
    return freezeBuilderUiState({
      state: "record_update_ineligible",
      object_label: result.object_label,
      message: result.message,
    });
  }
  if (result.state === "record_update_no_change") {
    return freezeBuilderUiState({
      state: "record_update_no_change",
      object_label: result.object_label,
      message: result.message,
    });
  }
  if (result.state === "record_location_unavailable") {
    return recordLocationUnavailableState(
      result.reason_code,
      result.object_label,
    );
  }
  if (result.state === "location_conflict") {
    return freezeBuilderUiState({
      state: "location_conflict",
      location_name: result.location_name,
      duplicate_kind: result.duplicate_kind,
      message:
        result.duplicate_kind === "active"
          ? BUILDER_UI_LOCATION_ACTIVE_DUPLICATE_MESSAGE
          : BUILDER_UI_LOCATION_INACTIVE_DUPLICATE_MESSAGE,
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
  | BuilderConfigurationProposalErrorCode
  | BuilderPreorderAmendmentProposalErrorCode;

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
  if (error instanceof BuilderClarificationContinuationTokenError) {
    return {
      kind: "state",
      state:
        error.code === "clarification_continuation_secret_unavailable"
          ? unavailableState("temporarily_unavailable")
          : clarificationExpiredState(),
    };
  }

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

  if (error instanceof BuilderPreorderAmendmentProposalError) {
    switch (error.code) {
      case "ai_preorder_amendment_context_stale":
        return { kind: "state", state: unavailableState("stale") };
      case "ai_preorder_amendment_no_changes":
        return {
          kind: "state",
          state: unavailableState("nothing_to_propose"),
        };
      case "ai_preorder_amendment_request_invalid":
      case "ai_preorder_amendment_failed":
        return { kind: "state", state: unavailableState("could_not_prepare") };
      default:
        return { kind: "unexpected", error };
    }
  }

  if (error instanceof LocationConfirmationTokenError) {
    return {
      kind: "state",
      state: unavailableState(
        error.code === "location_confirmation_secret_unavailable"
          ? "temporarily_unavailable"
          : "stale",
      ),
    };
  }

  if (error instanceof RecordConfirmationTokenError) {
    return {
      kind: "state",
      state: unavailableState(
        error.code === "record_confirmation_secret_unavailable"
          ? "temporarily_unavailable"
          : "stale",
      ),
    };
  }

  if (error instanceof RecordUpdateConfirmationTokenError) {
    return {
      kind: "state",
      state: unavailableState(
        error.code === "record_update_confirmation_secret_unavailable"
          ? "temporarily_unavailable"
          : "stale",
      ),
    };
  }

  if (error instanceof RecordLocationConfirmationTokenError) {
    return {
      kind: "state",
      state: unavailableState(
        error.code === "record_location_confirmation_secret_unavailable"
          ? "temporarily_unavailable"
          : "stale",
      ),
    };
  }

  if (error instanceof RecordCreationServiceError) {
    switch (error.code) {
      case "record_creation_authentication_required":
      case "record_creation_actor_context_mismatch":
      case "record_creation_owner_or_admin_required":
      case "record_creation_business_not_found":
      case "record_creation_object_not_found":
        return { kind: "not_found" };
      case "record_creation_configuration_changed":
      case "record_creation_schema_changed":
      case "record_creation_state_changed":
      case "record_creation_object_ineligible":
        return { kind: "state", state: unavailableState("stale") };
      case "record_creation_data_invalid":
        return { kind: "state", state: unavailableState("could_not_prepare") };
      case "record_creation_failed":
      case "record_creation_response_invalid":
        return {
          kind: "state",
          state: unavailableState("temporarily_unavailable"),
        };
    }
  }

  if (error instanceof RecordUpdateServiceError) {
    switch (error.code) {
      case "record_update_authentication_required":
      case "record_update_actor_context_mismatch":
      case "record_update_owner_or_admin_required":
      case "record_update_business_not_found":
      case "record_update_object_not_found":
        return { kind: "not_found" };
      case "record_update_selector_not_found":
        return {
          kind: "state",
          state: freezeBuilderUiState({
            state: "record_update_not_found",
            object_label: "Record",
            message:
              "No active Record matched those exact current details. Check the current value and submit the request again.",
          }),
        };
      case "record_update_selector_ambiguous":
        return {
          kind: "state",
          state: freezeBuilderUiState({
            state: "record_update_ambiguous",
            object_label: "Record",
            message: BUILDER_RECORD_UPDATE_MESSAGES.ambiguous,
          }),
        };
      case "record_update_no_change":
        return {
          kind: "state",
          state: freezeBuilderUiState({
            state: "record_update_no_change",
            object_label: "Record",
            message: "This Record already has those values.",
          }),
        };
      case "record_update_configuration_changed":
      case "record_update_state_changed":
      case "record_update_target_changed":
      case "record_update_target_archived":
        return { kind: "state", state: unavailableState("stale") };
      case "record_update_object_ineligible":
      case "record_update_selector_invalid":
      case "record_update_patch_invalid":
        return { kind: "state", state: unavailableState("could_not_prepare") };
      case "record_update_failed":
      case "record_update_response_invalid":
        return {
          kind: "state",
          state: unavailableState("temporarily_unavailable"),
        };
    }
  }

  if (error instanceof LocationServiceError) {
    switch (error.code) {
      case "location_creation_state_changed":
        return { kind: "state", state: unavailableState("stale") };
      case "location_active_duplicate":
      case "location_inactive_duplicate":
        return {
          kind: "state",
          state: freezeBuilderUiState({
            state: "location_conflict",
            location_name: "That Location",
            duplicate_kind:
              error.code === "location_active_duplicate"
                ? "active"
                : "inactive",
            message:
              error.code === "location_active_duplicate"
                ? BUILDER_UI_LOCATION_ACTIVE_DUPLICATE_MESSAGE
                : BUILDER_UI_LOCATION_INACTIVE_DUPLICATE_MESSAGE,
          }),
        };
      case "location_authentication_required":
      case "location_actor_context_mismatch":
      case "location_owner_or_admin_required":
      case "location_business_not_found":
        return { kind: "not_found" };
      case "location_name_invalid":
      case "location_timezone_invalid":
        return { kind: "state", state: unavailableState("could_not_prepare") };
      case "location_creation_failed":
      case "location_response_invalid":
        return {
          kind: "state",
          state: unavailableState("temporarily_unavailable"),
        };
    }
  }

  if (error instanceof RecordLocationLinkError) {
    switch (error.code) {
      case "record_location_link_authentication_required":
      case "record_location_link_actor_context_mismatch":
      case "record_location_link_owner_or_admin_required":
      case "record_location_link_object_not_found":
        return { kind: "not_found" };
      case "record_location_link_location_not_found":
        return {
          kind: "state",
          state: recordLocationUnavailableState("location_not_found"),
        };
      case "record_location_link_selector_not_found":
        return {
          kind: "state",
          state: recordLocationUnavailableState("record_not_found"),
        };
      case "record_location_link_selector_ambiguous":
        return {
          kind: "state",
          state: recordLocationUnavailableState("record_ambiguous"),
        };
      case "record_location_link_object_ineligible":
        return {
          kind: "state",
          state: recordLocationUnavailableState("record_ineligible"),
        };
      case "record_location_link_location_inactive":
        return {
          kind: "state",
          state: recordLocationUnavailableState("location_inactive"),
        };
      case "record_location_link_state_changed":
      case "record_location_link_configuration_changed":
      case "record_location_link_target_changed":
        return { kind: "state", state: unavailableState("stale") };
      case "record_location_link_action_invalid":
      case "record_location_link_selector_invalid":
      case "record_location_link_response_invalid":
        return { kind: "state", state: unavailableState("could_not_prepare") };
      case "record_location_link_pair_exists":
      case "record_location_link_not_found":
      case "record_location_link_failed":
        return {
          kind: "state",
          state: unavailableState("temporarily_unavailable"),
        };
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

type BuilderOrchestrationService = Pick<
  typeof builderOrchestrationService,
  "run"
>;

export type BuilderActionDependencies = {
  createServerClient: typeof createServerClient;
  hasCapability: typeof hasCapability;
  notFound: typeof notFound;
  orchestrationService: BuilderOrchestrationService;
  resolveTenant: typeof resolveTenant;
  createLocationService: typeof createLocationService;
  createLocationConfirmationTokenService: typeof createLocationConfirmationTokenService;
  createRecordConfirmationTokenService: typeof createRecordConfirmationTokenService;
  createRecordUpdateConfirmationTokenService: typeof createRecordUpdateConfirmationTokenService;
  createRecordLocationConfirmationTokenService: typeof createRecordLocationConfirmationTokenService;
  createClarificationContinuationTokenService: typeof createBuilderClarificationContinuationTokenService;
  createAdaptiveSolutionChoiceTokenService: typeof createBuilderAdaptiveSolutionChoiceTokenService;
  createConfirmedRecordCreationService: typeof createConfirmedRecordCreationService;
  createConfirmedRecordUpdateService: typeof createConfirmedRecordUpdateService;
  createRecordLocationLinkService: typeof createRecordLocationLinkService;
};

const productionBuilderActionDependencies: BuilderActionDependencies = {
  createServerClient,
  hasCapability,
  notFound,
  orchestrationService: builderOrchestrationService,
  resolveTenant,
  createLocationService,
  createLocationConfirmationTokenService,
  createRecordConfirmationTokenService,
  createRecordUpdateConfirmationTokenService,
  createRecordLocationConfirmationTokenService,
  createClarificationContinuationTokenService:
    createBuilderClarificationContinuationTokenService,
  createAdaptiveSolutionChoiceTokenService:
    createBuilderAdaptiveSolutionChoiceTokenService,
  createConfirmedRecordCreationService,
  createConfirmedRecordUpdateService,
  createRecordLocationLinkService,
};

function confirmationTokenFormValue(formData: FormData): string | null {
  if (!formData.has("confirmationToken")) {
    return null;
  }
  const value = formData.get("confirmationToken");
  return typeof value === "string" && value.trim() ? value : "";
}

function recordUpdateConfirmationTokenFormValue(
  formData: FormData,
): string | null {
  if (!formData.has("recordUpdateConfirmationToken")) {
    return null;
  }
  const value = formData.get("recordUpdateConfirmationToken");
  return typeof value === "string" && value.trim() ? value : "";
}

function recordLocationConfirmationTokenFormValue(
  formData: FormData,
): string | null {
  if (!formData.has("recordLocationConfirmationToken")) {
    return null;
  }
  const value = formData.get("recordLocationConfirmationToken");
  return typeof value === "string" && value.trim() ? value : "";
}

function clarificationContinuationTokenFormValue(
  formData: FormData,
): string | null {
  if (!formData.has("clarificationContinuationToken")) {
    return null;
  }
  const value = formData.get("clarificationContinuationToken");
  return typeof value === "string" && value.trim() ? value : "";
}

function adaptiveSolutionChoiceTokenFormValue(
  formData: FormData,
): string | null {
  if (!formData.has("adaptiveSolutionChoiceToken")) return null;
  const value = formData.get("adaptiveSolutionChoiceToken");
  return typeof value === "string" && value.trim() ? value : "";
}

function adaptiveSolutionOptionFormValue(
  formData: FormData,
): "work_from_primary" | "simplify_around_primary" | null {
  const value = formData.get("adaptiveSolutionOption");
  return value === "work_from_primary" || value === "simplify_around_primary"
    ? value
    : null;
}

function confirmationKindFormValue(
  formData: FormData,
): "create_location" | "create_record" {
  const value = formData.get("confirmationKind");
  return value === "create_record" ? "create_record" : "create_location";
}

async function executeRecordLocationConfirmation(
  dependencies: BuilderActionDependencies,
  businessSlug: string,
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  formData: FormData,
): Promise<BuilderUiState> {
  const token = recordLocationConfirmationTokenFormValue(formData);
  if (!token) return unavailableState("stale");
  const tenant = await resolveBuilderTenant(businessSlug, supabase, {
    notFound: dependencies.notFound,
    resolveTenant: dependencies.resolveTenant,
  });
  if (!dependencies.hasCapability(tenant.membership.role, "manage_locations")) {
    dependencies.notFound();
  }

  try {
    const payload = dependencies
      .createRecordLocationConfirmationTokenService()
      .verify(token, {
        businessId: tenant.business.id,
        actorId: tenant.user.id,
      });
    const service = dependencies.createRecordLocationLinkService(supabase, {
      businessId: tenant.business.id,
      actorId: tenant.user.id,
    });
    const before = await service.readCurrentPairState({
      objectKey: payload.object_key,
      expectedObjectDefinitionId: payload.object_definition_id,
      targetRecordId: payload.target_record_id,
      targetLocationId: payload.target_location_id,
      action: payload.action,
    });
    const desiredPairState = payload.action === "link" ? "linked" : "unlinked";
    if (before.pairState !== payload.expected_pair_state) {
      return recordLocationUnavailableState(
        payload.action === "link" ? "already_linked" : "already_unlinked",
        before.objectLabel,
      );
    }

    try {
      if (payload.action === "link") {
        await service.create(
          payload.target_record_id,
          payload.target_location_id,
        );
      } else {
        if (!before.linkId) {
          return recordLocationUnavailableState(
            "already_unlinked",
            before.objectLabel,
          );
        }
        await service.remove(before.linkId);
      }
    } catch (mutationError) {
      if (
        mutationError instanceof RecordLocationLinkError &&
        (mutationError.code === "record_location_link_pair_exists" ||
          mutationError.code === "record_location_link_not_found")
      ) {
        const concurrent = await service.readCurrentPairState({
          objectKey: payload.object_key,
          expectedObjectDefinitionId: payload.object_definition_id,
          targetRecordId: payload.target_record_id,
          targetLocationId: payload.target_location_id,
          action: payload.action,
        });
        if (concurrent.pairState !== desiredPairState) {
          throw mutationError;
        }
      } else {
        throw mutationError;
      }
    }

    const after = await service.readCurrentPairState({
      objectKey: payload.object_key,
      expectedObjectDefinitionId: payload.object_definition_id,
      targetRecordId: payload.target_record_id,
      targetLocationId: payload.target_location_id,
      action: payload.action,
    });
    if (after.pairState !== desiredPairState) {
      throw new RecordLocationLinkError(
        "The Location availability changed before it could be verified.",
        { code: "record_location_link_state_changed" } as never,
      );
    }

    const destinationPath = payload.destination_view_key
      ? `/app/${encodeURIComponent(businessSlug)}/workspace/${experienceKeyToPath(payload.destination_view_key)}/${encodeURIComponent(payload.target_record_id)}`
      : undefined;
    revalidatePath(`/app/${encodeURIComponent(businessSlug)}`);
    if (destinationPath) revalidatePath(destinationPath);
    return freezeBuilderUiState({
      state: "record_location_updated",
      action: payload.action,
      object_label: after.objectLabel,
      location_name: after.locationName,
      message: BUILDER_RECORD_LOCATION_SUCCESS_MESSAGES[payload.action],
      ...(destinationPath ? { destination_path: destinationPath } : {}),
    });
  } catch (error) {
    const mapped = mapBuilderActionError(error);
    if (mapped.kind === "not_found") {
      dependencies.notFound();
      return invalidBuilderInputState();
    }
    if (mapped.kind === "unexpected") throw mapped.error;
    return mapped.state;
  }
}

async function executeLocationConfirmation(
  dependencies: BuilderActionDependencies,
  businessSlug: string,
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  formData: FormData,
): Promise<BuilderUiState> {
  const token = confirmationTokenFormValue(formData);
  if (!token) {
    return unavailableState("stale");
  }
  const tenant = await resolveBuilderTenant(businessSlug, supabase, {
    notFound: dependencies.notFound,
    resolveTenant: dependencies.resolveTenant,
  });
  if (!dependencies.hasCapability(tenant.membership.role, "manage_locations")) {
    dependencies.notFound();
  }

  let confirmedLocationName: string | undefined;
  try {
    const tokenService = dependencies.createLocationConfirmationTokenService();
    const payload = tokenService.verify(token, {
      businessId: tenant.business.id,
      actorId: tenant.user.id,
    });
    confirmedLocationName = payload.location_name;
    await dependencies
      .createLocationService(supabase, {
        businessId: tenant.business.id,
        actorId: tenant.user.id,
      })
      .create({
        name: payload.location_name,
        timezone: payload.timezone,
        expectedBusinessTimezone: payload.business_timezone,
        expectedLocationStateDigest: payload.location_state_digest,
      });
    revalidatePath(`/app/${encodeURIComponent(businessSlug)}/locations`);
    return freezeBuilderUiState({
      state: "location_created",
      location_name: payload.location_name,
      timezone: payload.timezone,
      message: BUILDER_UI_LOCATION_CREATED_MESSAGE,
    });
  } catch (error) {
    const mapped = mapBuilderActionError(error);
    if (mapped.kind === "not_found") {
      dependencies.notFound();
      return invalidBuilderInputState();
    }
    if (mapped.kind === "unexpected") {
      throw mapped.error;
    }
    if (mapped.state.state === "location_conflict" && confirmedLocationName) {
      return freezeBuilderUiState({
        ...mapped.state,
        location_name: confirmedLocationName,
      });
    }
    return mapped.state;
  }
}

async function executeRecordConfirmation(
  dependencies: BuilderActionDependencies,
  businessSlug: string,
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  formData: FormData,
): Promise<BuilderUiState> {
  const token = confirmationTokenFormValue(formData);
  if (!token) {
    return unavailableState("stale");
  }
  const tenant = await resolveBuilderTenant(businessSlug, supabase, {
    notFound: dependencies.notFound,
    resolveTenant: dependencies.resolveTenant,
  });
  if (
    !dependencies.hasCapability(tenant.membership.role, "manage_configuration")
  ) {
    dependencies.notFound();
  }

  try {
    const tokenService = dependencies.createRecordConfirmationTokenService();
    const payload = tokenService.verify(token, {
      businessId: tenant.business.id,
      actorId: tenant.user.id,
    });
    const recordService = dependencies.createConfirmedRecordCreationService(
      supabase,
      { businessId: tenant.business.id, actorId: tenant.user.id },
    );
    const state = await recordService.readState(payload.object_key);
    if (
      state.business_id !== tenant.business.id ||
      state.actor_id !== tenant.user.id ||
      state.base_version_id !== payload.base_version_id ||
      state.head_revision !== payload.head_revision ||
      state.object_key !== payload.object_key ||
      state.object_schema_digest !== payload.object_schema_digest ||
      state.record_state_digest !== payload.record_state_digest ||
      !state.is_active ||
      !state.eligibility.eligible
    ) {
      throw new RecordCreationServiceError("record_creation_state_changed");
    }
    const composed = composeConfirmedGraphRecordData(
      state,
      payload.field_values,
    );
    const record = await recordService.createConfirmed({
      baseVersionId: payload.base_version_id,
      headRevision: payload.head_revision,
      objectKey: payload.object_key,
      objectSchemaDigest: payload.object_schema_digest,
      recordStateDigest: payload.record_state_digest,
      requestedData: composed.requestedData,
      expectedObjectDefinitionId: state.object_definition_id,
    });
    if (
      record.business_id !== tenant.business.id ||
      record.object_definition_id !== state.object_definition_id ||
      record.record_status !== "active" ||
      record.created_by !== tenant.user.id
    ) {
      throw new RecordCreationServiceError("record_creation_response_invalid");
    }

    const destinationView = state.internal_views[0];
    const destinationPath = destinationView
      ? `/app/${encodeURIComponent(businessSlug)}/workspace/${experienceKeyToPath(destinationView.key)}/${encodeURIComponent(record.id)}`
      : undefined;
    revalidatePath(`/app/${encodeURIComponent(businessSlug)}`);
    if (destinationPath) {
      revalidatePath(destinationPath);
    }
    return freezeBuilderUiState({
      state: "record_created",
      object_label: state.singular_label,
      message: destinationPath
        ? `${state.singular_label} was added.`
        : `${state.singular_label} was added. No generated screen is currently configured for this information type.`,
      ...(destinationPath ? { destination_path: destinationPath } : {}),
    });
  } catch (error) {
    const mapped = mapBuilderActionError(error);
    if (mapped.kind === "not_found") {
      dependencies.notFound();
      return invalidBuilderInputState();
    }
    if (mapped.kind === "unexpected") {
      throw mapped.error;
    }
    return mapped.state;
  }
}

async function executeRecordUpdateConfirmation(
  dependencies: BuilderActionDependencies,
  businessSlug: string,
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  formData: FormData,
): Promise<BuilderUiState> {
  const token = recordUpdateConfirmationTokenFormValue(formData);
  if (!token) return unavailableState("stale");
  const tenant = await resolveBuilderTenant(businessSlug, supabase, {
    notFound: dependencies.notFound,
    resolveTenant: dependencies.resolveTenant,
  });
  if (
    !dependencies.hasCapability(tenant.membership.role, "manage_configuration")
  ) {
    dependencies.notFound();
  }

  try {
    const tokenService =
      dependencies.createRecordUpdateConfirmationTokenService();
    const payload = tokenService.verify(token, {
      businessId: tenant.business.id,
      actorId: tenant.user.id,
    });
    const record = await dependencies
      .createConfirmedRecordUpdateService(supabase, {
        businessId: tenant.business.id,
        actorId: tenant.user.id,
      })
      .updateConfirmed({
        baseVersionId: payload.base_version_id,
        headRevision: payload.head_revision,
        objectKey: payload.object_key,
        expectedObjectDefinitionId: payload.object_definition_id,
        targetRecordId: payload.target_record_id,
        expectedRecordUpdatedAt: payload.expected_record_currentness.updated_at,
        dataPatch: payload.data_patch,
      });
    if (
      record.business_id !== tenant.business.id ||
      record.object_definition_id !== payload.object_definition_id ||
      record.id !== payload.target_record_id ||
      record.record_status !== "active"
    ) {
      throw new RecordUpdateServiceError("record_update_response_invalid");
    }

    const destinationPath = payload.destination_view_key
      ? `/app/${encodeURIComponent(businessSlug)}/workspace/${experienceKeyToPath(payload.destination_view_key)}/${encodeURIComponent(record.id)}`
      : undefined;
    revalidatePath(`/app/${encodeURIComponent(businessSlug)}`);
    if (destinationPath) revalidatePath(destinationPath);
    return freezeBuilderUiState({
      state: "record_updated",
      object_label: "Record",
      message: destinationPath
        ? "The Record was updated."
        : "The Record was updated. No generated screen is currently configured for this information type.",
      ...(destinationPath ? { destination_path: destinationPath } : {}),
    });
  } catch (error) {
    const mapped = mapBuilderActionError(error);
    if (mapped.kind === "not_found") {
      dependencies.notFound();
      return invalidBuilderInputState();
    }
    if (mapped.kind === "unexpected") throw mapped.error;
    return mapped.state;
  }
}

export function createBuilderAction(
  overrides: Partial<BuilderActionDependencies> = {},
) {
  const dependencies = {
    ...productionBuilderActionDependencies,
    ...overrides,
  };

  return async function executeBuilderAction(
    businessSlugInput: string,
    _previousState: BuilderUiState,
    formData: FormData,
  ): Promise<BuilderUiState> {
    void _previousState;
    const businessSlug = parseBuilderRouteSlug(businessSlugInput);
    if (!businessSlug) {
      dependencies.notFound();
      return invalidBuilderInputState();
    }

    const confirmationToken = confirmationTokenFormValue(formData);
    const recordUpdateToken = recordUpdateConfirmationTokenFormValue(formData);
    const recordLocationToken =
      recordLocationConfirmationTokenFormValue(formData);
    if (recordLocationToken !== null) {
      const supabase = await dependencies.createServerClient();
      return executeRecordLocationConfirmation(
        dependencies,
        businessSlug,
        supabase,
        formData,
      );
    }
    if (recordUpdateToken !== null) {
      const supabase = await dependencies.createServerClient();
      return executeRecordUpdateConfirmation(
        dependencies,
        businessSlug,
        supabase,
        formData,
      );
    }
    if (confirmationToken !== null) {
      const supabase = await dependencies.createServerClient();
      if (confirmationKindFormValue(formData) === "create_record") {
        return executeRecordConfirmation(
          dependencies,
          businessSlug,
          supabase,
          formData,
        );
      }
      return executeLocationConfirmation(
        dependencies,
        businessSlug,
        supabase,
        formData,
      );
    }

    if (formData.get("clarificationStartOver") === "true") {
      return BUILDER_INITIAL_STATE;
    }

    const adaptiveChoiceToken = adaptiveSolutionChoiceTokenFormValue(formData);
    if (adaptiveChoiceToken !== null) {
      const supabase = await dependencies.createServerClient();
      const tenant = await resolveBuilderTenant(businessSlug, supabase, {
        notFound: dependencies.notFound,
        resolveTenant: dependencies.resolveTenant,
      });
      if (
        !dependencies.hasCapability(
          tenant.membership.role,
          "manage_configuration",
        )
      ) {
        dependencies.notFound();
      }

      try {
        const payload = dependencies
          .createAdaptiveSolutionChoiceTokenService()
          .verify(adaptiveChoiceToken, {
            businessId: tenant.business.id,
            actorId: tenant.user.id,
          });
        const optionId = adaptiveSolutionOptionFormValue(formData);
        const option = payload.choice.options.find(
          (candidate) => candidate.id === optionId,
        );
        if (!option) return invalidBuilderInputState();

        const headResult = await supabase
          .from("business_configuration_heads")
          .select("business_id,active_version_id,head_revision")
          .eq("business_id", tenant.business.id)
          .maybeSingle();
        if (headResult.error)
          return unavailableState("temporarily_unavailable");
        if (
          !headResult.data ||
          headResult.data.business_id !== tenant.business.id ||
          headResult.data.active_version_id !==
            payload.choice.base_version_id ||
          headResult.data.head_revision !== payload.choice.head_revision
        ) {
          return clarificationExpiredState();
        }

        if (option.consequence.kind === "use_current_related_workflow") {
          const destinationPath = `/app/${encodeURIComponent(businessSlug)}/workspace/${experienceKeyToPath(option.consequence.primary_view_key)}`;
          return freezeBuilderUiState({
            state: "adaptive_no_change",
            heading: "Nothing needs changing in your setup",
            message: `Use ${option.consequence.primary_object_label} as the main place you work. From each ${option.consequence.primary_singular_label}, you can add ${option.consequence.related_object_label} directly and keep the connection automatic.`,
            action_label: `Open ${option.consequence.primary_object_label}`,
            destination_path: destinationPath,
          });
        }

        const ownerRequest = [
          payload.original_owner_request,
          "",
          "[Lenni adaptation selection]",
          `The owner chose to simplify around ${option.consequence.primary_object_label}. Prepare only an additive ${option.consequence.primary_object_label}-centred adaptation: add the useful current ${option.consequence.related_object_label} details directly to ${option.consequence.primary_object_label} and prepare a focused ${option.consequence.primary_object_label} operating view.`,
          `Keep the existing ${option.consequence.related_object_label}, every existing Record, and every Connection intact. Do not merge, deactivate, archive, copy, or rewrite operational data.`,
        ].join("\n");
        const result = await dependencies.orchestrationService.run(supabase, {
          businessId: tenant.business.id,
          ownerRequest,
        });
        const clarificationTokenService =
          result.state === "needs_clarification"
            ? dependencies.createClarificationContinuationTokenService()
            : undefined;
        return mapBuilderOrchestrationResult(result, {
          businessId: tenant.business.id,
          actorId: tenant.user.id,
          ...(clarificationTokenService
            ? {
                clarificationTokenService,
                originalOwnerRequest: ownerRequest,
                clarificationAnswers: [],
                clarificationRound: 1,
                selectedAdaptiveChoice: {
                  choice: payload.choice,
                  optionId: option.id,
                },
              }
            : {}),
        });
      } catch (error) {
        if (error instanceof BuilderAdaptiveSolutionChoiceTokenError) {
          return error.code === "adaptive_solution_choice_secret_unavailable"
            ? unavailableState("temporarily_unavailable")
            : clarificationExpiredState();
        }
        const mapped = mapBuilderActionError(error);
        if (mapped.kind === "not_found") {
          dependencies.notFound();
          return invalidBuilderInputState();
        }
        if (mapped.kind === "unexpected") throw mapped.error;
        return mapped.state;
      }
    }

    const clarificationToken =
      clarificationContinuationTokenFormValue(formData);
    if (clarificationToken !== null) {
      const supabase = await dependencies.createServerClient();
      const tenant = await resolveBuilderTenant(businessSlug, supabase, {
        notFound: dependencies.notFound,
        resolveTenant: dependencies.resolveTenant,
      });
      if (
        !dependencies.hasCapability(
          tenant.membership.role,
          "manage_configuration",
        )
      ) {
        dependencies.notFound();
      }

      try {
        const clarificationTokenService =
          dependencies.createClarificationContinuationTokenService();
        const continuation = clarificationTokenService.verify(
          clarificationToken,
          {
            businessId: tenant.business.id,
            actorId: tenant.user.id,
          },
        );
        const headResult = await supabase
          .from("business_configuration_heads")
          .select("business_id,active_version_id,head_revision")
          .eq("business_id", tenant.business.id)
          .maybeSingle();
        if (headResult.error) {
          return unavailableState("temporarily_unavailable");
        }
        if (
          !headResult.data ||
          headResult.data.business_id !== tenant.business.id ||
          headResult.data.active_version_id !== continuation.base_version_id ||
          headResult.data.head_revision !== continuation.head_revision
        ) {
          return clarificationExpiredState();
        }

        let answers: readonly BuilderClarificationAnswer[];
        try {
          answers = parseClarificationAnswers(continuation, formData);
        } catch {
          return invalidBuilderInputState();
        }
        const ownerRequest = composeClarificationOwnerRequest(
          continuation.original_owner_request,
          answers,
        );
        const result = await dependencies.orchestrationService.run(supabase, {
          businessId: tenant.business.id,
          ownerRequest,
        });
        if (
          result.state === "needs_clarification" &&
          continuation.round >= BUILDER_CLARIFICATION_MAX_ROUNDS
        ) {
          return clarificationLimitReachedState();
        }

        let tokenService: LocationConfirmationTokenService | undefined;
        let recordTokenService: RecordConfirmationTokenService | undefined;
        let recordUpdateTokenService:
          RecordUpdateConfirmationTokenService | undefined;
        let recordLocationTokenService:
          RecordLocationConfirmationTokenService | undefined;
        if (result.state === "location_confirmation") {
          tokenService = dependencies.createLocationConfirmationTokenService();
        }
        if (result.state === "record_confirmation") {
          recordTokenService =
            dependencies.createRecordConfirmationTokenService();
        }
        if (result.state === "record_update_confirmation") {
          recordUpdateTokenService =
            dependencies.createRecordUpdateConfirmationTokenService();
        }
        if (result.state === "record_location_confirmation") {
          recordLocationTokenService =
            dependencies.createRecordLocationConfirmationTokenService();
        }
        return mapBuilderOrchestrationResult(result, {
          businessId: tenant.business.id,
          actorId: tenant.user.id,
          ...(tokenService ? { tokenService } : {}),
          ...(recordTokenService ? { recordTokenService } : {}),
          ...(recordUpdateTokenService ? { recordUpdateTokenService } : {}),
          ...(recordLocationTokenService ? { recordLocationTokenService } : {}),
          ...(result.state === "needs_clarification"
            ? {
                clarificationTokenService,
                originalOwnerRequest: continuation.original_owner_request,
                clarificationAnswers: answers,
                clarificationRound: continuation.round + 1,
                ...(continuation.selected_adaptive_choice
                  ? {
                      selectedAdaptiveChoice: {
                        choice: continuation.selected_adaptive_choice.choice,
                        optionId:
                          continuation.selected_adaptive_choice.option_id,
                      },
                    }
                  : {}),
              }
            : {}),
        });
      } catch (error) {
        const mapped = mapBuilderActionError(error);
        if (mapped.kind === "not_found") {
          dependencies.notFound();
          return invalidBuilderInputState();
        }
        if (mapped.kind === "unexpected") throw mapped.error;
        return mapped.state;
      }
    }

    const parsedRequest = parseBuilderOwnerRequest(formData);
    if (!parsedRequest.success) {
      return invalidBuilderInputState();
    }

    const supabase = await dependencies.createServerClient();
    const tenant = await resolveBuilderTenant(businessSlug, supabase, {
      notFound: dependencies.notFound,
      resolveTenant: dependencies.resolveTenant,
    });
    if (
      !dependencies.hasCapability(
        tenant.membership.role,
        "manage_configuration",
      )
    ) {
      dependencies.notFound();
    }

    if (isUncontextualizedUndoPhrase(parsedRequest.ownerRequest)) {
      return contextRequiredBuilderState();
    }

    try {
      const result = await dependencies.orchestrationService.run(supabase, {
        businessId: tenant.business.id,
        ownerRequest: parsedRequest.ownerRequest,
      });
      let tokenService: LocationConfirmationTokenService | undefined;
      let recordTokenService: RecordConfirmationTokenService | undefined;
      let recordUpdateTokenService:
        RecordUpdateConfirmationTokenService | undefined;
      let recordLocationTokenService:
        RecordLocationConfirmationTokenService | undefined;
      let clarificationTokenService:
        BuilderClarificationContinuationTokenService | undefined;
      let adaptiveSolutionChoiceTokenService:
        BuilderAdaptiveSolutionChoiceTokenService | undefined;
      if (result.state === "location_confirmation") {
        tokenService = dependencies.createLocationConfirmationTokenService();
      }
      if (result.state === "record_confirmation") {
        recordTokenService =
          dependencies.createRecordConfirmationTokenService();
      }
      if (result.state === "record_update_confirmation") {
        recordUpdateTokenService =
          dependencies.createRecordUpdateConfirmationTokenService();
      }
      if (result.state === "record_location_confirmation") {
        recordLocationTokenService =
          dependencies.createRecordLocationConfirmationTokenService();
      }
      if (result.state === "needs_clarification") {
        clarificationTokenService =
          dependencies.createClarificationContinuationTokenService();
      }
      if (result.state === "adaptive_solution_choice") {
        adaptiveSolutionChoiceTokenService =
          dependencies.createAdaptiveSolutionChoiceTokenService();
      }
      return mapBuilderOrchestrationResult(
        result,
        tokenService ||
          recordTokenService ||
          recordUpdateTokenService ||
          recordLocationTokenService ||
          clarificationTokenService ||
          adaptiveSolutionChoiceTokenService
          ? {
              businessId: tenant.business.id,
              actorId: tenant.user.id,
              ...(tokenService ? { tokenService } : {}),
              ...(recordTokenService ? { recordTokenService } : {}),
              ...(recordUpdateTokenService ? { recordUpdateTokenService } : {}),
              ...(recordLocationTokenService
                ? { recordLocationTokenService }
                : {}),
              ...(clarificationTokenService
                ? {
                    clarificationTokenService,
                    originalOwnerRequest: parsedRequest.ownerRequest,
                    clarificationAnswers: [],
                    clarificationRound: 1,
                  }
                : {}),
              ...(adaptiveSolutionChoiceTokenService
                ? { adaptiveSolutionChoiceTokenService }
                : {}),
            }
          : undefined,
      );
    } catch (error) {
      const mapped = mapBuilderActionError(error);
      if (mapped.kind === "not_found") {
        dependencies.notFound();
        return invalidBuilderInputState();
      }
      if (mapped.kind === "unexpected") {
        throw mapped.error;
      }
      return mapped.state;
    }
  };
}

export function mapBuilderActionResult(input: unknown): BuilderUiState {
  return mapBuilderOrchestrationResult(input);
}

export function initialBuilderUiState(): BuilderUiState {
  return BUILDER_INITIAL_STATE;
}
