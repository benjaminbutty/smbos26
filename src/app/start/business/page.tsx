import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { acquisitionCategoryLabel } from "../../../core/acquisition/schemas";
import { loadAcquisitionSession } from "../../../core/acquisition/service";
import { requireAuthenticatedUser } from "../../../auth/authorization";
import { createServerClient } from "../../../db/supabase/server";
import { Notice } from "../../../components/notice";
import { TimezoneConfirmation } from "../../../components/timezone-confirmation";
import { PendingSubmitButton } from "../../../components/pending-submit-button";
import { emitAcquisitionEvent } from "../../../core/acquisition/events";
import { readSearchParam, type SearchParams } from "../../../lib/search-params";
import { claimWorkspaceAction } from "../actions";

interface BusinessSetupPageProps {
  searchParams: SearchParams;
}

export default async function BusinessSetupPage({
  searchParams,
}: Readonly<BusinessSetupPageProps>): Promise<ReactNode> {
  const supabase = await createServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (typeof claims?.claims?.sub !== "string") {
    redirect("/sign-up?returnTo=%2Fstart%2Fbusiness");
  }
  const user = await requireAuthenticatedUser(supabase);
  const [session, error] = await Promise.all([
    loadAcquisitionSession(),
    readSearchParam(searchParams, "error"),
  ]);

  if (!session || session.expired) {
    redirect(
      "/start?error=This+proposal+has+expired.+Start+again+to+prepare+a+fresh+one.&state=expired",
    );
  }

  const proposal = session.payload?.proposal;
  if (!proposal) {
    redirect(
      "/start?error=Answer+Lenni%27s+questions+before+creating+a+workspace.&state=detail",
    );
  }
  emitAcquisitionEvent("create_workspace_clicked", {
    category: proposal.category,
    source: proposal.source,
  });
  return (
    <main className="narrow-page acquisition-business-page">
      <section className="panel">
        <p className="eyebrow">Your plan is ready</p>
        <h1 className="page-title">Save it and create your workspace</h1>
        <p className="muted">
          Signed in as {user.email ?? "your account"}. Lenni will create the
          starting workspace you just reviewed for{" "}
          {acquisitionCategoryLabel(proposal.category).toLocaleLowerCase("en")}.
        </p>

        <div className="acquisition-business-summary">
          <strong>{proposal.title}</strong>
          <span>
            {proposal.concepts.map((concept) => concept.name).join(" · ")}
          </span>
        </div>

        {error ? <Notice kind="error">{error}</Notice> : null}

        <form action={claimWorkspaceAction} className="stack-form">
          <label>
            Business name
            <input
              autoComplete="organization"
              maxLength={120}
              name="businessName"
              required
            />
          </label>
          <TimezoneConfirmation />
          <PendingSubmitButton
            label="Create workspace"
            pendingLabel="Checking how the parts fit together…"
            statusId="workspace-create-progress"
          />
        </form>

        <p className="form-footer">
          No payment details, team setup or fake business records are added.
        </p>
        <p className="form-footer">
          <Link href="/start">Back to proposal</Link>
        </p>
      </section>
    </main>
  );
}
