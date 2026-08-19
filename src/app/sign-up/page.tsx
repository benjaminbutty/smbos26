import Link from "next/link";
import type { ReactNode } from "react";

import { signUp } from "../../auth/actions";
import { AcquisitionSetupSummary } from "../../components/acquisition-setup-summary";
import { Notice } from "../../components/notice";
import { candidateChecksum } from "../../core/acquisition/preview";
import { loadAcquisitionSession } from "../../core/acquisition/service";
import { readSearchParam, type SearchParams } from "../../lib/search-params";
import { emitAcquisitionEvent } from "../../core/acquisition/events";

interface SignUpPageProps {
  searchParams: SearchParams;
}

export default async function SignUpPage({
  searchParams,
}: Readonly<SignUpPageProps>): Promise<ReactNode> {
  const [error, returnTo] = await Promise.all([
    readSearchParam(searchParams, "error"),
    readSearchParam(searchParams, "returnTo"),
  ]);
  const signInHref = returnTo
    ? `/sign-in?returnTo=${encodeURIComponent(returnTo)}`
    : "/sign-in";
  const isAcquisitionClaim = returnTo === "/start/business";
  const acquisitionSession = isAcquisitionClaim
    ? await loadAcquisitionSession()
    : null;
  const acceptedProposal =
    acquisitionSession?.payload &&
    !acquisitionSession.expired &&
    acquisitionSession.row.accepted_at &&
    acquisitionSession.row.accepted_candidate_checksum ===
      candidateChecksum(
        acquisitionSession.payload,
        Math.max(1, acquisitionSession.row.proposal_count),
      )
      ? acquisitionSession.payload.proposal
      : null;
  if (returnTo === "/start/business") {
    emitAcquisitionEvent("signup_started", { route: "acquisition" });
  }

  return (
    <main
      className={`narrow-page c7-auth-page${acceptedProposal ? " acquisition-auth-page" : ""}`}
    >
      {acceptedProposal ? (
        <AcquisitionSetupSummary proposal={acceptedProposal} />
      ) : null}
      <section className="panel c7-auth-panel">
        <p className="eyebrow">
          {isAcquisitionClaim ? "Setup ready to save" : "Create your account"}
        </p>
        <h1 className="page-title">
          {isAcquisitionClaim ? "Create your Lenni account" : "Get started"}
        </h1>
        <p className="muted">
          {isAcquisitionClaim
            ? "Use your email and a password to keep the setup you just reviewed."
            : "Use your work email and a password of at least 8 characters."}
        </p>
        <p className="c7-auth-note">
          {isAcquisitionClaim
            ? "Your accepted setup stays with this secure sign-up flow. It is not created until you confirm Business basics."
            : "Your account is the key to the businesses and workspaces you are invited to use."}
        </p>

        {error ? <Notice kind="error">{error}</Notice> : null}

        <form action={signUp} className="stack-form">
          {returnTo ? (
            <input name="returnTo" type="hidden" value={returnTo} />
          ) : null}
          <label>
            Email
            <input autoComplete="email" name="email" required type="email" />
          </label>
          <label>
            Password
            <input
              autoComplete="new-password"
              minLength={8}
              name="password"
              required
              type="password"
            />
          </label>
          <button type="submit">
            {isAcquisitionClaim
              ? "Save workspace and continue"
              : "Create account"}
          </button>
        </form>

        <p className="form-footer">
          Already have a Lenni account? <Link href={signInHref}>Sign in</Link>
        </p>
      </section>
    </main>
  );
}
