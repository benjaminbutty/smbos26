import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import {
  hasCapability,
  resolveTenant,
} from "../../../../../auth/authorization";
import { Notice } from "../../../../../components/notice";
import { createExperienceService } from "../../../../../core/experience/service";
import { ConfigurationChangeService } from "../../../../../core/configuration/service";
import { createServerClient } from "../../../../../db/supabase/server";
import { PageRenderer } from "../../../../../runtime/pages/page-renderer";
import {
  readSearchParam,
  type SearchParams,
} from "../../../../../lib/search-params";
import { preparePublicPagePublicationAction } from "../actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface SitePageProps {
  params: Promise<{ businessSlug: string; pageSlug: string }>;
  searchParams: SearchParams;
}

function publicPath(businessSlug: string, pageSlug: string): string {
  return `/p/${encodeURIComponent(businessSlug)}/${encodeURIComponent(pageSlug)}`;
}

function noticeFor(value: string | undefined): ReactNode {
  if (value === "stale") {
    return (
      <Notice kind="error">
        Workspace setup changed after this Site was loaded. Reload and try
        again.
      </Notice>
    );
  }
  if (value === "already_published") {
    return (
      <Notice kind="message">
        This Site is already available to customers.
      </Notice>
    );
  }
  if (value === "publication_unavailable") {
    return (
      <Notice kind="error">
        This Site could not be identified safely for publication. No changes
        were prepared.
      </Notice>
    );
  }
  if (value === "input_invalid") {
    return <Notice kind="error">Reload this Site and try again.</Notice>;
  }
  return null;
}

export default async function SitePage({
  params,
  searchParams,
}: Readonly<SitePageProps>): Promise<ReactNode> {
  const { businessSlug, pageSlug } = await params;
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  const experience = createExperienceService(supabase, {
    businessId: tenant.business.id,
  });
  let page;
  try {
    page = await experience.loadPage(pageSlug, "public");
  } catch {
    notFound();
  }

  const publicFormKeys = [
    ...new Set(
      page.layout.blocks.flatMap((block) =>
        block.type === "public_form" ? [block.form_key] : [],
      ),
    ),
  ];
  const forms: Record<
    string,
    { bundle: Awaited<ReturnType<typeof experience.loadForm>> }
  > = {};
  for (const formKey of publicFormKeys) {
    try {
      const bundle = await experience.loadForm(formKey, "public");
      if (bundle.definition.mode === "create" && bundle.definition.is_active) {
        forms[formKey] = { bundle };
      }
    } catch {
      // PageRenderer shows the narrow unavailable state for an invalid Form.
    }
  }

  const canManageConfiguration = hasCapability(
    tenant.membership.role,
    "manage_configuration",
  );
  let currentness: {
    expectedBaseVersionId: string;
    expectedHeadRevision: number;
  } | null = null;
  if (canManageConfiguration) {
    try {
      currentness = await new ConfigurationChangeService(supabase, {
        businessId: tenant.business.id,
        actorId: tenant.user.id,
      }).getProposalCurrentness();
    } catch {
      currentness = null;
    }
  }
  const notice = await readSearchParam(searchParams, "notice");

  return (
    <section className="tenant-content runtime-page site-owner-page">
      <header className="site-owner-heading">
        <div>
          <p className="eyebrow">
            Sites / {page.definition.status === "draft" ? "Draft" : "Published"}
          </p>
          <h1 className="page-title">{page.definition.title}</h1>
          <p className="lede">
            {page.definition.status === "draft"
              ? "This customer-facing Site is private until you review and publish it."
              : "This customer-facing Site is available at its public URL."}
          </p>
        </div>
        <div className="site-owner-actions">
          {page.definition.status === "published" ? (
            <a
              className="button button-secondary"
              href={publicPath(businessSlug, page.definition.slug)}
            >
              Open public Site
            </a>
          ) : null}
          <Link className="button-link" href={`/app/${businessSlug}`}>
            Back to Home
          </Link>
        </div>
      </header>

      {noticeFor(notice)}

      {page.definition.status === "draft" &&
      canManageConfiguration &&
      currentness ? (
        <section className="panel compact-panel site-publication-panel">
          <h2>Review before publishing</h2>
          <p className="muted">
            The preview below is read-only. Publishing is a separate reviewed
            configuration change; workspace creation has not made this Site
            public.
          </p>
          <form
            action={preparePublicPagePublicationAction.bind(null, businessSlug)}
          >
            <input name="pageKey" type="hidden" value={page.definition.key} />
            <input name="pageSlug" type="hidden" value={page.definition.slug} />
            <input
              name="expectedBaseVersionId"
              type="hidden"
              value={currentness.expectedBaseVersionId}
            />
            <input
              name="expectedHeadRevision"
              type="hidden"
              value={currentness.expectedHeadRevision}
            />
            <button type="submit">Prepare publication</button>
          </form>
        </section>
      ) : null}

      <section className="site-owner-canvas" aria-label="Site preview">
        <div className="site-owner-canvas-label">Read-only Site preview</div>
        <PageRenderer
          forms={forms}
          layout={page.layout}
          previewMode
          publicMode
        />
      </section>
    </section>
  );
}
