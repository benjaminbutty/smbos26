import { z } from "zod";

import { aiExecutionErrorCodes, type AiExecutionErrorCode } from "../../errors";
import {
  builderConfigurationDraftDiagnosticCodes,
  type BuilderConfigurationDraftDiagnosticCode,
} from "../../configuration-drafting/diagnostics";
import {
  BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY,
  OPENAI_BUILDER_CONFIGURATION_DRAFTING_MODEL_KEY,
  OPENAI_BUILDER_CONFIGURATION_DRAFTING_REASONING_EFFORT,
} from "../../policies";
import type { ConfigurationDraftingSyntheticContextId } from "../../../../evaluations/fixtures/synthetic-configuration-drafting-context";

export const configurationDraftingScenarioIdSchema = z.enum([
  "catering_enquiry_full_stack",
  "customer_marketing_consent_field",
  "customer_directory_internal",
  "public_customer_contact_page",
  "equipment_maintenance_workspace",
  "supplier_quote_field_types",
  "staff_profile_cards",
  "order_detail_workspace",
]);

export const configurationDraftingContextIdSchema = z.enum([
  "rich_existing_business",
  "empty_new_business",
]);

export const configurationDraftingScenarioMetadataSchema = z
  .object({
    id: configurationDraftingScenarioIdSchema,
    owner_request: z.string().trim().min(1).max(4_000),
    context_id: configurationDraftingContextIdSchema,
  })
  .strict();

export const configurationDraftingGateFailureCodeSchema = z.enum([
  "entity_count_mismatch",
  "unexpected_entity_family",
  "object_concept_mismatch",
  "object_label_mismatch",
  "field_set_mismatch",
  "field_object_mismatch",
  "field_type_mismatch",
  "field_requiredness_mismatch",
  "field_settings_mismatch",
  "forbidden_status_field",
  "relationship_mismatch",
  "form_mismatch",
  "form_field_set_mismatch",
  "view_mismatch",
  "view_field_set_mismatch",
  "view_form_link_mismatch",
  "page_mismatch",
  "page_block_mismatch",
  "existing_reference_mismatch",
  "adjacent_scope_added",
  "usage_accounting_incomplete",
]);

export const configurationDraftingValidationStageSchema = z.enum([
  "structural",
  "semantic",
  "unknown",
]);

export const configurationDraftingValidationReasonCodeSchema = z.union([
  z.enum(builderConfigurationDraftDiagnosticCodes),
  z.literal("unknown_output_invalid"),
]);

const nonOutputAiExecutionErrorCodes = aiExecutionErrorCodes.filter(
  (code) => code !== "ai_output_invalid",
) as [
  Exclude<AiExecutionErrorCode, "ai_output_invalid">,
  ...Exclude<AiExecutionErrorCode, "ai_output_invalid">[],
];

export const configurationDraftingProviderFailureSchema = z.union([
  z
    .object({
      schema_version: z.literal(1),
      scenario_id: configurationDraftingScenarioIdSchema,
      error_code: z.literal("ai_output_invalid"),
      validation_stage: configurationDraftingValidationStageSchema,
      validation_reason_code: configurationDraftingValidationReasonCodeSchema,
    })
    .strict(),
  z
    .object({
      schema_version: z.literal(1),
      scenario_id: configurationDraftingScenarioIdSchema,
      error_code: z.enum(nonOutputAiExecutionErrorCodes),
    })
    .strict(),
]);

export const configurationDraftingReliabilityProviderFailureSchema = z.union([
  z
    .object({
      schema_version: z.literal(1),
      scenario_id: configurationDraftingScenarioIdSchema,
      repetition: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      error_code: z.literal("ai_output_invalid"),
      validation_stage: configurationDraftingValidationStageSchema,
      validation_reason_code: configurationDraftingValidationReasonCodeSchema,
    })
    .strict(),
  z
    .object({
      schema_version: z.literal(1),
      scenario_id: configurationDraftingScenarioIdSchema,
      repetition: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      error_code: z.enum(nonOutputAiExecutionErrorCodes),
    })
    .strict(),
]);

const reportMetadata = {
  schema_version: z.literal(1),
  scenario_id: configurationDraftingScenarioIdSchema,
  passed: z.boolean(),
  object_count: z.number().int().nonnegative().max(20),
  field_count: z.number().int().nonnegative().max(100),
  relationship_count: z.number().int().nonnegative().max(50),
  view_count: z.number().int().nonnegative().max(50),
  form_count: z.number().int().nonnegative().max(50),
  page_count: z.number().int().nonnegative().max(50),
  attempts: z.number().int().positive().max(2),
  usage_complete: z.boolean(),
  input_tokens: z.number().int().nonnegative().max(5_000_000_000),
  output_tokens: z.number().int().nonnegative().max(5_000_000_000),
  estimated_cost_microusd: z.number().int().nonnegative(),
  elapsed_ms: z.number().int().nonnegative(),
  failed_gate_codes: z
    .array(configurationDraftingGateFailureCodeSchema)
    .max(32),
};

export const configurationDraftingReportSchema = z
  .object(reportMetadata)
  .strict();

export const configurationDraftingReliabilityReportSchema = z
  .object({
    ...reportMetadata,
    repetition: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  })
  .strict();

export const configurationDraftingTopLevelFailureSchema = z
  .object({
    evaluation_error_code: z.literal("evaluation_setup_failed"),
  })
  .strict();

const aggregateCounters = {
  model_key: z.literal(OPENAI_BUILDER_CONFIGURATION_DRAFTING_MODEL_KEY),
  policy_key: z.literal(BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY),
  reasoning_effort: z.literal(
    OPENAI_BUILDER_CONFIGURATION_DRAFTING_REASONING_EFFORT,
  ),
  total_scenarios: z.literal(8),
  total_attempts: z.number().int().nonnegative(),
  total_input_tokens: z.number().int().nonnegative(),
  total_output_tokens: z.number().int().nonnegative(),
  total_estimated_cost_microusd: z.number().int().nonnegative(),
  total_elapsed_ms: z.number().int().nonnegative(),
};

export const configurationDraftingQualificationAggregateSchema = z
  .object({
    schema_version: z.literal(1),
    gate: z.literal("qualification"),
    ...aggregateCounters,
    passed_scenarios: z.number().int().min(0).max(8),
    failed_scenarios: z.number().int().min(0).max(8),
    structural_failure_count: z.number().int().min(0).max(8),
    semantic_failure_count: z.number().int().min(0).max(8),
    unknown_output_failure_count: z.number().int().min(0).max(8),
    scenario_gate_failure_count: z.number().int().min(0).max(8),
    provider_or_execution_failure_count: z.number().int().min(0).max(8),
  })
  .strict();

export const configurationDraftingReliabilityAggregateSchema = z
  .object({
    schema_version: z.literal(1),
    gate: z.literal("reliability"),
    ...aggregateCounters,
    repetitions_per_scenario: z.literal(3),
    total_executions: z.literal(24),
    passed_executions: z.number().int().min(0).max(24),
    failed_executions: z.number().int().min(0).max(24),
    structural_failure_count: z.number().int().min(0).max(24),
    semantic_failure_count: z.number().int().min(0).max(24),
    unknown_output_failure_count: z.number().int().min(0).max(24),
    scenario_gate_failure_count: z.number().int().min(0).max(24),
    provider_or_execution_failure_count: z.number().int().min(0).max(24),
    per_scenario_pass_counts: z
      .array(
        z
          .object({
            scenario_id: configurationDraftingScenarioIdSchema,
            passed_count: z.number().int().min(0).max(3),
          })
          .strict(),
      )
      .length(8),
  })
  .strict();

export type ConfigurationDraftingScenarioId = z.infer<
  typeof configurationDraftingScenarioIdSchema
>;
export type ConfigurationDraftingGateFailureCode = z.infer<
  typeof configurationDraftingGateFailureCodeSchema
>;
export type ConfigurationDraftingValidationReasonCode =
  BuilderConfigurationDraftDiagnosticCode | "unknown_output_invalid";
export type ConfigurationDraftingScenarioMetadata = z.infer<
  typeof configurationDraftingScenarioMetadataSchema
> & {
  context_id: ConfigurationDraftingSyntheticContextId;
};
export type ConfigurationDraftingReport = z.infer<
  typeof configurationDraftingReportSchema
>;
export type ConfigurationDraftingReliabilityReport = z.infer<
  typeof configurationDraftingReliabilityReportSchema
>;
