"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { SupabaseAiAccountingService } from "../../../../ai/accounting/service";
import type { BuilderUiState } from "../../../../components/builder-ui-state";
import {
  createBuilderAction,
  parseBuilderRouteSlug,
  resolveBuilderTenant,
} from "./action-service";
import { hasCapability } from "../../../../auth/authorization";
import { createServerClient } from "../../../../db/supabase/server";

const executeBuilderAction = createBuilderAction();

export async function runBuilderAction(
  businessSlugInput: string,
  _previousState: BuilderUiState,
  formData: FormData,
): Promise<BuilderUiState> {
  return executeBuilderAction(businessSlugInput, _previousState, formData);
}

async function setBuilderEnabled(
  businessSlugInput: string,
  requestedIsEnabled: boolean,
  _formData: FormData,
): Promise<void> {
  void _formData;
  const businessSlug = parseBuilderRouteSlug(businessSlugInput);
  if (!businessSlug || typeof requestedIsEnabled !== "boolean") {
    notFound();
  }

  const supabase = await createServerClient();
  const tenant = await resolveBuilderTenant(businessSlug, supabase);
  if (!hasCapability(tenant.membership.role, "manage_ai")) {
    notFound();
  }

  const accounting = new SupabaseAiAccountingService(supabase, {
    businessId: tenant.business.id,
    actorId: tenant.user.id,
  });
  const current = await accounting.readSettings();
  await accounting.updateSettings({
    isEnabled: requestedIsEnabled,
    dailyRequestLimit: current.daily_request_limit,
    dailyInputTokenLimit: current.daily_input_token_limit,
    dailyOutputTokenLimit: current.daily_output_token_limit,
    dailyCostLimitMicrousd: current.daily_cost_limit_microusd,
  });

  const builderPath = `/app/${encodeURIComponent(businessSlug)}/builder`;
  revalidatePath(builderPath);
  redirect(builderPath);
}

export async function enableBuilderAction(
  businessSlugInput: string,
  formData: FormData,
): Promise<void> {
  return setBuilderEnabled(businessSlugInput, true, formData);
}

export async function disableBuilderAction(
  businessSlugInput: string,
  formData: FormData,
): Promise<void> {
  return setBuilderEnabled(businessSlugInput, false, formData);
}
