import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Tables } from "../../../db/supabase/database.types";
import { graphKeySchema, jsonObjectSchema } from "../schemas";
import {
  recordUpdateCanonicalSelectorSchema,
  recordUpdateSelectorClausesSchema,
  recordUpdateTargetStateSchema,
  type RecordUpdateCanonicalSelector,
  type RecordUpdateSelectorClause,
  type RecordUpdateTargetState,
} from "./schemas";

type SessionClient = SupabaseClient<Database>;

export const recordUpdateServiceErrorCodes = [
  "record_update_authentication_required",
  "record_update_actor_context_mismatch",
  "record_update_owner_or_admin_required",
  "record_update_business_not_found",
  "record_update_object_not_found",
  "record_update_object_ineligible",
  "record_update_selector_invalid",
  "record_update_selector_not_found",
  "record_update_selector_ambiguous",
  "record_update_configuration_changed",
  "record_update_schema_changed",
  "record_update_selector_changed",
  "record_update_state_changed",
  "record_update_target_changed",
  "record_update_target_archived",
  "record_update_patch_invalid",
  "record_update_no_change",
  "record_update_failed",
  "record_update_response_invalid",
] as const;

export type RecordUpdateServiceErrorCode =
  (typeof recordUpdateServiceErrorCodes)[number];

const messages: Readonly<Record<RecordUpdateServiceErrorCode, string>> = {
  record_update_authentication_required:
    "Authentication is required to update a Record.",
  record_update_actor_context_mismatch:
    "The authenticated Record-update actor did not match the trusted request context.",
  record_update_owner_or_admin_required:
    "Owner or Admin access is required to update this Record.",
  record_update_business_not_found:
    "The Business could not be found for this Record request.",
  record_update_object_not_found: "The configured Object could not be found.",
  record_update_object_ineligible:
    "This Object is not eligible for safe Builder Record updates.",
  record_update_selector_invalid: "The Record selector was invalid.",
  record_update_selector_not_found:
    "No active Record matched those exact current details.",
  record_update_selector_ambiguous:
    "More than one active Record matched those exact details.",
  record_update_configuration_changed:
    "The Business configuration changed while this Record was being prepared.",
  record_update_schema_changed:
    "The Object schema changed while this Record was being prepared.",
  record_update_selector_changed:
    "The Record selector changed while this Record was being prepared.",
  record_update_state_changed:
    "The selected Record changed while this Record was being prepared.",
  record_update_target_changed:
    "The selected Record changed while this Record was being prepared.",
  record_update_target_archived: "The selected Record is no longer active.",
  record_update_patch_invalid: "The Record update values were invalid.",
  record_update_no_change: "This Record already has those values.",
  record_update_failed: "The Record could not be updated safely.",
  record_update_response_invalid:
    "The Record update service returned an invalid result.",
};

export class RecordUpdateServiceError extends Error {
  readonly code: RecordUpdateServiceErrorCode;
  override readonly cause: unknown;

  constructor(code: RecordUpdateServiceErrorCode, cause?: unknown) {
    super(messages[code]);
    this.name = "RecordUpdateServiceError";
    this.code = code;
    this.cause = cause;
  }
}

const serviceContextSchema = z
  .object({ businessId: z.uuid(), actorId: z.uuid() })
  .strict();

const readStateRequestSchema = z
  .object({
    objectKey: graphKeySchema,
    selectorClauses: recordUpdateSelectorClausesSchema,
    updateFieldKeys: z
      .array(graphKeySchema)
      .min(1)
      .max(5)
      .superRefine((keys, context) => {
        if (new Set(keys).size !== keys.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Update Field keys must be unique.",
          });
        }
      }),
  })
  .strict();

const updateConfirmedRequestSchema = z
  .object({
    baseVersionId: z.uuid(),
    headRevision: z.number().int().positive(),
    objectKey: graphKeySchema,
    expectedObjectDefinitionId: z.uuid(),
    objectSchemaDigest: z.string().regex(/^[a-f0-9]{64}$/),
    canonicalSelector: recordUpdateCanonicalSelectorSchema,
    selectorDigest: z.string().regex(/^[a-f0-9]{64}$/),
    expectedRecordId: z.uuid(),
    recordDigest: z.string().regex(/^[a-f0-9]{64}$/),
    dataPatch: jsonObjectSchema,
  })
  .strict();

function codeFromError(
  error: PostgrestError | null,
): RecordUpdateServiceErrorCode {
  const message = error?.message ?? "";
  const matched = message.match(/record_update_[a-z0-9_]+/);
  const candidate = matched?.[0] ?? error?.code;
  return recordUpdateServiceErrorCodes.includes(
    candidate as RecordUpdateServiceErrorCode,
  )
    ? (candidate as RecordUpdateServiceErrorCode)
    : "record_update_failed";
}

const recordResponseSchema = z
  .object({
    id: z.uuid(),
    business_id: z.uuid(),
    object_definition_id: z.uuid(),
    record_status: z.enum(["active", "archived"]),
    data_json: z.unknown(),
    created_by: z.uuid().nullable(),
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
  })
  .strict();

function unwrapState(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.length === 1 ? data[0] : undefined;
  }
  return data;
}

export interface RecordUpdateReadStateInput {
  readonly objectKey: string;
  readonly selectorClauses: readonly RecordUpdateSelectorClause[];
  readonly updateFieldKeys: readonly string[];
}

export interface ConfirmedRecordUpdateInput {
  readonly baseVersionId: string;
  readonly headRevision: number;
  readonly objectKey: string;
  readonly expectedObjectDefinitionId: string;
  readonly objectSchemaDigest: string;
  readonly canonicalSelector: RecordUpdateCanonicalSelector;
  readonly selectorDigest: string;
  readonly expectedRecordId: string;
  readonly recordDigest: string;
  readonly dataPatch: Record<string, unknown>;
}

export interface ConfirmedRecordUpdateService {
  readState(
    input: RecordUpdateReadStateInput,
  ): Promise<RecordUpdateTargetState>;
  updateConfirmed(
    input: ConfirmedRecordUpdateInput,
  ): Promise<Tables<"records">>;
}

export function createConfirmedRecordUpdateService(
  client: SessionClient,
  context: { businessId: string; actorId: string },
): ConfirmedRecordUpdateService {
  const trustedContext = serviceContextSchema.parse(context);

  return {
    async readState(input) {
      const request = readStateRequestSchema.parse(input);
      const { data, error } = await client.rpc(
        "get_confirmed_graph_record_update_state",
        {
          expected_business_id: trustedContext.businessId,
          expected_actor_id: trustedContext.actorId,
          target_object_key: request.objectKey,
          requested_selector: request.selectorClauses,
          requested_update_field_keys: request.updateFieldKeys,
        },
      );
      if (error || data === null || data === undefined) {
        throw new RecordUpdateServiceError(codeFromError(error), error);
      }
      const parsed = recordUpdateTargetStateSchema.safeParse(unwrapState(data));
      if (!parsed.success) {
        throw new RecordUpdateServiceError(
          "record_update_response_invalid",
          parsed.error,
        );
      }
      if (
        (parsed.data.state === "ready" &&
          (parsed.data.business_id !== trustedContext.businessId ||
            parsed.data.actor_id !== trustedContext.actorId ||
            parsed.data.object_key !== request.objectKey)) ||
        (parsed.data.state !== "ready" &&
          parsed.data.object_key !== request.objectKey)
      ) {
        throw new RecordUpdateServiceError("record_update_response_invalid");
      }
      return parsed.data;
    },

    async updateConfirmed(input) {
      const request = updateConfirmedRequestSchema.parse(input);
      if (
        request.canonicalSelector.object_definition_id !==
        request.expectedObjectDefinitionId
      ) {
        throw new RecordUpdateServiceError("record_update_response_invalid");
      }
      const { data, error } = await client.rpc(
        "update_confirmed_graph_record",
        {
          expected_business_id: trustedContext.businessId,
          expected_actor_id: trustedContext.actorId,
          expected_base_version_id: request.baseVersionId,
          expected_head_revision: request.headRevision,
          target_object_key: request.objectKey,
          expected_object_definition_id: request.expectedObjectDefinitionId,
          expected_object_schema_digest: request.objectSchemaDigest,
          requested_selector: request.canonicalSelector,
          expected_selector_digest: request.selectorDigest,
          expected_record_id: request.expectedRecordId,
          expected_record_digest: request.recordDigest,
          requested_data_patch: request.dataPatch,
        },
      );
      if (error || !data) {
        throw new RecordUpdateServiceError(codeFromError(error), error);
      }
      const parsed = recordResponseSchema.safeParse(data);
      if (
        !parsed.success ||
        parsed.data.business_id !== trustedContext.businessId ||
        parsed.data.object_definition_id !==
          request.expectedObjectDefinitionId ||
        parsed.data.id !== request.expectedRecordId
      ) {
        throw new RecordUpdateServiceError(
          "record_update_response_invalid",
          parsed.success ? undefined : parsed.error,
        );
      }
      return parsed.data as Tables<"records">;
    },
  };
}
