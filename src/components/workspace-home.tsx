import Link from "next/link";
import type { ReactNode } from "react";

export interface WorkspaceHomeDestination {
  href: string;
  label: string;
  description: string;
  kind?: "page" | "view";
}

interface WorkspaceHomeProps {
  businessSlug: string;
  canManageConfiguration: boolean;
  destinations: readonly WorkspaceHomeDestination[];
  greetingName: string;
  businessName: string;
}

function EmptyWorkspaceHome({
  businessSlug,
  canManageConfiguration,
  greetingName,
}: Readonly<
  Pick<
    WorkspaceHomeProps,
    "businessSlug" | "canManageConfiguration" | "greetingName"
  >
>): ReactNode {
  if (!canManageConfiguration) {
    return (
      <section className="tenant-content lenni-home lenni-home-empty">
        <p className="home-greeting">Good morning, {greetingName}</p>
        <h1>Your workspace is ready.</h1>
        <p className="home-lede">
          Your owner or admin will share the Tables and Pages you need to run
          the work here.
        </p>
        <div className="home-empty-staff-note" role="status">
          <strong>Nothing needs your attention yet.</strong>
          <span>Shared work will appear here when it is ready.</span>
        </div>
      </section>
    );
  }

  return (
    <section className="tenant-content lenni-home lenni-home-empty">
      <p className="home-greeting">Good morning, {greetingName}</p>
      <h1>Set up your workspace.</h1>
      <p className="home-lede">
        Start with the work you already know you need, or describe it to Lenni
        for a suggested starting point.
      </p>

      <section aria-label="Choose how to start" className="home-start-panel">
        <div className="home-start-route home-start-manual home-start-route-primary">
          <p className="home-route-kicker">
            <span aria-hidden="true">＋</span> Build directly
          </p>
          <h2>Create manually</h2>
          <p>
            Start with the work you already know you need. Add more as your
            business grows.
          </p>
          <div className="home-manual-actions">
            <Link
              className="button home-primary-action"
              href={`/app/${encodeURIComponent(businessSlug)}?new=table#tables-navigation-heading`}
            >
              New Table
            </Link>
            <Link
              className="home-manual-action home-manual-action-secondary"
              href={`/app/${encodeURIComponent(businessSlug)}?new=page#pages-navigation-heading`}
            >
              <span className="home-manual-icon" aria-hidden="true">
                ▤
              </span>
              <span>
                <strong>New Page</strong>
                <small>Bring information and useful Views together</small>
              </span>
            </Link>
          </div>
          <p className="home-manual-note">
            No technical setup. Properties and Connections stay inside the work.
          </p>
        </div>

        <div className="home-start-route home-start-ai">
          <p className="home-route-kicker">
            <span aria-hidden="true">✦</span> Build with Lenni
          </p>
          <h2>Tell Lenni what you need</h2>
          <p>
            Describe how your business works. Lenni will suggest the Tables,
            Connections, Views and Pages to create.
          </p>
          <Link
            className="button-secondary home-secondary-action"
            href={`/app/${encodeURIComponent(businessSlug)}/builder`}
          >
            Describe your business
          </Link>
          <p className="home-ai-note">
            You&apos;ll review the plan before anything is created.
          </p>
        </div>
      </section>

      <section
        aria-labelledby="home-workspace-heading"
        className="home-education"
      >
        <h2 id="home-workspace-heading">Your Lenni workspace</h2>
        <div className="home-education-grid">
          <div className="home-education-item">
            <span aria-hidden="true">▦</span>
            <strong>Tables</strong>
            <small>Hold what your business tracks</small>
          </div>
          <div className="home-education-item">
            <span aria-hidden="true">⌘</span>
            <strong>Connections</strong>
            <small>Link related information</small>
          </div>
          <div className="home-education-item">
            <span aria-hidden="true">◎</span>
            <strong>Views</strong>
            <small>Show work in useful ways</small>
          </div>
          <div className="home-education-item">
            <span aria-hidden="true">▤</span>
            <strong>Pages</strong>
            <small>Bring guidance and live work together</small>
          </div>
        </div>
      </section>
    </section>
  );
}

export function WorkspaceHome({
  businessName,
  businessSlug,
  canManageConfiguration,
  destinations,
  greetingName,
}: Readonly<WorkspaceHomeProps>): ReactNode {
  if (destinations.length === 0) {
    return (
      <EmptyWorkspaceHome
        businessSlug={businessSlug}
        canManageConfiguration={canManageConfiguration}
        greetingName={greetingName}
      />
    );
  }

  const primaryDestination =
    destinations.find((destination) => destination.kind === "page") ??
    destinations[0];
  if (!primaryDestination) {
    return null;
  }
  const supportingDestinations = destinations.filter(
    (destination) => destination.href !== primaryDestination.href,
  );

  return (
    <section
      aria-labelledby="workspace-home-title"
      className="tenant-content workspace-home-populated"
    >
      <p className="eyebrow">Home</p>
      <p className="home-greeting">Good morning, {greetingName}</p>
      <h1 className="runtime-title" id="workspace-home-title">
        {businessName}
      </h1>
      <p className="home-lede">
        Start with the work that needs your attention, then move through the
        rest of your workspace.
      </p>

      <section
        aria-labelledby="workspace-home-next-heading"
        className="workspace-home-next"
      >
        <p className="eyebrow">Start here</p>
        <h2 id="workspace-home-next-heading">{primaryDestination.label}</h2>
        <p>{primaryDestination.description}</p>
        <Link className="button" href={primaryDestination.href}>
          Open {primaryDestination.label}
        </Link>
      </section>

      {supportingDestinations.length > 0 ? (
        <section
          aria-labelledby="workspace-home-work-heading"
          className="workspace-home-supporting"
        >
          <h2 id="workspace-home-work-heading">Your work</h2>
          <div className="workspace-home-grid">
            {supportingDestinations.map((destination) => (
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
        </section>
      ) : null}
    </section>
  );
}
