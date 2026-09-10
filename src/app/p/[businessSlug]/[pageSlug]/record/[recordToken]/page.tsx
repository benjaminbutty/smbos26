import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import Image from "next/image";

import { loadPublicRecordRuntime } from "../../../../../../core/public/page";
import { SitePublicRenderer } from "../../../../../../runtime/sites/site-public-renderer";

interface PublicRecordPageProps {
  params: Promise<{
    businessSlug: string;
    pageSlug: string;
    recordToken: string;
  }>;
}

export default async function PublicRecordPage({
  params,
}: Readonly<PublicRecordPageProps>): Promise<ReactNode> {
  const { businessSlug, pageSlug, recordToken } = await params;
  let runtime;
  try {
    runtime = await loadPublicRecordRuntime(
      businessSlug,
      pageSlug,
      recordToken,
    );
  } catch {
    notFound();
  }
  if (!runtime || runtime.kind !== "site") notFound();
  const logoSource = runtime.site.branding.logo_media_token
    ? `/api/public/sites/${encodeURIComponent(
        businessSlug,
      )}/media/${runtime.site.branding.logo_media_token}`
    : null;
  return (
    <main className="public-runtime-page site-public-runtime-page">
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
            <strong>{runtime.business.name}</strong>
            <span>Customer site</span>
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
        record={runtime.record}
      />
    </main>
  );
}
