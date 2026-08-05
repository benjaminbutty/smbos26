import { z } from "zod";

import { aiExecutionErrorCodes } from "../../errors";
import { openAiInvalidRequestReasonCodes } from "../../providers/openai-diagnostics";
import {
  BUILDER_RECORD_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
  OPENAI_BUILDER_RECORD_CREATION_INTENT_MODEL_KEY,
  OPENAI_BUILDER_RECORD_CREATION_INTENT_REASONING_EFFORT,
} from "../../policies";
import { builderRecordCreationIntentOutputSchema } from "../../record-creation-intent/schemas";

export const builderRecordCreationEvaluationScenarioIdSchema = z.enum([
  "product_text_currency_default",
  "equipment_boolean",
  "catering_enquiry_dates_numbers",
  "configured_options",
  "optional_fields_omitted",
  "required_field_missing",
  "contact_field_types",
  "multi_select",
]);

export const builderRecordCreationEvaluationFailureClassSchema = z.enum([
  "output_contract",
  "semantic_validation",
  "scenario_expectation",
  "provider_execution",
  "evaluation_setup",
  "unknown",
]);

export const builderRecordCreationEvaluationFailedGateCodeSchema = z.enum([
  "output_contract",
  "semantic_validation",
  "scenario_expectation",
  "expected_state",
  "expected_field_set",
  "expected_field_type",
  "expected_value",
  "default_backed_field_supplied",
  "optional_field_invented",
  "duplicate_record_scope",
  "usage_incomplete",
  "provider_execution",
  "unknown_output",
]);

export const builderRecordCreationEvaluationValidationReasonCodeSchema =
  z.union([
    z.enum([
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
    ]),
    z.literal("provider_invalid_response"),
    z.literal("unknown_output_invalid"),
  ]);

const safeExecutionErrorCodeSchema = z.enum([
  ...aiExecutionErrorCodes,
  "evaluation_execution_failed",
] as const);

export const builderRecordCreationEvaluationProviderReasonCodeSchema = z.enum(
  openAiInvalidRequestReasonCodes,
);

export const builderRecordCreationEvaluationScenarioSchema = z
  .object({
    id: builderRecordCreationEvaluationScenarioIdSchema,
    owner_request: z.string().trim().min(1).max(4_000),
    expected_output: builderRecordCreationIntentOutputSchema,
  })
  .strict();

export const builderRecordCreationEvaluationValueKindCountsSchema = z
  .object({
    text_like: z.number().int().nonnegative().max(50),
    numeric: z.number().int().nonnegative().max(50),
    boolean: z.number().int().nonnegative().max(50),
    date: z.number().int().nonnegative().max(50),
    datetime: z.number().int().nonnegative().max(50),
    single_option: z.number().int().nonnegative().max(50),
    multi_select: z.number().int().nonnegative().max(50),
  })
  .strict();

const reportMetadata = {
  scenario_id: builderRecordCreationEvaluationScenarioIdSchema,
  repetition: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  passed: z.boolean(),
  output_state: z.enum(["ready", "needs_clarification"]).nullable(),
  field_value_count: z.number().int().nonnegative().max(50),
  value_kind_counts: builderRecordCreationEvaluationValueKindCountsSchema,
  failure_class: builderRecordCreationEvaluationFailureClassSchema.nullable(),
  failed_gate_codes: z
    .array(builderRecordCreationEvaluationFailedGateCodeSchema)
    .max(20),
  attempts: z.number().int().nonnegative().max(5),
  usage_complete: z.boolean(),
  input_tokens: z.number().int().nonnegative().max(5_000_000_000),
  output_tokens: z.number().int().nonnegative().max(5_000_000_000),
  estimated_microusd: z.number().int().nonnegative().max(1_000_000_000),
  elapsed_ms: z.number().int().nonnegative().max(120_000),
  error_code: safeExecutionErrorCodeSchema.nullable(),
  validation_reason_code:
    builderRecordCreationEvaluationValidationReasonCodeSchema.nullable(),
  provider_reason_code:
    builderRecordCreationEvaluationProviderReasonCodeSchema.nullable(),
};

export const builderRecordCreationEvaluationReportSchema = z
  .object(reportMetadata)
  .strict();

export const builderRecordCreationEvaluationAggregateBaseSchema = z
  .object({
    schema_version: z.literal(1),
    model_key: z.literal(OPENAI_BUILDER_RECORD_CREATION_INTENT_MODEL_KEY),
    policy_key: z.literal(
      BUILDER_RECORD_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
    ),
    reasoning_effort: z.literal(
      OPENAI_BUILDER_RECORD_CREATION_INTENT_REASONING_EFFORT,
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

export const builderRecordCreationEvaluationQualificationAggregateSchema =
  builderRecordCreationEvaluationAggregateBaseSchema
    .extend({ gate: z.literal("qualification") })
    .strict();

export const builderRecordCreationEvaluationReliabilityAggregateSchema =
  builderRecordCreationEvaluationAggregateBaseSchema
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
              scenario_id: builderRecordCreationEvaluationScenarioIdSchema,
              passed_count: z.number().int().nonnegative().max(3),
            })
            .strict(),
        )
        .length(8),
    })
    .strict();

export const builderRecordCreationEvaluationSetupReasonSchema = z.enum([
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

export const builderRecordCreationEvaluationSetupFailureSchema = z
  .object({
    evaluation_error_code: z.literal("evaluation_setup_failed"),
    reason_code: builderRecordCreationEvaluationSetupReasonSchema,
  })
  .strict();

export type BuilderRecordCreationEvaluationScenarioId = z.infer<
  typeof builderRecordCreationEvaluationScenarioIdSchema
>;
export type BuilderRecordCreationEvaluationScenario = {
  readonly id: BuilderRecordCreationEvaluationScenarioId;
  readonly owner_request: string;
  readonly input: import("../../record-creation-intent/schemas").BuilderRecordCreationIntentTaskInput;
  readonly expected_output: z.infer<
    typeof builderRecordCreationIntentOutputSchema
  >;
};
export type BuilderRecordCreationEvaluationFailureClass = z.infer<
  typeof builderRecordCreationEvaluationFailureClassSchema
>;
export type BuilderRecordCreationEvaluationReport = z.infer<
  typeof builderRecordCreationEvaluationReportSchema
>;
export type BuilderRecordCreationEvaluationSetupReason = z.infer<
  typeof builderRecordCreationEvaluationSetupReasonSchema
>;
