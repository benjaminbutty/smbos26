import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { hasCapability, resolveTenant } from "../../../../auth/authorization";
import { BuilderUi } from "../../../../components/builder-ui";
import { createServerClient } from "../../../../db/supabase/server";
import { runBuilderAction } from "./actions";
import { parseBuilderRouteSlug } from "./action-service";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;
export const maxDuration = 120;

interface BuilderPageProps {
  params: Promise<{ businessSlug: string }>;
}

export default async function BuilderPage({
  params,
}: Readonly<BuilderPageProps>): Promise<ReactNode> {
  const { businessSlug: rawBusinessSlug } = await params;
  const businessSlug = parseBuilderRouteSlug(rawBusinessSlug);
  if (!businessSlug) {
    notFound();
  }

  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  if (!hasCapability(tenant.membership.role, "manage_configuration")) {
    notFound();
  }

  return (
    <BuilderUi
      action={runBuilderAction.bind(null, businessSlug)}
      businessSlug={businessSlug}
    />
  );
}
