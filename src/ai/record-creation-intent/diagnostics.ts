export const builderRecordCreationIntentDiagnosticCodes = [
  "input_contract_invalid",
  "input_plan_invalid",
  "input_plan_not_ready",
  "input_plan_not_record_creation_only",
  "input_plan_scope_invalid",
  "target_object_unknown_or_inactive",
  "target_object_ineligible",
  "target_object_no_writable_fields",
  "source_step_references_invalid",
  "output_contract_invalid",
  "field_values_empty",
  "field_values_duplicate",
  "field_unknown_or_inactive",
  "field_type_mismatch",
  "file_field_not_supported",
  "required_field_missing",
  "field_value_invalid",
  "field_value_not_owner_supplied",
  "option_invalid",
  "option_duplicate",
] as const;

export type BuilderRecordCreationIntentDiagnosticCode =
  (typeof builderRecordCreationIntentDiagnosticCodes)[number];

const messages: Readonly<
  Record<BuilderRecordCreationIntentDiagnosticCode, string>
> = {
  input_contract_invalid: "The Record intent input contract was invalid.",
  input_plan_invalid: "The Record intent did not receive a valid Builder plan.",
  input_plan_not_ready: "The Record intent requires a ready Builder plan.",
  input_plan_not_record_creation_only:
    "The Record intent requires exactly one operational create_initial_record step.",
  input_plan_scope_invalid:
    "The Record intent plan contained unsupported scope or references.",
  target_object_unknown_or_inactive:
    "The Record intent referenced an unavailable Object.",
  target_object_ineligible:
    "The target Object is not eligible for standalone Record creation.",
  target_object_no_writable_fields: "The target Object has no writable Field.",
  source_step_references_invalid:
    "The Record intent did not cite the exact planning step.",
  output_contract_invalid: "The Record intent output contract was invalid.",
  field_values_empty:
    "The Record intent did not contain an explicit Field value.",
  field_values_duplicate:
    "The Record intent contained a duplicate Field value.",
  field_unknown_or_inactive:
    "The Record intent referenced an unavailable Field.",
  field_type_mismatch:
    "The Record intent Field type did not match configuration.",
  file_field_not_supported:
    "File Fields are not writable by this Record intent.",
  required_field_missing: "A required Field without a default was omitted.",
  field_value_invalid: "A Record Field value was invalid.",
  field_value_not_owner_supplied:
    "A Record Field value was not stated by the owner.",
  option_invalid:
    "A Record option value was not one of the configured options.",
  option_duplicate: "A Record multi-select value contained a duplicate option.",
};

export class BuilderRecordCreationIntentValidationError extends Error {
  readonly diagnosticCode: BuilderRecordCreationIntentDiagnosticCode;
  readonly code: BuilderRecordCreationIntentDiagnosticCode;

  constructor(diagnosticCode: BuilderRecordCreationIntentDiagnosticCode) {
    super(messages[diagnosticCode]);
    this.name = "BuilderRecordCreationIntentValidationError";
    this.diagnosticCode = diagnosticCode;
    this.code = diagnosticCode;
  }
}
