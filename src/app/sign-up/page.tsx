import Link from "next/link";
import type { ReactNode } from "react";

import { signUp } from "../../auth/actions";
import { Notice } from "../../components/notice";
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
  if (returnTo === "/start/business") {
    emitAcquisitionEvent("signup_started", { route: "acquisition" });
  }

  return (
    <main className="narrow-page c7-auth-page">
      <section className="panel c7-auth-panel">
        <p className="eyebrow">Create your account</p>
        <h1 className="page-title">Get started</h1>
        <p className="muted">
          {isAcquisitionClaim
            ? "Create your account to save the workspace you just reviewed."
            : "Use your work email and a password of at least 8 characters."}
        </p>
        <p className="c7-auth-note">
          Your account is the key to the businesses and workspaces you are
          invited to use.
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
              ? "Save workspace and create account"
              : "Create account"}
          </button>
        </form>

        <p className="form-footer">
          Already have an account? <Link href={signInHref}>Sign in</Link>
        </p>
      </section>
    </main>
  );
}
