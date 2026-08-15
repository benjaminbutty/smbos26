import type { ReactNode } from "react";

import { hasCapability, resolveTenant } from "../../../auth/authorization";
import { WorkspaceHome } from "../../../components/workspace-home";
import { createExperienceService } from "../../../core/experience/service";
import { createServerClient } from "../../../db/supabase/server";
import { experienceKeyToPath } from "../../../runtime/routing";

interface TenantHomePageProps {
  params: Promise<{ businessSlug: string }>;
}

export default async function TenantHomePage({
  params,
}: Readonly<TenantHomePageProps>): Promise<ReactNode> {
  const { businessSlug } = await params;
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  const experience = createExperienceService(supabase, {
    businessId: tenant.business.id,
  });
  const navigation = await experience.listNavigation();
  const canManageConfiguration = hasCapability(
    tenant.membership.role,
    "manage_configuration",
  );
  const destinations = [
    ...navigation.publicPages.map((page) => ({
      href: `/app/${businessSlug}/sites/${page.slug}`,
      kind: "site" as const,
      label:
        page.status === "published"
          ? `Open Site: ${page.title}`
          : `Review draft Site: ${page.title}`,
      description:
        page.status === "published"
          ? "Review the customer-facing Site"
          : "Review the draft before publishing it",
    })),
    ...navigation.pages.map((page) => ({
      href: `/app/${businessSlug}/pages/${page.slug}`,
      kind: "page" as const,
      label: page.title,
      description: "Open this workspace page",
    })),
    ...navigation.views.map((view) => ({
      href: `/app/${businessSlug}/workspace/${experienceKeyToPath(view.key)}`,
      kind: "view" as const,
      label: view.name,
      description: "View and manage this work",
    })),
  ];

  return (
    <WorkspaceHome
      businessName={tenant.business.name}
      businessSlug={businessSlug}
      canManageConfiguration={canManageConfiguration}
      destinations={destinations}
      greetingName={tenant.user.email?.split("@")[0] ?? "there"}
    />
  );
}
