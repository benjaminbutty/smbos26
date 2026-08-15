import { randomUUID } from "node:crypto";

import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { loadPublicPageRuntime } from "../../../../core/public/page";
import { resolvePublicPreorder } from "../../../../core/preorder/service";
import type { PublicPreorderCatalogue } from "../../../../core/preorder/schemas";
import { createServerClient } from "../../../../db/supabase/server";
import { PageRenderer } from "../../../../runtime/pages/page-renderer";

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

  const preorderKeys = [
    ...new Set(
      runtime.page.layout.blocks.flatMap((block) =>
        block.type === "preorder" ? [block.preorder_key] : [],
      ),
    ),
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
        preorders={preorders}
        publicMode
      />
    </main>
  );
}
