import { z } from "zod";

import { OPENAI_BUILDER_PLANNING_MODEL_KEY } from "../policies";
import {
  builderPlanConfigurationCategorySchema,
  builderPlanOperationalCategorySchema,
  builderPlanUnsupportedReasonSchema,
} from "../planning/schemas";
import {
  builderPlanValidationDiagnosticCodes,
  type BuilderPlanValidationDiagnosticCode,
} from "../planning/diagnostics";

export const builderEvaluationScenarioIdSchema = z.enum([
  "preorder_phone_optional",
  "preorder_schedule_change",
  "corporate_catering_enquiries",
  "create_cambridge_location",
  "add_cambridge_preorder_collection",
  "automated_weekly_customer_email",
  "card_payment_at_checkout",
  "ambiguous_bookings",
]);

export const builderEvaluationScenarioSchema = z
  .object({
    id: builderEvaluationScenarioIdSchema,
    owner_request: z.string().trim().min(1).max(4_000),
    allowed_result_states: z
      .array(z.enum(["ready", "needs_clarification"]))
      .min(1)
      .max(2),
  })
  .strict();

export const builderEvaluationFailedGateCodeSchema = z.enum([
  "result_state_not_allowed",
  "ready_required",
  "clarification_required",
  "question_required",
  "configuration_step_required",
  "operational_step_forbidden",
  "configuration_step_forbidden",
  "unsupported_requirement_forbidden",
  "new_concept_required",
  "concepts_must_be_empty",
  "define_object_required",
  "define_field_required",
  "configure_form_required",
  "configure_view_required",
  "configure_page_required",
  "configure_preorder_required",
  "create_location_required",
  "location_affected_concepts_forbidden",
  "location_existing_reference_forbidden",
  "compound_order_invalid",
  "compound_dependency_required",
  "unsupported_automation_reason_required",
  "unsupported_payment_reason_required",
]);

const allCategorySchema = z.union([
  builderPlanConfigurationCategorySchema,
  builderPlanOperationalCategorySchema,
]);

export const builderEvaluationReportSchema = z
  .object({
    scenario_id: builderEvaluationScenarioIdSchema,
    passed: z.boolean(),
    result_state: z.enum(["ready", "needs_clarification"]),
    lanes: z.array(z.enum(["configuration", "operational"])).max(2),
    categories: z.array(allCategorySchema).max(20),
    unsupported_reason_codes: z
      .array(builderPlanUnsupportedReasonSchema)
      .max(20),
    question_count: z.number().int().nonnegative().max(5),
    assumption_count: z.number().int().nonnegative().max(20),
    high_impact_assumption_count: z.number().int().nonnegative().max(20),
    attempts: z.number().int().positive().max(2),
    input_tokens: z.number().int().nonnegative().max(5_000_000_000),
    output_tokens: z.number().int().nonnegative().max(5_000_000_000),
    estimated_cost_microusd: z.number().int().nonnegative(),
    elapsed_ms: z.number().int().nonnegative(),
    failed_gate_codes: z.array(builderEvaluationFailedGateCodeSchema).max(24),
  })
  .strict();

export const builderEvaluationValidationStageSchema = z.enum([
  "structural",
  "semantic",
  "unknown",
]);

export const builderEvaluationValidationReasonCodeSchema = z.enum(
  builderPlanValidationDiagnosticCodes,
);

const nonOutputAiExecutionErrorCodeSchema = z.enum([
  "ai_disabled",
  "ai_task_not_found",
  "ai_input_invalid",
  "ai_input_too_large",
  "ai_provider_unavailable",
  "ai_rate_limited",
  "ai_timeout",
  "ai_refused",
  "ai_incomplete",
  "ai_content_filtered",
  "ai_attempts_exhausted",
  "ai_execution_failed",
  "ai_budget_exceeded",
  "ai_accounting_unavailable",
  "ai_accounting_failed",
]);

export const builderEvaluationProviderFailureSchema = z.union([
  z
    .object({
      scenario_id: builderEvaluationScenarioIdSchema,
      error_code: z.literal("ai_output_invalid"),
      validation_stage: builderEvaluationValidationStageSchema,
      validation_reason_code: builderEvaluationValidationReasonCodeSchema,
    })
    .strict(),
  z
    .object({
      scenario_id: builderEvaluationScenarioIdSchema,
      error_code: nonOutputAiExecutionErrorCodeSchema,
    })
    .strict(),
]);

export const builderEvaluationTopLevelFailureSchema = z
  .object({
    evaluation_error_code: z.literal("evaluation_setup_failed"),
  })
  .strict();

export const builderEvaluationAggregateSchema = z
  .object({
    model_key: z.literal(OPENAI_BUILDER_PLANNING_MODEL_KEY),
    total_scenarios: z.literal(8),
    passed_scenarios: z.number().int().min(0).max(8),
    failed_scenarios: z.number().int().min(0).max(8),
    total_input_tokens: z.number().int().nonnegative(),
    total_output_tokens: z.number().int().nonnegative(),
    total_estimated_cost_microusd: z.number().int().nonnegative(),
    total_elapsed_ms: z.number().int().nonnegative(),
  })
  .strict();

export type BuilderEvaluationScenario = z.infer<
  typeof builderEvaluationScenarioSchema
>;
export type BuilderEvaluationScenarioId = z.infer<
  typeof builderEvaluationScenarioIdSchema
>;
export type BuilderEvaluationReport = z.infer<
  typeof builderEvaluationReportSchema
>;
export type BuilderEvaluationFailedGateCode = z.infer<
  typeof builderEvaluationFailedGateCodeSchema
>;
export type BuilderEvaluationValidationReasonCode =
  BuilderPlanValidationDiagnosticCode;
