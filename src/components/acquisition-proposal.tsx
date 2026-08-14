import Link from "next/link";
import type { ReactNode } from "react";

import { Notice } from "./notice";
import type { AcquisitionProposal } from "../core/acquisition/schemas";

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
    <section aria-labelledby="proposal-title" className="acquisition-proposal">
      <div className="acquisition-proposal-heading">
        <div>
          <p className="eyebrow">Ready to create</p>
          <h2 id="proposal-title">Your starting Lenni workspace</h2>
          <p className="acquisition-proposal-title">{proposal.title}</p>
        </div>

        <aside aria-label="Your plan" className="acquisition-plan-summary">
          <strong>Your plan</strong>
          <span>Workspace summary</span>
          <dl>
            {summary.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>

      <div className="acquisition-proposal-status-row">
        <span className="acquisition-proposal-status">
          {proposal.source === "tailored"
            ? "Ready to review"
            : "Reliable starting point"}
        </span>
        {proposal.source === "fallback" ? (
          <Notice kind="message">
            Lenni is using a reliable starting point based on the kind of work
            you selected. You can edit the workspace after you create it.
          </Notice>
        ) : null}
      </div>

      <section
        aria-labelledby="proposal-understanding-heading"
        className="acquisition-understanding"
      >
        <p
          className="acquisition-section-label"
          id="proposal-understanding-heading"
        >
          {proposal.source === "tailored"
            ? "What Lenni understood"
            : "What this starting point covers"}
        </p>
        <p>{proposal.understanding}</p>
      </section>

      <div className="acquisition-proposal-sections">
        <section aria-labelledby="proposal-workspace-heading">
          <h3 id="proposal-workspace-heading">What Lenni will create</h3>
          <div className="acquisition-concept-list">
            {proposal.concepts.map((concept) => (
              <article className="acquisition-concept" key={concept.name}>
                <h4>{concept.name}</h4>
                <p>{concept.description}</p>
                {concept.tracked_information.length > 0 ? (
                  <small>
                    Tracks {concept.tracked_information.join(", ")}.
                  </small>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="proposal-connections-heading">
          <h3 id="proposal-connections-heading">How it fits together</h3>
          {proposal.connections.length > 0 ? (
            <ul className="acquisition-connection-list">
              {proposal.connections.map((connection) => (
                <li key={connection.text}>{connection.text}</li>
              ))}
            </ul>
          ) : (
            <p className="acquisition-empty-detail">
              Lenni will keep the starting information separate and editable.
            </p>
          )}
        </section>

        <section aria-labelledby="proposal-visibility-heading">
          <h3 id="proposal-visibility-heading">What you&apos;ll see</h3>
          {proposal.views.length > 0 ? (
            <>
              <p className="acquisition-section-label">Saved views</p>
              <div className="acquisition-view-list">
                {proposal.views.map((view) => (
                  <div className="acquisition-page-preview" key={view.name}>
                    <strong>{view.name}</strong>
                    <span>{view.description}</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          {proposal.pages.length > 0 ? (
            <>
              <p className="acquisition-section-label acquisition-page-label">
                Starting page
              </p>
              {proposal.pages.map((page) => (
                <div className="acquisition-page-preview" key={page.name}>
                  <strong>{page.name}</strong>
                  <span>{page.description}</span>
                </div>
              ))}
            </>
          ) : null}
        </section>

        <section aria-labelledby="proposal-why-heading">
          <h3 id="proposal-why-heading">Why this starting point</h3>
          <p>{proposal.why}</p>
        </section>
      </div>

      <div className="acquisition-first-step">
        <strong>First step</strong>
        <span>{proposal.first_step}</span>
      </div>

      {proposal.not_included.length > 0 ? (
        <section
          aria-labelledby="proposal-exclusions-heading"
          className="acquisition-exclusions"
        >
          <h3 id="proposal-exclusions-heading">Not included yet</h3>
          <ul>
            {proposal.not_included.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <small>You can add more later.</small>
        </section>
      ) : null}

      <div className="acquisition-proposal-actions">
        <Link className="button" href="/start/business">
          Create this workspace
        </Link>
        <Link className="button-secondary" href="/start#revise">
          Edit my request
        </Link>
        <span>There&apos;s no signup until you choose to create it.</span>
      </div>
    </section>
  );
}
