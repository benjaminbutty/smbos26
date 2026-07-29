import Link from "next/link";
import type { ReactNode } from "react";

import type { Tables } from "../db/supabase/database.types";

interface ConfigurationPreviewShellProps {
  businessSlug: string;
  candidateChecksum: string;
  changeSetId: string;
  currentPageKey: string;
  kind: "change" | "rollback";
  navigationPages: Tables<"pages">[];
  status: "proposed" | "validated";
  title: string;
  children: ReactNode;
}

function previewPagePath(
  businessSlug: string,
  changeSetId: string,
  pageKey: string,
): string {
  return `/app/${encodeURIComponent(businessSlug)}/changes/${encodeURIComponent(
    changeSetId,
  )}/preview/${encodeURIComponent(pageKey)}`;
}

export function ConfigurationPreviewShell({
  businessSlug,
  candidateChecksum,
  changeSetId,
  currentPageKey,
  kind,
  navigationPages,
  status,
  title,
  children,
}: Readonly<ConfigurationPreviewShellProps>): ReactNode {
  return (
    <section className="configuration-preview">
      <header className="configuration-preview-banner" role="status">
        <div>
          <p className="eyebrow">Preview — not live</p>
          <h1>{title}</h1>
          <p>
            {kind === "rollback" ? "Rollback" : "Change"} ·{" "}
            {status === "validated" ? "Validated" : "Proposed"} · Candidate{" "}
            <code>{candidateChecksum.slice(0, 12)}</code>
          </p>
          <p>No edits or submissions will be saved.</p>
        </div>
        <Link className="button button-secondary" href={`/app/${businessSlug}`}>
          Exit preview
        </Link>
      </header>

      <nav
        aria-label="Candidate pages"
        className="configuration-preview-navigation"
      >
        {navigationPages.map((page) => (
          <Link
            aria-current={page.key === currentPageKey ? "page" : undefined}
            href={previewPagePath(businessSlug, changeSetId, page.key)}
            key={page.id}
          >
            {page.title}
            {page.audience === "public" ? " (public)" : ""}
          </Link>
        ))}
      </nav>

      {children}
    </section>
  );
}
