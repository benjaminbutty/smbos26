import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { hasCapability, resolveTenant } from "@/auth/authorization";
import { Notice } from "@/components/notice";
import { preorderQuestionTargetSchema } from "@/core/configuration/manual-amendments/schemas";
import {
  getPreorderQuestionsSetup,
  loadActiveManualAmendmentSnapshot,
  ManualAmendmentError,
} from "@/core/configuration/manual-amendments/service";
import {
  ConfigurationChangeService,
  isControlledConfigurationReadError,
} from "@/core/configuration/service";
import { graphKeySchema } from "@/core/graph/schemas";
import { createServerClient } from "@/db/supabase/server";
import { readSearchParam, type SearchParams } from "@/lib/search-params";

import { prepareExistingPreorderQuestionAmendmentAction } from "../../../../../actions";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

interface EditPreorderQuestionPageProps {
  params: Promise<{
    businessSlug: string;
    preorderKey: string;
    target: string;
    fieldKey: string;
  }>;
  searchParams: SearchParams;
}

function ExistingQuestionNotice({
  notice,
}: Readonly<{ notice: string | undefined }>): ReactNode {
  if (notice === "stale") {
    return (
      <Notice kind="error">
        Setup changed after this page was loaded. Reload and try again.
      </Notice>
    );
  }
  if (notice === "input_invalid") {
    return <Notice kind="error">Check the question and try again.</Notice>;
  }
  if (notice === "nothing_changed") {
    return <Notice kind="message">Nothing changed.</Notice>;
  }
  return null;
}

export default async function EditPreorderQuestionPage({
  params,
  searchParams,
}: Readonly<EditPreorderQuestionPageProps>): Promise<ReactNode> {
  const route = await params;
  const target = preorderQuestionTargetSchema.safeParse(route.target);
  const fieldKey = graphKeySchema.safeParse(route.fieldKey);
  if (!target.success || !fieldKey.success) {
    notFound();
  }

  const supabase = await createServerClient();
  const tenant = await resolveTenant(route.businessSlug, supabase);
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
    setup = getPreorderQuestionsSetup(active.snapshot, route.preorderKey);
  } catch (error) {
    if (
      error instanceof ManualAmendmentError ||
      isControlledConfigurationReadError(error)
    ) {
      notFound();
    }
    throw error;
  }
  const question = setup.questions.find(
    (candidate) =>
      candidate.target === target.data && candidate.fieldKey === fieldKey.data,
  );
  if (!question) {
    notFound();
  }
  const notice = await readSearchParam(searchParams, "notice");
  const submitAction = prepareExistingPreorderQuestionAmendmentAction.bind(
    null,
    route.businessSlug,
    route.preorderKey,
    target.data,
    fieldKey.data,
  );
  const questionsPath = `/app/${encodeURIComponent(route.businessSlug)}/setup/preorder/${encodeURIComponent(route.preorderKey)}/questions`;

  return (
    <article className="tenant-content setup-page">
      <Link className="back-link" href={questionsPath}>
        ← Return to Questions customers answer
      </Link>
      <header className="history-detail-header">
        <div>
          <p className="eyebrow">Edit preorder question</p>
          <h1 className="runtime-title">{question.label}</h1>
          <p className="lede">
            Saving prepares a change for review. It does not immediately change
            the live customer page.
          </p>
        </div>
      </header>

      <ExistingQuestionNotice notice={notice} />

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
          <input
            defaultValue={question.label}
            maxLength={120}
            minLength={1}
            name="label"
            required
          />
        </label>
        <label>
          Help text <span className="muted">(optional)</span>
          <textarea
            defaultValue={question.helpText ?? ""}
            maxLength={500}
            name="helpText"
            rows={4}
          />
        </label>
        <label className="checkbox-control">
          <input
            defaultChecked={question.required}
            name="required"
            type="checkbox"
          />
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
