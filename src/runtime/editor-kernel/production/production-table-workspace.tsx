"use client";

import { ArchivedRecords } from "./archived-records";
import { setProductionTableRecordArchivedAction } from "./production-table-actions";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type {
  AddExistingConnectionPropertyInput,
  ConnectionTableOption,
  CreateConnectionPropertyInput,
  EditorCapabilities,
  EditorTable,
  EditorTablePreview,
  ExistingConnectionPropertyOption,
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
  ProductionScopedContextualRecordCreateAction,
  ProductionScopedContextualRecordCreateStateAction,
  ProductionBulkUpdateAction,
  ProductionTablePageAction,
} from "./action-types";
import {
  createProductionTableAdapter,
  type ProductionTableAdapterActions,
} from "./production-table-adapter";
import { TableViewPreviewProvider } from "../../views/table-view-preview-context";

export interface ProductionTableWorkspaceProps {
  table: EditorTable;
  /** Stable identity for a mounted embed; View keys may appear more than once. */
  instanceId?: string;
  capabilities: EditorCapabilities;
  actions: ProductionTableAdapterActions;
  businessSlug?: string;
  headerContent?: ReactNode;
  viewControls?: ReactNode;
  currentness?: ProductionConfigurationCurrentness | undefined;
  creationFallbackHref?: string | undefined;
  newRecordLabel?: string;
  recordTypeLabel?: string;
  recordCountLabel?: string;
  initialSearch?: string;
  initialTotalCount?: number;
  initialHasMore?: boolean;
  loadTablePage?: ProductionTablePageAction;
  bulkUpdate?: ProductionBulkUpdateAction;
  panelStatusLabel?: string;
  fullRecordPath?: string;
  readConnectedRecord?: ProductionRecordPanelContextAction;
  updateConnectedRecordCell?: ProductionScopedCellEditAction;
  updateConnectedRecordConnection?: ProductionScopedConnectionEditAction;
  searchConnectedRecordTargets?: ProductionScopedConnectionSearchAction;
  createConnectedRecordTarget?: ProductionScopedConnectionCreateAction;
  loadContextualRecordCreateState?: ProductionScopedContextualRecordCreateStateAction;
  createContextualRecord?: ProductionScopedContextualRecordCreateAction;
  connectionSource?: Pick<
    ConnectionTableOption,
    "singularLabel" | "pluralLabel"
  >;
  connectionTargets?: readonly ConnectionTableOption[];
  existingConnections?: readonly ExistingConnectionPropertyOption[];
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
  viewControls,
  newRecordLabel,
  panelStatusLabel,
  recordTypeLabel,
  readOnly = false,
  recordCountLabel,
  initialSearch = "",
  initialTotalCount,
  initialHasMore = false,
  loadTablePage,
  bulkUpdate,
  fullRecordPath,
  readConnectedRecord,
  updateConnectedRecordCell,
  updateConnectedRecordConnection,
  searchConnectedRecordTargets,
  createConnectedRecordTarget,
  loadContextualRecordCreateState,
  createContextualRecord,
  connectionSource,
  connectionTargets,
  existingConnections,
  surface = "workspace",
  table,
  instanceId,
}: Readonly<ProductionTableWorkspaceProps>): ReactNode {
  const router = useRouter();
  const [loadedTable, setLoadedTable] = useState(table);
  const [lastReceivedTable, setLastReceivedTable] = useState(table);
  const [search, setSearch] = useState(initialSearch);
  const [appliedSearch, setAppliedSearch] = useState(initialSearch);
  const [totalCount, setTotalCount] = useState(
    initialTotalCount ?? table.rows.length,
  );
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingPage, setLoadingPage] = useState(false);
  const [pendingWrites, setPendingWrites] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const requestVersion = useRef(0);
  const refreshRecords = useCallback(() => {
    if (loadTablePage) setRefreshRevision((value) => value + 1);
    else router.refresh();
  }, [loadTablePage, router]);
  const [pageError, setPageError] = useState<string | null>(null);
  const [selectionResetToken, setSelectionResetToken] = useState(0);
  const [viewPreview, setViewPreview] = useState<EditorTablePreview | null>(
    null,
  );
  if (table !== lastReceivedTable) {
    setLastReceivedTable(table);
    if (table.key !== lastReceivedTable.key) {
      setLoadedTable(table);
      setSearch(initialSearch);
      setAppliedSearch(initialSearch);
      setTotalCount(initialTotalCount ?? table.rows.length);
      setHasMore(initialHasMore);
      setViewPreview(null);
    } else {
      setLoadedTable((current) =>
        loadTablePage ? { ...table, rows: current.rows } : table,
      );
    }
    setPageError(null);
    setRefreshRevision((value) => value + 1);
  }
  const updateViewPreview = useCallback(
    (preview: EditorTablePreview | null): void => setViewPreview(preview),
    [],
  );
  const adapter = useMemo(
    () => createProductionTableAdapter(loadedTable, actions, currentness),
    [actions, currentness, loadedTable],
  );

  const loadPage = useCallback(
    async (
      offset: number,
      nextSearch: string,
      append: boolean,
    ): Promise<void> => {
      if (!loadTablePage || pendingWrites || viewPreview) return;
      const version = ++requestVersion.current;
      if (!append) {
        setSelectionResetToken((current) => current + 1);
      }
      setLoadingPage(true);
      setPageError(null);
      try {
        const targetCount =
          append || nextSearch !== appliedSearch
            ? 50
            : Math.max(50, loadedTable.rows.length);
        let pageOffset = offset;
        const rows: EditorRow[] = [];
        let result;
        do {
          result = await loadTablePage({
            offset: pageOffset,
            search: nextSearch,
          });
          if (version !== requestVersion.current) return;
          if (result.status === "error") throw new Error(result.message);
          rows.push(...result.value.rows);
          pageOffset += result.value.rows.length;
        } while (
          !append &&
          result.value.hasMore &&
          rows.length < targetCount &&
          result.value.rows.length > 0
        );
        const page = result.value;
        setLoadedTable((current) => ({
          ...current,
          ...(page.grouping ? { grouping: page.grouping } : {}),
          rows: append
            ? [
                ...current.rows,
                ...rows.filter(
                  (row) =>
                    !current.rows.some((existing) => existing.id === row.id),
                ),
              ]
            : rows,
        }));
        setAppliedSearch(page.search);
        setTotalCount(page.totalCount);
        setHasMore(page.hasMore);
      } catch (error) {
        if (version !== requestVersion.current) return;
        setPageError(
          error instanceof Error
            ? error.message
            : "Could not load more records. Try again.",
        );
      } finally {
        if (version === requestVersion.current) setLoadingPage(false);
      }
    },
    [
      loadTablePage,
      pendingWrites,
      viewPreview,
      appliedSearch,
      loadedTable.rows.length,
    ],
  );

  const loadPageRef = useRef(loadPage);
  useEffect(() => {
    loadPageRef.current = loadPage;
  }, [loadPage]);
  useEffect(() => {
    if (!loadTablePage || pendingWrites || viewPreview) return;
    const timer = window.setTimeout(
      () => void loadPageRef.current(0, search.trim(), false),
      180,
    );
    return () => {
      window.clearTimeout(timer);
      requestVersion.current += 1;
    };
  }, [search, refreshRevision, pendingWrites, viewPreview, loadTablePage]);

  const createConnection = useMemo(
    () =>
      actions.createConnection && currentness
        ? async (
            input: CreateConnectionPropertyInput,
          ): Promise<string | false> => {
            const existingColumnKeys = new Set(
              table.columns.map((column) => column.key),
            );
            const result = await actions.createConnection!({
              ...input,
              currentness,
            });
            if (result.status === "error") {
              throw new Error(result.message);
            }
            const createdColumnKey =
              result.value.table.columns.find(
                (column) => !existingColumnKeys.has(column.key),
              )?.key ?? false;
            if (createdColumnKey) {
              window.location.hash = `table-column-${encodeURIComponent(createdColumnKey)}`;
            }
            return createdColumnKey;
          }
        : undefined,
    [actions.createConnection, currentness, table.columns],
  );

  const addExistingConnection = useMemo(
    () =>
      actions.addExistingConnection && currentness
        ? async (
            input: AddExistingConnectionPropertyInput,
          ): Promise<string | false> => {
            const existingColumnKeys = new Set(
              table.columns.map((column) => column.key),
            );
            const result = await actions.addExistingConnection!({
              ...input,
              currentness,
            });
            if (result.status === "error") {
              throw new Error(result.message);
            }
            const createdColumnKey =
              result.value.table.columns.find(
                (column) => !existingColumnKeys.has(column.key),
              )?.key ?? false;
            if (createdColumnKey) {
              window.location.hash = `table-column-${encodeURIComponent(createdColumnKey)}`;
            }
            return createdColumnKey;
          }
        : undefined,
    [actions.addExistingConnection, currentness, table.columns],
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

  const loadContextualRecordCreate = useMemo(
    () =>
      businessSlug && loadContextualRecordCreateState
        ? async (
            context: { viewKey: string; row: { id: string } },
            columnKey: string,
          ) => {
            const result = await loadContextualRecordCreateState(
              context.viewKey,
              {
                parentRecordId: context.row.id,
                columnKey,
              },
            );
            if (result.status === "error") throw new Error(result.message);
            return result.value;
          }
        : undefined,
    [businessSlug, loadContextualRecordCreateState],
  );

  const createContextual = useMemo(
    () =>
      businessSlug && createContextualRecord
        ? async (
            context: { viewKey: string; row: { id: string } },
            columnKey: string,
            values: Readonly<Record<string, EditorValue>>,
            connections: readonly {
              relationshipKey: string;
              direction: "source" | "target";
              targetRecordIds: readonly string[];
            }[],
          ) => {
            const result = await createContextualRecord(context.viewKey, {
              parentRecordId: context.row.id,
              columnKey,
              values,
              connections,
            });
            if (result.status === "error") throw new Error(result.message);
            return result.value;
          }
        : undefined,
    [businessSlug, createContextualRecord],
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

  const workbenchToolbar = loadTablePage ? (
    <div className="table-workbench-toolbar">
      <div className="table-workbench-search">
        <label htmlFor={`table-search-${instanceId ?? table.key}`}>
          <span className="editor-sr-only">
            Search {recordTypeLabel ?? table.name}
          </span>
          <input
            id={`table-search-${instanceId ?? table.key}`}
            disabled={pendingWrites || Boolean(viewPreview)}
            maxLength={200}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`Search ${(recordTypeLabel ?? table.name).toLocaleLowerCase("en")}…`}
            type="search"
            value={search}
          />
        </label>
      </div>
      {viewControls}
      {businessSlug && currentness && !readOnly ? (
        <ArchivedRecords
          businessSlug={businessSlug}
          viewKey={table.key}
          onChanged={refreshRecords}
        />
      ) : null}
      <div className="table-workbench-toolbar-status" role="status">
        <span>
          {viewPreview
            ? `${viewPreview.table.rows.length} of ${viewPreview.totalCount} preview records`
            : `${loadedTable.rows.length} of ${totalCount}${appliedSearch ? " matching" : ""} records`}
        </span>
        {hasMore && !viewPreview ? (
          <button
            disabled={loadingPage || pendingWrites}
            onClick={() =>
              void loadPage(loadedTable.rows.length, appliedSearch, true)
            }
            type="button"
          >
            {loadingPage ? "Loading…" : "Load more"}
          </button>
        ) : null}
        {pageError ? (
          <span className="table-workbench-error" role="alert">
            {pageError}{" "}
            <button type="button" onClick={refreshRecords}>
              Retry
            </button>
          </span>
        ) : null}
      </div>
    </div>
  ) : (
    viewControls
  );

  return (
    <TableViewPreviewProvider value={{ setPreview: updateViewPreview }}>
      <EditorKernel
        adapter={adapter}
        {...(instanceId ? { instanceId } : {})}
        onRecordsChanged={refreshRecords}
        {...(businessSlug && currentness && !readOnly
          ? {
              onArchiveRecord: async (recordId: string) => {
                const result = await setProductionTableRecordArchivedAction(
                  businessSlug,
                  table.key,
                  { recordId, archived: true },
                );
                if (result.status === "error") throw new Error(result.message);
                refreshRecords();
              },
            }
          : {})}
        onPendingWritesChange={setPendingWrites}
        capabilities={capabilities}
        {...(businessSlug !== undefined ? { businessSlug } : {})}
        footer={footer}
        headerContent={headerContent}
        toolbarContent={workbenchToolbar}
        marker={
          surface === "workspace" ? (
            <p className="editor-lab-kicker">Table</p>
          ) : undefined
        }
        {...(creationFallbackHref !== undefined
          ? { creationFallbackHref }
          : {})}
        {...(newRecordLabel !== undefined ? { newRecordLabel } : {})}
        onStructureChanged={() => router.refresh()}
        {...(bulkUpdate ? { bulkUpdate } : {})}
        serverSearchManaged={Boolean(loadTablePage)}
        serverSearchText={search}
        onClearServerSearch={() => setSearch("")}
        selectionResetToken={selectionResetToken}
        {...(connectionSource ? { connectionSource } : {})}
        {...(connectionTargets ? { connectionTargets } : {})}
        {...(existingConnections ? { existingConnections } : {})}
        {...(createConnection ? { onCreateConnection: createConnection } : {})}
        {...(addExistingConnection
          ? { onAddExistingConnection: addExistingConnection }
          : {})}
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
        {...(loadContextualRecordCreate ? { loadContextualRecordCreate } : {})}
        {...(createContextual
          ? { createContextualRecord: createContextual }
          : {})}
        readOnly={readOnly}
        variant={surface}
        viewPreview={viewPreview}
      />
    </TableViewPreviewProvider>
  );
}
