import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import {
  hasCapability,
  resolveTenant,
} from "../../../../../auth/authorization";
import { Notice } from "../../../../../components/notice";
import { findPublicBookingPage } from "../../../../../core/acquisition/booking-setup";
import { loadActiveManualAmendmentSnapshot } from "../../../../../core/configuration/manual-amendments/service";
import {
  ConfigurationChangeService,
  isControlledConfigurationReadError,
} from "../../../../../core/configuration/service";
import { createServerClient } from "../../../../../db/supabase/server";
import {
  readSearchParam,
  type SearchParams,
} from "../../../../../lib/search-params";
import { prepareBookingSetupProposalAction } from "./actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface BookingSetupPageProps {
  params: Promise<{ businessSlug: string }>;
  searchParams: SearchParams;
}

function BookingNotice({ notice }: Readonly<{ notice: string | undefined }>) {
  if (notice === "input_invalid") {
    return (
      <Notice kind="error">Check the appointment hours and try again.</Notice>
    );
  }
  if (notice === "stale") {
    return (
      <Notice kind="error">
        Setup changed after this page was loaded. Reload and try again.
      </Notice>
    );
  }
  if (notice === "already_installed") {
    return (
      <Notice kind="message">
        This Business already has a public booking Page.
      </Notice>
    );
  }
  if (notice === "existing_setup") {
    return (
      <Notice kind="error">
        An appointments setup is already partly configured. Use the existing
        setup controls before adding public booking.
      </Notice>
    );
  }
  return null;
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

export default async function BookingSetupPage({
  params,
  searchParams,
}: Readonly<BookingSetupPageProps>): Promise<ReactNode> {
  const { businessSlug } = await params;
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  if (!hasCapability(tenant.membership.role, "manage_configuration"))
    notFound();
  const notice = await readSearchParam(searchParams, "notice");
  const configuration = new ConfigurationChangeService(supabase, {
    businessId: tenant.business.id,
    actorId: tenant.user.id,
  });
  let active;
  try {
    active = await loadActiveManualAmendmentSnapshot(configuration);
  } catch (error) {
    if (isControlledConfigurationReadError(error)) notFound();
    throw error;
  }
  const installedPage = findPublicBookingPage(active.snapshot);
  const installed = installedPage !== null;
  return (
    <section className="tenant-content setup-page c7-settings-page">
      <header className="c7-settings-route-heading">
        <div>
          <p className="eyebrow">Settings / Setup</p>
          <h1 className="page-title">Appointments and public booking</h1>
          <p className="lede">
            Prepare a private booking Page and the workspace your team will use
            to manage appointments.
          </p>
        </div>
        <nav className="c7-settings-section-nav" aria-label="Settings sections">
          <Link href={`/app/${encodeURIComponent(businessSlug)}/setup`}>
            Preorder setup
          </Link>
          <a href="#booking-heading" aria-current="page">
            Booking setup
          </a>
        </nav>
      </header>
      <BookingNotice notice={notice} />
      {installed && installedPage?.status === "published" ? (
        <section
          className="panel compact-panel"
          aria-labelledby="booking-heading"
        >
          <h2 id="booking-heading">Booking is already public</h2>
          <p className="muted">
            Use the Site editor to prepare the next schedule change and
            deliberately republish it.
          </p>
          <Link
            className="button button-secondary"
            href={`/app/${encodeURIComponent(businessSlug)}/sites`}
          >
            Open Sites
          </Link>
        </section>
      ) : (
        <form
          action={prepareBookingSetupProposalAction.bind(null, businessSlug)}
          className="panel compact-panel stack-form"
        >
          <h2 id="booking-heading">
            {installed
              ? "Update appointment booking hours"
              : "Set up appointments and public booking"}
          </h2>
          <p className="muted">
            Choose the hours and capacity your customers can book. Nothing
            changes until you review, Validate, and Apply the proposal.
          </p>
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
            <legend>Booking days</legend>
            <div className="setup-day-grid">
              {days.map(([value, label]) => (
                <label className="checkbox-control" key={value}>
                  <input
                    defaultChecked={value < 7}
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
              First booking
              <input
                defaultValue="09:00"
                name="firstTime"
                required
                type="time"
              />
            </label>
            <label>
              Last booking
              <input
                defaultValue="17:00"
                name="lastTime"
                required
                type="time"
              />
            </label>
            <label>
              Time between bookings (minutes)
              <input
                defaultValue="60"
                max={240}
                min={5}
                name="slotIntervalMinutes"
                required
                type="number"
              />
            </label>
            <label>
              Bookings per slot
              <input
                defaultValue="1"
                max={1000}
                min={1}
                name="capacityPerSlot"
                required
                type="number"
              />
            </label>
            <label>
              Minimum notice (minutes)
              <input
                defaultValue="0"
                max={525600}
                min={0}
                name="minimumNoticeMinutes"
                required
                type="number"
              />
            </label>
            <label>
              Booking horizon (days)
              <input
                defaultValue="30"
                max={365}
                min={1}
                name="bookingHorizonDays"
                required
                type="number"
              />
            </label>
          </div>
          <button type="submit">Prepare booking setup</button>
        </form>
      )}
    </section>
  );
}
