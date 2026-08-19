import Link from "next/link";
import type { ReactNode } from "react";

import type {
  CandidatePreviewModel,
  CandidatePreviewPage as CandidatePage,
} from "../core/acquisition/preview";
import { candidateTablePageKey } from "../core/acquisition/preview";
import { CandidateTableWorkspace } from "./candidate-table-workspace";
import { PageRenderer } from "../runtime/pages/page-renderer";

export function CandidatePreviewPage({
  model,
  page,
}: Readonly<{ model: CandidatePreviewModel; page: CandidatePage }>): ReactNode {
  return (
    <section className="tenant-content runtime-page candidate-preview-content">
      <header className="page-preview-header">
        <div>
          <p className="eyebrow">
            {page.audience === "public" ? "Site · Draft" : "Work"}
          </p>
          <h1 className="runtime-title">{page.title}</h1>
          {page.audience === "public" ? (
            <p className="candidate-preview-page-note">
              This customer-facing Site is a draft. Previewing it does not
              publish or submit anything.
            </p>
          ) : null}
        </div>
      </header>
      <PageRenderer
        bookings={model.bookings}
        candidateTables={Object.fromEntries(
          Object.entries(model.tables).map(([key, table]) => [key, table]),
        )}
        forms={model.forms}
        layout={page.layout}
        preorders={model.preorders}
        previewMode
        publicMode={page.audience === "public"}
      />
    </section>
  );
}

export function CandidatePreviewTable({
  model,
  table,
}: Readonly<{
  model: CandidatePreviewModel;
  table: CandidatePreviewModel["tables"][string];
}>): ReactNode {
  const savedViews = Object.values(model.tables).filter(
    (candidate) => candidate.objectKey === table.objectKey,
  );
  return (
    <section className="tenant-content runtime-page candidate-preview-content candidate-table-preview">
      <header className="page-preview-header">
        <div>
          <p className="eyebrow">Work · Table</p>
          <h1 className="runtime-title">{table.objectLabel}</h1>
          <p className="candidate-preview-page-note">
            Explore temporary example Records and see how this information
            connects. Nothing here can be edited or saved.
          </p>
        </div>
      </header>
      <section
        aria-label={`${table.objectLabel} preview`}
        className="candidate-table-surface"
      >
        <header className="candidate-table-surface-header">
          <span>Saved views</span>
          <span className="candidate-read-only-status">
            Preview · Read-only
          </span>
        </header>
        <nav
          aria-label={`${table.objectLabel} saved views`}
          className="candidate-saved-view-tabs"
        >
          {savedViews.map((view) => (
            <Link
              aria-current={view.viewKey === table.viewKey ? "page" : undefined}
              href={`/start/preview/${encodeURIComponent(candidateTablePageKey(view.viewKey))}?candidate=${encodeURIComponent(model.checksum)}`}
              key={view.viewKey}
            >
              {view.name}
            </Link>
          ))}
        </nav>
        <CandidateTableWorkspace
          recordTypeLabel={table.recordTypeLabel}
          table={table.table}
        />
      </section>
    </section>
  );
}
