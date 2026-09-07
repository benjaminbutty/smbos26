import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  tableViewColumnSchema,
  tableViewConnectedFieldColumnKey,
  tableViewConnectionPropertyKey,
  tableViewPropertyKeySchema,
  tableViewQuerySchema,
} from "./schemas";
import type { TableViewColumn, TableViewQuery } from "./schemas";
import type { Database, Json, Tables } from "../../db/supabase/database.types";

const connectionValueSchema = z
  .object({ id: z.uuid(), label: z.string().min(1).max(120) })
  .strict();

const tableQueryRecordSchema = z
  .object({
    record: z.record(z.string(), z.unknown()),
    connections: z
      .record(z.string(), z.array(connectionValueSchema))
      .default({}),
    projections: z.record(z.string(), z.string().nullable()).default({}),
    group_value: z.unknown().nullable().optional(),
  })
  .strict();

const tableQueryResponseSchema = z
  .object({
    view_key: z.string(),
    records: z.array(tableQueryRecordSchema),
    total_count: z.number().int().nonnegative(),
    limit: z.number().int().positive().max(250),
    offset: z.number().int().nonnegative(),
    has_more: z.boolean(),
    group: z.unknown().nullable().optional(),
    groups: z.array(z.unknown()).default([]),
  })
  .strict();

const targetSearchResponseSchema = z
  .object({
    targets: z.array(connectionValueSchema),
    limit: z.number().int().positive().max(50),
    offset: z.number().int().nonnegative(),
  })
  .strict();

function parsedRecord(value: Record<string, unknown>): Tables<"records"> {
  const data = value.data_json;
  if (
    typeof value.id !== "string" ||
    typeof value.business_id !== "string" ||
    typeof value.object_definition_id !== "string" ||
    typeof value.record_status !== "string" ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string" ||
    typeof data !== "object" ||
    data === null ||
    Array.isArray(data)
  ) {
    throw new Error("The Table query returned an invalid Record.");
  }
  return value as Tables<"records">;
}

export interface TableQueryResult {
  records: Tables<"records">[];
  connectionValues: Record<
    string,
    Record<string, readonly { id: string; label: string }[]>
  >;
  projectionValues: Record<string, Record<string, string | null>>;
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  group: Json | null;
  groups: Json[];
}

function parsedTableQueryResult(data: unknown): TableQueryResult {
  const parsed = tableQueryResponseSchema.parse(data);
  const connectionValues: TableQueryResult["connectionValues"] = {};
  const projectionValues: TableQueryResult["projectionValues"] = {};
  const records = parsed.records.map((item) => {
    const record = parsedRecord(item.record);
    connectionValues[record.id] = Object.fromEntries(
      Object.entries(item.connections).map(([key, values]) => [
        tableViewPropertyKeySchema.parse(key),
        values,
      ]),
    );
    projectionValues[record.id] = Object.fromEntries(
      Object.entries(item.projections).map(([key, value]) => [
        z
          .string()
          .regex(
            /^connected_field:[a-z][a-z0-9_]{0,79}:(?:source|target):[a-z][a-z0-9_]{0,79}$/,
          )
          .parse(key),
        value,
      ]),
    );
    return record;
  });
  return {
    records,
    connectionValues,
    projectionValues,
    totalCount: parsed.total_count,
    limit: parsed.limit,
    offset: parsed.offset,
    hasMore: parsed.has_more,
    group: (parsed.group as Json | null | undefined) ?? null,
    groups: parsed.groups as Json[],
  };
}

export function connectionColumnStorageKey(
  relationshipKey: string,
  direction: "source" | "target",
): string {
  return tableViewConnectionPropertyKey(relationshipKey, direction);
}

export function connectedFieldColumnStorageKey(
  relationshipKey: string,
  direction: "source" | "target",
  targetFieldKey: string,
): string {
  return tableViewConnectedFieldColumnKey(
    relationshipKey,
    direction,
    targetFieldKey,
  );
}

export async function queryTableViewRecords(
  client: SupabaseClient<Database>,
  businessId: string,
  viewKey: string,
  input: { limit?: number; offset?: number; search?: string } = {},
): Promise<TableQueryResult> {
  const { data, error } = await client.rpc("query_view_records", {
    expected_business_id: businessId,
    requested_view_key: viewKey,
    requested_limit: input.limit ?? 250,
    requested_offset: input.offset ?? 0,
    requested_search: (input.search ?? "").trim().slice(0, 200),
  });
  if (error || data === null) {
    throw new Error("Could not load the Table records.", { cause: error });
  }
  return parsedTableQueryResult(data);
}

export async function previewTableViewRecords(
  client: SupabaseClient<Database>,
  businessId: string,
  sourceViewKey: string,
  input: {
    query: TableViewQuery;
    columns: readonly TableViewColumn[];
    limit?: number;
    offset?: number;
  },
): Promise<TableQueryResult> {
  const query = tableViewQuerySchema.parse(input.query);
  const columns = z
    .array(tableViewColumnSchema)
    .min(1)
    .max(50)
    .parse(input.columns);
  const { data, error } = await client.rpc("preview_table_view_records", {
    expected_business_id: businessId,
    requested_source_view_key: sourceViewKey,
    requested_query: query as Json,
    requested_columns: columns as Json,
    requested_limit: input.limit ?? 250,
    requested_offset: input.offset ?? 0,
  });
  if (error || data === null) {
    throw new Error("Could not preview the Table records.", { cause: error });
  }
  return parsedTableQueryResult(data);
}

export async function searchTableConnectionTargets(
  client: SupabaseClient<Database>,
  businessId: string,
  input: {
    viewKey: string;
    relationshipKey: string;
    direction: "source" | "target";
    search?: string;
    limit?: number;
    offset?: number;
  },
): Promise<readonly { id: string; label: string }[]> {
  const { data, error } = await client.rpc("search_view_connection_targets", {
    expected_business_id: businessId,
    requested_view_key: input.viewKey,
    requested_relationship_key: input.relationshipKey,
    requested_direction: input.direction,
    requested_search: input.search ?? "",
    requested_limit: input.limit ?? 50,
    requested_offset: input.offset ?? 0,
  });
  if (error || data === null) {
    throw new Error("Could not search connected records.", { cause: error });
  }
  return targetSearchResponseSchema.parse(data).targets;
}

export async function setTableRecordConnectionValues(
  client: SupabaseClient<Database>,
  businessId: string,
  input: {
    viewKey: string;
    recordId: string;
    relationshipKey: string;
    direction: "source" | "target";
    targetRecordIds: readonly string[];
  },
): Promise<void> {
  const { error } = await client.rpc("set_record_connection_values", {
    expected_business_id: businessId,
    requested_view_key: input.viewKey,
    requested_record_id: input.recordId,
    requested_relationship_key: input.relationshipKey,
    requested_direction: input.direction,
    requested_target_record_ids: [...input.targetRecordIds],
  });
  if (error) {
    throw new Error("Could not save the connected records.", { cause: error });
  }
}
