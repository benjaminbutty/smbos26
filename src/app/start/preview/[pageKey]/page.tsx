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
  candidateTablePageKey,
  candidateTableKeyFromPageKey,
  type CandidatePreviewModel,
} from "../../../../core/acquisition/preview";
import type { AcquisitionProposal } from "../../../../core/acquisition/schemas";
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
  proposal,
}: Readonly<{
  model: CandidatePreviewModel;
  proposal: AcquisitionProposal;
}>): ReactNode {
  const internalPages = model.pages.filter(
    (page) => page.audience === "internal",
  );
  const publicPages = model.pages.filter((page) => page.audience === "public");
  const savedViews = Object.values(model.tables);
  const uniqueTables = Array.from(
    new Map(savedViews.map((table) => [table.objectKey, table])).values(),
  );
  const exampleRecordCount = uniqueTables.reduce(
    (count, table) => count + table.table.rows.length,
    0,
  );
  const connectionCount = new Set(
    uniqueTables.flatMap((table) =>
      table.table.columns
        .filter((column) => column.kind === "connection")
        .map(
          (column) =>
            column.connection?.relationshipKey ??
            `${table.objectKey}:${column.key}`,
        ),
    ),
  ).size;
  const firstTable = uniqueTables[0];
  const firstDestination = firstTable
    ? `/start/preview/${encodeURIComponent(candidateTablePageKey(firstTable.viewKey))}?candidate=${encodeURIComponent(model.checksum)}`
    : internalPages[0]
      ? `/start/preview/${encodeURIComponent(internalPages[0].key)}?candidate=${encodeURIComponent(model.checksum)}`
      : null;
  const summary = [
    ["Tables", uniqueTables.length, "business information types"],
    ["Saved views", savedViews.length, "ways to see the work"],
    ["Example Records", exampleRecordCount, "temporary examples"],
    ["Connections", connectionCount, "links between information"],
  ] as const;
  return (
    <section
      className="candidate-preview-home"
      aria-labelledby="candidate-preview-home-title"
    >
      <header className="candidate-preview-home-heading">
        <div>
          <p className="eyebrow">Home · Preview</p>
          <h1 id="candidate-preview-home-title">{model.title}</h1>
          <p className="candidate-preview-lede">
            This is the workspace Lenni has shaped for your business. Explore
            temporary examples to decide whether the setup feels right.
          </p>
        </div>
        <span className="candidate-preview-example-status">
          Temporary examples
        </span>
      </header>

      <dl
        aria-label="Candidate workspace summary"
        className="candidate-preview-stats"
      >
        {summary.map(([label, value, detail]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
            <small>{detail}</small>
          </div>
        ))}
      </dl>

      <div className="candidate-preview-home-layout">
        <section
          aria-labelledby="candidate-preview-explore-title"
          className="candidate-preview-explore"
        >
          <p className="eyebrow">Explore the setup</p>
          <h2 id="candidate-preview-explore-title">
            See the business information working together
          </h2>
          <p>
            Open a Table, select an example Record and inspect its connected
            information. Every preview surface is read-only.
          </p>
          <div className="candidate-preview-explore-actions">
            {firstDestination ? (
              <Link className="button" href={firstDestination}>
                Explore {firstTable?.objectLabel ?? "workspace"}
              </Link>
            ) : null}
            {publicPages[0] ? (
              <Link
                className="button-secondary"
                href={`/start/preview/${encodeURIComponent(publicPages[0].key)}?candidate=${encodeURIComponent(model.checksum)}`}
              >
                Review draft Site
              </Link>
            ) : null}
          </div>
        </section>

        <aside className="candidate-preview-setup-summary">
          <section aria-labelledby="candidate-preview-includes-title">
            <h2 id="candidate-preview-includes-title">This setup includes</h2>
            <ul>
              {uniqueTables.map((table) => (
                <li key={table.objectKey}>{table.objectLabel}</li>
              ))}
              {publicPages.map((page) => (
                <li key={page.key}>{page.title} · Draft Site</li>
              ))}
            </ul>
          </section>
          {proposal.not_included.length > 0 ? (
            <section aria-labelledby="candidate-preview-not-included-title">
              <h2 id="candidate-preview-not-included-title">Not included</h2>
              <ul>
                {proposal.not_included.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
      <p className="candidate-preview-home-note">
        These example Records and Connections exist only in this preview. No
        Business, customer information, booking or submission has been created.
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
      <HomePreview model={model} proposal={session.payload.proposal} />
    ) : (
      (() => {
        const tableKey = candidateTableKeyFromPageKey(pageKey);
        const table = tableKey ? model.tables[tableKey] : undefined;
        if (table) return <CandidatePreviewTable model={model} table={table} />;
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
