import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { resolvePublicPage } from "../../../../core/experience/service";
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

  let resolved;
  try {
    resolved = await resolvePublicPage(supabase, businessSlug, pageSlug);
  } catch {
    notFound();
  }

  if (!resolved) {
    notFound();
  }

  const preorderKeys = [
    ...new Set(
      resolved.page.layout.blocks.flatMap((block) =>
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

  return (
    <main
      className={
        preorderKeys.length > 0
          ? "public-runtime-page public-preorder-page"
          : "public-runtime-page"
      }
    >
      <header className="public-page-heading">
        <p className="eyebrow">{resolved.business.name}</p>
        <h1 className="runtime-title">{resolved.page.title}</h1>
      </header>
      <PageRenderer
        layout={resolved.page.layout}
        preorders={preorders}
        publicMode
      />
    </main>
  );
}
