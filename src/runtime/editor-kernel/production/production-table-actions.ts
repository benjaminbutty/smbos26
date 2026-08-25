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
  loadDirectTableConfiguration,
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
import {
  normalizeTableViewConfig,
  tableViewColumnSchema,
  tableViewPropertyKeySchema,
  tableViewQuerySchema,
} from "../../../core/experience/schemas";
import { createServerClient } from "../../../db/supabase/server";
import type { Json } from "../../../db/supabase/database.types";
import {
  ExperienceSubmissionError,
  buildConfiguredSubmission,
  submitExperienceForm,
} from "../../forms/submission";
import { experienceKeyToPath } from "../../routing";
import {
  searchTableConnectionTargets,
  previewTableViewRecords,
  setTableRecordConnectionValues,
} from "../../../core/experience/table-query";
import {
  applyProductionTableRecordCellEditValue,
  type DirectTableRecordTypedCellEditInput,
} from "../../views/inline-edit-service";
import {
  createDirectTableRow,
  getDirectTableRowCreationAvailability,
} from "../../views/direct-table-record-service";
import { displayEditorValue, type EditorRow } from "../contracts";
import type {
  ProductionActionResult,
  ProductionAddColumnInput,
  ProductionAddExistingConnectionInput,
  ProductionChangeColumnTypeInput,
  ProductionCellEditInput,
  ProductionConnectionCreateInput,
  ProductionConnectionEditInput,
  ProductionConnectionSearchInput,
  ProductionContextualRecordCreateInput,
  ProductionContextualRecordCreateState,
  ProductionConfigureSavedViewInput,
  ProductionConfiguredSavedView,
  ProductionDuplicateSavedViewInput,
  ProductionArchiveSavedViewInput,
  ProductionConfigurationCurrentness,
  ProductionCreateConnectionInput,
  ProductionInsertColumnInput,
  ProductionPasteInput,
  ProductionPasteResult,
  ProductionPreviewSavedView,
  ProductionPreviewSavedViewInput,
  ProductionRecordPanelContext,
  ProductionRecordReadInput,
  ProductionRenameColumnInput,
  ProductionRenameTableInput,
  ProductionReorderColumnsInput,
  ProductionRowCreateInput,
  ProductionSavedViewQueryInput,
  ProductionTableStructureState,
  ProductionUpdateColumnOptionsInput,
} from "./action-types";
import {
  editorValueFromJson,
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
const connectionEditInputSchema = z
  .object({
    recordId: z.uuid(),
    relationshipKey: viewKeySchema,
    direction: z.enum(["source", "target"]),
    targetRecordIds: z.array(z.uuid()).max(100),
  })
  .strict();
const connectionSearchInputSchema = z
  .object({
    columnKey: z.string().min(1).max(180),
    search: z.string().max(200),
  })
  .strict();
const connectionCreateInputSchema = z
  .object({
    columnKey: z.string().min(1).max(180),
    primaryValue: z.string().trim().min(1).max(1_000),
  })
  .strict();
const contextualRecordCreateInputSchema = z
  .object({
    parentRecordId: z.uuid(),
    columnKey: z.string().min(1).max(180),
    values: z.record(z.string().min(1).max(80), editorValueSchema),
    connections: z
      .array(
        z
          .object({
            relationshipKey: viewKeySchema,
            direction: z.enum(["source", "target"]),
            targetRecordIds: z.array(z.uuid()).max(100),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
const contextualRecordStateInputSchema = contextualRecordCreateInputSchema.pick(
  {
    parentRecordId: true,
    columnKey: true,
  },
);
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
    propertyKeys: z.array(tableViewPropertyKeySchema).min(1).max(50),
  })
  .strict();
const renameTableInputSchema = z
  .object({
    currentness: structureCurrentnessSchema,
    title: z.string().trim().min(1).max(120),
  })
  .strict();
const createConnectionInputSchema = z
  .object({
    currentness: structureCurrentnessSchema,
    targetViewKey: viewKeySchema,
    label: z.string().trim().min(1).max(120),
    currentMultiplicity: z.enum(["one", "several"]),
    targetMultiplicity: z.enum(["one", "several"]),
    reverseLabel: z.string().trim().min(1).max(120).optional(),
    addReverse: z.boolean(),
  })
  .strict()
  .superRefine((input, context) => {
    if (!input.addReverse && input.reverseLabel !== undefined) {
      context.addIssue({
        code: "custom",
        message: "A hidden reverse property cannot have a name.",
        path: ["reverseLabel"],
      });
    }
  });
const addExistingConnectionInputSchema = z
  .object({
    currentness: structureCurrentnessSchema,
    relationshipKey: viewKeySchema,
    direction: z.enum(["source", "target"]),
    label: z.string().trim().min(1).max(120),
  })
  .strict();
const savedViewQueryInputSchema = z
  .object({
    currentness: structureCurrentnessSchema,
    query: tableViewQuerySchema,
  })
  .strict();
const configureSavedViewInputSchema = z
  .object({
    currentness: structureCurrentnessSchema,
    viewKey: viewKeySchema.optional(),
    name: z.string().trim().min(1).max(120),
    columns: z.array(tableViewColumnSchema).min(1).max(50),
    query: tableViewQuerySchema,
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

export async function loadMappedTable(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  businessId: string,
  viewKey: string,
) {
  const experience = createExperienceService(supabase, { businessId });
  const bundle = await experience.loadView(viewKey, "internal");
  const [tableViews, objectResult] = await Promise.all([
    experience.listTableViews(),
    supabase
      .from("object_definitions")
      .select("id,singular_label")
      .eq("business_id", businessId)
      .eq("is_active", true),
  ]);
  if (objectResult.error) {
    throw new ExperienceSubmissionError(
      "Connected Record labels are unavailable.",
    );
  }
  const targetViewKeyByObjectId = tableViews
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
  const targetObjectLabelByObjectId = (objectResult.data ?? []).reduce<
    Record<string, string>
  >((result, object) => {
    result[object.id] = object.singular_label;
    return result;
  }, {});
  const config = normalizeTableViewConfig(bundle.config);
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
    targetObjectLabelByObjectId,
    targetViewKeyByObjectId,
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

export async function createProductionTableConnectionAction(
  businessSlugInput: string,
  viewKeyInput: string,
  input: ProductionCreateConnectionInput,
): Promise<ProductionActionResult<ProductionTableStructureState>> {
  const context = structureContext(businessSlugInput, viewKeyInput);
  const parsed = createConnectionInputSchema.safeParse(input);
  if (!context || !parsed.success) {
    return resultError("That Connection could not be created safely.");
  }
  return applyProductionStructuralAction(
    context.businessSlug,
    context.viewKey,
    parsed.data.currentness,
    {
      action: "create_connection_property",
      viewKey: context.viewKey,
      targetViewKey: parsed.data.targetViewKey,
      label: parsed.data.label,
      currentMultiplicity: parsed.data.currentMultiplicity,
      targetMultiplicity: parsed.data.targetMultiplicity,
      ...(parsed.data.reverseLabel
        ? { reverseLabel: parsed.data.reverseLabel }
        : {}),
      addReverse: parsed.data.addReverse,
    },
  );
}

export async function addExistingProductionTableConnectionAction(
  businessSlugInput: string,
  viewKeyInput: string,
  input: ProductionAddExistingConnectionInput,
): Promise<ProductionActionResult<ProductionTableStructureState>> {
  const context = structureContext(businessSlugInput, viewKeyInput);
  const parsed = addExistingConnectionInputSchema.safeParse(input);
  if (!context || !parsed.success) {
    return resultError("That Connection could not be shown safely.");
  }
  return applyProductionStructuralAction(
    context.businessSlug,
    context.viewKey,
    parsed.data.currentness,
    {
      action: "add_existing_connection_property",
      viewKey: context.viewKey,
      relationshipKey: parsed.data.relationshipKey,
      direction: parsed.data.direction,
      label: parsed.data.label,
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
      propertyKeys: parsed.data.propertyKeys,
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

export async function updateProductionSavedViewQueryAction(
  businessSlugInput: string,
  viewKeyInput: string,
  input: ProductionSavedViewQueryInput,
): Promise<ProductionActionResult<ProductionTableStructureState>> {
  const context = structureContext(businessSlugInput, viewKeyInput);
  const parsed = savedViewQueryInputSchema.safeParse(input);
  if (!context || !parsed.success) {
    return resultError("That saved view query could not be saved safely.");
  }
  return applyProductionStructuralAction(
    context.businessSlug,
    context.viewKey,
    parsed.data.currentness,
    {
      action: "update_view_query",
      viewKey: context.viewKey,
      query: parsed.data.query,
    },
  );
}

export async function configureProductionSavedViewAction(
  businessSlugInput: string,
  sourceViewKeyInput: string,
  input: ProductionConfigureSavedViewInput,
): Promise<ProductionActionResult<ProductionConfiguredSavedView>> {
  const context = structureContext(businessSlugInput, sourceViewKeyInput);
  const parsed = configureSavedViewInputSchema.safeParse(input);
  if (!context || !parsed.success) {
    return resultError("That saved view could not be saved safely.");
  }
  const supabase = await createServerClient();
  const tenant = await resolveTenant(context.businessSlug, supabase);
  if (!hasConfigurationCapability(tenant.membership.role)) {
    return resultError("Owner or Admin access is required for View changes.");
  }
  try {
    const applied = await applyDirectTableAction(
      supabase,
      { businessId: tenant.business.id, actorId: tenant.user.id },
      {
        currentness: parsed.data.currentness,
        intent: {
          action: "configure_saved_view",
          sourceViewKey: context.viewKey,
          ...(parsed.data.viewKey ? { viewKey: parsed.data.viewKey } : {}),
          name: parsed.data.name,
          columns: parsed.data.columns,
          query: parsed.data.query,
        },
      },
    );
    if (!applied.composed) {
      throw new Error("The saved View result was incomplete.");
    }
    revalidatePath(routePath(context.businessSlug, context.viewKey), "page");
    revalidatePath(
      routePath(context.businessSlug, applied.composed.viewKey),
      "page",
    );
    revalidatePath(`/app/${context.businessSlug}`, "layout");
    return {
      status: "success",
      value: {
        currentness: applied.currentness,
        viewKey: applied.composed.viewKey,
      },
    };
  } catch (error) {
    return resultError(safeError(error));
  }
}

export async function previewProductionSavedViewAction(
  businessSlugInput: string,
  sourceViewKeyInput: string,
  input: ProductionPreviewSavedViewInput,
): Promise<ProductionActionResult<ProductionPreviewSavedView>> {
  const context = structureContext(businessSlugInput, sourceViewKeyInput);
  const parsed = configureSavedViewInputSchema
    .omit({ currentness: true, viewKey: true, name: true })
    .safeParse(input);
  if (!context || !parsed.success) {
    return resultError("That saved view preview is not valid.");
  }
  const supabase = await createServerClient();
  const tenant = await resolveTenant(context.businessSlug, supabase);
  if (!hasConfigurationCapability(tenant.membership.role)) {
    return resultError("Owner or Admin access is required for View previews.");
  }
  try {
    const experience = createExperienceService(supabase, {
      businessId: tenant.business.id,
    });
    const bundle = await experience.loadView(context.viewKey, "internal");
    const sourceConfig = normalizeTableViewConfig(bundle.config);
    const query = await previewTableViewRecords(
      supabase,
      tenant.business.id,
      context.viewKey,
      { ...parsed.data, limit: 100 },
    );
    const config = normalizeTableViewConfig({
      ...sourceConfig,
      role: "saved",
      columns: parsed.data.columns,
      fields: parsed.data.columns.flatMap((column) =>
        column.kind === "field" ? [column.field_key] : [],
      ),
      ...parsed.data.query,
    });
    const mapped = mapExperienceViewBundleToEditorTable({
      bundle: {
        ...bundle,
        config,
        records: query.records,
        connectionValues: query.connectionValues,
        query: {
          totalCount: query.totalCount,
          limit: query.limit,
          offset: query.offset,
          hasMore: query.hasMore,
          group: query.group,
          groups: query.groups,
        },
      },
    });
    return {
      status: "success",
      value: {
        table: {
          ...mapped.table,
          columns: mapped.table.columns.map((column) => ({
            ...column,
            editable: false,
            readOnlyReason: "Save this View before operating Records here.",
          })),
        },
        totalCount: query.totalCount,
      },
    };
  } catch (error) {
    return resultError(safeError(error));
  }
}

export async function refreshProductionTableCurrentnessAction(
  businessSlugInput: string,
  viewKeyInput: string,
): Promise<ProductionActionResult<ProductionConfigurationCurrentness>> {
  const context = structureContext(businessSlugInput, viewKeyInput);
  if (!context) return resultError("That Table is no longer available.");
  const supabase = await createServerClient();
  const tenant = await resolveTenant(context.businessSlug, supabase);
  if (!hasConfigurationCapability(tenant.membership.role)) {
    return resultError("Owner or Admin access is required for View changes.");
  }
  try {
    await createExperienceService(supabase, {
      businessId: tenant.business.id,
    }).loadView(context.viewKey, "internal");
    const configuration = await loadDirectTableConfiguration(supabase, {
      businessId: tenant.business.id,
      actorId: tenant.user.id,
    });
    return { status: "success", value: configuration.currentness };
  } catch (error) {
    return resultError(safeError(error));
  }
}

async function applySavedViewManagementAction(
  businessSlugInput: string,
  viewKeyInput: string,
  currentness: ProductionConfigurationCurrentness,
  intent: unknown,
): Promise<ProductionActionResult<ProductionConfiguredSavedView>> {
  const context = structureContext(businessSlugInput, viewKeyInput);
  if (!context) return resultError("That saved view is no longer available.");
  const supabase = await createServerClient();
  const tenant = await resolveTenant(context.businessSlug, supabase);
  if (!hasConfigurationCapability(tenant.membership.role)) {
    return resultError("Owner or Admin access is required for View changes.");
  }
  try {
    const applied = await applyDirectTableAction(
      supabase,
      { businessId: tenant.business.id, actorId: tenant.user.id },
      { currentness, intent },
    );
    if (!applied.composed)
      throw new Error("The saved View result was incomplete.");
    revalidatePath(`/app/${context.businessSlug}`, "layout");
    return {
      status: "success",
      value: {
        currentness: applied.currentness,
        viewKey: applied.composed.viewKey,
      },
    };
  } catch (error) {
    return resultError(safeError(error));
  }
}

export async function duplicateProductionSavedViewAction(
  businessSlugInput: string,
  viewKeyInput: string,
  input: ProductionDuplicateSavedViewInput,
): Promise<ProductionActionResult<ProductionConfiguredSavedView>> {
  const parsed = z
    .object({
      currentness: structureCurrentnessSchema,
      name: z.string().trim().min(1).max(120),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) return resultError("Choose a valid View name.");
  return applySavedViewManagementAction(
    businessSlugInput,
    viewKeyInput,
    parsed.data.currentness,
    {
      action: "duplicate_saved_view",
      sourceViewKey: viewKeyInput,
      name: parsed.data.name,
    },
  );
}

export async function archiveProductionSavedViewAction(
  businessSlugInput: string,
  viewKeyInput: string,
  input: ProductionArchiveSavedViewInput,
): Promise<ProductionActionResult<ProductionConfiguredSavedView>> {
  const parsed = z
    .object({ currentness: structureCurrentnessSchema })
    .strict()
    .safeParse(input);
  if (!parsed.success)
    return resultError("That saved view is no longer current.");
  return applySavedViewManagementAction(
    businessSlugInput,
    viewKeyInput,
    parsed.data.currentness,
    { action: "archive_saved_view", viewKey: viewKeyInput },
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

export async function updateProductionTableConnectionAction(
  businessSlugInput: string,
  viewKeyInput: string,
  input: ProductionConnectionEditInput,
): Promise<ProductionActionResult<EditorRow>> {
  const businessSlug = routeSlugSchema.parse(businessSlugInput);
  const viewKey = viewKeySchema.parse(viewKeyInput);
  const parsed = connectionEditInputSchema.safeParse(input);
  if (!parsed.success) {
    return resultError("That connection value is no longer available.");
  }
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  try {
    const mapped = await loadMappedTable(supabase, tenant.business.id, viewKey);
    const column = mapped.table.columns.find(
      (candidate) =>
        candidate.kind === "connection" &&
        candidate.connection?.relationshipKey === parsed.data.relationshipKey &&
        candidate.connection.direction === parsed.data.direction,
    );
    if (!column || column.kind !== "connection") {
      return resultError("That connection property is no longer available.");
    }
    if (column.editable === false) {
      return resultError(
        "This Connection is managed by the configured workflow.",
      );
    }
    await setTableRecordConnectionValues(supabase, tenant.business.id, {
      viewKey,
      recordId: parsed.data.recordId,
      relationshipKey: parsed.data.relationshipKey,
      direction: parsed.data.direction,
      targetRecordIds: parsed.data.targetRecordIds,
    });
    const refreshed = await loadMappedTable(
      supabase,
      tenant.business.id,
      viewKey,
    );
    const row = refreshed.table.rows.find(
      (candidate) => candidate.id === parsed.data.recordId,
    );
    if (!row) {
      return resultError("That Record is no longer available.");
    }
    revalidatePath(routePath(businessSlug, viewKey), "page");
    return { status: "success", value: row };
  } catch (error) {
    return resultError(safeError(error));
  }
}

export async function searchProductionTableConnectionTargetsAction(
  businessSlugInput: string,
  viewKeyInput: string,
  input: ProductionConnectionSearchInput,
): Promise<ProductionActionResult<readonly { id: string; label: string }[]>> {
  const businessSlug = routeSlugSchema.parse(businessSlugInput);
  const viewKey = viewKeySchema.parse(viewKeyInput);
  const parsed = connectionSearchInputSchema.safeParse(input);
  if (!parsed.success) {
    return resultError("That connection search is not available.");
  }
  const match = parsed.data.columnKey.match(
    /^connection:([a-z][a-z0-9_]*):(source|target)$/,
  );
  if (!match) {
    return resultError("That connection property is no longer available.");
  }
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  try {
    const mapped = await loadMappedTable(supabase, tenant.business.id, viewKey);
    const column = mapped.table.columns.find(
      (candidate) => candidate.key === parsed.data.columnKey,
    );
    if (!column || column.kind !== "connection") {
      return resultError("That connection property is no longer available.");
    }
    if (column.editable === false) {
      return resultError(
        "This Connection is managed by the configured workflow.",
      );
    }
    const targets = await searchTableConnectionTargets(
      supabase,
      tenant.business.id,
      {
        viewKey,
        relationshipKey: match[1]!,
        direction: match[2] as "source" | "target",
        search: parsed.data.search,
        limit: 50,
      },
    );
    return { status: "success", value: targets };
  } catch (error) {
    return resultError(safeError(error));
  }
}

async function contextualCreationTarget(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  businessId: string,
  sourceViewKey: string,
  input: Pick<
    ProductionContextualRecordCreateInput,
    "parentRecordId" | "columnKey"
  >,
) {
  const source = await loadMappedTable(supabase, businessId, sourceViewKey);
  const parent = source.table.rows.find(
    (row) => row.id === input.parentRecordId,
  );
  const connection = source.table.columns.find(
    (column) => column.key === input.columnKey,
  );
  if (
    !parent ||
    !connection ||
    connection.kind !== "connection" ||
    !connection.connection ||
    connection.editable === false
  ) {
    throw new ExperienceSubmissionError(
      "This Connection is no longer available for adding related work.",
    );
  }

  const experience = createExperienceService(supabase, { businessId });
  const targetView = (await experience.listTableViews())
    .filter(
      (candidate) =>
        candidate.object_definition_id ===
        connection.connection!.targetObjectKey,
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
    })[0];
  if (!targetView) {
    throw new ExperienceSubmissionError(
      "The related Table is no longer available.",
    );
  }

  const targetBundle = await experience.loadView(targetView.key, "internal");
  const target = await loadMappedTable(supabase, businessId, targetView.key);
  const parentPrimary = source.table.columns.find(
    (column) => column.key === source.table.primaryColumnKey,
  );
  const parentLabel = parentPrimary
    ? displayEditorValue(
        parentPrimary,
        parent.values[parentPrimary.key] ?? null,
      )
    : "this record";

  return { connection, parent, parentLabel, target, targetBundle, targetView };
}

export async function getProductionTableContextualRecordCreateStateAction(
  businessSlugInput: string,
  viewKeyInput: string,
  input: Pick<
    ProductionContextualRecordCreateInput,
    "parentRecordId" | "columnKey"
  >,
): Promise<ProductionActionResult<ProductionContextualRecordCreateState>> {
  const businessSlug = routeSlugSchema.parse(businessSlugInput);
  const viewKey = viewKeySchema.parse(viewKeyInput);
  const parsed = contextualRecordStateInputSchema.safeParse(input);
  if (!parsed.success) {
    return resultError("That related Record is no longer available.");
  }
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  try {
    const state = await contextualCreationTarget(
      supabase,
      tenant.business.id,
      viewKey,
      parsed.data,
    );
    return {
      status: "success",
      value: {
        parentLabel: state.parentLabel,
        connectionLabel: state.connection.label,
        objectLabel: state.targetBundle.object.singular_label,
        targetViewKey: state.targetView.key,
        columns: (
          state.target.table.recordColumns ?? state.target.table.columns
        )
          .filter((column) => column.kind !== "file")
          .filter(
            (column) =>
              !(
                column.kind === "connection" &&
                column.connection?.relationshipKey ===
                  state.connection.connection!.relationshipKey
              ),
          ),
      },
    };
  } catch (error) {
    return resultError(safeError(error));
  }
}

function formDataForContextualValues(
  values: Readonly<
    Record<string, string | number | boolean | readonly string[] | null>
  >,
): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) formData.append(key, item);
    } else if (typeof value === "boolean") {
      formData.set(key, value ? "true" : "false");
    } else {
      formData.set(key, String(value));
    }
  }
  return formData;
}

export async function createProductionTableContextualRecordAction(
  businessSlugInput: string,
  viewKeyInput: string,
  input: ProductionContextualRecordCreateInput,
): Promise<ProductionActionResult<{ id: string; label: string }>> {
  const businessSlug = routeSlugSchema.parse(businessSlugInput);
  const viewKey = viewKeySchema.parse(viewKeyInput);
  const parsed = contextualRecordCreateInputSchema.safeParse(input);
  if (!parsed.success) {
    return resultError("Check the related Record and try again.");
  }
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  try {
    const state = await contextualCreationTarget(
      supabase,
      tenant.business.id,
      viewKey,
      parsed.data,
    );
    const initiatingConnection = state.connection.connection;
    if (!initiatingConnection) {
      return resultError("This Connection changed while you were adding this.");
    }
    const recordFields = state.target.recordFields.filter(
      (field) => field.field_type !== "file",
    );
    const allowedFieldKeys = new Set(recordFields.map((field) => field.key));
    if (
      Object.keys(parsed.data.values).some((key) => !allowedFieldKeys.has(key))
    ) {
      return resultError("A Property changed while you were adding this.");
    }
    const requestedData = buildConfiguredSubmission(
      recordFields,
      {
        fields: recordFields.map((field) => ({
          field: field.key,
          hidden: false,
        })),
      },
      "create",
      formDataForContextualValues(parsed.data.values),
      {},
      { enforceRequired: false },
    );
    const allowedConnections = new Map(
      (state.target.table.recordColumns ?? state.target.table.columns)
        .filter((column) => column.kind === "connection" && column.connection)
        .map((column) => [
          `${column.connection!.relationshipKey}:${column.connection!.direction}`,
          column,
        ]),
    );
    const requestedConnections = parsed.data.connections.filter(
      (connection) => connection.targetRecordIds.length > 0,
    );
    if (
      requestedConnections.some(
        (connection) =>
          !allowedConnections.has(
            `${connection.relationshipKey}:${connection.direction}`,
          ) ||
          connection.relationshipKey === initiatingConnection.relationshipKey,
      )
    ) {
      return resultError("A Connection changed while you were adding this.");
    }
    const { data: record, error } = await supabase.rpc(
      "create_contextual_graph_record",
      {
        expected_business_id: tenant.business.id,
        initiating_relationship_key: initiatingConnection.relationshipKey,
        initiating_direction: initiatingConnection.direction,
        parent_record_id: parsed.data.parentRecordId,
        requested_data: requestedData,
        requested_connections: requestedConnections.map((connection) => ({
          relationship_key: connection.relationshipKey,
          direction: connection.direction,
          target_record_ids: connection.targetRecordIds,
        })),
      },
    );
    if (error || !record) {
      throw new ExperienceSubmissionError(
        "That information changed while you were adding this. Review the latest record and try again.",
      );
    }
    const primary = state.target.table.recordColumns?.find(
      (column) => column.primary,
    );
    const data =
      typeof record.data_json === "object" &&
      record.data_json !== null &&
      !Array.isArray(record.data_json)
        ? record.data_json
        : {};
    const label = primary
      ? displayEditorValue(primary, editorValueFromJson(data[primary.key]))
      : state.targetBundle.object.singular_label;
    revalidatePath(routePath(businessSlug, viewKey), "page");
    revalidatePath(routePath(businessSlug, state.targetView.key), "page");
    return { status: "success", value: { id: record.id, label } };
  } catch (error) {
    return resultError(safeError(error));
  }
}

export async function createProductionTableConnectionTargetAction(
  businessSlugInput: string,
  viewKeyInput: string,
  input: ProductionConnectionCreateInput,
): Promise<ProductionActionResult<{ id: string; label: string }>> {
  const businessSlug = routeSlugSchema.parse(businessSlugInput);
  const viewKey = viewKeySchema.parse(viewKeyInput);
  const parsed = connectionCreateInputSchema.safeParse(input);
  if (!parsed.success) {
    return resultError("That connected Record name is not available.");
  }
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);

  try {
    const mapped = await loadMappedTable(supabase, tenant.business.id, viewKey);
    const column = mapped.table.columns.find(
      (candidate) => candidate.key === parsed.data.columnKey,
    );
    if (!column || column.kind !== "connection" || !column.connection) {
      return resultError("That connection property is no longer available.");
    }
    if (column.editable === false) {
      return resultError(
        "This Connection is managed by the configured workflow.",
      );
    }
    const experience = createExperienceService(supabase, {
      businessId: tenant.business.id,
    });
    const targetView = (await experience.listTableViews())
      .filter(
        (candidate) =>
          candidate.object_definition_id === column.connection!.targetObjectKey,
      )
      .sort((left, right) => {
        const leftConfig = normalizeTableViewConfig(left.config_json);
        const rightConfig = normalizeTableViewConfig(right.config_json);
        return (
          (leftConfig.role === "primary" ? 0 : 1) -
            (rightConfig.role === "primary" ? 0 : 1) ||
          left.key.localeCompare(right.key)
        );
      })[0];
    if (!targetView) {
      return resultError("The connected Table is not available.");
    }

    const availability = await getDirectTableRowCreationAvailability(
      supabase,
      { businessId: tenant.business.id },
      targetView.key,
    );
    if (availability.kind === "configured_form") {
      const targetConfig = normalizeTableViewConfig(targetView.config_json);
      const primaryFieldKey = targetConfig.title_field;
      if (!primaryFieldKey) {
        return resultError(
          "The connected Table has no usable primary property.",
        );
      }

      const formData = new FormData();
      formData.set(primaryFieldKey, parsed.data.primaryValue);
      const record = await submitExperienceForm(
        supabase,
        { businessId: tenant.business.id },
        { formKey: availability.formKey, formData },
      );
      revalidatePath(routePath(businessSlug, targetView.key), "page");
      return {
        status: "success",
        value: { id: record.id, label: parsed.data.primaryValue },
      };
    }

    const created = await createProductionTableRowAction(
      businessSlug,
      targetView.key,
      { primaryValue: parsed.data.primaryValue },
    );
    if (created.status === "error") {
      return created;
    }
    revalidatePath(routePath(businessSlug, targetView.key), "page");
    return {
      status: "success",
      value: { id: created.value.id, label: parsed.data.primaryValue },
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

export async function readProductionRecordPanelContextAction(
  businessSlugInput: string,
  viewKeyInput: string,
  input: ProductionRecordReadInput,
): Promise<ProductionActionResult<ProductionRecordPanelContext | null>> {
  const businessSlug = routeSlugSchema.parse(businessSlugInput);
  const viewKey = viewKeySchema.parse(viewKeyInput);
  const parsed = recordInputSchema.parse(input);
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);

  try {
    const experience = createExperienceService(supabase, {
      businessId: tenant.business.id,
    });
    const bundle = await experience.loadView(viewKey, "internal");
    const mapped = await loadMappedTable(supabase, tenant.business.id, viewKey);
    const row = mapped.table.rows.find(
      (candidate) => candidate.id === parsed.recordId,
    );
    if (!row) {
      return { status: "success", value: null };
    }
    return {
      status: "success",
      value: {
        columns: mapped.table.recordColumns ?? mapped.table.columns,
        fullRecordPath: routePath(businessSlug, viewKey),
        recordTypeLabel: bundle.object.singular_label,
        row,
        tableName: mapped.table.name,
      },
    };
  } catch (error) {
    return resultError(safeError(error));
  }
}
