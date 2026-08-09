import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { z } from "zod";

import { hasCapability } from "../../../../../auth/capabilities";
import { resolveTenant } from "../../../../../auth/authorization";
import { Notice } from "../../../../../components/notice";
import { loadDirectTableConfiguration } from "../../../../../core/configuration/direct-tables/service";
import { createExperienceService } from "../../../../../core/experience/service";
import { createServerClient } from "../../../../../db/supabase/server";
import {
  readSearchParam,
  type SearchParams,
} from "../../../../../lib/search-params";
import { experiencePathToKey } from "../../../../../runtime/routing";
import { DirectTableWorkspace } from "../../../../../runtime/views/direct-table-workspace";
import { selectDirectTableRecord } from "../../../../../runtime/views/direct-table-state";
import { getDirectTableRowCreationAvailability } from "../../../../../runtime/views/direct-table-record-service";
import {
  addDirectTableColumnAction,
  createDirectTableRowAction,
  renameDirectTableAction,
  renameDirectTableColumnAction,
  reorderDirectTableColumnsAction,
  resizeDirectTableColumnAction,
  undoDirectTableAction,
  updateDirectTableCellAction,
  updateDirectTableOptionsAction,
} from "../../../../../runtime/views/direct-actions";
import { updateInlineRecordCell } from "../../../../../runtime/views/actions";
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
    const [recordParam, undoVersionParam] = await Promise.all([
      readSearchParam(searchParams, "record"),
      readSearchParam(searchParams, "undoVersion"),
    ]);
    const recordId =
      recordParam && z.uuid().safeParse(recordParam).success
        ? recordParam
        : null;
    const selectedRecord = selectDirectTableRecord(bundle.records, recordId);
    const canManageConfiguration = hasCapability(
      tenant.membership.role,
      "manage_configuration",
    );
    let currentness = null;
    if (canManageConfiguration) {
      try {
        currentness = (
          await loadDirectTableConfiguration(supabase, {
            businessId: tenant.business.id,
            actorId: tenant.user.id,
          })
        ).currentness;
      } catch {
        currentness = null;
      }
    }
    const rowCreation = await getDirectTableRowCreationAvailability(
      supabase,
      { businessId: tenant.business.id },
      bundle.definition.key,
    ).catch(() => ({
      kind: "unavailable" as const,
      message:
        "Add row is not available until this Table can be constructed safely.",
    }));
    const undoVersionId =
      undoVersionParam && z.uuid().safeParse(undoVersionParam).success
        ? undoVersionParam
        : null;
    const showUndo = Boolean(
      currentness && undoVersionId === currentness.expectedBaseVersionId,
    );

    return (
      <section className="tenant-content">
        {error ? <Notice kind="error">{error}</Notice> : null}
        {message ? <Notice kind="message">{message}</Notice> : null}
        <DirectTableWorkspace
          key={recordId ?? "table"}
          addColumnAction={
            canManageConfiguration
              ? addDirectTableColumnAction.bind(null, businessSlug)
              : undefined
          }
          bundle={bundle}
          businessSlug={businessSlug}
          canManageConfiguration={canManageConfiguration}
          createRowAction={createDirectTableRowAction.bind(null, businessSlug)}
          currentness={currentness}
          recordId={recordId}
          rowCreation={rowCreation}
          renameColumnAction={
            canManageConfiguration
              ? renameDirectTableColumnAction.bind(null, businessSlug)
              : undefined
          }
          renameTableAction={
            canManageConfiguration
              ? renameDirectTableAction.bind(null, businessSlug)
              : undefined
          }
          reorderColumnsAction={
            canManageConfiguration
              ? reorderDirectTableColumnsAction.bind(null, businessSlug)
              : undefined
          }
          resizeColumnAction={
            canManageConfiguration
              ? resizeDirectTableColumnAction.bind(null, businessSlug)
              : undefined
          }
          selectedRecord={selectedRecord}
          undoAction={
            canManageConfiguration && showUndo
              ? undoDirectTableAction.bind(null, businessSlug)
              : undefined
          }
          updateCellAction={updateDirectTableCellAction.bind(
            null,
            businessSlug,
          )}
          updateOptionsAction={
            canManageConfiguration
              ? updateDirectTableOptionsAction.bind(null, businessSlug)
              : undefined
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
