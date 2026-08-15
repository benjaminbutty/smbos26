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

function errorMessage(code: string): string {
  switch (code) {
    case "invalid_slot":
      return "That time is no longer available. Choose another slot.";
    case "capacity_unavailable":
      return "That slot has just filled. Choose another time.";
    case "invalid_service":
      return "That service is no longer available.";
    case "required_field":
      return "Complete the required details before continuing.";
    case "rate_limited":
      return "There have been too many attempts. Please wait and try again.";
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
    for (const field of props.catalogue.booking.public_fields) {
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
            disabled={preview && props.catalogue.booking.services.length === 0}
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
          <legend>Time</legend>
          <div>
            {slots.map((slot) => (
              <label key={slot.start_at}>
                <input
                  checked={selectedStart === slot.start_at}
                  disabled={slot.remaining === 0}
                  name="booking-slot"
                  onChange={() => setSelectedStart(slot.start_at)}
                  type="radio"
                  value={slot.start_at}
                />
                <span>{slot.local_time}</span>
                <small>{slot.remaining} left</small>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <div className="booking-fields">
        {props.catalogue.booking.public_fields.map((field) => (
          <label key={`${field.target}.${field.field}`}>
            <span>
              {field.label}
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
      <label aria-hidden="true" className="booking-honeypot">
        Website
        <input autoComplete="off" name="website" tabIndex={-1} type="text" />
      </label>
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
  );
}
