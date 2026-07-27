import type { ReactNode } from "react";

import { hasCapability, resolveTenant } from "../../../../auth/authorization";
import { Notice } from "../../../../components/notice";
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

export default async function LocationsPage({
  params,
  searchParams,
}: Readonly<LocationsPageProps>): Promise<ReactNode> {
  const { businessSlug } = await params;
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  const canManage = hasCapability(tenant.membership.role, "manage_locations");
  const [error, message, locationsResult] = await Promise.all([
    readSearchParam(searchParams, "error"),
    readSearchParam(searchParams, "message"),
    supabase
      .from("locations")
      .select("*")
      .eq("business_id", tenant.business.id)
      .order("created_at"),
  ]);

  const locations = locationsResult.data ?? [];

  return (
    <section className="tenant-content">
      <p className="eyebrow">Business setup</p>
      <h1 className="page-title">Locations</h1>
      <p className="muted">Manage the places where your team operates.</p>

      {error ? <Notice kind="error">{error}</Notice> : null}
      {message ? <Notice kind="message">{message}</Notice> : null}

      {canManage ? (
        <section className="panel compact-panel">
          <h2>Add a location</h2>
          <form
            action={createLocation.bind(null, businessSlug)}
            className="inline-form"
          >
            <label>
              Name
              <input maxLength={120} name="name" required />
            </label>
            <label>
              Timezone
              <input
                defaultValue={tenant.business.timezone}
                maxLength={80}
                name="timezone"
                required
              />
            </label>
            <button type="submit">Add location</button>
          </form>
        </section>
      ) : null}

      <div className="location-list">
        {locations.length === 0 ? (
          <p className="empty-state">No locations have been added yet.</p>
        ) : (
          locations.map((location) => (
            <article className="location-card" key={location.id}>
              <div className="location-card-heading">
                <div>
                  <h2>{location.name}</h2>
                  <p>
                    {location.timezone} ·{" "}
                    {location.is_active ? "Active" : "Inactive"}
                  </p>
                </div>
                <span
                  className={`status ${location.is_active ? "" : "status-muted"}`}
                >
                  {location.is_active ? "Active" : "Inactive"}
                </span>
              </div>

              {canManage ? (
                <div className="location-actions">
                  <form
                    action={updateLocation.bind(
                      null,
                      businessSlug,
                      location.id,
                    )}
                    className="inline-form"
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
                      <input
                        defaultValue={location.timezone}
                        maxLength={80}
                        name="timezone"
                        required
                      />
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
  );
}
