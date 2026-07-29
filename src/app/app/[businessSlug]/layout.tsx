import Link from "next/link";
import type { ReactNode } from "react";

import { signOut } from "../../../auth/actions";
import { hasCapability, resolveTenant } from "../../../auth/authorization";
import { createExperienceService } from "../../../core/experience/service";
import { createServerClient } from "../../../db/supabase/server";
import { experienceKeyToPath } from "../../../runtime/routing";

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
          {hasCapability(tenant.membership.role, "manage_configuration") ? (
            <Link href={`/app/${businessSlug}/changes`}>Changes</Link>
          ) : null}
          {navigation.pages.map((page) => (
            <Link
              href={`/app/${businessSlug}/pages/${page.slug}`}
              key={page.id}
            >
              {page.title}
            </Link>
          ))}
          {navigation.views.map((view) => (
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

        <div className="workspace-sidebar-footer">
          <Link href={`/app/${businessSlug}/locations`}>Settings</Link>
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
