"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";

import type {
  PublicBookingCatalogue,
  PublicBookingResult,
} from "../../core/booking/schemas";

type BookingConfirmation = Extract<
  PublicBookingResult,
  { ok: true }
>["confirmation"];

interface BookingExperienceProps {
  catalogue: PublicBookingCatalogue;
  endpoint?: string;
  mode?: "live" | "preview";
}

type BookingFieldTarget = "customer" | "subject" | "booking";

function displayFieldLabel(
  field: PublicBookingCatalogue["booking"]["public_fields"][number],
  targetLabel: string,
): string {
  return field.label.trim().toLocaleLowerCase("en") === "name" &&
    field.target !== "booking"
    ? `${targetLabel} name`
    : field.label;
}

function errorMessage(code: string): string {
  switch (code) {
    case "invalid_slot":
    case "capacity_unavailable":
      return "That time is no longer available. Choose another slot.";
    case "invalid_service":
      return "That service is no longer available.";
    case "required_field":
    case "invalid_field":
      return "Complete the required details before continuing.";
    case "rate_limited":
      return "There have been too many attempts. Please wait and try again.";
    case "not_found":
    case "invalid_submission":
    case "retry":
    case "rejected":
    default:
      return "We could not complete that booking. Check the details and try again.";
  }
}

export function BookingExperience(
  props: Readonly<BookingExperienceProps>,
): ReactNode {
  const preview = props.mode === "preview";
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedStart, setSelectedStart] = useState("");
  const [selectedService, setSelectedService] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(
    null,
  );
  const [idempotencyToken, setIdempotencyToken] = useState(() =>
    preview ? "" : crypto.randomUUID(),
  );

  const dates = useMemo(
    () => [
      ...new Set(props.catalogue.booking.slots.map((slot) => slot.local_date)),
    ],
    [props.catalogue.booking.slots],
  );
  const slots = props.catalogue.booking.slots.filter(
    (slot) => slot.local_date === selectedDate,
  );
  const visibleFields = props.catalogue.booking.public_fields.filter(
    (field) => !field.derived,
  );
  const fieldGroups: Array<{
    label: string;
    target: BookingFieldTarget;
    fields: typeof visibleFields;
  }> = [
    {
      label: `${props.catalogue.booking.customer_label} details`,
      target: "customer" as const,
      fields: visibleFields.filter((field) => field.target === "customer"),
    },
    ...(props.catalogue.booking.subject_label
      ? [
          {
            label: `${props.catalogue.booking.subject_label} details`,
            target: "subject" as const,
            fields: visibleFields.filter((field) => field.target === "subject"),
          },
        ]
      : []),
    {
      label: "Booking details",
      target: "booking" as const,
      fields: visibleFields.filter((field) => field.target === "booking"),
    },
  ].filter((group) => group.fields.length > 0);
  const headingId = `booking-experience-title-${props.catalogue.booking.key}`;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (preview || !props.endpoint) return;
    setError("");
    if (!selectedStart) {
      setError("Choose a date and time first.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const fields: Record<
      "customer" | "subject" | "booking",
      Record<string, string>
    > = {
      customer: {},
      subject: {},
      booking: {},
    };
    for (const field of visibleFields) {
      const value = form.get(`${field.target}.${field.field}`);
      if (typeof value === "string" && value.trim() !== "") {
        fields[field.target][field.field] = value.trim();
      }
    }

    setSubmitting(true);
    try {
      const response = await fetch(props.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotency_token: idempotencyToken,
          start_at: selectedStart,
          customer: fields.customer,
          subject: fields.subject,
          booking: fields.booking,
          service_record_id: selectedService || null,
          website: form.get("website") ?? "",
        }),
      });
      const result = (await response.json()) as PublicBookingResult;
      if (!result.ok) {
        setError(errorMessage(result.code));
        return;
      }
      setConfirmation(result.confirmation);
    } catch {
      setError("We could not reach the booking service. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmation) {
    return (
      <section className="booking-confirmation" aria-live="polite">
        <p className="eyebrow">Booking confirmed</p>
        <h2>Your time is reserved.</h2>
        <p>
          Reference <strong>{confirmation.public_reference}</strong>
        </p>
        <p>
          {new Intl.DateTimeFormat("en-GB", {
            dateStyle: "full",
            timeStyle: "short",
            timeZone: confirmation.timezone,
          }).format(new Date(confirmation.start_at))}
        </p>
        <button
          className="button button-secondary"
          onClick={() => {
            setConfirmation(null);
            setSelectedDate("");
            setSelectedStart("");
            setSelectedService("");
            setIdempotencyToken(crypto.randomUUID());
          }}
          type="button"
        >
          Make another booking
        </button>
      </section>
    );
  }

  return (
    <section aria-labelledby={headingId} className="booking-experience">
      <header className="booking-experience-heading">
        <p className="eyebrow">Booking</p>
        <h2 id={headingId}>Request a booking</h2>
      </header>
      <form className="booking-flow" onSubmit={submit}>
        {preview ? (
          <aside className="booking-preview-notice" role="status">
            <strong>Explore this Booking Site — submission is disabled.</strong>
            <p>
              Choose a service, date and example slot. Your choices stay in this
              preview and nothing will be created.
            </p>
          </aside>
        ) : null}
        {props.catalogue.booking.services.length > 0 ? (
          <label>
            Service
            <select
              onChange={(event) => setSelectedService(event.target.value)}
              value={selectedService}
            >
              <option value="">Choose a service…</option>
              {props.catalogue.booking.services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Date
          <select
            onChange={(event) => {
              setSelectedDate(event.target.value);
              setSelectedStart("");
            }}
            value={selectedDate}
          >
            <option value="">Choose a date…</option>
            {dates.map((date) => (
              <option key={date} value={date}>
                {new Intl.DateTimeFormat("en-GB", {
                  dateStyle: "full",
                  timeZone: "UTC",
                }).format(new Date(`${date}T12:00:00Z`))}
              </option>
            ))}
          </select>
        </label>
        {selectedDate ? (
          <fieldset className="booking-slot-picker">
            <legend>Choose a time</legend>
            <div>
              {slots.map((slot) => {
                const selected = selectedStart === slot.start_at;
                const availability =
                  slot.remaining === 0 ? "Full" : "Available";
                return (
                  <label
                    className={selected ? "booking-slot-selected" : undefined}
                    key={slot.start_at}
                  >
                    <input
                      aria-label={`${slot.local_time}, ${availability}`}
                      checked={selected}
                      disabled={slot.remaining === 0}
                      name="booking-slot"
                      onChange={() => setSelectedStart(slot.start_at)}
                      type="radio"
                      value={slot.start_at}
                    />
                    <span>{slot.local_time}</span>
                    <small>{availability}</small>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}
        <div className="booking-fields">
          {fieldGroups.map((group) => (
            <fieldset className="booking-field-group" key={group.target}>
              <legend>{group.label}</legend>
              <div>
                {group.fields.map((field) => (
                  <label key={`${field.target}.${field.field}`}>
                    <span>
                      {displayFieldLabel(
                        field,
                        field.target === "customer"
                          ? props.catalogue.booking.customer_label
                          : (props.catalogue.booking.subject_label ??
                              "Subject"),
                      )}
                      {field.required ? " *" : ""}
                    </span>
                    <input
                      autoComplete={field.autocomplete}
                      name={`${field.target}.${field.field}`}
                      required={field.required && !preview}
                      type={field.autocomplete === "email" ? "email" : "text"}
                    />
                    {field.help_text ? <small>{field.help_text}</small> : null}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <div aria-hidden="true" className="booking-honeypot">
          <label htmlFor="booking-website">Website</label>
          <input
            aria-hidden="true"
            autoComplete="off"
            id="booking-website"
            name="website"
            tabIndex={-1}
            type="text"
          />
        </div>
        {error ? (
          <p className="booking-error" role="alert">
            {error}
          </p>
        ) : null}
        <button disabled={preview || submitting} type="submit">
          {preview
            ? "Disabled in preview"
            : submitting
              ? "Booking…"
              : "Request booking"}
        </button>
      </form>
    </section>
  );
}
