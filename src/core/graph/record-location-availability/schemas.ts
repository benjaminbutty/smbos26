import { z } from "zod";

import { graphKeySchema } from "../schemas";
import {
  recordUpdateSelectorSchema,
  type RecordUpdateSelector,
} from "../record-update/schemas";

export const RECORD_LOCATION_AVAILABILITY_SCHEMA_VERSION = 1 as const;

export const recordLocationLinkActionSchema = z.enum(["link", "unlink"]);
export const recordLocationLinkPairStateSchema = z.enum(["linked", "unlinked"]);

const targetStateBase = {
  schema_version: z.literal(RECORD_LOCATION_AVAILABILITY_SCHEMA_VERSION),
  object_key: graphKeySchema,
  singular_label: z.string().trim().min(1).max(120),
};

const notFoundStateSchema = z
  .object({
    ...targetStateBase,
    state: z.literal("not_found"),
  })
  .strict();

const ambiguousStateSchema = z
  .object({
    ...targetStateBase,
    state: z.literal("ambiguous"),
    match_count_class: z.literal("2_or_more"),
  })
  .strict();

const ineligibleStateSchema = z
  .object({
    ...targetStateBase,
    state: z.literal("ineligible"),
    reason_codes: z
      .array(
        z.enum([
          "inactive_object",
          "preorder_order_object",
          "preorder_order_item_object",
        ]),
      )
      .max(10),
  })
  .strict();

const locationNotFoundStateSchema = z
  .object({
    ...targetStateBase,
    state: z.literal("location_not_found"),
    location_id: z.uuid(),
  })
  .strict();

const locationInactiveStateSchema = z
  .object({
    ...targetStateBase,
    state: z.literal("location_inactive"),
    location_id: z.uuid(),
    location_name: z.string().trim().min(1).max(120),
  })
  .strict();

const alreadyStateSchema = z
  .object({
    ...targetStateBase,
    state: z.enum(["already_linked", "already_unlinked"]),
    location_name: z.string().trim().min(1).max(120),
  })
  .strict();

const readyStateSchema = z
  .object({
    ...targetStateBase,
    state: z.literal("ready"),
    business_id: z.uuid(),
    actor_id: z.uuid(),
    object_definition_id: z.uuid(),
    target_record_id: z.uuid(),
    target_location_id: z.uuid(),
    location_name: z.string().trim().min(1).max(120),
    location_is_active: z.boolean(),
    action: recordLocationLinkActionSchema,
    expected_pair_state: recordLocationLinkPairStateSchema,
    selector: recordUpdateSelectorSchema,
    destination_view_key: graphKeySchema.nullable(),
  })
  .strict();

export const recordLocationLinkTargetStateSchema = z.discriminatedUnion(
  "state",
  [
    notFoundStateSchema,
    ambiguousStateSchema,
    ineligibleStateSchema,
    locationNotFoundStateSchema,
    locationInactiveStateSchema,
    alreadyStateSchema,
    readyStateSchema,
  ],
);

export type RecordLocationLinkAction = z.infer<
  typeof recordLocationLinkActionSchema
>;
export type RecordLocationLinkPairState = z.infer<
  typeof recordLocationLinkPairStateSchema
>;
export type RecordLocationLinkTargetState = z.infer<
  typeof recordLocationLinkTargetStateSchema
>;
export type RecordLocationLinkReadyState = Extract<
  RecordLocationLinkTargetState,
  { state: "ready" }
>;
export type { RecordUpdateSelector };
