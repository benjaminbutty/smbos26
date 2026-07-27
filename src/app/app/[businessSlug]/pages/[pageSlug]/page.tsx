import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { resolveTenant } from "../../../../../auth/authorization";
import { Notice } from "../../../../../components/notice";
import {
  createExperienceService,
  type ExperienceFormBundle,
  type ExperienceViewBundle,
} from "../../../../../core/experience/service";
import { createServerClient } from "../../../../../db/supabase/server";
import {
  readSearchParam,
  type SearchParams,
} from "../../../../../lib/search-params";
import { saveExperienceForm } from "../../../../../runtime/forms/actions";
import { PageRenderer } from "../../../../../runtime/pages/page-renderer";

interface InternalPageProps {
  params: Promise<{ businessSlug: string; pageSlug: string }>;
  searchParams: SearchParams;
}

export default async function InternalPage({
  params,
  searchParams,
}: Readonly<InternalPageProps>): Promise<ReactNode> {
  const { businessSlug, pageSlug } = await params;
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  const experience = createExperienceService(supabase, {
    businessId: tenant.business.id,
  });
  const [error, message] = await Promise.all([
    readSearchParam(searchParams, "error"),
    readSearchParam(searchParams, "message"),
  ]);

  const { page, views, forms } = await (async () => {
    try {
      const page = await experience.loadPage(pageSlug, "internal");
      const viewKeys = [
        ...new Set(
          page.layout.blocks.flatMap((block) =>
            block.type === "view" ? [block.view_key] : [],
          ),
        ),
      ];
      const formKeys = [
        ...new Set(
          page.layout.blocks.flatMap((block) =>
            block.type === "form" ? [block.form_key] : [],
          ),
        ),
      ];
      const viewResults = await Promise.allSettled(
        viewKeys.map(
          async (key) => [key, await experience.loadView(key)] as const,
        ),
      );
      const formResults = await Promise.allSettled(
        formKeys.map(
          async (key) => [key, await experience.loadForm(key)] as const,
        ),
      );
      const views: Record<string, ExperienceViewBundle> = {};
      const forms: Record<
        string,
        {
          bundle: ExperienceFormBundle;
          action: (formData: FormData) => Promise<never>;
        }
      > = {};
      const pagePath = `/app/${businessSlug}/pages/${pageSlug}`;

      for (const result of viewResults) {
        if (result.status === "fulfilled") {
          views[result.value[0]] = result.value[1];
        }
      }
      for (const result of formResults) {
        if (result.status === "fulfilled") {
          const [key, bundle] = result.value;
          forms[key] = {
            bundle,
            action: saveExperienceForm.bind(
              null,
              businessSlug,
              key,
              null,
              pagePath,
              pagePath,
            ),
          };
        }
      }

      return { forms, page, views };
    } catch {
      notFound();
    }
  })();

  return (
    <section className="tenant-content runtime-page">
      <header className="page-preview-header">
        <div>
          <p className="eyebrow">Workspace page</p>
          <h1 className="runtime-title">{page.definition.title}</h1>
        </div>
        {page.definition.status === "draft" ? (
          <span className="draft-badge">Draft preview</span>
        ) : null}
      </header>
      {error ? <Notice kind="error">{error}</Notice> : null}
      {message ? <Notice kind="message">{message}</Notice> : null}
      <PageRenderer
        businessSlug={businessSlug}
        forms={forms}
        layout={page.layout}
        views={views}
      />
    </section>
  );
}
