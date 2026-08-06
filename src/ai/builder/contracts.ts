import { z } from "zod";

import {
  builderConfigurationDraftOutputSchema,
  type BuilderConfigurationDraftOutput,
} from "../configuration-drafting/schemas";
import {
  builderPlanOutputSchema,
  builderPlanTaskInputSchema,
  type BuilderPlanOutput,
} from "../planning/schemas";
import {
  BUILDER_LOCATION_CREATION_INTENT_SCHEMA_VERSION,
  builderLocationCreationIntentReadySchema,
} from "../location-creation-intent/schemas";
import {
  BUILDER_RECORD_CREATION_INTENT_SCHEMA_VERSION,
  builderRecordCreationFieldValueSchema,
} from "../record-creation-intent/schemas";
import {
  graphFieldTypeSchema,
  graphKeySchema,
  jsonValueSchema,
} from "../../core/graph/schemas";

export const BUILDER_ORCHESTRATION_SCHEMA_VERSION = 1 as const;
export const BUILDER_ORCHESTRATION_MAX_OWNER_REQUEST_BYTES = 16 * 1024;

export const builderOrchestrationRequestSchema = z
  .object({
    businessId: z.uuid(),
    ownerRequest: builderPlanTaskInputSchema.shape.owner_request,
  })
  .strict();

export type BuilderOrchestrationRequest = z.infer<
  typeof builderOrchestrationRequestSchema
>;

export type NeedsClarificationPlanningOutput = Extract<
  BuilderPlanOutput,
  { state: "needs_clarification" }
>;

const clarificationPlanningOutputSchema = builderPlanOutputSchema.superRefine(
  (value, context) => {
    if (value.state !== "needs_clarification") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The Builder clarification result must need clarification.",
      });
    }
  },
);

export const builderClarificationResultSchema = z
  .object({
    schema_version: z.literal(BUILDER_ORCHESTRATION_SCHEMA_VERSION),
    state: z.literal("needs_clarification"),
    clarification: clarificationPlanningOutputSchema,
  })
  .strict();

export const BUILDER_UNSUPPORTED_MESSAGES = Object.freeze({
  operational_plan_unavailable:
    "This request needs an operational change that Builder cannot apply in this phase.",
  mixed_plan_unavailable:
    "This request combines configuration and operational work that Builder cannot complete in one proposal.",
  configuration_category_unavailable:
    "This request includes a configuration category that Builder cannot prepare in this phase.",
} as const);

export const builderUnsupportedResultSchema = z
  .object({
    schema_version: z.literal(BUILDER_ORCHESTRATION_SCHEMA_VERSION),
    state: z.literal("unsupported"),
    reason_code: z.enum([
      "operational_plan_unavailable",
      "mixed_plan_unavailable",
      "configuration_category_unavailable",
    ]),
    message: z.string().min(1).max(240),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.message !== BUILDER_UNSUPPORTED_MESSAGES[value.reason_code]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["message"],
        message: "The Builder unsupported message is not fixed.",
      });
    }
  });

export const builderProposedResultSchema = z
  .object({
    schema_version: z.literal(BUILDER_ORCHESTRATION_SCHEMA_VERSION),
    state: z.literal("proposed"),
    proposal_id: z.uuid(),
    status: z.literal("proposed"),
    base_version_id: z.uuid(),
    base_head_revision: z.number().int().positive(),
    operation_count: z.number().int().min(1).max(100),
    summary: builderConfigurationDraftOutputSchema.shape.summary,
  })
  .strict();

export const builderLocationConfirmationResultSchema = z
  .object({
    schema_version: z.literal(BUILDER_ORCHESTRATION_SCHEMA_VERSION),
    state: z.literal("location_confirmation"),
    intent_schema_version: z.literal(
      BUILDER_LOCATION_CREATION_INTENT_SCHEMA_VERSION,
    ),
    location_name: builderLocationCreationIntentReadySchema.shape.location_name,
    timezone: z.string().trim().min(1).max(80),
    timezone_source: z.enum(["business_timezone", "explicit_timezone"]),
    business_timezone: z.string().trim().min(1).max(80),
    location_state_digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const builderLocationConflictResultSchema = z
  .object({
    schema_version: z.literal(BUILDER_ORCHESTRATION_SCHEMA_VERSION),
    state: z.literal("location_conflict"),
    location_name: builderLocationCreationIntentReadySchema.shape.location_name,
    duplicate_kind: z.enum(["active", "inactive"]),
  })
  .strict();

const recordConfirmationFieldSchema = z
  .object({
    field_key: graphKeySchema,
    label: z.string().trim().min(1).max(120),
    field_type: graphFieldTypeSchema,
    value: jsonValueSchema,
    formatted_value: z.string().trim().min(1).max(5_000),
    source: z.enum(["explicit", "default"]),
  })
  .strict();

export const builderRecordConfirmationResultSchema = z
  .object({
    schema_version: z.literal(BUILDER_ORCHESTRATION_SCHEMA_VERSION),
    state: z.literal("record_confirmation"),
    intent_schema_version: z.literal(
      BUILDER_RECORD_CREATION_INTENT_SCHEMA_VERSION,
    ),
    object_key: graphKeySchema,
    object_label: z.string().trim().min(1).max(120),
    explicit_fields: z.array(recordConfirmationFieldSchema).min(1).max(50),
    default_fields: z.array(recordConfirmationFieldSchema).max(100),
    field_values: z.array(builderRecordCreationFieldValueSchema).min(1).max(50),
    base_version_id: z.uuid(),
    head_revision: z.number().int().positive(),
    object_schema_digest: z.string().regex(/^[a-f0-9]{64}$/),
    record_state_digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const builderOrchestrationResultSchema = z.discriminatedUnion("state", [
  builderClarificationResultSchema,
  builderUnsupportedResultSchema,
  builderProposedResultSchema,
  builderLocationConfirmationResultSchema,
  builderLocationConflictResultSchema,
  builderRecordConfirmationResultSchema,
]);

export type BuilderOrchestrationResult = z.infer<
  typeof builderOrchestrationResultSchema
>;

export type BuilderReadyPlanningOutput = Extract<
  BuilderPlanOutput,
  { state: "ready" }
>;

export type BuilderDraftOutput = BuilderConfigurationDraftOutput;
