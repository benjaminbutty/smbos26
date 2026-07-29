import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { hasCapability, resolveTenant } from "@/auth/authorization";
import { ConfigurationChangesOverview } from "@/components/configuration-history-ui";
import {
  ConfigurationChangeService,
  isControlledConfigurationReadError,
} from "@/core/configuration/service";
import { createServerClient } from "@/db/supabase/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

interface ConfigurationChangesRouteProps {
  params: Promise<{ businessSlug: string }>;
}

export default async function ConfigurationChangesRoute({
  params,
}: Readonly<ConfigurationChangesRouteProps>): Promise<ReactNode> {
  const { businessSlug } = await params;
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);

  if (!hasCapability(tenant.membership.role, "manage_configuration")) {
    notFound();
  }

  const configuration = new ConfigurationChangeService(supabase, {
    businessId: tenant.business.id,
    actorId: tenant.user.id,
  });

  let overview;
  try {
    const [changeSets, versions, activeHead] = await Promise.all([
      configuration.listChangeSets(),
      configuration.listVersions(),
      configuration.getActiveHead(),
    ]);
    overview = { changeSets, versions, activeHead };
  } catch (error) {
    if (isControlledConfigurationReadError(error)) {
      notFound();
    }
    throw error;
  }
  return (
    <ConfigurationChangesOverview
      activeVersionId={overview.activeHead.active_version_id}
      businessSlug={businessSlug}
      changeSets={overview.changeSets}
      versions={overview.versions}
    />
  );
}
