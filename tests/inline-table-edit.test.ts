import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { resolveInlineEditEligibility } from "../src/core/experience/service";
import { inlineEditableFieldKeys } from "../src/core/experience/inline-edit";
import type {
  ConfigurationDefinitionSource,
  SourcedViewDefinition,
} from "../src/core/configuration/definition-source";
import type {
  FormConfig,
  TableViewConfig,
} from "../src/core/experience/schemas";
import type { Tables } from "../src/db/supabase/database.types";
import { FieldInputControl } from "../src/runtime/fields/field-renderer";

vi.mock("server-only", () => ({}));

const businessId = crypto.randomUUID();
const objectId = crypto.randomUUID();
const now = "2026-08-08T12:00:00.000Z";

function field(
  key: string,
  fieldType: Tables<"field_definitions">["field_type"],
  options: Partial<Tables<"field_definitions">> = {},
): Tables<"field_definitions"> {
  return {
    id: crypto.randomUUID(),
    business_id: businessId,
    object_definition_id: objectId,
    key,
    label: key,
    field_type: fieldType,
    required: false,
    default_value: null,
    settings_json: {},
    position: 0,
    is_active: true,
    created_at: now,
    updated_at: now,
    ...options,
  };
}

describe("inline Table Field eligibility and semantics", () => {
  it("does not grant eligibility to public or candidate Table definitions", async () => {
    const tableConfig: TableViewConfig = {
      fields: ["name"],
      edit_form_key: "edit_form",
      include_archived: false,
    };
    const tableDefinition = {
      id: crypto.randomUUID(),
      business_id: businessId,
      key: "items",
      name: "Items",
      view_type: "table",
      object_definition_id: objectId,
      config_json: tableConfig,
      audience: "internal",
      is_active: true,
      created_at: now,
      updated_at: now,
      object_key: "item",
    } satisfies SourcedViewDefinition;
    const getFormByKey = vi.fn();

    await expect(
      resolveInlineEditEligibility(
        {
          kind: "live",
          getFormByKey,
        } as unknown as ConfigurationDefinitionSource,
        { ...tableDefinition, audience: "public" },
        tableConfig,
        [field("name", "short_text")],
      ),
    ).resolves.toBeUndefined();
    await expect(
      resolveInlineEditEligibility(
        {
          kind: "snapshot",
          getFormByKey,
        } as unknown as ConfigurationDefinitionSource,
        tableDefinition,
        tableConfig,
        [field("name", "short_text")],
      ),
    ).resolves.toBeUndefined();
    expect(getFormByKey).not.toHaveBeenCalled();
  });

  it("gives an inline input an explicit accessible name", () => {
    const html = renderToStaticMarkup(
      createElement(FieldInputControl, {
        ariaLabel: "Edit Customer name",
        field: field("name", "short_text"),
        value: "Acme Ltd",
      }),
    );

    expect(html).toContain('aria-label="Edit Customer name"');
  });

  it("only exposes supported active Table Fields present and visible in the edit Form", () => {
    const fields = [
      field("name", "short_text"),
      field("quantity", "number"),
      field("price", "currency"),
      field("available", "boolean"),
      field("category", "select", { settings_json: { options: ["A", "B"] } }),
      field("status", "status", { settings_json: { options: ["New"] } }),
      field("notes", "long_text"),
      field("hidden_name", "short_text"),
      field("absent_name", "short_text"),
      field("archived_name", "short_text", { is_active: false }),
    ];
    const form: FormConfig = {
      fields: [
        { field: "name", hidden: false },
        { field: "quantity", hidden: false },
        { field: "price", hidden: false },
        { field: "available", hidden: false },
        { field: "category", hidden: false },
        { field: "status", hidden: false },
        { field: "notes", hidden: false },
        { field: "hidden_name", hidden: true, default_value: "Default" },
      ],
    };

    expect(
      inlineEditableFieldKeys(
        [
          "name",
          "quantity",
          "price",
          "available",
          "category",
          "status",
          "notes",
          "hidden_name",
          "absent_name",
          "archived_name",
          "not_in_form",
        ],
        fields,
        form,
      ),
    ).toEqual(["name", "quantity", "price", "available", "category", "status"]);
  });

  it("reuses Form parsing for one-field patches, including clearing and booleans", async () => {
    const { buildConfiguredFieldPatch } =
      await import("../src/runtime/forms/submission");
    const name = field("name", "short_text");
    const quantity = field("quantity", "number");
    const price = field("price", "currency");
    const available = field("available", "boolean");
    const status = field("status", "status", {
      settings_json: { options: ["Available", "Hired"] },
    });

    const nameData = new FormData();
    nameData.set("name", " Elizabeth ");
    nameData.set("unrelated", "ignored");
    expect(
      buildConfiguredFieldPatch(
        name,
        { field: "name", hidden: false },
        nameData,
      ),
    ).toEqual({ name: "Elizabeth" });

    const quantityData = new FormData();
    quantityData.set("quantity", "3");
    expect(
      buildConfiguredFieldPatch(
        quantity,
        { field: "quantity", hidden: false },
        quantityData,
      ),
    ).toEqual({ quantity: 3 });

    const priceData = new FormData();
    priceData.set("price", "12.50");
    expect(
      buildConfiguredFieldPatch(
        price,
        { field: "price", hidden: false },
        priceData,
      ),
    ).toEqual({ price: 12.5 });

    const availableData = new FormData();
    availableData.set("available", "on");
    expect(
      buildConfiguredFieldPatch(
        available,
        { field: "available", hidden: false },
        availableData,
      ),
    ).toEqual({ available: true });

    const unchecked = new FormData();
    expect(
      buildConfiguredFieldPatch(
        available,
        { field: "available", hidden: false },
        unchecked,
      ),
    ).toEqual({ available: false });

    const statusData = new FormData();
    statusData.set("status", "Hired");
    expect(
      buildConfiguredFieldPatch(
        status,
        { field: "status", hidden: false },
        statusData,
      ),
    ).toEqual({ status: "Hired" });

    const clearName = new FormData();
    clearName.set("name", "");
    expect(
      buildConfiguredFieldPatch(
        name,
        { field: "name", hidden: false },
        clearName,
      ),
    ).toEqual({ name: null });
  });

  it("rejects invalid numeric and configured options, and required clears", async () => {
    const { buildConfiguredFieldPatch, ExperienceSubmissionError } =
      await import("../src/runtime/forms/submission");
    const quantity = field("quantity", "number");
    const requiredName = field("name", "short_text", { required: true });
    const status = field("status", "status", {
      settings_json: { options: ["Available", "Hired"] },
    });

    const invalidNumber = new FormData();
    invalidNumber.set("quantity", "not-a-number");
    expect(() =>
      buildConfiguredFieldPatch(
        quantity,
        { field: "quantity", hidden: false },
        invalidNumber,
      ),
    ).toThrow(ExperienceSubmissionError);

    const invalidOption = new FormData();
    invalidOption.set("status", "Created by attacker");
    expect(() =>
      buildConfiguredFieldPatch(
        status,
        { field: "status", hidden: false },
        invalidOption,
      ),
    ).toThrow("Choose a valid status.");

    const requiredClear = new FormData();
    requiredClear.set("name", "");
    expect(() =>
      buildConfiguredFieldPatch(
        requiredName,
        { field: "name", hidden: false },
        requiredClear,
      ),
    ).toThrow("name is required.");
  });
});
