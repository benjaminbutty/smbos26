import type { ReactNode } from "react";
import Image from "next/image";

import { sitePublicProjectionSchema } from "../../core/sites/schemas";
import { SitePublicRenderer } from "../../runtime/sites/site-public-renderer";

export function SiteCandidatePreview({
  businessSlug,
  candidateId,
  projection,
}: Readonly<{
  businessSlug: string;
  candidateId: string;
  projection: unknown;
}>): ReactNode {
  const safeProjection = sitePublicProjectionSchema.parse(projection);
  const mediaPrefix = `/api/app/${encodeURIComponent(
    businessSlug,
  )}/sites/media/${encodeURIComponent(candidateId)}`;
  const logoSource = safeProjection.branding.logo_media_token
    ? `${mediaPrefix}/${safeProjection.branding.logo_media_token}`
    : null;
  return (
    <section className="panel site-candidate-preview" aria-label="Site preview">
      <div className="site-candidate-preview-heading">
        <div>
          {logoSource ? (
            <Image
              alt=""
              className="site-preview-logo"
              height={64}
              src={logoSource}
              unoptimized
              width={160}
            />
          ) : null}
          <p className="eyebrow">Preview of your Site update</p>
          <h2>{safeProjection.branding.name}</h2>
        </div>
        <span className="muted">Review before publishing</span>
      </div>
      {safeProjection.pages.map((page) => (
        <article className="site-candidate-preview-page" key={page.public_key}>
          <header>
            <p className="eyebrow">{page.navigation_label}</p>
            <h3>{page.title}</h3>
          </header>
          <SitePublicRenderer
            businessSlug={businessSlug}
            layout={page.layout}
            mediaPrefix={mediaPrefix}
            pageSlug={page.slug}
          />
        </article>
      ))}
    </section>
  );
}
