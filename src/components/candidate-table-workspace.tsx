"use client";

import { useMemo, type ReactNode } from "react";

import type {
  EditorCapabilities,
  EditorTable,
} from "../runtime/editor-kernel/contracts";
import type {
  ProductionActionResult,
  ProductionRecordReadAction,
  ProductionTableStructureState,
} from "../runtime/editor-kernel/production/action-types";
import { ProductionTableWorkspace } from "../runtime/editor-kernel/production/production-table-workspace";
import type { ProductionTableAdapterActions } from "../runtime/editor-kernel/production/production-table-adapter";

const readOnlyMessage = "This preview is read-only. Nothing will be changed.";

function rejected<T>(): ProductionActionResult<T> {
  return { status: "error", message: readOnlyMessage };
}

const capabilities: EditorCapabilities = {
  rowCreation: "unavailable",
  rowCreationMessage:
    "Example Records are shown here. Nothing can be created in preview.",
  canAddColumns: false,
  canAddConnections: false,
  canInsertColumns: false,
  canRenameColumns: false,
  canChangeColumnTypes: false,
  canUpdateColumnOptions: false,
  canReorderColumns: false,
  canResizeColumns: false,
  canRenameTable: false,
};

export function CandidateTableWorkspace({
  recordTypeLabel,
  table,
}: Readonly<{ recordTypeLabel: string; table: EditorTable }>): ReactNode {
  const actions = useMemo<ProductionTableAdapterActions>(() => {
    const openRecord: ProductionRecordReadAction = async ({ recordId }) => ({
      status: "success",
      value: table.rows.find((row) => row.id === recordId) ?? null,
    });
    const structure = async (): Promise<
      ProductionActionResult<ProductionTableStructureState>
    > => rejected();
    return {
      updateCell: async () => rejected(),
      updateConnection: async () => rejected(),
      searchConnectionTargets: async () => rejected(),
      createConnectionTarget: async () => rejected(),
      createRow: async () => rejected(),
      openRecord,
      addColumn: structure,
      insertColumn: structure,
      renameColumn: structure,
      changeColumnType: structure,
      updateColumnOptions: structure,
      reorderColumns: structure,
      renameTable: structure,
      paste: async () => rejected(),
    };
  }, [table]);

  return (
    <ProductionTableWorkspace
      actions={actions}
      capabilities={capabilities}
      panelStatusLabel="Read-only preview"
      readOnly
      recordCountLabel={`${table.rows.length} example Records`}
      recordTypeLabel={recordTypeLabel}
      surface="embedded"
      table={table}
    />
  );
}
