import "server-only";

export const builderPreorderAmendmentDiagnosticCodes = [
  "input_contract_invalid",
  "input_plan_invalid",
  "input_plan_not_ready",
  "input_plan_not_configuration_only",
  "input_category_not_supported",
  "output_contract_invalid",
  "output_too_large",
  "preorder_key_unknown_or_inactive",
  "preorder_key_ambiguous",
  "source_step_unknown",
  "source_step_category_mismatch",
  "source_step_uncovered",
  "source_step_scope_mismatch",
  "amendment_target_unknown",
  "amendment_target_inactive",
  "amendment_target_not_public",
  "amendment_target_ambiguous",
  "amendment_duplicate",
  "new_question_not_order",
  "new_question_label_duplicate",
  "amendment_no_changes",
] as const;

export type BuilderPreorderAmendmentDiagnosticCode =
  (typeof builderPreorderAmendmentDiagnosticCodes)[number];

export class BuilderPreorderAmendmentValidationError extends Error {
  readonly diagnosticCode: BuilderPreorderAmendmentDiagnosticCode;

  constructor(diagnosticCode: BuilderPreorderAmendmentDiagnosticCode) {
    super("The preorder amendment did not pass its bounded semantic checks.");
    this.name = "BuilderPreorderAmendmentValidationError";
    this.diagnosticCode = diagnosticCode;
  }
}
