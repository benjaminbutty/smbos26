import { randomUUID } from "node:crypto";

import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { loadPublicPageRuntime } from "../../../../core/public/page";
import { pageBlockReferencesPreorder } from "../../../../core/experience/page-blocks";
import { resolvePublicPreorder } from "../../../../core/preorder/service";
import type { PublicPreorderCatalogue } from "../../../../core/preorder/schemas";
import { createServerClient } from "../../../../db/supabase/server";
import { PageRenderer } from "../../../../runtime/pages/page-renderer";
import { SitePublicRenderer } from "../../../../runtime/sites/site-public-renderer";
import { sitePublicAccentStyle } from "../../../../runtime/sites/site-public-theme";

interface PublicPageProps {
  params: Promise<{ businessSlug: string; pageSlug: string }>;
}

export default async function PublicPage({
  params,
}: Readonly<PublicPageProps>): Promise<ReactNode> {
  const { businessSlug, pageSlug } = await params;
  const supabase = await createServerClient();

  let runtime;
  try {
    runtime = await loadPublicPageRuntime(businessSlug, pageSlug);
  } catch {
    notFound();
  }

  if (!runtime) {
    notFound();
  }

  if (runtime.kind === "site") {
    const logoSource = runtime.site.branding.logo_media_token
      ? `/api/public/sites/${encodeURIComponent(
          businessSlug,
        )}/media/${runtime.site.branding.logo_media_token}`
      : null;
    return (
      <main
        className="public-runtime-page site-public-runtime-page site-public-branded-surface"
        style={sitePublicAccentStyle(runtime.site.branding.accent)}
      >
        <header className="c7-public-experience-header">
          <div className="c7-public-experience-identity">
            {logoSource ? (
              <Image
                alt=""
                className="site-public-logo"
                height={48}
                src={logoSource}
                width={120}
              />
            ) : (
              <span className="c7-public-business-mark" aria-hidden="true">
                {runtime.business.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <div>
              <strong>{runtime.site.branding.name}</strong>
              <span>{runtime.business.name}</span>
            </div>
          </div>
          <span className="c7-public-powered-by">Powered by Lenni</span>
        </header>
        {runtime.site.navigation.length > 0 ? (
          <nav aria-label="Site navigation" className="site-public-navigation">
            {runtime.site.navigation.map((item) => (
              <Link
                href={`/p/${encodeURIComponent(businessSlug)}/${encodeURIComponent(item.slug)}`}
                key={item.key}
              >
                {item.label || item.title}
              </Link>
            ))}
          </nav>
        ) : null}
        <header className="public-page-heading">
          <p className="eyebrow">{runtime.business.name}</p>
          <h1 className="runtime-title">{runtime.page.title}</h1>
        </header>
        <SitePublicRenderer
          businessSlug={businessSlug}
          layout={runtime.page.layout}
          pageSlug={pageSlug}
        />
      </main>
    );
  }

  const preorderKeys = [
    ...new Set(pageBlockReferencesPreorder(runtime.page.layout)),
  ];
  const preorders: Record<
    string,
    { catalogue: PublicPreorderCatalogue; endpoint: string }
  > = {};
  try {
    for (const preorderKey of preorderKeys) {
      const catalogue = await resolvePublicPreorder(
        supabase,
        businessSlug,
        pageSlug,
        preorderKey,
      );
      if (!catalogue) {
        notFound();
      }
      preorders[preorderKey] = {
        catalogue,
        endpoint: `/api/preorder/${encodeURIComponent(
          businessSlug,
        )}/${encodeURIComponent(
          pageSlug,
        )}?preorderKey=${encodeURIComponent(preorderKey)}`,
      };
    }
  } catch {
    notFound();
  }

  const forms = Object.fromEntries(
    Object.entries(runtime.forms).map(([formKey, bundle]) => [
      formKey,
      {
        action: `/api/public/forms/${encodeURIComponent(
          businessSlug,
        )}/${encodeURIComponent(pageSlug)}/${encodeURIComponent(formKey)}`,
        bundle,
        hiddenFields: [{ name: "idempotency_token", value: randomUUID() }],
        honeypotName: "website",
      },
    ]),
  );
  const bookings = Object.fromEntries(
    Object.entries(runtime.bookings).map(([bookingKey, catalogue]) => [
      bookingKey,
      {
        catalogue,
        endpoint: `/api/public/bookings/${encodeURIComponent(
          businessSlug,
        )}/${encodeURIComponent(pageSlug)}/${encodeURIComponent(bookingKey)}`,
      },
    ]),
  );

  return (
    <main
      className={
        preorderKeys.length > 0
          ? "public-runtime-page public-preorder-page c7-public-runtime-page c7-public-preorder"
          : "public-runtime-page c7-public-runtime-page"
      }
    >
      <header className="c7-public-experience-header">
        <div className="c7-public-experience-identity">
          <span className="c7-public-business-mark" aria-hidden="true">
            {runtime.business.name.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <strong>{runtime.business.name}</strong>
            <span>Customer page</span>
          </div>
        </div>
        <span className="c7-public-powered-by">Powered by Lenni</span>
      </header>
      <header className="public-page-heading">
        <p className="eyebrow">{runtime.business.name}</p>
        <h1 className="runtime-title">{runtime.page.title}</h1>
      </header>
      <PageRenderer
        bookings={bookings}
        forms={forms}
        layout={runtime.page.layout}
        pageTitle={runtime.page.title}
        preorders={preorders}
        publicMode
      />
    </main>
  );
}
