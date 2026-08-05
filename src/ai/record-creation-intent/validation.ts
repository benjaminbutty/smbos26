import { validateBuilderPlanOutput } from "../planning/validation";
import type {
  BuilderPlanOutput,
  BuilderPlanTaskInput,
} from "../planning/schemas";
import {
  BuilderRecordCreationIntentValidationError,
  type BuilderRecordCreationIntentDiagnosticCode,
} from "./diagnostics";
import {
  builderRecordCreationFieldValueSchema,
  builderRecordCreationIntentOutputSchema,
  builderRecordCreationIntentTaskInputSchema,
  type BuilderRecordCreationFieldValue,
  type BuilderRecordCreationIntentOutput,
  type BuilderRecordCreationIntentReady,
  type BuilderRecordCreationIntentTaskInput,
} from "./schemas";

function fail(code: BuilderRecordCreationIntentDiagnosticCode): never {
  throw new BuilderRecordCreationIntentValidationError(code);
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function phraseInText(text: string, phrase: string): boolean {
  const normalizedText = normalize(text);
  const normalizedPhrase = normalize(phrase);
  return (
    Boolean(normalizedPhrase) &&
    ` ${normalizedText} `.includes(` ${normalizedPhrase} `)
  );
}

function numberMentioned(text: string, value: number): boolean {
  const numeric = String(value);
  const alternatives = new Set([
    numeric,
    numeric.replace(".", ","),
    value.toLocaleString("en-GB"),
  ]);
  return [...alternatives].some((candidate) =>
    new RegExp(
      `(^|[^0-9])${candidate.replace(/[.,]/g, "[.,]")}([^0-9]|$)`,
    ).test(text),
  );
}

function dateMentioned(text: string, value: string): boolean {
  if (text.includes(value)) return true;
  const [year, month, day] = value.split("-").map(Number);
  const monthName = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year!, month! - 1, day)));
  const monthShortName = new Intl.DateTimeFormat("en-GB", {
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year!, month! - 1, day)));
  return new RegExp(
    `\\b${day}(?:st|nd|rd|th)?\\s+(?:${monthName}|${monthShortName})\\s+${year}\\b`,
    "i",
  ).test(text);
}

function booleanMentioned(
  text: string,
  field: { key: string; label: string },
  value: boolean,
): boolean {
  const fieldPhrases = [field.label, field.key.replace(/_/g, " ")]
    .map(normalize)
    .filter(
      (phrase, index, phrases) => phrase && phrases.indexOf(phrase) === index,
    );
  const mentioned = fieldPhrases.some((phrase) => phraseInText(text, phrase));
  if (!mentioned) return false;

  const negative = fieldPhrases.some((phrase) =>
    [
      `not ${phrase}`,
      `no ${phrase}`,
      `is not ${phrase}`,
      `isn t ${phrase}`,
      `are not ${phrase}`,
      `aren t ${phrase}`,
      `${phrase} false`,
      `${phrase} no`,
      `${phrase} unavailable`,
      `${phrase} inactive`,
      `${phrase} disabled`,
    ].some((candidate) => phraseInText(text, candidate)),
  );
  const positive = fieldPhrases.some((phrase) =>
    [
      `is ${phrase}`,
      `are ${phrase}`,
      `be ${phrase}`,
      `${phrase} true`,
      `${phrase} yes`,
      `${phrase} available`,
      `${phrase} active`,
      `${phrase} enabled`,
    ].some((candidate) => phraseInText(text, candidate)),
  );
  return value ? positive && !negative : negative && !positive;
}

function validateInputContract(
  input: unknown,
): BuilderRecordCreationIntentTaskInput {
  const parsed = builderRecordCreationIntentTaskInputSchema.safeParse(input);
  if (!parsed.success) {
    fail("input_contract_invalid");
  }
  return parsed.data;
}

function validateReadyPlan(input: BuilderRecordCreationIntentTaskInput) {
  const planningInput: BuilderPlanTaskInput = {
    schema_version: 1,
    owner_request: input.owner_request,
    business_context: input.business_context,
  };
  let plan: BuilderPlanOutput;
  try {
    plan = validateBuilderPlanOutput(planningInput, input.ready_plan);
  } catch {
    fail("input_plan_invalid");
  }
  if (plan.state !== "ready") {
    fail("input_plan_not_ready");
  }
  const [concept] = plan.plan.concepts;
  const [step] = plan.plan.steps;
  if (
    plan.plan.concepts.length !== 1 ||
    !concept ||
    concept.disposition !== "existing" ||
    plan.plan.steps.length !== 1 ||
    !step ||
    step.lane !== "operational" ||
    step.category !== "create_initial_record" ||
    step.sequence !== 1 ||
    !step.requires_owner_confirmation
  ) {
    fail("input_plan_not_record_creation_only");
  }
  if (
    step.dependencies.length !== 0 ||
    step.affected_concepts.length !== 1 ||
    step.affected_concepts[0] !== concept.reference ||
    step.existing_object_keys.length !== 1 ||
    step.existing_object_keys[0] !== concept.existing_object_key ||
    step.location_references.length !== 0 ||
    plan.unsupported_requirements.length !== 0
  ) {
    fail("input_plan_scope_invalid");
  }
  return { plan, concept, step };
}

function validateSourceStep(
  input: BuilderRecordCreationIntentTaskInput,
  references: readonly string[],
  stepReference: string,
): void {
  if (references.length !== 1 || references[0] !== stepReference) {
    fail("source_step_references_invalid");
  }
  if (input.ready_plan.state !== "ready") {
    fail("input_plan_not_ready");
  }
}

function targetObject(
  input: BuilderRecordCreationIntentTaskInput,
  objectKey: string,
) {
  const object = input.business_context.objects.find(
    (candidate) => candidate.key === objectKey,
  );
  if (!object || !object.is_active) {
    fail("target_object_unknown_or_inactive");
  }
  const ineligibleRelationship = input.business_context.relationships.some(
    (relationship) =>
      relationship.is_active &&
      relationship.is_required &&
      relationship.target_object_key === object.key,
  );
  const ineligiblePreorder = input.business_context.preorder_experiences.some(
    (preorder) =>
      preorder.is_active &&
      (preorder.order_object_key === object.key ||
        preorder.order_item_object_key === object.key),
  );
  const activeFields = object.fields.filter((field) => field.is_active);
  const activeWritableFields = activeFields.filter(
    (field) => field.field_type !== "file",
  );
  const requiredFileWithoutDefault = activeFields.some(
    (field) =>
      field.field_type === "file" && field.required && !field.has_default,
  );
  if (
    ineligibleRelationship ||
    ineligiblePreorder ||
    requiredFileWithoutDefault
  ) {
    fail("target_object_ineligible");
  }
  if (activeWritableFields.length === 0) {
    fail("target_object_no_writable_fields");
  }
  return object;
}

function validateFieldValue(
  input: BuilderRecordCreationIntentTaskInput,
  object: ReturnType<typeof targetObject>,
  value: BuilderRecordCreationFieldValue,
): void {
  const field = object.fields.find(
    (candidate) => candidate.key === value.field_key,
  );
  if (!field || !field.is_active) {
    fail("field_unknown_or_inactive");
  }
  if (field.field_type === "file") {
    fail("file_field_not_supported");
  }
  if (field.field_type !== value.field_type) {
    fail("field_type_mismatch");
  }

  switch (value.field_type) {
    case "short_text":
    case "long_text":
    case "email":
    case "phone":
    case "url":
      if (!phraseInText(input.owner_request, value.string_value)) {
        fail("field_value_not_owner_supplied");
      }
      break;
    case "number":
    case "currency":
      if (!numberMentioned(input.owner_request, value.number_value)) {
        fail("field_value_not_owner_supplied");
      }
      break;
    case "boolean":
      if (!booleanMentioned(input.owner_request, field, value.boolean_value)) {
        fail("field_value_not_owner_supplied");
      }
      break;
    case "date":
      if (!dateMentioned(input.owner_request, value.date_value)) {
        fail("field_value_not_owner_supplied");
      }
      break;
    case "datetime":
      if (!input.owner_request.includes(value.datetime_value)) {
        fail("field_value_not_owner_supplied");
      }
      break;
    case "select":
    case "status": {
      const options = field.settings.options ?? [];
      const option = options.find(
        (candidate) => normalize(candidate) === normalize(value.option_value),
      );
      if (!option) {
        fail("option_invalid");
      }
      if (!phraseInText(input.owner_request, value.option_value)) {
        fail("field_value_not_owner_supplied");
      }
      break;
    }
    case "multi_select": {
      const options = field.settings.options ?? [];
      const normalized = value.option_values.map(normalize);
      if (new Set(normalized).size !== normalized.length) {
        fail("option_duplicate");
      }
      for (const optionValue of value.option_values) {
        if (
          !options.some(
            (candidate) => normalize(candidate) === normalize(optionValue),
          )
        ) {
          fail("option_invalid");
        }
        if (!phraseInText(input.owner_request, optionValue)) {
          fail("field_value_not_owner_supplied");
        }
      }
      break;
    }
  }
}

function validateRequiredFields(
  object: ReturnType<typeof targetObject>,
  values: readonly BuilderRecordCreationFieldValue[],
): void {
  const present = new Set(values.map((value) => value.field_key));
  for (const field of object.fields) {
    if (
      field.is_active &&
      field.required &&
      !field.has_default &&
      !present.has(field.key)
    ) {
      fail("required_field_missing");
    }
  }
}

export function validateBuilderRecordCreationIntentInput(
  input: unknown,
): BuilderRecordCreationIntentTaskInput {
  const parsed = validateInputContract(input);
  validateReadyPlan(parsed);
  return parsed;
}

export function validateBuilderRecordCreationIntentOutput(
  input: unknown,
  parsedOutput: unknown,
): BuilderRecordCreationIntentOutput {
  const parsedInput = validateBuilderRecordCreationIntentInput(input);
  const planInfo = validateReadyPlan(parsedInput);
  const output =
    builderRecordCreationIntentOutputSchema.safeParse(parsedOutput);
  if (!output.success) {
    fail("output_contract_invalid");
  }
  validateSourceStep(
    parsedInput,
    output.data.source_step_references,
    planInfo.step.reference,
  );
  if (output.data.state === "needs_clarification") {
    return output.data;
  }
  if (output.data.object_key !== planInfo.concept.existing_object_key) {
    fail("target_object_unknown_or_inactive");
  }
  const object = targetObject(parsedInput, output.data.object_key);
  if (output.data.field_values.length < 1) {
    fail("field_values_empty");
  }
  for (const value of output.data.field_values) {
    validateFieldValue(parsedInput, object, value);
  }
  validateRequiredFields(object, output.data.field_values);
  return output.data;
}

export function parseRecordCreationIntentReady(
  input: unknown,
  output: unknown,
): BuilderRecordCreationIntentReady {
  const validated = validateBuilderRecordCreationIntentOutput(input, output);
  if (validated.state !== "ready") {
    fail("output_contract_invalid");
  }
  return validated;
}

export function parseRecordCreationFieldValue(
  input: unknown,
): BuilderRecordCreationFieldValue {
  const parsed = builderRecordCreationFieldValueSchema.safeParse(input);
  if (!parsed.success) {
    fail("output_contract_invalid");
  }
  return parsed.data;
}
