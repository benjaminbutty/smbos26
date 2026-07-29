import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { hasCapability, resolveTenant } from "@/auth/authorization";
import { ValidateConfigurationConfirmation } from "@/components/configuration-action-ui";
import {
  ConfigurationChangeService,
  isControlledConfigurationReadError,
} from "@/core/configuration/service";
import { createServerClient } from "@/db/supabase/server";

import { validateConfigurationChangeAction } from "../../actions";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

interface ValidateConfigurationRouteProps {
  params: Promise<{ businessSlug: string; changeSetId: string }>;
}

export default async function ValidateConfigurationRoute({
  params,
}: Readonly<ValidateConfigurationRouteProps>): Promise<ReactNode> {
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
    const [baseVersion, preview] = await Promise.all([
      configuration.getVersion(changeSet.base_version_id),
      configuration.loadPreview(changeSet.id),
    ]);
    detail = { baseVersion, changeSet, previewPages: preview.pages };
  } catch (error) {
    if (isControlledConfigurationReadError(error)) {
      notFound();
    }
    throw error;
  }
  const action = validateConfigurationChangeAction.bind(
    null,
    businessSlug,
    detail.changeSet.id,
  );
  return (
    <ValidateConfigurationConfirmation
      action={action}
      baseVersion={detail.baseVersion}
      businessSlug={businessSlug}
      changeSet={detail.changeSet}
      previewPages={detail.previewPages}
    />
  );
}
