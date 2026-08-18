import type { ReactNode } from "react";
import Link from "next/link";

import { refineAcquisitionAction } from "../app/start/actions";
import {
  acquisitionClarificationQuestions,
  type AcquisitionClarificationState,
} from "../core/acquisition/clarification";
import { ACQUISITION_SUCCESSFUL_REFINEMENT_LIMIT } from "../core/acquisition/service";
import { PendingSubmitButton } from "./pending-submit-button";

export function AcquisitionRefinement({
  request,
  state,
  successfulRefinements,
}: Readonly<{
  request: string;
  state: AcquisitionClarificationState;
  successfulRefinements: number;
}>): ReactNode {
  const refinementsRemaining = Math.max(
    0,
    ACQUISITION_SUCCESSFUL_REFINEMENT_LIMIT - successfulRefinements,
  );
  return (
    <section
      aria-labelledby="acquisition-refinement-title"
      className="acquisition-conversation acquisition-refinement"
    >
      <div className="acquisition-conversation-intent">
        <p className="acquisition-section-label">Your starting point</p>
        <p>{request}</p>
      </div>
      {state.answers.length > 0 ? (
        <div className="acquisition-conversation-history">
          {state.answers.map((answer) => (
            <div className="acquisition-conversation-answer" key={answer.key}>
              <small>{acquisitionClarificationQuestions[answer.key]}</small>
              <p>{answer.answer}</p>
            </div>
          ))}
        </div>
      ) : null}
      <div className="acquisition-conversation-question">
        <p className="eyebrow">Refine this starting point</p>
        <h2 id="acquisition-refinement-title">
          What would you like Lenni to change before you preview it again?
        </h2>
        {refinementsRemaining > 0 ? (
          <form action={refineAcquisitionAction} className="acquisition-form">
            <label className="acquisition-request-label">
              <span>Your refinement</span>
              <textarea
                autoFocus
                maxLength={500}
                name="refinement"
                placeholder="For example: keep the service on each Booking instead of making Services separate."
                required
                rows={3}
              />
            </label>
            <PendingSubmitButton
              label="Update preview"
              pendingLabel="Updating your starting point…"
              statusId="acquisition-refinement-progress"
            />
          </form>
        ) : (
          <p className="muted">
            You have used the two successful refinements in this starting
            session. Preview the current setup or start a new proposal.
          </p>
        )}
        <Link className="button button-secondary" href="/start/preview/home">
          Preview workspace
        </Link>
      </div>
      <p className="acquisition-conversation-limit">
        {refinementsRemaining} successful refinement
        {refinementsRemaining === 1 ? "" : "s"} remaining in this bounded Lenni
        session. Failed or unsafe attempts do not use this allowance.
      </p>
    </section>
  );
}
