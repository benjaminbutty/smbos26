import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { hasCapability, resolveTenant } from "@/auth/authorization";
import { Notice } from "@/components/notice";
import {
  isControlledConfigurationReadError,
  ConfigurationChangeService,
} from "@/core/configuration/service";
import { createServerClient } from "@/db/supabase/server";
import { readSearchParam, type SearchParams } from "@/lib/search-params";

import { prepareManualListProposalAction } from "../../actions";
import { ManualListForm } from "./manual-list-form";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

interface NewManualListPageProps {
  params: Promise<{ businessSlug: string }>;
  searchParams: SearchParams;
}

function ManualListNotice({
  notice,
}: Readonly<{ notice: string | undefined }>): ReactNode {
  if (notice === "stale") {
    return (
      <Notice kind="error">
        Setup changed after this page was loaded. Reload and try again.
      </Notice>
    );
  }
  if (notice === "label_conflict") {
    return (
      <Notice kind="error">
        A list or information label with that wording already exists. Choose a
        different label.
      </Notice>
    );
  }
  if (notice === "identity_unavailable") {
    return (
      <Notice kind="error">
        This list could not be prepared safely. Try a different name.
      </Notice>
    );
  }
  if (notice === "input_invalid") {
    return (
      <Notice kind="error">
        Check the list details and try again. Choice and Status need at least
        two different options.
      </Notice>
    );
  }
  return null;
}

export default async function NewManualListPage({
  params,
  searchParams,
}: Readonly<NewManualListPageProps>): Promise<ReactNode> {
  const { businessSlug } = await params;
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  if (!hasCapability(tenant.membership.role, "manage_configuration")) {
    notFound();
  }

  const configuration = new ConfigurationChangeService(supabase, {
    businessId: tenant.business.id,
    actorId: tenant.user.id,
  });
  let currentness;
  try {
    currentness = await configuration.getProposalCurrentness();
  } catch (error) {
    if (isControlledConfigurationReadError(error)) {
      notFound();
    }
    throw error;
  }

  const notice = await readSearchParam(searchParams, "notice");
  const action = prepareManualListProposalAction.bind(null, businessSlug);

  return (
    <article className="tenant-content setup-page">
      <Link
        className="back-link"
        href={`/app/${encodeURIComponent(businessSlug)}/setup`}
      >
        ← Return to Edit setup
      </Link>
      <header className="history-detail-header">
        <div>
          <p className="eyebrow">Lists</p>
          <h1 className="runtime-title">Create a list</h1>
          <p className="lede">
            Keep one kind of business information together in a simple list.
          </p>
          <p className="muted">
            Your list will be prepared for review. It will not be live until an
            Owner or Admin deliberately Validates and Applies the proposal.
          </p>
        </div>
      </header>

      <ManualListNotice notice={notice} />
      <ManualListForm
        action={action}
        expectedBaseVersionId={currentness.expectedBaseVersionId}
        expectedHeadRevision={currentness.expectedHeadRevision}
      />
    </article>
  );
}
