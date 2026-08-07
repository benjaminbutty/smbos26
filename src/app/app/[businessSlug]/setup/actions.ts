"use server";

import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { hasCapability, resolveTenant } from "../../../../auth/authorization";
import {
  composeNewPreorderQuestionAmendment,
  composePreorderQuestionAmendment,
  composePreorderScheduleAmendment,
  loadActiveManualAmendmentSnapshot,
  ManualAmendmentError,
} from "../../../../core/configuration/manual-amendments/service";
import {
  manualExistingPreorderQuestionFormSchema,
  manualNewPreorderQuestionFormSchema,
  manualPreorderScheduleFormSchema,
  preorderQuestionTargetSchema,
} from "../../../../core/configuration/manual-amendments/schemas";
import {
  ConfigurationChangeService,
  ConfigurationChangeServiceError,
  isControlledConfigurationReadError,
} from "../../../../core/configuration/service";
import {
  InitialPreorderSetupError,
  prepareInitialPreorderProposal,
} from "../../../../core/configuration/initial-preorder/service";
import { initialPreorderSetupFormSchema } from "../../../../core/configuration/initial-preorder/schemas";
import { graphKeySchema } from "../../../../core/graph/schemas";
import { createServerClient } from "../../../../db/supabase/server";

const routeSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

function setupPath(businessSlug: string, preorderKey: string): string {
  return `/app/${encodeURIComponent(businessSlug)}/setup/preorder/${encodeURIComponent(preorderKey)}`;
}

function questionsPath(businessSlug: string, preorderKey: string): string {
  return `${setupPath(businessSlug, preorderKey)}/questions`;
}

function questionEditorPath(
  businessSlug: string,
  preorderKey: string,
  target: string,
  fieldKey: string,
): string {
  return `${questionsPath(businessSlug, preorderKey)}/${encodeURIComponent(target)}/${encodeURIComponent(fieldKey)}`;
}

function redirectWithNotice(
  path: string,
  notice: "duplicate_question" | "input_invalid" | "nothing_changed" | "stale",
): never {
  const query = new URLSearchParams({ notice });
  redirect(`${path}?${query.toString()}`);
}

function redirectWithInitialPreorderNotice(
  path: string,
  notice:
    | "input_invalid"
    | "stale"
    | "no_active_locations"
    | "location_unavailable"
    | "already_installed"
    | "business_not_clean",
): never {
  const query = new URLSearchParams({ notice });
  redirect(`${path}?${query.toString()}`);
}

function stringValue(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
}

function integerValue(formData: FormData, name: string): number {
  const value = stringValue(formData, name);
  return value !== null && /^-?\d+$/.test(value)
    ? Number.parseInt(value, 10)
    : Number.NaN;
}

async function createManualAmendmentActionContext(businessSlugInput: string) {
  const businessSlug = routeSlugSchema.safeParse(businessSlugInput);
  if (!businessSlug.success) {
    notFound();
  }
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug.data, supabase);
  if (!hasCapability(tenant.membership.role, "manage_configuration")) {
    notFound();
  }
  const configuration = new ConfigurationChangeService(supabase, {
    businessId: tenant.business.id,
    actorId: tenant.user.id,
  });
  return {
    businessSlug: businessSlug.data,
    configuration,
  };
}

async function createInitialPreorderActionContext(businessSlugInput: string) {
  const businessSlug = routeSlugSchema.safeParse(businessSlugInput);
  if (!businessSlug.success) {
    notFound();
  }
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug.data, supabase);
  if (!hasCapability(tenant.membership.role, "manage_configuration")) {
    notFound();
  }
  return {
    businessSlug: businessSlug.data,
    configuration: new ConfigurationChangeService(supabase, {
      businessId: tenant.business.id,
      actorId: tenant.user.id,
    }),
    supabase,
    tenant,
  };
}

export async function prepareInitialPreorderProposalAction(
  businessSlugInput: string,
  formData: FormData,
): Promise<never> {
  const setupPath = `/app/${encodeURIComponent(businessSlugInput)}/setup`;
  const { businessSlug, configuration, supabase } =
    await createInitialPreorderActionContext(businessSlugInput);
  const parsed = initialPreorderSetupFormSchema.safeParse({
    expectedBaseVersionId: stringValue(formData, "expectedBaseVersionId"),
    expectedHeadRevision: integerValue(formData, "expectedHeadRevision"),
    locationIds: formData
      .getAll("locationIds")
      .filter((value): value is string => typeof value === "string"),
    daysOfWeek: formData
      .getAll("daysOfWeek")
      .map((value) =>
        typeof value === "string" && /^\d+$/.test(value)
          ? Number.parseInt(value, 10)
          : Number.NaN,
      ),
    startTime: stringValue(formData, "startTime"),
    endTime: stringValue(formData, "endTime"),
    slotIntervalMinutes: integerValue(formData, "slotIntervalMinutes"),
    slotCapacity: integerValue(formData, "slotCapacity"),
    cutoffHours: integerValue(formData, "cutoffHours"),
    bookingHorizonDays: integerValue(formData, "bookingHorizonDays"),
  });
  if (!parsed.success) {
    redirectWithInitialPreorderNotice(setupPath, "input_invalid");
  }

  try {
    const proposal = await prepareInitialPreorderProposal(
      supabase,
      configuration,
      parsed.data,
    );
    redirect(
      `/app/${encodeURIComponent(businessSlug)}/changes/${encodeURIComponent(proposal.id)}`,
    );
  } catch (error) {
    if (error instanceof InitialPreorderSetupError) {
      const noticeByCode = {
        initial_preorder_no_active_locations: "no_active_locations",
        initial_preorder_location_unavailable: "location_unavailable",
        initial_preorder_already_installed: "already_installed",
        initial_preorder_business_not_clean: "business_not_clean",
        initial_preorder_stale: "stale",
      } as const;
      redirectWithInitialPreorderNotice(setupPath, noticeByCode[error.code]);
    }
    if (
      error instanceof ConfigurationChangeServiceError &&
      error.code === "configuration_proposal_stale"
    ) {
      redirectWithInitialPreorderNotice(setupPath, "stale");
    }
    throw error;
  }
}

async function loadActiveSnapshot(configuration: ConfigurationChangeService) {
  let active;
  try {
    active = await loadActiveManualAmendmentSnapshot(configuration);
  } catch (error) {
    if (isControlledConfigurationReadError(error)) {
      notFound();
    }
    throw error;
  }
  return active;
}

function assertCurrentForm(
  active: { baseVersionId: string; headRevision: number },
  expected: {
    expectedBaseVersionId: string;
    expectedHeadRevision: number;
  },
  redirectPath: string,
): void {
  if (
    active.baseVersionId !== expected.expectedBaseVersionId ||
    active.headRevision !== expected.expectedHeadRevision
  ) {
    redirectWithNotice(redirectPath, "stale");
  }
}

async function proposeManualAmendment(
  configuration: ConfigurationChangeService,
  input: {
    businessSlug: string;
    description: string;
    expectedBaseVersionId: string;
    expectedHeadRevision: number;
    operations: Parameters<
      ConfigurationChangeService["proposeChangeSet"]
    >[0]["operations"];
    staleRedirectPath: string;
    title: string;
  },
): Promise<never> {
  try {
    const proposal = await configuration.proposeChangeSet({
      expectedBaseVersionId: input.expectedBaseVersionId,
      expectedHeadRevision: input.expectedHeadRevision,
      title: input.title,
      description: input.description,
      operations: input.operations,
    });
    redirect(
      `/app/${encodeURIComponent(input.businessSlug)}/changes/${encodeURIComponent(proposal.id)}`,
    );
  } catch (error) {
    if (
      error instanceof ConfigurationChangeServiceError &&
      error.code === "configuration_proposal_stale"
    ) {
      redirectWithNotice(input.staleRedirectPath, "stale");
    }
    throw error;
  }
}

export async function preparePreorderScheduleProposalAction(
  businessSlugInput: string,
  preorderKeyInput: string,
  formData: FormData,
): Promise<never> {
  const { businessSlug, configuration } =
    await createManualAmendmentActionContext(businessSlugInput);
  const path = setupPath(businessSlug, preorderKeyInput);

  const parsed = manualPreorderScheduleFormSchema.safeParse({
    expectedBaseVersionId: stringValue(formData, "expectedBaseVersionId"),
    expectedHeadRevision: integerValue(formData, "expectedHeadRevision"),
    preorderKey: preorderKeyInput,
    daysOfWeek: formData
      .getAll("daysOfWeek")
      .map((value) =>
        typeof value === "string" && /^\d+$/.test(value)
          ? Number.parseInt(value, 10)
          : Number.NaN,
      ),
    startTime: stringValue(formData, "startTime"),
    endTime: stringValue(formData, "endTime"),
    slotIntervalMinutes: integerValue(formData, "slotIntervalMinutes"),
    slotCapacity: integerValue(formData, "slotCapacity"),
    cutoffHours: integerValue(formData, "cutoffHours"),
    bookingHorizonDays: integerValue(formData, "bookingHorizonDays"),
  });
  if (!parsed.success) {
    redirectWithNotice(path, "input_invalid");
  }
  const active = await loadActiveSnapshot(configuration);
  assertCurrentForm(active, parsed.data, path);

  let amendment;
  try {
    amendment = composePreorderScheduleAmendment(
      active.snapshot,
      parsed.data.intent,
    );
  } catch (error) {
    if (error instanceof ManualAmendmentError) {
      notFound();
    }
    throw error;
  }
  if (amendment.noOp) {
    redirectWithNotice(path, "nothing_changed");
  }

  return proposeManualAmendment(configuration, {
    businessSlug,
    description: amendment.description,
    expectedBaseVersionId: parsed.data.expectedBaseVersionId,
    expectedHeadRevision: parsed.data.expectedHeadRevision,
    operations: [amendment.operation],
    staleRedirectPath: path,
    title: amendment.title,
  });
}

export async function prepareExistingPreorderQuestionAmendmentAction(
  businessSlugInput: string,
  preorderKeyInput: string,
  targetInput: string,
  fieldKeyInput: string,
  formData: FormData,
): Promise<never> {
  const preorderKey = graphKeySchema.safeParse(preorderKeyInput);
  const target = preorderQuestionTargetSchema.safeParse(targetInput);
  const fieldKey = graphKeySchema.safeParse(fieldKeyInput);
  if (!preorderKey.success || !target.success || !fieldKey.success) {
    notFound();
  }
  const { businessSlug, configuration } =
    await createManualAmendmentActionContext(businessSlugInput);
  const path = questionEditorPath(
    businessSlug,
    preorderKey.data,
    target.data,
    fieldKey.data,
  );
  const parsed = manualExistingPreorderQuestionFormSchema.safeParse({
    expectedBaseVersionId: stringValue(formData, "expectedBaseVersionId"),
    expectedHeadRevision: integerValue(formData, "expectedHeadRevision"),
    label: stringValue(formData, "label"),
    helpText: stringValue(formData, "helpText"),
    required: stringValue(formData, "required") === "on",
  });
  if (!parsed.success) {
    redirectWithNotice(path, "input_invalid");
  }
  const active = await loadActiveSnapshot(configuration);
  assertCurrentForm(active, parsed.data, path);

  let amendment;
  try {
    amendment = composePreorderQuestionAmendment(active.snapshot, {
      intent: "update_preorder_question",
      preorderKey: preorderKey.data,
      target: target.data,
      fieldKey: fieldKey.data,
      label: parsed.data.label,
      helpText: parsed.data.helpText,
      required: parsed.data.required,
    });
  } catch (error) {
    if (error instanceof ManualAmendmentError) {
      notFound();
    }
    throw error;
  }
  if (amendment.noOp) {
    redirectWithNotice(path, "nothing_changed");
  }

  return proposeManualAmendment(configuration, {
    businessSlug,
    description: amendment.description,
    expectedBaseVersionId: parsed.data.expectedBaseVersionId,
    expectedHeadRevision: parsed.data.expectedHeadRevision,
    operations: amendment.operations,
    staleRedirectPath: path,
    title: amendment.title,
  });
}

export async function prepareNewPreorderQuestionAmendmentAction(
  businessSlugInput: string,
  preorderKeyInput: string,
  formData: FormData,
): Promise<never> {
  const preorderKey = graphKeySchema.safeParse(preorderKeyInput);
  if (!preorderKey.success) {
    notFound();
  }
  const { businessSlug, configuration } =
    await createManualAmendmentActionContext(businessSlugInput);
  const path = `${questionsPath(businessSlug, preorderKey.data)}/new`;
  const parsed = manualNewPreorderQuestionFormSchema.safeParse({
    expectedBaseVersionId: stringValue(formData, "expectedBaseVersionId"),
    expectedHeadRevision: integerValue(formData, "expectedHeadRevision"),
    label: stringValue(formData, "label"),
    helpText: stringValue(formData, "helpText"),
    answerStyle: stringValue(formData, "answerStyle"),
    required: stringValue(formData, "required") === "on",
  });
  if (!parsed.success) {
    redirectWithNotice(path, "input_invalid");
  }
  const active = await loadActiveSnapshot(configuration);
  assertCurrentForm(active, parsed.data, path);

  let amendment;
  try {
    amendment = composeNewPreorderQuestionAmendment(active.snapshot, {
      intent: "add_preorder_question",
      preorderKey: preorderKey.data,
      label: parsed.data.label,
      helpText: parsed.data.helpText,
      answerStyle: parsed.data.answerStyle,
      required: parsed.data.required,
    });
  } catch (error) {
    if (
      error instanceof ManualAmendmentError &&
      error.code === "manual_preorder_question_duplicate"
    ) {
      redirectWithNotice(path, "duplicate_question");
    }
    if (error instanceof ManualAmendmentError) {
      notFound();
    }
    throw error;
  }

  return proposeManualAmendment(configuration, {
    businessSlug,
    description: amendment.description,
    expectedBaseVersionId: parsed.data.expectedBaseVersionId,
    expectedHeadRevision: parsed.data.expectedHeadRevision,
    operations: amendment.operations,
    staleRedirectPath: path,
    title: amendment.title,
  });
}
