import { z } from "zod";

import { aiBusinessModelContextV1Schema } from "../context/schemas";

export const BUILDER_PLAN_SCHEMA_VERSION = 1 as const;
export const BUILDER_PLAN_MAX_OWNER_REQUEST_CHARACTERS = 4_000;

const referenceSchema = (prefix: string) =>
  z
    .string()
    .min(1)
    .max(80)
    .regex(new RegExp(`^${prefix}_[1-9][0-9]*$`));
const ownerReadableTextSchema = z.string().trim().min(1).max(500);
const labelSchema = z.string().trim().min(1).max(120);

export const builderPlanTaskInputSchema = z
  .object({
    schema_version: z.literal(BUILDER_PLAN_SCHEMA_VERSION),
    owner_request: z
      .string()
      .trim()
      .min(1)
      .max(BUILDER_PLAN_MAX_OWNER_REQUEST_CHARACTERS),
    business_context: aiBusinessModelContextV1Schema,
  })
  .strict();

export const builderPlanAssumptionSchema = z
  .object({
    reference: referenceSchema("assumption"),
    statement: ownerReadableTextSchema,
    impact: z.enum(["low", "medium", "high"]),
    requires_owner_confirmation: z.boolean(),
  })
  .strict();

const freeTextQuestionSchema = z
  .object({
    reference: referenceSchema("question"),
    question: ownerReadableTextSchema,
    reason: ownerReadableTextSchema,
    response_style: z.literal("free_text"),
  })
  .strict();

const choiceQuestionBaseSchema = z.object({
  reference: referenceSchema("question"),
  question: ownerReadableTextSchema,
  reason: ownerReadableTextSchema,
  options: z.array(labelSchema).min(2).max(8),
});

export const builderPlanQuestionSchema = z.discriminatedUnion(
  "response_style",
  [
    freeTextQuestionSchema,
    choiceQuestionBaseSchema
      .extend({ response_style: z.literal("single_choice") })
      .strict(),
    choiceQuestionBaseSchema
      .extend({ response_style: z.literal("multiple_choice") })
      .strict(),
  ],
);

export const builderPlanUnsupportedReasonSchema = z.enum([
  "workflow_unavailable",
  "rule_engine_unavailable",
  "payment_capability_unavailable",
  "inventory_capability_unavailable",
  "external_integration_required",
  "arbitrary_code_unavailable",
  "requirement_ambiguous",
  "other_unavailable_capability",
]);

export const builderPlanUnsupportedRequirementSchema = z
  .object({
    reference: referenceSchema("unsupported"),
    requirement: ownerReadableTextSchema,
    reason_code: builderPlanUnsupportedReasonSchema,
    explanation: ownerReadableTextSchema,
  })
  .strict();

const existingConceptSchema = z
  .object({
    reference: referenceSchema("concept"),
    label: labelSchema,
    disposition: z.literal("existing"),
    existing_object_key: z.string().trim().min(1).max(80),
    purpose: ownerReadableTextSchema,
  })
  .strict();

const newConceptSchema = z
  .object({
    reference: referenceSchema("concept"),
    label: labelSchema,
    disposition: z.literal("new"),
    purpose: ownerReadableTextSchema,
  })
  .strict();

export const builderPlanConceptSchema = z.discriminatedUnion("disposition", [
  existingConceptSchema,
  newConceptSchema,
]);

export const builderPlanJourneySchema = z
  .object({
    reference: referenceSchema("journey"),
    name: labelSchema,
    actor: labelSchema,
    trigger: ownerReadableTextSchema,
    steps: z.array(ownerReadableTextSchema).min(1).max(20),
    outcome: ownerReadableTextSchema,
  })
  .strict();

export const builderPlanConfigurationCategorySchema = z.enum([
  "define_object",
  "define_field",
  "define_relationship",
  "configure_view",
  "configure_form",
  "configure_page",
  "configure_preorder",
]);

export const builderPlanOperationalCategorySchema = z.enum([
  "create_location",
  "update_location",
  "create_initial_record",
  "update_record",
  "link_record_to_location",
]);

const builderPlanStepBaseSchema = z.object({
  reference: referenceSchema("step"),
  sequence: z.number().int().positive().max(20),
  summary: ownerReadableTextSchema,
  dependencies: z.array(referenceSchema("step")).max(20),
  affected_concepts: z.array(referenceSchema("concept")).max(20),
  existing_object_keys: z
    .array(z.string().trim().min(1).max(80))
    .max(20)
    .optional(),
  location_references: z.array(z.uuid()).max(20).optional(),
  materiality: z.enum(["low", "medium", "high"]),
  requires_owner_confirmation: z.literal(true),
});

const configurationStepSchema = builderPlanStepBaseSchema
  .extend({
    lane: z.literal("configuration"),
    category: builderPlanConfigurationCategorySchema,
  })
  .strict();

const operationalStepSchema = builderPlanStepBaseSchema
  .extend({
    lane: z.literal("operational"),
    category: builderPlanOperationalCategorySchema,
  })
  .strict();

export const builderPlanStepSchema = z.discriminatedUnion("lane", [
  configurationStepSchema,
  operationalStepSchema,
]);

export const builderReadyPlanSchema = z
  .object({
    outcome: z.string().trim().min(1).max(2_000),
    concepts: z.array(builderPlanConceptSchema).max(20),
    user_journeys: z.array(builderPlanJourneySchema).max(20),
    steps: z.array(builderPlanStepSchema).min(1).max(20),
  })
  .strict();

const clarificationResultSchema = z
  .object({
    schema_version: z.literal(BUILDER_PLAN_SCHEMA_VERSION),
    state: z.literal("needs_clarification"),
    understanding: z.string().trim().min(1).max(2_000),
    known_requirements: z.array(ownerReadableTextSchema).max(20),
    assumptions: z.array(builderPlanAssumptionSchema).max(20),
    questions: z.array(builderPlanQuestionSchema).min(1).max(5),
    unsupported_requirements: z
      .array(builderPlanUnsupportedRequirementSchema)
      .max(20),
  })
  .strict();

const readyResultSchema = z
  .object({
    schema_version: z.literal(BUILDER_PLAN_SCHEMA_VERSION),
    state: z.literal("ready"),
    understanding: z.string().trim().min(1).max(2_000),
    assumptions: z.array(builderPlanAssumptionSchema).max(20),
    plan: builderReadyPlanSchema,
    unsupported_requirements: z
      .array(builderPlanUnsupportedRequirementSchema)
      .length(0),
  })
  .strict();

export const builderPlanOutputSchema = z.discriminatedUnion("state", [
  clarificationResultSchema,
  readyResultSchema,
]);

export type BuilderPlanTaskInput = z.infer<typeof builderPlanTaskInputSchema>;
export type BuilderPlanOutput = z.infer<typeof builderPlanOutputSchema>;
export type BuilderReadyPlanStep = z.infer<typeof builderPlanStepSchema>;
