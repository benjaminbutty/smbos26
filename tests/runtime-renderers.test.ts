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
    { field: "company_name", hidden: false },
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
});
