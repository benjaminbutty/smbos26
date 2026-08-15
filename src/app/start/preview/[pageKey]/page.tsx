import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { CandidatePreviewShell } from "../../../../components/candidate-preview-shell";
import {
  CandidatePreviewPage,
  CandidatePreviewTable,
} from "../../../../components/candidate-preview-page";
import {
  buildCandidatePreviewModel,
  candidateTableKeyFromPageKey,
  type CandidatePreviewModel,
} from "../../../../core/acquisition/preview";
import { loadAcquisitionSession } from "../../../../core/acquisition/service";
import {
  readSearchParam,
  type SearchParams,
} from "../../../../lib/search-params";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

interface CandidatePreviewRouteProps {
  params: Promise<{ pageKey: string }>;
  searchParams: SearchParams;
}

function HomePreview({
  model,
}: Readonly<{ model: CandidatePreviewModel }>): ReactNode {
  const internalPages = model.pages.filter(
    (page) => page.audience === "internal",
  );
  const publicPages = model.pages.filter((page) => page.audience === "public");
  const tableCount = Object.keys(model.tables).length;
  return (
    <section
      className="candidate-preview-home"
      aria-labelledby="candidate-preview-home-title"
    >
      <p className="eyebrow">Home</p>
      <h1 id="candidate-preview-home-title">
        A workspace shaped for your business
      </h1>
      <p className="candidate-preview-lede">
        Explore the example workspace Lenni prepared. The information here is
        temporary preview data, so you can decide whether the shape feels right.
      </p>
      <div className="candidate-preview-home-grid">
        <article>
          <p className="eyebrow">Work</p>
          <h2>{tableCount} Tables ready to explore</h2>
          <p>
            Open the destinations on the left to see example Records and how
            their Connections fit together.
          </p>
          {internalPages[0] ? (
            <Link
              className="button button-secondary"
              href={`/start/preview/${encodeURIComponent(internalPages[0].key)}?candidate=${encodeURIComponent(model.checksum)}`}
            >
              Explore Work
            </Link>
          ) : null}
        </article>
        <article>
          <p className="eyebrow">Next useful step</p>
          <h2>
            {publicPages.length > 0
              ? "Review your draft Site"
              : "Review your first workspace view"}
          </h2>
          <p>
            {publicPages.length > 0
              ? "See what a customer would experience before anything is published."
              : "Use the example Records to check that the starting system makes sense."}
          </p>
          {publicPages[0] ? (
            <Link
              className="button button-secondary"
              href={`/start/preview/${encodeURIComponent(publicPages[0].key)}?candidate=${encodeURIComponent(model.checksum)}`}
            >
              Review Site
            </Link>
          ) : null}
        </article>
      </div>
      <p className="candidate-preview-home-note">
        No business, configuration, Record, Connection, Form submission or
        booking has been created.
      </p>
    </section>
  );
}

export default async function CandidatePreviewRoute({
  params,
  searchParams,
}: Readonly<CandidatePreviewRouteProps>): Promise<ReactNode> {
  const { pageKey } = await params;
  const session = await loadAcquisitionSession();
  if (!session?.payload) {
    redirect(
      "/start?error=This preview is no longer available. Prepare a fresh starting point.&state=expired",
    );
  }
  const model = buildCandidatePreviewModel(
    session.payload,
    Math.max(1, session.row.proposal_count),
  );
  const requestedChecksum = await readSearchParam(searchParams, "candidate");
  if (!requestedChecksum) {
    redirect(
      `/start/preview/${encodeURIComponent(pageKey)}?candidate=${encodeURIComponent(model.checksum)}`,
    );
  }
  if (requestedChecksum !== model.checksum) {
    return (
      <main className="candidate-preview-page">
        <section className="candidate-preview-stale">
          <p className="eyebrow">Preview refreshed</p>
          <h1>This preview is no longer the latest starting point.</h1>
          <p>
            Lenni has a newer candidate for this acquisition session. Return to
            Lenni to review it before choosing a setup.
          </p>
          <Link className="button" href="/start?from=preview">
            Back to Lenni
          </Link>
        </section>
      </main>
    );
  }
  const content =
    pageKey === "home" ? (
      <HomePreview model={model} />
    ) : (
      (() => {
        const tableKey = candidateTableKeyFromPageKey(pageKey);
        const table = tableKey ? model.tables[tableKey] : undefined;
        if (table) return <CandidatePreviewTable table={table} />;
        const page = model.pages.find((candidate) => candidate.key === pageKey);
        if (!page) return null;
        return <CandidatePreviewPage model={model} page={page} />;
      })()
    );
  if (!content) notFound();
  return (
    <main className="candidate-preview-page">
      <CandidatePreviewShell
        candidateChecksum={model.checksum}
        currentPageKey={pageKey}
        pages={model.pages}
        tables={model.tables}
        title={model.title}
      >
        {content}
      </CandidatePreviewShell>
    </main>
  );
}
