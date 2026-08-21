import Link from "next/link";
import type { ReactNode } from "react";

export interface WorkspaceHomeDestination {
  href: string;
  label: string;
  description: string;
  kind?: "table" | "page" | "site" | "view";
}

interface WorkspaceHomeProps {
  businessSlug: string;
  canManageConfiguration: boolean;
  destinations: readonly WorkspaceHomeDestination[];
  greetingName: string;
  businessName: string;
}

function destinationTypeLabel(destination: WorkspaceHomeDestination): string {
  switch (destination.kind) {
    case "table":
    case "view":
      return "Table";
    case "page":
      return "Page";
    case "site":
      return "Site";
    default:
      return "Workspace";
  }
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
        <p className="eyebrow">Home</p>
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
      <p className="eyebrow">Home</p>
      <h1>Set up your workspace.</h1>
      <p className="home-lede">
        Start with a Table or Page for the work you already know you need. Add
        more as the business grows.
      </p>

      <section aria-label="Choose how to start" className="home-start-panel">
        <div className="home-start-route home-start-manual home-start-route-primary">
          <p className="home-route-kicker">
            <span aria-hidden="true">＋</span> Build directly
          </p>
          <h2>Create manually</h2>
          <p>
            Tables hold business information. Pages bring guidance and live
            Views together.
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
            <span aria-hidden="true">→</span> Need a starting point?
          </p>
          <h2>Tell Lenni what you need</h2>
          <p>
            Describe how the business works and review Lenni&apos;s suggested
            setup before anything is created.
          </p>
          <Link
            className="button-secondary home-secondary-action"
            href={`/app/${encodeURIComponent(businessSlug)}/builder`}
          >
            Describe your business
          </Link>
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
    destinations.find((destination) => destination.kind === "table") ??
    destinations.find((destination) => destination.kind === "page") ??
    destinations[0];
  if (!primaryDestination) return null;

  const supportingDestinations = destinations.filter(
    (destination) => destination.href !== primaryDestination.href,
  );

  return (
    <section
      aria-labelledby="workspace-home-title"
      className="tenant-content workspace-home-populated"
    >
      <header className="workspace-home-heading">
        <div>
          <p className="eyebrow">Home</p>
          <p className="home-greeting">Good morning, {greetingName}</p>
          <h1 className="runtime-title" id="workspace-home-title">
            {businessName}
          </h1>
        </div>
        <span className="workspace-live-status">Live workspace</span>
      </header>
      <p className="home-lede">
        This is your real workspace. Open the work that is configured for this
        business. Saved Views stay inside their Table.
      </p>

      <section
        aria-labelledby="workspace-home-next-heading"
        className="workspace-home-next"
      >
        <p className="eyebrow">Start here</p>
        <span className="workspace-home-destination-type">
          {destinationTypeLabel(primaryDestination)}
        </span>
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
          <div className="workspace-home-section-heading">
            <div>
              <p className="eyebrow">Configured destinations</p>
              <h2 id="workspace-home-work-heading">Your work</h2>
            </div>
            <span>{supportingDestinations.length} more</span>
          </div>
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
                <span className="workspace-home-destination-type">
                  {destinationTypeLabel(destination)}
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
