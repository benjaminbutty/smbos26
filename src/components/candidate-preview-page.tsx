import type { ReactNode } from "react";

import type {
  CandidatePreviewModel,
  CandidatePreviewPage as CandidatePage,
} from "../core/acquisition/preview";
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
  table,
}: Readonly<{
  table: CandidatePreviewModel["tables"][string];
}>): ReactNode {
  return (
    <section className="tenant-content runtime-page candidate-preview-content">
      <header className="page-preview-header">
        <div>
          <p className="eyebrow">Work · Table</p>
          <h1 className="runtime-title">{table.name}</h1>
          <p className="candidate-preview-page-note">
            Example Records and Connections are shown so you can understand this
            saved View. Nothing can be edited in preview.
          </p>
        </div>
      </header>
      <section className="page-view-block">
        <header className="page-view-block-header">
          <div>
            <p className="eyebrow">Saved View</p>
            <strong>{table.name}</strong>
            <span>Example {table.objectLabel}</span>
          </div>
        </header>
        <CandidateTableWorkspace table={table.table} />
      </section>
    </section>
  );
}
