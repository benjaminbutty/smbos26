import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { AiBusinessContextError } from "../../ai/context/errors";
import {
  projectAiBusinessModelContext,
  type AiBusinessContextBundle,
  type AiBusinessContextCurrentness,
  type AiBusinessContextSource,
} from "../../ai/context/projector";
import type { Database } from "../../db/supabase/database.types";
import { hasCapability } from "../../auth/capabilities";
import { configurationSnapshotV1Schema } from "./definition-source";

type SessionClient = SupabaseClient<Database>;

const requestSchema = z
  .object({
    businessId: z.uuid(),
  })
  .strict();

const businessSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(120),
    business_type: z.string().trim().min(1).max(80),
    timezone: z.string().trim().min(1).max(80),
  })
  .strict();

const membershipSchema = z
  .object({
    business_id: z.uuid(),
    user_id: z.uuid(),
    role: z.enum(["owner", "admin", "staff"]),
  })
  .strict();

const locationSchema = z
  .object({
    id: z.uuid(),
    business_id: z.uuid(),
    name: z.string().trim().min(1).max(120),
    timezone: z.string().trim().min(1).max(80),
    is_active: z.boolean(),
  })
  .strict();

const headSchema = z
  .object({
    business_id: z.uuid(),
    active_version_id: z.uuid(),
    head_revision: z.number().int().positive(),
  })
  .strict();

const versionSchema = z
  .object({
    id: z.uuid(),
    business_id: z.uuid(),
    version_number: z.number().int().positive(),
    snapshot_json: configurationSnapshotV1Schema,
  })
  .strict();

export interface AuthoritativeAiBusinessContext {
  executionContext: {
    businessId: string;
    actorId: string;
  };
  currentness: AiBusinessContextCurrentness;
  source: AiBusinessContextSource;
}

function failed(cause: unknown): AiBusinessContextError {
  return new AiBusinessContextError("ai_context_failed", { cause });
}

export async function loadAuthoritativeAiBusinessContext(
  client: SessionClient,
  input: { businessId: string },
): Promise<AuthoritativeAiBusinessContext> {
  const request = requestSchema.safeParse(input);
  if (!request.success) {
    throw new AiBusinessContextError("ai_context_not_found", {
      cause: request.error,
    });
  }

  try {
    const claimsResult = await client.auth.getClaims();
    const actorId = claimsResult.data?.claims?.sub;
    if (claimsResult.error || typeof actorId !== "string") {
      throw new AiBusinessContextError("ai_context_unauthorized", {
        cause: claimsResult.error,
      });
    }

    const [businessResult, membershipResult] = await Promise.all([
      client
        .from("businesses")
        .select("id,name,business_type,timezone")
        .eq("id", request.data.businessId)
        .maybeSingle(),
      client
        .from("business_memberships")
        .select("business_id,user_id,role")
        .eq("business_id", request.data.businessId)
        .eq("user_id", actorId)
        .maybeSingle(),
    ]);

    if (businessResult.error) {
      throw failed(businessResult.error);
    }
    if (!businessResult.data) {
      throw new AiBusinessContextError("ai_context_not_found");
    }
    if (membershipResult.error) {
      throw failed(membershipResult.error);
    }
    if (!membershipResult.data) {
      throw new AiBusinessContextError("ai_context_unauthorized");
    }

    const business = businessSchema.parse(businessResult.data);
    const membership = membershipSchema.parse(membershipResult.data);
    if (
      business.id !== request.data.businessId ||
      membership.business_id !== business.id ||
      membership.user_id !== actorId
    ) {
      throw new AiBusinessContextError("ai_context_inconsistent");
    }
    if (
      membership.role === "staff" ||
      !hasCapability(membership.role, "manage_configuration")
    ) {
      throw new AiBusinessContextError("ai_context_unauthorized");
    }

    const [locationsResult, headResult] = await Promise.all([
      client
        .from("locations")
        .select("id,business_id,name,timezone,is_active")
        .eq("business_id", business.id),
      client
        .from("business_configuration_heads")
        .select("business_id,active_version_id,head_revision")
        .eq("business_id", business.id)
        .maybeSingle(),
    ]);
    if (locationsResult.error) {
      throw failed(locationsResult.error);
    }
    if (headResult.error) {
      throw failed(headResult.error);
    }
    if (!headResult.data) {
      throw new AiBusinessContextError("ai_context_inconsistent");
    }

    const locations = z.array(locationSchema).parse(locationsResult.data);
    const head = headSchema.parse(headResult.data);
    if (
      head.business_id !== business.id ||
      locations.some((location) => location.business_id !== business.id)
    ) {
      throw new AiBusinessContextError("ai_context_inconsistent");
    }

    const versionResult = await client
      .from("configuration_versions")
      .select("id,business_id,version_number,snapshot_json")
      .eq("business_id", business.id)
      .eq("id", head.active_version_id)
      .maybeSingle();
    if (versionResult.error) {
      throw failed(versionResult.error);
    }
    if (!versionResult.data) {
      throw new AiBusinessContextError("ai_context_inconsistent");
    }
    const version = versionSchema.parse(versionResult.data);
    if (
      version.id !== head.active_version_id ||
      version.business_id !== business.id
    ) {
      throw new AiBusinessContextError("ai_context_inconsistent");
    }

    return Object.freeze({
      executionContext: Object.freeze({
        businessId: business.id,
        actorId,
      }),
      currentness: Object.freeze({
        baseVersionId: version.id,
        headRevision: head.head_revision,
      }),
      source: Object.freeze({
        business: Object.freeze({
          name: business.name,
          businessType: business.business_type,
          timezone: business.timezone,
        }),
        access: Object.freeze({
          role: membership.role,
          capabilities: Object.freeze(["manage_configuration"] as const),
        }),
        activeConfiguration: Object.freeze({
          versionNumber: version.version_number,
          revision: head.head_revision,
          snapshot: version.snapshot_json,
        }),
        locations: Object.freeze(
          locations.map((location) =>
            Object.freeze({
              reference: location.id,
              name: location.name,
              timezone: location.timezone,
              isActive: location.is_active,
            }),
          ),
        ),
      }),
    });
  } catch (cause) {
    if (cause instanceof AiBusinessContextError) {
      throw cause;
    }
    throw failed(cause);
  }
}

export async function buildAiBusinessContext(
  client: SessionClient,
  input: { businessId: string },
): Promise<AiBusinessContextBundle> {
  const authoritative = await loadAuthoritativeAiBusinessContext(client, input);
  const projected = projectAiBusinessModelContext(authoritative.source);
  return Object.freeze({
    currentness: authoritative.currentness,
    modelContext: projected.modelContext,
    serializedBytes: projected.serializedBytes,
  });
}
