import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { hasCapability, resolveTenant } from "@/auth/authorization";
import { ConfigurationActionNotice } from "@/components/configuration-action-ui";
import { ConfigurationChangeDetail } from "@/components/configuration-history-ui";
import { configurationActionNoticeSchema } from "@/core/configuration/action-notices";
import { deriveBuilderUndoContext } from "@/core/configuration/builder-undo/service";
import {
  ConfigurationChangeService,
  ConfigurationChangeServiceError,
  isControlledConfigurationReadError,
} from "@/core/configuration/service";
import type { Tables } from "@/db/supabase/database.types";
import { createServerClient } from "@/db/supabase/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

interface ConfigurationChangeRouteProps {
  params: Promise<{ businessSlug: string; changeSetId: string }>;
  searchParams: Promise<{ notice?: string | string[] }>;
}

export default async function ConfigurationChangeRoute({
  params,
  searchParams,
}: Readonly<ConfigurationChangeRouteProps>): Promise<ReactNode> {
  const [{ businessSlug, changeSetId }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const noticeValue =
    typeof query.notice === "string" ? query.notice : undefined;
  const notice =
    configurationActionNoticeSchema.safeParse(noticeValue).data ?? null;
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);

  if (!hasCapability(tenant.membership.role, "manage_configuration")) {
    notFound();
  }

  const configuration = new ConfigurationChangeService(supabase, {
    businessId: tenant.business.id,
    actorId: tenant.user.id,
  });

  let detail;
  try {
    const changeSet = await configuration.getChangeSet(changeSetId);
    const activeHead = await configuration.getActiveHead();
    const versionIds = [
      changeSet.base_version_id,
      changeSet.rollback_target_version_id,
      changeSet.applied_version_id,
    ].filter((value): value is string => value !== null);
    const versions = await Promise.all(
      [...new Set(versionIds)].map((versionId) =>
        configuration.getVersion(versionId),
      ),
    );
    const versionById = new Map(
      versions.map((version) => [version.id, version]),
    );

    const appliedVersion = changeSet.applied_version_id
      ? (versionById.get(changeSet.applied_version_id) ?? null)
      : null;
    let builderUndoEligible = false;
    if (
      changeSet.status === "applied" &&
      changeSet.kind === "change" &&
      appliedVersion
    ) {
      const appliedParent = appliedVersion.parent_version_id
        ? await configuration.getVersion(appliedVersion.parent_version_id)
        : null;
      try {
        builderUndoEligible =
          deriveBuilderUndoContext({
            activeHead,
            businessId: tenant.business.id,
            parentVersion: appliedParent,
            sourceChangeSet: changeSet,
            sourceVersion: appliedVersion,
          }).state === "eligible";
      } catch {
        builderUndoEligible = false;
      }
    }

    let preview:
      | { state: "available"; pages: Tables<"pages">[] }
      | { state: "empty" }
      | { state: "stale" }
      | { state: "closed" } = { state: "closed" };

    if (changeSet.status === "proposed" || changeSet.status === "validated") {
      try {
        const candidate = await configuration.loadPreview(changeSet.id);
        preview =
          candidate.pages.length > 0
            ? { state: "available", pages: candidate.pages }
            : { state: "empty" };
      } catch (error) {
        if (
          error instanceof ConfigurationChangeServiceError &&
          error.code === "configuration_preview_stale"
        ) {
          preview = { state: "stale" };
        } else if (
          error instanceof ConfigurationChangeServiceError &&
          error.code === "configuration_preview_unavailable"
        ) {
          const refreshed = await configuration.getChangeSet(changeSet.id);
          if (
            refreshed.status !== "proposed" &&
            refreshed.status !== "validated"
          ) {
            preview = { state: "closed" };
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }
    }

    detail = {
      appliedVersion,
      builderUndoEligible,
      baseVersion: versionById.get(changeSet.base_version_id)!,
      changeSet,
      preview,
      rollbackTarget: changeSet.rollback_target_version_id
        ? (versionById.get(changeSet.rollback_target_version_id) ?? null)
        : null,
    };
  } catch (error) {
    if (isControlledConfigurationReadError(error)) {
      notFound();
    }
    throw error;
  }
  return (
    <ConfigurationChangeDetail
      appliedVersion={detail.appliedVersion}
      baseVersion={detail.baseVersion}
      builderUndoEligible={detail.builderUndoEligible}
      businessSlug={businessSlug}
      changeSet={detail.changeSet}
      notice={<ConfigurationActionNotice notice={notice} />}
      preview={detail.preview}
      rollbackTarget={detail.rollbackTarget}
    />
  );
}
