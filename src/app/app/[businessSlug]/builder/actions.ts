"use server";

import { notFound } from "next/navigation";

import { builderOrchestrationService } from "../../../../ai/builder/service";
import { hasCapability, resolveTenant } from "../../../../auth/authorization";
import type { BuilderUiState } from "../../../../components/builder-ui-state";
import { createServerClient } from "../../../../db/supabase/server";
import {
  invalidBuilderInputState,
  mapBuilderActionError,
  mapBuilderOrchestrationResult,
  parseBuilderOwnerRequest,
  parseBuilderRouteSlug,
} from "./action-service";

export async function runBuilderAction(
  businessSlugInput: string,
  _previousState: BuilderUiState,
  formData: FormData,
): Promise<BuilderUiState> {
  void _previousState;
  const businessSlug = parseBuilderRouteSlug(businessSlugInput);
  if (!businessSlug) {
    notFound();
  }

  const parsedRequest = parseBuilderOwnerRequest(formData);
  if (!parsedRequest.success) {
    return invalidBuilderInputState();
  }

  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  if (!hasCapability(tenant.membership.role, "manage_configuration")) {
    notFound();
  }

  try {
    const result = await builderOrchestrationService.run(supabase, {
      businessId: tenant.business.id,
      ownerRequest: parsedRequest.ownerRequest,
    });
    return mapBuilderOrchestrationResult(result);
  } catch (error) {
    const mapped = mapBuilderActionError(error);
    if (mapped.kind === "not_found") {
      notFound();
    }
    if (mapped.kind === "unexpected") {
      throw mapped.error;
    }
    return mapped.state;
  }
}
