import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { hasCapability, resolveTenant } from "@/auth/authorization";
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

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

interface PreorderQuestionsPageProps {
  params: Promise<{ businessSlug: string; preorderKey: string }>;
}

export default async function PreorderQuestionsPage({
  params,
}: Readonly<PreorderQuestionsPageProps>): Promise<ReactNode> {
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

  let setup;
  try {
    const active = await loadActiveManualAmendmentSnapshot(configuration);
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

  const basePath = `/app/${encodeURIComponent(businessSlug)}/setup/preorder/${encodeURIComponent(preorderKey)}`;
  return (
    <article className="tenant-content setup-page">
      <Link className="back-link" href={`/app/${businessSlug}/setup`}>
        ← Return to Edit setup
      </Link>
      <header className="history-detail-header">
        <div>
          <p className="eyebrow">Preorder setup</p>
          <h1 className="runtime-title">Questions customers answer</h1>
          <p className="lede">{setup.label}</p>
          <p className="muted">
            Changes are prepared for review and do not become live until an
            Owner or Admin deliberately validates and applies them.
          </p>
        </div>
      </header>

      <nav
        aria-label="Preorder setup sections"
        className="history-section-links"
      >
        <Link href={basePath}>Collection settings</Link>
        <span aria-current="page">Questions customers answer</span>
      </nav>

      <section className="change-section" aria-labelledby="questions-heading">
        <div className="section-heading">
          <div>
            <h2 id="questions-heading">Questions customers answer</h2>
            <p className="muted">
              Wording, help text and whether an answer is required for this
              preorder.
            </p>
          </div>
          <Link
            className="button button-secondary"
            href={`${basePath}/questions/new`}
          >
            Add question
          </Link>
        </div>

        {setup.questions.length === 0 ? (
          <p className="empty-state">
            This preorder has no customer questions to edit.
          </p>
        ) : (
          <div className="change-card-grid">
            {setup.questions.map((question) => (
              <article
                className="change-card"
                key={`${question.target}:${question.fieldKey}`}
              >
                <h3>{question.label}</h3>
                <p className="muted">
                  {question.required ? "Required" : "Optional"}
                  {question.helpText ? ` · ${question.helpText}` : ""}
                </p>
                <Link
                  className="button button-secondary"
                  href={`${basePath}/questions/${encodeURIComponent(question.target)}/${encodeURIComponent(question.fieldKey)}`}
                >
                  Edit question
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>
    </article>
  );
}
