import Link from "next/link";
import type { ReactNode } from "react";

import { signOut } from "../../auth/actions";
import { requireAuthenticatedUser } from "../../auth/authorization";
import { Notice } from "../../components/notice";
import { createServerClient } from "../../db/supabase/server";
import { readSearchParam, type SearchParams } from "../../lib/search-params";
import { createBusiness } from "../../tenancy/actions";

interface OnboardingPageProps {
  searchParams: SearchParams;
}

export default async function OnboardingPage({
  searchParams,
}: Readonly<OnboardingPageProps>): Promise<ReactNode> {
  const supabase = await createServerClient();
  const user = await requireAuthenticatedUser(supabase);
  const error = await readSearchParam(searchParams, "error");
  const { data: businesses } = await supabase
    .from("businesses")
    .select("id, name, slug")
    .order("created_at");

  return (
    <main className="narrow-page">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Business setup</p>
            <h1 className="page-title">Create a business</h1>
          </div>
          <form action={signOut}>
            <button className="button-secondary" type="submit">
              Sign out
            </button>
          </form>
        </div>

        <p className="muted">
          Signed in as {user.email ?? "your account"}. Add the essentials now;
          you can manage locations next.
        </p>

        {businesses && businesses.length > 0 ? (
          <div className="existing-businesses">
            <h2>Your businesses</h2>
            <ul>
              {businesses.map((business) => (
                <li key={business.id}>
                  <Link href={`/app/${business.slug}`}>{business.name}</Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? <Notice kind="error">{error}</Notice> : null}

        <form action={createBusiness} className="stack-form">
          <label>
            Business name
            <input maxLength={120} name="name" required />
          </label>
          <label>
            Business type
            <input
              defaultValue="other"
              maxLength={80}
              name="businessType"
              required
            />
          </label>
          <label>
            Timezone
            <input defaultValue="UTC" maxLength={80} name="timezone" required />
          </label>
          <button type="submit">Create business</button>
        </form>
      </section>
    </main>
  );
}
