import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Tables } from "../../db/supabase/database.types";

export class RecordLocationLinkError extends Error {
  readonly code: string | null;

  constructor(message: string, cause?: PostgrestError | null) {
    super(message, { cause });
    this.name = "RecordLocationLinkError";
    this.code = cause?.code ?? null;
  }
}

function requireResult<T>(
  data: T | null,
  error: PostgrestError | null,
  message: string,
): T {
  if (error || data === null) {
    throw new RecordLocationLinkError(message, error);
  }
  return data;
}

export interface RecordLocationLinkService {
  create(
    recordId: string,
    locationId: string,
  ): Promise<Tables<"record_location_links">>;
  remove(recordLocationLinkId: string): Promise<void>;
  listForRecord(recordId: string): Promise<Tables<"record_location_links">[]>;
}

export function createRecordLocationLinkService(
  client: SupabaseClient<Database>,
  tenant: { businessId: string },
): RecordLocationLinkService {
  const businessId = z.uuid().parse(tenant.businessId);

  return {
    async create(recordId, locationId) {
      const { data, error } = await client.rpc("create_record_location_link", {
        expected_business_id: businessId,
        target_record_id: z.uuid().parse(recordId),
        target_location_id: z.uuid().parse(locationId),
      });
      return requireResult(data, error, "Could not connect the Location.");
    },

    async remove(recordLocationLinkId) {
      const { data, error } = await client.rpc("remove_record_location_link", {
        expected_business_id: businessId,
        target_record_location_link_id: z.uuid().parse(recordLocationLinkId),
      });
      if (error || !data) {
        throw new RecordLocationLinkError(
          "Could not remove the Location connection.",
          error,
        );
      }
    },

    async listForRecord(recordId) {
      const { data, error } = await client
        .from("record_location_links")
        .select("*")
        .eq("business_id", businessId)
        .eq("record_id", z.uuid().parse(recordId))
        .order("created_at");
      return requireResult(data, error, "Could not load Location connections.");
    },
  };
}
