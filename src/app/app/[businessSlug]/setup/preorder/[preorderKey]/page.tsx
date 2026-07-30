import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import {
  hasCapability,
  resolveTenant,
} from "../../../../../../auth/authorization";
import { Notice } from "../../../../../../components/notice";
import {
  listPreorderScheduleSetups,
  loadActiveManualAmendmentSnapshot,
} from "../../../../../../core/configuration/manual-amendments/service";
import { ConfigurationChangeService } from "../../../../../../core/configuration/service";
import { createServerClient } from "../../../../../../db/supabase/server";
import {
  readSearchParam,
  type SearchParams,
} from "../../../../../../lib/search-params";
import { preparePreorderScheduleProposalAction } from "../../actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PreorderSchedulePageProps {
  params: Promise<{ businessSlug: string; preorderKey: string }>;
  searchParams: SearchParams;
}

const days = [
  [1, "Monday"],
  [2, "Tuesday"],
  [3, "Wednesday"],
  [4, "Thursday"],
  [5, "Friday"],
  [6, "Saturday"],
  [7, "Sunday"],
] as const;

function EditorNotice({
  notice,
}: Readonly<{ notice: string | undefined }>): ReactNode {
  if (notice === "stale") {
    return (
      <Notice kind="error">
        Setup changed after this page was loaded. Reload and try again.
      </Notice>
    );
  }
  if (notice === "input_invalid") {
    return (
      <Notice kind="error">Check the collection settings and try again.</Notice>
    );
  }
  if (notice === "nothing_changed") {
    return <Notice kind="message">Nothing changed.</Notice>;
  }
  return null;
}

export default async function PreorderSchedulePage({
  params,
  searchParams,
}: Readonly<PreorderSchedulePageProps>): Promise<ReactNode> {
  const { businessSlug, preorderKey } = await params;
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
  const setup = listPreorderScheduleSetups(active.snapshot).find(
    (candidate) => candidate.key === preorderKey,
  );
  if (!setup) {
    notFound();
  }
  const notice = await readSearchParam(searchParams, "notice");
  const submitAction = preparePreorderScheduleProposalAction.bind(
    null,
    businessSlug,
    preorderKey,
  );

  return (
    <article className="tenant-content setup-page">
      <Link className="back-link" href={`/app/${businessSlug}/setup`}>
        ← Return to Edit setup
      </Link>
      <header className="history-detail-header">
        <div>
          <p className="eyebrow">Preorder collection settings</p>
          <h1 className="runtime-title">{setup.label}</h1>
          <p className="lede">
            Saving here prepares a change for review. It does not immediately
            change the live customer page.
          </p>
        </div>
      </header>

      <nav
        aria-label="Preorder setup sections"
        className="history-section-links"
      >
        <span aria-current="page">Collection settings</span>
        <Link
          href={`/app/${encodeURIComponent(businessSlug)}/setup/preorder/${encodeURIComponent(preorderKey)}/questions`}
        >
          Questions customers answer
        </Link>
      </nav>

      <EditorNotice notice={notice} />

      <form action={submitAction} className="panel compact-panel stack-form">
        <input
          name="expectedBaseVersionId"
          type="hidden"
          value={active.baseVersionId}
        />
        <input
          name="expectedHeadRevision"
          type="hidden"
          value={active.headRevision}
        />

        <fieldset className="setup-days">
          <legend>Collection days</legend>
          <p className="field-help">
            Choose every day customers can collect an order.
          </p>
          <div className="setup-day-grid">
            {days.map(([value, label]) => (
              <label className="checkbox-control" key={value}>
                <input
                  defaultChecked={setup.schedule.days_of_week.includes(value)}
                  name="daysOfWeek"
                  type="checkbox"
                  value={value}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="setup-field-grid">
          <label>
            First collection
            <input
              defaultValue={setup.schedule.start_time}
              name="startTime"
              required
              type="time"
            />
          </label>
          <label>
            Last collection
            <input
              defaultValue={setup.schedule.end_time}
              name="endTime"
              required
              type="time"
            />
          </label>
          <label>
            Time between collection slots
            <input
              defaultValue={setup.schedule.slot_interval_minutes}
              max={240}
              min={5}
              name="slotIntervalMinutes"
              required
              step={1}
              type="number"
            />
            <span className="field-help">Minutes, from 5 to 240.</span>
          </label>
          <label>
            Maximum orders per slot
            <input
              defaultValue={setup.schedule.slot_capacity}
              max={1000}
              min={1}
              name="slotCapacity"
              required
              step={1}
              type="number"
            />
          </label>
          <label>
            Notice required before collection
            <input
              defaultValue={setup.schedule.cutoff_hours}
              max={8760}
              min={0}
              name="cutoffHours"
              required
              step={1}
              type="number"
            />
            <span className="field-help">Hours, from 0 to 8,760.</span>
          </label>
          <label>
            How far ahead customers can order
            <input
              defaultValue={setup.schedule.booking_horizon_days}
              max={365}
              min={1}
              name="bookingHorizonDays"
              required
              step={1}
              type="number"
            />
            <span className="field-help">Days, from 1 to 365.</span>
          </label>
        </div>

        <div className="configuration-action-note">
          Review remains a separate step. This submission does not validate or
          apply the change.
        </div>
        <div className="form-actions">
          <button type="submit">Review change</button>
        </div>
      </form>
    </article>
  );
}
