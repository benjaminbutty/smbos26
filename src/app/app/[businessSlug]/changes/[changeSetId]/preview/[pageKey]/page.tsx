import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { hasCapability, resolveTenant } from "@/auth/authorization";
import { ConfigurationPreviewPage } from "@/components/configuration-preview-page";
import { loadRenderedConfigurationPreview } from "@/core/configuration/rendered-preview";
import { createServerClient } from "@/db/supabase/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

interface ConfigurationPreviewRouteProps {
  params: Promise<{
    businessSlug: string;
    changeSetId: string;
    pageKey: string;
  }>;
}

export default async function ConfigurationPreviewRoute({
  params,
}: Readonly<ConfigurationPreviewRouteProps>): Promise<ReactNode> {
  const { businessSlug, changeSetId, pageKey } = await params;
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);

  if (!hasCapability(tenant.membership.role, "manage_configuration")) {
    notFound();
  }

  let rendered;
  try {
    rendered = await loadRenderedConfigurationPreview(supabase, {
      businessId: tenant.business.id,
      actorId: tenant.user.id,
      changeSetId,
      pageKey,
    });
  } catch {
    notFound();
  }
  return (
    <ConfigurationPreviewPage businessSlug={businessSlug} rendered={rendered} />
  );
}
