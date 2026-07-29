import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { hasCapability, resolveTenant } from "@/auth/authorization";
import { ConfigurationActionNotice } from "@/components/configuration-action-ui";
import { ConfigurationVersionDetail } from "@/components/configuration-history-ui";
import { configurationActionNoticeSchema } from "@/core/configuration/action-notices";
import type { SemanticDiff } from "@/core/configuration/schemas";
import {
  ConfigurationChangeService,
  isControlledConfigurationReadError,
  summarizeConfigurationSnapshot,
} from "@/core/configuration/service";
import { createServerClient } from "@/db/supabase/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

interface ConfigurationVersionRouteProps {
  params: Promise<{ businessSlug: string; versionId: string }>;
  searchParams: Promise<{ notice?: string | string[] }>;
}

export default async function ConfigurationVersionRoute({
  params,
  searchParams,
}: Readonly<ConfigurationVersionRouteProps>): Promise<ReactNode> {
  const [{ businessSlug, versionId }, query] = await Promise.all([
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
    const [version, activeHead] = await Promise.all([
      configuration.getVersion(versionId),
      configuration.getActiveHead(),
    ]);
    const relatedVersionIds = [
      version.parent_version_id,
      version.restored_from_version_id,
    ].filter((value): value is string => value !== null);
    const [relatedVersions, sourceChangeSet] = await Promise.all([
      Promise.all(
        [...new Set(relatedVersionIds)].map((relatedVersionId) =>
          configuration.getVersion(relatedVersionId),
        ),
      ),
      version.source_change_set_id
        ? configuration.getChangeSet(version.source_change_set_id)
        : Promise.resolve(null),
    ]);
    const versionById = new Map(
      relatedVersions.map((relatedVersion) => [
        relatedVersion.id,
        relatedVersion,
      ]),
    );

    detail = {
      active: activeHead.active_version_id === version.id,
      diff: sourceChangeSet
        ? (sourceChangeSet.semantic_diff_json as unknown as SemanticDiff)
        : null,
      parent: version.parent_version_id
        ? (versionById.get(version.parent_version_id) ?? null)
        : null,
      restoredFrom: version.restored_from_version_id
        ? (versionById.get(version.restored_from_version_id) ?? null)
        : null,
      snapshotCounts: summarizeConfigurationSnapshot(version.snapshot_json),
      sourceChangeSet,
      version,
    };
  } catch (error) {
    if (isControlledConfigurationReadError(error)) {
      notFound();
    }
    throw error;
  }
  return (
    <ConfigurationVersionDetail
      active={detail.active}
      businessSlug={businessSlug}
      diff={detail.diff}
      notice={<ConfigurationActionNotice notice={notice} />}
      parent={detail.parent}
      restoredFrom={detail.restoredFrom}
      snapshotCounts={detail.snapshotCounts}
      sourceChangeSet={detail.sourceChangeSet}
      sourceUnavailable={false}
      version={detail.version}
    />
  );
}
