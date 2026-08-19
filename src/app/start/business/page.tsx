import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { acquisitionCategoryLabel } from "../../../core/acquisition/schemas";
import { candidateChecksum } from "../../../core/acquisition/preview";
import { loadAcquisitionSession } from "../../../core/acquisition/service";
import { requireAuthenticatedUser } from "../../../auth/authorization";
import { createServerClient } from "../../../db/supabase/server";
import { AcquisitionSetupSummary } from "../../../components/acquisition-setup-summary";
import { Notice } from "../../../components/notice";
import { WorkspaceClaimForm } from "../../../components/workspace-claim-form";
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
  const currentChecksum = candidateChecksum(
    session.payload,
    Math.max(1, session.row.proposal_count),
  );
  if (
    session.row.accepted_candidate_checksum !== currentChecksum ||
    !session.row.accepted_at
  ) {
    redirect(
      "/start?from=preview&error=Choose+Use+this+setup+in+the+preview+before+creating+the+workspace.&state=detail",
    );
  }
  emitAcquisitionEvent("create_workspace_clicked", {
    category: proposal.category,
    source: proposal.source,
  });
  return (
    <main className="narrow-page acquisition-business-page">
      <div className="acquisition-business-layout">
        <AcquisitionSetupSummary proposal={proposal} status="Accepted setup" />
        <section className="panel acquisition-business-panel">
          <p className="eyebrow">Business basics</p>
          <h1 className="page-title">Create your real workspace</h1>
          <p className="muted">
            Signed in as {user.email ?? "your account"}. Add the details needed
            to create this{" "}
            {acquisitionCategoryLabel(proposal.category).toLocaleLowerCase(
              "en",
            )}{" "}
            workspace.
          </p>

          {error ? (
            <div className="acquisition-claim-error">
              <strong>Your Business was not created.</strong>
              <Notice kind="error">{error}</Notice>
            </div>
          ) : null}

          <WorkspaceClaimForm action={claimWorkspaceAction} />

          <p className="form-footer">
            Preview Records, customer details and bookings are not copied. No
            payment or team setup is added.
          </p>
          <p className="form-footer">
            <Link href="/start/preview/home">Back to preview</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
