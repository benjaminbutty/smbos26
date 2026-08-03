import { z } from "zod";

import { builderPreorderAmendmentOutputSchema } from "../../preorder-amendment/schemas";

export const builderPreorderAmendmentEvaluationScenarioIdSchema = z.enum([
  "phone_optional",
  "remove_sunday",
  "cutoff_to_72",
  "remove_sunday_cutoff_72",
  "occasion_optional_short",
  "gift_message_optional_long",
  "existing_question_wording_help",
  "phone_optional_and_occasion",
]);

export const builderPreorderAmendmentEvaluationScenarioSchema = z
  .object({
    id: builderPreorderAmendmentEvaluationScenarioIdSchema,
    owner_request: z.string().trim().min(1).max(4_000),
    expected_output: builderPreorderAmendmentOutputSchema,
  })
  .strict();

export const builderPreorderAmendmentEvaluationFailedGateCodeSchema = z.enum([
  "output_contract_invalid",
  "semantic_validation_failed",
  "scenario_expectation_failed",
]);

export const builderPreorderAmendmentEvaluationReportSchema = z
  .object({
    scenario_id: builderPreorderAmendmentEvaluationScenarioIdSchema,
    passed: z.boolean(),
    amendment_count: z.number().int().nonnegative().max(12),
    amendment_types: z.array(z.string().min(1).max(80)).max(12),
    attempts: z.number().int().nonnegative().max(5),
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    estimated_cost_microusd: z.number().int().nonnegative(),
    elapsed_ms: z.number().int().nonnegative(),
    failed_gate_codes: z
      .array(builderPreorderAmendmentEvaluationFailedGateCodeSchema)
      .max(3),
  })
  .strict();

export const builderPreorderAmendmentEvaluationReliabilityReportSchema =
  builderPreorderAmendmentEvaluationReportSchema
    .extend({ repetition: z.union([z.literal(1), z.literal(2), z.literal(3)]) })
    .strict();

export const builderPreorderAmendmentEvaluationAggregateSchema = z
  .object({
    model_key: z.string().min(1).max(120),
    policy_key: z.string().min(1).max(80),
    reasoning_effort: z.literal("medium"),
    total_scenarios: z.literal(8),
    passed_scenarios: z.number().int().nonnegative().max(8),
    failed_scenarios: z.number().int().nonnegative().max(8),
    total_input_tokens: z.number().int().nonnegative(),
    total_output_tokens: z.number().int().nonnegative(),
    total_estimated_cost_microusd: z.number().int().nonnegative(),
    total_elapsed_ms: z.number().int().nonnegative(),
  })
  .strict();

export const builderPreorderAmendmentEvaluationReliabilityAggregateSchema =
  builderPreorderAmendmentEvaluationAggregateSchema
    .extend({
      repetitions_per_scenario: z.literal(3),
      total_executions: z.literal(24),
      passed_executions: z.number().int().nonnegative().max(24),
      failed_executions: z.number().int().nonnegative().max(24),
      per_scenario_pass_counts: z
        .array(
          z
            .object({
              scenario_id: builderPreorderAmendmentEvaluationScenarioIdSchema,
              passed_count: z.number().int().nonnegative().max(3),
            })
            .strict(),
        )
        .length(8),
    })
    .strict();

export type BuilderPreorderAmendmentEvaluationScenarioId = z.infer<
  typeof builderPreorderAmendmentEvaluationScenarioIdSchema
>;
export type BuilderPreorderAmendmentEvaluationScenario = z.infer<
  typeof builderPreorderAmendmentEvaluationScenarioSchema
>;
export type BuilderPreorderAmendmentEvaluationReport = z.infer<
  typeof builderPreorderAmendmentEvaluationReportSchema
>;
export type BuilderPreorderAmendmentEvaluationReliabilityReport = z.infer<
  typeof builderPreorderAmendmentEvaluationReliabilityReportSchema
>;
