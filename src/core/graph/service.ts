import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Json, Tables } from "../../db/supabase/database.types";
import {
  createRecordRelationshipSchema,
  createRecordSchema,
  queryRecordsSchema,
  updateRecordSchema,
  type CreateRecordInput,
  type CreateRecordRelationshipInput,
  type QueryRecordsInput,
  type UpdateRecordInput,
} from "./schemas";

export class GraphServiceError extends Error {
  readonly code: string | null;

  constructor(message: string, cause?: PostgrestError | null) {
    super(message, { cause });
    this.name = "GraphServiceError";
    this.code = cause?.code ?? null;
  }
}

function requireResult<T>(
  data: T | null,
  error: PostgrestError | null,
  message: string,
): T {
  if (error || data === null) {
    throw new GraphServiceError(message, error);
  }

  return data;
}

export interface GraphService {
  createRecord(input: CreateRecordInput): Promise<Tables<"records">>;
  updateRecord(input: UpdateRecordInput): Promise<Tables<"records">>;
  archiveRecord(recordId: string): Promise<Tables<"records">>;
  createRecordRelationship(
    input: CreateRecordRelationshipInput,
  ): Promise<Tables<"record_relationships">>;
  removeRecordRelationship(recordRelationshipId: string): Promise<void>;
  queryRecords(input: QueryRecordsInput): Promise<Tables<"records">[]>;
}

export function createGraphService(
  client: SupabaseClient<Database>,
  tenant: { businessId: string },
): GraphService {
  const businessId = z.uuid().parse(tenant.businessId);

  return {
    async createRecord(input) {
      const value = createRecordSchema.parse(input);
      const { data, error } = await client.rpc("create_graph_record", {
        expected_business_id: businessId,
        target_object_definition_id: value.objectDefinitionId,
        requested_data: value.data,
        requested_record_status: value.recordStatus,
      });

      return requireResult(data, error, "Could not create record.");
    },

    async updateRecord(input) {
      const value = updateRecordSchema.parse(input);
      const args: Database["public"]["Functions"]["update_graph_record"]["Args"] =
        {
          expected_business_id: businessId,
          target_record_id: value.recordId,
          data_patch: value.dataPatch,
        };

      if (value.recordStatus !== undefined) {
        args.requested_record_status = value.recordStatus;
      }

      const { data, error } = await client.rpc("update_graph_record", args);
      return requireResult(data, error, "Could not update record.");
    },

    async archiveRecord(recordId) {
      const { data, error } = await client.rpc("archive_graph_record", {
        expected_business_id: businessId,
        target_record_id: z.uuid().parse(recordId),
      });

      return requireResult(data, error, "Could not archive record.");
    },

    async createRecordRelationship(input) {
      const value = createRecordRelationshipSchema.parse(input);
      const { data, error } = await client.rpc("create_graph_relationship", {
        expected_business_id: businessId,
        target_relationship_definition_id: value.relationshipDefinitionId,
        target_source_record_id: value.sourceRecordId,
        target_target_record_id: value.targetRecordId,
      });

      return requireResult(data, error, "Could not connect records.");
    },

    async removeRecordRelationship(recordRelationshipId) {
      const { data, error } = await client.rpc("remove_graph_relationship", {
        expected_business_id: businessId,
        target_record_relationship_id: z.uuid().parse(recordRelationshipId),
      });

      if (error || !data) {
        throw new GraphServiceError(
          "Could not remove record relationship.",
          error,
        );
      }
    },

    async queryRecords(input) {
      const value = queryRecordsSchema.parse(input);
      let query = client
        .from("records")
        .select("*")
        .eq("business_id", businessId)
        .eq("object_definition_id", value.objectDefinitionId)
        .order("created_at");

      if (!value.includeArchived) {
        query = query.eq("record_status", "active");
      }

      const { data, error } = await query;
      return requireResult(data, error, "Could not query records.");
    },
  };
}

export type GraphJson = Json;
