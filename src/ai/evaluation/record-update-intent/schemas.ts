import { z } from "zod";

import { aiExecutionErrorCodes } from "../../errors";
import { openAiInvalidRequestReasonCodes } from "../../providers/openai-diagnostics";
import {
  BUILDER_RECORD_UPDATE_INTENT_TERRA_MEDIUM_POLICY_KEY,
  OPENAI_BUILDER_RECORD_UPDATE_INTENT_MODEL_KEY,
  OPENAI_BUILDER_RECORD_UPDATE_INTENT_REASONING_EFFORT,
} from "../../policies";
import {
  builderRecordUpdateIntentOutputSchema,
  type BuilderRecordUpdateIntentTaskInput,
} from "../../record-update-intent/schemas";

export const builderRecordUpdateEvaluationScenarioIdSchema = z.enum([
  "product_rename",
  "product_absolute_currency",
  "equipment_multi_field",
  "catering_date_budget",
  "multi_clause_selector",
  "status_option",
  "relative_value_clarification",
  "missing_target_clarification",
]);

export const builderRecordUpdateEvaluationFailureClassSchema = z.enum([
  "output_contract",
  "semantic_validation",
  "scenario_expectation",
  "provider_execution",
  "evaluation_setup",
  "unknown",
]);

export const builderRecordUpdateEvaluationFailedGateCodeSchema = z.enum([
  "output_contract",
  "semantic_validation",
  "scenario_expectation",
  "expected_state",
  "expected_object",
  "expected_selector_set",
  "expected_selector_type",
  "expected_selector_value",
  "expected_update_set",
  "expected_update_type",
  "expected_update_value",
  "source_step_coverage",
  "no_uuid",
  "no_record_data",
  "usage_incomplete",
  "provider_execution",
  "unknown_output",
]);

const validationReasonCodes = [
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

export const builderRecordUpdateEvaluationValidationReasonCodeSchema = z.union([
  z.enum(validationReasonCodes),
  z.literal("provider_invalid_response"),
  z.literal("unknown_output_invalid"),
]);

const safeExecutionErrorCodeSchema = z.enum([
  ...aiExecutionErrorCodes,
  "evaluation_execution_failed",
] as const);

export const builderRecordUpdateEvaluationProviderReasonCodeSchema = z.enum(
  openAiInvalidRequestReasonCodes,
);

export const builderRecordUpdateEvaluationScenarioSchema = z
  .object({
    id: builderRecordUpdateEvaluationScenarioIdSchema,
    owner_request: z.string().trim().min(1).max(4_000),
    expected_output: builderRecordUpdateIntentOutputSchema,
  })
  .strict();

const reportMetadata = {
  scenario_id: builderRecordUpdateEvaluationScenarioIdSchema,
  repetition: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  passed: z.boolean(),
  output_state: z.enum(["ready", "needs_clarification"]).nullable(),
  selector_count: z.number().int().nonnegative().max(3),
  update_count: z.number().int().nonnegative().max(5),
  failure_class: builderRecordUpdateEvaluationFailureClassSchema.nullable(),
  failed_gate_codes: z
    .array(builderRecordUpdateEvaluationFailedGateCodeSchema)
    .max(20),
  attempts: z.number().int().nonnegative().max(5),
  usage_complete: z.boolean(),
  input_tokens: z.number().int().nonnegative().max(5_000_000_000),
  output_tokens: z.number().int().nonnegative().max(5_000_000_000),
  estimated_microusd: z.number().int().nonnegative().max(5_000_000_000),
  elapsed_ms: z.number().int().nonnegative().max(120_000),
  error_code: safeExecutionErrorCodeSchema.nullable(),
  validation_reason_code:
    builderRecordUpdateEvaluationValidationReasonCodeSchema.nullable(),
  provider_reason_code:
    builderRecordUpdateEvaluationProviderReasonCodeSchema.nullable(),
};

export const builderRecordUpdateEvaluationReportSchema = z
  .object(reportMetadata)
  .strict();

const aggregateBase = z
  .object({
    schema_version: z.literal(1),
    model_key: z.literal(OPENAI_BUILDER_RECORD_UPDATE_INTENT_MODEL_KEY),
    policy_key: z.literal(BUILDER_RECORD_UPDATE_INTENT_TERRA_MEDIUM_POLICY_KEY),
    reasoning_effort: z.literal(
      OPENAI_BUILDER_RECORD_UPDATE_INTENT_REASONING_EFFORT,
    ),
    total_scenarios: z.literal(8),
    passed_scenarios: z.number().int().nonnegative().max(8),
    failed_scenarios: z.number().int().nonnegative().max(8),
    total_attempts: z.number().int().nonnegative(),
    total_input_tokens: z.number().int().nonnegative(),
    total_output_tokens: z.number().int().nonnegative(),
    total_estimated_cost_microusd: z.number().int().nonnegative(),
    total_elapsed_ms: z.number().int().nonnegative(),
  })
  .strict();

export const builderRecordUpdateEvaluationQualificationAggregateSchema =
  aggregateBase.extend({ gate: z.literal("qualification") }).strict();

export const builderRecordUpdateEvaluationReliabilityAggregateSchema =
  aggregateBase
    .extend({
      gate: z.literal("reliability"),
      repetitions_per_scenario: z.literal(3),
      total_executions: z.literal(24),
      passed_executions: z.number().int().nonnegative().max(24),
      failed_executions: z.number().int().nonnegative().max(24),
      per_scenario_pass_counts: z
        .array(
          z
            .object({
              scenario_id: builderRecordUpdateEvaluationScenarioIdSchema,
              passed_count: z.number().int().nonnegative().max(3),
            })
            .strict(),
        )
        .length(8),
    })
    .strict();

export const builderRecordUpdateEvaluationSetupReasonSchema = z.enum([
  "scenario_count_mismatch",
  "scenario_order_mismatch",
  "repetition_count_mismatch",
  "execution_count_mismatch",
  "task_identity_mismatch",
  "policy_identity_mismatch",
  "policy_envelope_mismatch",
  "reservation_envelope_mismatch",
  "qualification_ceiling_mismatch",
  "reliability_ceiling_mismatch",
  "dependency_initialization_failed",
]);

export const builderRecordUpdateEvaluationSetupFailureSchema = z
  .object({
    evaluation_error_code: z.literal("evaluation_setup_failed"),
    reason_code: builderRecordUpdateEvaluationSetupReasonSchema,
  })
  .strict();

export type BuilderRecordUpdateEvaluationScenarioId = z.infer<
  typeof builderRecordUpdateEvaluationScenarioIdSchema
>;
export type BuilderRecordUpdateEvaluationScenario = {
  readonly id: BuilderRecordUpdateEvaluationScenarioId;
  readonly owner_request: string;
  readonly input: BuilderRecordUpdateIntentTaskInput;
  readonly expected_output: z.infer<
    typeof builderRecordUpdateIntentOutputSchema
  >;
};
export type BuilderRecordUpdateEvaluationFailureClass = z.infer<
  typeof builderRecordUpdateEvaluationFailureClassSchema
>;
export type BuilderRecordUpdateEvaluationReport = z.infer<
  typeof builderRecordUpdateEvaluationReportSchema
>;
export type BuilderRecordUpdateEvaluationSetupReason = z.infer<
  typeof builderRecordUpdateEvaluationSetupReasonSchema
>;
