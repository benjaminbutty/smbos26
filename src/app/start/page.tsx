import Link from "next/link";
import type { ReactNode } from "react";

import { AcquisitionProposalCard } from "../../components/acquisition-proposal";
import { AcquisitionConversation } from "../../components/acquisition-conversation";
import { AcquisitionRefinement } from "../../components/acquisition-refinement";
import { AcquisitionRequestInput } from "../../components/acquisition-request-input";
import { Notice } from "../../components/notice";
import { PendingSubmitButton } from "../../components/pending-submit-button";
import { createProposalAction } from "./actions";
import {
  acquisitionCategoryOptions,
  type AcquisitionCategory,
} from "../../core/acquisition/schemas";
import { loadAcquisitionSession } from "../../core/acquisition/service";
import { emitAcquisitionEvent } from "../../core/acquisition/events";
import { readSearchParam, type SearchParams } from "../../lib/search-params";

interface StartPageProps {
  searchParams: SearchParams;
}

type AcquisitionState =
  "detail" | "expired" | "generic" | "limit" | "unavailable";

function acquisitionState(value: string | undefined): AcquisitionState {
  return value === "detail" ||
    value === "expired" ||
    value === "limit" ||
    value === "unavailable"
    ? value
    : "generic";
}

const stateLabels: Readonly<Record<AcquisitionState, string>> = {
  detail: "A little more detail will help",
  expired: "Start a fresh proposal",
  generic: "We need to try that again",
  limit: "Free builds used for today",
  unavailable: "Lenni is temporarily unavailable",
};

function categoryValue(value: unknown): AcquisitionCategory {
  return acquisitionCategoryOptions.some((option) => option.value === value)
    ? (value as AcquisitionCategory)
    : "appointments";
}

export default async function StartPage({
  searchParams,
}: Readonly<StartPageProps>): Promise<ReactNode> {
  const [session, error, rawState, rawFrom] = await Promise.all([
    loadAcquisitionSession(),
    readSearchParam(searchParams, "error"),
    readSearchParam(searchParams, "state"),
    readSearchParam(searchParams, "from"),
  ]);
  const state = acquisitionState(rawState);
  const fromPreview = rawFrom === "preview";
  const activeSession = session && !session.expired ? session : null;
  const activeProposal = activeSession?.payload?.proposal ?? null;
  const selectedCategory = categoryValue(activeProposal?.category);
  emitAcquisitionEvent("public_build_viewed", {
    has_proposal: Boolean(activeProposal),
  });

  return (
    <main className="acquisition-page">
      <section className="acquisition-hero" aria-labelledby="start-title">
        <p className="eyebrow">Start with Lenni</p>
        <h1 id="start-title">Tell Lenni about your business</h1>
        <p>
          Describe the work you run and Lenni will suggest a setup to get you
          started
        </p>
      </section>

      {error ? (
        <section
          aria-labelledby="acquisition-state-title"
          className={`acquisition-state acquisition-state-${state}`}
        >
          <p className="acquisition-state-label" id="acquisition-state-title">
            {stateLabels[state]}
          </p>
          <Notice kind="error">{error}</Notice>
          {state === "detail" || state === "expired" || state === "limit" ? (
            <Link className="button-secondary" href="/start">
              Start again
            </Link>
          ) : null}
        </section>
      ) : null}
      {!error && session?.expired ? (
        <Notice kind="message">
          This proposal has expired. Start again below and Lenni will prepare a
          fresh starting point.
        </Notice>
      ) : null}

      {activeSession?.clarification?.status === "awaiting_answer" &&
      !activeProposal ? (
        <AcquisitionConversation
          request={activeSession.row.request_text ?? ""}
          state={activeSession.clarification}
        />
      ) : activeSession &&
        activeProposal &&
        fromPreview &&
        activeSession.clarification ? (
        <AcquisitionRefinement
          request={activeSession.row.request_text ?? ""}
          state={activeSession.clarification}
          successfulRefinements={activeSession.row.successful_refinement_count}
        />
      ) : activeProposal ? (
        <>
          <AcquisitionProposalCard proposal={activeProposal} />
          <section
            id="revise"
            className="acquisition-revise"
            aria-labelledby="revise-title"
          >
            <div>
              <p className="acquisition-section-label" id="revise-title">
                Want to change the starting point?
              </p>
              <p>
                Update your description and Lenni will prepare one more version.
              </p>
            </div>
            <ProposalForm
              defaultCategory={selectedCategory}
              defaultRequest={activeSession?.row.request_text ?? ""}
              formKey="revise"
              submitLabel="Regenerate proposal"
            />
          </section>
        </>
      ) : (
        <ProposalForm
          defaultCategory="appointments"
          formKey="initial"
          submitLabel="Start building"
        />
      )}

      <p className="acquisition-manual-route">
        Prefer to shape things yourself?{" "}
        <Link href="/sign-up">Build manually</Link>
      </p>
    </main>
  );
}

function ProposalForm({
  defaultCategory,
  defaultRequest = "",
  formKey,
  submitLabel,
}: Readonly<{
  defaultCategory: AcquisitionCategory;
  defaultRequest?: string;
  formKey: "initial" | "revise";
  submitLabel: string;
}>): ReactNode {
  return (
    <form action={createProposalAction} className="acquisition-form">
      <fieldset>
        <legend>What best describes the work?</legend>
        <div className="acquisition-category-grid">
          {acquisitionCategoryOptions.map((option) => (
            <label className="acquisition-category-option" key={option.value}>
              <input
                defaultChecked={option.value === defaultCategory}
                name="category"
                type="radio"
                value={option.value}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <AcquisitionRequestInput defaultValue={defaultRequest} />

      <PendingSubmitButton
        label={submitLabel}
        pendingLabel="Preparing your starting point…"
        statusId={`acquisition-${formKey}-progress`}
      />
    </form>
  );
}
