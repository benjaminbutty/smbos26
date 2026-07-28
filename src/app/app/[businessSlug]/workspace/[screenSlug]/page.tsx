import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { resolveTenant } from "../../../../../auth/authorization";
import { Notice } from "../../../../../components/notice";
import { createExperienceService } from "../../../../../core/experience/service";
import { createServerClient } from "../../../../../db/supabase/server";
import {
  readSearchParam,
  type SearchParams,
} from "../../../../../lib/search-params";
import { experiencePathToKey } from "../../../../../runtime/routing";
import { ViewRenderer } from "../../../../../runtime/views/view-renderer";

interface WorkspaceScreenPageProps {
  params: Promise<{ businessSlug: string; screenSlug: string }>;
  searchParams: SearchParams;
}

export default async function WorkspaceScreenPage({
  params,
  searchParams,
}: Readonly<WorkspaceScreenPageProps>): Promise<ReactNode> {
  const { businessSlug, screenSlug } = await params;
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  const experience = createExperienceService(supabase, {
    businessId: tenant.business.id,
  });
  const [error, message] = await Promise.all([
    readSearchParam(searchParams, "error"),
    readSearchParam(searchParams, "message"),
  ]);

  let bundle;
  try {
    bundle = await experience.loadView(experiencePathToKey(screenSlug));
  } catch {
    notFound();
  }

  return (
    <section className="tenant-content">
      {error ? <Notice kind="error">{error}</Notice> : null}
      {message ? <Notice kind="message">{message}</Notice> : null}
      <ViewRenderer bundle={bundle} businessSlug={businessSlug} />
    </section>
  );
}
