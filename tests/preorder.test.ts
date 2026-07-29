import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { POST } from "../src/app/api/preorder/[businessSlug]/[pageSlug]/route";
import { pageLayoutSchema } from "../src/core/experience/schemas";
import {
  preorderConfigSchema,
  publicPreorderConfirmationSchema,
  publicPreorderSubmissionSchema,
  type PreorderConfig,
  type PublicPreorderCatalogue,
} from "../src/core/preorder/schemas";
import { defaultPreorderEmailAdapter } from "../src/core/preorder/email";
import { PageRenderer } from "../src/runtime/pages/page-renderer";

vi.mock("server-only", () => ({}));

const config: PreorderConfig = {
  schedule: {
    days_of_week: [6, 7],
    start_time: "11:00",
    end_time: "16:00",
    slot_interval_minutes: 30,
    slot_capacity: 10,
    cutoff_hours: 48,
    booking_horizon_days: 90,
  },
  field_mappings: {
    product: {
      name: "name",
      description: "description",
      price: "price",
      image: "image",
      status: "status",
      active_status_value: "Active",
    },
    customer: { name: "name", email: "email", phone: "phone" },
    order: {
      public_reference: "public_reference",
      status: "status",
      new_status_value: "New",
      collection_at: "collection_at",
      collection_local_display: "collection_local_display",
      collection_timezone: "collection_timezone",
      collection_location_name: "collection_location_name",
      customer_name: "customer_name",
      customer_email: "customer_email",
      customer_phone: "customer_phone",
      item_summary: "item_summary",
      total: "total",
    },
    order_item: {
      product_name: "product_name",
      quantity: "quantity",
      unit_price: "unit_price",
      line_total: "line_total",
    },
  },
  public_fields: [
    {
      target: "customer",
      field: "name",
      label: "Name",
      required: true,
      autocomplete: "name",
    },
    {
      target: "customer",
      field: "email",
      label: "Email",
      required: true,
      autocomplete: "email",
    },
    {
      target: "customer",
      field: "phone",
      label: "Phone",
      required: false,
      autocomplete: "tel",
    },
    {
      target: "order",
      field: "occasion",
      label: "Occasion",
      required: false,
      autocomplete: "off",
    },
  ],
};

const catalogue: PublicPreorderCatalogue = {
  business: { name: "Bedford Bakery", slug: "bedford-bakery" },
  page: { title: "Preorder", slug: "preorder" },
  preorder: {
    key: "bakery_preorder",
    currency: "GBP",
    schedule: config.schedule,
    locations: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        name: "Bedford",
        timezone: "Europe/London",
        slots: [
          {
            date: "2026-08-01",
            time: "11:00",
            collection_at: "2026-08-01T10:00:00+00:00",
            available: true,
            remaining: 10,
          },
        ],
      },
    ],
    products: [
      {
        id: "00000000-0000-4000-8000-000000000002",
        name: "Afternoon Tea Box",
        description: "Freshly prepared for collection.",
        price: 30,
        location_ids: ["00000000-0000-4000-8000-000000000001"],
      },
    ],
    public_fields: [
      {
        target: "customer",
        field: "name",
        label: "Name",
        required: true,
        autocomplete: "name",
        field_type: "short_text",
      },
      {
        target: "customer",
        field: "email",
        label: "Email",
        required: true,
        autocomplete: "email",
        field_type: "email",
      },
    ],
  },
  generated_at: "2026-07-28T12:00:00+00:00",
};

describe("preorder configuration grammar", () => {
  it("accepts the six configuration-only acceptance changes", () => {
    const changed = structuredClone(config);
    changed.schedule.cutoff_hours = 72;
    changed.schedule.days_of_week = [6];
    changed.schedule.slot_capacity = 4;
    changed.public_fields = changed.public_fields.map((field) =>
      field.target === "customer" && field.field === "phone"
        ? { ...field, required: true }
        : field,
    );

    expect(preorderConfigSchema.parse(changed)).toEqual(changed);
    expect(
      changed.public_fields.some(
        ({ target, field }) => target === "order" && field === "occasion",
      ),
    ).toBe(true);
    // Product-to-Location availability is graph link data, intentionally
    // outside this capability configuration.
  });

  it("rejects unknown keys, aliased mappings and runtime-owned public fields", () => {
    expect(() =>
      preorderConfigSchema.parse({
        ...config,
        unsafe: true,
      }),
    ).toThrow();

    expect(() =>
      preorderConfigSchema.parse({
        ...config,
        field_mappings: {
          ...config.field_mappings,
          order_item: {
            ...config.field_mappings.order_item,
            line_total: "unit_price",
          },
        },
      }),
    ).toThrow(/one preorder responsibility/i);

    expect(() =>
      preorderConfigSchema.parse({
        ...config,
        public_fields: [
          ...config.public_fields,
          {
            target: "order",
            field: "status",
            label: "Forged status",
            required: false,
          },
        ],
      }),
    ).toThrow(/controlled by the preorder runtime/i);
  });

  it("limits public submissions to bounded quantities and allow-listed shape", () => {
    const submission = {
      idempotency_token: "00000000-0000-4000-8000-000000000003",
      location_id: "00000000-0000-4000-8000-000000000001",
      collection_at: "2026-08-01T10:00:00+00:00",
      items: [
        {
          product_id: "00000000-0000-4000-8000-000000000002",
          quantity: 1,
        },
      ],
      fields: {
        customer: { name: "Ada", email: "ada@example.test" },
        order: {},
      },
      website: "",
    };

    expect(publicPreorderSubmissionSchema.parse(submission)).toEqual(
      submission,
    );
    expect(() =>
      publicPreorderSubmissionSchema.parse({
        ...submission,
        business_id: "00000000-0000-4000-8000-000000000099",
      }),
    ).toThrow();
    expect(() =>
      publicPreorderSubmissionSchema.parse({
        ...submission,
        items: [{ ...submission.items[0], quantity: 0 }],
      }),
    ).toThrow();
    expect(() =>
      publicPreorderSubmissionSchema.parse({
        ...submission,
        items: [{ ...submission.items[0], quantity: 1.5 }],
      }),
    ).toThrow();
    expect(() =>
      publicPreorderSubmissionSchema.parse({
        ...submission,
        items: [{ ...submission.items[0], unit_price: 0.01 }],
      }),
    ).toThrow();
    expect(() =>
      publicPreorderSubmissionSchema.parse({ ...submission, items: [] }),
    ).toThrow();
  });
});

describe("trusted preorder Page block", () => {
  it("accepts only the narrow preorder reference grammar", () => {
    expect(
      pageLayoutSchema.parse({
        blocks: [{ type: "preorder", preorder_key: "bakery_preorder" }],
      }),
    ).toEqual({
      blocks: [{ type: "preorder", preorder_key: "bakery_preorder" }],
    });
    expect(() =>
      pageLayoutSchema.parse({
        blocks: [
          {
            type: "preorder",
            preorder_key: "bakery_preorder",
            view_key: "orders",
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects an oversized HTTP submission before reading its body", async () => {
    const response = await POST(
      new Request(
        "http://localhost:3000/api/preorder/bedford-bakery/preorder?preorderKey=bakery_preorder",
        {
          method: "POST",
          headers: {
            "content-length": "50001",
            "content-type": "application/json",
          },
          body: "{}",
        },
      ),
      {
        params: Promise.resolve({
          businessSlug: "bedford-bakery",
          pageSlug: "preorder",
        }),
      },
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      ok: false,
      code: "invalid_submission",
    });
  });

  it("renders the customer experience publicly and fails closed internally", () => {
    const layout = {
      blocks: [{ type: "preorder" as const, preorder_key: "bakery_preorder" }],
    };
    const publicHtml = renderToStaticMarkup(
      createElement(PageRenderer, {
        layout,
        publicMode: true,
        preorders: {
          bakery_preorder: {
            catalogue,
            endpoint: "/api/preorder/bedford-bakery/preorder",
          },
        },
      }),
    );
    const internalHtml = renderToStaticMarkup(
      createElement(PageRenderer, { layout }),
    );

    expect(publicHtml).toContain("Choose your boxes");
    expect(publicHtml).toContain("Afternoon Tea Box");
    expect(publicHtml).not.toContain("object_definition_id");
    expect(publicHtml).not.toContain("payment");
    expect(internalHtml).toContain(
      "Preorder checkout is available only on the published customer page.",
    );
  });

  it("renders candidate preorder configuration without an endpoint in preview", () => {
    const html = renderToStaticMarkup(
      createElement(PageRenderer, {
        layout: {
          blocks: [
            {
              type: "preorder" as const,
              preorder_key: "bakery_preorder",
            },
          ],
        },
        previewMode: true,
        publicMode: true,
        preorders: {
          bakery_preorder: { catalogue },
        },
      }),
    );

    expect(html).toContain("Explore this preorder — submission is disabled.");
    expect(html).toContain(
      "Your choices stay only in this browser view and reset when you leave or reload.",
    );
    expect(html).toContain("Disabled in preview");
    expect(html).toContain("Saturday, Sunday");
    expect(html).toMatch(
      /aria-label="Add one Afternoon Tea Box"[^>]*type="button"/,
    );
    expect(html).not.toMatch(
      /aria-label="Add one Afternoon Tea Box"[^>]*disabled/,
    );
    expect(html).toContain('Location<select required="">');
    expect(html).toMatch(
      /<input autoComplete="name" required="" type="text" name="customer\.name"/,
    );
    expect(html).not.toContain("/api/preorder/");
  });
});

describe("preorder email adapters", () => {
  const confirmation = publicPreorderConfirmationSchema.parse({
    public_reference: "PO-ABCDEF12",
    collection_location: "Bedford",
    collection_at: "2026-08-01T10:00:00+00:00",
    timezone: "Europe/London",
    items: [
      {
        name: "Afternoon Tea Box",
        quantity: 1,
        unit_price: 30,
        line_total: 30,
      },
    ],
    item_summary: "1 × Afternoon Tea Box",
    total: 30,
    confirmation_email: "customer@example.test",
  });

  it("captures confirmation email locally", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    await defaultPreorderEmailAdapter("test").sendConfirmation(confirmation);

    expect(consoleInfo).toHaveBeenCalledWith(
      "[SMBOS local confirmation email]",
      expect.stringContaining("PO-ABCDEF12"),
    );
    consoleInfo.mockRestore();
  });

  it("fails closed when production has no configured provider", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    await expect(
      defaultPreorderEmailAdapter("production").sendConfirmation(confirmation),
    ).rejects.toThrow("No production preorder email provider is configured.");
    expect(consoleInfo).not.toHaveBeenCalled();
    consoleInfo.mockRestore();
  });
});
