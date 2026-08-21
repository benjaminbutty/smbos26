import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  ExperienceFormBundle,
  ExperienceViewBundle,
} from "../src/core/experience/service";
import type { FormConfig, ViewConfig } from "../src/core/experience/schemas";
import type { Tables } from "../src/db/supabase/database.types";
import { FormRenderer } from "../src/runtime/forms/form-renderer";
import { PageRenderer } from "../src/runtime/pages/page-renderer";
import type { InlineEditAction } from "../src/runtime/views/inline-edit-contract";
import { ViewRenderer } from "../src/runtime/views/view-renderer";

const businessId = crypto.randomUUID();
const objectId = crypto.randomUUID();
const now = "2026-07-27T12:00:00.000Z";

const objectDefinition: Tables<"object_definitions"> = {
  id: objectId,
  business_id: businessId,
  key: "catering_enquiry",
  singular_label: "Catering Enquiry",
  plural_label: "Catering Enquiries",
  description: "",
  kind: "custom",
  semantic_type: null,
  icon: null,
  is_active: true,
  created_at: now,
  updated_at: now,
};

function field(
  key: string,
  label: string,
  fieldType: Tables<"field_definitions">["field_type"],
  position: number,
  settings: Tables<"field_definitions">["settings_json"] = {},
): Tables<"field_definitions"> {
  return {
    id: crypto.randomUUID(),
    business_id: businessId,
    object_definition_id: objectId,
    key,
    label,
    field_type: fieldType,
    required: key === "company_name",
    default_value: key === "status" ? "New" : null,
    settings_json: settings,
    position,
    is_active: true,
    created_at: now,
    updated_at: now,
  };
}

const fields = [
  field("company_name", "Company", "short_text", 0),
  field("event_date", "Event date", "date", 1),
  field("guest_count", "Guests", "number", 2),
  field("budget", "Budget", "currency", 3, { currency: "GBP" }),
  field("notes", "Notes", "long_text", 4),
  field("status", "Status", "status", 5, {
    options: ["New", "Contacted"],
  }),
];

const records: Tables<"records">[] = [
  {
    id: crypto.randomUUID(),
    business_id: businessId,
    object_definition_id: objectId,
    data_json: {
      company_name: "Acme Ltd",
      event_date: "2026-11-10",
      guest_count: 80,
      budget: 4000,
      notes: "Lunch service",
      status: "New",
    },
    record_status: "active",
    created_by: crypto.randomUUID(),
    created_at: now,
    updated_at: now,
  },
];

function viewBundle(
  viewType: Tables<"views">["view_type"],
  config: ViewConfig,
): ExperienceViewBundle {
  return {
    definition: {
      id: crypto.randomUUID(),
      business_id: businessId,
      key: `catering_${viewType}`,
      name: `Catering ${viewType}`,
      view_type: viewType,
      object_definition_id: objectId,
      config_json: {},
      audience: "internal",
      is_active: true,
      created_at: now,
      updated_at: now,
    },
    object: objectDefinition,
    fields,
    records,
    config,
  };
}

const tableBundle = viewBundle("table", {
  fields: ["company_name", "event_date", "guest_count", "budget", "status"],
  title_field: "company_name",
  create_form_key: "catering_create",
  edit_form_key: "catering_edit",
  include_archived: false,
});

const formConfig: FormConfig = {
  fields: [
    {
      field: "company_name",
      hidden: false,
      help_text: "Use the business or customer name people recognise.",
    },
    { field: "event_date", hidden: false },
    { field: "guest_count", hidden: false },
    { field: "budget", hidden: false },
    { field: "notes", hidden: false },
    { field: "status", hidden: false },
  ],
  submit_label: "Add enquiry",
};

const formBundle: ExperienceFormBundle = {
  definition: {
    id: crypto.randomUUID(),
    business_id: businessId,
    key: "catering_create",
    name: "New catering enquiry",
    object_definition_id: objectId,
    mode: "create",
    config_json: {},
    audience: "internal",
    is_active: true,
    created_at: now,
    updated_at: now,
  },
  object: objectDefinition,
  fields,
  config: formConfig,
};

describe("generic experience renderers", () => {
  it("renders a Table using configured fields and friendly values", () => {
    const html = renderToStaticMarkup(
      createElement(ViewRenderer, {
        bundle: tableBundle,
        businessSlug: "bedford-bakery",
      }),
    );

    expect(html).toContain("Catering table");
    expect(html).toContain("Company");
    expect(html).toContain("Acme Ltd");
    expect(html).toContain("10 Nov 2026");
    expect(html).toContain("£4,000.00");
    expect(html).toContain("+ New catering enquiry");
  });

  it("renders inline edit affordances only for server-derived eligible Table Fields", () => {
    const action: InlineEditAction = async (state) => state;
    const html = renderToStaticMarkup(
      createElement(ViewRenderer, {
        bundle: {
          ...tableBundle,
          inlineEdit: {
            formKey: "catering_edit",
            fieldKeys: ["company_name", "guest_count", "budget", "status"],
          },
        },
        businessSlug: "bedford-bakery",
        inlineEditAction: action,
      }),
    );

    expect(html).toContain('aria-label="Edit Company"');
    expect(html).toContain('aria-label="Edit Guests"');
    expect(html).toContain('aria-label="Edit Budget"');
    expect(html).toContain('aria-label="Edit Status"');
    expect(html).not.toContain('aria-label="Edit Event date"');
  });

  it("keeps inline editing and navigation controls out of preview", () => {
    const action: InlineEditAction = async (state) => state;
    const html = renderToStaticMarkup(
      createElement(ViewRenderer, {
        bundle: {
          ...tableBundle,
          inlineEdit: {
            formKey: "catering_edit",
            fieldKeys: ["company_name", "guest_count", "budget", "status"],
          },
        },
        businessSlug: "bedford-bakery",
        inlineEditAction: action,
        preview: true,
      }),
    );

    expect(html).not.toContain('aria-label="Edit Company"');
    expect(html).not.toContain("Save");
    expect(html).not.toContain("/workspace/catering-table");
  });

  it("renders a List generically", () => {
    const html = renderToStaticMarkup(
      createElement(ViewRenderer, {
        bundle: viewBundle("list", {
          primary_field: "company_name",
          secondary_fields: ["event_date", "status"],
          include_archived: false,
        }),
        businessSlug: "bedford-bakery",
      }),
    );

    expect(html).toContain("Acme Ltd");
    expect(html).toContain("Event date");
    expect(html).toContain("New");
  });

  it("renders Cards generically", () => {
    const html = renderToStaticMarkup(
      createElement(ViewRenderer, {
        bundle: viewBundle("cards", {
          title_field: "company_name",
          subtitle_field: "status",
          supporting_fields: ["guest_count", "budget"],
          include_archived: false,
        }),
        businessSlug: "bedford-bakery",
      }),
    );

    expect(html).toContain("runtime-card-grid");
    expect(html).toContain("Acme Ltd");
    expect(html).toContain("Guests");
    expect(html).toContain("80");
  });

  it("renders Detail fields and edit navigation generically", () => {
    const html = renderToStaticMarkup(
      createElement(ViewRenderer, {
        bundle: viewBundle("detail", {
          fields: [
            "company_name",
            "event_date",
            "guest_count",
            "budget",
            "notes",
            "status",
          ],
          title_field: "company_name",
          edit_form_key: "catering_edit",
          include_archived: false,
        }),
        businessSlug: "bedford-bakery",
        record: records[0]!,
      }),
    );

    expect(html).toContain("runtime-detail");
    expect(html).toContain("Lunch service");
    expect(html).toContain(">Edit<");
    expect(html).toContain('aria-label="Record location"');
    expect(html).toContain("Where this lives");
    expect(html).toContain("Open Table");
  });

  it("renders generic connected Record groups without a second mutation surface", () => {
    const html = renderToStaticMarkup(
      createElement(ViewRenderer, {
        bundle: viewBundle("detail", {
          fields: ["company_name", "status"],
          title_field: "company_name",
          edit_form_key: "catering_edit",
          include_archived: false,
        }),
        businessSlug: "bedford-bakery",
        record: records[0]!,
        detailConnections: [
          {
            key: "customer:source",
            label: "Customer",
            items: [
              {
                id: "00000000-0000-4000-8000-000000000099",
                label: "Beth Smith",
                href: "/app/bedford-bakery/workspace/customers/00000000-0000-4000-8000-000000000099",
              },
            ],
          },
          {
            key: "services:source",
            label: "Services",
            items: [],
          },
        ],
      }),
    );

    expect(html).toContain("Connections");
    expect(html).toContain("Related work");
    expect(html).toContain("Beth Smith");
    expect(html).toContain("Services");
    expect(html).toContain("None connected yet.");
    expect(html).toContain("/workspace/customers/");
    expect(html).toContain(">Edit<");
  });

  it("renders configured Form controls with friendly labels", () => {
    const html = renderToStaticMarkup(
      createElement(FormRenderer, {
        bundle: formBundle,
        action: "/submit",
      }),
    );

    expect(html).toContain("New catering enquiry");
    expect(html).toContain("Company");
    expect(html).toContain('type="date"');
    expect(html).toContain('type="number"');
    expect(html).toContain("<textarea");
    expect(html).toContain("Add enquiry");
    expect(html).toContain('aria-describedby="help-company_name"');
    expect(html).toContain("Add a new catering enquiry to your workspace.");
  });

  it("shows an object-backed File safely with a non-destructive replacement control", () => {
    const attachment = field("attachment", "Attachment", "file", 6);
    const existingData = records[0]!.data_json;
    if (
      typeof existingData !== "object" ||
      existingData === null ||
      Array.isArray(existingData)
    ) {
      throw new Error("Expected object-backed Record data");
    }
    const html = renderToStaticMarkup(
      createElement(FormRenderer, {
        bundle: {
          ...formBundle,
          definition: {
            ...formBundle.definition,
            key: "catering_edit",
            name: "Edit catering enquiry",
            mode: "edit",
          },
          fields: [...fields, attachment],
          config: {
            fields: [{ field: "attachment", hidden: false }],
          },
        },
        action: "/submit",
        record: {
          ...records[0]!,
          data_json: {
            ...existingData,
            attachment: {
              url: "https://example.test/image.jpg",
              name: "image.jpg",
            },
          },
        },
      }),
    );

    expect(html).toContain("Current file");
    expect(html).toContain('href="https://example.test/image.jpg"');
    expect(html).toContain(">image.jpg</a>");
    expect(html).toContain('placeholder="Paste a replacement URL"');
    expect(html).toContain('value=""');
    expect(html).toContain("Leave blank to keep the current file.");
  });

  it("renders every supported Page block and resolves View/Form blocks", () => {
    const html = renderToStaticMarkup(
      createElement(PageRenderer, {
        businessSlug: "bedford-bakery",
        layout: {
          blocks: [
            { type: "heading", text: "Catering workspace", level: 2 },
            { type: "text", text: "Manage upcoming enquiries." },
            {
              type: "image",
              src: "https://example.test/catering.jpg",
              alt: "Prepared tables",
            },
            {
              type: "button",
              label: "Get in touch",
              href: "mailto:hello@example.test",
              style: "secondary",
            },
            { type: "divider" },
            { type: "view", view_key: "catering_table" },
            { type: "form", form_key: "catering_create" },
          ],
        },
        views: { catering_table: tableBundle },
        forms: {
          catering_create: { bundle: formBundle, action: "/submit" },
        },
      }),
    );

    expect(html).toContain("Catering workspace");
    expect(html).toContain("Manage upcoming enquiries.");
    expect(html).toContain("Prepared tables");
    expect(html).toContain("Acme Ltd");
    expect(html).toContain("Add enquiry");
  });

  it("reuses Page, View and Form renderers without links or actions in preview", () => {
    const html = renderToStaticMarkup(
      createElement(PageRenderer, {
        businessSlug: "bedford-bakery",
        previewMode: true,
        layout: {
          blocks: [
            {
              type: "button",
              label: "Leave preview",
              href: "https://example.test/live",
              style: "primary",
            },
            { type: "view", view_key: "catering_table" },
            { type: "form", form_key: "catering_create" },
          ],
        },
        views: { catering_table: tableBundle },
        forms: {
          catering_create: { bundle: formBundle },
        },
      }),
    );

    expect(html).toContain("Disabled in preview");
    expect(html).toContain("<fieldset");
    expect(html).toContain("disabled");
    expect(html).not.toContain("<form action=");
    expect(html).not.toContain('href="https://example.test/live"');
    expect(html).not.toContain("/workspace/catering-table");
    expect(html).not.toContain("+ New catering enquiry");
  });

  it("renders the configured Booking block in the same customer preview runtime", () => {
    const html = renderToStaticMarkup(
      createElement(PageRenderer, {
        layout: {
          blocks: [
            {
              type: "booking",
              booking_key: "booking",
              config: {
                booking_object_key: "booking",
                customer_object_key: "customer",
                subject_object_key: null,
                service_object_key: "service",
                relationships: {
                  customer_booking: "customer_has_bookings",
                  customer_subject: null,
                  subject_booking: null,
                  service_booking: "service_has_bookings",
                },
                field_mappings: {
                  customer: { name: "name", email: "email", phone: null },
                  booking: {
                    start_at: "starts_at",
                    status: "status",
                    default_status: "Requested",
                    date: null,
                    time: null,
                  },
                  subject: null,
                  service: { name: "name" },
                },
                public_fields: [
                  {
                    target: "customer",
                    field: "name",
                    label: "Your name",
                    required: true,
                    derived: false,
                  },
                ],
                schedule: {
                  timezone_source: "business",
                  location_id: null,
                  days_of_week: [1, 2, 3, 4, 5],
                  first_time: "09:00",
                  last_time: "17:00",
                  slot_interval_minutes: 60,
                  capacity_per_slot: 1,
                  minimum_notice_minutes: 0,
                  booking_horizon_days: 7,
                },
              },
            },
          ],
        },
        bookings: {
          booking: {
            catalogue: {
              business: { name: "Milo Grooming", slug: "milo-grooming" },
              page: { title: "Book a groom", slug: "book" },
              booking: {
                key: "booking",
                customer_label: "Customer",
                subject_label: "Pet",
                timezone: "Europe/London",
                schedule: {
                  timezone_source: "business",
                  location_id: null,
                  days_of_week: [1, 2, 3, 4, 5],
                  first_time: "09:00",
                  last_time: "17:00",
                  slot_interval_minutes: 60,
                  capacity_per_slot: 1,
                  minimum_notice_minutes: 0,
                  booking_horizon_days: 7,
                },
                slots: [
                  {
                    start_at: "2026-08-18T09:00:00.000Z",
                    local_date: "2026-08-18",
                    local_time: "09:00",
                    remaining: 1,
                  },
                ],
                services: [
                  {
                    id: "00000000-0000-4000-8000-000000000099",
                    name: "Full groom",
                  },
                ],
                public_fields: [
                  {
                    target: "customer",
                    field: "name",
                    label: "Name",
                    required: true,
                    derived: false,
                  },
                  {
                    target: "subject",
                    field: "name",
                    label: "Name",
                    required: true,
                    derived: false,
                  },
                ],
              },
            },
          },
        },
        previewMode: true,
        publicMode: true,
      }),
    );

    expect(html).toContain("Explore this Booking Site");
    expect(html).toContain("Full groom");
    expect(html).toContain("Customer name *");
    expect(html).toContain("Pet name *");
    expect(html).toContain('class="booking-honeypot"');
    expect(html).toContain('name="website"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("Disabled in preview");
  });
});
