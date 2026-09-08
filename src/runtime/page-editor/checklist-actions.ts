"use server";

import { z } from "zod";

import { resolveTenant } from "../../auth/authorization";
import { walkPageBlocks } from "../../core/experience/page-blocks";
import { createExperienceService } from "../../core/experience/service";
import { createGraphService } from "../../core/graph/service";
import { createServerClient } from "../../db/supabase/server";
import type { EditorRow } from "../editor-kernel/contracts";
import {
  normalizeTableViewConfig,
  type PageBlock,
  type PageLayout,
} from "../../core/experience/schemas";
import { updateProductionTableCellAction } from "../editor-kernel/production/production-table-actions";
import {
  mapExperienceViewBundleToEditorTable,
  mapProductionRecordToEditorRow,
} from "../editor-kernel/production/table-mapper";
import type {
  ProductionActionResult,
  ProductionCellEditInput,
} from "../editor-kernel/production/action-types";
import {
  buildConfiguredSubmission,
  ExperienceSubmissionError,
} from "../forms/submission";
import { getDirectTableRowCreationAvailability } from "../views/direct-table-record-service";

const businessSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const pageKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_]*$/);
const viewKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_]*$/);
const blockIdSchema = z.string().trim().min(1).max(120);

type ChecklistBoundaryRequest = {
  businessSlug: string;
  pageKey: string;
  viewKey: string;
  blockId: string;
};

function blockAtPath(layout: PageLayout, path: string): PageBlock | null {
  const indexes = path.split(".").map((value) => Number(value));
  if (
    indexes.length === 0 ||
    indexes.some((value) => !Number.isSafeInteger(value) || value < 0)
  ) {
    return null;
  }
  let blocks: readonly PageBlock[] = layout.blocks;
  let block: PageBlock | undefined;
  for (const index of indexes) {
    block = blocks[index];
    if (!block) return null;
    if (block.type !== "collapsible" && index !== indexes.at(-1)) {
      return null;
    }
    blocks = block.type === "collapsible" ? block.blocks : [];
  }
  return block ?? null;
}

async function assertWritableChecklist(
  request: ChecklistBoundaryRequest,
  fieldKey?: string,
): Promise<{
  businessId: string;
  businessSlug: string;
  checklist: { completed_field: string; label_field: string };
  table: ReturnType<typeof mapExperienceViewBundleToEditorTable>["table"];
  view: Awaited<
    ReturnType<ReturnType<typeof createExperienceService>["loadView"]>
  >;
  viewKey: string;
}> {
  const businessSlug = businessSlugSchema.parse(request.businessSlug);
  const pageKey = pageKeySchema.parse(request.pageKey);
  const viewKey = viewKeySchema.parse(request.viewKey);
  const blockId = blockIdSchema.parse(request.blockId);
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  const experience = createExperienceService(supabase, {
    businessId: tenant.business.id,
  });
  const page = await experience.loadPageByKey(pageKey, "internal");
  const blocks = walkPageBlocks(page.layout).filter(
    (block) =>
      block.type === "view" &&
      block.view_key === viewKey &&
      block.checklist !== undefined,
  );
  const block =
    blocks.find((candidate) => "id" in candidate && candidate.id === blockId) ??
    (blockId.startsWith("page-block:")
      ? blockAtPath(page.layout, blockId.slice("page-block:".length))
      : null);
  if (
    !block ||
    block.type !== "view" ||
    block.view_key !== viewKey ||
    !block.checklist ||
    block.read_only
  ) {
    throw new Error("This checklist is read-only or no longer available.");
  }
  if (
    fieldKey &&
    fieldKey !== block.checklist?.label_field &&
    fieldKey !== block.checklist?.completed_field
  ) {
    throw new Error("Only checklist fields can be changed from this Page.");
  }
  const view = await experience.loadView(viewKey, "internal");
  const viewConfig = normalizeTableViewConfig(view.config);
  let editFormFieldKeys: readonly string[] | undefined;
  if (viewConfig.edit_form_key) {
    const form = await experience.loadForm(
      viewConfig.edit_form_key,
      "internal",
    );
    if (
      form.definition.mode !== "edit" ||
      form.definition.business_id !== tenant.business.id ||
      form.definition.object_definition_id !==
        view.definition.object_definition_id
    ) {
      throw new Error("This checklist's edit screen is not available.");
    }
    editFormFieldKeys = form.config.fields
      .filter((field) => !field.hidden)
      .map((field) => field.field);
  }
  const mapped = mapExperienceViewBundleToEditorTable({
    bundle: view,
    editFormFieldKeys,
  });
  const recordColumns = mapped.table.recordColumns ?? mapped.table.columns;
  for (const key of [
    block.checklist.label_field,
    block.checklist.completed_field,
  ]) {
    const column = recordColumns.find((candidate) => candidate.key === key);
    if (!column || column.editable === false) {
      throw new Error("This checklist field cannot be edited from this Page.");
    }
  }
  return {
    businessId: tenant.business.id,
    businessSlug,
    checklist: block.checklist,
    table: mapped.table,
    view,
    viewKey,
  };
}

export async function updatePageChecklistCellAction(
  businessSlug: string,
  pageKey: string,
  viewKey: string,
  blockId: string,
  input: ProductionCellEditInput,
): Promise<ProductionActionResult<EditorRow>> {
  try {
    const trusted = await assertWritableChecklist(
      { blockId, businessSlug, pageKey, viewKey },
      input.fieldKey,
    );
    return updateProductionTableCellAction(
      trusted.businessSlug,
      trusted.viewKey,
      {
        fieldKey: input.fieldKey,
        recordId: input.recordId,
        value: input.value,
      },
    );
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "This checklist could not be updated safely.",
    };
  }
}

export async function createPageChecklistRowAction(
  businessSlug: string,
  pageKey: string,
  viewKey: string,
  blockId: string,
  input: { labelValue: string },
): Promise<ProductionActionResult<EditorRow>> {
  try {
    const labelValue = z
      .string()
      .trim()
      .min(1)
      .max(200)
      .parse(input.labelValue);
    const trusted = await assertWritableChecklist({
      blockId,
      businessSlug,
      pageKey,
      viewKey,
    });
    const availability = await getDirectTableRowCreationAvailability(
      await createServerClient(),
      { businessId: trusted.businessId },
      trusted.viewKey,
    );
    const primary = trusted.table.recordColumns?.find(
      (column) => column.key === trusted.table.primaryColumnKey,
    );
    if (
      availability.kind !== "direct" ||
      !primary ||
      primary.editable === false
    ) {
      throw new ExperienceSubmissionError(
        "This checklist uses a configured creation screen. Open the Table to add an item.",
      );
    }

    const selectedKeys = [
      trusted.table.primaryColumnKey,
      trusted.checklist.label_field,
      trusted.checklist.completed_field,
    ].filter((key, index, keys) => keys.indexOf(key) === index);
    const selectedFields = trusted.view.fields.filter(
      (field) => field.is_active && selectedKeys.includes(field.key),
    );
    if (selectedFields.length !== selectedKeys.length) {
      throw new Error("This checklist field is no longer available.");
    }
    const formData = new FormData();
    formData.set(trusted.table.primaryColumnKey, labelValue);
    formData.set(trusted.checklist.label_field, labelValue);
    formData.set(trusted.checklist.completed_field, "false");
    const data = buildConfiguredSubmission(
      selectedFields,
      {
        fields: selectedKeys.map((field) => ({ field, hidden: false })),
      },
      "create",
      formData,
      {},
      { enforceRequired: false },
    );
    const record = await createGraphService(await createServerClient(), {
      businessId: trusted.businessId,
    }).createRecord({
      data,
      objectDefinitionId: trusted.view.definition.object_definition_id,
    });
    return {
      status: "success",
      value: mapProductionRecordToEditorRow(trusted.table, record),
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "This checklist item could not be created safely.",
    };
  }
}
