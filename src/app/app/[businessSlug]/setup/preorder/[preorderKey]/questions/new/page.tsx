import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { hasCapability, resolveTenant } from "@/auth/authorization";
import { Notice } from "@/components/notice";
import {
  getPreorderQuestionsSetup,
  loadActiveManualAmendmentSnapshot,
  ManualAmendmentError,
} from "@/core/configuration/manual-amendments/service";
import {
  ConfigurationChangeService,
  isControlledConfigurationReadError,
} from "@/core/configuration/service";
import { createServerClient } from "@/db/supabase/server";
import { readSearchParam, type SearchParams } from "@/lib/search-params";

import { prepareNewPreorderQuestionAmendmentAction } from "../../../../actions";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

interface NewPreorderQuestionPageProps {
  params: Promise<{ businessSlug: string; preorderKey: string }>;
  searchParams: SearchParams;
}

function NewQuestionNotice({
  notice,
}: Readonly<{ notice: string | undefined }>): ReactNode {
  if (notice === "stale") {
    return (
      <Notice kind="error">
        Setup changed after this page was loaded. Reload and try again.
      </Notice>
    );
  }
  if (notice === "duplicate_question") {
    return (
      <Notice kind="error">
        A question with that wording already exists for this preorder.
      </Notice>
    );
  }
  if (notice === "input_invalid") {
    return <Notice kind="error">Check the question and try again.</Notice>;
  }
  return null;
}

export default async function NewPreorderQuestionPage({
  params,
  searchParams,
}: Readonly<NewPreorderQuestionPageProps>): Promise<ReactNode> {
  const { businessSlug, preorderKey } = await params;
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  if (!hasCapability(tenant.membership.role, "manage_configuration")) {
    notFound();
  }
  const configuration = new ConfigurationChangeService(supabase, {
    businessId: tenant.business.id,
    actorId: tenant.user.id,
  });

  let active;
  let setup;
  try {
    active = await loadActiveManualAmendmentSnapshot(configuration);
    setup = getPreorderQuestionsSetup(active.snapshot, preorderKey);
  } catch (error) {
    if (
      error instanceof ManualAmendmentError ||
      isControlledConfigurationReadError(error)
    ) {
      notFound();
    }
    throw error;
  }
  const notice = await readSearchParam(searchParams, "notice");
  const submitAction = prepareNewPreorderQuestionAmendmentAction.bind(
    null,
    businessSlug,
    preorderKey,
  );
  const questionsPath = `/app/${encodeURIComponent(businessSlug)}/setup/preorder/${encodeURIComponent(preorderKey)}/questions`;

  return (
    <article className="tenant-content setup-page">
      <Link className="back-link" href={questionsPath}>
        ← Return to Questions customers answer
      </Link>
      <header className="history-detail-header">
        <div>
          <p className="eyebrow">Add preorder question</p>
          <h1 className="runtime-title">Add a question</h1>
          <p className="lede">{setup.label}</p>
          <p className="muted">
            The answer will be attached to each resulting order. Saving prepares
            a change for review; it does not change the live customer page.
          </p>
        </div>
      </header>

      <NewQuestionNotice notice={notice} />

      <form action={submitAction} className="panel compact-panel stack-form">
        <input
          name="expectedBaseVersionId"
          type="hidden"
          value={active.baseVersionId}
        />
        <input
          name="expectedHeadRevision"
          type="hidden"
          value={active.headRevision}
        />
        <label>
          Question wording
          <input maxLength={120} minLength={1} name="label" required />
        </label>
        <label>
          Help text <span className="muted">(optional)</span>
          <textarea maxLength={500} name="helpText" rows={4} />
        </label>
        <fieldset>
          <legend>Answer style</legend>
          <label className="checkbox-control">
            <input
              defaultChecked
              name="answerStyle"
              type="radio"
              value="short_answer"
            />
            Short answer
          </label>
          <label className="checkbox-control">
            <input name="answerStyle" type="radio" value="long_answer" />
            Long answer
          </label>
        </fieldset>
        <label className="checkbox-control">
          <input name="required" type="checkbox" />
          Required for this preorder
        </label>
        <div className="configuration-action-note">
          Review remains a separate step. This submission does not validate or
          apply the change.
        </div>
        <div className="form-actions">
          <button type="submit">Review change</button>
        </div>
      </form>
    </article>
  );
}
