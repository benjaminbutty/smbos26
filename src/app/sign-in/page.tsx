import Link from "next/link";
import type { ReactNode } from "react";

import { signIn } from "../../auth/actions";
import { Notice } from "../../components/notice";
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

  return (
    <main className="narrow-page c7-auth-page">
      <section className="panel c7-auth-panel">
        <p className="eyebrow">Welcome back</p>
        <h1 className="page-title">Sign in</h1>
        <p className="muted">Access the businesses you work with.</p>
        <p className="c7-auth-note">
          Your access follows your account and each business role you hold.
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
          <button type="submit">Sign in</button>
        </form>

        <p className="form-footer">
          New to SMBOS? <Link href={signUpHref}>Create an account</Link>
        </p>
      </section>
    </main>
  );
}
