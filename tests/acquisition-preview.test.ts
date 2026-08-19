import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CandidatePreviewShell } from "../src/components/candidate-preview-shell";
import { enhanceAcquisitionPayload } from "../src/core/acquisition/capabilities";
import { composeStarterComposition } from "../src/core/acquisition/composer";
import {
  buildCandidatePreviewModel,
  candidateChecksum,
} from "../src/core/acquisition/preview";

function dogGroomingPayload() {
  return enhanceAcquisitionPayload(
    composeStarterComposition(
      "appointments",
      "I run a mobile dog grooming business and organise customers and bookings through WhatsApp.",
    ),
    {
      onlineBooking: true,
      usesServices: true,
      capacityPerSlot: 1,
      publicEnquiry: null,
    },
    "I run a mobile dog grooming business and organise customers and bookings through WhatsApp.",
  );
}

describe("Journey 1 candidate preview model", () => {
  it("is deterministic and creates only bounded synthetic connected data", () => {
    const payload = dogGroomingPayload();
    const first = buildCandidatePreviewModel(payload);
    const second = buildCandidatePreviewModel(payload);

    expect(first).toEqual(second);
    expect(first.checksum).toBe(candidateChecksum(payload));
    expect(
      Object.values(first.tables).every(({ table }) => table.rows.length <= 2),
    ).toBe(true);

    const customerTable = first.tables.customer_view?.table;
    const appointmentTable = first.tables.appointment_view?.table;
    expect(first.tables.customer_view).toEqual(
      expect.objectContaining({
        objectKey: "customer",
        objectLabel: "Customers",
        recordTypeLabel: "Customer",
      }),
    );
    expect(customerTable?.rows[0]?.values.name).toBe("Sarah Evans");
    expect(appointmentTable?.rows[0]?.connectionValues).toEqual(
      expect.objectContaining({
        "connection:customer_has_bookings:target": expect.any(Array),
      }),
    );
    expect(JSON.stringify(first)).not.toContain("service_role");
  });

  it("prepares public booking exploration without an endpoint or write data", () => {
    const model = buildCandidatePreviewModel(dogGroomingPayload());
    const bookingPage = model.pages.find((page) => page.audience === "public");
    const booking = model.bookings.booking?.catalogue;

    expect(bookingPage?.status).toBe("draft");
    expect(booking?.booking.slots.length).toBeGreaterThan(0);
    expect(booking?.booking.services.map(({ name }) => name)).toEqual([
      "Full groom",
      "Wash and tidy",
    ]);
    expect(booking?.booking.subject_label).toBe("Pet");
    expect(
      booking?.booking.public_fields.some(
        (field) => field.target === "subject" && field.required,
      ),
    ).toBe(true);
    expect(
      booking?.booking.public_fields.some(
        (field) => field.target === "booking" && field.derived,
      ),
    ).toBe(true);
    expect(model.bookings.booking).not.toHaveProperty("endpoint");
    expect(model.preorders).toEqual({});
  });

  it("builds public Form bundles for read-only field exploration", () => {
    const payload = enhanceAcquisitionPayload(
      composeStarterComposition(
        "enquiries",
        "I need to organise customer enquiries for my service business.",
      ),
      {
        onlineBooking: null,
        usesServices: null,
        capacityPerSlot: 1,
        publicEnquiry: true,
      },
      "I need to organise customer enquiries for my service business.",
    );
    const model = buildCandidatePreviewModel(payload);
    const publicForm = Object.values(model.forms).find(
      ({ bundle }) => bundle.definition.audience === "public",
    );

    expect(publicForm?.bundle.definition.mode).toBe("create");
    expect(publicForm?.bundle.config.fields.length).toBeGreaterThan(0);
    expect(
      Object.values(model.pages).some((page) => page.audience === "public"),
    ).toBe(true);
  });
});

describe("Journey 1 candidate preview shell", () => {
  it("keeps Work, Sites, refinement and the persistent approval bar in one anatomy", () => {
    const model = buildCandidatePreviewModel(dogGroomingPayload());
    const html = renderToStaticMarkup(
      createElement(CandidatePreviewShell, {
        candidateChecksum: "a".repeat(64),
        currentPageKey: "overview",
        pages: model.pages,
        tables: model.tables,
        title: model.title,
        children: createElement("p", null, "Candidate content"),
      }),
    );

    expect(html).toContain("Preview mode");
    expect(html).toContain("nothing has been created");
    expect(html).toContain("Back to Lenni");
    expect(html).toContain("Use this setup");
    expect(html).toContain("Refine setup");
    expect(html).toContain('aria-label="Preview actions"');
    expect(html).toContain("Business creation comes later");
    expect(html).toContain("Draft");
    expect(html).toContain("Tables");
    expect(html).toContain("<form");
  });
});
