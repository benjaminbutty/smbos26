import Link from "next/link";
import type { ReactNode } from "react";

import { signUp } from "../../auth/actions";
import { Notice } from "../../components/notice";
import { readSearchParam, type SearchParams } from "../../lib/search-params";

interface SignUpPageProps {
  searchParams: SearchParams;
}

export default async function SignUpPage({
  searchParams,
}: Readonly<SignUpPageProps>): Promise<ReactNode> {
  const error = await readSearchParam(searchParams, "error");

  return (
    <main className="narrow-page">
      <section className="panel">
        <p className="eyebrow">Create your account</p>
        <h1 className="page-title">Get started</h1>
        <p className="muted">
          Use your work email and a password of at least 8 characters.
        </p>

        {error ? <Notice kind="error">{error}</Notice> : null}

        <form action={signUp} className="stack-form">
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
          <button type="submit">Create account</button>
        </form>

        <p className="form-footer">
          Already have an account? <Link href="/sign-in">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
