import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { createGraphService } from "../src/core/graph/service";
import type { Database } from "../src/db/supabase/database.types";

vi.mock("server-only", () => ({}));

describe("GraphService tenant context", () => {
  it("passes its resolved Business ID to every operational RPC", async () => {
    const businessId = crypto.randomUUID();
    const objectDefinitionId = crypto.randomUUID();
    const recordId = crypto.randomUUID();
    const relationshipDefinitionId = crypto.randomUUID();
    const sourceRecordId = crypto.randomUUID();
    const targetRecordId = crypto.randomUUID();
    const recordRelationshipId = crypto.randomUUID();
    const rpc = vi.fn(async (operation: string) => ({
      data: operation === "remove_graph_relationship" ? true : {},
      error: null,
    }));
    const client = { rpc } as unknown as SupabaseClient<Database>;
    const graph = createGraphService(client, { businessId });

    await graph.createRecord({
      objectDefinitionId,
      data: { name: "Tenant-bound" },
    });
    await graph.updateRecord({
      recordId,
      dataPatch: { name: "Still tenant-bound" },
    });
    await graph.archiveRecord(recordId);
    await graph.createRecordRelationship({
      relationshipDefinitionId,
      sourceRecordId,
      targetRecordId,
    });
    await graph.removeRecordRelationship(recordRelationshipId);

    expect(rpc).toHaveBeenNthCalledWith(1, "create_graph_record", {
      expected_business_id: businessId,
      requested_data: { name: "Tenant-bound" },
      requested_record_status: "active",
      target_object_definition_id: objectDefinitionId,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "update_graph_record", {
      data_patch: { name: "Still tenant-bound" },
      expected_business_id: businessId,
      target_record_id: recordId,
    });
    expect(rpc).toHaveBeenNthCalledWith(3, "archive_graph_record", {
      expected_business_id: businessId,
      target_record_id: recordId,
    });
    expect(rpc).toHaveBeenNthCalledWith(4, "create_graph_relationship", {
      expected_business_id: businessId,
      target_relationship_definition_id: relationshipDefinitionId,
      target_source_record_id: sourceRecordId,
      target_target_record_id: targetRecordId,
    });
    expect(rpc).toHaveBeenNthCalledWith(5, "remove_graph_relationship", {
      expected_business_id: businessId,
      target_record_relationship_id: recordRelationshipId,
    });
  });
});
