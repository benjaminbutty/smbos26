export const builderRecordUpdateIntentDiagnosticCodes = [
  "input_contract_invalid",
  "input_plan_invalid",
  "input_plan_not_ready",
  "input_plan_not_record_update_only",
  "input_plan_scope_invalid",
  "target_object_unknown_or_inactive",
  "target_object_ineligible",
  "source_step_reference_invalid",
  "output_contract_invalid",
  "selector_field_unknown_or_inactive",
  "selector_field_type_mismatch",
  "selector_type_not_supported",
  "selector_option_invalid",
  "field_updates_duplicate",
  "field_unknown_or_inactive",
  "field_type_mismatch",
  "file_field_not_supported",
  "option_invalid",
  "option_duplicate",
  "relative_value_unsupported",
] as const;

export type BuilderRecordUpdateIntentDiagnosticCode =
  (typeof builderRecordUpdateIntentDiagnosticCodes)[number];

const messages: Readonly<
  Record<BuilderRecordUpdateIntentDiagnosticCode, string>
> = {
  input_contract_invalid:
    "The Record update intent input contract was invalid.",
  input_plan_invalid:
    "The Record update intent did not receive a valid Builder plan.",
  input_plan_not_ready:
    "The Record update intent requires a ready Builder plan.",
  input_plan_not_record_update_only:
    "The Record update intent requires exactly one operational update_record step.",
  input_plan_scope_invalid:
    "The Record update plan contained unsupported scope or references.",
  target_object_unknown_or_inactive:
    "The Record update intent referenced an unavailable Object.",
  target_object_ineligible:
    "The target Object is not eligible for safe Builder Record updates.",
  source_step_reference_invalid:
    "The Record update intent did not cite the exact planning step.",
  output_contract_invalid:
    "The Record update intent output contract was invalid.",
  selector_field_unknown_or_inactive:
    "The Record selector referenced an unavailable Field.",
  selector_field_type_mismatch:
    "The Record selector Field type did not match configuration.",
  selector_type_not_supported:
    "That Field type cannot be used for exact Record targeting.",
  selector_option_invalid:
    "The Record selector option was not configured for the Field.",
  field_updates_duplicate: "The Record update contained a duplicate Field.",
  field_unknown_or_inactive: "The Record update Field is unavailable.",
  field_type_mismatch:
    "The Record update Field type did not match configuration.",
  file_field_not_supported: "File Fields are not writable through Builder.",
  option_invalid: "The Record update option was not configured for the Field.",
  option_duplicate: "The Record update contained a duplicate option.",
  relative_value_unsupported:
    "Record updates require an explicit absolute new value.",
};

export class BuilderRecordUpdateIntentValidationError extends Error {
  readonly diagnosticCode: BuilderRecordUpdateIntentDiagnosticCode;
  readonly code: BuilderRecordUpdateIntentDiagnosticCode;

  constructor(diagnosticCode: BuilderRecordUpdateIntentDiagnosticCode) {
    super(messages[diagnosticCode]);
    this.name = "BuilderRecordUpdateIntentValidationError";
    this.diagnosticCode = diagnosticCode;
    this.code = diagnosticCode;
  }
}
