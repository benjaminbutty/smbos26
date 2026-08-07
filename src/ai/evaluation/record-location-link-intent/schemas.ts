import { z } from "zod";

import { aiExecutionErrorCodes } from "../../errors";
import { builderRecordLocationLinkIntentDiagnosticCodes } from "../../record-location-link-intent/diagnostics";
import { builderRecordLocationLinkIntentOutputSchema } from "../../record-location-link-intent/schemas";
import {
  BUILDER_RECORD_LOCATION_LINK_INTENT_TERRA_MEDIUM_POLICY_KEY,
  OPENAI_BUILDER_RECORD_LOCATION_LINK_INTENT_MODEL_KEY,
  OPENAI_BUILDER_RECORD_LOCATION_LINK_INTENT_REASONING_EFFORT,
} from "../../policies";
import { openAiInvalidRequestReasonCodes } from "../../providers/openai-diagnostics";

export const builderRecordLocationLinkEvaluationScenarioIdSchema = z.enum([
  "product_link",
  "product_unlink",
  "equipment_link",
  "equipment_unlink",
  "alternate_availability_wording",
  "missing_record_selector",
  "inactive_location",
  "multiple_record_request",
]);

export const builderRecordLocationLinkEvaluationFailureClassSchema = z.enum([
  "output_contract",
  "semantic_validation",
  "scenario_expectation",
  "provider_execution",
  "evaluation_setup",
  "unknown",
]);

export const builderRecordLocationLinkEvaluationFailedGateCodeSchema = z.enum([
  "output_contract",
  "semantic_validation",
  "scenario_expectation",
  "expected_state",
  "expected_action",
  "expected_object",
  "expected_selector",
  "expected_location",
  "source_step_coverage",
  "no_uuid",
  "no_record_data",
  "usage_incomplete",
  "provider_execution",
  "unknown_output",
]);

export const builderRecordLocationLinkEvaluationValidationReasonCodeSchema =
  z.union([
    z.enum(builderRecordLocationLinkIntentDiagnosticCodes),
    z.literal("provider_invalid_response"),
    z.literal("unknown_output_invalid"),
  ]);

const safeExecutionErrorCodeSchema = z.enum([
  ...aiExecutionErrorCodes,
  "evaluation_execution_failed",
] as const);

export const builderRecordLocationLinkEvaluationProviderReasonCodeSchema =
  z.enum(openAiInvalidRequestReasonCodes);

export const builderRecordLocationLinkEvaluationScenarioSchema = z
  .object({
    id: builderRecordLocationLinkEvaluationScenarioIdSchema,
    owner_request: z.string().trim().min(1).max(4_000),
    expected_output: builderRecordLocationLinkIntentOutputSchema,
  })
  .strict();

const reportMetadata = {
  scenario_id: builderRecordLocationLinkEvaluationScenarioIdSchema,
  repetition: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  passed: z.boolean(),
  output_state: z.enum(["ready", "needs_clarification"]).nullable(),
  action: z.enum(["link", "unlink"]).nullable(),
  failure_class:
    builderRecordLocationLinkEvaluationFailureClassSchema.nullable(),
  failed_gate_codes: z
    .array(builderRecordLocationLinkEvaluationFailedGateCodeSchema)
    .max(20),
  attempts: z.number().int().nonnegative().max(5),
  usage_complete: z.boolean(),
  input_tokens: z.number().int().nonnegative().max(5_000_000_000),
  output_tokens: z.number().int().nonnegative().max(5_000_000_000),
  estimated_microusd: z.number().int().nonnegative().max(1_000_000_000),
  elapsed_ms: z.number().int().nonnegative().max(120_000),
  error_code: safeExecutionErrorCodeSchema.nullable(),
  validation_reason_code:
    builderRecordLocationLinkEvaluationValidationReasonCodeSchema.nullable(),
  provider_reason_code:
    builderRecordLocationLinkEvaluationProviderReasonCodeSchema.nullable(),
};

export const builderRecordLocationLinkEvaluationReportSchema = z
  .object(reportMetadata)
  .strict();

const aggregateBase = z
  .object({
    schema_version: z.literal(1),
    model_key: z.literal(OPENAI_BUILDER_RECORD_LOCATION_LINK_INTENT_MODEL_KEY),
    policy_key: z.literal(
      BUILDER_RECORD_LOCATION_LINK_INTENT_TERRA_MEDIUM_POLICY_KEY,
    ),
    reasoning_effort: z.literal(
      OPENAI_BUILDER_RECORD_LOCATION_LINK_INTENT_REASONING_EFFORT,
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

export const builderRecordLocationLinkEvaluationQualificationAggregateSchema =
  aggregateBase.extend({ gate: z.literal("qualification") }).strict();

export const builderRecordLocationLinkEvaluationReliabilityAggregateSchema =
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
              scenario_id: builderRecordLocationLinkEvaluationScenarioIdSchema,
              passed_count: z.number().int().nonnegative().max(3),
            })
            .strict(),
        )
        .length(8),
    })
    .strict();

export const builderRecordLocationLinkEvaluationSetupReasonSchema = z.enum([
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

export const builderRecordLocationLinkEvaluationSetupFailureSchema = z
  .object({
    evaluation_error_code: z.literal("evaluation_setup_failed"),
    reason_code: builderRecordLocationLinkEvaluationSetupReasonSchema,
  })
  .strict();

export type BuilderRecordLocationLinkEvaluationScenarioId = z.infer<
  typeof builderRecordLocationLinkEvaluationScenarioIdSchema
>;
export type BuilderRecordLocationLinkEvaluationScenario = {
  readonly id: BuilderRecordLocationLinkEvaluationScenarioId;
  readonly owner_request: string;
  readonly input: import("../../record-location-link-intent/schemas").BuilderRecordLocationLinkIntentTaskInput;
  readonly expected_output: z.infer<
    typeof builderRecordLocationLinkIntentOutputSchema
  >;
};
export type BuilderRecordLocationLinkEvaluationFailureClass = z.infer<
  typeof builderRecordLocationLinkEvaluationFailureClassSchema
>;
export type BuilderRecordLocationLinkEvaluationReport = z.infer<
  typeof builderRecordLocationLinkEvaluationReportSchema
>;
export type BuilderRecordLocationLinkEvaluationSetupReason = z.infer<
  typeof builderRecordLocationLinkEvaluationSetupReasonSchema
>;
