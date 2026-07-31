import type { AiBusinessModelContextV1 } from "../context/schemas";
import {
  BuilderPlanValidationError,
  type BuilderPlanValidationDiagnosticCode,
} from "./diagnostics";
import {
  builderPlanOutputSchema,
  type BuilderPlanOutput,
  type BuilderPlanTaskInput,
  type BuilderReadyPlanStep,
} from "./schemas";

const configurationOperationByCategory = {
  define_object: "set_object",
  define_field: "set_field",
  define_relationship: "set_relationship",
  configure_view: "set_view",
  configure_form: "set_form",
  configure_page: "set_page",
  configure_preorder: "set_preorder_experience",
} as const;

const operationalSupportByCategory = {
  create_location: "locations",
  update_location: "locations",
  create_initial_record: "records",
  update_record: "records",
  link_record_to_location: "record_to_location_connections",
} as const;

function requireUnique(
  values: readonly string[],
  diagnosticCode: BuilderPlanValidationDiagnosticCode = "duplicate_reference",
): void {
  if (new Set(values).size !== values.length) {
    throw new BuilderPlanValidationError(diagnosticCode);
  }
}

function validateQuestions(output: BuilderPlanOutput): void {
  if (output.state !== "needs_clarification") {
    return;
  }
  requireUnique(output.questions.map(({ reference }) => reference));
  for (const question of output.questions) {
    if (question.response_style !== "free_text") {
      requireUnique(
        question.options.map((option) => option.toLocaleLowerCase("en")),
        "duplicate_question_option",
      );
    }
  }
}

function validateAssumptions(output: BuilderPlanOutput): void {
  requireUnique(output.assumptions.map(({ reference }) => reference));
  if (
    output.state === "ready" &&
    output.assumptions.some(
      (assumption) =>
        assumption.impact === "high" && !assumption.requires_owner_confirmation,
    )
  ) {
    throw new BuilderPlanValidationError("high_impact_assumption_unconfirmed");
  }
}

function validateUnsupported(output: BuilderPlanOutput): void {
  requireUnique(
    output.unsupported_requirements.map(({ reference }) => reference),
  );
  if (
    output.state === "ready" &&
    output.unsupported_requirements.length !== 0
  ) {
    throw new BuilderPlanValidationError("ready_has_unsupported_requirement");
  }
}

function validatePlatformCompatibility(
  context: AiBusinessModelContextV1,
  step: BuilderReadyPlanStep,
): void {
  const capabilities = context.platform_capabilities;
  if (step.lane === "configuration") {
    const requiredOperation = configurationOperationByCategory[step.category];
    if (
      !capabilities.configuration_operation_names.includes(requiredOperation)
    ) {
      throw new BuilderPlanValidationError("category_not_supported");
    }
    return;
  }

  const operationalLane = capabilities.change_lanes.find(
    ({ name }) => name === "operational",
  );
  const requiredSupport = operationalSupportByCategory[step.category];
  if (!operationalLane?.supports.includes(requiredSupport)) {
    throw new BuilderPlanValidationError("category_not_supported");
  }
}

function validateReadyPlan(
  input: BuilderPlanTaskInput,
  output: Extract<BuilderPlanOutput, { state: "ready" }>,
): void {
  const objectKeys = new Set(
    input.business_context.objects.map(({ key }) => key),
  );
  const locationReferences = new Set(
    input.business_context.locations.map(({ reference }) => reference),
  );
  const conceptReferences = new Set(
    output.plan.concepts.map(({ reference }) => reference),
  );

  requireUnique(output.plan.concepts.map(({ reference }) => reference));
  requireUnique(output.plan.user_journeys.map(({ reference }) => reference));
  requireUnique(output.plan.steps.map(({ reference }) => reference));

  for (const concept of output.plan.concepts) {
    if (
      concept.disposition === "existing" &&
      !objectKeys.has(concept.existing_object_key)
    ) {
      throw new BuilderPlanValidationError("existing_concept_object_unknown");
    }
  }

  const priorStepReferences = new Set<string>();
  for (const [index, step] of output.plan.steps.entries()) {
    if (step.sequence !== index + 1) {
      throw new BuilderPlanValidationError("step_sequence_invalid");
    }
    requireUnique(step.dependencies);
    requireUnique(step.affected_concepts);
    requireUnique(step.existing_object_keys);
    requireUnique(step.location_references);

    if (
      step.dependencies.some(
        (dependency) => !priorStepReferences.has(dependency),
      )
    ) {
      throw new BuilderPlanValidationError("dependency_not_prior");
    }
    if (
      step.affected_concepts.some(
        (reference) => !conceptReferences.has(reference),
      )
    ) {
      throw new BuilderPlanValidationError("affected_concept_unknown");
    }
    if (step.existing_object_keys.some((key) => !objectKeys.has(key))) {
      throw new BuilderPlanValidationError("existing_object_unknown");
    }
    if (
      step.location_references.some(
        (reference) => !locationReferences.has(reference),
      )
    ) {
      throw new BuilderPlanValidationError("location_reference_unknown");
    }
    validatePlatformCompatibility(input.business_context, step);
    priorStepReferences.add(step.reference);
  }
}

function validateGlobalReferences(output: BuilderPlanOutput): void {
  const references = [
    ...output.assumptions.map(({ reference }) => reference),
    ...output.unsupported_requirements.map(({ reference }) => reference),
    ...(output.state === "needs_clarification"
      ? output.questions.map(({ reference }) => reference)
      : [
          ...output.plan.concepts.map(({ reference }) => reference),
          ...output.plan.user_journeys.map(({ reference }) => reference),
          ...output.plan.steps.map(({ reference }) => reference),
        ]),
  ];
  requireUnique(references);
}

export function validateBuilderPlanOutput(
  input: BuilderPlanTaskInput,
  parsedOutput: BuilderPlanOutput,
): BuilderPlanOutput {
  let output: BuilderPlanOutput;
  try {
    output = builderPlanOutputSchema.parse(parsedOutput);
  } catch {
    throw new BuilderPlanValidationError("output_contract_invalid");
  }
  validateQuestions(output);
  validateAssumptions(output);
  validateUnsupported(output);
  if (output.state === "ready") {
    validateReadyPlan(input, output);
  }
  validateGlobalReferences(output);
  return output;
}
