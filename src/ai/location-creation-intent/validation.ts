import {
  isValidIanaTimezone,
  normalizeLocationName,
} from "../../core/locations/schemas";
import { validateBuilderPlanOutput } from "../planning/validation";
import type {
  BuilderPlanOutput,
  BuilderPlanTaskInput,
} from "../planning/schemas";
import {
  BuilderLocationCreationIntentValidationError,
  type BuilderLocationCreationIntentDiagnosticCode,
} from "./diagnostics";
import {
  builderLocationCreationIntentOutputSchema,
  builderLocationCreationIntentTaskInputSchema,
  type BuilderLocationCreationIntentOutput,
  type BuilderLocationCreationIntentReady,
  type BuilderLocationCreationIntentTaskInput,
} from "./schemas";

function fail(code: BuilderLocationCreationIntentDiagnosticCode): never {
  throw new BuilderLocationCreationIntentValidationError(code);
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function phraseInText(text: string, phrase: string): boolean {
  const normalizedText = normalizeText(text);
  const normalizedPhrase = normalizeText(phrase);
  return (
    Boolean(normalizedPhrase) &&
    ` ${normalizedText} `.includes(` ${normalizedPhrase} `)
  );
}

function hasDuplicateLocation(
  context: BuilderLocationCreationIntentTaskInput["business_context"],
  locationName: string,
): boolean {
  const normalized = normalizeLocationName(locationName);
  return context.locations.some(
    (location) => normalizeLocationName(location.name) === normalized,
  );
}

function requestsUnspecifiedTimezoneOverride(ownerRequest: string): boolean {
  return /\b(?:local\s+(?:time|timezone|time\s+zone)|(?:different|another)\s+(?:timezone|time\s+zone)|(?:timezone|time\s+zone)\s+(?:for|of|at))\b/i.test(
    ownerRequest,
  );
}

function validateInputContract(
  input: unknown,
): BuilderLocationCreationIntentTaskInput {
  const parsed = builderLocationCreationIntentTaskInputSchema.safeParse(input);
  if (!parsed.success) {
    fail("input_contract_invalid");
  }
  return parsed.data;
}

function validateReadyPlan(input: BuilderLocationCreationIntentTaskInput) {
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
  const step = plan.plan.steps[0];
  if (
    plan.plan.steps.length !== 1 ||
    !step ||
    step.lane !== "operational" ||
    step.category !== "create_location" ||
    !step.requires_owner_confirmation
  ) {
    fail("input_plan_not_location_creation_only");
  }
  if (
    plan.plan.concepts.length !== 0 ||
    plan.plan.user_journeys.length !== 0 ||
    plan.assumptions.length !== 0 ||
    plan.unsupported_requirements.length !== 0 ||
    step.dependencies.length !== 0 ||
    step.affected_concepts.length !== 0 ||
    step.existing_object_keys.length !== 0 ||
    step.location_references.length !== 0
  ) {
    fail("input_plan_scope_not_empty");
  }
  return { plan, step };
}

function validateSourceStep(
  input: BuilderLocationCreationIntentTaskInput,
  sourceStepReferences: readonly string[],
): void {
  const stepReference =
    input.ready_plan.state === "ready"
      ? input.ready_plan.plan.steps[0]?.reference
      : undefined;
  if (
    !stepReference ||
    sourceStepReferences.length !== 1 ||
    sourceStepReferences[0] !== stepReference
  ) {
    fail("source_step_references_invalid");
  }
}

function validateLocationName(
  input: BuilderLocationCreationIntentTaskInput,
  locationName: string,
): void {
  if (!phraseInText(input.owner_request, locationName)) {
    fail("location_name_not_in_request");
  }
  if (
    /^(?:location|another\s+location|a\s+location|new\s+location|site|branch|place|office)$/i.test(
      normalizeText(locationName),
    )
  ) {
    fail("location_name_ambiguous");
  }
  if (hasDuplicateLocation(input.business_context, locationName)) {
    fail("duplicate_location_in_context");
  }
}

function validateTimezone(
  input: BuilderLocationCreationIntentTaskInput,
  output: BuilderLocationCreationIntentReady,
): void {
  if (output.timezone_intent.kind === "use_business_timezone") {
    if (!isValidIanaTimezone(input.business_context.business.timezone)) {
      fail("timezone_invalid");
    }
    if (requestsUnspecifiedTimezoneOverride(input.owner_request)) {
      fail("timezone_implicit_or_ambiguous");
    }
    return;
  }

  if (!isValidIanaTimezone(output.timezone_intent.timezone)) {
    fail("timezone_invalid");
  }
  if (!input.owner_request.includes(output.timezone_intent.timezone)) {
    fail("timezone_not_explicit_in_request");
  }
}

export function validateBuilderLocationCreationIntentInput(
  input: unknown,
): BuilderLocationCreationIntentTaskInput {
  const parsed = validateInputContract(input);
  validateReadyPlan(parsed);
  return parsed;
}

export function validateBuilderLocationCreationIntentOutput(
  input: unknown,
  parsedOutput: unknown,
): BuilderLocationCreationIntentOutput {
  const parsedInput = validateBuilderLocationCreationIntentInput(input);
  const output =
    builderLocationCreationIntentOutputSchema.safeParse(parsedOutput);
  if (!output.success) {
    fail("output_contract_invalid");
  }

  const sourceReferences = output.data.source_step_references;
  validateSourceStep(parsedInput, sourceReferences);
  if (output.data.state === "needs_clarification") {
    return output.data;
  }

  validateLocationName(parsedInput, output.data.location_name);
  validateTimezone(parsedInput, output.data);
  return output.data;
}
