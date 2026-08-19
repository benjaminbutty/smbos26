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

function contextForPath(
  pathname: string,
  businessSlug: string,
  tables: ReadonlyArray<{ name: string; path: string }>,
  pages: ReadonlyArray<{ slug: string; title: string }>,
  sites: ReadonlyArray<{ slug: string; title: string }>,
): string {
  const root = `/app/${encodeURIComponent(businessSlug)}`;
  if (pathname === root || pathname === `${root}/`) {
    return "Home";
  }

  const table = tables.find((candidate) =>
    pathname.includes(`/workspace/${candidate.path}`),
  );
  if (table) {
    return `Tables / ${table.name}`;
  }

  const page = pages.find((candidate) =>
    pathname.includes(`/pages/${encodeURIComponent(candidate.slug)}`),
  );
  if (page) {
    return `Pages / ${page.title}`;
  }

  const site = sites.find((candidate) =>
    pathname.includes(`/sites/${encodeURIComponent(candidate.slug)}`),
  );
  if (site) {
    return `Sites / ${site.title}`;
  }

  if (pathname.includes("/builder")) return "Tell Lenni";
  if (pathname.includes("/changes")) return "Changes";
  if (pathname.includes("/setup")) return "Settings / Setup";
  if (pathname.includes("/locations")) return "Settings / Locations";
  return "Workspace";
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
  const context = contextForPath(pathname, businessSlug, tables, pages, sites);
  const rootPath = `/app/${encodeURIComponent(businessSlug)}`;

  return (
    <header className="workspace-topbar">
      <div className="workspace-topbar-leading">
        <Link className="workspace-topbar-brand" href={rootPath}>
          Lenni
        </Link>
        <p className="workspace-topbar-context">{context}</p>
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
