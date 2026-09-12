import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "../../db/supabase/database.types";
import {
  siteDraftCreateSchema,
  siteDraftConflictResolutionSchema,
  siteDraftRebaseSchema,
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

const siteRecordMediaAttachmentSchema = z
  .object({
    business_id: z.uuid(),
    site_id: z.uuid(),
    record_id: z.uuid(),
    object_definition_id: z.uuid(),
    field_definition_id: z.uuid(),
    asset_id: z.uuid(),
    record_revision: z.number().int().positive(),
    attachment_revision: z.number().int().positive(),
    created_by: z.uuid(),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict();

const siteAvailabilitySchema = z
  .object({
    business_id: z.uuid(),
    site_id: z.uuid(),
    status: z.enum(["available", "withdrawn"]),
    availability_revision: z.number().int().positive(),
    available_from_release_revision: z.number().int().nonnegative(),
    changed_by: z.uuid(),
    changed_at: z.string().datetime({ offset: true }),
  })
  .passthrough();

export const siteStateSchema = z
  .object({
    id: z.uuid(),
    business_id: z.uuid(),
    draft_schema_version: z.literal(1),
    draft_json: siteDraftV1Schema,
    draft_revision: z.number().int().positive(),
    draft_base_version_id: z.uuid(),
    draft_base_head_revision: z.number().int().positive(),
    active_release_id: z.uuid().nullable(),
    active_release_revision: z.number().int().nonnegative(),
    last_rebase_resolution: z
      .enum(["unrelated_head", "keep_site_draft"])
      .nullable(),
    last_rebased_by: z.uuid().nullable(),
    last_rebased_at: z.string().datetime({ offset: true }).nullable(),
    migration_state: z.enum(["new", "legacy_pending", "adopted"]),
    legacy_source_checksum: z.string().nullable(),
    legacy_source_page_count: z.number().int().nonnegative().nullable(),
    created_by: z.uuid(),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict();

export const siteReleaseSchema = z
  .object({
    id: z.uuid(),
    business_id: z.uuid(),
    site_id: z.uuid(),
    status: z.enum(["prepared", "published", "invalidated", "expired"]),
    source_draft_revision: z.number().int().positive(),
    source_base_version_id: z.uuid(),
    source_head_revision: z.number().int().positive(),
    expected_active_release_revision: z.number().int().nonnegative(),
    expires_at: z.string().datetime({ offset: true }),
    configuration_change_set_id: z.uuid().nullable(),
    applied_version_id: z.uuid().nullable(),
    projection_schema_version: z.literal(1),
    projection_json: siteReleaseProjectionSchema,
    review_json: siteReleaseReviewSchema,
    projection_checksum: z.string().regex(/^[a-f0-9]{64}$/),
    // C3 adds an opaque token to v3 releases.  It remains nullable for the
    // immutable v1/v2 rows so existing Site releases continue to parse.
    release_token: z
      .string()
      .regex(/^s_[a-f0-9]{64}$/)
      .nullable()
      .optional(),
    prepared_by: z.uuid(),
    prepared_at: z.string().datetime({ offset: true }),
    published_by: z.uuid().nullable(),
    published_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export const siteReleaseV2Schema = siteReleaseSchema.extend({
  projection_schema_version: z.literal(2),
  projection_json: z.unknown(),
  review_json: z.unknown(),
});

export const siteReleaseV3Schema = siteReleaseSchema.extend({
  projection_schema_version: z.literal(3),
  projection_json: z.unknown(),
  review_json: z.unknown(),
  release_token: z.string().regex(/^s_[a-f0-9]{64}$/),
});

export const siteReleaseV4Schema = siteReleaseSchema.extend({
  projection_schema_version: z.literal(4),
  projection_json: z.unknown(),
  review_json: z.unknown(),
  release_token: z.string().regex(/^s_[a-f0-9]{64}$/),
});

type SiteRpcClient = {
  rpc<T>(
    functionName: string,
    parameters: Record<string, string | number | SiteDraftV1 | null | unknown>,
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
  parameters: Record<string, string | number | SiteDraftV1 | null | unknown>,
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
    "create_site_draft_v2",
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
    "save_site_draft_v2",
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

/**
 * Rebase is an explicit, reference-aware acknowledgement of an unrelated
 * configuration change. It never adopts a changed Site-owned Page/Table
 * definition silently.
 */
export async function rebaseSiteDraft(
  client: SupabaseClient<Database>,
  contextInput: unknown,
  input: unknown,
) {
  const context = siteContextSchema.parse(contextInput);
  const request = siteDraftRebaseSchema.parse(input);
  return callSiteRpc(
    client,
    "rebase_site_draft",
    {
      expected_business_id: context.businessId,
      expected_actor_id: context.actorId,
      requested_site_id: request.siteId,
      expected_draft_revision: request.expectedDraftRevision,
      expected_base_version_id: request.expectedBaseVersionId,
      expected_head_revision: request.expectedHeadRevision,
    },
    siteStateSchema,
  );
}

/**
 * Retain the owner’s durable composition after a changed Site-owned binding.
 * Preparation then derives a normal configuration Change; this never writes
 * the changed definition directly from the draft-save path.
 */
export async function resolveSiteDraftConflict(
  client: SupabaseClient<Database>,
  contextInput: unknown,
  input: unknown,
) {
  const context = siteContextSchema.parse(contextInput);
  const request = siteDraftConflictResolutionSchema.parse(input);
  return callSiteRpc(
    client,
    "resolve_site_draft_rebase",
    {
      expected_business_id: context.businessId,
      expected_actor_id: context.actorId,
      requested_site_id: request.siteId,
      expected_draft_revision: request.expectedDraftRevision,
      expected_base_version_id: request.expectedBaseVersionId,
      expected_head_revision: request.expectedHeadRevision,
      expected_target_version_id: request.expectedTargetVersionId,
      expected_target_head_revision: request.expectedTargetHeadRevision,
      requested_resolution: request.resolution,
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

/** C2's public-safe release path. The C1 helpers above remain available to
 * existing integrations that still inspect the private v1 projection. */
export async function prepareSiteReleaseV2(
  client: SupabaseClient<Database>,
  contextInput: unknown,
  input: unknown,
) {
  const context = siteContextSchema.parse(contextInput);
  const request = siteReleasePreparationSchema.parse(input);
  return callSiteRpc(
    client,
    "prepare_site_release_v2",
    {
      expected_business_id: context.businessId,
      expected_actor_id: context.actorId,
      requested_site_id: request.siteId,
      expected_draft_revision: request.expectedDraftRevision,
      expected_base_version_id: request.expectedBaseVersionId,
      expected_head_revision: request.expectedHeadRevision,
    },
    siteReleaseV2Schema,
  );
}

export async function publishSiteReleaseV2(
  client: SupabaseClient<Database>,
  contextInput: unknown,
  input: unknown,
) {
  const context = siteContextSchema.parse(contextInput);
  const request = siteReleasePublishSchema.parse(input);
  return callSiteRpc(
    client,
    "publish_site_release_v2",
    {
      expected_business_id: context.businessId,
      expected_actor_id: context.actorId,
      requested_site_id: request.siteId,
      requested_candidate_id: request.candidateId,
      expected_draft_revision: request.expectedDraftRevision,
      expected_base_version_id: request.expectedBaseVersionId,
      expected_head_revision: request.expectedHeadRevision,
    },
    siteReleaseV2Schema,
  );
}

/** C3 keeps the C2 release path immutable while adding public Form actions. */
export async function prepareSiteReleaseV3(
  client: SupabaseClient<Database>,
  contextInput: unknown,
  input: unknown,
) {
  const context = siteContextSchema.parse(contextInput);
  const request = siteReleasePreparationSchema.parse(input);
  return callSiteRpc(
    client,
    "prepare_site_release_v3",
    {
      expected_business_id: context.businessId,
      expected_actor_id: context.actorId,
      requested_site_id: request.siteId,
      expected_draft_revision: request.expectedDraftRevision,
      expected_base_version_id: request.expectedBaseVersionId,
      expected_head_revision: request.expectedHeadRevision,
    },
    siteReleaseV3Schema,
  );
}

export async function publishSiteReleaseV3(
  client: SupabaseClient<Database>,
  contextInput: unknown,
  input: unknown,
) {
  const context = siteContextSchema.parse(contextInput);
  const request = siteReleasePublishSchema.parse(input);
  return callSiteRpc(
    client,
    "publish_site_release_v3",
    {
      expected_business_id: context.businessId,
      expected_actor_id: context.actorId,
      requested_site_id: request.siteId,
      requested_candidate_id: request.candidateId,
      expected_draft_revision: request.expectedDraftRevision,
      expected_base_version_id: request.expectedBaseVersionId,
      expected_head_revision: request.expectedHeadRevision,
    },
    siteReleaseV3Schema,
  );
}

export async function prepareSiteReleaseV4(
  client: SupabaseClient<Database>,
  contextInput: unknown,
  input: unknown,
) {
  const context = siteContextSchema.parse(contextInput);
  const request = siteReleasePreparationSchema.parse(input);
  return callSiteRpc(
    client,
    "prepare_site_release_v4",
    {
      expected_business_id: context.businessId,
      expected_actor_id: context.actorId,
      requested_site_id: request.siteId,
      expected_draft_revision: request.expectedDraftRevision,
      expected_base_version_id: request.expectedBaseVersionId,
      expected_head_revision: request.expectedHeadRevision,
    },
    siteReleaseV4Schema,
  );
}

export async function publishSiteReleaseV4(
  client: SupabaseClient<Database>,
  contextInput: unknown,
  input: unknown,
) {
  const context = siteContextSchema.parse(contextInput);
  const request = siteReleasePublishSchema.parse(input);
  return callSiteRpc(
    client,
    "publish_site_release_v4",
    {
      expected_business_id: context.businessId,
      expected_actor_id: context.actorId,
      requested_site_id: request.siteId,
      requested_candidate_id: request.candidateId,
      expected_draft_revision: request.expectedDraftRevision,
      expected_base_version_id: request.expectedBaseVersionId,
      expected_head_revision: request.expectedHeadRevision,
    },
    siteReleaseV4Schema,
  );
}

export async function stageSiteAdoption(
  client: SupabaseClient<Database>,
  contextInput: unknown,
  input: unknown,
) {
  const context = siteContextSchema.parse(contextInput);
  const request = siteReleasePreparationSchema.parse(input);
  return callSiteRpc(
    client,
    "stage_site_adoption",
    {
      expected_business_id: context.businessId,
      expected_actor_id: context.actorId,
      requested_site_id: request.siteId,
      expected_draft_revision: request.expectedDraftRevision,
      expected_base_version_id: request.expectedBaseVersionId,
      expected_head_revision: request.expectedHeadRevision,
    },
    siteStateSchema,
  );
}

export async function unpublishSite(
  client: SupabaseClient<Database>,
  contextInput: unknown,
  input: unknown,
) {
  const context = siteContextSchema.parse(contextInput);
  const request = z
    .object({
      siteId: z.uuid(),
      expectedActiveReleaseRevision: z.number().int().nonnegative(),
    })
    .strict()
    .parse(input);
  return callSiteRpc(
    client,
    "unpublish_site",
    {
      expected_business_id: context.businessId,
      expected_actor_id: context.actorId,
      requested_site_id: request.siteId,
      expected_active_release_revision: request.expectedActiveReleaseRevision,
    },
    siteStateSchema,
  );
}

export async function attachSiteRecordMedia(
  client: SupabaseClient<Database>,
  contextInput: unknown,
  input: unknown,
) {
  const context = siteContextSchema.parse(contextInput);
  const request = z
    .object({
      siteId: z.uuid(),
      recordId: z.uuid(),
      objectDefinitionId: z.uuid(),
      fieldDefinitionId: z.uuid(),
      assetId: z.uuid(),
      expectedRecordRevision: z.number().int().positive(),
      expectedAttachmentRevision: z.number().int().nonnegative(),
    })
    .strict()
    .parse(input);
  return callSiteRpc(
    client,
    "attach_site_record_media",
    {
      expected_business_id: context.businessId,
      expected_actor_id: context.actorId,
      requested_site_id: request.siteId,
      requested_record_id: request.recordId,
      requested_object_definition_id: request.objectDefinitionId,
      requested_field_definition_id: request.fieldDefinitionId,
      requested_asset_id: request.assetId,
      expected_record_revision: request.expectedRecordRevision,
      expected_attachment_revision: request.expectedAttachmentRevision,
    },
    siteRecordMediaAttachmentSchema,
  );
}

const siteAvailabilityInputSchema = z
  .object({
    siteId: z.uuid(),
    targetId: z.uuid(),
    expectedActiveReleaseRevision: z.number().int().nonnegative(),
    expectedAvailabilityRevision: z.number().int().nonnegative(),
  })
  .strict();

async function changeSiteAvailability(
  client: SupabaseClient<Database>,
  contextInput: unknown,
  input: unknown,
  functionName: string,
  targetParameter:
    | "requested_record_id"
    | "requested_object_definition_id"
    | "requested_field_definition_id"
    | "requested_asset_id",
) {
  const context = siteContextSchema.parse(contextInput);
  const request = siteAvailabilityInputSchema.parse(input);
  return callSiteRpc(
    client,
    functionName,
    {
      expected_business_id: context.businessId,
      expected_actor_id: context.actorId,
      requested_site_id: request.siteId,
      [targetParameter]: request.targetId,
      expected_active_release_revision: request.expectedActiveReleaseRevision,
      expected_availability_revision: request.expectedAvailabilityRevision,
    },
    siteAvailabilitySchema,
  );
}

export function withdrawSiteRecord(
  client: SupabaseClient<Database>,
  contextInput: unknown,
  input: unknown,
) {
  return changeSiteAvailability(
    client,
    contextInput,
    input,
    "withdraw_site_record",
    "requested_record_id",
  );
}

export function reenableSiteRecord(
  client: SupabaseClient<Database>,
  contextInput: unknown,
  input: unknown,
) {
  return changeSiteAvailability(
    client,
    contextInput,
    input,
    "reenable_site_record",
    "requested_record_id",
  );
}

export function withdrawSiteObject(
  client: SupabaseClient<Database>,
  contextInput: unknown,
  input: unknown,
) {
  return changeSiteAvailability(
    client,
    contextInput,
    input,
    "withdraw_site_object",
    "requested_object_definition_id",
  );
}

export function reenableSiteObject(
  client: SupabaseClient<Database>,
  contextInput: unknown,
  input: unknown,
) {
  return changeSiteAvailability(
    client,
    contextInput,
    input,
    "reenable_site_object",
    "requested_object_definition_id",
  );
}

export function withdrawSiteField(
  client: SupabaseClient<Database>,
  contextInput: unknown,
  input: unknown,
) {
  return changeSiteAvailability(
    client,
    contextInput,
    input,
    "withdraw_site_field",
    "requested_field_definition_id",
  );
}

export function reenableSiteField(
  client: SupabaseClient<Database>,
  contextInput: unknown,
  input: unknown,
) {
  return changeSiteAvailability(
    client,
    contextInput,
    input,
    "reenable_site_field",
    "requested_field_definition_id",
  );
}

export function withdrawSiteMedia(
  client: SupabaseClient<Database>,
  contextInput: unknown,
  input: unknown,
) {
  return changeSiteAvailability(
    client,
    contextInput,
    input,
    "withdraw_site_media",
    "requested_asset_id",
  );
}

export function reenableSiteMedia(
  client: SupabaseClient<Database>,
  contextInput: unknown,
  input: unknown,
) {
  return changeSiteAvailability(
    client,
    contextInput,
    input,
    "reenable_site_media",
    "requested_asset_id",
  );
}
