"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useMemo,
  useState,
  type FormEvent,
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
  const [pageError, setPageError] = useState<string | null>(null);
  const [selectionResetToken, setSelectionResetToken] = useState(0);
  const [viewPreview, setViewPreview] = useState<EditorTablePreview | null>(
    null,
  );
  if (table !== lastReceivedTable) {
    setLastReceivedTable(table);
    setLoadedTable(table);
    setSearch(initialSearch);
    setAppliedSearch(initialSearch);
    setTotalCount(initialTotalCount ?? table.rows.length);
    setHasMore(initialHasMore);
    setPageError(null);
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
      if (!loadTablePage || loadingPage) return;
      if (!append) {
        setSelectionResetToken((current) => current + 1);
      }
      setLoadingPage(true);
      setPageError(null);
      try {
        const result = await loadTablePage({ offset, search: nextSearch });
        if (result.status === "error") throw new Error(result.message);
        setLoadedTable((current) => ({
          ...current,
          rows: append
            ? [
                ...current.rows,
                ...result.value.rows.filter(
                  (row) =>
                    !current.rows.some((existing) => existing.id === row.id),
                ),
              ]
            : [...result.value.rows],
        }));
        setAppliedSearch(result.value.search);
        setTotalCount(result.value.totalCount);
        setHasMore(result.value.hasMore);
      } catch (error) {
        setPageError(
          error instanceof Error
            ? error.message
            : "Could not load more records. Try again.",
        );
      } finally {
        setLoadingPage(false);
      }
    },
    [loadTablePage, loadingPage],
  );

  const submitSearch = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      void loadPage(0, search.trim(), false);
    },
    [loadPage, search],
  );

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
      <form className="table-workbench-search" onSubmit={submitSearch}>
        <label htmlFor={`table-search-${table.key}`}>
          <span className="editor-sr-only">
            Search {recordTypeLabel ?? table.name}
          </span>
          <input
            id={`table-search-${table.key}`}
            maxLength={200}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`Search ${(recordTypeLabel ?? table.name).toLocaleLowerCase("en")}…`}
            type="search"
            value={search}
          />
        </label>
        <button disabled={loadingPage} type="submit">
          {loadingPage ? "Searching…" : "Search"}
        </button>
        {search ? (
          <button
            className="table-workbench-search-clear"
            disabled={loadingPage}
            onClick={() => {
              setSearch("");
              void loadPage(0, "", false);
            }}
            type="button"
          >
            Clear
          </button>
        ) : null}
      </form>
      {viewControls}
      <div className="table-workbench-toolbar-status" role="status">
        <span>
          {appliedSearch
            ? `${totalCount} matching record${totalCount === 1 ? "" : "s"}`
            : `${totalCount} record${totalCount === 1 ? "" : "s"}`}
        </span>
        {hasMore ? (
          <button
            disabled={loadingPage}
            onClick={() =>
              void loadPage(loadedTable.rows.length, appliedSearch, true)
            }
            type="button"
          >
            {loadingPage ? "Loading…" : "Load more"}
          </button>
        ) : null}
        {pageError ? (
          <span className="table-workbench-error">{pageError}</span>
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
