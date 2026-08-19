import Link from "next/link";
import type { ReactNode } from "react";

import { signIn } from "../../auth/actions";
import { AcquisitionSetupSummary } from "../../components/acquisition-setup-summary";
import { Notice } from "../../components/notice";
import { candidateChecksum } from "../../core/acquisition/preview";
import { loadAcquisitionSession } from "../../core/acquisition/service";
import { readSearchParam, type SearchParams } from "../../lib/search-params";

interface SignInPageProps {
  searchParams: SearchParams;
}

export default async function SignInPage({
  searchParams,
}: Readonly<SignInPageProps>): Promise<ReactNode> {
  const [error, message, returnTo] = await Promise.all([
    readSearchParam(searchParams, "error"),
    readSearchParam(searchParams, "message"),
    readSearchParam(searchParams, "returnTo"),
  ]);
  const signUpHref = returnTo
    ? `/sign-up?returnTo=${encodeURIComponent(returnTo)}`
    : "/sign-up";
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

  return (
    <main
      className={`narrow-page c7-auth-page${acceptedProposal ? " acquisition-auth-page" : ""}`}
    >
      {acceptedProposal ? (
        <AcquisitionSetupSummary proposal={acceptedProposal} />
      ) : null}
      <section className="panel c7-auth-panel">
        <p className="eyebrow">Welcome back</p>
        <h1 className="page-title">
          {isAcquisitionClaim ? "Sign in to save your setup" : "Sign in"}
        </h1>
        <p className="muted">
          {isAcquisitionClaim
            ? "Your accepted workspace is ready to continue after sign-in."
            : "Access the businesses you work with."}
        </p>
        <p className="c7-auth-note">
          {isAcquisitionClaim
            ? "Signing in does not create the Business. You will confirm Business basics next."
            : "Your access follows your account and each business role you hold."}
        </p>

        {error ? <Notice kind="error">{error}</Notice> : null}
        {message ? <Notice kind="message">{message}</Notice> : null}

        <form action={signIn} className="stack-form">
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
              autoComplete="current-password"
              minLength={8}
              name="password"
              required
              type="password"
            />
          </label>
          <button type="submit">
            {isAcquisitionClaim ? "Sign in and continue" : "Sign in"}
          </button>
        </form>

        <p className="form-footer">
          New to Lenni? <Link href={signUpHref}>Create an account</Link>
        </p>
      </section>
    </main>
  );
}
