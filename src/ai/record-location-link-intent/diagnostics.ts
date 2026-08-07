export const builderRecordLocationLinkIntentDiagnosticCodes = [
  "input_contract_invalid",
  "input_plan_invalid",
  "input_plan_not_ready",
  "input_plan_not_link_only",
  "input_plan_scope_invalid",
  "target_object_unknown_or_inactive",
  "target_object_ineligible",
  "source_step_reference_invalid",
  "location_reference_invalid",
  "output_contract_invalid",
  "selector_field_unknown_or_inactive",
  "selector_field_type_mismatch",
  "selector_type_not_supported",
  "selector_option_invalid",
] as const;

export type BuilderRecordLocationLinkIntentDiagnosticCode =
  (typeof builderRecordLocationLinkIntentDiagnosticCodes)[number];

const messages: Readonly<
  Record<BuilderRecordLocationLinkIntentDiagnosticCode, string>
> = {
  input_contract_invalid:
    "The Record availability intent input contract was invalid.",
  input_plan_invalid:
    "The Record availability intent did not receive a valid Builder plan.",
  input_plan_not_ready:
    "The Record availability intent requires a ready Builder plan.",
  input_plan_not_link_only:
    "The Record availability intent requires exactly one operational link_record_to_location step.",
  input_plan_scope_invalid:
    "The Record availability plan contained unsupported scope or references.",
  target_object_unknown_or_inactive:
    "The Record availability intent referenced an unavailable Object.",
  target_object_ineligible:
    "That Object is not eligible for safe Location availability management.",
  source_step_reference_invalid:
    "The Record availability intent did not cite the exact planning step.",
  location_reference_invalid:
    "The Record availability intent referenced an unavailable Location.",
  output_contract_invalid:
    "The Record availability intent output contract was invalid.",
  selector_field_unknown_or_inactive:
    "The Record selector referenced an unavailable Field.",
  selector_field_type_mismatch:
    "The Record selector Field type did not match configuration.",
  selector_type_not_supported:
    "That Field type cannot be used for exact Record targeting.",
  selector_option_invalid:
    "The Record selector option was not configured for the Field.",
};

export class BuilderRecordLocationLinkIntentValidationError extends Error {
  readonly diagnosticCode: BuilderRecordLocationLinkIntentDiagnosticCode;
  readonly code: BuilderRecordLocationLinkIntentDiagnosticCode;

  constructor(diagnosticCode: BuilderRecordLocationLinkIntentDiagnosticCode) {
    super(messages[diagnosticCode]);
    this.name = "BuilderRecordLocationLinkIntentValidationError";
    this.diagnosticCode = diagnosticCode;
    this.code = diagnosticCode;
  }
}
