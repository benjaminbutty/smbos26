import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { hasCapability, resolveTenant } from "@/auth/authorization";
import { createServerClient } from "@/db/supabase/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

interface NewManualListPageProps {
  params: Promise<{ businessSlug: string }>;
}

/**
 * Compatibility route for the retired generic Lists entry point. Table
 * creation now lives beside the Tables navigation so every new concept uses
 * the direct Table Workspace lane.
 */
export default async function NewManualListPage({
  params,
}: Readonly<NewManualListPageProps>): Promise<ReactNode> {
  const { businessSlug } = await params;
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  if (!hasCapability(tenant.membership.role, "manage_configuration")) {
    notFound();
  }
  redirect(`/app/${encodeURIComponent(businessSlug)}`);
}
