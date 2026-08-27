import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { resolveTenant } from "../../../../../../auth/authorization";
import { Notice } from "../../../../../../components/notice";
import {
  createExperienceService,
  type ExperienceViewBundle,
} from "../../../../../../core/experience/service";
import {
  normalizeTableViewConfig,
  type DetailViewConfig,
  type TableViewConfig,
} from "../../../../../../core/experience/schemas";
import { connectionColumnStorageKey } from "../../../../../../core/experience/table-query";
import { createServerClient } from "../../../../../../db/supabase/server";
import {
  readSearchParam,
  type SearchParams,
} from "../../../../../../lib/search-params";
import {
  experienceKeyToPath,
  experiencePathToKey,
} from "../../../../../../runtime/routing";
import {
  type RuntimeDetailConnectionGroup,
  ViewRenderer,
  viewFieldKeys,
} from "../../../../../../runtime/views/view-renderer";
import { loadMappedTable } from "../../../../../../runtime/editor-kernel/production/production-table-actions";
import {
  createProductionTableContextualRecordAction,
  getProductionTableContextualRecordCreateStateAction,
  searchProductionTableConnectionTargetsAction,
} from "../../../../../../runtime/editor-kernel/production/production-table-actions";
import { ContextualDetailConnections } from "../../../../../../runtime/editor-kernel/production/contextual-detail-connections";
import { RecordLocationAvailability } from "./record-location-availability";

interface RecordDetailPageProps {
  params: Promise<{
    businessSlug: string;
    screenSlug: string;
    recordId: string;
  }>;
  searchParams: SearchParams;
}

function fallbackDetailBundle(
  source: ExperienceViewBundle,
): ExperienceViewBundle {
  const fields = viewFieldKeys(source);
  const sourceConfig = source.config;
  const titleField =
    "title_field" in sourceConfig
      ? sourceConfig.title_field
      : "primary_field" in sourceConfig
        ? sourceConfig.primary_field
        : fields[0];
  const editFormKey =
    "edit_form_key" in sourceConfig ? sourceConfig.edit_form_key : undefined;
  const config: DetailViewConfig = {
    fields,
    include_archived: sourceConfig.include_archived,
    ...(titleField ? { title_field: titleField } : {}),
    ...(editFormKey ? { edit_form_key: editFormKey } : {}),
  };

  return {
    ...source,
    definition: {
      ...source.definition,
      view_type: "detail",
    },
    config,
  };
}

function detailConnectionGroups(
  source: ExperienceViewBundle,
  recordId: string,
  businessSlug: string,
  tableViews: readonly { key: string; object_definition_id: string }[],
): RuntimeDetailConnectionGroup[] {
  if (source.definition.view_type !== "table") {
    return [];
  }

  const config = normalizeTableViewConfig(source.config as TableViewConfig);
  const connectionValues = source.connectionValues?.[recordId] ?? {};
  const tableViewByObject = new Map<string, string>();
  for (const view of tableViews) {
    if (!tableViewByObject.has(view.object_definition_id)) {
      tableViewByObject.set(view.object_definition_id, view.key);
    }
  }

  return config.columns.flatMap((column) => {
    if (column.kind !== "connection") {
      return [];
    }
    const relationship = source.relationships?.find(
      (candidate) => candidate.key === column.relationship_key,
    );
    if (!relationship) {
      return [];
    }
    const targetObjectDefinitionId =
      column.direction === "source"
        ? relationship.target_object_definition_id
        : relationship.source_object_definition_id;
    const targetViewKey = tableViewByObject.get(targetObjectDefinitionId);
    const values =
      connectionValues[
        connectionColumnStorageKey(column.relationship_key, column.direction)
      ] ?? [];
    return [
      {
        key: `${column.relationship_key}:${column.direction}`,
        label:
          column.label ??
          (column.direction === "source"
            ? relationship.source_label
            : relationship.target_label),
        items: values.map((value) => ({
          id: value.id,
          label: value.label,
          ...(targetViewKey
            ? {
                href: `/app/${encodeURIComponent(
                  businessSlug,
                )}/workspace/${experienceKeyToPath(targetViewKey)}/${encodeURIComponent(value.id)}`,
              }
            : {}),
        })),
      },
    ];
  });
}

export default async function RecordDetailPage({
  params,
  searchParams,
}: Readonly<RecordDetailPageProps>): Promise<ReactNode> {
  const { businessSlug, screenSlug, recordId } = await params;
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  const experience = createExperienceService(supabase, {
    businessId: tenant.business.id,
  });
  const [error, message] = await Promise.all([
    readSearchParam(searchParams, "error"),
    readSearchParam(searchParams, "message"),
  ]);

  const { source, detail, record, detailConnections, contextualParent } =
    await (async () => {
      try {
        const [source, tableViews] = await Promise.all([
          experience.loadView(experiencePathToKey(screenSlug)),
          experience.listTableViews(),
        ]);
        const sourceRecord = source.records.find(
          (candidate) => candidate.id === recordId,
        );
        if (!sourceRecord) {
          notFound();
        }
        const mappedSource = await loadMappedTable(
          supabase,
          tenant.business.id,
          source.definition.key,
        );
        const contextualParent = mappedSource.table.rows.find(
          (candidate) => candidate.id === recordId,
        );

        const configuredDetail = await experience.loadDetailViewForObject(
          source.definition.object_definition_id,
        );
        const detail = configuredDetail ?? fallbackDetailBundle(source);
        const record = configuredDetail
          ? configuredDetail.records.find(
              (candidate) => candidate.id === recordId,
            )
          : sourceRecord;
        if (!record) {
          notFound();
        }

        return {
          detail,
          record,
          source,
          detailConnections: detailConnectionGroups(
            source,
            record.id,
            businessSlug,
            tableViews,
          ),
          ...(contextualParent
            ? {
                contextualParent: {
                  row: contextualParent,
                  columns:
                    mappedSource.table.recordColumns ??
                    mappedSource.table.columns,
                },
              }
            : {}),
        };
      } catch {
        notFound();
      }
    })();

  return (
    <section className="tenant-content">
      {error ? <Notice kind="error">{error}</Notice> : null}
      {message ? <Notice kind="message">{message}</Notice> : null}
      <ViewRenderer
        bundle={detail}
        businessSlug={businessSlug}
        navigationViewKey={source.definition.key}
        record={record}
        detailConnections={detailConnections}
        {...(contextualParent
          ? {
              detailConnectionActions: (
                <ContextualDetailConnections
                  columns={contextualParent.columns}
                  createRecord={createProductionTableContextualRecordAction.bind(
                    null,
                    businessSlug,
                  )}
                  loadCreateState={getProductionTableContextualRecordCreateStateAction.bind(
                    null,
                    businessSlug,
                  )}
                  parentRow={contextualParent.row}
                  searchConnectionTargets={searchProductionTableConnectionTargetsAction.bind(
                    null,
                    businessSlug,
                  )}
                  sourceViewKey={source.definition.key}
                />
              ),
            }
          : {})}
      />
      <RecordLocationAvailability
        businessId={tenant.business.id}
        businessSlug={businessSlug}
        screenSlug={screenSlug}
        recordId={record.id}
        objectDefinitionId={detail.object.id}
      />
    </section>
  );
}
