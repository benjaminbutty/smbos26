import Link from "next/link";
import type { ReactNode } from "react";

import { signOut } from "../../../auth/actions";
import { hasCapability, resolveTenant } from "../../../auth/authorization";
import { ConfigurationChangeService } from "../../../core/configuration/service";
import { createExperienceService } from "../../../core/experience/service";
import { createServerClient } from "../../../db/supabase/server";
import { WorkspaceNavLink } from "../../../components/workspace-nav-link";
import { WorkspaceTopbar } from "../../../components/workspace-topbar";
import { experienceKeyToPath } from "../../../runtime/routing";
import { PagesSidebar } from "../../../runtime/navigation/pages-sidebar";
import { TablesSidebar } from "../../../runtime/navigation/tables-sidebar";
import { createPageAction } from "../../../runtime/pages/direct-actions";
import { createDirectTableAction } from "../../../runtime/views/direct-actions";

interface TenantLayoutProps {
  children: ReactNode;
  params: Promise<{ businessSlug: string }>;
}

export default async function TenantLayout({
  children,
  params,
}: Readonly<TenantLayoutProps>): Promise<ReactNode> {
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
  const tables = navigation.views
    .filter((view) => view.view_type === "table")
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((view) => ({
      key: view.key,
      name: view.name,
      path: experienceKeyToPath(view.key),
    }));
  const nonTableViews = navigation.views.filter(
    (view) => view.view_type !== "table",
  );
  let currentness: {
    expectedBaseVersionId: string;
    expectedHeadRevision: number;
  } | null = null;
  if (canManageConfiguration) {
    try {
      currentness = await new ConfigurationChangeService(supabase, {
        businessId: tenant.business.id,
        actorId: tenant.user.id,
      }).getProposalCurrentness();
    } catch {
      currentness = null;
    }
  }

  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">
        <div className="workspace-sidebar-header">
          <Link className="workspace-brand" href={`/app/${businessSlug}`}>
            Lenni
          </Link>
          <Link
            aria-label={`Switch business from ${tenant.business.name}`}
            className="workspace-business-switcher"
            href="/onboarding"
          >
            <span className="workspace-business-avatar" aria-hidden="true">
              {tenant.business.name.slice(0, 2).toUpperCase()}
            </span>
            <span className="workspace-business-copy">
              <strong>{tenant.business.name}</strong>
              <small>
                {tenant.business.business_type.trim() || "New workspace"}
              </small>
            </span>
            <span aria-hidden="true" className="workspace-business-chevron">
              ⌄
            </span>
          </Link>
        </div>

        <nav className="workspace-navigation" aria-label="Business workspace">
          <WorkspaceNavLink
            className="workspace-home-link"
            exact
            href={`/app/${businessSlug}`}
          >
            <span aria-hidden="true" className="workspace-nav-icon">
              ⌂
            </span>
            Home
          </WorkspaceNavLink>
          <TablesSidebar
            action={createDirectTableAction.bind(null, businessSlug)}
            businessSlug={businessSlug}
            currentness={canManageConfiguration ? currentness : null}
            tables={tables}
          />
          <PagesSidebar
            action={
              canManageConfiguration && currentness
                ? createPageAction.bind(null, businessSlug, currentness)
                : undefined
            }
            businessSlug={businessSlug}
            currentness={canManageConfiguration ? currentness : null}
            pages={navigation.pages.map((page) => ({
              id: page.id,
              slug: page.slug,
              title: page.title,
            }))}
          />
          {nonTableViews.length > 0 ? (
            <section
              aria-labelledby="views-navigation-heading"
              className="sidebar-section sidebar-view-section"
            >
              <div className="sidebar-section-heading">
                <h2 id="views-navigation-heading">Views</h2>
              </div>
              <nav aria-label="Views">
                {nonTableViews.map((view) => (
                  <Link
                    className="workspace-secondary-destination"
                    href={`/app/${businessSlug}/workspace/${experienceKeyToPath(
                      view.key,
                    )}`}
                    key={view.id}
                  >
                    <span aria-hidden="true" className="workspace-nav-icon">
                      ◌
                    </span>
                    {view.name}
                  </Link>
                ))}
              </nav>
            </section>
          ) : null}
        </nav>

        <div className="workspace-sidebar-footer">
          <nav
            aria-label="Workspace utilities"
            className="workspace-utility-nav"
          >
            {canManageConfiguration ? (
              <>
                <Link href={`/app/${businessSlug}/changes`}>
                  <span aria-hidden="true" className="workspace-nav-icon">
                    ≋
                  </span>
                  Changes
                </Link>
                <Link href={`/app/${businessSlug}/setup`}>
                  <span aria-hidden="true" className="workspace-nav-icon">
                    ◉
                  </span>
                  Setup
                </Link>
              </>
            ) : null}
            <Link href={`/app/${businessSlug}/locations`}>
              <span aria-hidden="true" className="workspace-nav-icon">
                ◎
              </span>
              Settings
            </Link>
          </nav>
          <div className="workspace-user-card">
            <span className="workspace-user-avatar" aria-hidden="true">
              {(tenant.user.email?.slice(0, 2) ?? "AC").toUpperCase()}
            </span>
            <span>
              <strong>{tenant.user.email?.split("@")[0] ?? "Account"}</strong>
              <small>{tenant.membership.role}</small>
            </span>
          </div>
          <form action={signOut} className="workspace-sign-out-form">
            <button className="button-link" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="workspace-main">
        <WorkspaceTopbar
          businessName={tenant.business.name}
          businessSlug={businessSlug}
          canManageConfiguration={canManageConfiguration}
          pages={navigation.pages.map((page) => ({
            slug: page.slug,
            title: page.title,
          }))}
          tables={tables}
          userInitials={(tenant.user.email?.slice(0, 2) ?? "AC").toUpperCase()}
        />
        {children}
      </main>
    </div>
  );
}
