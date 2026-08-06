export const builderRecordUpdateIntentDiagnosticCodes = [
  "input_contract_invalid",
  "input_plan_invalid",
  "input_plan_not_ready",
  "input_plan_not_record_update_only",
  "input_plan_scope_invalid",
  "target_object_unknown_or_inactive",
  "target_object_platform_owned",
  "target_object_ineligible",
  "source_step_references_invalid",
  "output_contract_invalid",
  "selector_empty",
  "selector_duplicate",
  "selector_field_unknown_or_inactive",
  "selector_field_type_mismatch",
  "selector_type_not_supported",
  "selector_value_invalid",
  "selector_value_not_owner_supplied",
  "selector_option_invalid",
  "selector_option_duplicate",
  "field_updates_empty",
  "field_updates_duplicate",
  "field_unknown_or_inactive",
  "field_type_mismatch",
  "file_field_not_supported",
  "field_value_invalid",
  "field_value_not_owner_supplied",
  "option_invalid",
  "option_duplicate",
  "relative_value_unsupported",
  "selector_update_no_change",
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
  target_object_platform_owned:
    "Platform-owned Objects cannot be changed through this Record update intent.",
  target_object_ineligible:
    "The target Object is not eligible for safe Builder Record updates.",
  source_step_references_invalid:
    "The Record update intent did not cite the exact planning step.",
  output_contract_invalid:
    "The Record update intent output contract was invalid.",
  selector_empty: "The Record update intent did not contain an exact selector.",
  selector_duplicate: "The Record selector contained a duplicate Field.",
  selector_field_unknown_or_inactive:
    "The Record selector referenced an unavailable Field.",
  selector_field_type_mismatch:
    "The Record selector Field type did not match configuration.",
  selector_type_not_supported:
    "That Field type cannot be used for exact Record targeting.",
  selector_value_invalid: "The Record selector value was invalid.",
  selector_value_not_owner_supplied:
    "The Record selector value was not stated by the owner.",
  selector_option_invalid:
    "The Record selector option was not configured for the Field.",
  selector_option_duplicate:
    "The Record selector contained a duplicate option.",
  field_updates_empty: "The Record update did not contain a new Field value.",
  field_updates_duplicate: "The Record update contained a duplicate Field.",
  field_unknown_or_inactive: "The Record update Field is unavailable.",
  field_type_mismatch:
    "The Record update Field type did not match configuration.",
  file_field_not_supported: "File Fields are not writable through Builder.",
  field_value_invalid: "The Record update value was invalid.",
  field_value_not_owner_supplied:
    "The Record update value was not stated by the owner.",
  option_invalid: "The Record update option was not configured for the Field.",
  option_duplicate: "The Record update contained a duplicate option.",
  relative_value_unsupported:
    "Record updates require an explicit absolute new value.",
  selector_update_no_change:
    "A Field cannot be selected and set to the same value.",
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
