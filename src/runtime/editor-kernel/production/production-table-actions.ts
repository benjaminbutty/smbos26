"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { hasCapability, resolveTenant } from "../../../auth/authorization";
import {
  DirectTableComposerError,
  directTableOwnerMessage,
} from "../../../core/configuration/direct-tables/composer";
import {
  applyDirectTableAction,
  DirectTableServiceError,
} from "../../../core/configuration/direct-tables/service";
import {
  directTableColumnTypeSchema,
  directTableCurrentnessSchema,
} from "../../../core/configuration/direct-tables/schemas";
import {
  assessDirectTableTypeCompatibility,
  directTableSettingsForTypeChange,
  directTableTypeLabel,
} from "../../../core/configuration/direct-tables/type-compatibility";
import { createExperienceService } from "../../../core/experience/service";
import type { TableViewConfig } from "../../../core/experience/schemas";
import { createServerClient } from "../../../db/supabase/server";
import type { Json } from "../../../db/supabase/database.types";
import { ExperienceSubmissionError } from "../../forms/submission";
import { experienceKeyToPath } from "../../routing";
import {
  applyProductionTableRecordCellEditValue,
  type DirectTableRecordTypedCellEditInput,
} from "../../views/inline-edit-service";
import {
  createDirectTableRow,
  getDirectTableRowCreationAvailability,
} from "../../views/direct-table-record-service";
import type { EditorRow } from "../contracts";
import type {
  ProductionActionResult,
  ProductionAddColumnInput,
  ProductionChangeColumnTypeInput,
  ProductionCellEditInput,
  ProductionConfigurationCurrentness,
  ProductionInsertColumnInput,
  ProductionPasteInput,
  ProductionPasteResult,
  ProductionRecordReadInput,
  ProductionRenameColumnInput,
  ProductionRenameTableInput,
  ProductionReorderColumnsInput,
  ProductionRowCreateInput,
  ProductionTableStructureState,
  ProductionUpdateColumnOptionsInput,
} from "./action-types";
import {
  mapExperienceViewBundleToEditorTable,
  mapProductionRecordToEditorRow,
  ProductionTableMappingError,
} from "./table-mapper";

const routeSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const viewKeySchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_]*$/);
const editorValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);
const optionsSchema = z
  .array(z.string().trim().min(1).max(120))
  .min(2)
  .max(100)
  .superRefine((options, context) => {
    const normalized = options.map((option) =>
      option.normalize("NFKC").toLocaleLowerCase("en"),
    );
    if (new Set(normalized).size !== normalized.length) {
      context.addIssue({
        code: "custom",
        message: "Options must be different.",
      });
    }
  });
const structureCurrentnessSchema = directTableCurrentnessSchema;
const cellInputSchema = z
  .object({
    recordId: z.uuid(),
    fieldKey: viewKeySchema,
    value: editorValueSchema,
  })
  .strict();
const rowInputSchema = z
  .object({
    primaryValue: z.string().trim().min(1).max(1_000),
  })
  .strict();
const recordInputSchema = z.object({ recordId: z.uuid() }).strict();
const addColumnInputSchema = z
  .object({
    currentness: structureCurrentnessSchema,
    label: z.string().trim().min(1).max(120),
    columnType: directTableColumnTypeSchema,
    options: optionsSchema.optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const optionColumn =
      input.columnType === "select" || input.columnType === "status";
    if (optionColumn !== Boolean(input.options)) {
      context.addIssue({
        code: "custom",
        message: optionColumn
          ? "Choice and Status columns need options."
          : "Only Choice and Status columns can have options.",
        path: ["options"],
      });
    }
    if (input.columnType !== "currency" && input.currency !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Currency metadata is only valid for Currency columns.",
        path: ["currency"],
      });
    }
    if (input.columnType === "currency" && input.currency === undefined) {
      context.addIssue({
        code: "custom",
        message: "Currency columns need a currency code.",
        path: ["currency"],
      });
    }
  });
const insertColumnInputSchema = z
  .object({
    currentness: structureCurrentnessSchema,
    anchorFieldKey: viewKeySchema,
    position: z.enum(["left", "right"]),
    label: z.string().trim().min(1).max(120),
    columnType: directTableColumnTypeSchema,
    options: optionsSchema.optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const optionColumn =
      input.columnType === "select" || input.columnType === "status";
    if (optionColumn !== Boolean(input.options)) {
      context.addIssue({
        code: "custom",
        message: optionColumn
          ? "Choice and Status columns need options."
          : "Only Choice and Status columns can have options.",
        path: ["options"],
      });
    }
    if (input.columnType !== "currency" && input.currency !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Currency metadata is only valid for Currency columns.",
        path: ["currency"],
      });
    }
    if (input.columnType === "currency" && input.currency === undefined) {
      context.addIssue({
        code: "custom",
        message: "Currency columns need a currency code.",
        path: ["currency"],
      });
    }
  });
const renameColumnInputSchema = z
  .object({
    currentness: structureCurrentnessSchema,
    fieldKey: viewKeySchema,
    label: z.string().trim().min(1).max(120),
  })
  .strict();
const changeColumnTypeInputSchema = z
  .object({
    currentness: structureCurrentnessSchema,
    fieldKey: viewKeySchema,
    columnType: directTableColumnTypeSchema,
    options: optionsSchema.optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const optionColumn =
      input.columnType === "select" || input.columnType === "status";
    if (optionColumn !== Boolean(input.options)) {
      context.addIssue({
        code: "custom",
        message: optionColumn
          ? "Choice and Status columns need options."
          : "Only Choice and Status columns can have options.",
        path: ["options"],
      });
    }
    if (input.columnType !== "currency" && input.currency !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Currency metadata is only valid for Currency columns.",
        path: ["currency"],
      });
    }
    if (input.columnType === "currency" && input.currency === undefined) {
      context.addIssue({
        code: "custom",
        message: "Currency columns need a currency code.",
        path: ["currency"],
      });
    }
  });
const updateColumnOptionsInputSchema = z
  .object({
    currentness: structureCurrentnessSchema,
    fieldKey: viewKeySchema,
    options: optionsSchema,
  })
  .strict();
const reorderColumnsInputSchema = z
  .object({
    currentness: structureCurrentnessSchema,
    fieldKeys: z.array(viewKeySchema).min(1).max(50),
  })
  .strict();
const renameTableInputSchema = z
  .object({
    currentness: structureCurrentnessSchema,
    title: z.string().trim().min(1).max(120),
  })
  .strict();
const pasteInputSchema = z
  .object({
    rows: z
      .array(
        z
          .object({
            recordId: z.uuid().optional(),
            values: z.record(viewKeySchema, editorValueSchema),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((input, context) => {
    const cellCount = input.rows.reduce(
      (count, row) => count + Object.keys(row.values).length,
      0,
    );
    if (cellCount > 500) {
      context.addIssue({
        code: "custom",
        message: "Paste is limited to 500 cells.",
        path: ["rows"],
      });
    }
  });
const pasteResponseSchema = z
  .object({
    recordIds: z.array(z.uuid()).max(100),
    failures: z.array(
      z
        .object({
          rowIndex: z.number().int().nonnegative(),
          fieldKey: viewKeySchema.optional(),
          message: z.string().min(1).max(500),
        })
        .strict(),
    ),
  })
  .strict();

function resultError(message: string): ProductionActionResult<never> {
  return { status: "error", message };
}

function safeError(error: unknown): string {
  if (error instanceof DirectTableComposerError) {
    return directTableOwnerMessage(error.code);
  }
  if (error instanceof DirectTableServiceError) {
    return error.code === "direct_configuration_stale"
      ? "Table changed. Try again."
      : error.message;
  }
  if (error instanceof ExperienceSubmissionError) {
    return error.message;
  }
  if (error instanceof ProductionTableMappingError) {
    return error.message;
  }
  if (error instanceof z.ZodError) {
    return "That Table value is no longer available.";
  }
  return "That Table operation could not be completed safely. Reload and try again.";
}

function hasConfigurationCapability(businessRole: string): boolean {
  return hasCapability(
    businessRole as Parameters<typeof hasCapability>[0],
    "manage_configuration",
  );
}

function routePath(businessSlug: string, viewKey: string): string {
  return `/app/${encodeURIComponent(businessSlug)}/workspace/${experienceKeyToPath(viewKey)}`;
}

function recordValue(data: Json, fieldKey: string): Json | undefined {
  return typeof data === "object" && data !== null && !Array.isArray(data)
    ? data[fieldKey]
    : undefined;
}

async function assertColumnOptionsCompatible(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  businessId: string,
  viewKey: string,
  fieldKey: string,
  options: readonly string[],
): Promise<void> {
  const experience = createExperienceService(supabase, { businessId });
  const view = await experience.loadView(viewKey, "internal");
  const field = view.fields.find(
    (candidate) =>
      candidate.key === fieldKey &&
      candidate.business_id === businessId &&
      candidate.object_definition_id === view.definition.object_definition_id &&
      candidate.is_active,
  );
  if (
    !field ||
    (field.field_type !== "select" && field.field_type !== "status")
  ) {
    return;
  }

  const { data: records, error } = await supabase
    .from("records")
    .select("data_json")
    .eq("business_id", businessId)
    .eq("object_definition_id", view.definition.object_definition_id);
  if (error || !records) {
    throw new ExperienceSubmissionError(
      "Could not check existing Record values safely.",
    );
  }

  const allowed = new Set(options);
  for (const record of records) {
    const value = recordValue(record.data_json, fieldKey);
    if (
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "")
    ) {
      continue;
    }
    if (typeof value !== "string" || !allowed.has(value)) {
      throw new ExperienceSubmissionError(
        "That option is already used by a Record. Keep it or update those Records first.",
      );
    }
  }
}

type StructuralPreflight = (
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  businessId: string,
) => Promise<void>;

async function loadMappedTable(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  businessId: string,
  viewKey: string,
) {
  const experience = createExperienceService(supabase, { businessId });
  const bundle = await experience.loadView(viewKey, "internal");
  const config = bundle.config as TableViewConfig;
  let editFormFieldKeys: readonly string[] | undefined;
  if (config.edit_form_key) {
    const form = await experience.loadForm(config.edit_form_key, "internal");
    if (
      form.definition.mode !== "edit" ||
      form.definition.business_id !== bundle.definition.business_id ||
      form.definition.object_definition_id !==
        bundle.definition.object_definition_id
    ) {
      throw new ExperienceSubmissionError(
        "This Table's edit screen is not available.",
      );
    }
    editFormFieldKeys = form.config.fields
      .filter((field) => !field.hidden)
      .map((field) => field.field);
  }
  return mapExperienceViewBundleToEditorTable({
    bundle,
    editFormFieldKeys,
  });
}

async function applyProductionStructuralAction(
  businessSlug: string,
  viewKey: string,
  currentness: ProductionConfigurationCurrentness,
  intent: unknown,
  preflight?: StructuralPreflight,
): Promise<ProductionActionResult<ProductionTableStructureState>> {
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  if (!hasConfigurationCapability(tenant.membership.role)) {
    return resultError("Owner or Admin access is required for Table changes.");
  }

  try {
    await preflight?.(supabase, tenant.business.id);
    const applied = await applyDirectTableAction(
      supabase,
      { businessId: tenant.business.id, actorId: tenant.user.id },
      { currentness, intent },
    );
    const mapped = await loadMappedTable(supabase, tenant.business.id, viewKey);
    revalidatePath(routePath(businessSlug, viewKey), "page");
    revalidatePath(`/app/${businessSlug}`, "layout");
    return {
      status: "success",
      value: {
        table: mapped.table,
        currentness: applied.currentness,
      },
    };
  } catch (error) {
    return resultError(safeError(error));
  }
}

function structureContext(
  businessSlugInput: string,
  viewKeyInput: string,
): { businessSlug: string; viewKey: string } | null {
  const businessSlug = routeSlugSchema.safeParse(businessSlugInput);
  const viewKey = viewKeySchema.safeParse(viewKeyInput);
  return businessSlug.success && viewKey.success
    ? { businessSlug: businessSlug.data, viewKey: viewKey.data }
    : null;
}

export async function addProductionTableColumnAction(
  businessSlugInput: string,
  viewKeyInput: string,
  input: ProductionAddColumnInput,
): Promise<ProductionActionResult<ProductionTableStructureState>> {
  const context = structureContext(businessSlugInput, viewKeyInput);
  const parsed = addColumnInputSchema.safeParse(input);
  if (!context || !parsed.success) {
    return resultError("That Table change could not be completed safely.");
  }
  return applyProductionStructuralAction(
    context.businessSlug,
    context.viewKey,
    parsed.data.currentness,
    {
      action: "add_column",
      viewKey: context.viewKey,
      label: parsed.data.label,
      columnType: parsed.data.columnType,
      ...(parsed.data.options ? { options: parsed.data.options } : {}),
      ...(parsed.data.currency ? { currency: parsed.data.currency } : {}),
    },
  );
}

export async function insertProductionTableColumnAction(
  businessSlugInput: string,
  viewKeyInput: string,
  input: ProductionInsertColumnInput,
): Promise<ProductionActionResult<ProductionTableStructureState>> {
  const context = structureContext(businessSlugInput, viewKeyInput);
  const parsed = insertColumnInputSchema.safeParse(input);
  if (!context || !parsed.success) {
    return resultError("That Table change could not be completed safely.");
  }
  return applyProductionStructuralAction(
    context.businessSlug,
    context.viewKey,
    parsed.data.currentness,
    {
      action: "insert_column",
      viewKey: context.viewKey,
      anchorFieldKey: parsed.data.anchorFieldKey,
      position: parsed.data.position,
      label: parsed.data.label,
      columnType: parsed.data.columnType,
      ...(parsed.data.options ? { options: parsed.data.options } : {}),
      ...(parsed.data.currency ? { currency: parsed.data.currency } : {}),
    },
  );
}

export async function renameProductionTableColumnAction(
  businessSlugInput: string,
  viewKeyInput: string,
  input: ProductionRenameColumnInput,
): Promise<ProductionActionResult<ProductionTableStructureState>> {
  const context = structureContext(businessSlugInput, viewKeyInput);
  const parsed = renameColumnInputSchema.safeParse(input);
  if (!context || !parsed.success) {
    return resultError("That Table change could not be completed safely.");
  }
  return applyProductionStructuralAction(
    context.businessSlug,
    context.viewKey,
    parsed.data.currentness,
    {
      action: "rename_column",
      viewKey: context.viewKey,
      fieldKey: parsed.data.fieldKey,
      label: parsed.data.label,
    },
  );
}

async function assertColumnTypeCompatible(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  businessId: string,
  viewKey: string,
  fieldKey: string,
  targetType: ProductionChangeColumnTypeInput["columnType"],
  options: readonly string[] | undefined,
  currency: string | undefined,
): Promise<void> {
  const experience = createExperienceService(supabase, { businessId });
  const view = await experience.loadView(viewKey, "internal");
  const field = view.fields.find(
    (candidate) =>
      candidate.key === fieldKey &&
      candidate.business_id === businessId &&
      candidate.object_definition_id === view.definition.object_definition_id &&
      candidate.is_active,
  );
  if (!field) {
    throw new ExperienceSubmissionError(
      "That property is no longer available. Reload and try again.",
    );
  }

  const targetSettings = directTableSettingsForTypeChange(
    targetType,
    field.settings_json,
    options,
    currency,
  );
  const { data: records, error } = await supabase
    .from("records")
    .select("data_json")
    .eq("business_id", businessId)
    .eq("object_definition_id", view.definition.object_definition_id);
  if (error || !records) {
    throw new ExperienceSubmissionError(
      "Could not check existing Record values safely.",
    );
  }
  const result = assessDirectTableTypeCompatibility({
    from: field.field_type,
    to: targetType,
    settings: targetSettings,
    values: [
      field.default_value,
      ...records.map((record) => recordValue(record.data_json, fieldKey)),
    ],
  });
  if (!result.compatible) {
    const count = result.incompatibleCount;
    throw new ExperienceSubmissionError(
      `That property contains ${count} value${count === 1 ? "" : "s"} that do not fit ${directTableTypeLabel(targetType)}. Nothing was changed.`,
    );
  }
}

export async function changeProductionTableColumnTypeAction(
  businessSlugInput: string,
  viewKeyInput: string,
  input: ProductionChangeColumnTypeInput,
): Promise<ProductionActionResult<ProductionTableStructureState>> {
  const context = structureContext(businessSlugInput, viewKeyInput);
  const parsed = changeColumnTypeInputSchema.safeParse(input);
  if (!context || !parsed.success) {
    return resultError("That Table change could not be completed safely.");
  }
  return applyProductionStructuralAction(
    context.businessSlug,
    context.viewKey,
    parsed.data.currentness,
    {
      action: "change_column_type",
      viewKey: context.viewKey,
      fieldKey: parsed.data.fieldKey,
      columnType: parsed.data.columnType,
      ...(parsed.data.options ? { options: parsed.data.options } : {}),
      ...(parsed.data.currency ? { currency: parsed.data.currency } : {}),
    },
    (supabase, businessId) =>
      assertColumnTypeCompatible(
        supabase,
        businessId,
        context.viewKey,
        parsed.data.fieldKey,
        parsed.data.columnType,
        parsed.data.options,
        parsed.data.currency,
      ),
  );
}

export async function updateProductionTableColumnOptionsAction(
  businessSlugInput: string,
  viewKeyInput: string,
  input: ProductionUpdateColumnOptionsInput,
): Promise<ProductionActionResult<ProductionTableStructureState>> {
  const context = structureContext(businessSlugInput, viewKeyInput);
  const parsed = updateColumnOptionsInputSchema.safeParse(input);
  if (!context || !parsed.success) {
    return resultError("That Table change could not be completed safely.");
  }
  return applyProductionStructuralAction(
    context.businessSlug,
    context.viewKey,
    parsed.data.currentness,
    {
      action: "update_column_options",
      viewKey: context.viewKey,
      fieldKey: parsed.data.fieldKey,
      options: parsed.data.options,
    },
    (supabase, businessId) =>
      assertColumnOptionsCompatible(
        supabase,
        businessId,
        context.viewKey,
        parsed.data.fieldKey,
        parsed.data.options,
      ),
  );
}

export async function reorderProductionTableColumnsAction(
  businessSlugInput: string,
  viewKeyInput: string,
  input: ProductionReorderColumnsInput,
): Promise<ProductionActionResult<ProductionTableStructureState>> {
  const context = structureContext(businessSlugInput, viewKeyInput);
  const parsed = reorderColumnsInputSchema.safeParse(input);
  if (!context || !parsed.success) {
    return resultError("That Table change could not be completed safely.");
  }
  return applyProductionStructuralAction(
    context.businessSlug,
    context.viewKey,
    parsed.data.currentness,
    {
      action: "reorder_columns",
      viewKey: context.viewKey,
      fieldKeys: parsed.data.fieldKeys,
    },
  );
}

export async function renameProductionTableAction(
  businessSlugInput: string,
  viewKeyInput: string,
  input: ProductionRenameTableInput,
): Promise<ProductionActionResult<ProductionTableStructureState>> {
  const context = structureContext(businessSlugInput, viewKeyInput);
  const parsed = renameTableInputSchema.safeParse(input);
  if (!context || !parsed.success) {
    return resultError("That Table change could not be completed safely.");
  }
  return applyProductionStructuralAction(
    context.businessSlug,
    context.viewKey,
    parsed.data.currentness,
    {
      action: "rename_table",
      viewKey: context.viewKey,
      title: parsed.data.title,
    },
  );
}

export async function updateProductionTableCellAction(
  businessSlugInput: string,
  viewKeyInput: string,
  input: ProductionCellEditInput,
): Promise<ProductionActionResult<EditorRow>> {
  const businessSlug = routeSlugSchema.parse(businessSlugInput);
  const viewKey = viewKeySchema.parse(viewKeyInput);
  const parsed = cellInputSchema.parse(input);
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);

  try {
    const mapped = await loadMappedTable(supabase, tenant.business.id, viewKey);
    const cellInput: DirectTableRecordTypedCellEditInput = {
      viewKey,
      recordId: parsed.recordId,
      fieldKey: parsed.fieldKey,
      value: parsed.value,
    };
    const record = await applyProductionTableRecordCellEditValue(
      supabase,
      { businessId: tenant.business.id },
      cellInput,
    );
    revalidatePath(routePath(businessSlug, viewKey), "page");
    return {
      status: "success",
      value: mapProductionRecordToEditorRow(mapped.table, record),
    };
  } catch (error) {
    return resultError(safeError(error));
  }
}

export async function pasteProductionTableAction(
  businessSlugInput: string,
  viewKeyInput: string,
  input: ProductionPasteInput,
): Promise<ProductionActionResult<ProductionPasteResult>> {
  const businessSlug = routeSlugSchema.parse(businessSlugInput);
  const viewKey = viewKeySchema.parse(viewKeyInput);
  const parsed = pasteInputSchema.safeParse(input);
  if (!parsed.success) {
    return resultError("Paste is limited to 500 cells and 100 records.");
  }
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);

  try {
    const mapped = await loadMappedTable(supabase, tenant.business.id, viewKey);
    const { data, error } = await supabase.rpc(
      "apply_direct_table_record_batch",
      {
        expected_business_id: tenant.business.id,
        requested_view_key: viewKey,
        requested_rows: parsed.data.rows,
      },
    );
    if (error || data === null) {
      throw new ExperienceSubmissionError(
        "That paste could not be applied safely. Nothing was changed.",
      );
    }
    const response = pasteResponseSchema.parse(data);
    const { data: records, error: recordsError } = await supabase
      .from("records")
      .select("*")
      .eq("business_id", tenant.business.id)
      .in("id", response.recordIds);
    if (recordsError || !records) {
      throw new ExperienceSubmissionError(
        "Paste was saved, but the updated Records could not be reloaded.",
      );
    }
    revalidatePath(routePath(businessSlug, viewKey), "page");
    return {
      status: "success",
      value: {
        rows: records.map((record) =>
          mapProductionRecordToEditorRow(mapped.table, record),
        ),
        failures: response.failures.map((failure) =>
          failure.fieldKey
            ? {
                rowIndex: failure.rowIndex,
                fieldKey: failure.fieldKey,
                message: failure.message,
              }
            : { rowIndex: failure.rowIndex, message: failure.message },
        ),
      },
    };
  } catch (error) {
    return resultError(safeError(error));
  }
}

export async function createProductionTableRowAction(
  businessSlugInput: string,
  viewKeyInput: string,
  input: ProductionRowCreateInput,
): Promise<ProductionActionResult<EditorRow>> {
  const businessSlug = routeSlugSchema.parse(businessSlugInput);
  const viewKey = viewKeySchema.parse(viewKeyInput);
  const parsed = rowInputSchema.parse(input);
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);

  try {
    const mapped = await loadMappedTable(supabase, tenant.business.id, viewKey);
    const availability = await getDirectTableRowCreationAvailability(
      supabase,
      { businessId: tenant.business.id },
      viewKey,
    );
    const primaryColumn = mapped.table.columns.find(
      (column) => column.key === mapped.table.primaryColumnKey,
    );
    if (
      availability.kind !== "direct" ||
      !primaryColumn ||
      primaryColumn.editable === false
    ) {
      return resultError(
        availability.kind === "unavailable"
          ? availability.message
          : "Use this Table's configured creation screen to add a record.",
      );
    }
    const formData = new FormData();
    formData.set(mapped.table.primaryColumnKey, parsed.primaryValue);
    const record = await createDirectTableRow(
      supabase,
      { businessId: tenant.business.id },
      { viewKey, formData },
    );
    revalidatePath(routePath(businessSlug, viewKey), "page");
    return {
      status: "success",
      value: mapProductionRecordToEditorRow(mapped.table, record),
    };
  } catch (error) {
    return resultError(safeError(error));
  }
}

export async function readProductionTableRecordAction(
  businessSlugInput: string,
  viewKeyInput: string,
  input: ProductionRecordReadInput,
): Promise<ProductionActionResult<EditorRow | null>> {
  const businessSlug = routeSlugSchema.parse(businessSlugInput);
  const viewKey = viewKeySchema.parse(viewKeyInput);
  const parsed = recordInputSchema.parse(input);
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);

  try {
    const mapped = await loadMappedTable(supabase, tenant.business.id, viewKey);
    const record = mapped.table.rows.find((row) => row.id === parsed.recordId);
    if (!record) {
      return { status: "success", value: null };
    }
    return { status: "success", value: record };
  } catch (error) {
    return resultError(safeError(error));
  }
}
