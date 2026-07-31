import { z } from "zod";

import type { AiBusinessModelContextV1 } from "../context/schemas";
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

function issue(message: string, path: PropertyKey[] = []): z.ZodError {
  return new z.ZodError([
    {
      code: "custom",
      message,
      path,
      input: undefined,
    },
  ]);
}

function requireUnique(
  values: readonly string[],
  label: string,
  path: PropertyKey[],
): void {
  if (new Set(values).size !== values.length) {
    throw issue(`${label} must be unique.`, path);
  }
}

function validateQuestions(output: BuilderPlanOutput): void {
  if (output.state !== "needs_clarification") {
    return;
  }
  requireUnique(
    output.questions.map(({ reference }) => reference),
    "Question references",
    ["questions"],
  );
  for (const [index, question] of output.questions.entries()) {
    if (question.response_style !== "free_text") {
      requireUnique(
        question.options.map((option) => option.toLocaleLowerCase("en")),
        "Question options",
        ["questions", index, "options"],
      );
    }
  }
}

function validateAssumptions(output: BuilderPlanOutput): void {
  requireUnique(
    output.assumptions.map(({ reference }) => reference),
    "Assumption references",
    ["assumptions"],
  );
  if (
    output.state === "ready" &&
    output.assumptions.some(
      (assumption) =>
        assumption.impact === "high" && !assumption.requires_owner_confirmation,
    )
  ) {
    throw issue(
      "A high-impact ready-plan assumption requires owner confirmation.",
      ["assumptions"],
    );
  }
}

function validateUnsupported(output: BuilderPlanOutput): void {
  requireUnique(
    output.unsupported_requirements.map(({ reference }) => reference),
    "Unsupported-requirement references",
    ["unsupported_requirements"],
  );
  if (
    output.state === "ready" &&
    output.unsupported_requirements.length !== 0
  ) {
    throw issue(
      "A ready plan cannot contain an unresolved unsupported requirement.",
      ["unsupported_requirements"],
    );
  }
}

function validatePlatformCompatibility(
  context: AiBusinessModelContextV1,
  step: BuilderReadyPlanStep,
  index: number,
): void {
  const capabilities = context.platform_capabilities;
  if (step.lane === "configuration") {
    const requiredOperation = configurationOperationByCategory[step.category];
    if (
      !capabilities.configuration_operation_names.includes(requiredOperation)
    ) {
      throw issue(
        "The planned configuration category is not in the supplied capability registry.",
        ["plan", "steps", index, "category"],
      );
    }
    return;
  }

  const operationalLane = capabilities.change_lanes.find(
    ({ name }) => name === "operational",
  );
  const requiredSupport = operationalSupportByCategory[step.category];
  if (!operationalLane?.supports.includes(requiredSupport)) {
    throw issue(
      "The planned operational category is not in the supplied capability registry.",
      ["plan", "steps", index, "category"],
    );
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

  requireUnique(
    output.plan.concepts.map(({ reference }) => reference),
    "Concept references",
    ["plan", "concepts"],
  );
  requireUnique(
    output.plan.user_journeys.map(({ reference }) => reference),
    "Journey references",
    ["plan", "user_journeys"],
  );
  requireUnique(
    output.plan.steps.map(({ reference }) => reference),
    "Step references",
    ["plan", "steps"],
  );

  for (const [index, concept] of output.plan.concepts.entries()) {
    if (
      concept.disposition === "existing" &&
      !objectKeys.has(concept.existing_object_key)
    ) {
      throw issue(
        "An existing concept must resolve to an Object in Business context.",
        ["plan", "concepts", index, "existing_object_key"],
      );
    }
  }

  const priorStepReferences = new Set<string>();
  for (const [index, step] of output.plan.steps.entries()) {
    if (step.sequence !== index + 1) {
      throw issue(
        "Plan step sequences must be unique and contiguous from one.",
        ["plan", "steps", index, "sequence"],
      );
    }
    requireUnique(step.dependencies, "Step dependencies", [
      "plan",
      "steps",
      index,
      "dependencies",
    ]);
    requireUnique(step.affected_concepts, "Affected concept references", [
      "plan",
      "steps",
      index,
      "affected_concepts",
    ]);
    requireUnique(step.existing_object_keys, "Existing Object keys", [
      "plan",
      "steps",
      index,
      "existing_object_keys",
    ]);
    requireUnique(step.location_references, "Location references", [
      "plan",
      "steps",
      index,
      "location_references",
    ]);

    if (
      step.dependencies.some(
        (dependency) => !priorStepReferences.has(dependency),
      )
    ) {
      throw issue("Step dependencies may refer only to earlier plan steps.", [
        "plan",
        "steps",
        index,
        "dependencies",
      ]);
    }
    if (
      step.affected_concepts.some(
        (reference) => !conceptReferences.has(reference),
      )
    ) {
      throw issue("Affected concept references must resolve within the plan.", [
        "plan",
        "steps",
        index,
        "affected_concepts",
      ]);
    }
    if (step.existing_object_keys.some((key) => !objectKeys.has(key))) {
      throw issue(
        "Planned existing Object keys must resolve in Business context.",
        ["plan", "steps", index, "existing_object_keys"],
      );
    }
    if (
      step.location_references.some(
        (reference) => !locationReferences.has(reference),
      )
    ) {
      throw issue(
        "Planned Location references must resolve in Business context.",
        ["plan", "steps", index, "location_references"],
      );
    }
    validatePlatformCompatibility(input.business_context, step, index);
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
  requireUnique(references, "All plan-local references", []);
}

export function validateBuilderPlanOutput(
  input: BuilderPlanTaskInput,
  parsedOutput: BuilderPlanOutput,
): BuilderPlanOutput {
  const output = builderPlanOutputSchema.parse(parsedOutput);
  validateQuestions(output);
  validateAssumptions(output);
  validateUnsupported(output);
  if (output.state === "ready") {
    validateReadyPlan(input, output);
  }
  validateGlobalReferences(output);
  return output;
}
