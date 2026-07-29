import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { hasCapability, resolveTenant } from "@/auth/authorization";
import { AbandonConfigurationConfirmation } from "@/components/configuration-action-ui";
import {
  ConfigurationChangeService,
  isControlledConfigurationReadError,
} from "@/core/configuration/service";
import { createServerClient } from "@/db/supabase/server";

import { abandonConfigurationChangeAction } from "../../actions";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

interface AbandonConfigurationRouteProps {
  params: Promise<{ businessSlug: string; changeSetId: string }>;
}

export default async function AbandonConfigurationRoute({
  params,
}: Readonly<AbandonConfigurationRouteProps>): Promise<ReactNode> {
  const { businessSlug, changeSetId } = await params;
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
    if (changeSet.status !== "proposed") {
      notFound();
    }
    const baseVersion = await configuration.getVersion(
      changeSet.base_version_id,
    );
    detail = { baseVersion, changeSet };
  } catch (error) {
    if (isControlledConfigurationReadError(error)) {
      notFound();
    }
    throw error;
  }
  const action = abandonConfigurationChangeAction.bind(
    null,
    businessSlug,
    detail.changeSet.id,
  );
  return (
    <AbandonConfigurationConfirmation
      action={action}
      baseVersion={detail.baseVersion}
      businessSlug={businessSlug}
      changeSet={detail.changeSet}
    />
  );
}
