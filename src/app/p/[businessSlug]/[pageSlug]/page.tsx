import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { resolvePublicPage } from "../../../../core/experience/service";
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

  return (
    <main className="public-runtime-page">
      <header className="public-page-heading">
        <p className="eyebrow">{resolved.business.name}</p>
        <h1 className="runtime-title">{resolved.page.title}</h1>
      </header>
      <PageRenderer layout={resolved.page.layout} publicMode />
    </main>
  );
}
