export const builderLocationCreationIntentDiagnosticCodes = [
  "input_contract_invalid",
  "input_plan_invalid",
  "input_plan_not_ready",
  "input_plan_not_location_creation_only",
  "input_plan_scope_not_empty",
  "source_step_references_invalid",
  "location_name_not_in_request",
  "location_name_ambiguous",
  "duplicate_location_in_context",
  "timezone_intent_invalid",
  "timezone_not_explicit_in_request",
  "timezone_invalid",
  "timezone_implicit_or_ambiguous",
  "output_contract_invalid",
] as const;

export type BuilderLocationCreationIntentDiagnosticCode =
  (typeof builderLocationCreationIntentDiagnosticCodes)[number];

const messages: Readonly<
  Record<BuilderLocationCreationIntentDiagnosticCode, string>
> = {
  input_contract_invalid: "The Location intent input contract was invalid.",
  input_plan_invalid:
    "The Location intent did not receive a valid Builder plan.",
  input_plan_not_ready: "The Location intent requires a ready Builder plan.",
  input_plan_not_location_creation_only:
    "The Location intent requires exactly one operational create_location step.",
  input_plan_scope_not_empty:
    "The Location intent plan contained unsupported scope references.",
  source_step_references_invalid:
    "The Location intent did not cite the exact planning step.",
  location_name_not_in_request:
    "The requested Location name was not stated by the owner.",
  location_name_ambiguous:
    "The requested Location name was too generic or ambiguous.",
  duplicate_location_in_context:
    "The requested Location already exists in the current Business context.",
  timezone_intent_invalid: "The Location timezone intent was invalid.",
  timezone_not_explicit_in_request:
    "The explicit Location timezone was not stated by the owner.",
  timezone_invalid:
    "The Location timezone was not a valid exact IANA timezone.",
  timezone_implicit_or_ambiguous:
    "The request implied a timezone without stating one exact valid IANA timezone.",
  output_contract_invalid: "The Location intent output contract was invalid.",
};

export class BuilderLocationCreationIntentValidationError extends Error {
  readonly diagnosticCode: BuilderLocationCreationIntentDiagnosticCode;
  readonly code: BuilderLocationCreationIntentDiagnosticCode;

  constructor(diagnosticCode: BuilderLocationCreationIntentDiagnosticCode) {
    super(messages[diagnosticCode]);
    this.name = "BuilderLocationCreationIntentValidationError";
    this.diagnosticCode = diagnosticCode;
    this.code = diagnosticCode;
  }
}
