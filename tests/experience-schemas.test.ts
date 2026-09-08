import { describe, expect, it } from "vitest";

import {
  createViewDefinitionSchema,
  formConfigSchema,
  pageLayoutSchema,
  parseViewConfig,
} from "../src/core/experience/schemas";
import {
  pageBlockReferencesForm,
  pageBlockReferencesMedia,
  pageBlockReferencesPreorder,
  pageBlockReferencesView,
} from "../src/core/experience/page-blocks";

describe("experience configuration grammar", () => {
  it("accepts the smallest supported configuration for every View type", () => {
    expect(
      parseViewConfig("table", {
        fields: ["company_name", "status"],
      }),
    ).toMatchObject({ fields: ["company_name", "status"] });
    expect(
      parseViewConfig("list", {
        primary_field: "company_name",
        secondary_fields: ["status"],
      }),
    ).toMatchObject({ primary_field: "company_name" });
    expect(
      parseViewConfig("cards", {
        title_field: "company_name",
        supporting_fields: ["status"],
      }),
    ).toMatchObject({ title_field: "company_name" });
    expect(
      parseViewConfig("detail", {
        fields: ["company_name", "notes"],
      }),
    ).toMatchObject({ fields: ["company_name", "notes"] });
  });

  it("rejects arbitrary View configuration properties", () => {
    expect(() =>
      createViewDefinitionSchema.parse({
        key: "unsafe_view",
        name: "Unsafe",
        viewType: "table",
        objectDefinitionId: crypto.randomUUID(),
        config: {
          fields: ["name"],
          javascript: "alert(1)",
        },
      }),
    ).toThrow();
  });

  it("requires unique Form fields and safe hidden defaults", () => {
    expect(() =>
      formConfigSchema.parse({
        fields: [{ field: "status", hidden: true }],
      }),
    ).toThrow();
    expect(() =>
      formConfigSchema.parse({
        fields: [{ field: "status" }, { field: "status" }],
      }),
    ).toThrow();

    expect(
      formConfigSchema.parse({
        fields: [
          {
            field: "status",
            hidden: true,
            default_value: "New",
          },
        ],
      }),
    ).toMatchObject({
      fields: [{ field: "status", default_value: "New", hidden: true }],
    });
  });

  it("accepts every supported Page block and rejects executable links", () => {
    const layout = pageLayoutSchema.parse({
      blocks: [
        { type: "heading", text: "Catering", level: 1 },
        { type: "text", text: "Plan the next event." },
        {
          type: "image",
          src: "https://example.test/catering.jpg",
          alt: "Prepared tables",
        },
        {
          type: "button",
          label: "Contact us",
          href: "mailto:hello@example.test",
        },
        { type: "view", view_key: "catering_enquiries" },
        { type: "form", form_key: "catering_enquiry_create" },
        { type: "divider" },
      ],
    });

    expect(layout.blocks.map(({ type }) => type)).toEqual([
      "heading",
      "text",
      "image",
      "button",
      "view",
      "form",
      "divider",
    ]);
    expect(() =>
      pageLayoutSchema.parse({
        blocks: [
          { type: "button", label: "Unsafe", href: "javascript:alert(1)" },
        ],
      }),
    ).toThrow();
  });

  it("bounds one-level sections and validates managed checklist images", () => {
    const assetId = crypto.randomUUID();
    const layout = pageLayoutSchema.parse({
      blocks: [
        {
          type: "collapsible",
          summary: "Opening routine",
          open: false,
          blocks: [
            {
              type: "image",
              asset_id: assetId,
              alt: "The opening checklist beside the till",
              presentation: "wide",
            },
            {
              type: "view",
              view_key: "opening_tasks",
              checklist: {
                label_field: "name",
                completed_field: "completed",
              },
            },
          ],
        },
      ],
    });

    expect(layout.blocks[0]).toMatchObject({
      type: "collapsible",
      open: false,
    });
    expect(() =>
      pageLayoutSchema.parse({
        blocks: [
          {
            type: "collapsible",
            summary: "Nested",
            blocks: [
              {
                type: "collapsible",
                summary: "No",
                blocks: [],
              },
            ],
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      pageLayoutSchema.parse({
        blocks: [
          {
            type: "image",
            src: "https://example.test/photo.jpg",
          },
        ],
      }),
    ).toThrow(/description/);
  });

  it("collects references inside contained sections", () => {
    const layout = pageLayoutSchema.parse({
      blocks: [
        {
          type: "collapsible",
          summary: "Live work",
          blocks: [
            { type: "view", view_key: "orders" },
            { type: "form", form_key: "enquiry" },
            { type: "preorder", preorder_key: "preorder" },
            {
              type: "image",
              asset_id: "00000000-0000-4000-8000-000000000031",
              alt: "A private guide image",
            },
          ],
        },
      ],
    });

    expect(pageBlockReferencesView(layout)).toEqual(["orders"]);
    expect(pageBlockReferencesForm(layout)).toEqual(["enquiry"]);
    expect(pageBlockReferencesPreorder(layout)).toEqual(["preorder"]);
    expect(pageBlockReferencesMedia(layout)).toEqual([
      "00000000-0000-4000-8000-000000000031",
    ]);
  });
});
