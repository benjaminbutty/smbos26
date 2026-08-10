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
}

function contextForPath(
  pathname: string,
  businessSlug: string,
  tables: ReadonlyArray<{ name: string; path: string }>,
  pages: ReadonlyArray<{ slug: string; title: string }>,
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
  tables,
  userInitials,
}: Readonly<WorkspaceTopbarProps>): ReactNode {
  const pathname = usePathname();
  const context = contextForPath(pathname, businessSlug, tables, pages);

  return (
    <header className="workspace-topbar">
      <p className="workspace-topbar-context">{context}</p>
      <div className="workspace-topbar-actions">
        {canManageConfiguration ? (
          <Link
            aria-label="Tell Lenni what you need"
            className="workspace-tell-lenni"
            href={`/app/${encodeURIComponent(businessSlug)}/builder`}
          >
            <span aria-hidden="true">✦</span>
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
