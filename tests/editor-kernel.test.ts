import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
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
import {
  AddColumnPopover,
  ConnectionPropertyPopover,
} from "../src/runtime/editor-kernel/editor-lab";
import {
  createEditorColumns,
  openConnectionCellEditor,
} from "../src/runtime/editor-kernel/table-columns";

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
      onRenameColumn: async () => true,
      onUpdateColumnOptions: async () => true,
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

  it("renders a proposed property as empty and keeps structural controls absent for Staff", () => {
    const table = createMockTableAdapter({ delayMs: 0 }).getTable();
    const phone = table.columns.find((column) => column.key === "phone");
    if (!phone) {
      throw new Error("Expected the seeded Phone property.");
    }
    const proposed = {
      ...phone,
      key: "__proposed_property__",
      label: "Referral source",
      kind: "select" as const,
      editable: false,
      preview: true,
      readOnlyReason: "Not added yet",
    };
    const gridColumns = createEditorColumns({
      canChangeColumnTypes: false,
      canInsertColumns: false,
      canRenameColumns: false,
      canReorderColumns: false,
      canResizeColumns: false,
      canUpdateColumnOptions: false,
      columnMenuKey: null,
      columns: [proposed],
      onActivateDraft: () => undefined,
      onOpenColumnMenu: () => undefined,
      onOpenRecord: () => undefined,
      onRenameColumn: async () => true,
      onUpdateColumnOptions: async () => true,
      pendingEdit: null,
    });
    const headerMarkup = renderToStaticMarkup(
      gridColumns[0]!.renderHeaderCell?.({} as never) ?? null,
    );
    expect(headerMarkup).toContain("Referral source");
    expect(headerMarkup).not.toContain("Column menu");
    const cellMarkup = renderToStaticMarkup(
      gridColumns[0]!.renderCell?.({
        column: { idx: 0, key: proposed.key },
        isCellEditable: false,
        onRowChange: () => undefined,
        row: table.rows[0]!,
        rowIdx: 0,
        tabIndex: 0,
      } as unknown as RenderCellProps<EditorRow>),
    );
    expect(cellMarkup).toContain("Empty");
    expect(cellMarkup).toContain("Not added yet");
  });

  it("renders a titled record panel with static property values", () => {
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

    expect(markup.match(/Amelia Carter/g)).toHaveLength(2);
    expect(markup).toContain("editor-record-property-label");
    expect(markup).not.toContain("editor-panel-inline-editor");
    expect(markup).not.toContain("<small");
    expect(markup).not.toMatch(/Save|Cancel/);
  });

  it("keeps generic single and several Connections plain at rest and opens their picker on click", () => {
    const petColumn = {
      key: "pet",
      label: "Pet",
      kind: "connection" as const,
      editable: true,
      width: 180,
      connection: {
        relationshipKey: "phase2_pet_has_appointment",
        direction: "target" as const,
        multiple: false,
        targetObjectKey: "phase2_pet",
      },
    };
    const servicesColumn = {
      key: "services",
      label: "Services",
      kind: "connection" as const,
      editable: true,
      width: 180,
      connection: {
        relationshipKey: "phase2_appointment_uses_service",
        direction: "source" as const,
        multiple: true,
        targetObjectKey: "phase2_service",
      },
    };
    const row: EditorRow = {
      id: "30000000-0000-4000-8000-000000000001",
      values: {
        pet: ["40000000-0000-4000-8000-000000000001"],
        services: ["50000000-0000-4000-8000-000000000001"],
      },
      connectionValues: {
        pet: [
          {
            id: "40000000-0000-4000-8000-000000000001",
            label: "Milo",
          },
        ],
        services: [
          {
            id: "50000000-0000-4000-8000-000000000001",
            label: "Wash",
          },
        ],
      },
    };
    const columns = createEditorColumns({
      columnMenuKey: null,
      columns: [petColumn, servicesColumn],
      onActivateDraft: () => undefined,
      onOpenColumnMenu: () => undefined,
      onOpenRecord: () => undefined,
      onRenameColumn: async () => true,
      onUpdateColumnOptions: async () => true,
      pendingEdit: null,
    });
    const pet = columns[0];
    const services = columns[1];
    if (!pet || !services) {
      throw new Error("Expected the seeded connection columns.");
    }
    const customerCellProps = {
      column: { idx: 0, key: petColumn.key },
      isCellEditable: true,
      onRowChange: () => undefined,
      row,
      rowIdx: 0,
      tabIndex: 0,
    } as unknown as RenderCellProps<EditorRow>;
    const itemsCellProps = {
      ...customerCellProps,
      column: { idx: 1, key: servicesColumn.key },
    } as unknown as RenderCellProps<EditorRow>;

    const petRestingMarkup = renderToStaticMarkup(
      pet.renderCell?.(customerCellProps) ?? null,
    );
    expect(petRestingMarkup).toContain("Milo");
    expect(petRestingMarkup).toContain("editor-table-connection-values");
    expect(petRestingMarkup).not.toContain("editor-connection-picker");
    expect(petRestingMarkup).not.toContain("<button");

    const severalRow: EditorRow = {
      ...row,
      connectionValues: {
        ...row.connectionValues,
        services: [
          ...(row.connectionValues?.services ?? []),
          {
            id: "50000000-0000-4000-8000-000000000002",
            label: "Trim",
          },
          {
            id: "50000000-0000-4000-8000-000000000003",
            label: "Puppy Intro",
          },
        ],
      },
    };
    const severalMarkup = renderToStaticMarkup(
      services.renderCell?.({ ...itemsCellProps, row: severalRow }) ?? null,
    );
    expect(severalMarkup).toContain("Wash");
    expect(severalMarkup).toContain("Trim");
    expect(severalMarkup).toContain("+1");
    expect(severalMarkup).not.toContain(">Puppy Intro<");

    const onRowChange = vi.fn();
    const pickerMarkup = renderToStaticMarkup(
      pet.renderEditCell?.({
        column: { idx: 0, key: petColumn.key },
        onClose: () => undefined,
        onRowChange,
        row,
        rowIdx: 0,
      } as never) ?? null,
    );
    expect(pickerMarkup).toContain("editor-connection-picker");
    expect(pickerMarkup).toContain('aria-expanded="true"');
    expect(pickerMarkup).toContain('role="listbox"');
    expect(onRowChange).not.toHaveBeenCalled();
    expect(pet.editorOptions).toMatchObject({
      commitOnOutsideClick: false,
    });

    const petSelectCell = vi.fn();
    openConnectionCellEditor(petColumn, row, petSelectCell);
    expect(petSelectCell).toHaveBeenCalledWith(true);
    const servicesSelectCell = vi.fn();
    openConnectionCellEditor(servicesColumn, severalRow, servicesSelectCell);
    expect(servicesSelectCell).toHaveBeenCalledWith(true);
  });

  it("keeps arbitrary Status values in a neutral chip", () => {
    const table = createMockTableAdapter({ delayMs: 0 }).getTable();
    const columns = createEditorColumns({
      columnMenuKey: null,
      columns: table.columns,
      onActivateDraft: () => undefined,
      onOpenColumnMenu: () => undefined,
      onOpenRecord: () => undefined,
      onRenameColumn: async () => true,
      onUpdateColumnOptions: async () => true,
      pendingEdit: null,
    });
    const status = columns.find((column) => column.key === "status");
    const row = table.rows[0];
    if (!status || !row) {
      throw new Error("Expected a seeded status Record.");
    }

    const markup = renderToStaticMarkup(
      status.renderCell?.({
        column: {
          idx: table.columns.findIndex((column) => column.key === status.key),
          key: status.key,
        },
        isCellEditable: true,
        onRowChange: () => undefined,
        row,
        rowIdx: 0,
        tabIndex: 0,
      } as never) ?? null,
    );

    expect(markup).toContain("editor-status-pill-neutral");
    expect(markup).not.toContain("editor-status-pill-success");
    expect(markup).not.toContain("editor-status-pill-accent");
    expect(markup).not.toContain("editor-status-pill-muted");
  });

  it("keeps manual Connection setup in owner language and does not submit on open", () => {
    const onCreate = vi.fn(async () => true);
    const markup = renderToStaticMarkup(
      createElement(ConnectionPropertyPopover, {
        onBack: () => undefined,
        onClose: () => undefined,
        onCreate,
        source: { singularLabel: "Appointment", pluralLabel: "Appointments" },
        targets: [
          {
            viewKey: "services",
            label: "Services",
            singularLabel: "Service",
            pluralLabel: "Services",
          },
        ],
      }),
    );

    expect(markup).toContain("Connect to another Table");
    expect(markup).toContain("Table to connect");
    expect(markup).toContain("One");
    expect(markup).toContain("Several");
    expect(markup).toContain("Each Appointment can have:");
    expect(markup).toContain("Each Service can have:");
    expect(markup).toContain("Add connection");
    expect(markup).toContain("nothing is filled automatically");
    expect(markup).toContain("not either Record");
    expect(markup).not.toMatch(
      /Object|Relationship|cardinality|source|target|UUID/i,
    );
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("prefers showing an eligible existing Connection over creating a duplicate", () => {
    const onCreate = vi.fn(async () => true);
    const onAddExisting = vi.fn(async () => true);
    const markup = renderToStaticMarkup(
      createElement(ConnectionPropertyPopover, {
        existingConnections: [
          {
            relationshipKey: "appointment_services",
            direction: "source" as const,
            label: "Services",
            otherTableLabel: "Services",
            targetViewKey: "services",
            currentMultiplicity: "several" as const,
            targetMultiplicity: "several" as const,
          },
        ],
        onAddExisting,
        onBack: () => undefined,
        onClose: () => undefined,
        onCreate,
        source: { singularLabel: "Appointment", pluralLabel: "Appointments" },
        targets: [
          {
            viewKey: "services",
            label: "Services",
            singularLabel: "Service",
            pluralLabel: "Services",
          },
        ],
      }),
    );

    expect(markup).toContain("Already connected");
    expect(markup).toContain("instead of creating a duplicate");
    expect(markup).toContain("Show connection");
    expect(markup).toContain(
      "Existing Records and connected values stay unchanged",
    );
    expect(onCreate).not.toHaveBeenCalled();
    expect(onAddExisting).not.toHaveBeenCalled();
  });

  it("keeps Add Property submission owned by its structural form", () => {
    const addColumn = vi.fn(async () => undefined);
    const markup = renderToStaticMarkup(
      createElement(AddColumnPopover, {
        canAddConnections: false,
        onClose: () => undefined,
        onCreate: addColumn,
      }),
    );

    expect(markup).toContain(
      '<div class="lenni-popover editor-property-editor"',
    );
    expect(markup).toContain('type="button">Add property</button>');
    expect(markup).toContain("What happens");
    expect(markup).not.toMatch(/Review|Apply|requiredness/i);
    expect(addColumn).not.toHaveBeenCalled();
  });

  it("keeps the active property input visible when currentness needs a recheck", () => {
    const table = createMockTableAdapter({ delayMs: 0 }).getTable();
    const markup = renderToStaticMarkup(
      createElement(AddColumnPopover, {
        columns: table.columns,
        draft: {
          label: "Referral source",
          kind: "select",
          options: ["Google", "Instagram"],
          placement: { mode: "after", anchorColumnKey: "phone" },
        },
        externalError:
          "Things changed. Refresh to recheck this property before adding it.",
        onClose: () => undefined,
        onCreate: async () => false,
        onRefresh: () => undefined,
      }),
    );

    expect(markup).toContain('value="Referral source"');
    expect(markup).toContain("Things changed");
    expect(markup).toContain("Refresh and recheck");
  });
});
