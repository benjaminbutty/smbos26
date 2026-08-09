import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RenderCellProps } from "react-data-grid";

import {
  columnKeyFromLabel,
  draftRowIndex,
  displayEditorValue,
  editorValueForColumn,
  editorDraftRowId,
  freshDraftRowIndex,
  hasDraftName,
  reorderColumnKeys,
  type EditorRow,
} from "../src/runtime/editor-kernel/contracts";
import {
  createMockTableAdapter,
  mockFailureTrigger,
} from "../src/runtime/editor-kernel/mock-table-adapter";
import { RecordPanel } from "../src/runtime/editor-kernel/record-panel";
import { createEditorColumns } from "../src/runtime/editor-kernel/table-columns";

describe("editor kernel contracts", () => {
  it("normalizes column names, typed values, and display values", () => {
    expect(columnKeyFromLabel("Next delivery date")).toBe("next_delivery_date");
    expect(columnKeyFromLabel("  Café status  ")).toBe("cafe_status");
    expect(editorValueForColumn({ kind: "number" }, "12.5")).toBe(12.5);
    expect(editorValueForColumn({ kind: "boolean" }, "true")).toBe(true);
    expect(displayEditorValue({ kind: "boolean" }, false)).toBe("No");
    expect(displayEditorValue({ kind: "date" }, "2026-08-09")).toContain("Aug");
  });

  it("moves only the requested column", () => {
    expect(
      reorderColumnKeys(["name", "phone", "status"], "status", "name"),
    ).toEqual(["status", "name", "phone"]);
    expect(
      reorderColumnKeys(["name", "phone", "status"], "missing", "name"),
    ).toEqual(["name", "phone", "status"]);
  });

  it("keeps mock updates in memory and exposes deterministic failure recovery", async () => {
    const adapter = createMockTableAdapter({ delayMs: 0 });
    const initial = adapter.getTable();
    const firstRow = initial.rows[0];
    if (!firstRow) {
      throw new Error("Expected a seeded row.");
    }

    const updated = await adapter.updateCell(firstRow.id, "quantity", "12");
    expect(updated.values.quantity).toBe(12);
    expect(adapter.getTable().rows[0]?.values.quantity).toBe(12);

    await expect(
      adapter.updateCell(firstRow.id, "name", mockFailureTrigger),
    ).rejects.toThrow("Simulated save failure");
    expect(adapter.getTable().rows[0]?.values.name).toBe("Amelia Carter");
    const retried = await adapter.updateCell(
      firstRow.id,
      "name",
      mockFailureTrigger,
    );
    expect(retried.values.name).toBe(mockFailureTrigger);
  });

  it("creates rows and columns without a persistence boundary", async () => {
    const adapter = createMockTableAdapter({ delayMs: 0 });
    const created = await adapter.createRow({ name: "Zoe Brooks" });
    expect(created.values.name).toBe("Zoe Brooks");

    await adapter.createColumn({ label: "Email", kind: "text" });
    const next = adapter.getTable();
    expect(next.columns.at(-1)).toMatchObject({
      key: "email",
      label: "Email",
      kind: "text",
    });
    expect(next.rows.at(-1)?.values.email).toBe("");
  });

  it("keeps the final draft row in the grid and supports consecutive names", async () => {
    expect(draftRowIndex(20)).toBe(20);
    expect(freshDraftRowIndex(20)).toBe(21);
    expect(hasDraftName("   ")).toBe(false);
    expect(hasDraftName("Zoe Brooks")).toBe(true);

    const adapter = createMockTableAdapter({ delayMs: 0 });
    await expect(adapter.createRow({ name: "" })).rejects.toThrow(
      "A record needs a Name.",
    );
    await adapter.createRow({ name: "Zoe Brooks" });
    await adapter.createRow({ name: "Ivy Patel" });
    const rows = adapter.getTable().rows;
    expect(rows).toHaveLength(22);
    expect(rows.at(-2)?.values.name).toBe("Zoe Brooks");
    expect(rows.at(-1)?.values.name).toBe("Ivy Patel");
  });

  it("renders a clickable, input-free draft cell and keeps saved cells control-free", () => {
    const adapter = createMockTableAdapter({ delayMs: 0 });
    const table = adapter.getTable();
    const columns = createEditorColumns({
      columnMenuKey: null,
      columns: table.columns,
      onActivateDraft: () => undefined,
      onOpenColumnMenu: () => undefined,
      onOpenRecord: () => undefined,
      onRenameColumn: async () => undefined,
      pendingEdit: null,
    });
    const primary = columns.find((column) => column.key === "name");
    const phone = columns.find((column) => column.key === "phone");
    if (!primary || !phone) {
      throw new Error("Expected seeded editor columns.");
    }

    const draftRow: EditorRow = {
      id: editorDraftRowId,
      isDraft: true,
      values: { name: "" },
    };
    const draftCell = {
      column: { idx: 0, key: "name" },
      isCellEditable: true,
      onRowChange: () => undefined,
      row: draftRow,
      rowIdx: table.rows.length,
      tabIndex: 0,
    } as unknown as RenderCellProps<EditorRow>;
    const savedCell = {
      ...draftCell,
      column: { idx: 0, key: "name" },
      row: table.rows[0],
      rowIdx: 0,
    } as unknown as RenderCellProps<EditorRow>;

    const draftMarkup = renderToStaticMarkup(
      primary.renderCell?.(draftCell) ?? null,
    );
    const savedMarkup = renderToStaticMarkup(
      primary.renderCell?.(savedCell) ?? null,
    );

    const isEditable = (column: (typeof columns)[number]): boolean =>
      typeof column.editable === "function"
        ? column.editable(draftRow)
        : column.editable === true;
    expect(isEditable(primary)).toBe(true);
    expect(isEditable(phone)).toBe(false);
    expect(draftMarkup).toContain("New record");
    expect(draftMarkup).toContain("new-record-trigger");
    expect(draftMarkup).not.toContain("<input");
    expect(savedMarkup).not.toMatch(/Save|Cancel/);
  });

  it("renders record properties as one static value per row", () => {
    const table = createMockTableAdapter({ delayMs: 0 }).getTable();
    const row = table.rows[0];
    if (!row) {
      throw new Error("Expected a seeded record.");
    }

    const markup = renderToStaticMarkup(
      createElement(RecordPanel, {
        columns: table.columns,
        onClose: () => undefined,
        onCommitCell: () => undefined,
        row,
        tableName: table.name,
      }),
    );

    expect(markup.match(/Amelia Carter/g)).toHaveLength(1);
    expect(markup).toContain("editor-record-property-label");
    expect(markup).not.toContain("editor-panel-inline-editor");
    expect(markup).not.toContain("<small");
    expect(markup).not.toMatch(/Save|Cancel/);
  });
});
