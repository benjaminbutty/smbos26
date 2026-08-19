import Link from "next/link";
import type { ReactNode } from "react";

import type { AcquisitionProposal } from "../core/acquisition/schemas";
import { AcquisitionJourneyOrientation } from "./acquisition-journey-orientation";
import { Notice } from "./notice";

interface AcquisitionProposalProps {
  proposal: AcquisitionProposal;
}

export function AcquisitionProposalCard({
  proposal,
}: Readonly<AcquisitionProposalProps>): ReactNode {
  const summary = [
    ["Tables", proposal.concepts.length],
    ["Connections", proposal.connections.length],
    ["Saved views", proposal.views.length],
    ["Pages", proposal.pages.length],
  ] as const;

  return (
    <div className="acquisition-stage acquisition-map-stage">
      <AcquisitionJourneyOrientation current="shaping" />
      <section
        aria-labelledby="proposal-title"
        className="acquisition-proposal acquisition-workspace-map"
      >
        <header className="acquisition-proposal-heading">
          <div>
            <p className="eyebrow">Here&apos;s what Lenni understood</p>
            <h2 id="proposal-title">How your business fits together</h2>
            <p className="acquisition-proposal-title">{proposal.title}</p>
          </div>
          <span className="acquisition-proposal-status">
            {proposal.source === "tailored"
              ? "Ready to explore"
              : "Reliable starting point"}
          </span>
        </header>

        {proposal.source === "fallback" ? (
          <Notice kind="message">
            Lenni is using a reliable starting point for this kind of work. You
            can explore it now and edit the ordinary workspace later.
          </Notice>
        ) : null}

        {proposal.refinement_summary ? (
          <section
            aria-labelledby="acquisition-refinement-summary-title"
            className="acquisition-refinement-summary"
          >
            <p
              className="acquisition-section-label"
              id="acquisition-refinement-summary-title"
            >
              What changed
            </p>
            <p>{proposal.refinement_summary.headline}</p>
            <div className="acquisition-refinement-summary-grid">
              {(
                [
                  ["Added", proposal.refinement_summary.added],
                  ["Updated", proposal.refinement_summary.updated],
                  ["Removed", proposal.refinement_summary.removed],
                  ["Kept", proposal.refinement_summary.preserved],
                ] as const
              ).map(([label, items]) =>
                items.length > 0 ? (
                  <div key={label}>
                    <strong>{label}</strong>
                    <ul>
                      {items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )}
            </div>
          </section>
        ) : null}

        <section
          aria-labelledby="proposal-understanding-heading"
          className="acquisition-understanding"
        >
          <p
            className="acquisition-section-label"
            id="proposal-understanding-heading"
          >
            {proposal.source === "tailored"
              ? "Your business, in Lenni's words"
              : "What this starting point covers"}
          </p>
          <p>{proposal.understanding}</p>
        </section>

        <section
          aria-labelledby="workspace-map-title"
          className="acquisition-map-surface"
        >
          <div className="acquisition-map-heading">
            <div>
              <p className="acquisition-section-label">Your workspace map</p>
              <h3 id="workspace-map-title">The parts you&apos;ll work with</h3>
            </div>
            <p>
              These are business parts, not technical settings. You can inspect
              how they work together in the preview.
            </p>
          </div>

          <ol className="acquisition-map-concepts">
            {proposal.concepts.map((concept, index) => (
              <li key={concept.name}>
                <article className="acquisition-map-concept">
                  <span aria-hidden="true" className="acquisition-map-index">
                    {index + 1}
                  </span>
                  <div>
                    <h4>{concept.name}</h4>
                    <p>{concept.description}</p>
                    {concept.tracked_information.length > 0 ? (
                      <small>
                        Keeps {concept.tracked_information.join(", ")}
                      </small>
                    ) : null}
                  </div>
                </article>
              </li>
            ))}
          </ol>

          <section
            aria-labelledby="proposal-connections-heading"
            className="acquisition-map-connections"
          >
            <p
              className="acquisition-section-label"
              id="proposal-connections-heading"
            >
              How the work connects
            </p>
            {proposal.connections.length > 0 ? (
              <ul className="acquisition-connection-list">
                {proposal.connections.map((connection) => (
                  <li key={connection.text}>{connection.text}</li>
                ))}
              </ul>
            ) : (
              <p className="acquisition-empty-detail">
                These starting parts stay separate and easy to understand.
              </p>
            )}
          </section>
        </section>

        <div className="acquisition-map-supporting">
          <section aria-labelledby="proposal-includes-heading">
            <h3 id="proposal-includes-heading">This setup includes</h3>
            <dl className="acquisition-map-summary">
              {summary.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="proposal-why-heading">
            <h3 id="proposal-why-heading">Why this shape</h3>
            <p>{proposal.why}</p>
            <div className="acquisition-first-step">
              <strong>When you create it</strong>
              <span>{proposal.first_step}</span>
            </div>
          </section>

          {proposal.not_included.length > 0 ? (
            <section
              aria-labelledby="proposal-exclusions-heading"
              className="acquisition-exclusions"
            >
              <h3 id="proposal-exclusions-heading">Not included</h3>
              <ul>
                {proposal.not_included.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <small>You can add more later.</small>
            </section>
          ) : null}
        </div>

        <div className="acquisition-proposal-actions">
          <Link className="button" href="/start/preview/home">
            Preview workspace
          </Link>
          <Link className="button-secondary" href="/start?from=preview">
            Something&apos;s missing
          </Link>
          <span>
            The preview is read-only. Nothing is created until you later choose
            Create workspace.
          </span>
        </div>
      </section>
    </div>
  );
}
