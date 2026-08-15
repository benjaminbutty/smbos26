import { describe, expect, it } from "vitest";

import {
  bookingConfigSchema,
  bookingSubmissionSchema,
} from "../src/core/booking/schemas";
import { pageLayoutSchema } from "../src/core/experience/schemas";

const uuid = "10000000-0000-4000-8000-000000000001";

function bookingConfig() {
  return {
    booking_object_key: "bookings",
    customer_object_key: "customers",
    subject_object_key: "pets",
    service_object_key: "services",
    relationships: {
      customer_booking: "customer_booking",
      customer_subject: "customer_pet",
      subject_booking: "pet_booking",
      service_booking: "service_booking",
    },
    field_mappings: {
      customer: { name: "name", email: "email", phone: "phone" },
      booking: {
        start_at: "starts_at",
        status: "status",
        default_status: "requested",
      },
      subject: { name: "name" },
      service: { name: "name" },
    },
    public_fields: [
      { target: "customer", field: "name", label: "Your name", required: true },
      {
        target: "customer",
        field: "email",
        label: "Email",
        required: true,
        autocomplete: "email",
      },
      { target: "subject", field: "name", label: "Pet name", required: true },
    ],
    schedule: {
      timezone_source: "business",
      location_id: null,
      days_of_week: [1, 2, 3, 4, 5],
      first_time: "09:00",
      last_time: "17:00",
      slot_interval_minutes: 60,
      capacity_per_slot: 1,
      minimum_notice_minutes: 120,
      booking_horizon_days: 30,
    },
  };
}

describe("Journey 1 public capability contracts", () => {
  it("accepts a generic connected booking configuration", () => {
    const parsed = bookingConfigSchema.parse(bookingConfig());
    expect(parsed.booking_object_key).toBe("bookings");
    expect(parsed.schedule.capacity_per_slot).toBe(1);
    expect(parsed.field_mappings.subject?.name).toBe("name");
  });

  it("requires a trusted Location when the schedule uses Location timezone", () => {
    expect(() =>
      bookingConfigSchema.parse({
        ...bookingConfig(),
        schedule: { ...bookingConfig().schedule, timezone_source: "location" },
      }),
    ).toThrow("A Location is required");
  });

  it("keeps the public Page grammar explicit for public Forms and Booking", () => {
    const layout = pageLayoutSchema.parse({
      blocks: [
        { type: "heading", text: "Book a grooming visit", level: 1 },
        { type: "public_form", form_key: "enquiry" },
        {
          type: "booking",
          booking_key: "appointments",
          config: bookingConfig(),
        },
      ],
    });
    expect(layout.blocks.map((block) => block.type)).toEqual([
      "heading",
      "public_form",
      "booking",
    ]);
  });

  it("requires a UUID idempotency token for booking submission", () => {
    const submission = bookingSubmissionSchema.parse({
      idempotency_token: uuid,
      start_at: "2026-08-20T09:00:00+01:00",
      customer: { name: "Sarah Evans" },
      subject: { name: "Milo" },
      booking: {},
      service_record_id: null,
      website: "",
    });
    expect(submission.idempotency_token).toBe(uuid);
  });
});
