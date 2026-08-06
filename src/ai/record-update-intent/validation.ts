import { validateBuilderPlanOutput } from "../planning/validation";
import type {
  BuilderPlanOutput,
  BuilderPlanTaskInput,
} from "../planning/schemas";
import {
  BuilderRecordUpdateIntentValidationError,
  type BuilderRecordUpdateIntentDiagnosticCode,
} from "./diagnostics";
import {
  builderRecordUpdateIntentOutputSchema,
  builderRecordUpdateIntentTaskInputSchema,
  type BuilderRecordUpdateIntentOutput,
  type BuilderRecordUpdateIntentReady,
  type BuilderRecordUpdateIntentTaskInput,
} from "./schemas";
import type { RecordUpdateSelectorClause } from "../../core/graph/record-update/schemas";

function fail(code: BuilderRecordUpdateIntentDiagnosticCode): never {
  throw new BuilderRecordUpdateIntentValidationError(code);
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

function exactValueInText(text: string, value: string): boolean {
  return text.includes(value);
}

function numberMentioned(text: string, value: number): boolean {
  const alternatives = new Set([
    String(value),
    String(value).replace(".", ","),
    value.toLocaleString("en-GB"),
    value.toLocaleString("en-US"),
  ]);
  return [...alternatives].some((candidate) => {
    const escaped = candidate.replace(/[.,]/g, "[.,]");
    return new RegExp(`(^|[^0-9])${escaped}([^0-9]|$)`).test(text);
  });
}

function dateMentioned(text: string, value: string): boolean {
  if (text.includes(value)) return true;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  const monthName = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    timeZone: "UTC",
  }).format(date);
  const monthShortName = new Intl.DateTimeFormat("en-GB", {
    month: "short",
    timeZone: "UTC",
  }).format(date);
  return new RegExp(
    `\\b${day}(?:st|nd|rd|th)?\\s+(?:${monthName}|${monthShortName})\\s+${year}\\b`,
    "i",
  ).test(text);
}

function fieldPhrases(field: { key: string; label: string }): string[] {
  return [field.label, field.key.replace(/_/g, " ")]
    .map(normalize)
    .filter(
      (phrase, index, phrases) =>
        Boolean(phrase) && phrases.indexOf(phrase) === index,
    );
}

function booleanMentioned(
  text: string,
  field: { key: string; label: string },
  value: boolean,
): boolean {
  const phrases = fieldPhrases(field);
  const positiveWords = ["true", "yes", "available", "enabled", "active"];
  const negativeWords = ["false", "no", "unavailable", "disabled", "inactive"];
  const words = value ? positiveWords : negativeWords;
  return phrases.some((phrase) =>
    words.some(
      (word) =>
        phraseInText(text, `${phrase} ${word}`) ||
        phraseInText(text, `${word} ${phrase}`) ||
        phraseInText(text, `${phrase} to ${word}`) ||
        phraseInText(text, `${phrase} as ${word}`) ||
        (normalize(word).includes(normalize(phrase)) &&
          phraseInText(text, word)),
    ),
  );
}

function configuredOptions(field: {
  settings: { options?: string[] | undefined };
}): string[] {
  return field.settings.options ?? [];
}

function normalizeOption(value: string): string {
  return normalize(value);
}

function configuredOption(
  field: { settings: { options?: string[] | undefined } },
  value: string,
): string | undefined {
  const normalized = normalizeOption(value);
  return configuredOptions(field).find(
    (option) => normalizeOption(option) === normalized,
  );
}

function relativeValueRequested(ownerRequest: string): boolean {
  return /\b(?:increase|decrease|raise|lower|cheaper|more\s+expensive|add|subtract|increment|decrement|latest|most\s+recent|last|next|same\s+as|a\s+little|one\s+week|tomorrow|today|yesterday|relative)\b/i.test(
    ownerRequest,
  );
}

function validateInputContract(
  input: unknown,
): BuilderRecordUpdateIntentTaskInput {
  const parsed = builderRecordUpdateIntentTaskInputSchema.safeParse(input);
  if (!parsed.success) fail("input_contract_invalid");
  return parsed.data;
}

function validateReadyPlan(input: BuilderRecordUpdateIntentTaskInput) {
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
  if (plan.state !== "ready") fail("input_plan_not_ready");
  const [concept] = plan.plan.concepts;
  const [step] = plan.plan.steps;
  if (
    plan.plan.concepts.length !== 1 ||
    !concept ||
    concept.disposition !== "existing" ||
    plan.plan.user_journeys.length !== 0 ||
    plan.plan.steps.length !== 1 ||
    !step ||
    step.lane !== "operational" ||
    step.category !== "update_record" ||
    step.sequence !== 1 ||
    !step.requires_owner_confirmation
  ) {
    fail("input_plan_not_record_update_only");
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
  references: readonly string[],
  stepReference: string,
): void {
  if (references.length !== 1 || references[0] !== stepReference) {
    fail("source_step_references_invalid");
  }
}

function targetObject(
  input: BuilderRecordUpdateIntentTaskInput,
  objectKey: string,
) {
  const object = input.business_context.objects.find(
    (candidate) => candidate.key === objectKey,
  );
  if (!object || !object.is_active) fail("target_object_unknown_or_inactive");
  const trustedExcluded = input.business_context.preorder_experiences.some(
    (preorder) =>
      preorder.is_active &&
      (preorder.customer_object_key === object.key ||
        preorder.order_object_key === object.key ||
        preorder.order_item_object_key === object.key),
  );
  if (trustedExcluded) fail("target_object_ineligible");
  if (
    !object.fields.some(
      (field) =>
        field.is_active &&
        [
          "short_text",
          "email",
          "phone",
          "url",
          "number",
          "currency",
          "boolean",
          "date",
          "datetime",
          "select",
          "status",
        ].includes(field.field_type),
    ) ||
    !object.fields.some(
      (field) => field.is_active && field.field_type !== "file",
    )
  ) {
    fail("target_object_ineligible");
  }
  return object;
}

function validateSelectorValueGrounding(
  input: BuilderRecordUpdateIntentTaskInput,
  field: {
    key: string;
    label: string;
    settings: { options?: string[] | undefined };
  },
  clause: RecordUpdateSelectorClause,
): void {
  switch (clause.field_type) {
    case "short_text":
      if (!phraseInText(input.owner_request, clause.string_value)) {
        fail("selector_value_not_owner_supplied");
      }
      break;
    case "email":
    case "phone":
    case "url":
      if (!exactValueInText(input.owner_request, clause.string_value)) {
        fail("selector_value_not_owner_supplied");
      }
      break;
    case "number":
    case "currency":
      if (!numberMentioned(input.owner_request, clause.number_value)) {
        fail("selector_value_not_owner_supplied");
      }
      break;
    case "boolean":
      if (!booleanMentioned(input.owner_request, field, clause.boolean_value)) {
        fail("selector_value_not_owner_supplied");
      }
      break;
    case "date":
      if (!dateMentioned(input.owner_request, clause.date_value)) {
        fail("selector_value_not_owner_supplied");
      }
      break;
    case "datetime":
      if (!exactValueInText(input.owner_request, clause.datetime_value)) {
        fail("selector_value_not_owner_supplied");
      }
      break;
    case "select":
    case "status":
      if (!configuredOption(field, clause.option_value)) {
        fail("selector_option_invalid");
      }
      if (!phraseInText(input.owner_request, clause.option_value)) {
        fail("selector_value_not_owner_supplied");
      }
      break;
  }
}

function validateSelector(
  input: BuilderRecordUpdateIntentTaskInput,
  object: ReturnType<typeof targetObject>,
  clauses: readonly RecordUpdateSelectorClause[],
): void {
  if (clauses.length < 1) fail("selector_empty");
  const seen = new Set<string>();
  for (const clause of clauses) {
    if (seen.has(clause.field_key)) fail("selector_duplicate");
    seen.add(clause.field_key);
    const field = object.fields.find(
      (candidate) => candidate.key === clause.field_key,
    );
    if (!field || !field.is_active) fail("selector_field_unknown_or_inactive");
    if (field.field_type !== clause.field_type) {
      fail("selector_field_type_mismatch");
    }
    if (
      ![
        "short_text",
        "email",
        "phone",
        "url",
        "number",
        "currency",
        "boolean",
        "date",
        "datetime",
        "select",
        "status",
      ].includes(field.field_type)
    ) {
      fail("selector_type_not_supported");
    }
    validateSelectorValueGrounding(input, field, clause);
  }
}

function validateUpdateValueGrounding(
  input: BuilderRecordUpdateIntentTaskInput,
  field: {
    key: string;
    label: string;
    settings: { options?: string[] | undefined };
  },
  value: BuilderRecordUpdateIntentReady["field_updates"][number],
): void {
  switch (value.field_type) {
    case "short_text":
    case "long_text":
    case "phone":
    case "url":
      if (!phraseInText(input.owner_request, value.string_value)) {
        fail("field_value_not_owner_supplied");
      }
      break;
    case "email":
      if (!exactValueInText(input.owner_request, value.string_value)) {
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
      if (!exactValueInText(input.owner_request, value.datetime_value)) {
        fail("field_value_not_owner_supplied");
      }
      break;
    case "select":
    case "status":
      if (!configuredOption(field, value.option_value)) {
        fail("option_invalid");
      }
      if (!phraseInText(input.owner_request, value.option_value)) {
        fail("field_value_not_owner_supplied");
      }
      break;
    case "multi_select": {
      const normalized = value.option_values.map(normalizeOption);
      if (new Set(normalized).size !== normalized.length)
        fail("option_duplicate");
      for (const option of value.option_values) {
        if (!configuredOption(field, option)) fail("option_invalid");
        if (!phraseInText(input.owner_request, option)) {
          fail("field_value_not_owner_supplied");
        }
      }
      break;
    }
  }
}

function semanticallyEqual(
  selector: RecordUpdateSelectorClause,
  update: BuilderRecordUpdateIntentReady["field_updates"][number],
  field: { settings: { options?: string[] | undefined } },
): boolean {
  if (selector.field_type !== update.field_type) return false;
  switch (selector.field_type) {
    case "short_text":
      return (
        update.field_type === "short_text" &&
        normalize(selector.string_value) === normalize(update.string_value)
      );
    case "email":
    case "phone":
    case "url":
      return (
        (update.field_type === "email" ||
          update.field_type === "phone" ||
          update.field_type === "url") &&
        selector.string_value === update.string_value
      );
    case "number":
    case "currency":
      return (
        (update.field_type === "number" || update.field_type === "currency") &&
        selector.number_value === update.number_value
      );
    case "boolean":
      return (
        update.field_type === "boolean" &&
        selector.boolean_value === update.boolean_value
      );
    case "date":
      return (
        update.field_type === "date" &&
        selector.date_value === update.date_value
      );
    case "datetime":
      return (
        update.field_type === "datetime" &&
        selector.datetime_value === update.datetime_value
      );
    case "select":
    case "status":
      return (
        (update.field_type === "select" || update.field_type === "status") &&
        configuredOption(field, selector.option_value) ===
          configuredOption(field, update.option_value)
      );
  }
}

export function validateBuilderRecordUpdateIntentInput(
  input: unknown,
): BuilderRecordUpdateIntentTaskInput {
  const parsed = validateInputContract(input);
  validateReadyPlan(parsed);
  return parsed;
}

export function validateBuilderRecordUpdateIntentOutput(
  input: unknown,
  parsedOutput: unknown,
): BuilderRecordUpdateIntentOutput {
  const parsedInput = validateBuilderRecordUpdateIntentInput(input);
  const planInfo = validateReadyPlan(parsedInput);
  const output = builderRecordUpdateIntentOutputSchema.safeParse(parsedOutput);
  if (!output.success) fail("output_contract_invalid");
  validateSourceStep(
    output.data.source_step_references,
    planInfo.step.reference,
  );
  if (output.data.state === "needs_clarification") return output.data;

  if (relativeValueRequested(parsedInput.owner_request)) {
    fail("relative_value_unsupported");
  }
  if (output.data.object_key !== planInfo.concept.existing_object_key) {
    fail("target_object_unknown_or_inactive");
  }
  const object = targetObject(parsedInput, output.data.object_key);
  validateSelector(parsedInput, object, output.data.selector_clauses);
  const updateKeys = new Set<string>();
  for (const value of output.data.field_updates) {
    if (updateKeys.has(value.field_key)) fail("field_updates_duplicate");
    updateKeys.add(value.field_key);
    const field = object.fields.find(
      (candidate) => candidate.key === value.field_key,
    );
    if (!field || !field.is_active) fail("field_unknown_or_inactive");
    if (field.field_type === "file") fail("file_field_not_supported");
    if (field.field_type !== value.field_type) fail("field_type_mismatch");
    validateUpdateValueGrounding(parsedInput, field, value);
  }
  const selectorsByKey = new Map(
    output.data.selector_clauses.map((clause) => [clause.field_key, clause]),
  );
  for (const value of output.data.field_updates) {
    const selector = selectorsByKey.get(value.field_key);
    if (!selector) continue;
    const field = object.fields.find(
      (candidate) => candidate.key === value.field_key,
    )!;
    if (semanticallyEqual(selector, value, field))
      fail("selector_update_no_change");
  }
  return output.data;
}

export function parseRecordUpdateIntentReady(
  input: unknown,
  output: unknown,
): BuilderRecordUpdateIntentReady {
  const validated = validateBuilderRecordUpdateIntentOutput(input, output);
  if (validated.state !== "ready") fail("output_contract_invalid");
  return validated;
}
