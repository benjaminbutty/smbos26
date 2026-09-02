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
import { connectedFieldColumnStorageKey } from "../../../../../core/experience/table-query";
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
  addExistingProductionTableConnectionAction,
  bulkUpdateProductionTableRecordsAction,
  addProductionTableColumnAction,
  changeProductionTableColumnTypeAction,
  createProductionTableConnectionAction,
  createProductionTableRowAction,
  insertProductionTableColumnAction,
  pasteProductionTableAction,
  readProductionTableRecordAction,
  readProductionRecordPanelContextAction,
  renameProductionTableAction,
  renameProductionTableColumnAction,
  reorderProductionTableColumnsAction,
  updateProductionTableCellAction,
  updateProductionTableConnectionAction,
  updateProductionTableColumnOptionsAction,
  createProductionTableConnectionTargetAction,
  createProductionTableContextualRecordAction,
  getProductionTableContextualRecordCreateStateAction,
  loadProductionTablePageAction,
  searchProductionTableConnectionTargetsAction,
} from "../../../../../runtime/editor-kernel/production/production-table-actions";
import { getDirectTableRowCreationAvailability } from "../../../../../runtime/views/direct-table-record-service";
import { updateInlineRecordCell } from "../../../../../runtime/views/actions";
import { TableViewControls } from "../../../../../runtime/views/table-view-controls";
import { TableViewSelector } from "../../../../../runtime/views/table-view-navigation";
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
    const allTableViews = await experience.listTableViews();
    const targetViewKeyByObjectId = [...allTableViews]
      .sort((left, right) => {
        const leftConfig = normalizeTableViewConfig(left.config_json);
        const rightConfig = normalizeTableViewConfig(right.config_json);
        return (
          (leftConfig.role === "primary" ? 0 : 1) -
            (rightConfig.role === "primary" ? 0 : 1) ||
          left.name.localeCompare(right.name) ||
          left.key.localeCompare(right.key)
        );
      })
      .reduce<Record<string, string>>((result, view) => {
        if (!result[view.object_definition_id]) {
          result[view.object_definition_id] = view.key;
        }
        return result;
      }, {});
    const tableViews = allTableViews
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
    const [tableObjectsResult, fieldsResult] = await Promise.all([
      supabase
        .from("object_definitions")
        .select("id, singular_label, plural_label, kind, is_active")
        .eq("business_id", tenant.business.id)
        .eq("is_active", true),
      supabase
        .from("field_definitions")
        .select("object_definition_id, key, label, field_type, position")
        .eq("business_id", tenant.business.id)
        .eq("is_active", true),
    ]);
    const tableObjects = tableObjectsResult.data;
    if (
      tableObjectsResult.error ||
      !tableObjects ||
      fieldsResult.error ||
      !fieldsResult.data
    ) {
      notFound();
    }
    const tableObjectById = new Map(
      tableObjects.map((object) => [object.id, object]),
    );
    const connectionTargets = [...allTableViews]
      .filter(
        (view) =>
          targetViewKeyByObjectId[view.object_definition_id] === view.key &&
          view.object_definition_id !== bundle.definition.object_definition_id,
      )
      .flatMap((view) => {
        const object = tableObjectById.get(view.object_definition_id);
        if (!object || object.kind !== "custom") {
          return [];
        }
        return [
          {
            viewKey: view.key,
            label: view.name,
            singularLabel: object.singular_label,
            pluralLabel: object.plural_label,
          },
        ];
      })
      .sort((left, right) => left.label.localeCompare(right.label));
    const configuredColumns = normalizeTableViewConfig(bundle.config).columns;
    const configuredConnectionKeys = new Set(
      configuredColumns.flatMap((column) =>
        column.kind === "connection"
          ? [`${column.relationship_key}:${column.direction}`]
          : [],
      ),
    );
    const existingConnections = (bundle.relationships ?? [])
      .flatMap((relationship) => {
        if (!relationship.is_active) return [];
        const direction =
          relationship.source_object_definition_id ===
          bundle.definition.object_definition_id
            ? ("source" as const)
            : ("target" as const);
        if (configuredConnectionKeys.has(`${relationship.key}:${direction}`)) {
          return [];
        }
        const otherObjectId =
          direction === "source"
            ? relationship.target_object_definition_id
            : relationship.source_object_definition_id;
        const otherObject = tableObjectById.get(otherObjectId);
        const targetViewKey = targetViewKeyByObjectId[otherObjectId];
        if (!otherObject || otherObject.kind !== "custom" || !targetViewKey) {
          return [];
        }
        const currentMultiplicity =
          relationship.cardinality === "many_to_many" ||
          (relationship.cardinality === "one_to_many" && direction === "target")
            ? ("several" as const)
            : ("one" as const);
        const targetMultiplicity =
          relationship.cardinality === "many_to_many" ||
          (relationship.cardinality === "one_to_many" && direction === "source")
            ? ("several" as const)
            : ("one" as const);
        return [
          {
            relationshipKey: relationship.key,
            direction,
            label:
              direction === "source"
                ? relationship.source_label
                : relationship.target_label,
            otherTableLabel: otherObject.plural_label,
            targetViewKey,
            currentMultiplicity,
            targetMultiplicity,
          },
        ];
      })
      .sort((left, right) => left.label.localeCompare(right.label));
    const fieldsByObjectId = new Map<string, typeof fieldsResult.data>();
    for (const field of fieldsResult.data) {
      const current = fieldsByObjectId.get(field.object_definition_id) ?? [];
      current.push(field);
      fieldsByObjectId.set(field.object_definition_id, current);
    }
    const connectedPropertyOptions = (bundle.relationships ?? [])
      .flatMap((relationship) => {
        if (!relationship.is_active) return [];
        const direction =
          relationship.source_object_definition_id ===
          bundle.definition.object_definition_id
            ? ("source" as const)
            : relationship.target_object_definition_id ===
                bundle.definition.object_definition_id
              ? ("target" as const)
              : null;
        const isSingleValue =
          relationship.cardinality === "one_to_one" ||
          (relationship.cardinality === "one_to_many" &&
            direction === "target");
        if (!direction || !isSingleValue) return [];
        const targetObjectId =
          direction === "source"
            ? relationship.target_object_definition_id
            : relationship.source_object_definition_id;
        const connectionLabel =
          direction === "source"
            ? relationship.source_label
            : relationship.target_label;
        return (fieldsByObjectId.get(targetObjectId) ?? [])
          .filter((field) => field.field_type !== "file")
          .sort((left, right) => left.position - right.position)
          .map((field) => ({
            relationshipKey: relationship.key,
            direction,
            targetFieldKey: field.key,
            label: `${connectionLabel} · ${field.label}`,
          }));
      })
      .sort((left, right) => left.label.localeCompare(right.label));
    const connectedFieldLabelByStorageKey = Object.fromEntries(
      connectedPropertyOptions.map((option) => [
        connectedFieldColumnStorageKey(
          option.relationshipKey,
          option.direction,
          option.targetFieldKey,
        ),
        option.label,
      ]),
    );
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
          connectedFieldLabelByStorageKey,
          editFormFieldKeys,
          targetViewKeyByObjectId,
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
    const primaryView = tableViews.find(
      (view) => normalizeTableViewConfig(view.config_json).role === "primary",
    );
    if (!primaryView) {
      notFound();
    }
    const primaryConfig = normalizeTableViewConfig(primaryView.config_json);
    const activeFieldKeys = new Set(
      bundle.fields
        .filter((field) => field.is_active)
        .map((field) => field.key),
    );
    const configuredFieldKeys = new Set(
      primaryConfig.columns.flatMap((column) =>
        column.kind === "field" ? [column.field_key] : [],
      ),
    );
    const availableSavedViewColumns = [
      ...primaryConfig.columns.filter(
        (column) =>
          column.kind !== "field" || activeFieldKeys.has(column.field_key),
      ),
      ...bundle.fields
        .filter(
          (field) => field.is_active && !configuredFieldKeys.has(field.key),
        )
        .sort((left, right) => left.position - right.position)
        .map((field) => ({
          kind: "field" as const,
          field_key: field.key,
        })),
    ];
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
      <section className="workspace-table-page">
        {error ? <Notice kind="error">{error}</Notice> : null}
        {message ? <Notice kind="message">{message}</Notice> : null}
        <ProductionTableWorkspace
          businessSlug={businessSlug}
          bulkUpdate={bulkUpdateProductionTableRecordsAction.bind(
            null,
            businessSlug,
            bundle.definition.key,
          )}
          actions={{
            addExistingConnection:
              addExistingProductionTableConnectionAction.bind(
                null,
                businessSlug,
                bundle.definition.key,
              ),
            addColumn: addProductionTableColumnAction.bind(
              null,
              businessSlug,
              bundle.definition.key,
            ),
            createConnection: createProductionTableConnectionAction.bind(
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
            canAddConnections: Boolean(
              currentness && bundle.object.kind === "custom",
            ),
            canInsertColumns: Boolean(currentness),
            canRenameColumns: Boolean(currentness),
            canChangeColumnTypes: Boolean(currentness),
            canUpdateColumnOptions: Boolean(currentness),
            canReorderColumns: Boolean(currentness),
            canResizeColumns: Boolean(currentness),
            canRenameTable: Boolean(currentness),
          }}
          creationFallbackHref={
            availability.formKey
              ? `/app/${encodeURIComponent(businessSlug)}/workspace/${experienceKeyToPath(bundle.definition.key)}/new`
              : undefined
          }
          currentness={currentness}
          connectionSource={{
            singularLabel: bundle.object.singular_label,
            pluralLabel: bundle.object.plural_label,
          }}
          connectionTargets={connectionTargets}
          existingConnections={existingConnections}
          headerContent={
            <TableViewSelector
              businessSlug={businessSlug}
              canCreateSavedViews={Boolean(currentness)}
              currentViewKey={bundle.definition.key}
              views={tableViews}
            />
          }
          newRecordLabel={`New ${bundle.object.singular_label.toLocaleLowerCase("en")}`}
          recordTypeLabel={bundle.object.singular_label}
          recordCountLabel={`${bundle.query?.totalCount ?? bundle.records.length} ${bundle.object.plural_label.toLocaleLowerCase("en")}`}
          {...(bundle.query
            ? {
                initialHasMore: bundle.query.hasMore,
                initialTotalCount: bundle.query.totalCount,
              }
            : {})}
          loadTablePage={loadProductionTablePageAction.bind(
            null,
            businessSlug,
            bundle.definition.key,
          )}
          fullRecordPath={`/app/${encodeURIComponent(businessSlug)}/workspace/${experienceKeyToPath(bundle.definition.key)}`}
          readConnectedRecord={readProductionRecordPanelContextAction.bind(
            null,
            businessSlug,
          )}
          updateConnectedRecordCell={updateProductionTableCellAction.bind(
            null,
            businessSlug,
          )}
          updateConnectedRecordConnection={updateProductionTableConnectionAction.bind(
            null,
            businessSlug,
          )}
          searchConnectedRecordTargets={searchProductionTableConnectionTargetsAction.bind(
            null,
            businessSlug,
          )}
          createConnectedRecordTarget={createProductionTableConnectionTargetAction.bind(
            null,
            businessSlug,
          )}
          createContextualRecord={createProductionTableContextualRecordAction.bind(
            null,
            businessSlug,
          )}
          loadContextualRecordCreateState={getProductionTableContextualRecordCreateStateAction.bind(
            null,
            businessSlug,
          )}
          table={mapped.table}
          viewControls={
            <TableViewControls
              availableColumns={availableSavedViewColumns}
              businessSlug={businessSlug}
              connectedPropertyOptions={connectedPropertyOptions}
              config={normalizeTableViewConfig(bundle.config)}
              currentness={currentness}
              fields={bundle.fields}
              key={`${bundle.definition.key}:${currentness?.expectedHeadRevision ?? "read-only"}`}
              primaryViewKey={primaryView.key}
              {...(bundle.relationships
                ? { relationships: bundle.relationships }
                : {})}
              viewKey={bundle.definition.key}
              viewName={bundle.definition.name}
            />
          }
        />
      </section>
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
