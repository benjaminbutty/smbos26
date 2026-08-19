import type { ReactNode } from "react";

import type { CandidatePreviewModel } from "../core/acquisition/preview";
import type { AcquisitionProposal } from "../core/acquisition/schemas";

export function AcquisitionSetupSummary({
  model,
  proposal,
  status = "Setup ready to save",
}: Readonly<{
  model?: CandidatePreviewModel;
  proposal: AcquisitionProposal;
  status?: string;
}>): ReactNode {
  const savedViews = model ? Object.values(model.tables) : [];
  const candidateTables = model
    ? Array.from(
        new Map(savedViews.map((table) => [table.objectKey, table])).values(),
      )
    : [];
  const includedInformation = model
    ? candidateTables.map((table) => table.objectLabel)
    : proposal.concepts.map((concept) => concept.name);
  const counts = [
    ["Tables", model ? candidateTables.length : proposal.concepts.length],
    ["Saved views", model ? savedViews.length : proposal.views.length],
    ["Pages", model ? model.pages.length : proposal.pages.length],
  ] as const;

  return (
    <section
      aria-labelledby="accepted-setup-title"
      className="acquisition-setup-summary"
    >
      <span className="acquisition-setup-status">{status}</span>
      <div>
        <p className="eyebrow">Your Lenni workspace</p>
        <h2 id="accepted-setup-title">{model?.title ?? proposal.title}</h2>
        <p>{proposal.understanding}</p>
      </div>
      <ul aria-label="Business information included">
        {includedInformation.map((label) => (
          <li key={label}>{label}</li>
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
