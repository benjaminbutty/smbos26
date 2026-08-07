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
import { BUILDER_RECORD_LOCATION_LINK_INTENT_SCHEMA_VERSION } from "../record-location-link-intent/schemas";
import {
  recordLocationLinkActionSchema,
  recordLocationLinkPairStateSchema,
} from "../../core/graph/record-location-availability/schemas";
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

export const BUILDER_RECORD_UPDATE_MESSAGES = Object.freeze({
  not_found:
    "No active Record matched those exact current details. Check the current value and submit the request again.",
  ambiguous:
    "More than one active Record matched that value. Use the existing operating screen to choose the correct Record.",
  ineligible:
    "This type of Record cannot be changed through Builder safely. Use its existing operating screen.",
  no_change: "This Record already has those values.",
  updated: "The Record was updated.",
} as const);

const recordUpdateSelectorPresentationSchema = z
  .object({
    field_key: graphKeySchema,
    label: z.string().trim().min(1).max(120),
    formatted_value: z.string().trim().min(1).max(5_000),
  })
  .strict();

const recordUpdateChangeRowSchema = z
  .object({
    field_key: graphKeySchema,
    label: z.string().trim().min(1).max(120),
    field_type: graphFieldTypeSchema,
    formatted_before: z.string().trim().min(1).max(5_000),
    formatted_after: z.string().trim().min(1).max(5_000),
    new_value: jsonValueSchema,
  })
  .strict();

export const builderRecordUpdateConfirmationResultSchema = z
  .object({
    schema_version: z.literal(BUILDER_ORCHESTRATION_SCHEMA_VERSION),
    state: z.literal("record_update_confirmation"),
    object_label: z.string().trim().min(1).max(120),
    selector_presentation: recordUpdateSelectorPresentationSchema,
    change_rows: z.array(recordUpdateChangeRowSchema).min(1).max(3),
    base_version_id: z.uuid(),
    head_revision: z.number().int().positive(),
    object_definition_id: z.uuid(),
    object_key: graphKeySchema,
    target_record_id: z.uuid(),
    expected_updated_at: z.string().min(1),
    data_patch: z.record(z.string(), jsonValueSchema),
    destination_view_key: graphKeySchema.nullable(),
  })
  .strict();

const builderRecordUpdateTerminalResult = <
  State extends
    | "record_update_not_found"
    | "record_update_ambiguous"
    | "record_update_ineligible"
    | "record_update_no_change",
  Message extends string,
>(
  state: State,
  message: Message,
) =>
  z
    .object({
      schema_version: z.literal(BUILDER_ORCHESTRATION_SCHEMA_VERSION),
      state: z.literal(state),
      object_label: z.string().trim().min(1).max(120),
      message: z.literal(message),
    })
    .strict();

export const builderRecordUpdateNotFoundResultSchema =
  builderRecordUpdateTerminalResult(
    "record_update_not_found",
    BUILDER_RECORD_UPDATE_MESSAGES.not_found,
  );
export const builderRecordUpdateAmbiguousResultSchema =
  builderRecordUpdateTerminalResult(
    "record_update_ambiguous",
    BUILDER_RECORD_UPDATE_MESSAGES.ambiguous,
  );
export const builderRecordUpdateIneligibleResultSchema =
  builderRecordUpdateTerminalResult(
    "record_update_ineligible",
    BUILDER_RECORD_UPDATE_MESSAGES.ineligible,
  );
export const builderRecordUpdateNoChangeResultSchema =
  builderRecordUpdateTerminalResult(
    "record_update_no_change",
    BUILDER_RECORD_UPDATE_MESSAGES.no_change,
  );

const recordLocationSelectorPresentationSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    formatted_value: z.string().trim().min(1).max(5_000),
  })
  .strict();

export const builderRecordLocationConfirmationResultSchema = z
  .object({
    schema_version: z.literal(BUILDER_ORCHESTRATION_SCHEMA_VERSION),
    state: z.literal("record_location_confirmation"),
    intent_schema_version: z.literal(
      BUILDER_RECORD_LOCATION_LINK_INTENT_SCHEMA_VERSION,
    ),
    action: recordLocationLinkActionSchema,
    object_label: z.string().trim().min(1).max(120),
    location_name: z.string().trim().min(1).max(120),
    selector_presentation: recordLocationSelectorPresentationSchema,
    object_definition_id: z.uuid(),
    object_key: graphKeySchema,
    target_record_id: z.uuid(),
    target_location_id: z.uuid(),
    expected_pair_state: recordLocationLinkPairStateSchema,
    destination_view_key: graphKeySchema.nullable(),
  })
  .strict();

export const BUILDER_RECORD_LOCATION_REASON_CODES = [
  "record_not_found",
  "record_ambiguous",
  "record_ineligible",
  "location_not_found",
  "location_inactive",
  "already_linked",
  "already_unlinked",
] as const;

export type BuilderRecordLocationReasonCode =
  (typeof BUILDER_RECORD_LOCATION_REASON_CODES)[number];

export const BUILDER_RECORD_LOCATION_MESSAGES = Object.freeze({
  record_not_found:
    "No active Record matched those exact current details. Check the current value and submit the request again.",
  record_ambiguous:
    "More than one active Record matched that value. Use the existing operating screen to choose the correct Record.",
  record_ineligible:
    "This type of Record cannot have its Location availability changed through Builder safely.",
  location_not_found: "That Location is no longer available in this Business.",
  location_inactive:
    "That Location is inactive. Activate it in Locations before making this Record available there.",
  already_linked: "That Record is already available at this Location.",
  already_unlinked: "That Record is already unavailable at this Location.",
} as const);

export const BUILDER_RECORD_LOCATION_SUCCESS_MESSAGES = Object.freeze({
  link: "The Record is now available at this Location.",
  unlink: "The Record is no longer available at this Location.",
} as const);

export const builderRecordLocationUnavailableResultSchema = z
  .object({
    schema_version: z.literal(BUILDER_ORCHESTRATION_SCHEMA_VERSION),
    state: z.literal("record_location_unavailable"),
    object_label: z.string().trim().min(1).max(120),
    reason_code: z.enum(BUILDER_RECORD_LOCATION_REASON_CODES),
    message: z.string().trim().min(1).max(240),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.message !== BUILDER_RECORD_LOCATION_MESSAGES[value.reason_code]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["message"],
        message: "The Record Location unavailable message is not fixed.",
      });
    }
  });

export const builderOrchestrationResultSchema = z.discriminatedUnion("state", [
  builderClarificationResultSchema,
  builderUnsupportedResultSchema,
  builderProposedResultSchema,
  builderLocationConfirmationResultSchema,
  builderLocationConflictResultSchema,
  builderRecordConfirmationResultSchema,
  builderRecordUpdateConfirmationResultSchema,
  builderRecordUpdateNotFoundResultSchema,
  builderRecordUpdateAmbiguousResultSchema,
  builderRecordUpdateIneligibleResultSchema,
  builderRecordUpdateNoChangeResultSchema,
  builderRecordLocationConfirmationResultSchema,
  builderRecordLocationUnavailableResultSchema,
]);

export type BuilderOrchestrationResult = z.infer<
  typeof builderOrchestrationResultSchema
>;

export type BuilderReadyPlanningOutput = Extract<
  BuilderPlanOutput,
  { state: "ready" }
>;

export type BuilderDraftOutput = BuilderConfigurationDraftOutput;
