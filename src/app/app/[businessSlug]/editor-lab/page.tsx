import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { hasCapability, resolveTenant } from "../../../../auth/authorization";
import { createServerClient } from "../../../../db/supabase/server";
import { EditorLab } from "../../../../runtime/editor-kernel/editor-lab-wrapper";

interface EditorLabPageProps {
  params: Promise<{ businessSlug: string }>;
}

export default async function EditorLabPage({
  params,
}: Readonly<EditorLabPageProps>): Promise<ReactNode> {
  const { businessSlug } = await params;
  const tenant = await resolveTenant(businessSlug, await createServerClient());
  if (!hasCapability(tenant.membership.role, "manage_configuration")) {
    notFound();
  }

  return <EditorLab businessName={tenant.business.name} />;
}
