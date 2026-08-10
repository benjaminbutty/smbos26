import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { hasCapability } from "../../../../../auth/capabilities";
import { resolveTenant } from "../../../../../auth/authorization";
import { Notice } from "../../../../../components/notice";
import { loadDirectTableConfiguration } from "../../../../../core/configuration/direct-tables/service";
import { createExperienceService } from "../../../../../core/experience/service";
import {
  normalizeTableViewConfig,
  type TableViewConfig,
} from "../../../../../core/experience/schemas";
import { createServerClient } from "../../../../../db/supabase/server";
import {
  readSearchParam,
  type SearchParams,
} from "../../../../../lib/search-params";
import {
  experienceKeyToPath,
  experiencePathToKey,
} from "../../../../../runtime/routing";
import {
  mapExperienceViewBundleToEditorTable,
  ProductionTableMappingError,
} from "../../../../../runtime/editor-kernel/production/table-mapper";
import { ProductionTableWorkspace } from "../../../../../runtime/editor-kernel/production/production-table-workspace";
import {
  addProductionTableColumnAction,
  changeProductionTableColumnTypeAction,
  createProductionTableRowAction,
  insertProductionTableColumnAction,
  pasteProductionTableAction,
  readProductionTableRecordAction,
  renameProductionTableAction,
  renameProductionTableColumnAction,
  reorderProductionTableColumnsAction,
  updateProductionTableCellAction,
  updateProductionTableConnectionAction,
  updateProductionTableColumnOptionsAction,
  createProductionTableConnectionTargetAction,
  searchProductionTableConnectionTargetsAction,
} from "../../../../../runtime/editor-kernel/production/production-table-actions";
import { getDirectTableRowCreationAvailability } from "../../../../../runtime/views/direct-table-record-service";
import { updateInlineRecordCell } from "../../../../../runtime/views/actions";
import { TableViewControls } from "../../../../../runtime/views/table-view-controls";
import { TableViewTabs } from "../../../../../runtime/views/table-view-navigation";
import { ViewRenderer } from "../../../../../runtime/views/view-renderer";

interface WorkspaceScreenPageProps {
  params: Promise<{ businessSlug: string; screenSlug: string }>;
  searchParams: SearchParams;
}

export default async function WorkspaceScreenPage({
  params,
  searchParams,
}: Readonly<WorkspaceScreenPageProps>): Promise<ReactNode> {
  const { businessSlug, screenSlug } = await params;
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  const experience = createExperienceService(supabase, {
    businessId: tenant.business.id,
  });
  const [error, message] = await Promise.all([
    readSearchParam(searchParams, "error"),
    readSearchParam(searchParams, "message"),
  ]);

  let bundle;
  try {
    bundle = await experience.loadView(experiencePathToKey(screenSlug));
  } catch {
    notFound();
  }

  if (bundle.definition.view_type === "table") {
    const tableViews = (await experience.listTableViews())
      .filter(
        (view) =>
          view.object_definition_id === bundle.definition.object_definition_id,
      )
      .sort((left, right) => {
        const leftConfig = normalizeTableViewConfig(left.config_json);
        const rightConfig = normalizeTableViewConfig(right.config_json);
        return (
          (leftConfig.role === "primary" ? 0 : 1) -
            (rightConfig.role === "primary" ? 0 : 1) ||
          left.name.localeCompare(right.name) ||
          left.key.localeCompare(right.key)
        );
      });
    const productionPreview = await (async () => {
      try {
        const config = bundle.config as TableViewConfig;
        let editFormFieldKeys: readonly string[] | undefined;
        if (config.edit_form_key) {
          const form = await experience.loadForm(
            config.edit_form_key,
            "internal",
          );
          if (
            form.definition.mode !== "edit" ||
            form.definition.business_id !== bundle.definition.business_id ||
            form.definition.object_definition_id !==
              bundle.definition.object_definition_id
          ) {
            throw new ProductionTableMappingError(
              "This Table's edit screen is not available.",
            );
          }
          editFormFieldKeys = form.config.fields
            .filter((field) => !field.hidden)
            .map((field) => field.field);
        }
        const mapped = mapExperienceViewBundleToEditorTable({
          bundle,
          editFormFieldKeys,
        });
        const availability = await getDirectTableRowCreationAvailability(
          supabase,
          { businessId: tenant.business.id },
          bundle.definition.key,
        );
        const currentness = hasCapability(
          tenant.membership.role,
          "manage_configuration",
        )
          ? (
              await loadDirectTableConfiguration(supabase, {
                businessId: tenant.business.id,
                actorId: tenant.user.id,
              })
            ).currentness
          : undefined;
        return { availability, currentness, mapped };
      } catch {
        notFound();
      }
    })();
    const { availability, currentness, mapped } = productionPreview;
    const primary = mapped.table.columns.find(
      (column) => column.key === mapped.table.primaryColumnKey,
    );
    const rowCreation =
      availability.kind === "direct" && primary?.editable !== false
        ? {
            rowCreation: "direct" as const,
          }
        : availability.kind === "configured_form"
          ? {
              rowCreation: "configured_form" as const,
              rowCreationMessage:
                "Use the configured creation screen to add a new record.",
            }
          : {
              rowCreation: "unavailable" as const,
              rowCreationMessage:
                availability.kind === "unavailable"
                  ? availability.message
                  : "The primary property cannot be edited directly in this preview.",
            };

    return (
      <>
        <TableViewTabs
          businessSlug={businessSlug}
          currentViewKey={bundle.definition.key}
          views={tableViews}
        />
        <TableViewControls
          businessSlug={businessSlug}
          config={normalizeTableViewConfig(bundle.config)}
          currentness={currentness}
          fields={bundle.fields}
          {...(bundle.relationships
            ? { relationships: bundle.relationships }
            : {})}
          viewKey={bundle.definition.key}
        />
        <ProductionTableWorkspace
          actions={{
            addColumn: addProductionTableColumnAction.bind(
              null,
              businessSlug,
              bundle.definition.key,
            ),
            insertColumn: insertProductionTableColumnAction.bind(
              null,
              businessSlug,
              bundle.definition.key,
            ),
            changeColumnType: changeProductionTableColumnTypeAction.bind(
              null,
              businessSlug,
              bundle.definition.key,
            ),
            createRow: createProductionTableRowAction.bind(
              null,
              businessSlug,
              bundle.definition.key,
            ),
            openRecord: readProductionTableRecordAction.bind(
              null,
              businessSlug,
              bundle.definition.key,
            ),
            paste: pasteProductionTableAction.bind(
              null,
              businessSlug,
              bundle.definition.key,
            ),
            renameColumn: renameProductionTableColumnAction.bind(
              null,
              businessSlug,
              bundle.definition.key,
            ),
            renameTable: renameProductionTableAction.bind(
              null,
              businessSlug,
              bundle.definition.key,
            ),
            reorderColumns: reorderProductionTableColumnsAction.bind(
              null,
              businessSlug,
              bundle.definition.key,
            ),
            updateCell: updateProductionTableCellAction.bind(
              null,
              businessSlug,
              bundle.definition.key,
            ),
            updateConnection: updateProductionTableConnectionAction.bind(
              null,
              businessSlug,
              bundle.definition.key,
            ),
            searchConnectionTargets:
              searchProductionTableConnectionTargetsAction.bind(
                null,
                businessSlug,
                bundle.definition.key,
              ),
            createConnectionTarget:
              createProductionTableConnectionTargetAction.bind(
                null,
                businessSlug,
                bundle.definition.key,
              ),
            updateColumnOptions: updateProductionTableColumnOptionsAction.bind(
              null,
              businessSlug,
              bundle.definition.key,
            ),
          }}
          capabilities={{
            ...rowCreation,
            canAddColumns: Boolean(currentness),
            canInsertColumns: Boolean(currentness),
            canRenameColumns: Boolean(currentness),
            canChangeColumnTypes: Boolean(currentness),
            canUpdateColumnOptions: Boolean(currentness),
            canReorderColumns: Boolean(currentness),
            canResizeColumns: Boolean(currentness),
            canRenameTable: Boolean(currentness),
          }}
          creationFallbackHref={
            availability.kind === "configured_form"
              ? `/app/${encodeURIComponent(businessSlug)}/workspace/${experienceKeyToPath(bundle.definition.key)}/new`
              : undefined
          }
          currentness={currentness}
          table={mapped.table}
        />
      </>
    );
  }

  return (
    <section className="tenant-content">
      {error ? <Notice kind="error">{error}</Notice> : null}
      {message ? <Notice kind="message">{message}</Notice> : null}
      <ViewRenderer
        bundle={bundle}
        businessSlug={businessSlug}
        inlineEditAction={updateInlineRecordCell.bind(null, businessSlug)}
      />
    </section>
  );
}
