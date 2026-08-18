import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import {
  hasCapability,
  resolveTenant,
} from "../../../../../auth/authorization";
import { Notice } from "../../../../../components/notice";
import type { PublicBookingCatalogue } from "../../../../../core/booking/schemas";
import { resolveDraftBooking } from "../../../../../core/booking/preview";
import { resolvePublicBooking } from "../../../../../core/booking/service";
import { createExperienceService } from "../../../../../core/experience/service";
import { ConfigurationChangeService } from "../../../../../core/configuration/service";
import { createServerClient } from "../../../../../db/supabase/server";
import { PageRenderer } from "../../../../../runtime/pages/page-renderer";
import {
  applyPageBlockAction,
  renamePageAction,
} from "../../../../../runtime/pages/direct-actions";
import { PageEditor } from "../../../../../runtime/page-editor/page-editor";
import {
  readSearchParam,
  type SearchParams,
} from "../../../../../lib/search-params";
import { publishPublicPageAction } from "../actions";

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
  if (value === "published") {
    return (
      <Notice kind="message">
        This Site is now available to customers at its public URL.
      </Notice>
    );
  }
  if (value === "publication_failed") {
    return (
      <Notice kind="error">
        This Site could not be published safely. No incomplete publication was
        left behind.
      </Notice>
    );
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

  const bookingBlocks = page.layout.blocks.filter(
    (
      block,
    ): block is Extract<
      (typeof page.layout.blocks)[number],
      { type: "booking" }
    > => block.type === "booking",
  );
  const bookings: Record<string, { catalogue: PublicBookingCatalogue }> = {};
  for (const block of bookingBlocks) {
    try {
      const catalogue =
        page.definition.status === "published"
          ? await resolvePublicBooking(
              supabase,
              businessSlug,
              page.definition.slug,
              block.booking_key,
            )
          : await resolveDraftBooking(supabase, {
              businessId: tenant.business.id,
              businessName: tenant.business.name,
              businessSlug,
              bookingKey: block.booking_key,
              pageTitle: page.definition.title,
              pageSlug: page.definition.slug,
              blockConfig: block.config,
            });
      if (catalogue) bookings[block.booking_key] = { catalogue };
    } catch {
      // PageRenderer shows a narrow unavailable state for an invalid Booking.
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
  const mode = await readSearchParam(searchParams, "mode");
  const editMode =
    canManageConfiguration && currentness !== null && mode === "edit";
  const sitePath = `/app/${encodeURIComponent(businessSlug)}/sites/${encodeURIComponent(page.definition.slug)}`;

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
          {canManageConfiguration && currentness ? (
            editMode ? (
              <Link className="button button-secondary" href={sitePath}>
                Preview Site
              </Link>
            ) : (
              <Link
                className="button button-secondary"
                href={`${sitePath}?mode=edit`}
              >
                Edit Site
              </Link>
            )
          ) : null}
          {page.definition.status === "published" ? (
            <a
              className="button button-secondary"
              href={publicPath(businessSlug, page.definition.slug)}
              rel="noopener noreferrer"
              target="_blank"
            >
              Open live Site ↗
            </a>
          ) : null}
          <Link className="button-link" href={`/app/${businessSlug}`}>
            Back to Home
          </Link>
        </div>
      </header>

      {noticeFor(notice)}

      {page.definition.status === "draft" && canManageConfiguration ? (
        <section className="panel compact-panel site-publication-panel">
          <h2>Publish this Site</h2>
          <p className="muted">
            Review the customer-facing preview below, then make this current
            Site available at its public URL.
          </p>
          <form action={publishPublicPageAction.bind(null, businessSlug)}>
            <input name="pageKey" type="hidden" value={page.definition.key} />
            <input name="pageSlug" type="hidden" value={page.definition.slug} />
            <button type="submit">Publish Site</button>
          </form>
        </section>
      ) : null}

      {editMode && currentness ? (
        <section className="site-owner-editor" aria-label="Edit Site">
          <div className="site-owner-canvas-label">
            Edit Site — the preview below uses the customer-facing runtime.
          </div>
          {page.definition.status === "published" ? (
            <Notice kind="message">
              Changes to this published Site go live when you save.
            </Notice>
          ) : null}
          <PageEditor
            key={`${page.definition.key}-${currentness.expectedHeadRevision}-${page.definition.title}`}
            applyPageBlockAction={applyPageBlockAction.bind(
              null,
              businessSlug,
              page.definition.key,
            )}
            availableViews={[]}
            businessSlug={businessSlug}
            currentness={currentness}
            layout={page.layout}
            pageKey={page.definition.key}
            previewBookings={bookings}
            previewForms={forms}
            publishedSite={page.definition.status === "published"}
            renamePageAction={renamePageAction.bind(
              null,
              businessSlug,
              page.definition.key,
            )}
            siteMode
            title={page.definition.title}
            views={{}}
          />
        </section>
      ) : (
        <section className="site-owner-canvas" aria-label="Site preview">
          <div className="site-owner-canvas-label">
            {page.definition.status === "draft"
              ? "Read-only Site preview"
              : "Customer-facing Site preview"}
          </div>
          <PageRenderer
            bookings={bookings}
            forms={forms}
            layout={page.layout}
            pageTitle={page.definition.title}
            previewMode
            publicMode
          />
        </section>
      )}
    </section>
  );
}
