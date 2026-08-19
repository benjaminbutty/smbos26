import type { ReactNode } from "react";

import type { AcquisitionProposal } from "../core/acquisition/schemas";

export function AcquisitionSetupSummary({
  proposal,
  status = "Setup ready to save",
}: Readonly<{
  proposal: AcquisitionProposal;
  status?: string;
}>): ReactNode {
  const counts = [
    ["Tables", proposal.concepts.length],
    ["Saved views", proposal.views.length],
    ["Pages", proposal.pages.length],
  ] as const;

  return (
    <section
      aria-labelledby="accepted-setup-title"
      className="acquisition-setup-summary"
    >
      <span className="acquisition-setup-status">{status}</span>
      <div>
        <p className="eyebrow">Your Lenni workspace</p>
        <h2 id="accepted-setup-title">{proposal.title}</h2>
        <p>{proposal.understanding}</p>
      </div>
      <ul aria-label="Business information included">
        {proposal.concepts.map((concept) => (
          <li key={concept.name}>{concept.name}</li>
        ))}
      </ul>
      <dl>
        {counts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="acquisition-setup-summary-note">
        Preview examples are temporary and will not be copied into your
        Business.
      </p>
    </section>
  );
}
