import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { hasCapability } from "../../../../../auth/capabilities";
import { resolveTenant } from "../../../../../auth/authorization";
import { Notice } from "../../../../../components/notice";
import { loadDirectPageConfiguration } from "../../../../../core/configuration/direct-pages/service";
import {
  createExperienceService,
  type ExperienceFormBundle,
  type ExperienceViewBundle,
} from "../../../../../core/experience/service";
import type { TableViewConfig } from "../../../../../core/experience/schemas";
import { createServerClient } from "../../../../../db/supabase/server";
import {
  readSearchParam,
  type SearchParams,
} from "../../../../../lib/search-params";
import { saveExperienceForm } from "../../../../../runtime/forms/actions";
import {
  mapExperienceViewBundleToEditorTable,
  ProductionTableMappingError,
} from "../../../../../runtime/editor-kernel/production/table-mapper";
import {
  addProductionTableColumnAction,
  createProductionTableRowAction,
  readProductionTableRecordAction,
  renameProductionTableAction,
  renameProductionTableColumnAction,
  reorderProductionTableColumnsAction,
  updateProductionTableCellAction,
  updateProductionTableColumnOptionsAction,
} from "../../../../../runtime/editor-kernel/production/production-table-actions";
import { getDirectTableRowCreationAvailability } from "../../../../../runtime/views/direct-table-record-service";
import {
  savePageLayoutAction,
  renamePageAction,
} from "../../../../../runtime/pages/direct-actions";
import {
  PageEditor,
  type PageEditorProps,
} from "../../../../../runtime/page-editor/page-editor";
import { PageRenderer } from "../../../../../runtime/pages/page-renderer";
import { updateInlineRecordCell } from "../../../../../runtime/views/actions";
import type { EditorCapabilities } from "../../../../../runtime/editor-kernel/contracts";
import type { PageEditorViewEmbed } from "../../../../../runtime/page-editor/extensions";

interface InternalPageProps {
  params: Promise<{ businessSlug: string; pageSlug: string }>;
  searchParams: SearchParams;
}

function rowCreationCapabilities(
  availability: Awaited<
    ReturnType<typeof getDirectTableRowCreationAvailability>
  >,
  primaryEditable: boolean,
): Pick<EditorCapabilities, "rowCreation" | "rowCreationMessage"> {
  if (availability.kind === "direct" && primaryEditable) {
    return { rowCreation: "direct" };
  }
  if (availability.kind === "configured_form") {
    return {
      rowCreation: "configured_form",
      rowCreationMessage:
        "Use the configured creation screen to add a new record.",
    };
  }
  return {
    rowCreation: "unavailable",
    rowCreationMessage:
      availability.kind === "unavailable"
        ? availability.message
        : "The primary property cannot be edited directly on this Page.",
  };
}

export default async function InternalPage({
  params,
  searchParams,
}: Readonly<InternalPageProps>): Promise<ReactNode> {
  const { businessSlug, pageSlug } = await params;
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  const experience = createExperienceService(supabase, {
    businessId: tenant.business.id,
  });
  const canEdit = hasCapability(tenant.membership.role, "manage_configuration");
  const [error, message] = await Promise.all([
    readSearchParam(searchParams, "error"),
    readSearchParam(searchParams, "message"),
  ]);

  const { page, views, forms, navigation } = await (async () => {
    try {
      const page = await experience.loadPage(pageSlug, "internal");
      const navigation = await experience.listNavigation();
      const referencedViewKeys = page.layout.blocks.flatMap((block) =>
        block.type === "view" ? [block.view_key] : [],
      );
      const viewKeys = [
        ...new Set([
          ...referencedViewKeys,
          ...(canEdit
            ? navigation.views
                .filter((view) => view.view_type === "table")
                .map((view) => view.key)
            : []),
        ]),
      ];
      const formKeys = [
        ...new Set(
          page.layout.blocks.flatMap((block) =>
            block.type === "form" ? [block.form_key] : [],
          ),
        ),
      ];
      const [viewResults, formResults] = await Promise.all([
        Promise.allSettled(
          viewKeys.map(
            async (key) => [key, await experience.loadView(key)] as const,
          ),
        ),
        Promise.allSettled(
          formKeys.map(
            async (key) => [key, await experience.loadForm(key)] as const,
          ),
        ),
      ]);
      const views: Record<string, ExperienceViewBundle> = {};
      for (const result of viewResults) {
        if (result.status === "fulfilled")
          views[result.value[0]] = result.value[1];
      }
      const forms: Record<
        string,
        {
          bundle: ExperienceFormBundle;
          action: (formData: FormData) => Promise<never>;
        }
      > = {};
      const pagePath = `/app/${businessSlug}/pages/${pageSlug}`;
      for (const result of formResults) {
        if (result.status === "fulfilled") {
          const [key, bundle] = result.value;
          forms[key] = {
            bundle,
            action: saveExperienceForm.bind(
              null,
              businessSlug,
              key,
              null,
              pagePath,
              pagePath,
            ),
          };
        }
      }
      return { forms, navigation, page, views };
    } catch {
      notFound();
    }
  })();

  if (!canEdit) {
    return (
      <section className="tenant-content runtime-page">
        <header className="page-preview-header">
          <div>
            <p className="eyebrow">Workspace page</p>
            <h1 className="runtime-title">{page.definition.title}</h1>
          </div>
          {page.definition.status === "draft" ? (
            <span className="draft-badge">Draft</span>
          ) : null}
        </header>
        {error ? <Notice kind="error">{error}</Notice> : null}
        {message ? <Notice kind="message">{message}</Notice> : null}
        <PageRenderer
          businessSlug={businessSlug}
          forms={forms}
          inlineEditAction={updateInlineRecordCell.bind(null, businessSlug)}
          layout={page.layout}
          views={views}
        />
      </section>
    );
  }

  const directConfiguration = await loadDirectPageConfiguration(supabase, {
    businessId: tenant.business.id,
    actorId: tenant.user.id,
  });
  const editorViews: Record<string, PageEditorViewEmbed> = {};
  for (const [key, bundle] of Object.entries(views)) {
    if (bundle.definition.view_type !== "table") {
      editorViews[key] = { bundle };
      continue;
    }
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
        key,
      );
      const primary = mapped.table.columns.find(
        (column) => column.key === mapped.table.primaryColumnKey,
      );
      const capabilities: EditorCapabilities = {
        ...rowCreationCapabilities(availability, primary?.editable !== false),
        canAddColumns: false,
        canRenameColumns: false,
        canUpdateColumnOptions: false,
        canReorderColumns: false,
        canResizeColumns: false,
        canRenameTable: false,
      };
      editorViews[key] = {
        bundle,
        table: {
          table: mapped.table,
          capabilities,
          actions: {
            addColumn: addProductionTableColumnAction.bind(
              null,
              businessSlug,
              key,
            ),
            createRow: createProductionTableRowAction.bind(
              null,
              businessSlug,
              key,
            ),
            openRecord: readProductionTableRecordAction.bind(
              null,
              businessSlug,
              key,
            ),
            renameColumn: renameProductionTableColumnAction.bind(
              null,
              businessSlug,
              key,
            ),
            renameTable: renameProductionTableAction.bind(
              null,
              businessSlug,
              key,
            ),
            reorderColumns: reorderProductionTableColumnsAction.bind(
              null,
              businessSlug,
              key,
            ),
            updateCell: updateProductionTableCellAction.bind(
              null,
              businessSlug,
              key,
            ),
            updateColumnOptions: updateProductionTableColumnOptionsAction.bind(
              null,
              businessSlug,
              key,
            ),
          },
        },
      };
    } catch {
      editorViews[key] = { bundle };
    }
  }

  const editorProps: PageEditorProps = {
    availableViews: navigation.views.map((view) => ({
      key: view.key,
      name: view.name,
      viewType: view.view_type,
    })),
    businessSlug,
    currentness: directConfiguration.currentness,
    layout: page.layout,
    pageKey: page.definition.key,
    renamePageAction: renamePageAction.bind(
      null,
      businessSlug,
      page.definition.key,
    ),
    savePageLayoutAction: savePageLayoutAction.bind(
      null,
      businessSlug,
      page.definition.key,
    ),
    title: page.definition.title,
    views: editorViews,
  };

  return (
    <section className="tenant-content runtime-page">
      {error ? <Notice kind="error">{error}</Notice> : null}
      {message ? <Notice kind="message">{message}</Notice> : null}
      <PageEditor {...editorProps} />
    </section>
  );
}
