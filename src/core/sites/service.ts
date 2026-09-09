import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "../../db/supabase/database.types";
import {
  siteDraftCreateSchema,
  siteDraftSaveSchema,
  siteDraftV1Schema,
  siteReleasePreparationSchema,
  siteReleaseProjectionSchema,
  siteReleasePublishSchema,
  siteReleaseReviewSchema,
  type SiteDraftV1,
} from "./schemas";

const siteContextSchema = z
  .object({ businessId: z.uuid(), actorId: z.uuid() })
  .strict();

const siteStateSchema = z
  .object({
    id: z.uuid(),
    business_id: z.uuid(),
    draft_json: siteDraftV1Schema,
    draft_revision: z.number().int().positive(),
    draft_base_version_id: z.uuid(),
    draft_base_head_revision: z.number().int().positive(),
    active_release_id: z.uuid().nullable(),
    active_release_revision: z.number().int().nonnegative(),
  })
  .passthrough();

const siteReleaseSchema = z
  .object({
    id: z.uuid(),
    business_id: z.uuid(),
    site_id: z.uuid(),
    status: z.enum(["prepared", "published", "invalidated", "expired"]),
    source_draft_revision: z.number().int().positive(),
    source_base_version_id: z.uuid(),
    source_head_revision: z.number().int().positive(),
    expected_active_release_revision: z.number().int().nonnegative(),
    configuration_change_set_id: z.uuid().nullable(),
    applied_version_id: z.uuid().nullable(),
    projection_json: siteReleaseProjectionSchema,
    review_json: siteReleaseReviewSchema,
    projection_checksum: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .passthrough();

type SiteRpcClient = {
  rpc<T>(
    functionName: string,
    parameters: Record<string, string | number | SiteDraftV1>,
  ): Promise<{ data: T | null; error: unknown | null }>;
};

function siteRpc(client: SupabaseClient<Database>): SiteRpcClient {
  // The migration is additive. Keep the temporary type adapter limited to this
  // server-only boundary until the generated database types are refreshed.
  return client as unknown as SiteRpcClient;
}

type RpcFailure = { code?: string; message?: string };

function errorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return "site_request_failed";
  }
  const failure = error as RpcFailure;
  return (
    failure.message?.match(/site_[a-z0-9_]+/)?.[0] ??
    failure.code ??
    "site_request_failed"
  );
}

export class SiteFoundationServiceError extends Error {
  readonly code: string;
  override readonly cause: unknown;

  constructor(error: unknown) {
    super("The Site change could not be saved safely.");
    this.name = "SiteFoundationServiceError";
    this.code = errorCode(error);
    this.cause = error;
  }
}

async function callSiteRpc<T>(
  client: SupabaseClient<Database>,
  functionName: string,
  parameters: Record<string, string | number | SiteDraftV1>,
  schema: z.ZodType<T>,
): Promise<T> {
  const result = await siteRpc(client).rpc<unknown>(functionName, parameters);
  if (result.error || result.data === null) {
    throw new SiteFoundationServiceError(result.error);
  }
  return schema.parse(result.data);
}

export async function createSiteDraft(
  client: SupabaseClient<Database>,
  contextInput: unknown,
  input: unknown,
) {
  const context = siteContextSchema.parse(contextInput);
  const request = siteDraftCreateSchema.parse(input);
  return callSiteRpc(
    client,
    "create_site_draft",
    {
      expected_business_id: context.businessId,
      expected_actor_id: context.actorId,
      requested_draft: request.draft,
    },
    siteStateSchema,
  );
}

export async function saveSiteDraft(
  client: SupabaseClient<Database>,
  contextInput: unknown,
  input: unknown,
) {
  const context = siteContextSchema.parse(contextInput);
  const request = siteDraftSaveSchema.parse(input);
  return callSiteRpc(
    client,
    "save_site_draft",
    {
      expected_business_id: context.businessId,
      expected_actor_id: context.actorId,
      requested_site_id: request.siteId,
      expected_draft_revision: request.expectedDraftRevision,
      requested_draft: request.draft,
    },
    siteStateSchema,
  );
}

export async function prepareSiteRelease(
  client: SupabaseClient<Database>,
  contextInput: unknown,
  input: unknown,
) {
  const context = siteContextSchema.parse(contextInput);
  const request = siteReleasePreparationSchema.parse(input);
  return callSiteRpc(
    client,
    "prepare_site_release",
    {
      expected_business_id: context.businessId,
      expected_actor_id: context.actorId,
      requested_site_id: request.siteId,
      expected_draft_revision: request.expectedDraftRevision,
      expected_base_version_id: request.expectedBaseVersionId,
      expected_head_revision: request.expectedHeadRevision,
    },
    siteReleaseSchema,
  );
}

export async function publishSiteRelease(
  client: SupabaseClient<Database>,
  contextInput: unknown,
  input: unknown,
) {
  const context = siteContextSchema.parse(contextInput);
  const request = siteReleasePublishSchema.parse(input);
  return callSiteRpc(
    client,
    "publish_site_release",
    {
      expected_business_id: context.businessId,
      expected_actor_id: context.actorId,
      requested_site_id: request.siteId,
      requested_candidate_id: request.candidateId,
      expected_draft_revision: request.expectedDraftRevision,
      expected_base_version_id: request.expectedBaseVersionId,
      expected_head_revision: request.expectedHeadRevision,
    },
    siteReleaseSchema,
  );
}
