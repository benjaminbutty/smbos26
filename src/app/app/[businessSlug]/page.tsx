import Link from "next/link";
import type { ReactNode } from "react";

import { resolveTenant } from "../../../auth/authorization";
import { createServerClient } from "../../../db/supabase/server";

interface TenantHomePageProps {
  params: Promise<{ businessSlug: string }>;
}

export default async function TenantHomePage({
  params,
}: Readonly<TenantHomePageProps>): Promise<ReactNode> {
  const { businessSlug } = await params;
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  const { count } = await supabase
    .from("locations")
    .select("id", { count: "exact", head: true })
    .eq("business_id", tenant.business.id);

  return (
    <section className="tenant-content">
      <p className="eyebrow">Business overview</p>
      <h1 className="page-title">{tenant.business.name}</h1>
      <p className="muted">
        {count ?? 0} {(count ?? 0) === 1 ? "location" : "locations"} ·{" "}
        {tenant.business.timezone}
      </p>

      <div className="panel compact-panel">
        <h2>Foundation ready</h2>
        <p className="muted">
          Your account and business access are set up. Add the places where your
          team operates.
        </p>
        <Link className="button" href={`/app/${businessSlug}/locations`}>
          Manage locations
        </Link>
      </div>
    </section>
  );
}
