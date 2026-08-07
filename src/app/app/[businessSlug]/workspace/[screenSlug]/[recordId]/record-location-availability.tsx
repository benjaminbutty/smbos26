import type { ReactNode } from "react";

import { createRecordLocationLinkService } from "../../../../../../core/graph/location-links";
import { createServerClient } from "../../../../../../db/supabase/server";
import {
  linkRecordToLocation,
  unlinkRecordFromLocation,
} from "./location-actions";

interface RecordLocationAvailabilityProps {
  businessId: string;
  businessSlug: string;
  screenSlug: string;
  recordId: string;
  objectDefinitionId: string;
}

export async function RecordLocationAvailability({
  businessId,
  businessSlug,
  screenSlug,
  recordId,
  objectDefinitionId,
}: Readonly<RecordLocationAvailabilityProps>): Promise<ReactNode> {
  const supabase = await createServerClient();
  const state = await createRecordLocationLinkService(supabase, {
    businessId,
  }).readManualAvailability({ recordId, objectDefinitionId });
  if (!state.eligible) return null;

  const linked = state.locations.filter((location) => location.linkId);
  const available = state.locations.filter(
    (location) => location.isActive && !location.linkId,
  );
  const linkAction = linkRecordToLocation.bind(
    null,
    businessSlug,
    screenSlug,
    recordId,
  );
  const unlinkAction = unlinkRecordFromLocation.bind(
    null,
    businessSlug,
    screenSlug,
    recordId,
  );

  return (
    <section className="panel record-location-availability">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Availability</p>
          <h2>Availability by Location</h2>
        </div>
      </div>
      <p className="muted">
        Choose the Locations where this {state.objectLabel.toLowerCase()} can be
        available.
      </p>

      {linked.length > 0 ? (
        <div>
          <h3>Available at</h3>
          <ul className="record-location-list">
            {linked.map((location) => (
              <li key={location.id}>
                <span>
                  {location.name}
                  {!location.isActive ? " (inactive)" : ""}
                </span>
                <form action={unlinkAction}>
                  <input name="linkId" type="hidden" value={location.linkId!} />
                  <input name="locationId" type="hidden" value={location.id} />
                  <button className="button-secondary" type="submit">
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="muted">Not currently available at any Location.</p>
      )}

      {available.length > 0 ? (
        <form action={linkAction} className="inline-form">
          <label>
            Make available at
            <select defaultValue="" name="locationId" required>
              <option disabled value="">
                Choose a Location
              </option>
              {available.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Make available</button>
        </form>
      ) : (
        <p className="muted">
          {state.locations.some((location) => location.isActive)
            ? "This item is already available at every active Location."
            : "Add an active Location before making this item available."}
        </p>
      )}
    </section>
  );
}
