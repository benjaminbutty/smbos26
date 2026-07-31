import "server-only";

import type { z } from "zod";

import {
  configurationSnapshotV1Schema,
  type ConfigurationSnapshotV1,
} from "../definition-source";
import {
  configurationOperationsSchema,
  setFieldOperationSchema,
  setPreorderExperienceOperationSchema,
  type ConfigurationOperation,
} from "../schemas";
import type { ConfigurationChangeService } from "../service";
import { graphKeySchema } from "../../graph/schemas";
import {
  preorderPublicFieldSchema,
  preorderScheduleSchema,
} from "../../preorder/schemas";
import {
  addPreorderQuestionIntentSchema,
  type AddPreorderQuestionIntent,
  type PreorderQuestionTarget,
  updatePreorderQuestionIntentSchema,
  type UpdatePreorderQuestionIntent,
  updatePreorderScheduleIntentSchema,
  type UpdatePreorderScheduleIntent,
} from "./schemas";

type PreorderSchedule = z.infer<typeof preorderScheduleSchema>;
type PreorderPublicField = z.infer<typeof preorderPublicFieldSchema>;
type SetPreorderOperation = Extract<
  ConfigurationOperation,
  { op: "set_preorder_experience" }
>;
type SetFieldOperation = Extract<ConfigurationOperation, { op: "set_field" }>;

export type ManualAmendmentErrorCode =
  | "manual_preorder_ambiguous"
  | "manual_preorder_locations_invalid"
  | "manual_preorder_not_found"
  | "manual_preorder_object_invalid"
  | "manual_preorder_question_ambiguous"
  | "manual_preorder_question_duplicate"
  | "manual_preorder_question_key_unavailable"
  | "manual_preorder_question_not_found";

const errorMessages: Readonly<Record<ManualAmendmentErrorCode, string>> = {
  manual_preorder_ambiguous:
    "These preorder collection settings could not be identified safely.",
  manual_preorder_locations_invalid:
    "This preorder setup has no available collection location.",
  manual_preorder_not_found: "This preorder setup is no longer available.",
  manual_preorder_object_invalid:
    "The configured preorder information could not be identified safely.",
  manual_preorder_question_ambiguous:
    "This preorder question could not be identified safely.",
  manual_preorder_question_duplicate:
    "A question with that wording already exists for this preorder.",
  manual_preorder_question_key_unavailable:
    "A safe identity could not be created for this question.",
  manual_preorder_question_not_found:
    "This preorder question is no longer available.",
};

export class ManualAmendmentError extends Error {
  readonly code: ManualAmendmentErrorCode;

  constructor(code: ManualAmendmentErrorCode) {
    super(errorMessages[code]);
    this.name = "ManualAmendmentError";
    this.code = code;
  }
}

export interface ActiveManualAmendmentSnapshot {
  baseVersionId: string;
  headRevision: number;
  snapshot: ConfigurationSnapshotV1;
}

export interface PreorderScheduleSetup {
  key: string;
  label: string;
  schedule: PreorderSchedule;
}

export interface PreorderQuestionSetup {
  fieldKey: string;
  helpText: string | null;
  label: string;
  required: boolean;
  target: PreorderQuestionTarget;
}

export interface PreorderQuestionsSetup {
  key: string;
  label: string;
  questions: PreorderQuestionSetup[];
}

export interface ComposedPreorderScheduleAmendment {
  description: string;
  noOp: boolean;
  operation: SetPreorderOperation;
  title: "Update preorder collection settings";
}

export interface ComposedPreorderQuestionAmendment {
  description: string;
  noOp: boolean;
  operations: ConfigurationOperation[];
  title: "Update preorder question";
}

export interface ComposedNewPreorderQuestionAmendment {
  description: string;
  fieldKey: string;
  operations: [SetFieldOperation, SetPreorderOperation];
  title: "Add preorder question";
}

const dayNames = new Map([
  [1, "Monday"],
  [2, "Tuesday"],
  [3, "Wednesday"],
  [4, "Thursday"],
  [5, "Friday"],
  [6, "Saturday"],
  [7, "Sunday"],
]);

function normalizedSchedule(schedule: PreorderSchedule): PreorderSchedule {
  return {
    ...schedule,
    days_of_week: schedule.days_of_week.toSorted((left, right) => left - right),
  };
}

function scheduleEquals(
  left: PreorderSchedule,
  right: PreorderSchedule,
): boolean {
  return (
    JSON.stringify(normalizedSchedule(left)) ===
    JSON.stringify(normalizedSchedule(right))
  );
}

function linkedPageTitle(
  snapshot: ConfigurationSnapshotV1,
  preorderKey: string,
): string | null {
  const titles = snapshot.pages
    .filter(
      (page) =>
        page.is_active &&
        page.layout_json.blocks.some(
          (block) =>
            block.type === "preorder" && block.preorder_key === preorderKey,
        ),
    )
    .map((page) => page.title);
  return titles.length === 1 ? titles[0]! : null;
}

function activePreorder(
  snapshot: ConfigurationSnapshotV1,
  preorderKey: string,
) {
  const matches = snapshot.preorder_experiences.filter(
    (preorder) => preorder.key === preorderKey && preorder.is_active,
  );
  if (matches.length === 0) {
    throw new ManualAmendmentError("manual_preorder_not_found");
  }
  if (matches.length !== 1) {
    throw new ManualAmendmentError("manual_preorder_ambiguous");
  }
  return matches[0]!;
}

type SnapshotPreorder = ConfigurationSnapshotV1["preorder_experiences"][number];
type SnapshotObject = ConfigurationSnapshotV1["object_definitions"][number];
type SnapshotField = ConfigurationSnapshotV1["field_definitions"][number];

function activeConfiguredObject(
  snapshot: ConfigurationSnapshotV1,
  preorder: SnapshotPreorder,
  target: PreorderQuestionTarget,
): SnapshotObject {
  const expectedKey =
    target === "customer"
      ? preorder.customer_object_key
      : preorder.order_object_key;
  const expectedId =
    target === "customer"
      ? preorder.customer_object_definition_id
      : preorder.order_object_definition_id;
  const candidates = snapshot.object_definitions.filter(
    (object) => object.key === expectedKey || object.id === expectedId,
  );
  if (candidates.length !== 1) {
    throw new ManualAmendmentError("manual_preorder_object_invalid");
  }
  const object = candidates[0]!;
  if (
    !object.is_active ||
    object.key !== expectedKey ||
    object.id !== expectedId
  ) {
    throw new ManualAmendmentError("manual_preorder_object_invalid");
  }
  return object;
}

function resolveQuestion(
  snapshot: ConfigurationSnapshotV1,
  preorder: SnapshotPreorder,
  target: PreorderQuestionTarget,
  fieldKey: string,
): { definition: SnapshotField; publicField: PreorderPublicField } {
  const publicMatches = preorder.config_json.public_fields.filter(
    (field) => field.target === target && field.field === fieldKey,
  );
  if (publicMatches.length === 0) {
    throw new ManualAmendmentError("manual_preorder_question_not_found");
  }
  if (publicMatches.length !== 1) {
    throw new ManualAmendmentError("manual_preorder_question_ambiguous");
  }

  const object = activeConfiguredObject(snapshot, preorder, target);
  const fieldMatches = snapshot.field_definitions.filter(
    (field) => field.object_key === object.key && field.key === fieldKey,
  );
  if (fieldMatches.length === 0 || !fieldMatches[0]?.is_active) {
    throw new ManualAmendmentError("manual_preorder_question_not_found");
  }
  if (
    fieldMatches.length !== 1 ||
    fieldMatches[0]!.object_definition_id !== object.id
  ) {
    throw new ManualAmendmentError("manual_preorder_question_ambiguous");
  }
  return {
    definition: fieldMatches[0]!,
    publicField: publicMatches[0]!,
  };
}

function activeLocationIds(
  snapshot: ConfigurationSnapshotV1,
  preorder: ConfigurationSnapshotV1["preorder_experiences"][number],
): string[] {
  const ids = snapshot.preorder_experience_locations
    .filter(
      (association) =>
        association.is_active &&
        association.preorder_key === preorder.key &&
        association.preorder_experience_id === preorder.id,
    )
    .map((association) => association.location_id);
  if (ids.length === 0) {
    throw new ManualAmendmentError("manual_preorder_locations_invalid");
  }
  if (new Set(ids).size !== ids.length) {
    throw new ManualAmendmentError("manual_preorder_ambiguous");
  }
  return ids;
}

function completePreorderOperation(
  snapshot: ConfigurationSnapshotV1,
  preorder: SnapshotPreorder,
  configJson: SnapshotPreorder["config_json"],
): SetPreorderOperation {
  return setPreorderExperienceOperationSchema.parse({
    op: "set_preorder_experience",
    key: preorder.key,
    product_object_key: preorder.product_object_key,
    customer_object_key: preorder.customer_object_key,
    order_object_key: preorder.order_object_key,
    order_item_object_key: preorder.order_item_object_key,
    customer_places_order_relationship_key:
      preorder.customer_places_order_relationship_key,
    order_contains_item_relationship_key:
      preorder.order_contains_item_relationship_key,
    product_appears_in_item_relationship_key:
      preorder.product_appears_in_item_relationship_key,
    config_json: configJson,
    allowed_location_ids: activeLocationIds(snapshot, preorder),
    is_active: preorder.is_active,
  });
}

function normalizedQuestionLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").normalize("NFKC").toLowerCase();
}

function changedPublicField(
  current: PreorderPublicField,
  input: { helpText: string | null; label: string; required: boolean },
): PreorderPublicField {
  const changed: Record<string, unknown> = {
    ...current,
    label: input.label,
    required: input.required,
  };
  if (input.helpText === null) {
    delete changed.help_text;
  } else {
    changed.help_text = input.helpText;
  }
  return preorderPublicFieldSchema.parse(changed);
}

function completeFieldOperation(
  field: SnapshotField,
  required: boolean,
): SetFieldOperation {
  return setFieldOperationSchema.parse({
    op: "set_field",
    object_key: field.object_key,
    key: field.key,
    label: field.label,
    field_type: field.field_type,
    required,
    default_value: field.default_value,
    settings_json: field.settings_json,
    position: field.position,
    is_active: field.is_active,
  });
}

function describeQuestionChange(
  before: PreorderPublicField,
  after: PreorderPublicField,
): string {
  const changes: string[] = [];
  if (before.label !== after.label) {
    changes.push(
      `Change question wording from ${before.label} to ${after.label}`,
    );
  }
  if (before.required !== after.required) {
    changes.push(
      `Make ${after.label} ${after.required ? "required" : "optional"}`,
    );
  }
  const beforeHelp = before.help_text ?? null;
  const afterHelp = after.help_text ?? null;
  if (beforeHelp !== afterHelp) {
    changes.push(
      afterHelp === null
        ? `Remove help text from ${after.label}`
        : beforeHelp === null
          ? `Add help text to ${after.label}`
          : `Update help text for ${after.label}`,
    );
  }
  return changes.join(". ");
}

const MAX_FIELD_KEY_ATTEMPTS = 100;

function baseFieldKey(label: string): string {
  const normalized = label
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  const withLeadingLetter =
    normalized.length === 0
      ? "question"
      : /^[a-z]/.test(normalized)
        ? normalized
        : `question_${normalized}`;
  return withLeadingLetter.slice(0, 80).replace(/_+$/g, "") || "question";
}

export function derivePreorderQuestionFieldKey(
  label: string,
  existingKeys: Iterable<string>,
): string {
  const used = new Set(existingKeys);
  const base = baseFieldKey(label);
  for (let attempt = 1; attempt <= MAX_FIELD_KEY_ATTEMPTS; attempt += 1) {
    const suffix = attempt === 1 ? "" : `_${attempt}`;
    const candidate = `${base.slice(0, 80 - suffix.length).replace(/_+$/g, "")}${suffix}`;
    if (graphKeySchema.safeParse(candidate).success && !used.has(candidate)) {
      return candidate;
    }
  }
  throw new ManualAmendmentError("manual_preorder_question_key_unavailable");
}

function describeDays(before: number[], after: number[]): string[] {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return [
    ...before
      .filter((day) => !afterSet.has(day))
      .map((day) => `Remove ${dayNames.get(day)} collection`),
    ...after
      .filter((day) => !beforeSet.has(day))
      .map((day) => `Add ${dayNames.get(day)} collection`),
  ];
}

function changedValue(
  changes: string[],
  label: string,
  before: string | number,
  after: string | number,
  suffix = "",
): void {
  if (before !== after) {
    changes.push(
      `Change ${label} from ${before}${suffix} to ${after}${suffix}`,
    );
  }
}

export function describePreorderScheduleChange(
  beforeInput: PreorderSchedule,
  afterInput: PreorderSchedule,
): string {
  const before = normalizedSchedule(beforeInput);
  const after = normalizedSchedule(afterInput);
  const changes = describeDays(before.days_of_week, after.days_of_week);
  changedValue(
    changes,
    "first collection",
    before.start_time,
    after.start_time,
  );
  changedValue(changes, "last collection", before.end_time, after.end_time);
  changedValue(
    changes,
    "slot interval",
    before.slot_interval_minutes,
    after.slot_interval_minutes,
    " minutes",
  );
  changedValue(
    changes,
    "capacity",
    before.slot_capacity,
    after.slot_capacity,
    " orders per slot",
  );
  changedValue(
    changes,
    "notice",
    before.cutoff_hours,
    after.cutoff_hours,
    " hours",
  );
  changedValue(
    changes,
    "booking horizon",
    before.booking_horizon_days,
    after.booking_horizon_days,
    " days",
  );
  return changes.join(". ");
}

export async function loadActiveManualAmendmentSnapshot(
  configuration: ConfigurationChangeService,
): Promise<ActiveManualAmendmentSnapshot> {
  const head = await configuration.getActiveHead();
  const version = await configuration.getVersion(head.active_version_id);
  return {
    baseVersionId: version.id,
    headRevision: head.head_revision,
    snapshot: configurationSnapshotV1Schema.parse(version.snapshot_json),
  };
}

export function listPreorderScheduleSetups(
  snapshotInput: ConfigurationSnapshotV1,
): PreorderScheduleSetup[] {
  const snapshot = configurationSnapshotV1Schema.parse(snapshotInput);
  return snapshot.preorder_experiences
    .filter((preorder) => preorder.is_active)
    .map((preorder) => ({
      key: preorder.key,
      label:
        linkedPageTitle(snapshot, preorder.key) ??
        "Preorder collection settings",
      schedule: preorder.config_json.schedule,
    }));
}

export function getPreorderQuestionsSetup(
  snapshotInput: ConfigurationSnapshotV1,
  preorderKey: string,
): PreorderQuestionsSetup {
  const snapshot = configurationSnapshotV1Schema.parse(snapshotInput);
  const preorder = activePreorder(snapshot, preorderKey);
  const questions = preorder.config_json.public_fields.map((field) => {
    resolveQuestion(snapshot, preorder, field.target, field.field);
    return {
      fieldKey: field.field,
      helpText: field.help_text ?? null,
      label: field.label,
      required: field.required,
      target: field.target,
    };
  });
  return {
    key: preorder.key,
    label:
      linkedPageTitle(snapshot, preorder.key) ?? "Preorder customer questions",
    questions,
  };
}

export function listPreorderQuestionSetups(
  snapshotInput: ConfigurationSnapshotV1,
): PreorderQuestionsSetup[] {
  const snapshot = configurationSnapshotV1Schema.parse(snapshotInput);
  return snapshot.preorder_experiences
    .filter((preorder) => preorder.is_active)
    .map((preorder) => getPreorderQuestionsSetup(snapshot, preorder.key));
}

export function composePreorderScheduleAmendment(
  snapshotInput: ConfigurationSnapshotV1,
  intentInput: UpdatePreorderScheduleIntent,
): ComposedPreorderScheduleAmendment {
  const snapshot = configurationSnapshotV1Schema.parse(snapshotInput);
  const intent = updatePreorderScheduleIntentSchema.parse(intentInput);
  const preorder = activePreorder(snapshot, intent.preorderKey);
  const schedule = normalizedSchedule(intent.schedule);
  const operation = completePreorderOperation(snapshot, preorder, {
    ...preorder.config_json,
    schedule,
  });
  const noOp = scheduleEquals(preorder.config_json.schedule, schedule);
  return {
    title: "Update preorder collection settings",
    description: noOp
      ? ""
      : describePreorderScheduleChange(preorder.config_json.schedule, schedule),
    noOp,
    operation,
  };
}

export function composePreorderQuestionAmendment(
  snapshotInput: ConfigurationSnapshotV1,
  intentInput: UpdatePreorderQuestionIntent,
): ComposedPreorderQuestionAmendment {
  const snapshot = configurationSnapshotV1Schema.parse(snapshotInput);
  const intent = updatePreorderQuestionIntentSchema.parse(intentInput);
  const preorder = activePreorder(snapshot, intent.preorderKey);
  const current = resolveQuestion(
    snapshot,
    preorder,
    intent.target,
    intent.fieldKey,
  );
  const nextPublicField = changedPublicField(current.publicField, intent);
  const nextPublicFields = preorder.config_json.public_fields.map((field) =>
    field === current.publicField ? nextPublicField : field,
  );
  const operations: ConfigurationOperation[] = [];
  const relaxesGlobalRequirement =
    !intent.required && current.definition.required;
  if (relaxesGlobalRequirement) {
    operations.push(completeFieldOperation(current.definition, false));
  }
  operations.push(
    completePreorderOperation(snapshot, preorder, {
      ...preorder.config_json,
      public_fields: nextPublicFields,
    }),
  );
  const noOp =
    !relaxesGlobalRequirement &&
    current.publicField.label === nextPublicField.label &&
    (current.publicField.help_text ?? null) ===
      (nextPublicField.help_text ?? null) &&
    current.publicField.required === nextPublicField.required;
  return {
    title: "Update preorder question",
    description: noOp
      ? ""
      : describeQuestionChange(current.publicField, nextPublicField) ||
        `Make ${nextPublicField.label} optional`,
    noOp,
    operations: configurationOperationsSchema.parse(operations),
  };
}

export function composeNewPreorderQuestionAmendment(
  snapshotInput: ConfigurationSnapshotV1,
  intentInput: AddPreorderQuestionIntent,
): ComposedNewPreorderQuestionAmendment {
  const snapshot = configurationSnapshotV1Schema.parse(snapshotInput);
  const intent = addPreorderQuestionIntentSchema.parse(intentInput);
  const preorder = activePreorder(snapshot, intent.preorderKey);
  const orderObject = activeConfiguredObject(snapshot, preorder, "order");
  if (
    preorder.config_json.public_fields.some(
      (field) =>
        normalizedQuestionLabel(field.label) ===
        normalizedQuestionLabel(intent.label),
    )
  ) {
    throw new ManualAmendmentError("manual_preorder_question_duplicate");
  }

  const orderFields = snapshot.field_definitions.filter(
    (field) =>
      field.object_key === orderObject.key ||
      field.object_definition_id === orderObject.id,
  );
  if (
    orderFields.some(
      (field) =>
        field.object_key !== orderObject.key ||
        field.object_definition_id !== orderObject.id,
    )
  ) {
    throw new ManualAmendmentError("manual_preorder_object_invalid");
  }
  const fieldKey = derivePreorderQuestionFieldKey(
    intent.label,
    orderFields.map((field) => field.key),
  );
  const maxPosition = orderFields.reduce(
    (highest, field) => Math.max(highest, field.position),
    -1,
  );
  if (!Number.isSafeInteger(maxPosition) || maxPosition >= 2_147_483_647) {
    throw new ManualAmendmentError("manual_preorder_question_key_unavailable");
  }

  const fieldOperation = setFieldOperationSchema.parse({
    op: "set_field",
    object_key: orderObject.key,
    key: fieldKey,
    label: intent.label,
    field_type:
      intent.answerStyle === "short_answer" ? "short_text" : "long_text",
    required: false,
    default_value: null,
    settings_json: {},
    position: maxPosition + 1,
    is_active: true,
  });
  const publicField = changedPublicField(
    {
      target: "order",
      field: fieldKey,
      label: intent.label,
      required: intent.required,
      autocomplete: "off",
    },
    intent,
  );
  const preorderOperation = completePreorderOperation(snapshot, preorder, {
    ...preorder.config_json,
    public_fields: [...preorder.config_json.public_fields, publicField],
  });
  const operations = configurationOperationsSchema.parse([
    fieldOperation,
    preorderOperation,
  ]) as [SetFieldOperation, SetPreorderOperation];
  return {
    title: "Add preorder question",
    description: `Add ${intent.required ? "required" : "optional"} question ${intent.label}`,
    fieldKey,
    operations,
  };
}
