import { validateBuilderPlanOutput } from "../planning/validation";
import type {
  BuilderPlanOutput,
  BuilderPlanTaskInput,
} from "../planning/schemas";
import {
  BuilderRecordLocationLinkIntentValidationError,
  type BuilderRecordLocationLinkIntentDiagnosticCode,
} from "./diagnostics";
import {
  builderRecordLocationLinkIntentOutputSchema,
  builderRecordLocationLinkIntentTaskInputSchema,
  type BuilderRecordLocationLinkIntentOutput,
  type BuilderRecordLocationLinkIntentReady,
  type BuilderRecordLocationLinkIntentTaskInput,
} from "./schemas";
import {
  recordUpdateSelectorSchema,
  type RecordUpdateSelector,
} from "../../core/graph/record-update/schemas";

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

function fail(code: BuilderRecordLocationLinkIntentDiagnosticCode): never {
  throw new BuilderRecordLocationLinkIntentValidationError(code);
}

function validateInputContract(
  input: unknown,
): BuilderRecordLocationLinkIntentTaskInput {
  const parsed =
    builderRecordLocationLinkIntentTaskInputSchema.safeParse(input);
  if (!parsed.success) fail("input_contract_invalid");
  return parsed.data;
}

function validateReadyPlan(input: BuilderRecordLocationLinkIntentTaskInput) {
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
    step.category !== "link_record_to_location" ||
    step.sequence !== 1 ||
    !step.requires_owner_confirmation
  ) {
    fail("input_plan_not_link_only");
  }
  if (
    plan.assumptions.length !== 0 ||
    plan.unsupported_requirements.length !== 0 ||
    step.dependencies.length !== 0 ||
    step.affected_concepts.length !== 1 ||
    step.affected_concepts[0] !== concept.reference ||
    step.existing_object_keys.length !== 1 ||
    step.existing_object_keys[0] !== concept.existing_object_key ||
    step.location_references.length !== 1
  ) {
    fail("input_plan_scope_invalid");
  }
  return { concept, step };
}

function targetObject(
  input: BuilderRecordLocationLinkIntentTaskInput,
  objectKey: string,
) {
  const object = input.business_context.objects.find(
    (candidate) => candidate.key === objectKey,
  );
  if (!object || !object.is_active) fail("target_object_unknown_or_inactive");
  const protectedByPreorder = input.business_context.preorder_experiences.some(
    (preorder) =>
      preorder.is_active &&
      (preorder.order_object_key === object.key ||
        preorder.order_item_object_key === object.key),
  );
  if (protectedByPreorder) fail("target_object_ineligible");
  if (
    !object.fields.some(
      (field) => field.is_active && selectorFieldTypes.has(field.field_type),
    )
  ) {
    fail("target_object_ineligible");
  }
  return object;
}

function validateSelector(
  input: BuilderRecordLocationLinkIntentTaskInput,
  object: ReturnType<typeof targetObject>,
  selector: RecordUpdateSelector,
): void {
  const field = object.fields.find(
    (candidate) => candidate.key === selector.field_key,
  );
  if (!field || !field.is_active) fail("selector_field_unknown_or_inactive");
  if (field.field_type !== selector.field_type) {
    fail("selector_field_type_mismatch");
  }
  if (!selectorFieldTypes.has(field.field_type)) {
    fail("selector_type_not_supported");
  }
  if (
    (selector.field_type === "select" || selector.field_type === "status") &&
    !field.settings.options?.includes(selector.option_value)
  ) {
    fail("selector_option_invalid");
  }
}

function validateLocation(
  input: BuilderRecordLocationLinkIntentTaskInput,
  locationReference: string,
): void {
  const location = input.business_context.locations.find(
    (candidate) => candidate.reference === locationReference,
  );
  if (!location || !location.is_active) {
    fail("location_reference_invalid");
  }
}

function validateSourceStep(reference: string, stepReference: string): void {
  if (reference !== stepReference) fail("source_step_reference_invalid");
}

export function validateBuilderRecordLocationLinkIntentInput(
  input: unknown,
): BuilderRecordLocationLinkIntentTaskInput {
  const parsed = validateInputContract(input);
  validateReadyPlan(parsed);
  return parsed;
}

export function validateBuilderRecordLocationLinkIntentOutput(
  input: unknown,
  parsedOutput: unknown,
): BuilderRecordLocationLinkIntentOutput {
  const parsedInput = validateBuilderRecordLocationLinkIntentInput(input);
  const { concept, step } = validateReadyPlan(parsedInput);
  const output =
    builderRecordLocationLinkIntentOutputSchema.safeParse(parsedOutput);
  if (!output.success) fail("output_contract_invalid");
  validateSourceStep(output.data.source_step_reference, step.reference);
  if (output.data.state === "needs_clarification") return output.data;
  if (output.data.object_key !== concept.existing_object_key) {
    fail("target_object_unknown_or_inactive");
  }
  if (output.data.location_reference !== step.location_references[0]) {
    fail("location_reference_invalid");
  }
  const object = targetObject(parsedInput, output.data.object_key);
  validateSelector(
    parsedInput,
    object,
    recordUpdateSelectorSchema.parse(output.data.selector),
  );
  validateLocation(parsedInput, output.data.location_reference);
  return output.data;
}

export function parseBuilderRecordLocationLinkIntentReady(
  input: unknown,
  output: unknown,
): BuilderRecordLocationLinkIntentReady {
  const validated = validateBuilderRecordLocationLinkIntentOutput(
    input,
    output,
  );
  if (validated.state !== "ready") fail("output_contract_invalid");
  return validated;
}
