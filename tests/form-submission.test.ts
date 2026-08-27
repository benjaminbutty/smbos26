import { beforeAll, describe, expect, it, vi } from "vitest";

import type { FormConfig } from "../src/core/experience/schemas";
import type { Tables } from "../src/db/supabase/database.types";

vi.mock("server-only", () => ({}));

const businessId = crypto.randomUUID();
const objectId = crypto.randomUUID();
const now = "2026-07-27T12:00:00.000Z";

function field(
  key: string,
  label: string,
  fieldType: Tables<"field_definitions">["field_type"],
  required = false,
): Tables<"field_definitions"> {
  return {
    id: crypto.randomUUID(),
    business_id: businessId,
    object_definition_id: objectId,
    key,
    label,
    field_type: fieldType,
    required,
    default_value: null,
    settings_json: {},
    position: 0,
    is_active: true,
    created_at: now,
    updated_at: now,
  };
}

describe("configured Form submission", () => {
  let buildConfiguredSubmission: typeof import("../src/runtime/forms/submission").buildConfiguredSubmission;

  beforeAll(async () => {
    ({ buildConfiguredSubmission } =
      await import("../src/runtime/forms/submission"));
  });

  it("submits only configured fields and ignores forged platform identity", () => {
    const orderNumber = field(
      "order_number",
      "Order number",
      "short_text",
      true,
    );
    const formData = new FormData();
    formData.set("order_number", "ORD-100");
    formData.set("business_id", crypto.randomUUID());
    formData.set("created_by", crypto.randomUUID());
    formData.set("surprise", "not configured");

    expect(
      buildConfiguredSubmission(
        [orderNumber],
        {
          fields: [{ field: "order_number", hidden: false }],
        },
        "create",
        formData,
      ),
    ).toEqual({ order_number: "ORD-100" });
  });

  it("adds Occasion through Field and Form configuration only", () => {
    const orderNumber = field(
      "order_number",
      "Order number",
      "short_text",
      true,
    );
    const occasion = field("occasion", "Occasion", "short_text");
    const beforeConfig: FormConfig = {
      fields: [{ field: "order_number", hidden: false }],
    };
    const afterConfig: FormConfig = {
      fields: [
        { field: "order_number", hidden: false },
        {
          field: "occasion",
          label: "What is the occasion?",
          hidden: false,
        },
      ],
    };
    const formData = new FormData();
    formData.set("order_number", "ORD-101");
    formData.set("occasion", "Anniversary");

    expect(
      buildConfiguredSubmission(
        [orderNumber],
        beforeConfig,
        "create",
        formData,
      ),
    ).toEqual({ order_number: "ORD-101" });
    expect(
      buildConfiguredSubmission(
        [orderNumber, occasion],
        afterConfig,
        "create",
        formData,
      ),
    ).toEqual({
      order_number: "ORD-101",
      occasion: "Anniversary",
    });
  });

  it("returns friendly validation feedback for required values", () => {
    const company = field("company_name", "Company name", "short_text", true);

    expect(() =>
      buildConfiguredSubmission(
        [company],
        { fields: [{ field: "company_name", hidden: false }] },
        "create",
        new FormData(),
      ),
    ).toThrow("Company name is required.");
  });

  it("can compose a generic progressive create without weakening a configured Form", () => {
    const company = field("company_name", "Company name", "short_text", true);
    const notes = field("notes", "Notes", "long_text", true);
    const partial = new FormData();
    partial.set("company_name", "Acme Ltd");

    expect(() =>
      buildConfiguredSubmission(
        [company, notes],
        {
          fields: [
            { field: "company_name", hidden: false },
            { field: "notes", hidden: false },
          ],
        },
        "create",
        partial,
      ),
    ).toThrow("Notes is required.");

    expect(
      buildConfiguredSubmission(
        [company, notes],
        {
          fields: [
            { field: "company_name", hidden: false },
            { field: "notes", hidden: false },
          ],
        },
        "create",
        partial,
        {},
        { enforceRequired: false },
      ),
    ).toEqual({ company_name: "Acme Ltd" });
  });

  it("preserves an existing File on a blank edit and accepts a URL replacement", () => {
    const title = field("title", "Title", "short_text", true);
    const attachment = field("attachment", "Attachment", "file");
    const config: FormConfig = {
      fields: [
        { field: "title", hidden: false },
        { field: "attachment", hidden: false },
      ],
    };
    const existingFile = {
      url: "https://example.test/image.jpg",
      name: "image.jpg",
    };
    const blankReplacement = new FormData();
    blankReplacement.set("title", "Updated title");
    blankReplacement.set("attachment", "");

    expect(
      buildConfiguredSubmission(
        [title, attachment],
        config,
        "edit",
        blankReplacement,
        { attachment: existingFile },
      ),
    ).toEqual({ title: "Updated title" });

    const validReplacement = new FormData();
    validReplacement.set("title", "Updated title");
    validReplacement.set("attachment", "https://example.test/replacement.jpg");

    expect(
      buildConfiguredSubmission(
        [title, attachment],
        config,
        "edit",
        validReplacement,
        { attachment: existingFile },
      ),
    ).toEqual({
      title: "Updated title",
      attachment: "https://example.test/replacement.jpg",
    });
  });
});
