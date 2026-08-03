import type { AiBusinessModelContextV1 } from "../context/schemas";
import { BuilderPlanValidationError } from "../planning/diagnostics";
import { validateBuilderPlanOutput } from "../planning/validation";
import type { BuilderPlanTaskInput } from "../planning/schemas";
import {
  builderPlanOutputSchema,
  type BuilderPlanOutput,
} from "../planning/schemas";
import {
  BUILDER_PREORDER_AMENDMENT_MAX_OUTPUT_BYTES,
  builderPreorderAmendmentOutputSchema,
  type BuilderPreorderAmendment,
  type BuilderPreorderAmendmentOutput,
  type BuilderPreorderAmendmentTaskInput,
} from "./schemas";
import { BuilderPreorderAmendmentValidationError } from "./diagnostics";
import { resolvePreorderTarget } from "./targeting";

export { BuilderPreorderAmendmentValidationError } from "./diagnostics";

function fail(
  code: ConstructorParameters<
    typeof BuilderPreorderAmendmentValidationError
  >[0],
): never {
  throw new BuilderPreorderAmendmentValidationError(code);
}

function normalizedLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").normalize("NFKC").toLowerCase();
}

function sourceStepMap(
  input: BuilderPreorderAmendmentTaskInput,
): Map<
  string,
  Extract<BuilderPlanOutput, { state: "ready" }>["plan"]["steps"][number]
> {
  if (input.ready_plan.state !== "ready") {
    fail("input_plan_not_ready");
  }
  return new Map(
    input.ready_plan.plan.steps.map((step) => [step.reference, step]),
  );
}

function validatePlan(input: BuilderPreorderAmendmentTaskInput) {
  const parsedPlan = builderPlanOutputSchema.safeParse(input.ready_plan);
  if (!parsedPlan.success) {
    fail("input_plan_invalid");
  }
  try {
    validateBuilderPlanOutput(
      {
        schema_version: 1,
        owner_request: input.owner_request,
        business_context: input.business_context,
      } satisfies BuilderPlanTaskInput,
      parsedPlan.data,
    );
  } catch (cause) {
    if (cause instanceof BuilderPlanValidationError) {
      fail("input_plan_invalid");
    }
    fail("input_plan_invalid");
  }
  if (parsedPlan.data.state !== "ready") {
    fail("input_plan_not_ready");
  }
  const steps = parsedPlan.data.plan.steps;
  if (steps.some((step) => step.lane !== "configuration")) {
    fail("input_plan_not_configuration_only");
  }
  const accepted = new Set(["configure_preorder", "define_field"]);
  if (
    steps.some(
      (step) => step.lane !== "configuration" || !accepted.has(step.category),
    )
  ) {
    fail("input_category_not_supported");
  }
  if (!steps.some((step) => step.category === "configure_preorder")) {
    fail("input_category_not_supported");
  }
  return parsedPlan.data;
}

function validateTargetScope(input: BuilderPreorderAmendmentTaskInput): void {
  const resolution = resolvePreorderTarget(
    input.business_context,
    input.owner_request,
  );
  if (resolution.state === "ambiguous") fail("preorder_key_ambiguous");
  if (resolution.state === "unknown") fail("preorder_key_unknown_or_inactive");
  if (
    resolution.scope.preorder_key !== input.preorder_scope.preorder_key ||
    resolution.scope.selection !== input.preorder_scope.selection
  ) {
    fail("preorder_key_scope_mismatch");
  }
  activePreorder(input.business_context, input.preorder_scope.preorder_key);
}

function activePreorder(
  context: AiBusinessModelContextV1,
  preorderKey: string,
) {
  const activeExperiences = context.preorder_experiences.filter(
    ({ is_active }) => is_active,
  );
  const matches = activeExperiences.filter(
    (preorder) => preorder.key === preorderKey,
  );
  if (matches.length === 0) fail("preorder_key_unknown_or_inactive");
  if (matches.length !== 1) fail("preorder_key_ambiguous");
  return matches[0]!;
}

function validateSourceScope(
  input: BuilderPreorderAmendmentTaskInput,
  output: BuilderPreorderAmendmentOutput,
): void {
  const steps = sourceStepMap(input);
  const configure = new Set(
    [...steps.values()]
      .filter((step) => step.category === "configure_preorder")
      .map((step) => step.reference),
  );
  const defineField = new Set(
    [...steps.values()]
      .filter((step) => step.category === "define_field")
      .map((step) => step.reference),
  );
  const covered = new Set<string>();
  for (const amendment of output.amendments) {
    if (
      amendment.source_step_references.some(
        (reference) => !steps.has(reference),
      )
    ) {
      fail("source_step_unknown");
    }
    const cited = amendment.source_step_references.map((reference) =>
      steps.get(reference)!,
    );
    const citedConfigure = cited.filter(
      (step) => step.category === "configure_preorder",
    );
    const citedDefineField = cited.filter(
      (step) => step.category === "define_field",
    );
    if (amendment.type === "add_preorder_question") {
      if (citedConfigure.length === 0) fail("source_step_scope_mismatch");
      if (defineField.size > 0 && citedDefineField.length === 0) {
        fail("source_step_category_mismatch");
      }
      if (
        cited.some(
          (step) =>
            step.category !== "configure_preorder" &&
            step.category !== "define_field",
        )
      ) {
        fail("source_step_category_mismatch");
      }
    } else if (
      cited.length === 0 ||
      cited.some((step) => step.category !== "configure_preorder")
    ) {
      fail("source_step_category_mismatch");
    }
    for (const reference of amendment.source_step_references) {
      covered.add(reference);
    }
  }
  for (const reference of [...configure, ...defineField]) {
    if (!covered.has(reference)) fail("source_step_uncovered");
  }
}

function fieldForQuestion(
  context: AiBusinessModelContextV1,
  preorder: AiBusinessModelContextV1["preorder_experiences"][number],
  target: "customer" | "order",
  fieldKey: string,
) {
  const publicFields = preorder.public_fields.filter(
    (field) => field.target === target && field.field === fieldKey,
  );
  if (publicFields.length === 0) fail("amendment_target_not_public");
  if (publicFields.length !== 1) fail("amendment_target_ambiguous");
  const objectKey =
    target === "customer"
      ? preorder.customer_object_key
      : preorder.order_object_key;
  const object = context.objects.find(
    (candidate) => candidate.key === objectKey && candidate.is_active,
  );
  if (!object) fail("amendment_target_unknown");
  const fields = object.fields.filter((field) => field.key === fieldKey);
  if (fields.length === 0) fail("amendment_target_unknown");
  if (fields.length !== 1) fail("amendment_target_ambiguous");
  if (!fields[0]!.is_active) fail("amendment_target_inactive");
  return { field: publicFields[0]!, definition: fields[0]! };
}

function amendmentPropertyKey(amendment: BuilderPreorderAmendment): string {
  switch (amendment.type) {
    case "set_collection_days":
      return "schedule:days_of_week";
    case "set_collection_window":
      return "schedule:collection_window";
    case "set_slot_interval_minutes":
      return "schedule:slot_interval_minutes";
    case "set_slot_capacity":
      return "schedule:slot_capacity";
    case "set_cutoff_hours":
      return "schedule:cutoff_hours";
    case "set_booking_horizon_days":
      return "schedule:booking_horizon_days";
    case "set_existing_question_requiredness":
      return `question:${amendment.target}:${amendment.field_key}:required`;
    case "set_existing_question_label":
      return `question:${amendment.target}:${amendment.field_key}:label`;
    case "set_existing_question_help_text":
      return `question:${amendment.target}:${amendment.field_key}:help_text`;
    case "add_preorder_question":
      return `new_question:${normalizedLabel(amendment.label)}`;
  }
}

function semanticNoOp(
  context: AiBusinessModelContextV1,
  preorder: AiBusinessModelContextV1["preorder_experiences"][number],
  amendments: readonly BuilderPreorderAmendment[],
): boolean {
  const schedule = { ...preorder.schedule };
  let changed = false;
  for (const amendment of amendments) {
    switch (amendment.type) {
      case "set_collection_days":
        changed ||=
          JSON.stringify([...amendment.days_of_week].sort((a, b) => a - b)) !==
          JSON.stringify([...schedule.days_of_week].sort((a, b) => a - b));
        schedule.days_of_week = [...amendment.days_of_week];
        break;
      case "set_collection_window":
        changed ||=
          schedule.start_time !== amendment.start_time ||
          schedule.end_time !== amendment.end_time;
        schedule.start_time = amendment.start_time;
        schedule.end_time = amendment.end_time;
        break;
      case "set_slot_interval_minutes":
        changed ||=
          schedule.slot_interval_minutes !== amendment.slot_interval_minutes;
        schedule.slot_interval_minutes = amendment.slot_interval_minutes;
        break;
      case "set_slot_capacity":
        changed ||= schedule.slot_capacity !== amendment.slot_capacity;
        schedule.slot_capacity = amendment.slot_capacity;
        break;
      case "set_cutoff_hours":
        changed ||= schedule.cutoff_hours !== amendment.cutoff_hours;
        schedule.cutoff_hours = amendment.cutoff_hours;
        break;
      case "set_booking_horizon_days":
        changed ||=
          schedule.booking_horizon_days !== amendment.booking_horizon_days;
        schedule.booking_horizon_days = amendment.booking_horizon_days;
        break;
      case "set_existing_question_requiredness": {
        const current = fieldForQuestion(
          context,
          preorder,
          amendment.target,
          amendment.field_key,
        ).field;
        changed ||= current.required !== amendment.required;
        break;
      }
      case "set_existing_question_label": {
        const current = fieldForQuestion(
          context,
          preorder,
          amendment.target,
          amendment.field_key,
        ).field;
        changed ||= current.label !== amendment.label;
        break;
      }
      case "set_existing_question_help_text": {
        const current = fieldForQuestion(
          context,
          preorder,
          amendment.target,
          amendment.field_key,
        ).field;
        changed ||= (current.help_text ?? null) !== amendment.help_text;
        break;
      }
      case "add_preorder_question":
        return false;
    }
  }
  return !changed;
}

export function validateBuilderPreorderAmendmentInput(
  input: BuilderPreorderAmendmentTaskInput,
): BuilderPreorderAmendmentTaskInput {
  validatePlan(input);
  validateTargetScope(input);
  return input;
}

export function validateBuilderPreorderAmendmentOutput(
  input: BuilderPreorderAmendmentTaskInput,
  outputInput: BuilderPreorderAmendmentOutput,
): BuilderPreorderAmendmentOutput {
  const parsed = builderPreorderAmendmentOutputSchema.safeParse(outputInput);
  if (!parsed.success) fail("output_contract_invalid");
  const output = parsed.data;
  if (
    new TextEncoder().encode(JSON.stringify(output)).byteLength >
    BUILDER_PREORDER_AMENDMENT_MAX_OUTPUT_BYTES
  ) {
    fail("output_too_large");
  }
  validatePlan(input);
  validateTargetScope(input);
  validateSourceScope(input, output);
  const preorder = activePreorder(input.business_context, output.preorder_key);
  if (output.preorder_key !== input.preorder_scope.preorder_key) {
    fail("preorder_key_scope_mismatch");
  }
  const seen = new Set<string>();
  const labels = new Set(
    preorder.public_fields.map((field) => normalizedLabel(field.label)),
  );
  for (const amendment of output.amendments) {
    const propertyKey = amendmentPropertyKey(amendment);
    if (seen.has(propertyKey)) fail("amendment_duplicate");
    seen.add(propertyKey);
    if (
      amendment.type === "set_existing_question_requiredness" ||
      amendment.type === "set_existing_question_label" ||
      amendment.type === "set_existing_question_help_text"
    ) {
      fieldForQuestion(
        input.business_context,
        preorder,
        amendment.target,
        amendment.field_key,
      );
    }
    if (amendment.type === "add_preorder_question") {
      const order = input.business_context.objects.find(
        (object) =>
          object.key === preorder.order_object_key && object.is_active,
      );
      if (!order) fail("new_question_not_order");
      const label = normalizedLabel(amendment.label);
      if (labels.has(label)) fail("new_question_label_duplicate");
      labels.add(label);
    }
  }
  if (semanticNoOp(input.business_context, preorder, output.amendments)) {
    fail("amendment_no_changes");
  }
  return output;
}
