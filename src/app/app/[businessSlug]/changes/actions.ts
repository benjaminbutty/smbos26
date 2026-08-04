"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { hasCapability, resolveTenant } from "../../../../auth/authorization";
import { type ConfigurationActionNotice } from "../../../../core/configuration/action-notices";
import { configurationSnapshotV1Schema } from "../../../../core/configuration/definition-source";
import { prepareConfigurationRollbackSchema } from "../../../../core/configuration/schemas";
import {
  ConfigurationChangeService,
  ConfigurationChangeServiceError,
  isControlledConfigurationReadError,
} from "../../../../core/configuration/service";
import type { Tables } from "../../../../db/supabase/database.types";
import { createServerClient } from "../../../../db/supabase/server";

const routeSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const identifierSchema = z.uuid();
const headRevisionSchema = z.number().int().positive();

type ChangeSet = Tables<"configuration_change_sets">;

function changePath(businessSlug: string, changeSetId: string): string {
  return `/app/${encodeURIComponent(businessSlug)}/changes/${encodeURIComponent(changeSetId)}`;
}

function versionPath(businessSlug: string, versionId: string): string {
  return `/app/${encodeURIComponent(businessSlug)}/changes/versions/${encodeURIComponent(versionId)}`;
}

function redirectWithNotice(
  path: string,
  notice: ConfigurationActionNotice,
): never {
  const query = new URLSearchParams({ notice });
  redirect(`${path}?${query.toString()}`);
}

async function createActionContext(businessSlugInput: string) {
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
  };
}

function parseIdentifier(value: string): string {
  const identifier = identifierSchema.safeParse(value);
  if (!identifier.success) {
    notFound();
  }
  return identifier.data;
}

function isStateChangedError(error: unknown): boolean {
  return (
    error instanceof ConfigurationChangeServiceError &&
    [
      "configuration_change_set_not_validatable",
      "configuration_change_set_not_applicable",
      "configuration_change_set_not_abandonable",
      "configuration_proposal_stale",
      "configuration_rollback_target_invalid",
      "configuration_rollback_target_not_found",
      "configuration_owner_or_admin_required",
    ].includes(error.code)
  );
}

function revalidateChangeReads(
  businessSlug: string,
  changeSet: ChangeSet,
): void {
  revalidatePath(`/app/${businessSlug}/changes`);
  revalidatePath(changePath(businessSlug, changeSet.id));
  const relatedVersionIds = [
    changeSet.base_version_id,
    changeSet.rollback_target_version_id,
    changeSet.applied_version_id,
  ].filter((value): value is string => value !== null);
  for (const versionId of new Set(relatedVersionIds)) {
    revalidatePath(versionPath(businessSlug, versionId));
  }
}

function publicPagePaths(businessSlug: string, snapshot: unknown): string[] {
  const parsed = configurationSnapshotV1Schema.parse(snapshot);
  return parsed.pages
    .filter(
      (page) =>
        page.is_active &&
        page.audience === "public" &&
        page.status === "published",
    )
    .map(
      (page) =>
        `/p/${encodeURIComponent(businessSlug)}/${encodeURIComponent(page.slug)}`,
    );
}

async function revalidateAppliedRuntime(
  businessSlug: string,
  configuration: ConfigurationChangeService,
  changeSet: ChangeSet,
): Promise<void> {
  const baseVersion = await configuration.getVersion(changeSet.base_version_id);
  const paths = new Set([
    ...publicPagePaths(businessSlug, baseVersion.snapshot_json),
    ...publicPagePaths(businessSlug, changeSet.candidate_snapshot_json),
  ]);

  revalidatePath(`/app/${businessSlug}`, "layout");
  for (const path of paths) {
    revalidatePath(path);
  }
}

function controlledActionNotFound(error: unknown): never {
  if (isControlledConfigurationReadError(error)) {
    notFound();
  }
  throw error;
}

export async function validateConfigurationChangeAction(
  businessSlugInput: string,
  changeSetIdInput: string,
  _formData: FormData,
): Promise<never> {
  void _formData;
  const { businessSlug, configuration } =
    await createActionContext(businessSlugInput);
  const changeSetId = parseIdentifier(changeSetIdInput);
  const path = changePath(businessSlug, changeSetId);

  let current: ChangeSet;
  try {
    current = await configuration.getChangeSet(changeSetId);
  } catch (error) {
    controlledActionNotFound(error);
  }

  if (current.status !== "proposed" && current.status !== "validated") {
    redirectWithNotice(path, "state_changed");
  }

  let result: ChangeSet;
  try {
    result = await configuration.validateChangeSet(changeSetId);
  } catch (error) {
    if (isStateChangedError(error)) {
      redirectWithNotice(path, "state_changed");
    }
    controlledActionNotFound(error);
  }

  revalidateChangeReads(businessSlug, result);
  if (result.status === "validated") {
    redirectWithNotice(path, "validated");
  }
  if (result.status === "rejected") {
    redirectWithNotice(path, "validation_rejected");
  }
  if (result.status === "conflicted") {
    redirectWithNotice(path, "validation_conflicted");
  }
  throw new Error("Unexpected configuration validation lifecycle result.");
}

export async function applyConfigurationChangeAction(
  businessSlugInput: string,
  changeSetIdInput: string,
  _formData: FormData,
): Promise<never> {
  void _formData;
  const { businessSlug, configuration } =
    await createActionContext(businessSlugInput);
  const changeSetId = parseIdentifier(changeSetIdInput);
  const path = changePath(businessSlug, changeSetId);

  let current: ChangeSet;
  try {
    current = await configuration.getChangeSet(changeSetId);
  } catch (error) {
    controlledActionNotFound(error);
  }

  if (current.status !== "validated" && current.status !== "applied") {
    redirectWithNotice(path, "state_changed");
  }

  let result: ChangeSet;
  try {
    result = await configuration.applyChangeSet(changeSetId);
  } catch (error) {
    if (isStateChangedError(error)) {
      redirectWithNotice(path, "state_changed");
    }
    controlledActionNotFound(error);
  }

  revalidateChangeReads(businessSlug, result);
  if (result.status === "applied") {
    await revalidateAppliedRuntime(businessSlug, configuration, result);
    redirectWithNotice(path, "applied");
  }
  if (result.status === "rejected") {
    redirectWithNotice(path, "application_rejected");
  }
  if (result.status === "conflicted") {
    redirectWithNotice(path, "application_conflicted");
  }
  throw new Error("Unexpected configuration application lifecycle result.");
}

export async function abandonConfigurationChangeAction(
  businessSlugInput: string,
  changeSetIdInput: string,
  _formData: FormData,
): Promise<never> {
  void _formData;
  const { businessSlug, configuration } =
    await createActionContext(businessSlugInput);
  const changeSetId = parseIdentifier(changeSetIdInput);
  const path = changePath(businessSlug, changeSetId);

  let current: ChangeSet;
  try {
    current = await configuration.getChangeSet(changeSetId);
  } catch (error) {
    controlledActionNotFound(error);
  }

  if (current.status === "abandoned") {
    revalidateChangeReads(businessSlug, current);
    redirectWithNotice(path, "abandoned");
  }
  if (current.status !== "proposed") {
    redirectWithNotice(path, "state_changed");
  }

  let result: ChangeSet;
  try {
    result = await configuration.abandonChangeSet(changeSetId);
  } catch (error) {
    if (isStateChangedError(error)) {
      redirectWithNotice(path, "state_changed");
    }
    controlledActionNotFound(error);
  }

  revalidateChangeReads(businessSlug, result);
  if (result.status !== "abandoned") {
    throw new Error("Unexpected configuration abandonment lifecycle result.");
  }
  redirectWithNotice(path, "abandoned");
}

export async function prepareConfigurationRollbackAction(
  businessSlugInput: string,
  versionIdInput: string,
  renderedHeadVersionIdInput: string,
  renderedHeadRevisionInput: number,
  formData: FormData,
): Promise<never> {
  const { businessSlug, configuration } =
    await createActionContext(businessSlugInput);
  const versionId = parseIdentifier(versionIdInput);
  const renderedHeadVersionId = parseIdentifier(renderedHeadVersionIdInput);
  const renderedHeadRevision = headRevisionSchema.safeParse(
    renderedHeadRevisionInput,
  );
  const path = versionPath(businessSlug, versionId);
  if (!renderedHeadRevision.success) {
    redirectWithNotice(path, "state_changed");
  }

  const descriptionValue = formData.get("description");
  const rollbackInput = prepareConfigurationRollbackSchema.safeParse({
    targetVersionId: versionId,
    title: formData.get("title"),
    description:
      typeof descriptionValue === "string" && descriptionValue.length > 0
        ? descriptionValue
        : null,
  });
  if (!rollbackInput.success) {
    redirectWithNotice(`${path}/rollback`, "input_invalid");
  }

  let activeHead;
  let targetVersion;
  try {
    [activeHead, targetVersion] = await Promise.all([
      configuration.getActiveHead(),
      configuration.getVersion(versionId),
    ]);
  } catch (error) {
    controlledActionNotFound(error);
  }

  if (
    activeHead.active_version_id !== renderedHeadVersionId ||
    activeHead.head_revision !== renderedHeadRevision.data ||
    targetVersion.id === activeHead.active_version_id ||
    targetVersion.version_number >= activeHead.head_revision
  ) {
    redirectWithNotice(path, "state_changed");
  }

  let proposal: ChangeSet;
  try {
    proposal = await configuration.prepareRollback({
      ...rollbackInput.data,
      expectedBaseVersionId: activeHead.active_version_id,
      expectedHeadRevision: activeHead.head_revision,
    });
  } catch (error) {
    if (isStateChangedError(error)) {
      redirectWithNotice(path, "state_changed");
    }
    controlledActionNotFound(error);
  }

  revalidateChangeReads(businessSlug, proposal);
  redirectWithNotice(
    changePath(businessSlug, proposal.id),
    "rollback_prepared",
  );
}
