import Link from "next/link";
import type { ReactNode } from "react";

import { useAcquisitionSetupAction } from "../app/start/actions";
import {
  candidateTablePageKey,
  type CandidatePreviewPage,
  type CandidatePreviewTable,
} from "../core/acquisition/preview";

interface CandidatePreviewShellProps {
  candidateChecksum: string;
  currentPageKey: string;
  pages: readonly CandidatePreviewPage[];
  tables: Readonly<Record<string, CandidatePreviewTable>>;
  title: string;
  children: ReactNode;
}

function pagePath(pageKey: string, checksum: string): string {
  return `/start/preview/${encodeURIComponent(pageKey)}?candidate=${encodeURIComponent(checksum)}`;
}

export function CandidatePreviewShell({
  candidateChecksum,
  currentPageKey,
  pages,
  tables,
  title,
  children,
}: Readonly<CandidatePreviewShellProps>): ReactNode {
  const internalPages = pages.filter((page) => page.audience === "internal");
  const publicPages = pages.filter((page) => page.audience === "public");

  return (
    <section className="candidate-preview-shell">
      <header className="candidate-preview-topbar">
        <div className="candidate-preview-brand">
          <Link href="/start">Lenni</Link>
          <span>Previewing {title}</span>
        </div>
        <Link className="candidate-preview-tell" href="/start?from=preview">
          Tell Lenni
        </Link>
      </header>

      <div className="candidate-preview-layout">
        <aside className="candidate-preview-sidebar">
          <nav aria-label="Preview workspace">
            <p className="candidate-preview-nav-label">Workspace</p>
            <Link
              aria-current={currentPageKey === "home" ? "page" : undefined}
              className="candidate-preview-nav-link"
              href={`/start/preview/home?candidate=${encodeURIComponent(candidateChecksum)}`}
            >
              Home
            </Link>

            {internalPages.length > 0 ? (
              <>
                <p className="candidate-preview-nav-label">Work</p>
                {internalPages.map((page) => (
                  <Link
                    aria-current={
                      page.key === currentPageKey ? "page" : undefined
                    }
                    className="candidate-preview-nav-link"
                    href={pagePath(page.key, candidateChecksum)}
                    key={page.key}
                  >
                    {page.title}
                  </Link>
                ))}
              </>
            ) : null}

            {Object.keys(tables).length > 0 ? (
              <>
                <p className="candidate-preview-nav-label">Tables</p>
                {Object.entries(tables).map(([tableKey, table]) => {
                  const tablePageKey = candidateTablePageKey(tableKey);
                  return (
                    <Link
                      aria-current={
                        tablePageKey === currentPageKey ? "page" : undefined
                      }
                      className="candidate-preview-nav-link"
                      href={pagePath(tablePageKey, candidateChecksum)}
                      key={tableKey}
                    >
                      {table.name}
                      <span className="candidate-preview-nav-meta">
                        {table.table.rows.length} examples
                      </span>
                    </Link>
                  );
                })}
              </>
            ) : null}

            {publicPages.length > 0 ? (
              <>
                <p className="candidate-preview-nav-label">Sites</p>
                {publicPages.map((page) => (
                  <Link
                    aria-current={
                      page.key === currentPageKey ? "page" : undefined
                    }
                    className="candidate-preview-nav-link"
                    href={pagePath(page.key, candidateChecksum)}
                    key={page.key}
                  >
                    {page.title}
                    <span className="candidate-preview-draft">Draft</span>
                  </Link>
                ))}
              </>
            ) : null}
          </nav>
        </aside>

        <main className="candidate-preview-main">{children}</main>
      </div>

      <aside
        aria-label="Preview mode"
        className="candidate-preview-overlay"
        role="status"
      >
        <p className="eyebrow">Preview mode</p>
        <h2>See how this setup works</h2>
        <p>
          Example information is shown so you can explore the workspace. Nothing
          has been created yet.
        </p>
        <div className="candidate-preview-overlay-actions">
          <Link className="button-secondary" href="/start?from=preview">
            Back to Lenni
          </Link>
          <form action={useAcquisitionSetupAction}>
            <button className="button" type="submit">
              Use this setup
            </button>
          </form>
        </div>
      </aside>
    </section>
  );
}
