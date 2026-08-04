import { z } from "zod";

export const builderLocationCreationEvaluationScenarioIdSchema = z.enum([
  "explicit_timezone",
  "business_timezone",
  "alternate_wording",
  "active_duplicate",
  "inactive_duplicate",
  "missing_name",
  "different_timezone_implied",
  "neutral_business_wording",
]);

export const builderLocationCreationEvaluationReportSchema = z
  .object({
    scenario_id: builderLocationCreationEvaluationScenarioIdSchema,
    repetition: z.number().int().positive(),
    passed: z.boolean(),
    output_state: z.enum(["ready", "needs_clarification"]).nullable(),
    timezone_intent: z
      .enum(["explicit_timezone", "use_business_timezone"])
      .nullable(),
    failed_gate_codes: z
      .array(
        z.enum([
          "output_contract",
          "semantic_validation",
          "expected_state",
          "expected_name",
          "expected_timezone_intent",
          "explicit_timezone_not_in_request",
          "duplicate_was_ready",
          "provider_failure",
          "unknown_output",
        ]),
      )
      .max(10),
    attempts: z.number().int().nonnegative().max(5),
    input_tokens: z.number().int().nonnegative().max(10_000_000),
    output_tokens: z.number().int().nonnegative().max(1_000_000),
    estimated_microusd: z.number().int().nonnegative().max(1_000_000_000),
    elapsed_ms: z.number().int().nonnegative().max(120_000),
    error_code: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .nullable(),
  })
  .strict();

export type BuilderLocationCreationEvaluationScenarioId = z.infer<
  typeof builderLocationCreationEvaluationScenarioIdSchema
>;
export type BuilderLocationCreationEvaluationReport = z.infer<
  typeof builderLocationCreationEvaluationReportSchema
>;
