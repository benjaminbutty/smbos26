import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Tables } from "../../../db/supabase/database.types";
import { graphKeySchema, jsonObjectSchema } from "../schemas";
import { recordCreationStateSchema, type RecordCreationState } from "./schemas";

type SessionClient = SupabaseClient<Database>;

export const recordCreationServiceErrorCodes = [
  "record_creation_authentication_required",
  "record_creation_actor_context_mismatch",
  "record_creation_owner_or_admin_required",
  "record_creation_business_not_found",
  "record_creation_object_not_found",
  "record_creation_object_ineligible",
  "record_creation_configuration_changed",
  "record_creation_schema_changed",
  "record_creation_state_changed",
  "record_creation_data_invalid",
  "record_creation_failed",
  "record_creation_response_invalid",
] as const;

export type RecordCreationServiceErrorCode =
  (typeof recordCreationServiceErrorCodes)[number];

const messages: Readonly<Record<RecordCreationServiceErrorCode, string>> = {
  record_creation_authentication_required:
    "Authentication is required to create a Record.",
  record_creation_actor_context_mismatch:
    "The authenticated Record-creation actor did not match the trusted request context.",
  record_creation_owner_or_admin_required:
    "Owner or Admin access is required to create this Record.",
  record_creation_business_not_found:
    "The Business could not be found for this Record request.",
  record_creation_object_not_found: "The configured Object could not be found.",
  record_creation_object_ineligible:
    "This Object is not eligible for standalone Record creation.",
  record_creation_configuration_changed:
    "The Business configuration changed while this Record was being prepared.",
  record_creation_schema_changed:
    "The Object schema changed while this Record was being prepared.",
  record_creation_state_changed:
    "The Object Records changed while this Record was being prepared.",
  record_creation_data_invalid: "The Record data was not valid.",
  record_creation_failed: "The Record could not be created safely.",
  record_creation_response_invalid:
    "The Record service returned an invalid result.",
};

export class RecordCreationServiceError extends Error {
  readonly code: RecordCreationServiceErrorCode;
  override readonly cause: unknown;

  constructor(code: RecordCreationServiceErrorCode, cause?: unknown) {
    super(messages[code]);
    this.name = "RecordCreationServiceError";
    this.code = code;
    this.cause = cause;
  }
}

const serviceContextSchema = z
  .object({ businessId: z.uuid(), actorId: z.uuid() })
  .strict();

const createConfirmedRecordRequestSchema = z
  .object({
    baseVersionId: z.uuid(),
    headRevision: z.number().int().positive(),
    objectKey: graphKeySchema,
    objectSchemaDigest: z.string().regex(/^[a-f0-9]{64}$/),
    recordStateDigest: z.string().regex(/^[a-f0-9]{64}$/),
    requestedData: jsonObjectSchema,
    expectedObjectDefinitionId: z.uuid().optional(),
  })
  .strict();

function codeFromError(
  error: PostgrestError | null,
): RecordCreationServiceErrorCode {
  const message = error?.message ?? "";
  const matched = message.match(/record_creation_[a-z0-9_]+/);
  const candidate = matched?.[0] ?? error?.code;
  return recordCreationServiceErrorCodes.includes(
    candidate as RecordCreationServiceErrorCode,
  )
    ? (candidate as RecordCreationServiceErrorCode)
    : "record_creation_failed";
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

export interface ConfirmedRecordCreationInput {
  baseVersionId: string;
  headRevision: number;
  objectKey: string;
  objectSchemaDigest: string;
  recordStateDigest: string;
  requestedData: Record<string, unknown>;
  expectedObjectDefinitionId?: string;
}

export interface ConfirmedRecordCreationService {
  readState(objectKey: string): Promise<RecordCreationState>;
  createConfirmed(
    input: ConfirmedRecordCreationInput,
  ): Promise<Tables<"records">>;
}

export function createConfirmedRecordCreationService(
  client: SessionClient,
  context: { businessId: string; actorId: string },
): ConfirmedRecordCreationService {
  const trustedContext = serviceContextSchema.parse(context);

  return {
    async readState(objectKey) {
      const targetObjectKey = graphKeySchema.parse(objectKey);
      const { data, error } = await client.rpc(
        "get_confirmed_graph_record_creation_state",
        {
          expected_business_id: trustedContext.businessId,
          expected_actor_id: trustedContext.actorId,
          target_object_key: targetObjectKey,
        },
      );
      if (error || !data) {
        throw new RecordCreationServiceError(codeFromError(error), error);
      }
      const rows = Array.isArray(data) ? data : [];
      if (rows.length !== 1) {
        throw new RecordCreationServiceError(
          "record_creation_response_invalid",
        );
      }
      const state = recordCreationStateSchema.safeParse(rows[0]);
      if (
        !state.success ||
        state.data.business_id !== trustedContext.businessId ||
        state.data.actor_id !== trustedContext.actorId ||
        state.data.object_key !== targetObjectKey
      ) {
        throw new RecordCreationServiceError(
          "record_creation_response_invalid",
          state.success ? undefined : state.error,
        );
      }
      return state.data;
    },

    async createConfirmed(input) {
      const request = createConfirmedRecordRequestSchema.parse(input);
      const { data, error } = await client.rpc(
        "create_confirmed_graph_record",
        {
          expected_business_id: trustedContext.businessId,
          expected_actor_id: trustedContext.actorId,
          expected_base_version_id: request.baseVersionId,
          expected_head_revision: request.headRevision,
          target_object_key: request.objectKey,
          expected_object_schema_digest: request.objectSchemaDigest,
          expected_record_state_digest: request.recordStateDigest,
          requested_data: request.requestedData,
        },
      );
      if (error || !data) {
        throw new RecordCreationServiceError(codeFromError(error), error);
      }
      const parsed = recordResponseSchema.safeParse(data);
      if (
        !parsed.success ||
        parsed.data.business_id !== trustedContext.businessId ||
        (request.expectedObjectDefinitionId !== undefined &&
          parsed.data.object_definition_id !==
            request.expectedObjectDefinitionId)
      ) {
        throw new RecordCreationServiceError(
          "record_creation_response_invalid",
          parsed.success ? undefined : parsed.error,
        );
      }
      return parsed.data as Tables<"records">;
    },
  };
}
