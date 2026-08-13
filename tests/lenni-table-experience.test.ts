import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ConfigurationSnapshotV1 } from "../src/core/configuration/definition-source";
import { composeDirectTableAction } from "../src/core/configuration/direct-tables/composer";
import {
  assessDirectTableTypeCompatibility,
  directTableSettingsForTypeChange,
} from "../src/core/configuration/direct-tables/type-compatibility";
import {
  buildClipboardMatrix,
  clipboardEventBelongsToGrid,
  parseClipboardMatrix,
  selectionBounds,
  serializeClipboardMatrix,
} from "../src/runtime/editor-kernel/clipboard";
import { createMockTableAdapter } from "../src/runtime/editor-kernel/mock-table-adapter";

const objectId = "00000000-0000-4000-8000-000000000001";
const nameId = "00000000-0000-4000-8000-000000000002";
const statusId = "00000000-0000-4000-8000-000000000003";
const viewId = "00000000-0000-4000-8000-000000000004";

const snapshot: ConfigurationSnapshotV1 = {
  schema_version: 1,
  object_definitions: [
    {
      id: objectId,
      key: "contacts",
      singular_label: "Contact",
      plural_label: "Contacts",
      description: "",
      kind: "custom",
      semantic_type: null,
      icon: null,
      is_active: true,
    },
  ],
  field_definitions: [
    {
      id: nameId,
      object_definition_id: objectId,
      object_key: "contacts",
      key: "name",
      label: "Name",
      field_type: "short_text",
      required: true,
      default_value: null,
      settings_json: {},
      position: 0,
      is_active: true,
    },
    {
      id: statusId,
      object_definition_id: objectId,
      object_key: "contacts",
      key: "status",
      label: "Status",
      field_type: "status",
      required: false,
      default_value: null,
      settings_json: { options: ["New", "Active"] },
      position: 1,
      is_active: true,
    },
  ],
  relationship_definitions: [],
  views: [
    {
      id: viewId,
      key: "contacts",
      name: "Contacts",
      view_type: "table",
      object_definition_id: objectId,
      object_key: "contacts",
      config_json: {
        fields: ["name", "status"],
        title_field: "name",
        include_archived: false,
      },
      audience: "internal",
      is_active: true,
    },
  ],
  forms: [],
  pages: [],
  preorder_experiences: [],
  preorder_experience_locations: [],
};

describe("Lenni Table structural and clipboard boundaries", () => {
  it("composes insertion and type changes as bounded configuration operations", () => {
    const inserted = composeDirectTableAction(snapshot, {
      action: "insert_column",
      viewKey: "contacts",
      anchorFieldKey: "status",
      position: "left",
      label: "Phone",
      columnType: "phone",
    });
    expect(inserted.actionKind).toBe("insert_column");
    expect(inserted.operations.map((operation) => operation.op)).toEqual([
      "set_field",
      "set_view",
    ]);
    expect(inserted.operations[1]).toMatchObject({
      op: "set_view",
      config_json: expect.objectContaining({
        fields: ["name", "phone", "status"],
      }),
    });

    const changed = composeDirectTableAction(snapshot, {
      action: "change_column_type",
      viewKey: "contacts",
      fieldKey: "status",
      columnType: "select",
      options: ["New", "Active"],
    });
    expect(changed.actionKind).toBe("change_column_type");
    expect(changed.operations).toHaveLength(1);
    expect(changed.operations[0]).toMatchObject({
      op: "set_field",
      field_type: "select",
      settings_json: { options: ["New", "Active"] },
    });
  });

  it("uses the same safe value rules for compatible and blocked type changes", () => {
    expect(
      assessDirectTableTypeCompatibility({
        from: "short_text",
        to: "email",
        settings: {},
        values: ["ava@example.test", null],
      }),
    ).toMatchObject({ compatible: true, incompatibleCount: 0 });
    expect(
      assessDirectTableTypeCompatibility({
        from: "short_text",
        to: "number",
        settings: {},
        values: ["Tuesday", "4"],
      }),
    ).toMatchObject({ compatible: false, incompatibleCount: 2 });
    expect(
      directTableSettingsForTypeChange("currency", {}, undefined, "GBP"),
    ).toEqual({
      currency: "GBP",
    });
  });

  it("round-trips tabs/newlines and bounds paste before it reaches the adapter", () => {
    expect(parseClipboardMatrix("A\tB\r\nC\tD\n")).toEqual([
      ["A", "B"],
      ["C", "D"],
    ]);
    const table = createMockTableAdapter({ delayMs: 0 }).getTable();
    const matrix = buildClipboardMatrix("Amelia\t4\nBenji\t5", table.columns);
    expect(serializeClipboardMatrix(matrix.matrix)).toBe("Amelia\t4\nBenji\t5");
    expect(
      selectionBounds(
        { rowIndex: 4, columnIndex: 3 },
        { rowIndex: 1, columnIndex: 0 },
      ),
    ).toEqual({
      startRow: 1,
      endRow: 4,
      startColumn: 0,
      endColumn: 3,
    });
    expect(() =>
      buildClipboardMatrix("A\tB\tC\tD\tE\tF\tG", table.columns),
    ).toThrow("Paste cannot add properties");
  });

  it("keeps Add Property text entry outside the Table paste action", () => {
    const addPropertyInput = {
      closest: vi.fn(() => ({ tagName: "FORM" })),
    } as unknown as EventTarget;
    const gridCell = {
      closest: vi.fn(() => null),
    } as unknown as EventTarget;

    expect(clipboardEventBelongsToGrid(addPropertyInput)).toBe(false);
    expect(clipboardEventBelongsToGrid(gridCell)).toBe(true);
    expect(clipboardEventBelongsToGrid(null)).toBe(true);
  });

  it("applies a mock paste as one adapter boundary and reports invalid rows", async () => {
    const adapter = createMockTableAdapter({ delayMs: 0 });
    const table = adapter.getTable();
    const result = await adapter.applyPaste!({
      startRowIndex: 0,
      startColumnIndex: 0,
      matrix: [["Updated Amelia", null, null, 12]],
    });
    expect(result.failures).toEqual([]);
    expect(result.rows[0]?.values.name).toBe("Updated Amelia");
    expect(adapter.getTable().rows[0]?.values.quantity).toBe(12);
    expect(table.rows[0]?.values.name).toBe("Amelia Carter");
  });
});
