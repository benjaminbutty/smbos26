"use client";

import { useRouter } from "next/navigation";
import { useMemo, type ReactNode } from "react";

import type {
  ConnectionTableOption,
  CreateConnectionPropertyInput,
  EditorCapabilities,
  EditorTable,
} from "../contracts";
import { EditorKernel } from "../editor-kernel";
import type { EditorColumn, EditorRow, EditorValue } from "../contracts";
import type {
  ProductionActionResult,
  ProductionCellEditInput,
  ProductionConnectionCreateInput,
  ProductionConnectionEditInput,
  ProductionConfigurationCurrentness,
  ProductionRecordPanelContextAction,
  ProductionScopedCellEditAction,
  ProductionScopedConnectionCreateAction,
  ProductionScopedConnectionEditAction,
  ProductionScopedConnectionSearchAction,
} from "./action-types";
import {
  createProductionTableAdapter,
  type ProductionTableAdapterActions,
} from "./production-table-adapter";

export interface ProductionTableWorkspaceProps {
  table: EditorTable;
  capabilities: EditorCapabilities;
  actions: ProductionTableAdapterActions;
  businessSlug?: string;
  headerContent?: ReactNode;
  currentness?: ProductionConfigurationCurrentness | undefined;
  creationFallbackHref?: string | undefined;
  newRecordLabel?: string;
  recordTypeLabel?: string;
  recordCountLabel?: string;
  panelStatusLabel?: string;
  fullRecordPath?: string;
  readConnectedRecord?: ProductionRecordPanelContextAction;
  updateConnectedRecordCell?: ProductionScopedCellEditAction;
  updateConnectedRecordConnection?: ProductionScopedConnectionEditAction;
  searchConnectedRecordTargets?: ProductionScopedConnectionSearchAction;
  createConnectedRecordTarget?: ProductionScopedConnectionCreateAction;
  connectionSource?: Pick<
    ConnectionTableOption,
    "singularLabel" | "pluralLabel"
  >;
  connectionTargets?: readonly ConnectionTableOption[];
  readOnly?: boolean;
  surface?: "workspace" | "embedded";
}

export function ProductionTableWorkspace({
  actions,
  businessSlug,
  capabilities,
  creationFallbackHref,
  currentness,
  headerContent,
  newRecordLabel,
  panelStatusLabel,
  recordTypeLabel,
  readOnly = false,
  recordCountLabel,
  fullRecordPath,
  readConnectedRecord,
  updateConnectedRecordCell,
  updateConnectedRecordConnection,
  searchConnectedRecordTargets,
  createConnectedRecordTarget,
  connectionSource,
  connectionTargets,
  surface = "workspace",
  table,
}: Readonly<ProductionTableWorkspaceProps>): ReactNode {
  const router = useRouter();
  const adapter = useMemo(
    () => createProductionTableAdapter(table, actions, currentness),
    [actions, currentness, table],
  );

  const createConnection = useMemo(
    () =>
      actions.createConnection && currentness
        ? async (input: CreateConnectionPropertyInput): Promise<boolean> => {
            const result = await actions.createConnection!({
              ...input,
              currentness,
            });
            if (result.status === "error") {
              throw new Error(result.message);
            }
            return true;
          }
        : undefined,
    [actions.createConnection, currentness],
  );

  const readConnectedRecordContext = useMemo(
    () =>
      readConnectedRecord && businessSlug
        ? async (targetViewKey: string, recordId: string) => {
            const result = await readConnectedRecord(targetViewKey, {
              recordId,
            });
            if (result.status === "error") {
              throw new Error(result.message);
            }
            if (!result.value) {
              return null;
            }
            return {
              ...result.value,
              viewKey: targetViewKey,
            };
          }
        : undefined,
    [businessSlug, readConnectedRecord],
  );

  const updateConnectedRecord = useMemo(
    () =>
      businessSlug &&
      updateConnectedRecordCell &&
      updateConnectedRecordConnection
        ? async (
            context: {
              row: { id: string };
              viewKey: string;
            },
            column: EditorColumn,
            value: EditorValue,
          ): Promise<EditorRow> => {
            let result: ProductionActionResult<EditorRow>;
            if (column.kind === "connection" && column.connection) {
              const input: ProductionConnectionEditInput = {
                direction: column.connection.direction,
                recordId: context.row.id,
                relationshipKey: column.connection.relationshipKey,
                targetRecordIds: Array.isArray(value) ? [...value] : [],
              };
              result = await updateConnectedRecordConnection(
                context.viewKey,
                input,
              );
            } else {
              const input: ProductionCellEditInput = {
                fieldKey: column.key,
                recordId: context.row.id,
                value,
              };
              result = await updateConnectedRecordCell(context.viewKey, input);
            }
            if (result.status === "error") {
              throw new Error(result.message);
            }
            return result.value;
          }
        : undefined,
    [businessSlug, updateConnectedRecordCell, updateConnectedRecordConnection],
  );

  const searchConnectedRecord = useMemo(
    () =>
      businessSlug && searchConnectedRecordTargets
        ? async (
            context: { viewKey: string },
            columnKey: string,
            search: string,
          ) => {
            const result = await searchConnectedRecordTargets(context.viewKey, {
              columnKey,
              search,
            });
            if (result.status === "error") {
              throw new Error(result.message);
            }
            return result.value;
          }
        : undefined,
    [businessSlug, searchConnectedRecordTargets],
  );

  const createConnectedRecord = useMemo(
    () =>
      businessSlug && createConnectedRecordTarget
        ? async (
            context: { viewKey: string },
            columnKey: string,
            primaryValue: string,
          ) => {
            const input: ProductionConnectionCreateInput = {
              columnKey,
              primaryValue,
            };
            const result = await createConnectedRecordTarget(
              context.viewKey,
              input,
            );
            if (result.status === "error") {
              throw new Error(result.message);
            }
            return result.value;
          }
        : undefined,
    [businessSlug, createConnectedRecordTarget],
  );

  const footer = (
    <span>
      {readOnly
        ? "Read-only Table · Records are shown without edit controls."
        : "Changes save as you make them."}
      {creationFallbackHref ? (
        <>
          {" "}
          <a href={creationFallbackHref}>Open the configured creation screen</a>
          .
        </>
      ) : null}
    </span>
  );

  return (
    <EditorKernel
      adapter={adapter}
      capabilities={capabilities}
      {...(businessSlug !== undefined ? { businessSlug } : {})}
      footer={footer}
      headerContent={headerContent}
      marker={
        surface === "workspace" ? (
          <p className="editor-lab-kicker">Table</p>
        ) : undefined
      }
      {...(creationFallbackHref !== undefined ? { creationFallbackHref } : {})}
      {...(newRecordLabel !== undefined ? { newRecordLabel } : {})}
      onStructureChanged={() => router.refresh()}
      {...(connectionSource ? { connectionSource } : {})}
      {...(connectionTargets ? { connectionTargets } : {})}
      {...(createConnection ? { onCreateConnection: createConnection } : {})}
      {...(recordCountLabel !== undefined ? { recordCountLabel } : {})}
      {...(recordTypeLabel !== undefined ? { recordTypeLabel } : {})}
      {...(panelStatusLabel !== undefined ? { panelStatusLabel } : {})}
      {...(fullRecordPath !== undefined ? { fullRecordPath } : {})}
      {...(readConnectedRecordContext
        ? { loadConnectedRecord: readConnectedRecordContext }
        : {})}
      {...(updateConnectedRecord ? { updateConnectedRecord } : {})}
      {...(searchConnectedRecord
        ? { searchConnectedRecordTargets: searchConnectedRecord }
        : {})}
      {...(createConnectedRecord
        ? { createConnectedRecordTarget: createConnectedRecord }
        : {})}
      readOnly={readOnly}
      variant={surface}
    />
  );
}
