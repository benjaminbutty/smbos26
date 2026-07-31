export const builderPlanValidationDiagnosticCodes = [
  "duplicate_reference",
  "duplicate_question_option",
  "high_impact_assumption_unconfirmed",
  "ready_has_unsupported_requirement",
  "existing_concept_object_unknown",
  "step_sequence_invalid",
  "dependency_not_prior",
  "affected_concept_unknown",
  "existing_object_unknown",
  "location_reference_unknown",
  "category_not_supported",
  "output_contract_invalid",
  "unknown_output_invalid",
] as const;

export type BuilderPlanValidationDiagnosticCode =
  (typeof builderPlanValidationDiagnosticCodes)[number];

const internalDiagnosticMessages: Readonly<
  Record<BuilderPlanValidationDiagnosticCode, string>
> = {
  duplicate_reference: "The builder plan contained a duplicate reference.",
  duplicate_question_option:
    "The builder plan contained a duplicate question option.",
  high_impact_assumption_unconfirmed:
    "The builder plan contained an unconfirmed high-impact assumption.",
  ready_has_unsupported_requirement:
    "The ready builder plan contained an unsupported requirement.",
  existing_concept_object_unknown:
    "The builder plan referenced an unavailable existing concept Object.",
  step_sequence_invalid: "The builder plan contained an invalid step sequence.",
  dependency_not_prior:
    "The builder plan contained a dependency on a later step.",
  affected_concept_unknown:
    "The builder plan referenced an undeclared affected concept.",
  existing_object_unknown:
    "The builder plan referenced an unavailable existing Object.",
  location_reference_unknown:
    "The builder plan referenced an unavailable Location.",
  category_not_supported:
    "The builder plan requested an unavailable planning category.",
  output_contract_invalid: "The builder plan output contract was invalid.",
  unknown_output_invalid: "The builder plan output could not be classified.",
};

/**
 * Internal-only, bounded detail for planning validation.
 *
 * The diagnostic deliberately carries no model output, request text, context,
 * schema path or business value. Public AI errors and accounting never expose
 * this object.
 */
export class BuilderPlanValidationError extends Error {
  readonly diagnosticCode: BuilderPlanValidationDiagnosticCode;
  readonly code: BuilderPlanValidationDiagnosticCode;

  constructor(diagnosticCode: BuilderPlanValidationDiagnosticCode) {
    super(internalDiagnosticMessages[diagnosticCode]);
    this.name = "BuilderPlanValidationError";
    this.diagnosticCode = diagnosticCode;
    this.code = diagnosticCode;
  }
}
