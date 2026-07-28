import Link from "next/link";
import type { ReactNode } from "react";

import { resolveTenant } from "../../../auth/authorization";
import { createExperienceService } from "../../../core/experience/service";
import { createServerClient } from "../../../db/supabase/server";
import { experienceKeyToPath } from "../../../runtime/routing";

interface TenantHomePageProps {
  params: Promise<{ businessSlug: string }>;
}

export default async function TenantHomePage({
  params,
}: Readonly<TenantHomePageProps>): Promise<ReactNode> {
  const { businessSlug } = await params;
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  const experience = createExperienceService(supabase, {
    businessId: tenant.business.id,
  });
  const navigation = await experience.listNavigation();
  const destinations = [
    ...navigation.pages.map((page) => ({
      href: `/app/${businessSlug}/pages/${page.slug}`,
      label: page.title,
      description: "Open workspace page",
    })),
    ...navigation.views.map((view) => ({
      href: `/app/${businessSlug}/workspace/${experienceKeyToPath(view.key)}`,
      label: view.name,
      description: "View and manage information",
    })),
  ];

  return (
    <section className="tenant-content">
      <p className="eyebrow">Good to see you</p>
      <h1 className="runtime-title">{tenant.business.name}</h1>
      <p className="muted">Choose where you would like to work.</p>

      {destinations.length > 0 ? (
        <div className="workspace-home-grid">
          {destinations.map((destination) => (
            <Link
              className="workspace-home-card"
              href={destination.href}
              key={destination.href}
            >
              <span className="workspace-home-icon" aria-hidden="true">
                {destination.label.slice(0, 1)}
              </span>
              <strong>{destination.label}</strong>
              <span>{destination.description}</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="panel compact-panel">
          <h2>Your workspace is ready</h2>
          <p className="muted">
            Configured business screens will appear here automatically.
          </p>
          <Link className="button" href={`/app/${businessSlug}/locations`}>
            Open settings
          </Link>
        </div>
      )}
    </section>
  );
}
