import { bookingConfigSchema } from "../booking/schemas";
import { parseViewConfig } from "../experience/schemas";
import type { ConfigurationOperation } from "../configuration/schemas";
import {
  acquisitionBuildPayloadSchema,
  type AcquisitionBuildPayload,
} from "./schemas";

type ObjectOperation = Extract<ConfigurationOperation, { op: "set_object" }>;
type FieldOperation = Extract<ConfigurationOperation, { op: "set_field" }>;
type RelationshipOperation = Extract<
  ConfigurationOperation,
  { op: "set_relationship" }
>;
type ViewOperation = Extract<ConfigurationOperation, { op: "set_view" }>;
type FormOperation = Extract<ConfigurationOperation, { op: "set_form" }>;
type PageOperation = Extract<ConfigurationOperation, { op: "set_page" }>;

export const acquisitionCandidateQualityCodes = [
  "duplicate_object_key",
  "duplicate_object_label",
  "candidate_without_objects",
  "field_object_mismatch",
  "duplicate_field_key",
  "duplicate_field_label",
  "choice_field_without_options",
  "duplicate_choice_option",
  "object_reference_missing",
  "relationship_self_reference",
  "duplicate_relationship",
  "semantically_redundant_field",
  "cross_object_field_leakage",
  "relationship_scalar_duplication",
  "duplicate_form_field",
  "public_form_field_unsupported",
  "required_form_field_missing",
  "public_form_not_create",
  "view_connection_missing",
  "view_connection_object_mismatch",
  "view_form_object_mismatch",
  "view_without_fields",
  "booking_start_field_invalid",
  "booking_status_field_invalid",
  "booking_default_status_invalid",
  "booking_date_field_invalid",
  "booking_time_field_invalid",
  "booking_relationship_mismatch",
  "booking_public_target_missing",
  "booking_derived_field_target_invalid",
  "page_without_blocks",
  "page_view_missing",
  "page_form_missing",
  "page_public_form_invalid",
  "duplicate_form_key",
  "duplicate_view_key",
] as const;

export type AcquisitionCandidateQualityCode =
  (typeof acquisitionCandidateQualityCodes)[number];

const choiceFieldTypes = new Set(["select", "multi_select", "status"]);
const publicFieldTypes = new Set([
  "short_text",
  "long_text",
  "number",
  "currency",
  "boolean",
  "date",
  "datetime",
  "email",
  "phone",
  "url",
  "select",
  "multi_select",
  "status",
]);

const identityFieldTokens = new Set([
  "name",
  "title",
  "label",
  "id",
  "email",
  "phone",
  "telephone",
  "mobile",
  "address",
  "contact",
]);
const semanticStopWords = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "data",
  "details",
  "field",
  "for",
  "in",
  "information",
  "of",
  "on",
  "property",
  "the",
  "to",
  "value",
  "values",
]);

export class AcquisitionCandidateQualityError extends Error {
  constructor(
    readonly code: AcquisitionCandidateQualityCode,
    message: string,
  ) {
    super(message);
    this.name = "AcquisitionCandidateQualityError";
  }
}

export type AcquisitionCandidateFieldReference = Readonly<{
  object_key: string;
  key: string;
}>;

function normalise(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en");
}

function compact(value: string): string {
  return normalise(value).replace(/[^a-z0-9]+/g, "");
}

function semanticTokens(value: string): Set<string> {
  return new Set(
    normalise(value)
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 2 && !semanticStopWords.has(token)),
  );
}

type SemanticIdentityObject = Pick<
  ObjectOperation,
  "key" | "singular_label" | "plural_label"
>;

type SemanticIdentityField = {
  key?: string;
  label: string;
};

function objectSemanticTokens(object: SemanticIdentityObject): Set<string> {
  return semanticTokens(
    [object.key, object.singular_label, object.plural_label].join(" "),
  );
}

function fieldSemanticTokens(field: SemanticIdentityField): Set<string> {
  return semanticTokens([field.key, field.label].join(" "));
}

function fail(code: AcquisitionCandidateQualityCode, message: string): never {
  throw new AcquisitionCandidateQualityError(code, message);
}

function activeObjects(
  operations: readonly ConfigurationOperation[],
): Map<string, ObjectOperation> {
  const objects = new Map<string, ObjectOperation>();
  const labels = new Map<string, string>();
  for (const operation of operations) {
    if (operation.op !== "set_object" || !operation.is_active) continue;
    if (objects.has(operation.key)) {
      fail("duplicate_object_key", `Object ${operation.key} is defined twice.`);
    }
    for (const label of [operation.singular_label, operation.plural_label]) {
      const key = normalise(label);
      const existing = labels.get(key);
      if (existing && existing !== operation.key) {
        fail(
          "duplicate_object_label",
          `Objects ${existing} and ${operation.key} use the same label.`,
        );
      }
      labels.set(key, operation.key);
    }
    objects.set(operation.key, operation);
  }
  if (objects.size === 0)
    fail("candidate_without_objects", "Add at least one business area.");
  return objects;
}

function activeFields(
  operations: readonly ConfigurationOperation[],
  objects: ReadonlyMap<string, ObjectOperation>,
): Map<string, Map<string, FieldOperation>> {
  const fields = new Map<string, Map<string, FieldOperation>>();
  const labels = new Map<string, Map<string, string>>();
  for (const operation of operations) {
    if (operation.op !== "set_field" || !operation.is_active) continue;
    if (!objects.has(operation.object_key)) {
      fail(
        "field_object_mismatch",
        `Field ${operation.key} points to an unknown Object.`,
      );
    }
    const objectFields = fields.get(operation.object_key) ?? new Map();
    if (objectFields.has(operation.key)) {
      fail(
        "duplicate_field_key",
        `Field ${operation.object_key}.${operation.key} is defined twice.`,
      );
    }
    const objectLabels = labels.get(operation.object_key) ?? new Map();
    const labelKey = normalise(operation.label);
    const existing = objectLabels.get(labelKey);
    if (existing) {
      fail(
        "duplicate_field_label",
        `Object ${operation.object_key} has duplicate field label ${operation.label}.`,
      );
    }
    objectLabels.set(labelKey, operation.key);
    labels.set(operation.object_key, objectLabels);

    if (choiceFieldTypes.has(operation.field_type)) {
      const options = operation.settings_json.options;
      if (
        !Array.isArray(options) ||
        options.length === 0 ||
        options.some((option) => typeof option !== "string" || !option.trim())
      ) {
        fail(
          "choice_field_without_options",
          `Field ${operation.object_key}.${operation.key} needs usable options.`,
        );
      }
      const optionKeys = options.map((option) => normalise(String(option)));
      if (new Set(optionKeys).size !== optionKeys.length) {
        fail(
          "duplicate_choice_option",
          `Field ${operation.object_key}.${operation.key} repeats an option.`,
        );
      }
    }

    objectFields.set(operation.key, operation);
    fields.set(operation.object_key, objectFields);
  }
  return fields;
}

function requireObject(
  objects: ReadonlyMap<string, ObjectOperation>,
  key: string,
  subject: string,
): ObjectOperation {
  const object = objects.get(key);
  if (!object)
    fail("object_reference_missing", `${subject} points to an unknown Object.`);
  return object;
}

function requireField(
  fields: ReadonlyMap<string, Map<string, FieldOperation>>,
  objectKey: string,
  fieldKey: string,
  subject: string,
): FieldOperation {
  const field = fields.get(objectKey)?.get(fieldKey);
  if (!field)
    fail("field_object_mismatch", `${subject} points to an unknown Field.`);
  return field;
}

function activeRelationships(
  operations: readonly ConfigurationOperation[],
  objects: ReadonlyMap<string, ObjectOperation>,
): Map<string, RelationshipOperation> {
  const relationships = new Map<string, RelationshipOperation>();
  const identities = new Set<string>();
  for (const operation of operations) {
    if (operation.op !== "set_relationship" || !operation.is_active) continue;
    requireObject(
      objects,
      operation.source_object_key,
      `Relationship ${operation.key}`,
    );
    requireObject(
      objects,
      operation.target_object_key,
      `Relationship ${operation.key}`,
    );
    if (operation.source_object_key === operation.target_object_key) {
      fail(
        "relationship_self_reference",
        `Relationship ${operation.key} links an Object to itself.`,
      );
    }
    const identity = [
      operation.source_object_key,
      operation.target_object_key,
      normalise(operation.source_label),
      normalise(operation.target_label),
      operation.cardinality,
    ].join(":");
    if (identities.has(identity)) {
      fail(
        "duplicate_relationship",
        `Relationship ${operation.key} duplicates another Connection.`,
      );
    }
    identities.add(identity);
    relationships.set(operation.key, operation);
  }
  return relationships;
}

export function isScalarConnectionDuplicate(
  field: FieldOperation,
  target: ObjectOperation,
): boolean {
  const fieldKey = compact(field.key);
  const fieldLabel = compact(field.label);
  return [target.key, target.singular_label, target.plural_label].some(
    (value) => {
      const targetKey = compact(value);
      return (
        fieldKey === targetKey ||
        fieldKey === `${targetKey}id` ||
        fieldLabel === targetKey ||
        fieldLabel === `${targetKey}id`
      );
    },
  );
}

function isSemanticallyRedundantField(
  left: SemanticIdentityField,
  right: SemanticIdentityField,
  object: SemanticIdentityObject,
): boolean {
  const leftTokens = fieldSemanticTokens(left);
  const rightTokens = fieldSemanticTokens(right);
  const [smaller, larger] =
    leftTokens.size <= rightTokens.size
      ? [leftTokens, rightTokens]
      : [rightTokens, leftTokens];
  if (smaller.size !== 1) return false;

  const [onlyToken] = [...smaller];
  if (!onlyToken || !identityFieldTokens.has(onlyToken)) return false;

  const objectTokens = objectSemanticTokens(object);
  return [...larger].every(
    (token) => smaller.has(token) || objectTokens.has(token),
  );
}

/**
 * AI plans may repeat a generic identity label alongside a more specific one
 * (for example, "Name" and "Pet name").  Remove only the less-specific
 * identity field before the draft compiler creates dependent Forms and Views.
 */
export function removeSemanticallyRedundantIdentityFields<
  T extends SemanticIdentityField,
>(object: SemanticIdentityObject, fields: readonly T[]): T[] {
  const redundantIndexes = new Set<number>();
  for (let leftIndex = 0; leftIndex < fields.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < fields.length;
      rightIndex += 1
    ) {
      const left = fields[leftIndex]!;
      const right = fields[rightIndex]!;
      if (!isSemanticallyRedundantField(left, right, object)) continue;

      const leftSize = fieldSemanticTokens(left).size;
      const rightSize = fieldSemanticTokens(right).size;
      if (leftSize <= rightSize) redundantIndexes.add(leftIndex);
      else redundantIndexes.add(rightIndex);
    }
  }
  return fields.filter((_, index) => !redundantIndexes.has(index));
}

function validateSemanticallyRedundantFields(
  objects: ReadonlyMap<string, ObjectOperation>,
  fields: ReadonlyMap<string, Map<string, FieldOperation>>,
): void {
  const redundantFields = findSemanticallyRedundantFields(objects, fields);
  if (redundantFields.length > 0) {
    const object = objects.get(redundantFields[0]!.object_key);
    fail(
      "semantically_redundant_field",
      `Object ${object?.plural_label ?? redundantFields[0]!.object_key} has semantically redundant identity Fields; a generic identity label repeats a more specific label.`,
    );
  }
}

function fieldReference(
  field: FieldOperation,
): AcquisitionCandidateFieldReference {
  return { object_key: field.object_key, key: field.key };
}

function uniqueFieldReferences(
  fields: readonly FieldOperation[],
): AcquisitionCandidateFieldReference[] {
  const seen = new Set<string>();
  const result: AcquisitionCandidateFieldReference[] = [];
  for (const field of fields) {
    const reference = fieldReference(field);
    const identity = `${reference.object_key}:${reference.key}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(reference);
  }
  return result;
}

function findSemanticallyRedundantFields(
  objects: ReadonlyMap<string, ObjectOperation>,
  fields: ReadonlyMap<string, Map<string, FieldOperation>>,
): AcquisitionCandidateFieldReference[] {
  const redundant: FieldOperation[] = [];
  for (const [objectKey, object] of objects) {
    const objectFields = [...(fields.get(objectKey)?.values() ?? [])];
    const retained = new Set(
      removeSemanticallyRedundantIdentityFields(object, objectFields).map(
        (field) => field.key,
      ),
    );
    redundant.push(...objectFields.filter((field) => !retained.has(field.key)));
  }
  return uniqueFieldReferences(redundant);
}

function findCrossObjectFieldLeakageFields(
  relationships: ReadonlyMap<string, RelationshipOperation>,
  objects: ReadonlyMap<string, ObjectOperation>,
  fields: ReadonlyMap<string, Map<string, FieldOperation>>,
): AcquisitionCandidateFieldReference[] {
  const leaking: FieldOperation[] = [];
  for (const relationship of relationships.values()) {
    const source = requireObject(
      objects,
      relationship.source_object_key,
      relationship.key,
    );
    const target = requireObject(
      objects,
      relationship.target_object_key,
      relationship.key,
    );
    for (const [owner, related] of [
      [source, target],
      [target, source],
    ] as const) {
      const relatedTokens = objectSemanticTokens(related);
      for (const field of fields.get(owner.key)?.values() ?? []) {
        const fieldTokens = fieldSemanticTokens(field);
        const mentionsRelated = [...relatedTokens].some((token) =>
          fieldTokens.has(token),
        );
        const carriesIdentity = [...fieldTokens].some((token) =>
          identityFieldTokens.has(token),
        );
        if (mentionsRelated && carriesIdentity) {
          leaking.push(field);
        }
      }
    }
  }
  return uniqueFieldReferences(leaking);
}

export function isMechanicallyRedundantCrossObjectIdentityField(
  field: SemanticIdentityField,
  related: SemanticIdentityObject,
): boolean {
  const fieldTokens = fieldSemanticTokens(field);
  const relatedTokens = objectSemanticTokens(related);
  const carriesIdentity = [...fieldTokens].some((token) =>
    identityFieldTokens.has(token),
  );
  const mentionsRelated = [...relatedTokens].some((token) =>
    fieldTokens.has(token),
  );
  const hasOtherMeaning = [...fieldTokens].some(
    (token) => !relatedTokens.has(token) && !identityFieldTokens.has(token),
  );
  return mentionsRelated && carriesIdentity && !hasOtherMeaning;
}

function findMechanicallyRedundantCrossObjectFields(
  relationships: ReadonlyMap<string, RelationshipOperation>,
  objects: ReadonlyMap<string, ObjectOperation>,
  fields: ReadonlyMap<string, Map<string, FieldOperation>>,
): AcquisitionCandidateFieldReference[] {
  const redundant: FieldOperation[] = [];
  for (const relationship of relationships.values()) {
    const source = requireObject(
      objects,
      relationship.source_object_key,
      relationship.key,
    );
    const target = requireObject(
      objects,
      relationship.target_object_key,
      relationship.key,
    );
    for (const [owner, related] of [
      [source, target],
      [target, source],
    ] as const) {
      for (const field of fields.get(owner.key)?.values() ?? []) {
        if (isMechanicallyRedundantCrossObjectIdentityField(field, related)) {
          redundant.push(field);
        }
      }
    }
  }
  return uniqueFieldReferences(redundant);
}

function findRelationshipScalarDuplicationFields(
  relationships: ReadonlyMap<string, RelationshipOperation>,
  objects: ReadonlyMap<string, ObjectOperation>,
  fields: ReadonlyMap<string, Map<string, FieldOperation>>,
): AcquisitionCandidateFieldReference[] {
  const duplicates: FieldOperation[] = [];
  for (const relationship of relationships.values()) {
    const source = requireObject(
      objects,
      relationship.source_object_key,
      relationship.key,
    );
    const target = requireObject(
      objects,
      relationship.target_object_key,
      relationship.key,
    );
    const sourceDuplicate = [...(fields.get(source.key)?.values() ?? [])].find(
      (field) => isScalarConnectionDuplicate(field, target),
    );
    const targetDuplicate = [...(fields.get(target.key)?.values() ?? [])].find(
      (field) => isScalarConnectionDuplicate(field, source),
    );
    if (sourceDuplicate) duplicates.push(sourceDuplicate);
    if (targetDuplicate) duplicates.push(targetDuplicate);
  }
  return uniqueFieldReferences(duplicates);
}

export function findAcquisitionCandidateQualityFields(
  payloadInput: unknown,
  code: Extract<
    AcquisitionCandidateQualityCode,
    | "cross_object_field_leakage"
    | "relationship_scalar_duplication"
    | "semantically_redundant_field"
  >,
): AcquisitionCandidateFieldReference[] {
  const payload = acquisitionBuildPayloadSchema.parse(payloadInput);
  const objects = activeObjects(payload.operations);
  const fields = activeFields(payload.operations, objects);
  const relationships = activeRelationships(payload.operations, objects);
  switch (code) {
    case "cross_object_field_leakage":
      return findCrossObjectFieldLeakageFields(relationships, objects, fields);
    case "relationship_scalar_duplication":
      return findRelationshipScalarDuplicationFields(
        relationships,
        objects,
        fields,
      );
    case "semantically_redundant_field":
      return findSemanticallyRedundantFields(objects, fields);
  }
}

export function findAcquisitionCandidateMechanicalRepairFields(
  payloadInput: unknown,
  code: Extract<
    AcquisitionCandidateQualityCode,
    | "cross_object_field_leakage"
    | "relationship_scalar_duplication"
    | "semantically_redundant_field"
  >,
): AcquisitionCandidateFieldReference[] {
  const payload = acquisitionBuildPayloadSchema.parse(payloadInput);
  const objects = activeObjects(payload.operations);
  const fields = activeFields(payload.operations, objects);
  const relationships = activeRelationships(payload.operations, objects);
  if (code === "cross_object_field_leakage") {
    return findMechanicallyRedundantCrossObjectFields(
      relationships,
      objects,
      fields,
    );
  }
  if (code === "relationship_scalar_duplication") {
    return findRelationshipScalarDuplicationFields(
      relationships,
      objects,
      fields,
    );
  }
  return findSemanticallyRedundantFields(objects, fields);
}

function validateCrossObjectFieldLeakage(
  relationships: ReadonlyMap<string, RelationshipOperation>,
  objects: ReadonlyMap<string, ObjectOperation>,
  fields: ReadonlyMap<string, Map<string, FieldOperation>>,
): void {
  const leakingFields = findCrossObjectFieldLeakageFields(
    relationships,
    objects,
    fields,
  );
  if (leakingFields.length > 0) {
    const field = fields
      .get(leakingFields[0]!.object_key)
      ?.get(leakingFields[0]!.key);
    const owner = objects.get(leakingFields[0]!.object_key);
    fail(
      "cross_object_field_leakage",
      `Cross-object field leakage: ${owner?.plural_label ?? leakingFields[0]!.object_key} / ${field?.label ?? leakingFields[0]!.key} duplicates values from a related business area.`,
    );
  }
}

function validateRelationshipScalarDuplication(
  relationships: ReadonlyMap<string, RelationshipOperation>,
  objects: ReadonlyMap<string, ObjectOperation>,
  fields: ReadonlyMap<string, Map<string, FieldOperation>>,
): void {
  const duplicates = findRelationshipScalarDuplicationFields(
    relationships,
    objects,
    fields,
  );
  if (duplicates.length > 0) {
    fail(
      "relationship_scalar_duplication",
      "A Connection is duplicated by a scalar field.",
    );
  }
}

function validateForm(
  form: FormOperation,
  objects: ReadonlyMap<string, ObjectOperation>,
  fields: ReadonlyMap<string, Map<string, FieldOperation>>,
): void {
  const object = requireObject(objects, form.object_key, `Form ${form.key}`);
  const objectFields = fields.get(object.key) ?? new Map();
  const config = form.config_json;
  const present = new Set<string>();
  for (const entry of config.fields) {
    if (present.has(entry.field)) {
      fail("duplicate_form_field", `Form ${form.key} repeats a Field.`);
    }
    present.add(entry.field);
    const field = requireField(
      fields,
      object.key,
      entry.field,
      `Form ${form.key}`,
    );
    if (form.audience === "public" && !publicFieldTypes.has(field.field_type)) {
      fail(
        "public_form_field_unsupported",
        `Public Form ${form.key} uses an unsupported Field type.`,
      );
    }
  }
  for (const field of objectFields.values()) {
    const entry = config.fields.find(
      (candidate) => candidate.field === field.key,
    );
    if (field.required && !entry) {
      fail(
        "required_form_field_missing",
        `Form ${form.key} omits required Field ${field.key}.`,
      );
    }
  }
  if (form.audience === "public" && form.mode !== "create") {
    fail(
      "public_form_not_create",
      `Public Form ${form.key} must create a Record.`,
    );
  }
}

function validateView(
  view: ViewOperation,
  objects: ReadonlyMap<string, ObjectOperation>,
  fields: ReadonlyMap<string, Map<string, FieldOperation>>,
  relationships: ReadonlyMap<string, RelationshipOperation>,
  forms: ReadonlyMap<string, FormOperation>,
): void {
  requireObject(objects, view.object_key, `View ${view.key}`);
  const config = parseViewConfig(view.view_type, view.config_json);
  const objectFields = fields.get(view.object_key) ?? new Map();
  const fieldKeys = new Set<string>();
  if ("fields" in config) {
    for (const fieldKey of config.fields) {
      requireField(fields, view.object_key, fieldKey, `View ${view.key}`);
      fieldKeys.add(fieldKey);
    }
  }
  if ("title_field" in config && config.title_field) {
    requireField(
      fields,
      view.object_key,
      config.title_field,
      `View ${view.key}`,
    );
  }
  if ("primary_field" in config) {
    requireField(
      fields,
      view.object_key,
      config.primary_field,
      `View ${view.key}`,
    );
  }
  if ("columns" in config) {
    for (const column of config.columns) {
      if (column.kind === "field") {
        requireField(
          fields,
          view.object_key,
          column.field_key,
          `View ${view.key}`,
        );
        fieldKeys.add(column.field_key);
        continue;
      }
      const relationship = relationships.get(column.relationship_key);
      if (!relationship)
        fail(
          "view_connection_missing",
          `View ${view.key} points to an unknown Connection.`,
        );
      const expectedObject =
        column.direction === "source"
          ? relationship.source_object_key
          : relationship.target_object_key;
      if (expectedObject !== view.object_key) {
        fail(
          "view_connection_object_mismatch",
          `View ${view.key} points to a Connection from the wrong Object.`,
        );
      }
    }
  }
  const candidateFormKeys = [
    "create_form_key" in config ? config.create_form_key : null,
    "edit_form_key" in config ? config.edit_form_key : null,
  ].filter((key): key is string => typeof key === "string");
  for (const formKey of candidateFormKeys) {
    const form = forms.get(formKey);
    if (!form || form.object_key !== view.object_key) {
      fail(
        "view_form_object_mismatch",
        `View ${view.key} points to a Form for another Object.`,
      );
    }
  }
  if (objectFields.size > 0 && fieldKeys.size === 0 && "fields" in config) {
    fail("view_without_fields", `View ${view.key} has no usable Fields.`);
  }
}

function validateBookingConfig(
  configInput: unknown,
  objects: ReadonlyMap<string, ObjectOperation>,
  fields: ReadonlyMap<string, Map<string, FieldOperation>>,
  relationships: ReadonlyMap<string, RelationshipOperation>,
): void {
  const config = bookingConfigSchema.parse(configInput);
  const booking = requireObject(
    objects,
    config.booking_object_key,
    "Booking configuration",
  );
  const customer = requireObject(
    objects,
    config.customer_object_key,
    "Booking configuration",
  );
  requireField(
    fields,
    customer.key,
    config.field_mappings.customer.name,
    "Booking customer mapping",
  );
  if (config.field_mappings.customer.email) {
    requireField(
      fields,
      customer.key,
      config.field_mappings.customer.email,
      "Booking customer email mapping",
    );
  }
  if (config.field_mappings.customer.phone) {
    requireField(
      fields,
      customer.key,
      config.field_mappings.customer.phone,
      "Booking customer phone mapping",
    );
  }
  const startField = requireField(
    fields,
    booking.key,
    config.field_mappings.booking.start_at,
    "Booking start mapping",
  );
  if (startField.field_type !== "datetime")
    fail(
      "booking_start_field_invalid",
      "Booking start must use a datetime Field.",
    );
  const statusField = requireField(
    fields,
    booking.key,
    config.field_mappings.booking.status,
    "Booking status mapping",
  );
  if (
    statusField.field_type !== "status" &&
    statusField.field_type !== "select"
  ) {
    fail(
      "booking_status_field_invalid",
      "Booking status must use a choice Field.",
    );
  }
  const statusOptions = statusField.settings_json.options;
  if (
    !Array.isArray(statusOptions) ||
    !statusOptions.includes(config.field_mappings.booking.default_status)
  ) {
    fail(
      "booking_default_status_invalid",
      "Booking default status is not one of the configured options.",
    );
  }
  if (config.field_mappings.booking.date) {
    const dateField = requireField(
      fields,
      booking.key,
      config.field_mappings.booking.date,
      "Booking date mapping",
    );
    if (dateField.field_type !== "date")
      fail("booking_date_field_invalid", "Booking date must use a date Field.");
  }
  if (config.field_mappings.booking.time) {
    const timeField = requireField(
      fields,
      booking.key,
      config.field_mappings.booking.time,
      "Booking time mapping",
    );
    if (timeField.field_type !== "short_text")
      fail(
        "booking_time_field_invalid",
        "Booking time must use a short text Field.",
      );
  }

  const subject = config.subject_object_key
    ? requireObject(
        objects,
        config.subject_object_key,
        "Booking subject mapping",
      )
    : null;
  const service = config.service_object_key
    ? requireObject(
        objects,
        config.service_object_key,
        "Booking service mapping",
      )
    : null;
  if (subject && config.field_mappings.subject) {
    requireField(
      fields,
      subject.key,
      config.field_mappings.subject.name,
      "Booking subject mapping",
    );
  }
  if (service && config.field_mappings.service) {
    requireField(
      fields,
      service.key,
      config.field_mappings.service.name,
      "Booking service mapping",
    );
  }

  const expectedRelationships: Array<[string, string, string, string | null]> =
    [
      [
        "customer_booking",
        customer.key,
        booking.key,
        config.relationships.customer_booking,
      ],
      [
        "customer_subject",
        customer.key,
        subject?.key ?? "",
        config.relationships.customer_subject,
      ],
      [
        "subject_booking",
        subject?.key ?? "",
        booking.key,
        config.relationships.subject_booking,
      ],
      [
        "service_booking",
        service?.key ?? "",
        booking.key,
        config.relationships.service_booking,
      ],
    ];
  for (const [
    name,
    sourceKey,
    targetKey,
    relationshipKey,
  ] of expectedRelationships) {
    if (!relationshipKey) continue;
    const relationship = relationships.get(relationshipKey);
    if (
      !relationship ||
      relationship.source_object_key !== sourceKey ||
      relationship.target_object_key !== targetKey
    ) {
      fail(
        "booking_relationship_mismatch",
        `Booking ${name} points to the wrong Connection.`,
      );
    }
  }
  for (const entry of config.public_fields) {
    const targetObject =
      entry.target === "customer"
        ? customer
        : entry.target === "booking"
          ? booking
          : subject;
    if (!targetObject)
      fail(
        "booking_public_target_missing",
        "Booking public Fields point to a missing Object.",
      );
    requireField(fields, targetObject.key, entry.field, "Booking public Field");
    if (entry.derived && entry.target !== "booking") {
      fail(
        "booking_derived_field_target_invalid",
        "Derived Booking Fields must belong to the Booking Object.",
      );
    }
  }
}

function validatePages(
  pages: readonly PageOperation[],
  views: ReadonlyMap<string, ViewOperation>,
  forms: ReadonlyMap<string, FormOperation>,
  objects: ReadonlyMap<string, ObjectOperation>,
  fields: ReadonlyMap<string, Map<string, FieldOperation>>,
  relationships: ReadonlyMap<string, RelationshipOperation>,
): void {
  for (const page of pages) {
    if (page.layout_json.blocks.length === 0) {
      fail("page_without_blocks", `Page ${page.key} has no usable content.`);
    }
    for (const block of page.layout_json.blocks) {
      if (block.type === "view") {
        if (!views.has(block.view_key))
          fail(
            "page_view_missing",
            `Page ${page.key} points to an unknown View.`,
          );
      } else if (block.type === "form") {
        if (!forms.has(block.form_key))
          fail(
            "page_form_missing",
            `Page ${page.key} points to an unknown Form.`,
          );
      } else if (block.type === "public_form") {
        const form = forms.get(block.form_key);
        if (!form || form.audience !== "public" || form.mode !== "create") {
          fail(
            "page_public_form_invalid",
            `Page ${page.key} does not expose a constructible public Form.`,
          );
        }
      } else if (block.type === "booking") {
        validateBookingConfig(block.config, objects, fields, relationships);
      }
    }
  }
}

export function validateAcquisitionCandidate(
  payloadInput: unknown,
): AcquisitionBuildPayload {
  const payload = acquisitionBuildPayloadSchema.parse(payloadInput);
  const operations = payload.operations;
  const objects = activeObjects(operations);
  const fields = activeFields(operations, objects);
  const relationships = activeRelationships(operations, objects);
  validateSemanticallyRedundantFields(objects, fields);
  validateRelationshipScalarDuplication(relationships, objects, fields);
  validateCrossObjectFieldLeakage(relationships, objects, fields);

  const forms = new Map<string, FormOperation>();
  for (const operation of operations) {
    if (operation.op !== "set_form" || !operation.is_active) continue;
    if (forms.has(operation.key))
      fail("duplicate_form_key", `Form ${operation.key} is defined twice.`);
    validateForm(operation, objects, fields);
    forms.set(operation.key, operation);
  }

  const views = new Map<string, ViewOperation>();
  for (const operation of operations) {
    if (operation.op !== "set_view" || !operation.is_active) continue;
    if (views.has(operation.key))
      fail("duplicate_view_key", `View ${operation.key} is defined twice.`);
    views.set(operation.key, operation);
  }
  for (const view of views.values())
    validateView(view, objects, fields, relationships, forms);

  const pages = operations.filter(
    (operation): operation is PageOperation =>
      operation.op === "set_page" && operation.is_active,
  );
  validatePages(pages, views, forms, objects, fields, relationships);
  return payload;
}
