import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { hasCapability, resolveTenant } from "../../../../auth/authorization";
import { Notice } from "../../../../components/notice";
import {
  listPreorderQuestionSetups,
  listPreorderScheduleSetups,
  loadActiveManualAmendmentSnapshot,
  ManualAmendmentError,
} from "../../../../core/configuration/manual-amendments/service";
import { getInitialPreorderStarterState } from "../../../../core/configuration/initial-preorder/service";
import {
  ConfigurationChangeService,
  isControlledConfigurationReadError,
} from "../../../../core/configuration/service";
import { createServerClient } from "../../../../db/supabase/server";
import {
  readSearchParam,
  type SearchParams,
} from "../../../../lib/search-params";
import { prepareInitialPreorderProposalAction } from "./actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface SetupPageProps {
  params: Promise<{ businessSlug: string }>;
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

function StarterNotice({ notice }: Readonly<{ notice: string | undefined }>) {
  if (notice === "input_invalid") {
    return (
      <Notice kind="error">Check the preorder settings and try again.</Notice>
    );
  }
  if (notice === "stale") {
    return (
      <Notice kind="error">
        Setup changed after this page was loaded. Reload and try again.
      </Notice>
    );
  }
  if (notice === "no_active_locations") {
    return (
      <Notice kind="error">
        Add at least one active Location before setting up preorders.
      </Notice>
    );
  }
  if (notice === "location_unavailable") {
    return (
      <Notice kind="error">
        One of the selected collection Locations is no longer active. Reload and
        try again.
      </Notice>
    );
  }
  if (notice === "already_installed") {
    return (
      <Notice kind="message">
        This Business already has a preorder setup. Use the existing setup
        below.
      </Notice>
    );
  }
  if (notice === "business_not_clean") {
    return (
      <Notice kind="error">
        The initial preorder starter is available only for a clean Business.
        Existing configuration was left unchanged.
      </Notice>
    );
  }
  return null;
}

function InitialPreorderStarter({
  activeLocations,
  baseVersionId,
  businessSlug,
  headRevision,
  state,
}: Readonly<{
  activeLocations: Array<{ id: string; name: string; timezone: string }>;
  baseVersionId: string;
  businessSlug: string;
  headRevision: number;
  state: ReturnType<typeof getInitialPreorderStarterState>;
}>): ReactNode {
  if (state === "no_active_locations") {
    return (
      <div className="panel compact-panel">
        <h3>Set up preorders</h3>
        <p className="muted">
          Add an active Location before choosing where customers can collect.
        </p>
        <Link
          className="button button-secondary"
          href={`/app/${encodeURIComponent(businessSlug)}/locations`}
        >
          Add a Location
        </Link>
      </div>
    );
  }
  if (state !== "ready") {
    return (
      <div className="panel compact-panel">
        <h3>Initial setup is not available</h3>
        <p className="muted">
          The initial starter does not combine with an existing preorder or
          partial configuration. Use the existing setup controls for changes.
        </p>
      </div>
    );
  }

  return (
    <form
      action={prepareInitialPreorderProposalAction.bind(null, businessSlug)}
      className="panel compact-panel stack-form"
    >
      <input name="expectedBaseVersionId" type="hidden" value={baseVersionId} />
      <input name="expectedHeadRevision" type="hidden" value={headRevision} />
      <p className="muted">
        Choose the collection Locations and operating values. These values are
        editable starter settings; nothing changes until you review, Validate,
        and Apply the proposal.
      </p>

      <fieldset className="setup-days">
        <legend>Collection Locations</legend>
        <p className="field-help">Choose one or more active Locations.</p>
        <div className="setup-day-grid">
          {activeLocations.map((location) => (
            <label className="checkbox-control" key={location.id}>
              <input name="locationIds" type="checkbox" value={location.id} />
              {location.name} ({location.timezone})
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="setup-days">
        <legend>Collection days</legend>
        <p className="field-help">Choose every day customers can collect.</p>
        <div className="setup-day-grid">
          {days.map(([value, label]) => (
            <label className="checkbox-control" key={value}>
              <input name="daysOfWeek" type="checkbox" value={value} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="setup-field-grid">
        <label>
          First collection
          <input name="startTime" required type="time" />
        </label>
        <label>
          Last collection
          <input name="endTime" required type="time" />
        </label>
        <label>
          Time between collection slots (minutes)
          <input
            max={240}
            min={5}
            name="slotIntervalMinutes"
            required
            type="number"
          />
        </label>
        <label>
          Maximum orders per slot
          <input
            max={1000}
            min={1}
            name="slotCapacity"
            required
            type="number"
          />
        </label>
        <label>
          Notice required before collection (hours)
          <input max={8760} min={0} name="cutoffHours" required type="number" />
        </label>
        <label>
          How far ahead customers can order (days)
          <input
            max={365}
            min={1}
            name="bookingHorizonDays"
            required
            type="number"
          />
        </label>
      </div>

      <button type="submit">Set up preorders</button>
    </form>
  );
}

export default async function SetupPage({
  params,
  searchParams,
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
  const notice = await readSearchParam(searchParams, "notice");
  let setups;
  let questionSetups;
  let active;
  const locationsResult = await supabase
    .from("locations")
    .select("id,name,timezone,is_active")
    .eq("business_id", tenant.business.id)
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (locationsResult.error || !locationsResult.data) {
    throw new Error("Could not load active Locations.", {
      cause: locationsResult.error,
    });
  }
  try {
    active = await loadActiveManualAmendmentSnapshot(configuration);
    setups = listPreorderScheduleSetups(active.snapshot);
    questionSetups = new Map(
      listPreorderQuestionSetups(active.snapshot).map((setup) => [
        setup.key,
        setup,
      ]),
    );
  } catch (error) {
    if (
      error instanceof ManualAmendmentError ||
      isControlledConfigurationReadError(error)
    ) {
      notFound();
    }
    throw error;
  }

  return (
    <section className="tenant-content setup-page">
      <p className="eyebrow">Business setup</p>
      <h1 className="page-title">Edit setup</h1>
      <p className="lede">
        Choose an area to prepare a change for review. Your live customer pages
        stay unchanged until an Owner or Admin deliberately validates and
        applies the proposal.
      </p>

      <StarterNotice notice={notice} />

      <section className="change-section" aria-labelledby="preorder-heading">
        <div className="section-heading">
          <div>
            <h2 id="preorder-heading">Preorder setup</h2>
            <p className="muted">
              Collection settings and the questions customers answer.
            </p>
          </div>
          <span className="section-count">{setups.length}</span>
        </div>
        {setups.length === 0 ? (
          <InitialPreorderStarter
            activeLocations={locationsResult.data}
            baseVersionId={active.baseVersionId}
            businessSlug={businessSlug}
            headRevision={active.headRevision}
            state={getInitialPreorderStarterState(
              active.snapshot,
              locationsResult.data.length,
            )}
          />
        ) : (
          <div className="change-card-grid">
            {setups.map((setup) => (
              <article className="change-card" key={setup.key}>
                <h3>{setup.label}</h3>
                <p className="muted">
                  {setup.schedule.days_of_week.length} collection{" "}
                  {setup.schedule.days_of_week.length === 1 ? "day" : "days"} ·{" "}
                  {setup.schedule.start_time}–{setup.schedule.end_time} ·{" "}
                  {questionSetups.get(setup.key)?.questions.length ?? 0}{" "}
                  questions
                </p>
                <div className="configuration-action-links">
                  <Link
                    className="button button-secondary"
                    href={`/app/${encodeURIComponent(businessSlug)}/setup/preorder/${encodeURIComponent(setup.key)}`}
                  >
                    Collection settings
                  </Link>
                  <Link
                    className="button button-secondary"
                    href={`/app/${encodeURIComponent(businessSlug)}/setup/preorder/${encodeURIComponent(setup.key)}/questions`}
                  >
                    Questions customers answer
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
