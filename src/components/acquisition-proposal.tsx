import Link from "next/link";
import type { ReactNode } from "react";

import type { AcquisitionProposal } from "../core/acquisition/schemas";

interface AcquisitionProposalProps {
  proposal: AcquisitionProposal;
}

export function AcquisitionProposalCard({
  proposal,
}: Readonly<AcquisitionProposalProps>): ReactNode {
  return (
    <section aria-labelledby="proposal-title" className="acquisition-proposal">
      <div className="acquisition-proposal-heading">
        <div>
          <p className="eyebrow">Lenni&apos;s starting point</p>
          <h2 id="proposal-title">{proposal.title}</h2>
        </div>
        <span className="acquisition-proposal-status">Ready to review</span>
      </div>

      <div className="acquisition-understanding">
        <p className="acquisition-section-label">What Lenni understood</p>
        <p>{proposal.understanding}</p>
      </div>

      <div className="acquisition-proposal-grid">
        <section aria-labelledby="proposal-workspace-heading">
          <p
            className="acquisition-section-label"
            id="proposal-workspace-heading"
          >
            Your workspace
          </p>
          <div className="acquisition-concept-list">
            {proposal.concepts.map((concept) => (
              <article className="acquisition-concept" key={concept.name}>
                <h3>{concept.name}</h3>
                <p>{concept.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="proposal-connections-heading">
          <p
            className="acquisition-section-label"
            id="proposal-connections-heading"
          >
            How things fit together
          </p>
          <ul className="acquisition-connection-list">
            {proposal.connections.map((connection) => (
              <li key={connection.text}>{connection.text}</li>
            ))}
          </ul>

          <p className="acquisition-section-label acquisition-page-label">
            Your first page
          </p>
          {proposal.pages.map((page) => (
            <div className="acquisition-page-preview" key={page.name}>
              <strong>{page.name}</strong>
              <span>{page.description}</span>
            </div>
          ))}
        </section>
      </div>

      <div className="acquisition-first-step">
        <strong>When you&apos;re ready</strong>
        <span>{proposal.first_step}</span>
      </div>

      {proposal.not_included.length > 0 ? (
        <div className="acquisition-exclusions">
          <strong>Not included yet</strong>
          <span>{proposal.not_included.join(" · ")}</span>
          <small>You can add more later.</small>
        </div>
      ) : null}

      <div className="acquisition-proposal-actions">
        <Link className="button" href="/start/business">
          Create this workspace
        </Link>
        <span>There&apos;s no signup until you choose to create it.</span>
      </div>
    </section>
  );
}
