import { describe, expect, it } from "vitest";

import {
  createViewDefinitionSchema,
  formConfigSchema,
  pageLayoutSchema,
  parseViewConfig,
} from "../src/core/experience/schemas";

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
});
