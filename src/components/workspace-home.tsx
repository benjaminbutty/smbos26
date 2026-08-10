import Link from "next/link";
import type { ReactNode } from "react";

export interface WorkspaceHomeDestination {
  href: string;
  label: string;
  description: string;
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
        <h1>Build the system your business needs.</h1>
        <p className="home-lede">
          Your owner or admin can set up Tables and Pages for this workspace.
        </p>
        <div className="home-empty-staff-note" role="status">
          <strong>Your workspace is ready.</strong>
          <span>Tables and Pages shared with you will appear here.</span>
        </div>
      </section>
    );
  }

  return (
    <section className="tenant-content lenni-home lenni-home-empty">
      <p className="home-greeting">Good morning, {greetingName}</p>
      <h1>Build the system your business needs.</h1>
      <p className="home-lede">
        Start with Lenni or create it directly. Both routes produce the same
        clear, editable workspace.
      </p>

      <section aria-label="Choose how to start" className="home-start-panel">
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
            className="button home-primary-action"
            href={`/app/${encodeURIComponent(businessSlug)}/builder`}
          >
            Plan my workspace
          </Link>
        </div>

        <div className="home-start-route home-start-manual">
          <p className="home-route-kicker">
            <span aria-hidden="true">＋</span> Build directly
          </p>
          <h2>Create manually</h2>
          <p>
            Start with the parts you already know you need. Add more as your
            business grows.
          </p>
          <div className="home-manual-actions">
            <Link
              className="home-manual-action"
              href={`/app/${encodeURIComponent(businessSlug)}?new=table#tables-navigation-heading`}
            >
              <span className="home-manual-icon" aria-hidden="true">
                ▦
              </span>
              <span>
                <strong>New Table</strong>
                <small>Track customers, jobs, products or anything else</small>
              </span>
            </Link>
            <Link
              className="home-manual-action"
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

  return (
    <section className="tenant-content workspace-home-populated">
      <p className="eyebrow">Home</p>
      <h1 className="runtime-title">{businessName}</h1>
      <p className="muted">
        Open a Table or Page to continue running your business.
      </p>
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
    </section>
  );
}
