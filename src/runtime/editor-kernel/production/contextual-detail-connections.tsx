"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, type ReactNode } from "react";

import {
  ContextualRecordCreateDialog,
  type ContextualRecordCreateConnection,
} from "../contextual-record-create-dialog";
import type { EditorColumn, EditorRow, EditorValue } from "../contracts";
import type {
  ProductionActionResult,
  ProductionConnectionSearchInput,
  ProductionContextualRecordCreateInput,
  ProductionContextualRecordCreateResult,
  ProductionContextualRecordCreateState,
} from "./action-types";

interface ContextualDetailConnectionsProps {
  sourceViewKey: string;
  parentRow: EditorRow;
  columns: readonly EditorColumn[];
  loadCreateState: (
    viewKey: string,
    input: Pick<
      ProductionContextualRecordCreateInput,
      "parentRecordId" | "columnKey"
    >,
  ) => Promise<ProductionActionResult<ProductionContextualRecordCreateState>>;
  createRecord: (
    viewKey: string,
    input: ProductionContextualRecordCreateInput,
  ) => Promise<ProductionActionResult<ProductionContextualRecordCreateResult>>;
  searchConnectionTargets: (
    viewKey: string,
    input: ProductionConnectionSearchInput,
  ) => Promise<
    ProductionActionResult<readonly { id: string; label: string }[]>
  >;
}

interface ActiveRelatedCreate {
  columnKey: string;
  state: ProductionContextualRecordCreateState;
}

export function ContextualDetailConnections({
  sourceViewKey,
  parentRow,
  columns,
  loadCreateState,
  createRecord,
  searchConnectionTargets,
}: Readonly<ContextualDetailConnectionsProps>): ReactNode {
  const router = useRouter();
  const [active, setActive] = useState<ActiveRelatedCreate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connectionColumns = columns.filter(
    (column) =>
      column.kind === "connection" &&
      column.connection &&
      column.editable !== false,
  );

  const open = useCallback(
    async (columnKey: string): Promise<void> => {
      setError(null);
      const result = await loadCreateState(sourceViewKey, {
        parentRecordId: parentRow.id,
        columnKey,
      });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setActive({ columnKey, state: result.value });
    },
    [loadCreateState, parentRow.id, sourceViewKey],
  );

  const save = useCallback(
    async (
      values: Readonly<Record<string, EditorValue>>,
      connections: readonly ContextualRecordCreateConnection[],
    ): Promise<void> => {
      if (!active) return;
      const result = await createRecord(sourceViewKey, {
        parentRecordId: parentRow.id,
        columnKey: active.columnKey,
        values,
        connections,
      });
      if (result.status === "error") {
        throw new Error(result.message);
      }
      setActive(null);
      router.refresh();
    },
    [active, createRecord, parentRow.id, router, sourceViewKey],
  );

  if (connectionColumns.length === 0) return null;

  return (
    <>
      <div className="runtime-detail-related-create-actions">
        {connectionColumns.map((column) => (
          <button
            className="editor-record-add-related"
            key={column.key}
            onClick={() => void open(column.key)}
            type="button"
          >
            Add {column.connection?.targetObjectLabel ?? column.label}
          </button>
        ))}
      </div>
      {error ? (
        <p className="contextual-record-create-error" role="alert">
          {error}
        </p>
      ) : null}
      {active ? (
        <ContextualRecordCreateDialog
          onClose={() => setActive(null)}
          onSave={save}
          onSearchConnectionTargets={async (columnKey, search) => {
            const result = await searchConnectionTargets(
              active.state.targetViewKey,
              { columnKey, search },
            );
            if (result.status === "error") throw new Error(result.message);
            return result.value;
          }}
          state={active.state}
        />
      ) : null}
    </>
  );
}
