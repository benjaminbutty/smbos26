export const builderConfigurationDraftDiagnosticCodes = [
  "output_contract_invalid",
  "input_plan_invalid",
  "input_plan_not_ready",
  "input_plan_not_configuration_only",
  "input_category_not_supported",
  "duplicate_local_reference",
  "draft_concept_unknown",
  "draft_concept_not_new",
  "duplicate_draft_concept",
  "draft_concept_uncovered",
  "unknown_source_step",
  "source_step_category_mismatch",
  "source_step_scope_mismatch",
  "source_step_uncovered",
  "draft_empty",
  "existing_object_unknown_or_inactive",
  "existing_field_unknown_or_inactive",
  "existing_form_unknown_or_inactive",
  "existing_view_unknown_or_inactive",
  "draft_object_unknown",
  "draft_field_unknown",
  "draft_form_unknown",
  "draft_view_unknown",
  "field_object_mismatch",
  "form_field_object_mismatch",
  "view_field_object_mismatch",
  "view_form_mismatch",
  "page_block_audience_mismatch",
  "required_create_form_field_missing",
  "duplicate_field_label_intent",
  "duplicate_view_field_reference",
  "duplicate_form_field_reference",
  "duplicate_object_label_intent",
  "cards_image_field_invalid",
  "output_too_large",
] as const;

export type BuilderConfigurationDraftDiagnosticCode =
  (typeof builderConfigurationDraftDiagnosticCodes)[number];

const internalDiagnosticMessages: Readonly<
  Record<BuilderConfigurationDraftDiagnosticCode, string>
> = {
  output_contract_invalid:
    "The configuration draft output contract was invalid.",
  input_plan_invalid: "The configuration draft input plan was invalid.",
  input_plan_not_ready: "The configuration draft input plan was not ready.",
  input_plan_not_configuration_only:
    "The configuration draft input plan was not configuration-only.",
  input_category_not_supported:
    "The configuration draft input category was not supported.",
  duplicate_local_reference:
    "The configuration draft contained a duplicate local reference.",
  draft_concept_unknown:
    "The configuration draft referenced an unknown planning concept.",
  draft_concept_not_new:
    "The configuration draft Object was not bound to a new planning concept.",
  duplicate_draft_concept:
    "The configuration draft contained more than one Object for a planning concept.",
  draft_concept_uncovered:
    "The configuration draft did not represent every new Object concept in the plan.",
  unknown_source_step:
    "The configuration draft referenced an unknown planning step.",
  source_step_category_mismatch:
    "The configuration draft referenced an incompatible planning category.",
  source_step_scope_mismatch:
    "The configuration draft source step did not authorize the referenced Object scope.",
  source_step_uncovered:
    "The configuration draft did not cover every planning step.",
  draft_empty: "The configuration draft contained no definitions.",
  existing_object_unknown_or_inactive:
    "The configuration draft referenced an unavailable Object.",
  existing_field_unknown_or_inactive:
    "The configuration draft referenced an unavailable Field.",
  existing_form_unknown_or_inactive:
    "The configuration draft referenced an unavailable Form.",
  existing_view_unknown_or_inactive:
    "The configuration draft referenced an unavailable View.",
  draft_object_unknown:
    "The configuration draft referenced an unknown draft Object.",
  draft_field_unknown:
    "The configuration draft referenced an unknown draft Field.",
  draft_form_unknown:
    "The configuration draft referenced an unknown draft Form.",
  draft_view_unknown:
    "The configuration draft referenced an unknown draft View.",
  field_object_mismatch:
    "The configuration draft Field and Object references were inconsistent.",
  form_field_object_mismatch:
    "The configuration draft Form and Field references were inconsistent.",
  view_field_object_mismatch:
    "The configuration draft View and Field references were inconsistent.",
  view_form_mismatch:
    "The configuration draft View and Form references were inconsistent.",
  page_block_audience_mismatch:
    "The configuration draft Page and block audiences were inconsistent.",
  required_create_form_field_missing:
    "The configuration draft create Form omitted a required Field.",
  duplicate_field_label_intent:
    "The configuration draft contained duplicate Field labels.",
  duplicate_view_field_reference:
    "The configuration draft contained duplicate View Field references.",
  duplicate_form_field_reference:
    "The configuration draft contained duplicate Form Field references.",
  duplicate_object_label_intent:
    "The configuration draft contained duplicate Object labels.",
  cards_image_field_invalid:
    "The configuration draft Cards image Field was invalid.",
  output_too_large: "The configuration draft output exceeded its size limit.",
};

/**
 * Internal-only, finite detail for configuration-draft validation.
 *
 * The error deliberately carries no owner request, context, labels, model
 * output, UUID, provider detail or schema path. The normal AI execution layer
 * converts it to the existing safe `ai_output_invalid` error.
 */
export class BuilderConfigurationDraftValidationError extends Error {
  readonly diagnosticCode: BuilderConfigurationDraftDiagnosticCode;
  readonly code: BuilderConfigurationDraftDiagnosticCode;

  constructor(diagnosticCode: BuilderConfigurationDraftDiagnosticCode) {
    super(internalDiagnosticMessages[diagnosticCode]);
    this.name = "BuilderConfigurationDraftValidationError";
    this.diagnosticCode = diagnosticCode;
    this.code = diagnosticCode;
  }
}
