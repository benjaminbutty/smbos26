import { z } from "zod";

import { aiExecutionErrorCodes } from "../../errors";
import {
  BUILDER_LOCATION_CREATION_TERRA_MEDIUM_POLICY_KEY,
  OPENAI_BUILDER_LOCATION_CREATION_MODEL_KEY,
  OPENAI_BUILDER_LOCATION_CREATION_REASONING_EFFORT,
} from "../../policies";

export const builderLocationCreationEvaluationScenarioIdSchema = z.enum([
  "explicit_timezone",
  "business_timezone",
  "alternate_wording",
  "active_duplicate",
  "inactive_duplicate",
  "missing_name",
  "local_timezone_without_iana",
  "multi_word_identity",
]);

export const builderLocationCreationEvaluationFailureClassSchema = z.enum([
  "output_contract",
  "semantic_validation",
  "scenario_expectation",
  "provider_execution",
  "evaluation_setup",
  "unknown",
]);

export const builderLocationCreationEvaluationFailedGateCodeSchema = z.enum([
  "output_contract",
  "semantic_validation",
  "scenario_expectation",
  "expected_state",
  "expected_name",
  "expected_timezone_intent",
  "explicit_timezone_not_in_request",
  "duplicate_was_ready",
  "provider_execution",
  "usage_incomplete",
  "unknown_output",
]);

const safeExecutionErrorCodeSchema = z.enum([
  ...aiExecutionErrorCodes,
  "evaluation_execution_failed",
] as const);

export const builderLocationCreationEvaluationSetupReasonSchema = z.enum([
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

const reportMetadata = {
  scenario_id: builderLocationCreationEvaluationScenarioIdSchema,
  repetition: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  passed: z.boolean(),
  output_state: z.enum(["ready", "needs_clarification"]).nullable(),
  timezone_intent: z
    .enum(["explicit_timezone", "use_business_timezone"])
    .nullable(),
  failure_class: builderLocationCreationEvaluationFailureClassSchema.nullable(),
  failed_gate_codes: z
    .array(builderLocationCreationEvaluationFailedGateCodeSchema)
    .max(10),
  attempts: z.number().int().nonnegative().max(5),
  usage_complete: z.boolean(),
  input_tokens: z.number().int().nonnegative().max(5_000_000_000),
  output_tokens: z.number().int().nonnegative().max(5_000_000_000),
  estimated_microusd: z.number().int().nonnegative().max(1_000_000_000),
  elapsed_ms: z.number().int().nonnegative().max(120_000),
  error_code: safeExecutionErrorCodeSchema.nullable(),
};

export const builderLocationCreationEvaluationReportSchema = z
  .object(reportMetadata)
  .strict();

export const builderLocationCreationEvaluationAggregateBaseSchema = z
  .object({
    schema_version: z.literal(1),
    model_key: z.literal(OPENAI_BUILDER_LOCATION_CREATION_MODEL_KEY),
    policy_key: z.literal(BUILDER_LOCATION_CREATION_TERRA_MEDIUM_POLICY_KEY),
    reasoning_effort: z.literal(
      OPENAI_BUILDER_LOCATION_CREATION_REASONING_EFFORT,
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

export const builderLocationCreationEvaluationQualificationAggregateSchema =
  builderLocationCreationEvaluationAggregateBaseSchema
    .extend({ gate: z.literal("qualification") })
    .strict();

export const builderLocationCreationEvaluationReliabilityAggregateSchema =
  builderLocationCreationEvaluationAggregateBaseSchema
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
              scenario_id: builderLocationCreationEvaluationScenarioIdSchema,
              passed_count: z.number().int().nonnegative().max(3),
            })
            .strict(),
        )
        .length(8),
    })
    .strict();

export const builderLocationCreationEvaluationSetupFailureSchema = z
  .object({
    evaluation_error_code: z.literal("evaluation_setup_failed"),
    reason_code: builderLocationCreationEvaluationSetupReasonSchema,
  })
  .strict();

export type BuilderLocationCreationEvaluationScenarioId = z.infer<
  typeof builderLocationCreationEvaluationScenarioIdSchema
>;
export type BuilderLocationCreationEvaluationFailureClass = z.infer<
  typeof builderLocationCreationEvaluationFailureClassSchema
>;
export type BuilderLocationCreationEvaluationReport = z.infer<
  typeof builderLocationCreationEvaluationReportSchema
>;
export type BuilderLocationCreationEvaluationReliabilityReport =
  BuilderLocationCreationEvaluationReport;
export type BuilderLocationCreationEvaluationSetupReason = z.infer<
  typeof builderLocationCreationEvaluationSetupReasonSchema
>;
