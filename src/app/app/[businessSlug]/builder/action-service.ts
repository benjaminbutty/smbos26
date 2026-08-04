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
  createLocationService,
  LocationServiceError,
} from "../../../../core/locations/service";
import { BUILDER_PLAN_MAX_OWNER_REQUEST_CHARACTERS } from "../../../../ai/planning/schemas";
import {
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
  confirmation?: {
    businessId: string;
    actorId: string;
    tokenService: LocationConfirmationTokenService;
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
    );
  }
  if (result.state === "unsupported") {
    return freezeBuilderUiState({
      state: "unsupported",
      message: result.message,
    });
  }
  if (result.state === "location_confirmation") {
    if (!confirmation) {
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
};

const productionBuilderActionDependencies: BuilderActionDependencies = {
  createServerClient,
  hasCapability,
  notFound,
  orchestrationService: builderOrchestrationService,
  resolveTenant,
  createLocationService,
  createLocationConfirmationTokenService,
};

function confirmationTokenFormValue(formData: FormData): string | null {
  if (!formData.has("confirmationToken")) {
    return null;
  }
  const value = formData.get("confirmationToken");
  return typeof value === "string" && value.trim() ? value : "";
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
    if (confirmationToken !== null) {
      const supabase = await dependencies.createServerClient();
      return executeLocationConfirmation(
        dependencies,
        businessSlug,
        supabase,
        formData,
      );
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
      if (result.state === "location_confirmation") {
        tokenService = dependencies.createLocationConfirmationTokenService();
      }
      return mapBuilderOrchestrationResult(
        result,
        tokenService
          ? {
              businessId: tenant.business.id,
              actorId: tenant.user.id,
              tokenService,
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
