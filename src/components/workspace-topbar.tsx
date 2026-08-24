"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface WorkspaceTopbarProps {
  businessSlug: string;
  businessName: string;
  canManageConfiguration: boolean;
  userInitials: string;
  tables: ReadonlyArray<{ name: string; path: string }>;
  pages: ReadonlyArray<{ slug: string; title: string }>;
  sites?: ReadonlyArray<{ slug: string; title: string }>;
}

interface Breadcrumb {
  href?: string;
  label: string;
}

function breadcrumbsForPath(
  pathname: string,
  businessSlug: string,
  tables: ReadonlyArray<{ name: string; path: string }>,
  pages: ReadonlyArray<{ slug: string; title: string }>,
  sites: ReadonlyArray<{ slug: string; title: string }>,
): readonly Breadcrumb[] {
  const root = `/app/${encodeURIComponent(businessSlug)}`;
  if (pathname === root || pathname === `${root}/`) {
    return [{ label: "Home" }];
  }

  const table = tables.find((candidate) =>
    pathname.includes(`/workspace/${candidate.path}`),
  );
  if (table) {
    return [
      { href: `${root}#tables-navigation-heading`, label: "Tables" },
      { label: table.name },
    ];
  }

  const page = pages.find((candidate) =>
    pathname.includes(`/pages/${encodeURIComponent(candidate.slug)}`),
  );
  if (page) {
    return [
      { href: `${root}#pages-navigation-heading`, label: "Pages" },
      { label: page.title },
    ];
  }

  const site = sites.find((candidate) =>
    pathname.includes(`/sites/${encodeURIComponent(candidate.slug)}`),
  );
  if (site) {
    return [
      { href: `${root}#sites-navigation-heading`, label: "Sites" },
      { label: site.title },
    ];
  }

  if (pathname.includes("/builder")) return [{ label: "Tell Lenni" }];
  if (pathname.includes("/changes")) return [{ label: "Changes" }];
  if (pathname.includes("/setup")) {
    return [{ label: "Settings" }, { label: "Setup" }];
  }
  if (pathname.includes("/locations")) {
    return [{ label: "Settings" }, { label: "Locations" }];
  }
  return [{ label: "Workspace" }];
}

export function WorkspaceTopbar({
  businessName,
  businessSlug,
  canManageConfiguration,
  pages,
  sites = [],
  tables,
  userInitials,
}: Readonly<WorkspaceTopbarProps>): ReactNode {
  const pathname = usePathname();
  const breadcrumbs = breadcrumbsForPath(
    pathname,
    businessSlug,
    tables,
    pages,
    sites,
  );
  const rootPath = `/app/${encodeURIComponent(businessSlug)}`;

  return (
    <header className="workspace-topbar">
      <div className="workspace-topbar-leading">
        <Link className="workspace-topbar-brand" href={rootPath}>
          Lenni
        </Link>
        <nav aria-label="Breadcrumb" className="workspace-topbar-context">
          {breadcrumbs.map((breadcrumb, index) => (
            <span key={`${breadcrumb.label}-${index}`}>
              {index > 0 ? <span aria-hidden="true"> / </span> : null}
              {breadcrumb.href ? (
                <Link href={breadcrumb.href}>{breadcrumb.label}</Link>
              ) : (
                <span>{breadcrumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      </div>
      <div className="workspace-topbar-actions">
        {canManageConfiguration ? (
          <Link
            aria-label="Tell Lenni what you need"
            className="workspace-tell-lenni"
            href={`/app/${encodeURIComponent(businessSlug)}/builder`}
          >
            <span aria-hidden="true">→</span>
            Tell Lenni
          </Link>
        ) : null}
        <Link
          aria-label={`Account for ${businessName}`}
          className="workspace-account"
          href="/onboarding"
          title="Account and businesses"
        >
          {userInitials}
        </Link>
      </div>
    </header>
  );
}
