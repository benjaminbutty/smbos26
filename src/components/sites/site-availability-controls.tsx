import type { ReactNode } from "react";

type AvailabilityItem = {
  targetId: string;
  label: string;
  status: "available" | "withdrawn";
  availabilityRevision: number;
};

type AvailabilityRow = AvailabilityItem & {
  siteId: string;
  activeReleaseRevision: number;
};

type Action = (formData: FormData) => void | Promise<void>;

function AvailabilityForm({
  action,
  item,
  label,
}: Readonly<{
  action: Action;
  item: AvailabilityRow;
  label: string;
}>): ReactNode {
  const withdrawn = item.status === "withdrawn";
  return (
    <form action={action} className="site-availability-form">
      <input name="targetId" type="hidden" value={item.targetId} />
      <input name="siteId" type="hidden" value={item.siteId} />
      <input
        name="expectedActiveReleaseRevision"
        type="hidden"
        value={item.activeReleaseRevision}
      />
      <input
        name="expectedAvailabilityRevision"
        type="hidden"
        value={item.availabilityRevision}
      />
      <span>
        {label}: {item.label}{" "}
        <strong>{withdrawn ? "withdrawn" : "available"}</strong>
      </span>
      <button type="submit">
        {withdrawn ? "Re-enable for next release" : "Withdraw now"}
      </button>
    </form>
  );
}

export function SiteAvailabilityControls({
  activeReleaseRevision,
  fieldItems,
  mediaItems,
  objectItems,
  recordItems,
  siteId,
  actions,
}: Readonly<{
  activeReleaseRevision: number;
  fieldItems: AvailabilityItem[];
  mediaItems: AvailabilityItem[];
  objectItems: AvailabilityItem[];
  recordItems: AvailabilityItem[];
  siteId: string;
  actions: {
    reenableField: Action;
    reenableMedia: Action;
    reenableObject: Action;
    reenableRecord: Action;
    withdrawField: Action;
    withdrawMedia: Action;
    withdrawObject: Action;
    withdrawRecord: Action;
  };
}>): ReactNode {
  const withContext = (item: AvailabilityItem): AvailabilityRow => ({
    ...item,
    siteId,
    activeReleaseRevision,
  });
  const records = recordItems.map(withContext);
  const objects = objectItems.map(withContext);
  const fields = fieldItems.map(withContext);
  const media = mediaItems.map(withContext);
  return (
    <section
      className="panel site-availability-panel"
      aria-label="Public availability controls"
    >
      <div>
        <p className="eyebrow">Availability</p>
        <h2>Withdraw live data safely</h2>
        <p className="muted">
          Withdrawal takes effect immediately. Re-enabled items return after you
          publish a new Site update.
        </p>
      </div>
      {objects.length > 0 ? (
        <div className="site-availability-group">
          <h3>Record types</h3>
          {objects.map((item) => (
            <AvailabilityForm
              action={
                item.status === "withdrawn"
                  ? actions.reenableObject
                  : actions.withdrawObject
              }
              item={item}
              key={item.targetId}
              label="Type"
            />
          ))}
        </div>
      ) : null}
      {records.length > 0 ? (
        <div className="site-availability-group">
          <h3>Records</h3>
          {records.map((item) => (
            <AvailabilityForm
              action={
                item.status === "withdrawn"
                  ? actions.reenableRecord
                  : actions.withdrawRecord
              }
              item={item}
              key={item.targetId}
              label="Record"
            />
          ))}
        </div>
      ) : null}
      {fields.length > 0 ? (
        <div className="site-availability-group">
          <h3>Properties</h3>
          {fields.map((item) => (
            <AvailabilityForm
              action={
                item.status === "withdrawn"
                  ? actions.reenableField
                  : actions.withdrawField
              }
              item={item}
              key={item.targetId}
              label="Property"
            />
          ))}
        </div>
      ) : null}
      {media.length > 0 ? (
        <div className="site-availability-group">
          <h3>Managed media</h3>
          {media.map((item) => (
            <AvailabilityForm
              action={
                item.status === "withdrawn"
                  ? actions.reenableMedia
                  : actions.withdrawMedia
              }
              item={item}
              key={item.targetId}
              label="Asset"
            />
          ))}
        </div>
      ) : null}
      {objects.length === 0 &&
      records.length === 0 &&
      fields.length === 0 &&
      media.length === 0 ? (
        <p className="muted">
          Publish a Site collection or image to manage availability.
        </p>
      ) : null}
    </section>
  );
}
