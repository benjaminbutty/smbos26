import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  composeDirectTableAction,
  DirectTableComposerError,
} from "../src/core/configuration/direct-tables/composer";
import type { ConfigurationSnapshotV1 } from "../src/core/configuration/definition-source";
import { parseViewConfig } from "../src/core/experience/schemas";
import type { Tables } from "../src/db/supabase/database.types";
import {
  directTableCellNavigationTarget,
  directTableEditorKeyAction,
} from "../src/runtime/views/direct-table-interactions";
import {
  directTableFullRecordHref,
  directTableRecordPanelHref,
  selectDirectTableRecord,
} from "../src/runtime/views/direct-table-state";

const objectId = "00000000-0000-4000-8000-000000000001";
const nameId = "00000000-0000-4000-8000-000000000002";
const statusId = "00000000-0000-4000-8000-000000000003";
const viewId = "00000000-0000-4000-8000-000000000004";
const archivedId = "00000000-0000-4000-8000-000000000005";

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
    {
      id: archivedId,
      object_definition_id: objectId,
      object_key: "contacts",
      key: "old_status",
      label: "Old status",
      field_type: "short_text",
      required: false,
      default_value: null,
      settings_json: {},
      position: 8,
      is_active: false,
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

describe("direct Table Workspace composer", () => {
  it("keeps direct cell keyboard interaction deterministic", () => {
    expect(directTableEditorKeyAction("Enter")).toBe("commit");
    expect(directTableEditorKeyAction("Tab")).toBe("commit_next");
    expect(directTableEditorKeyAction("Tab", true)).toBe("commit_previous");
    expect(directTableEditorKeyAction("Escape")).toBe("cancel");
    expect(directTableEditorKeyAction("F2")).toBeNull();

    expect(directTableCellNavigationTarget("ArrowDown", 2, 3)).toEqual({
      recordIndex: 3,
      fieldIndex: 3,
    });
    expect(directTableCellNavigationTarget("ArrowLeft", 2, 3)).toEqual({
      recordIndex: 2,
      fieldIndex: 2,
    });
    expect(directTableCellNavigationTarget("ArrowRight", 2, 3)).toEqual({
      recordIndex: 2,
      fieldIndex: 4,
    });
    expect(directTableCellNavigationTarget("ArrowUp", 2, 3)).toEqual({
      recordIndex: 1,
      fieldIndex: 3,
    });
    expect(directTableCellNavigationTarget("Home", 2, 3)).toBeNull();
  });

  it("keeps URL-driven Record panels fail-closed", () => {
    const active = {
      id: "00000000-0000-4000-8000-000000000010",
    } as Tables<"records">;
    const archived = {
      id: "00000000-0000-4000-8000-000000000011",
    } as Tables<"records">;
    const records = [active];

    expect(selectDirectTableRecord(records, active.id)).toBe(active);
    expect(selectDirectTableRecord(records, archived.id)).toBeNull();
    expect(selectDirectTableRecord(records, "missing")).toBeNull();
    expect(selectDirectTableRecord(records, null)).toBeNull();
    expect(
      directTableRecordPanelHref("/app/example/workspace/contacts", active.id),
    ).toBe(`/app/example/workspace/contacts?record=${active.id}`);
    expect(
      directTableFullRecordHref("/app/example/workspace/contacts", active.id),
    ).toBe(`/app/example/workspace/contacts/${active.id}`);
  });

  it("creates only the reusable minimum object, Name field, and Table View", () => {
    const result = composeDirectTableAction(snapshot, {
      action: "create_table",
      title: "Catering Enquiries",
    });

    expect(result.actionKind).toBe("create_table");
    expect(result.operations).toHaveLength(3);
    expect(result.operations.map((operation) => operation.op)).toEqual([
      "set_object",
      "set_field",
      "set_view",
    ]);
    expect(
      result.operations.some((operation) => operation.op === "set_form"),
    ).toBe(false);
    expect(
      result.operations.some((operation) => operation.op === "set_page"),
    ).toBe(false);
    const field = result.operations.find(
      (operation) => operation.op === "set_field",
    );
    expect(field).toMatchObject({
      key: "name",
      label: "Name",
      field_type: "short_text",
      required: true,
    });
  });

  it("composes add, rename, options, reorder, and resize as ordinary configuration operations", () => {
    const added = composeDirectTableAction(snapshot, {
      action: "add_column",
      viewKey: "contacts",
      label: "Email address",
      columnType: "email",
    });
    expect(added.operations.map((operation) => operation.op)).toEqual([
      "set_field",
      "set_view",
    ]);
    expect(
      added.operations.find((operation) => operation.op === "set_view"),
    ).toMatchObject({
      config_json: expect.objectContaining({
        fields: ["name", "status", "email_address"],
      }),
    });
    expect(
      added.operations.find((operation) => operation.op === "set_field"),
    ).toMatchObject({ position: 9 });

    const renamed = composeDirectTableAction(snapshot, {
      action: "rename_column",
      viewKey: "contacts",
      fieldKey: "status",
      label: "Stage",
    });
    expect(renamed.operations.map((operation) => operation.op)).toEqual([
      "set_field",
    ]);
    expect(renamed.operations[0]).toMatchObject({
      op: "set_field",
      label: "Stage",
    });

    const renamedTable = composeDirectTableAction(snapshot, {
      action: "rename_table",
      viewKey: "contacts",
      title: "Client",
    });
    expect(renamedTable.operations.map((operation) => operation.op)).toEqual([
      "set_object",
      "set_view",
    ]);
    expect(renamedTable.operations[0]).toMatchObject({
      op: "set_object",
      singular_label: "Client",
      plural_label: "Client",
    });

    const options = composeDirectTableAction(snapshot, {
      action: "update_column_options",
      viewKey: "contacts",
      fieldKey: "status",
      options: ["New", "Booked", "Closed"],
    });
    expect(options.operations[0]).toMatchObject({
      op: "set_field",
      settings_json: { options: ["New", "Booked", "Closed"] },
    });

    const reordered = composeDirectTableAction(snapshot, {
      action: "reorder_columns",
      viewKey: "contacts",
      fieldKeys: ["status", "name"],
    });
    expect(reordered.operations[0]).toMatchObject({
      op: "set_view",
      config_json: expect.objectContaining({ fields: ["status", "name"] }),
    });

    const resized = composeDirectTableAction(snapshot, {
      action: "resize_column",
      viewKey: "contacts",
      fieldKey: "status",
      width: 320,
    });
    expect(resized.operations[0]).toMatchObject({
      op: "set_view",
      config_json: expect.objectContaining({ column_widths: { status: 320 } }),
    });
  });

  it("rejects duplicate labels, invalid options, and non-visible width keys", () => {
    expect(() =>
      composeDirectTableAction(snapshot, {
        action: "add_column",
        viewKey: "contacts",
        label: "name",
        columnType: "short_text",
      }),
    ).toThrowError(DirectTableComposerError);

    expect(() =>
      composeDirectTableAction(snapshot, {
        action: "update_column_options",
        viewKey: "contacts",
        fieldKey: "name",
        options: ["Only one"],
      }),
    ).toThrowError(DirectTableComposerError);

    expect(() =>
      parseViewConfig("table", {
        fields: ["name"],
        column_widths: { status: 240 },
        include_archived: false,
      }),
    ).toThrow();
  });

  it("keeps legacy widthless Tables valid and bounds width metadata", () => {
    expect(
      parseViewConfig("table", {
        fields: ["name"],
        include_archived: false,
      }),
    ).toMatchObject({ fields: ["name"] });
    expect(
      parseViewConfig("table", {
        fields: ["name"],
        column_widths: { name: 128 },
        include_archived: false,
      }),
    ).toMatchObject({ column_widths: { name: 128 } });
    expect(() =>
      parseViewConfig("table", {
        fields: ["name"],
        column_widths: { name: 127 },
        include_archived: false,
      }),
    ).toThrow();
    expect(() =>
      parseViewConfig("table", {
        fields: ["name"],
        column_widths: { name: 641 },
        include_archived: false,
      }),
    ).toThrow();
  });
});
