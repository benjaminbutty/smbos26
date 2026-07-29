import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { hasCapability, resolveTenant } from "@/auth/authorization";
import { PrepareRollbackConfirmation } from "@/components/configuration-action-ui";
import { configurationActionNoticeSchema } from "@/core/configuration/action-notices";
import {
  ConfigurationChangeService,
  isControlledConfigurationReadError,
} from "@/core/configuration/service";
import { createServerClient } from "@/db/supabase/server";

import { prepareConfigurationRollbackAction } from "../../../actions";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

interface PrepareRollbackRouteProps {
  params: Promise<{ businessSlug: string; versionId: string }>;
  searchParams: Promise<{ notice?: string | string[] }>;
}

export default async function PrepareRollbackRoute({
  params,
  searchParams,
}: Readonly<PrepareRollbackRouteProps>): Promise<ReactNode> {
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
    const [targetVersion, activeHead] = await Promise.all([
      configuration.getVersion(versionId),
      configuration.getActiveHead(),
    ]);
    if (targetVersion.id === activeHead.active_version_id) {
      notFound();
    }
    const activeVersion = await configuration.getVersion(
      activeHead.active_version_id,
    );
    if (targetVersion.version_number >= activeVersion.version_number) {
      notFound();
    }
    detail = { activeHead, activeVersion, targetVersion };
  } catch (error) {
    if (isControlledConfigurationReadError(error)) {
      notFound();
    }
    throw error;
  }
  const action = prepareConfigurationRollbackAction.bind(
    null,
    businessSlug,
    detail.targetVersion.id,
    detail.activeHead.active_version_id,
    detail.activeHead.head_revision,
  );
  return (
    <PrepareRollbackConfirmation
      action={action}
      activeVersion={detail.activeVersion}
      businessSlug={businessSlug}
      notice={notice}
      targetVersion={detail.targetVersion}
    />
  );
}
