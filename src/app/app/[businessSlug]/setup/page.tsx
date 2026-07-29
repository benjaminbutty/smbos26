import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { hasCapability, resolveTenant } from "../../../../auth/authorization";
import {
  listPreorderScheduleSetups,
  loadActiveManualAmendmentSnapshot,
} from "../../../../core/configuration/manual-amendments/service";
import { ConfigurationChangeService } from "../../../../core/configuration/service";
import { createServerClient } from "../../../../db/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface SetupPageProps {
  params: Promise<{ businessSlug: string }>;
}

export default async function SetupPage({
  params,
}: Readonly<SetupPageProps>): Promise<ReactNode> {
  const { businessSlug } = await params;
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  if (!hasCapability(tenant.membership.role, "manage_configuration")) {
    notFound();
  }
  const configuration = new ConfigurationChangeService(supabase, {
    businessId: tenant.business.id,
    actorId: tenant.user.id,
  });
  const active = await loadActiveManualAmendmentSnapshot(configuration);
  const setups = listPreorderScheduleSetups(active.snapshot);

  return (
    <section className="tenant-content setup-page">
      <p className="eyebrow">Business setup</p>
      <h1 className="page-title">Edit setup</h1>
      <p className="lede">
        Choose an area to prepare a change for review. Your live customer pages
        stay unchanged until an Owner or Admin deliberately validates and
        applies the proposal.
      </p>

      <section className="change-section" aria-labelledby="preorder-heading">
        <div className="section-heading">
          <div>
            <h2 id="preorder-heading">Preorder collection settings</h2>
            <p className="muted">
              Collection days, times, capacity, notice and booking horizon.
            </p>
          </div>
          <span className="section-count">{setups.length}</span>
        </div>
        {setups.length === 0 ? (
          <p className="empty-state">
            There are no active preorder collection settings to edit.
          </p>
        ) : (
          <div className="change-card-grid">
            {setups.map((setup) => (
              <article className="change-card" key={setup.key}>
                <h3>{setup.label}</h3>
                <p className="muted">
                  {setup.schedule.days_of_week.length} collection{" "}
                  {setup.schedule.days_of_week.length === 1 ? "day" : "days"} ·{" "}
                  {setup.schedule.start_time}–{setup.schedule.end_time}
                </p>
                <Link
                  className="button button-secondary"
                  href={`/app/${encodeURIComponent(businessSlug)}/setup/preorder/${encodeURIComponent(setup.key)}`}
                >
                  Edit collection settings
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
