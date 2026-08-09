import {
  ConfigurationIdentityAllocationError,
  createGraphKeyAllocator,
  createPageSlugAllocator,
} from "../identity-allocation";
import {
  configurationSnapshotV1Schema,
  type ConfigurationSnapshotV1,
} from "../definition-source";
import {
  configurationOperationsSchema,
  setFieldOperationSchema,
  setFormOperationSchema,
  setObjectOperationSchema,
  setPageOperationSchema,
  setViewOperationSchema,
  type ConfigurationOperation,
} from "../schemas";
import {
  formConfigSchema,
  pageLayoutSchema,
  parseViewConfig,
} from "../../experience/schemas";
import {
  manualListIntentSchema,
  normalizeManualListLabel,
  type ManualListIntent,
  type ManualListOwnerFieldType,
} from "./schemas";

type ManualListFieldOperation = Extract<
  ConfigurationOperation,
  { op: "set_field" }
>;

export const manualListErrorCodes = [
  "manual_list_input_invalid",
  "manual_list_snapshot_invalid",
  "manual_list_object_label_conflict",
  "manual_list_field_label_conflict",
  "manual_list_key_unavailable",
  "manual_list_slug_unavailable",
  "manual_list_operations_invalid",
  "manual_list_stale",
] as const;

export type ManualListErrorCode = (typeof manualListErrorCodes)[number];

const manualListErrorMessages: Readonly<Record<ManualListErrorCode, string>> = {
  manual_list_input_invalid:
    "Check the list name and information, then try again.",
  manual_list_snapshot_invalid:
    "The current list setup could not be read safely. Reload and try again.",
  manual_list_object_label_conflict:
    "A list with that name already exists. Choose a different name.",
  manual_list_field_label_conflict:
    "Information labels in a list must be different.",
  manual_list_key_unavailable:
    "That list could not be prepared safely. Try a different name.",
  manual_list_slug_unavailable:
    "That list could not be prepared safely. Try a different name.",
  manual_list_operations_invalid:
    "The list could not be prepared safely. Reload and try again.",
  manual_list_stale:
    "Setup changed after this page was loaded. Reload and try again.",
};

export class ManualListError extends Error {
  readonly code: ManualListErrorCode;
  override readonly cause: unknown;

  constructor(code: ManualListErrorCode, cause?: unknown) {
    super(manualListErrorMessages[code]);
    this.name = "ManualListError";
    this.code = code;
    this.cause = cause;
  }
}

export function manualListOwnerMessage(code: ManualListErrorCode): string {
  return manualListErrorMessages[code];
}

export interface ComposedManualList {
  title: string;
  description: string;
  operations: ConfigurationOperation[];
}

const fieldTypeMap: Readonly<
  Record<ManualListOwnerFieldType, ManualListFieldOperation["field_type"]>
> = {
  text: "short_text",
  longer_text: "long_text",
  number: "number",
  yes_no: "boolean",
  date: "date",
  email: "email",
  phone: "phone",
  choice: "select",
  status: "status",
};

function parseSnapshot(input: unknown): ConfigurationSnapshotV1 {
  try {
    return configurationSnapshotV1Schema.parse(input);
  } catch (error) {
    throw new ManualListError("manual_list_snapshot_invalid", error);
  }
}

function parseIntent(input: unknown): ManualListIntent {
  try {
    return manualListIntentSchema.parse(input);
  } catch (error) {
    throw new ManualListError("manual_list_input_invalid", error);
  }
}

function allocateKey(
  allocator: ReturnType<typeof createGraphKeyAllocator>,
  value: string,
  fallback: string,
): string {
  try {
    return allocator.allocate(value, fallback);
  } catch (error) {
    if (
      error instanceof ConfigurationIdentityAllocationError &&
      error.code === "configuration_identity_key_unavailable"
    ) {
      throw new ManualListError("manual_list_key_unavailable", error);
    }
    throw error;
  }
}

function allocateSlug(
  allocator: ReturnType<typeof createPageSlugAllocator>,
  value: string,
): string {
  try {
    return allocator.allocate(value);
  } catch (error) {
    if (
      error instanceof ConfigurationIdentityAllocationError &&
      error.code === "configuration_identity_slug_unavailable"
    ) {
      throw new ManualListError("manual_list_slug_unavailable", error);
    }
    throw error;
  }
}

function boundedLabel(prefix: string, value: string): string {
  return `${prefix} ${value}`.slice(0, 120).trim();
}

function fieldOperation(
  objectKey: string,
  key: string,
  label: string,
  fieldType: ManualListFieldOperation["field_type"],
  required: boolean,
  position: number,
  options?: string[],
): ManualListFieldOperation {
  return setFieldOperationSchema.parse({
    op: "set_field",
    object_key: objectKey,
    key,
    label,
    field_type: fieldType,
    required,
    default_value: null,
    settings_json: options ? { options } : {},
    position,
    is_active: true,
  });
}

function objectLabels(snapshot: ConfigurationSnapshotV1): Set<string> {
  return new Set(
    snapshot.object_definitions.flatMap((object) => [
      normalizeManualListLabel(object.singular_label),
      normalizeManualListLabel(object.plural_label),
    ]),
  );
}

function assertObjectLabelAvailability(
  snapshot: ConfigurationSnapshotV1,
  intent: ManualListIntent,
): void {
  const labels = objectLabels(snapshot);
  if (
    labels.has(normalizeManualListLabel(intent.singularItemLabel)) ||
    labels.has(normalizeManualListLabel(intent.pluralListLabel))
  ) {
    throw new ManualListError("manual_list_object_label_conflict");
  }
}

function reserveKeys(
  rows: ReadonlyArray<{ key: string }>,
): ReadonlyArray<string> {
  return rows.map((row) => row.key);
}

function composeFields(
  snapshot: ConfigurationSnapshotV1,
  intent: ManualListIntent,
  objectKey: string,
): ManualListFieldOperation[] {
  const existingFieldKeys = snapshot.field_definitions
    .filter((field) => field.object_key === objectKey)
    .map((field) => field.key);
  const allocator = createGraphKeyAllocator(existingFieldKeys);
  const fields: ManualListFieldOperation[] = [];

  fields.push(
    fieldOperation(
      objectKey,
      allocateKey(allocator, intent.mainNameLabel, "field"),
      intent.mainNameLabel,
      "short_text",
      true,
      0,
    ),
  );

  intent.information.forEach((row, index) => {
    const key = allocateKey(allocator, row.label, "field");
    const fieldType = fieldTypeMap[row.type];
    fields.push(
      fieldOperation(
        objectKey,
        key,
        row.label,
        fieldType,
        row.required,
        index + 1,
        row.options,
      ),
    );
  });

  return fields;
}

function assertFieldLabelAvailability(
  fields: ReadonlyArray<ManualListFieldOperation>,
): void {
  const labels = new Set<string>();
  for (const field of fields) {
    const normalized = normalizeManualListLabel(field.label);
    if (labels.has(normalized)) {
      throw new ManualListError("manual_list_field_label_conflict");
    }
    labels.add(normalized);
  }
}

export function composeManualList(
  snapshotInput: unknown,
  intentInput: unknown,
): ComposedManualList {
  const snapshot = parseSnapshot(snapshotInput);
  const intent = parseIntent(intentInput);
  assertObjectLabelAvailability(snapshot, intent);

  const objectAllocator = createGraphKeyAllocator(
    reserveKeys(snapshot.object_definitions),
  );
  const objectKey = allocateKey(
    objectAllocator,
    intent.singularItemLabel,
    "object",
  );
  const fields = composeFields(snapshot, intent, objectKey);
  assertFieldLabelAvailability(fields);

  const formAllocator = createGraphKeyAllocator(reserveKeys(snapshot.forms));
  const createFormKey = allocateKey(
    formAllocator,
    `${objectKey}_create`,
    "form",
  );
  const editFormKey = allocateKey(formAllocator, `${objectKey}_edit`, "form");

  const viewAllocator = createGraphKeyAllocator(reserveKeys(snapshot.views));
  const viewKey = allocateKey(viewAllocator, intent.pluralListLabel, "view");
  const pageAllocator = createGraphKeyAllocator(reserveKeys(snapshot.pages));
  const pageKey = allocateKey(pageAllocator, `${viewKey}_workspace`, "page");
  const pageSlug = allocateSlug(
    createPageSlugAllocator(snapshot.pages.map((page) => page.slug)),
    intent.pluralListLabel,
  );

  const viewName = intent.pluralListLabel;
  const formFields = fields.map((field) => ({
    field: field.key,
    hidden: false,
  }));
  const formConfig = formConfigSchema.parse({
    fields: formFields,
    submit_label: boundedLabel("Add", intent.singularItemLabel),
  });
  const editFormConfig = formConfigSchema.parse({
    fields: formFields,
    submit_label: boundedLabel("Save", intent.singularItemLabel),
  });
  const tableConfig = parseViewConfig("table", {
    fields: fields.map((field) => field.key),
    title_field: fields[0]!.key,
    create_form_key: createFormKey,
    edit_form_key: editFormKey,
    include_archived: false,
  });
  const pageLayout = pageLayoutSchema.parse({
    blocks: [
      { type: "heading", text: viewName, level: 1 },
      { type: "view", view_key: viewKey },
    ],
  });

  const operations: ConfigurationOperation[] = [
    setObjectOperationSchema.parse({
      op: "set_object",
      key: objectKey,
      singular_label: intent.singularItemLabel,
      plural_label: intent.pluralListLabel,
      description: `A simple list of ${intent.pluralListLabel}.`,
      icon: null,
      is_active: true,
    }),
    ...fields,
    setFormOperationSchema.parse({
      op: "set_form",
      key: createFormKey,
      name: boundedLabel("New", intent.singularItemLabel),
      object_key: objectKey,
      mode: "create",
      config_json: formConfig,
      audience: "internal",
      is_active: true,
    }),
    setFormOperationSchema.parse({
      op: "set_form",
      key: editFormKey,
      name: boundedLabel("Edit", intent.singularItemLabel),
      object_key: objectKey,
      mode: "edit",
      config_json: editFormConfig,
      audience: "internal",
      is_active: true,
    }),
    setViewOperationSchema.parse({
      op: "set_view",
      key: viewKey,
      name: viewName,
      view_type: "table",
      object_key: objectKey,
      config_json: tableConfig,
      audience: "internal",
      is_active: true,
    }),
    setPageOperationSchema.parse({
      op: "set_page",
      key: pageKey,
      title: viewName,
      slug: pageSlug,
      audience: "internal",
      layout_json: pageLayout,
      status: "draft",
      is_active: true,
    }),
  ];

  try {
    return {
      title: boundedLabel("Create", intent.pluralListLabel),
      description: `Create the ${intent.pluralListLabel} list with ${fields.length} pieces of information. The list stays unchanged until the proposal is deliberately validated and applied.`,
      operations: configurationOperationsSchema.parse(operations),
    };
  } catch (error) {
    throw new ManualListError("manual_list_operations_invalid", error);
  }
}

export const composeManualListOperations = composeManualList;
