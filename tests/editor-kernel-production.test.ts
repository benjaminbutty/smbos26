import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ExperienceViewBundle } from "../src/core/experience/service";
import type { TableViewConfig } from "../src/core/experience/schemas";
import type { Tables } from "../src/db/supabase/database.types";
import type { EditorTable } from "../src/runtime/editor-kernel/contracts";
import type { ProductionTableStructureState } from "../src/runtime/editor-kernel/production/action-types";
import { createEditorColumns } from "../src/runtime/editor-kernel/table-columns";
import {
  createProductionTableAdapter,
  ProductionTableAdapter,
} from "../src/runtime/editor-kernel/production/production-table-adapter";
import {
  mapExperienceViewBundleToEditorTable,
  mapProductionRecordToEditorRow,
} from "../src/runtime/editor-kernel/production/table-mapper";

const businessId = "10000000-0000-4000-8000-000000000001";
const objectId = "20000000-0000-4000-8000-000000000001";
const now = "2026-08-09T12:00:00.000Z";

function field(
  key: string,
  label: string,
  fieldType: Tables<"field_definitions">["field_type"],
  position: number,
  options: Partial<Tables<"field_definitions">> = {},
): Tables<"field_definitions"> {
  return {
    id: crypto.randomUUID(),
    business_id: businessId,
    object_definition_id: objectId,
    key,
    label,
    field_type: fieldType,
    required: false,
    default_value: null,
    settings_json: {},
    position,
    is_active: true,
    created_at: now,
    updated_at: now,
    ...options,
  };
}

function record(
  id: string,
  data: Record<string, unknown>,
  recordStatus: Tables<"records">["record_status"] = "active",
): Tables<"records"> {
  return {
    id,
    business_id: businessId,
    object_definition_id: objectId,
    data_json: data,
    record_status: recordStatus,
    created_by: null,
    created_at: now,
    updated_at: now,
  } as Tables<"records">;
}

function relationship(
  key: string,
  sourceObjectDefinitionId: string,
  targetObjectDefinitionId: string,
  cardinality: Tables<"relationship_definitions">["cardinality"],
): Tables<"relationship_definitions"> {
  return {
    id: crypto.randomUUID(),
    business_id: businessId,
    key,
    source_object_definition_id: sourceObjectDefinitionId,
    target_object_definition_id: targetObjectDefinitionId,
    source_label: "Source",
    target_label: "Target",
    cardinality,
    is_required: false,
    is_active: true,
    created_at: now,
    updated_at: now,
  };
}

function bundle(
  fields: Tables<"field_definitions">[],
  config: TableViewConfig,
  records: Tables<"records">[],
  relationships: Tables<"relationship_definitions">[] = [],
): ExperienceViewBundle {
  return {
    definition: {
      id: crypto.randomUUID(),
      business_id: businessId,
      key: "enquiries",
      name: "Enquiries",
      view_type: "table",
      object_definition_id: objectId,
      config_json: config,
      audience: "internal",
      is_active: true,
      created_at: now,
      updated_at: now,
    },
    object: {
      id: objectId,
      business_id: businessId,
      key: "enquiry",
      singular_label: "Enquiry",
      plural_label: "Enquiries",
      description: "",
      kind: "custom",
      semantic_type: null,
      icon: null,
      is_active: true,
      created_at: now,
      updated_at: now,
    },
    fields,
    records,
    relationships,
    config,
  };
}

const fields = [
  field("name", "Name", "short_text", 0, { required: true }),
  field("notes", "Notes", "long_text", 1),
  field("price", "Budget", "currency", 2, {
    settings_json: { currency: "USD" },
  }),
  field("email", "Email", "email", 3),
  field("event_date", "Event date", "date", 4),
  field("category", "Category", "select", 5, {
    settings_json: { options: ["Wedding", "Corporate"] },
  }),
  field("status", "Status", "status", 6, {
    settings_json: { options: ["New", "Booked"] },
  }),
  field("starts_at", "Starts at", "datetime", 7),
  field("tags", "Tags", "multi_select", 8, {
    settings_json: { options: ["Urgent", "VIP"] },
  }),
  field("attachment", "Attachment", "file", 9),
];

const config: TableViewConfig = {
  fields: ["name", "price", "status", "attachment"],
  title_field: "name",
  column_widths: { name: 240, price: 190 },
  include_archived: false,
};

const unavailableStructure = async () => ({
  status: "error" as const,
  message: "unavailable",
});

describe("production editor Table mapping", () => {
  it("preserves live order, metadata, nulls, and read-only unsupported properties", () => {
    const active = record("30000000-0000-4000-8000-000000000001", {
      name: "Ava Bakery",
      notes: null,
      price: 1250,
      email: "ava@example.test",
      event_date: "2026-09-10",
      category: "Corporate",
      status: "Booked",
      starts_at: "2026-09-10T09:30:00Z",
      tags: ["VIP"],
      attachment: { name: "brief.pdf", url: "https://example.test/brief.pdf" },
    });
    const archived = record(
      "30000000-0000-4000-8000-000000000002",
      { name: "Archived" },
      "archived",
    );
    const mapped = mapExperienceViewBundleToEditorTable({
      bundle: bundle(fields, config, [active, archived]),
    });

    expect(mapped.table.columns.map((column) => column.key)).toEqual([
      "name",
      "price",
      "status",
      "attachment",
    ]);
    expect(mapped.table.primaryColumnKey).toBe("name");
    expect(mapped.table.columns[1]).toMatchObject({
      key: "price",
      kind: "currency",
      currency: "USD",
      width: 190,
      editable: true,
    });
    expect(mapped.table.columns[2]).toMatchObject({
      key: "status",
      kind: "status",
      options: ["New", "Booked"],
    });
    expect(mapped.table.columns[3]).toMatchObject({
      key: "attachment",
      kind: "file",
      editable: false,
    });
    expect(mapped.table.recordColumns?.map((column) => column.key)).toEqual(
      fields.map((candidate) => candidate.key),
    );
    expect(mapped.table.rows).toHaveLength(1);
    expect(mapped.table.rows[0]?.values).toMatchObject({
      name: "Ava Bakery",
      notes: null,
      price: 1250,
      tags: ["VIP"],
    });
    expect(mapped.table.rows[0]?.values.attachment).toMatchObject({
      name: "brief.pdf",
    });
  });

  it("uses metadata-derived editability for formless Tables and the edit Form whitelist when present", () => {
    const formless = mapExperienceViewBundleToEditorTable({
      bundle: bundle(fields, config, []),
    }).table;
    expect(
      formless.recordColumns?.find((column) => column.key === "email"),
    ).toMatchObject({ editable: true, kind: "email" });
    expect(
      formless.recordColumns?.find((column) => column.key === "starts_at"),
    ).toMatchObject({ editable: false, kind: "datetime" });

    const formBacked = mapExperienceViewBundleToEditorTable({
      bundle: bundle(fields, config, []),
      editFormFieldKeys: ["name", "notes", "email"],
    }).table;
    expect(
      formBacked.recordColumns?.find((column) => column.key === "notes"),
    ).toMatchObject({ editable: true });
    expect(
      formBacked.recordColumns?.find((column) => column.key === "price"),
    ).toMatchObject({ editable: false });
    expect(
      formBacked.recordColumns?.find((column) => column.key === "attachment"),
    ).toMatchObject({ editable: false });
  });

  it("maps generic Connection identity, direction, and cardinality for the editor", () => {
    const petObjectId = "20000000-0000-4000-8000-000000000002";
    const serviceObjectId = "20000000-0000-4000-8000-000000000003";
    const connectionConfig: TableViewConfig = {
      schema_version: 2,
      role: "primary",
      columns: [
        { kind: "field", field_key: "name" },
        {
          kind: "connection",
          relationship_key: "phase2_pet_has_appointment",
          direction: "target",
          label: "Pet",
        },
        {
          kind: "connection",
          relationship_key: "phase2_appointment_uses_service",
          direction: "source",
          label: "Services",
        },
      ],
      fields: ["name"],
      title_field: "name",
      include_archived: false,
      filters: [],
      filter_match: "all",
      sorts: [],
      group: null,
    };
    const mapped = mapExperienceViewBundleToEditorTable({
      bundle: bundle(
        fields,
        connectionConfig,
        [record("30000000-0000-4000-0000-000000000001", { name: "Order" })],
        [
          relationship(
            "phase2_pet_has_appointment",
            petObjectId,
            objectId,
            "one_to_many",
          ),
          relationship(
            "phase2_appointment_uses_service",
            objectId,
            serviceObjectId,
            "many_to_many",
          ),
        ],
      ),
    }).table;
    const pet = mapped.columns.find((column) => column.label === "Pet");
    const services = mapped.columns.find(
      (column) => column.label === "Services",
    );

    expect(pet).toMatchObject({
      key: "connection:phase2_pet_has_appointment:target",
      kind: "connection",
      editable: true,
      connection: {
        relationshipKey: "phase2_pet_has_appointment",
        direction: "target",
        multiple: false,
        targetObjectKey: petObjectId,
      },
    });
    expect(services).toMatchObject({
      key: "connection:phase2_appointment_uses_service:source",
      kind: "connection",
      editable: true,
      connection: {
        relationshipKey: "phase2_appointment_uses_service",
        direction: "source",
        multiple: true,
        targetObjectKey: serviceObjectId,
      },
    });

    const protectedMapped = mapExperienceViewBundleToEditorTable({
      bundle: {
        ...bundle(
          fields,
          connectionConfig,
          [record("30000000-0000-4000-0000-000000000002", { name: "Order" })],
          [
            relationship(
              "phase2_pet_has_appointment",
              petObjectId,
              objectId,
              "one_to_many",
            ),
            relationship(
              "phase2_appointment_uses_service",
              objectId,
              serviceObjectId,
              "many_to_many",
            ),
          ],
        ),
        protectedConnectionRelationshipKeys: [
          "phase2_pet_has_appointment",
          "phase2_appointment_uses_service",
        ],
      },
    }).table;
    expect(
      protectedMapped.columns.filter((column) => column.kind === "connection"),
    ).toMatchObject([
      {
        editable: false,
        readOnlyReason:
          "This Connection is managed by the configured workflow.",
      },
      {
        editable: false,
        readOnlyReason:
          "This Connection is managed by the configured workflow.",
      },
    ]);
  });
});

describe("production editor adapter", () => {
  it("forwards typed actions, stores authoritative rows, and preserves panel reads", async () => {
    const initial = mapExperienceViewBundleToEditorTable({
      bundle: bundle(fields, config, [
        record("30000000-0000-4000-8000-000000000003", {
          name: "Before",
          price: 10,
        }),
      ]),
    }).table;
    const actions = {
      updateCell: vi.fn(async (input) => ({
        status: "success" as const,
        value: mapProductionRecordToEditorRow(
          initial,
          record(input.recordId, {
            name: "After",
            price: 20,
          }),
        ),
      })),
      createRow: vi.fn(async () => ({
        status: "success" as const,
        value: mapProductionRecordToEditorRow(
          initial,
          record("30000000-0000-4000-8000-000000000004", { name: "Created" }),
        ),
      })),
      openRecord: vi.fn(async () => ({
        status: "success" as const,
        value: initial.rows[0] ?? null,
      })),
      addColumn: unavailableStructure,
      renameColumn: unavailableStructure,
      updateColumnOptions: unavailableStructure,
      reorderColumns: unavailableStructure,
      renameTable: unavailableStructure,
    };
    const adapter = createProductionTableAdapter(initial, actions);

    const updated = await adapter.updateCell(
      "30000000-0000-4000-8000-000000000003",
      "price",
      20,
    );
    expect(actions.updateCell).toHaveBeenCalledWith({
      recordId: "30000000-0000-4000-8000-000000000003",
      fieldKey: "price",
      value: 20,
    });
    expect(updated.values.name).toBe("After");
    expect(adapter.getTable().rows[0]?.values.price).toBe(20);

    const created = await adapter.createRow({ name: "Created" });
    expect(created.values.name).toBe("Created");
    expect(adapter.getTable().rows).toHaveLength(2);

    await adapter.openRecord("30000000-0000-4000-8000-000000000003");
    expect(actions.openRecord).toHaveBeenCalledWith({
      recordId: "30000000-0000-4000-8000-000000000003",
    });
    await expect(
      adapter.createColumn({ label: "Nope", kind: "text" }),
    ).rejects.toThrow("unavailable");
  });

  it("maps action failures to rejected adapter operations", async () => {
    const table: EditorTable = {
      key: "items",
      name: "Items",
      primaryColumnKey: "name",
      columns: [
        { key: "name", label: "Name", kind: "text", primary: true, width: 200 },
      ],
      rows: [{ id: "record", values: { name: "Before" } }],
    };
    const adapter = new ProductionTableAdapter(table, {
      updateCell: async () => ({ status: "error", message: "Invalid value." }),
      createRow: async () => ({ status: "error", message: "Cannot create." }),
      openRecord: async () => ({ status: "success", value: null }),
      addColumn: unavailableStructure,
      renameColumn: unavailableStructure,
      updateColumnOptions: unavailableStructure,
      reorderColumns: unavailableStructure,
      renameTable: unavailableStructure,
    });

    await expect(adapter.updateCell("record", "name", "bad")).rejects.toThrow(
      "Invalid value.",
    );
    await expect(adapter.createRow({ name: "New" })).rejects.toThrow(
      "Cannot create.",
    );
  });

  it("forwards Connection searches and replacements with relationship identity and direction", async () => {
    const petColumn = {
      key: "connection:phase2_pet_has_appointment:target",
      label: "Pet",
      kind: "connection" as const,
      editable: true,
      connection: {
        relationshipKey: "phase2_pet_has_appointment",
        direction: "target" as const,
        multiple: false,
        targetObjectKey: "phase2_pet",
      },
      width: 220,
    };
    const servicesColumn = {
      key: "connection:phase2_appointment_uses_service:source",
      label: "Services",
      kind: "connection" as const,
      editable: true,
      connection: {
        relationshipKey: "phase2_appointment_uses_service",
        direction: "source" as const,
        multiple: true,
        targetObjectKey: "phase2_service",
      },
      width: 220,
    };
    const table: EditorTable = {
      key: "orders",
      name: "Orders",
      primaryColumnKey: petColumn.key,
      columns: [petColumn, servicesColumn],
      rows: [
        {
          id: "record",
          values: {
            [petColumn.key]: ["pet-one"],
            [servicesColumn.key]: ["service-one", "service-two"],
          },
        },
      ],
    };
    const searchConnectionTargets = vi.fn(async () => ({
      status: "success" as const,
      value: [{ id: "pet-two", label: "Luna" }],
    }));
    const updateConnection = vi.fn(async (input) => ({
      status: "success" as const,
      value: {
        id: input.recordId,
        values: {
          [petColumn.key]: input.targetRecordIds,
          [servicesColumn.key]: ["service-one", "service-two"],
        },
      },
    }));
    const adapter = new ProductionTableAdapter(table, {
      updateCell: unavailableStructure,
      updateConnection,
      searchConnectionTargets,
      createRow: async () => ({
        status: "error" as const,
        message: "unavailable",
      }),
      openRecord: async () => ({ status: "success" as const, value: null }),
      addColumn: unavailableStructure,
      renameColumn: unavailableStructure,
      updateColumnOptions: unavailableStructure,
      reorderColumns: unavailableStructure,
      renameTable: unavailableStructure,
    });

    await expect(
      adapter.searchConnectionTargets(petColumn.key, "Milo"),
    ).resolves.toEqual([{ id: "pet-two", label: "Luna" }]);
    expect(searchConnectionTargets).toHaveBeenCalledWith({
      columnKey: petColumn.key,
      search: "Milo",
    });

    await adapter.updateCell("record", petColumn.key, ["pet-two"]);
    expect(updateConnection).toHaveBeenCalledWith({
      recordId: "record",
      relationshipKey: "phase2_pet_has_appointment",
      direction: "target",
      targetRecordIds: ["pet-two"],
    });
  });

  it("does not send a mutation for a workflow-managed Connection", async () => {
    const column = {
      key: "connection:phase2_pet_has_appointment:target",
      label: "Pet",
      kind: "connection" as const,
      editable: false,
      connection: {
        relationshipKey: "phase2_pet_has_appointment",
        direction: "target" as const,
        multiple: false,
        targetObjectKey: "phase2_pet",
      },
      width: 220,
    };
    const updateConnection = vi.fn();
    const adapter = new ProductionTableAdapter(
      {
        key: "orders",
        name: "Orders",
        primaryColumnKey: column.key,
        columns: [column],
        rows: [{ id: "record", values: { [column.key]: ["customer-one"] } }],
      },
      {
        updateCell: unavailableStructure,
        updateConnection,
        createRow: async () => ({
          status: "error" as const,
          message: "unavailable",
        }),
        openRecord: async () => ({ status: "success" as const, value: null }),
        addColumn: unavailableStructure,
        renameColumn: unavailableStructure,
        updateColumnOptions: unavailableStructure,
        reorderColumns: unavailableStructure,
        renameTable: unavailableStructure,
      },
    );

    await expect(
      adapter.updateCell("record", column.key, ["pet-two"]),
    ).rejects.toThrow("workflow");
    expect(updateConnection).not.toHaveBeenCalled();
  });

  it("routes structural changes through typed currentness and keeps resize local", async () => {
    const table: EditorTable = {
      key: "items",
      name: "Items",
      primaryColumnKey: "name",
      columns: [
        { key: "name", label: "Name", kind: "text", primary: true, width: 200 },
        {
          key: "status",
          label: "Status",
          kind: "status",
          options: ["New", "Booked"],
          width: 160,
        },
      ],
      rows: [{ id: "record", values: { name: "Before", status: "New" } }],
    };
    const initialCurrentness = {
      expectedBaseVersionId: "40000000-0000-4000-8000-000000000001",
      expectedHeadRevision: 1,
    };
    let authoritativeTable = table;
    let authoritativeCurrentness = initialCurrentness;
    const structureResult = (
      nextTable: EditorTable,
    ): { status: "success"; value: ProductionTableStructureState } => {
      authoritativeTable = nextTable;
      authoritativeCurrentness = {
        expectedBaseVersionId: crypto.randomUUID(),
        expectedHeadRevision: authoritativeCurrentness.expectedHeadRevision + 1,
      };
      return {
        status: "success",
        value: {
          table: authoritativeTable,
          currentness: authoritativeCurrentness,
        },
      };
    };
    const actions = {
      updateCell: unavailableStructure,
      createRow: unavailableStructure,
      openRecord: unavailableStructure,
      addColumn: vi.fn(async (input) => {
        expect(input).toMatchObject({
          currentness: initialCurrentness,
          label: "Phone",
          columnType: "phone",
        });
        return structureResult({
          ...authoritativeTable,
          columns: [
            ...authoritativeTable.columns,
            { key: "phone", label: "Phone", kind: "phone", width: 170 },
          ],
        });
      }),
      renameColumn: vi.fn(async (input) => {
        expect(input.fieldKey).toBe("name");
        expect(input.label).toBe("Customer name");
        expect(input.currentness).toEqual(authoritativeCurrentness);
        return structureResult({
          ...authoritativeTable,
          columns: authoritativeTable.columns.map((column) =>
            column.key === "name" ? { ...column, label: input.label } : column,
          ),
        });
      }),
      updateColumnOptions: vi.fn(async (input) => {
        expect(input.fieldKey).toBe("status");
        expect(input.options).toEqual(["New", "Booked", "Closed"]);
        expect(input.currentness).toEqual(authoritativeCurrentness);
        return structureResult({
          ...authoritativeTable,
          columns: authoritativeTable.columns.map((column) =>
            column.key === "status"
              ? { ...column, options: input.options }
              : column,
          ),
        });
      }),
      reorderColumns: vi.fn(async (input) => {
        expect(input.fieldKeys).toEqual(["status", "phone", "name"]);
        expect(input.currentness).toEqual(authoritativeCurrentness);
        const byKey = new Map(
          authoritativeTable.columns.map((column) => [column.key, column]),
        );
        return structureResult({
          ...authoritativeTable,
          columns: input.fieldKeys.flatMap((key: string) => {
            const column = byKey.get(key);
            return column ? [column] : [];
          }),
        });
      }),
      renameTable: vi.fn(async (input) => {
        expect(input.title).toBe("Customer enquiries");
        expect(input.currentness).toEqual(authoritativeCurrentness);
        return structureResult({
          ...authoritativeTable,
          name: input.title,
        });
      }),
    };
    const adapter = new ProductionTableAdapter(
      table,
      actions,
      initialCurrentness,
    );

    await adapter.resizeColumn("name", 700);
    expect(adapter.getTable().columns[0]?.width).toBe(640);
    expect(actions.addColumn).not.toHaveBeenCalled();

    await adapter.createColumn({ label: "Phone", kind: "phone" });
    const afterAdd = { ...authoritativeCurrentness };
    expect(adapter.getTable().columns.map((column) => column.key)).toEqual([
      "name",
      "status",
      "phone",
    ]);
    expect(adapter.getTable().columns[0]?.width).toBe(640);

    await adapter.renameColumn("name", "Customer name");
    const afterRename = { ...authoritativeCurrentness };
    expect(actions.renameColumn.mock.calls[0]?.[0].currentness).toEqual(
      afterAdd,
    );

    await adapter.updateColumnOptions("status", ["New", "Booked", "Closed"]);
    const afterOptions = { ...authoritativeCurrentness };
    expect(actions.updateColumnOptions.mock.calls[0]?.[0].currentness).toEqual(
      afterRename,
    );

    await adapter.reorderColumns(["status", "phone", "name"]);
    const afterReorder = { ...authoritativeCurrentness };
    expect(actions.reorderColumns.mock.calls[0]?.[0].currentness).toEqual(
      afterOptions,
    );

    await adapter.renameTable("Customer enquiries");
    expect(actions.renameTable.mock.calls[0]?.[0].currentness).toEqual(
      afterReorder,
    );
    expect(adapter.getTable().name).toBe("Customer enquiries");
  });
});

describe("production editor structural containment", () => {
  it("does not render structural controls when capabilities disable them", () => {
    const table: EditorTable = {
      key: "items",
      name: "Items",
      primaryColumnKey: "name",
      columns: [
        { key: "name", label: "Name", kind: "text", primary: true, width: 200 },
      ],
      rows: [],
    };
    const column = createEditorColumns({
      canRenameColumns: false,
      canReorderColumns: false,
      canResizeColumns: false,
      columnMenuKey: null,
      columns: table.columns,
      onActivateDraft: () => undefined,
      onOpenColumnMenu: () => undefined,
      onOpenRecord: () => undefined,
      onRenameColumn: async () => true,
      onUpdateColumnOptions: async () => true,
      pendingEdit: null,
    })[0];
    expect(column?.resizable).toBe(false);
    expect(column?.draggable).toBe(false);
  });
});
