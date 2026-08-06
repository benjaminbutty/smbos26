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
import type { RecordUpdateSelector } from "../../core/graph/record-update/schemas";

function fail(code: BuilderRecordUpdateIntentDiagnosticCode): never {
  throw new BuilderRecordUpdateIntentValidationError(code);
}

function relativeValueRequested(ownerRequest: string): boolean {
  return /\b(?:increase|decrease|raise|lower|cheaper|more\s+expensive|same\s+as|latest|most\s+recent)\b|\bby\s+\d+(?:\.\d+)?%/i.test(
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

function validateSourceStep(reference: string, stepReference: string): void {
  if (reference !== stepReference) fail("source_step_reference_invalid");
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

const selectorFieldTypes = new Set([
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
]);

function configuredOptions(field: {
  settings: { options?: string[] | undefined };
}): string[] {
  return field.settings.options ?? [];
}

function validateSelector(
  object: ReturnType<typeof targetObject>,
  selector: RecordUpdateSelector,
): void {
  const field = object.fields.find(
    (candidate) => candidate.key === selector.field_key,
  );
  if (!field || !field.is_active) {
    fail("selector_field_unknown_or_inactive");
  }
  if (field.field_type !== selector.field_type) {
    fail("selector_field_type_mismatch");
  }
  if (!selectorFieldTypes.has(field.field_type)) {
    fail("selector_type_not_supported");
  }
  if (
    (selector.field_type === "select" || selector.field_type === "status") &&
    !configuredOptions(field).includes(selector.option_value)
  ) {
    fail("selector_option_invalid");
  }
}

function validateFieldUpdates(
  object: ReturnType<typeof targetObject>,
  values: BuilderRecordUpdateIntentReady["field_updates"],
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.field_key)) fail("field_updates_duplicate");
    seen.add(value.field_key);
    if (value.field_key === "record_status") fail("field_unknown_or_inactive");
    const field = object.fields.find(
      (candidate) => candidate.key === value.field_key,
    );
    if (!field || !field.is_active) fail("field_unknown_or_inactive");
    if (field.field_type === "file") fail("file_field_not_supported");
    if (field.field_type !== value.field_type) fail("field_type_mismatch");
    if (
      (value.field_type === "select" || value.field_type === "status") &&
      !configuredOptions(field).includes(value.option_value)
    ) {
      fail("option_invalid");
    }
    if (value.field_type === "multi_select") {
      if (new Set(value.option_values).size !== value.option_values.length) {
        fail("option_duplicate");
      }
      if (
        value.option_values.some(
          (option) => !configuredOptions(field).includes(option),
        )
      ) {
        fail("option_invalid");
      }
    }
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
    output.data.source_step_reference,
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
  validateSelector(object, output.data.selector);
  validateFieldUpdates(object, output.data.field_updates);
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
