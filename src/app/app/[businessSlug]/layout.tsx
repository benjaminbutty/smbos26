import Link from "next/link";
import type { ReactNode } from "react";

import { signOut } from "../../../auth/actions";
import { hasCapability, resolveTenant } from "../../../auth/authorization";
import { ConfigurationChangeService } from "../../../core/configuration/service";
import { createExperienceService } from "../../../core/experience/service";
import { createServerClient } from "../../../db/supabase/server";
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
        <Link className="workspace-brand" href={`/app/${businessSlug}`}>
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          <span>
            <small>SMBOS</small>
            {tenant.business.name}
          </span>
        </Link>

        <nav className="workspace-navigation" aria-label="Business workspace">
          <Link href={`/app/${businessSlug}`}>Home</Link>
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
                    href={`/app/${businessSlug}/workspace/${experienceKeyToPath(
                      view.key,
                    )}`}
                    key={view.id}
                  >
                    {view.name}
                  </Link>
                ))}
              </nav>
            </section>
          ) : null}
          <section
            aria-labelledby="more-navigation-heading"
            className="sidebar-section sidebar-secondary-section"
          >
            <div className="sidebar-section-heading">
              <h2 id="more-navigation-heading">More</h2>
            </div>
            <nav aria-label="More workspace destinations">
              {canManageConfiguration ? (
                <>
                  <Link href={`/app/${businessSlug}/builder`}>Builder</Link>
                  <Link href={`/app/${businessSlug}/setup`}>Edit setup</Link>
                  <Link href={`/app/${businessSlug}/changes`}>History</Link>
                </>
              ) : null}
              <Link href={`/app/${businessSlug}/locations`}>Settings</Link>
            </nav>
          </section>
        </nav>

        <div className="workspace-sidebar-footer">
          <Link href="/onboarding">Switch business</Link>
          <form action={signOut}>
            <button className="button-link" type="submit">
              Sign out
            </button>
          </form>
          <span className="role-badge">{tenant.membership.role}</span>
        </div>
      </aside>

      <main className="workspace-main">
        <header className="workspace-mobile-header">
          <Link className="tenant-name" href={`/app/${businessSlug}`}>
            {tenant.business.name}
          </Link>
        </header>
        {children}
      </main>
    </div>
  );
}
