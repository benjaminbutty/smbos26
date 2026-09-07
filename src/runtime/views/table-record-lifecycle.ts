import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "../../db/supabase/database.types";
import { createExperienceService } from "../../core/experience/service";
import { createGraphService } from "../../core/graph/service";

/** Resolve the live internal Table and record ownership again at the write boundary. */
export async function setTableRecordArchived(
  client: SupabaseClient<Database>,
  businessId: string,
  viewKey: string,
  recordId: string,
  archived: boolean,
) {
  const view = await createExperienceService(client, { businessId }).loadView(
    viewKey,
    "internal",
  );
  if (view.definition.view_type !== "table")
    throw new Error("That Table is unavailable.");
  const { data: record, error } = await client
    .from("records")
    .select("*")
    .eq("business_id", businessId)
    .eq("object_definition_id", view.object.id)
    .eq("id", z.uuid().parse(recordId))
    .single();
  if (error || !record)
    throw new Error("That record is unavailable in this Table.");
  const graph = createGraphService(client, { businessId });
  return archived
    ? graph.archiveRecord(record.id)
    : graph.updateRecord({
        recordId: record.id,
        dataPatch: {},
        recordStatus: "active",
      });
}
