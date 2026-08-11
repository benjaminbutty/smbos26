import Link from "next/link";
import type { ReactNode } from "react";

import { AcquisitionProposalCard } from "../../components/acquisition-proposal";
import { Notice } from "../../components/notice";
import { createProposalAction } from "./actions";
import {
  acquisitionCategoryOptions,
  type AcquisitionCategory,
} from "../../core/acquisition/schemas";
import { loadAcquisitionSession } from "../../core/acquisition/service";
import { readSearchParam, type SearchParams } from "../../lib/search-params";

interface StartPageProps {
  searchParams: SearchParams;
}

function categoryValue(value: unknown): AcquisitionCategory {
  return value === "delivery" || value === "jobs" || value === "other"
    ? value
    : "appointments";
}

export default async function StartPage({
  searchParams,
}: Readonly<StartPageProps>): Promise<ReactNode> {
  const [session, error] = await Promise.all([
    loadAcquisitionSession(),
    readSearchParam(searchParams, "error"),
  ]);
  const activeSession = session && !session.expired ? session : null;
  const activeProposal = activeSession?.payload.proposal ?? null;
  const selectedCategory = categoryValue(activeProposal?.category);

  return (
    <main className="acquisition-page">
      <section className="acquisition-hero" aria-labelledby="start-title">
        <p className="eyebrow">Start with Lenni</p>
        <h1 id="start-title">Build the system your business actually needs.</h1>
        <p>
          Tell Lenni what you want to organise. You&apos;ll see a clear starting
          point before you create an account or workspace.
        </p>
      </section>

      {error ? <Notice kind="error">{error}</Notice> : null}
      {session?.expired ? (
        <Notice kind="message">
          This proposal has expired. Start again below and Lenni will prepare a
          fresh starting point.
        </Notice>
      ) : null}

      {activeProposal ? (
        <>
          <AcquisitionProposalCard proposal={activeProposal} />
          <section
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
              submitLabel="Regenerate proposal"
            />
          </section>
        </>
      ) : (
        <ProposalForm
          defaultCategory="appointments"
          submitLabel="See my starting point"
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
  submitLabel,
}: Readonly<{
  defaultCategory: AcquisitionCategory;
  defaultRequest?: string;
  submitLabel: string;
}>): ReactNode {
  return (
    <form action={createProposalAction} className="acquisition-form">
      <fieldset>
        <legend>What kind of work do you want to organise?</legend>
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

      <label className="acquisition-request-label">
        Describe what you need
        <textarea
          defaultValue={defaultRequest}
          maxLength={4_000}
          name="request"
          placeholder="I run a dog grooming business and need to manage customers, pets, appointments and services."
          required
          rows={5}
        />
        <small>Use your own words. A few sentences is enough.</small>
      </label>

      <button type="submit">{submitLabel}</button>
    </form>
  );
}
