import type { ReactNode } from "react";

import {
  acquisitionClarificationQuestions,
  questionText,
  type AcquisitionClarificationState,
} from "../core/acquisition/clarification";
import { answerClarificationAction } from "../app/start/actions";
import { AcquisitionJourneyOrientation } from "./acquisition-journey-orientation";
import { PendingSubmitButton } from "./pending-submit-button";

export function AcquisitionConversation({
  request,
  state,
}: Readonly<{
  request: string;
  state: AcquisitionClarificationState;
}>): ReactNode {
  const currentQuestion = state.asked_keys.find(
    (key) => !state.answers.some((answer) => answer.key === key),
  );
  if (!currentQuestion) return null;
  const questionNumber = Math.min(3, state.answers.length + 1);

  return (
    <div className="acquisition-stage">
      <AcquisitionJourneyOrientation current="understanding" />
      <section
        aria-labelledby="acquisition-conversation-title"
        className="acquisition-conversation"
      >
        <div className="acquisition-conversation-intent">
          <p className="acquisition-section-label">Your starting point</p>
          <p>{request}</p>
        </div>

        <div className="acquisition-conversation-history" aria-live="polite">
          {state.answers.map((answer) => (
            <div className="acquisition-conversation-answer" key={answer.key}>
              <small>{acquisitionClarificationQuestions[answer.key]}</small>
              <p>{answer.answer}</p>
            </div>
          ))}
        </div>

        <div className="acquisition-conversation-question">
          <div className="acquisition-question-kicker">
            <p className="eyebrow">A quick question</p>
            <span>Question {questionNumber} of up to 3</span>
          </div>
          <h2 id="acquisition-conversation-title">
            {questionText(currentQuestion)}
          </h2>
          <form action={answerClarificationAction} className="acquisition-form">
            <input name="question_key" type="hidden" value={currentQuestion} />
            <label className="acquisition-request-label">
              <span>Your answer</span>
              <textarea
                autoFocus
                maxLength={500}
                name="answer"
                placeholder="Tell Lenni what is true for your business."
                required
                rows={3}
              />
            </label>
            <PendingSubmitButton
              label="Continue"
              pendingLabel="Updating your starting point…"
              statusId="acquisition-clarification-progress"
            />
          </form>
        </div>

        <p className="acquisition-conversation-limit">
          Lenni asks only what can materially change this starting workspace.
        </p>
      </section>
    </div>
  );
}
