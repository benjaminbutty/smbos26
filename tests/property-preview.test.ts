import { describe, expect, it } from "vitest";

import type { EditorTable } from "../src/runtime/editor-kernel/contracts";
import {
  describePropertyChange,
  ensureCompactPropertyPreviewColumns,
  previewTableWithConnection,
  previewTableWithProperty,
  reorderPropertyOptions,
  validatePropertyOptions,
} from "../src/runtime/editor-kernel/property-preview";

const table: EditorTable = {
  key: "customers",
  name: "Customers",
  primaryColumnKey: "name",
  columns: [
    { key: "name", label: "Name", kind: "text", primary: true, width: 180 },
    { key: "area", label: "Area", kind: "text", width: 140 },
    { key: "phone", label: "Phone", kind: "phone", width: 150 },
  ],
  rows: [
    {
      id: "record-1",
      values: { name: "Amelia Carter", area: "North", phone: "0123" },
    },
  ],
};

describe("J3-I1 property preview", () => {
  it("shows a proposed Connection as empty and non-operable", () => {
    const preview = previewTableWithConnection(table, {
      targetViewKey: "services",
      label: "Services",
      currentMultiplicity: "several",
      targetMultiplicity: "several",
      reverseLabel: "Appointments",
      addReverse: true,
    });
    expect(preview.columns.at(-1)).toMatchObject({
      kind: "connection",
      label: "Services",
      editable: false,
      preview: true,
      readOnlyReason: "Add this connection before selecting Records.",
    });
    expect(preview.rows).toBe(table.rows);
    expect(preview.rows[0]?.connectionValues).toBeUndefined();
  });

  it("inserts a non-editable empty overlay without changing authoritative rows", () => {
    const preview = previewTableWithProperty(table, {
      label: "Referral source",
      kind: "select",
      options: [
        "Google",
        "Instagram",
        "Recommendation",
        "Returning customer",
        "Other",
      ],
      placement: { mode: "after", anchorColumnKey: "area" },
    });

    expect(preview.columns.map((column) => column.label)).toEqual([
      "Name",
      "Area",
      "Referral source",
      "Phone",
    ]);
    expect(preview.columns[2]).toMatchObject({
      editable: false,
      kind: "select",
      label: "Referral source",
      preview: true,
      readOnlyReason: "Not added yet",
    });
    expect(preview.rows).toBe(table.rows);
    expect(preview.rows[0]?.values).not.toHaveProperty("__proposed_property__");
    expect(table.columns).toHaveLength(3);
  });

  it("provides finite owner-readable consequence copy", () => {
    const descriptor = describePropertyChange(table, {
      label: "Referral source",
      kind: "select",
      options: ["Google", "Instagram", "Recommendation"],
      placement: { mode: "after", anchorColumnKey: "area" },
    });

    expect(descriptor.actionLabel).toBe("Add property");
    expect(descriptor.summary).toContain("after Area");
    expect(descriptor.summary).toContain("Choice");
    expect(descriptor.optionCount).toBe(3);
    expect(descriptor.details.join(" ")).toContain("starts empty");
    expect(descriptor.details.join(" ")).not.toMatch(
      /operation|version|schema|field key/i,
    );
  });

  it("validates bounded options and keeps local reorder deterministic", () => {
    expect(validatePropertyOptions(["Google"])).toContain("at least two");
    expect(validatePropertyOptions(["Google", " google "])).toContain(
      "different",
    );
    expect(validatePropertyOptions(["Google", ""])).toContain("needs a name");
    expect(
      validatePropertyOptions(
        Array.from({ length: 101 }, (_, index) => "Option " + (index + 1)),
      ),
    ).toContain("up to 100");
    expect(
      reorderPropertyOptions(["Google", "Instagram", "Other"], 1, "up"),
    ).toEqual(["Instagram", "Google", "Other"]);
    expect(
      reorderPropertyOptions(["Google", "Instagram", "Other"], 1, "down"),
    ).toEqual(["Google", "Other", "Instagram"]);
  });

  it("keeps a later placement anchor and proposed property in compact order", () => {
    const wideTable: EditorTable = {
      ...table,
      columns: [
        ...table.columns,
        { key: "notes", label: "Notes", kind: "long_text", width: 180 },
        {
          key: "last_contact",
          label: "Last contact",
          kind: "date",
          width: 150,
        },
        { key: "segment", label: "Segment", kind: "text", width: 150 },
      ],
    };
    const draft = {
      label: "Referral source",
      kind: "select" as const,
      options: ["Google", "Instagram"],
      placement: { mode: "after" as const, anchorColumnKey: "segment" },
    };
    const preview = previewTableWithProperty(wideTable, draft);
    const compact = preview.columns.slice(0, 4);

    const visible = ensureCompactPropertyPreviewColumns(
      preview.columns,
      compact,
      wideTable.primaryColumnKey,
      draft,
    );

    expect(visible.map((column) => column.label)).toEqual([
      "Name",
      "Area",
      "Phone",
      "Notes",
      "Segment",
      "Referral source",
    ]);
    expect(visible.some((column) => column.preview)).toBe(true);
    expect(visible.map((column) => column.key)).toEqual(
      expect.arrayContaining(["segment", "__proposed_property__"]),
    );
    expect(
      visible.findIndex((column) => column.key === "segment"),
    ).toBeLessThan(visible.findIndex((column) => column.preview));
  });
});
