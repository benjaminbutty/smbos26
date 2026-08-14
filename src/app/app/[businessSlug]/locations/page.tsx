import Link from "next/link";
import type { ReactNode } from "react";

import { hasCapability, resolveTenant } from "../../../../auth/authorization";
import type { BusinessRole } from "../../../../auth/capabilities";
import { Notice } from "../../../../components/notice";
import {
  timezoneOptionLabel,
  timezoneOptions,
} from "../../../../components/timezone-options";
import { createServerClient } from "../../../../db/supabase/server";
import {
  readSearchParam,
  type SearchParams,
} from "../../../../lib/search-params";
import {
  createLocation,
  deactivateLocation,
  updateLocation,
} from "../../../../tenancy/actions";

interface LocationsPageProps {
  params: Promise<{ businessSlug: string }>;
  searchParams: SearchParams;
}

const roleOrder: readonly BusinessRole[] = ["owner", "admin", "staff"];

const roleLabels: Readonly<Record<BusinessRole, string>> = {
  owner: "Owner",
  admin: "Admin",
  staff: "Staff",
};

const roleDescriptions: Readonly<Record<BusinessRole, string>> = {
  owner: "Owns the business and can manage access, locations and setup.",
  admin: "Can manage day-to-day business settings, locations and setup.",
  staff: "Can use assigned workspace areas; Settings stays read-only.",
};

function configuredTimezoneOptions(values: readonly string[]) {
  const options = [...timezoneOptions()];
  for (const value of values) {
    if (!options.some((option) => option.value === value)) {
      options.push({ value, label: timezoneOptionLabel(value) });
    }
  }
  return options.sort((left, right) =>
    left.label.localeCompare(right.label, "en"),
  );
}

export default async function LocationsPage({
  params,
  searchParams,
}: Readonly<LocationsPageProps>): Promise<ReactNode> {
  const { businessSlug } = await params;
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  const canManage = hasCapability(tenant.membership.role, "manage_locations");
  const [error, message, locationsResult, membershipsResult] =
    await Promise.all([
      readSearchParam(searchParams, "error"),
      readSearchParam(searchParams, "message"),
      supabase
        .from("locations")
        .select("*")
        .eq("business_id", tenant.business.id)
        .order("created_at"),
      supabase
        .from("business_memberships")
        .select("role")
        .eq("business_id", tenant.business.id),
    ]);

  const locations = locationsResult.data ?? [];
  const membershipRoles = membershipsResult.error
    ? [tenant.membership.role]
    : (membershipsResult.data ?? []).map(({ role }) => role);
  if (!membershipRoles.includes(tenant.membership.role)) {
    membershipRoles.push(tenant.membership.role);
  }
  const roleCounts: Record<BusinessRole, number> = {
    owner: 0,
    admin: 0,
    staff: 0,
  };
  for (const role of membershipRoles) {
    roleCounts[role] += 1;
  }
  const timezoneSelectOptions = configuredTimezoneOptions([
    tenant.business.timezone,
    ...locations.map((location) => location.timezone),
  ]);
  const locationsPath = `/app/${encodeURIComponent(businessSlug)}/locations`;
  const setupPath = `/app/${encodeURIComponent(businessSlug)}/setup`;

  return (
    <section
      className="tenant-content c7-settings-page"
      aria-labelledby="settings-title"
    >
      <header className="c7-settings-intro">
        <div>
          <p className="eyebrow">Settings</p>
          <h1 className="page-title" id="settings-title">
            Settings
          </h1>
          <p className="lede">
            Keep business details, locations and access clear as your work
            changes.
          </p>
        </div>
        <span className="c7-settings-role-badge">
          {roleLabels[tenant.membership.role]}
        </span>
      </header>

      <nav className="c7-settings-section-nav" aria-label="Settings sections">
        <a href="#business">Business</a>
        <a href="#locations">Locations</a>
        <a href="#team">Team &amp; permissions</a>
        {hasCapability(tenant.membership.role, "manage_configuration") ? (
          <Link href={setupPath}>Setup</Link>
        ) : null}
      </nav>

      {error ? <Notice kind="error">{error}</Notice> : null}
      {message ? <Notice kind="message">{message}</Notice> : null}

      <section
        className="c7-settings-section"
        id="business"
        aria-labelledby="business-heading"
      >
        <div className="c7-settings-section-heading">
          <div>
            <p className="eyebrow">Business presentation</p>
            <h2 id="business-heading">{tenant.business.name}</h2>
            <p className="muted">
              The business context used across your workspace and customer
              pages.
            </p>
          </div>
          <span className="c7-settings-business-mark" aria-hidden="true">
            {tenant.business.name.slice(0, 2).toUpperCase()}
          </span>
        </div>
        <dl className="c7-settings-summary-list">
          <div>
            <dt>Business type</dt>
            <dd>{tenant.business.business_type || "Not set"}</dd>
          </div>
          <div>
            <dt>Business timezone</dt>
            <dd>{timezoneOptionLabel(tenant.business.timezone)}</dd>
          </div>
          <div>
            <dt>Current access</dt>
            <dd>{roleLabels[tenant.membership.role]}</dd>
          </div>
        </dl>
        <p className="c7-settings-read-only-note">
          Business identity is kept separate from merchant-facing content. Any
          changes remain subject to the existing server-authorised settings
          flows.
        </p>
      </section>

      <section
        className="c7-settings-section"
        id="locations"
        aria-labelledby="locations-heading"
      >
        <div className="c7-settings-section-heading">
          <div>
            <p className="eyebrow">Operational context</p>
            <h2 id="locations-heading">Locations</h2>
            <p className="muted">
              Optional places where your team works. Collection and local time
              use the location selected here.
            </p>
          </div>
          <span
            className="c7-settings-count"
            aria-label={`${locations.length} locations`}
          >
            {locations.length}
          </span>
        </div>

        {canManage ? (
          <section
            className="c7-settings-form-card"
            aria-labelledby="add-location-heading"
          >
            <h3 id="add-location-heading">Add a location</h3>
            <p className="field-help">
              Use a human-readable timezone so dates and operating hours stay
              predictable.
            </p>
            <form
              action={createLocation.bind(null, businessSlug)}
              className="c7-settings-location-form"
            >
              <label>
                Name
                <input maxLength={120} name="name" required />
              </label>
              <label>
                Timezone
                <select
                  defaultValue={tenant.business.timezone}
                  name="timezone"
                  required
                >
                  {timezoneSelectOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit">Add location</button>
            </form>
          </section>
        ) : (
          <p className="c7-settings-read-only-note" role="status">
            You can view locations here. Location changes are available to an
            Owner or Admin through the server-authorised workspace controls.
          </p>
        )}

        <div className="c7-settings-location-list">
          {locations.length === 0 ? (
            <div className="c7-settings-empty-state">
              <strong>No locations yet</strong>
              <p>
                Add one when your work needs a distinct place or collection
                point.
              </p>
            </div>
          ) : (
            locations.map((location) => (
              <article className="c7-settings-location-card" key={location.id}>
                <div className="c7-settings-location-heading">
                  <div>
                    <h3>{location.name}</h3>
                    <p>{timezoneOptionLabel(location.timezone)}</p>
                  </div>
                  <span
                    aria-label={`${location.name} is ${location.is_active ? "active" : "inactive"}`}
                    className={`status ${location.is_active ? "c7-status-active" : "status-muted"}`}
                  >
                    {location.is_active ? "Active" : "Inactive"}
                  </span>
                </div>

                {canManage ? (
                  <div className="c7-settings-location-actions">
                    <form
                      action={updateLocation.bind(
                        null,
                        businessSlug,
                        location.id,
                      )}
                      className="c7-settings-location-form"
                    >
                      <label>
                        Name
                        <input
                          defaultValue={location.name}
                          maxLength={120}
                          name="name"
                          required
                        />
                      </label>
                      <label>
                        Timezone
                        <select
                          aria-label={`${location.name} timezone`}
                          defaultValue={location.timezone}
                          name="timezone"
                          required
                        >
                          {timezoneSelectOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button className="button-secondary" type="submit">
                        Save
                      </button>
                    </form>

                    {location.is_active ? (
                      <form
                        action={deactivateLocation.bind(
                          null,
                          businessSlug,
                          location.id,
                        )}
                      >
                        <button className="button-danger" type="submit">
                          Deactivate
                        </button>
                      </form>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))
          )}
        </div>
      </section>

      <section
        className="c7-settings-section"
        id="team"
        aria-labelledby="team-heading"
      >
        <div className="c7-settings-section-heading">
          <div>
            <p className="eyebrow">Access boundary</p>
            <h2 id="team-heading">Team &amp; permissions</h2>
            <p className="muted">
              Roles explain what each person can see and change. Membership
              writes stay server-authorised.
            </p>
          </div>
        </div>
        <div className="c7-settings-role-grid">
          {roleOrder.map((role) => (
            <article
              className={`c7-settings-role-card ${role === tenant.membership.role ? "is-current" : ""}`}
              key={role}
            >
              <div className="c7-settings-role-card-heading">
                <h3>{roleLabels[role]}</h3>
                {role === tenant.membership.role ? (
                  <span className="c7-settings-current-role">Your role</span>
                ) : null}
              </div>
              <p>{roleDescriptions[role]}</p>
              <span className="c7-settings-role-count">
                {roleCounts[role]}{" "}
                {roleCounts[role] === 1 ? "member" : "members"}
              </span>
            </article>
          ))}
        </div>
        <p className="c7-settings-read-only-note">
          {hasCapability(tenant.membership.role, "manage_memberships")
            ? "Your role includes access-management authority. The existing membership boundary remains the source of truth."
            : "Your role does not include access-management authority. Settings is presented read-only for this business."}
        </p>
      </section>

      <p className="c7-settings-route-links">
        <Link href={locationsPath} aria-current="page">
          Locations
        </Link>
        {hasCapability(tenant.membership.role, "manage_configuration") ? (
          <Link href={setupPath}>Setup</Link>
        ) : null}
      </p>
    </section>
  );
}
