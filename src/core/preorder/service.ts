import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type {
  Database,
  Json,
  Tables,
  TablesUpdate,
} from "../../db/supabase/database.types";
import {
  createPreorderExperienceSchema,
  publicPreorderCatalogueSchema,
  publicPreorderConfirmationSchema,
  publicPreorderResultSchema,
  publicPreorderSubmissionSchema,
  updatePreorderExperienceSchema,
  type CreatePreorderExperienceInput,
  type PublicPreorderCatalogue,
  type PublicPreorderConfirmation,
  type PublicPreorderResult,
  type PublicPreorderSubmission,
  type UpdatePreorderExperienceInput,
} from "./schemas";

export class PreorderServiceError extends Error {
  readonly code: string | null;

  constructor(message: string, cause?: PostgrestError | null) {
    super(message, { cause });
    this.name = "PreorderServiceError";
    this.code = cause?.code ?? null;
  }
}

function requireResult<T>(
  data: T | null,
  error: PostgrestError | null,
  message: string,
): T {
  if (error || data === null) {
    throw new PreorderServiceError(message, error);
  }
  return data;
}

export interface PreorderService {
  createExperience(
    input: CreatePreorderExperienceInput,
  ): Promise<Tables<"preorder_experiences">>;
  updateExperience(
    input: UpdatePreorderExperienceInput,
  ): Promise<Tables<"preorder_experiences">>;
  setAllowedLocations(
    preorderExperienceId: string,
    locationIds: string[],
  ): Promise<number>;
}

export function createPreorderService(
  client: SupabaseClient<Database>,
  tenant: { businessId: string },
): PreorderService {
  const businessId = z.uuid().parse(tenant.businessId);

  return {
    async createExperience(input) {
      const value = createPreorderExperienceSchema.parse(input);
      const { data, error } = await client.rpc("create_preorder_experience", {
        expected_business_id: businessId,
        requested_key: value.key,
        requested_product_object_definition_id: value.productObjectDefinitionId,
        requested_customer_object_definition_id:
          value.customerObjectDefinitionId,
        requested_order_object_definition_id: value.orderObjectDefinitionId,
        requested_order_item_object_definition_id:
          value.orderItemObjectDefinitionId,
        requested_customer_places_order_relationship_definition_id:
          value.customerPlacesOrderRelationshipDefinitionId,
        requested_order_contains_item_relationship_definition_id:
          value.orderContainsItemRelationshipDefinitionId,
        requested_product_appears_in_item_relationship_definition_id:
          value.productAppearsInItemRelationshipDefinitionId,
        requested_config: value.config as Json,
        requested_location_ids: value.locationIds,
        requested_is_active: value.isActive,
      });

      return requireResult(
        data,
        error,
        "Could not create preorder configuration.",
      );
    },

    async updateExperience(input) {
      const value = updatePreorderExperienceSchema.parse(input);
      const changes: TablesUpdate<"preorder_experiences"> = {};
      if (value.config !== undefined) {
        changes.config_json = value.config as Json;
      }
      if (value.isActive !== undefined) {
        changes.is_active = value.isActive;
      }

      const { data, error } = await client
        .from("preorder_experiences")
        .update(changes)
        .eq("business_id", businessId)
        .eq("id", value.preorderExperienceId)
        .select("*")
        .maybeSingle();

      return requireResult(
        data,
        error,
        "Could not update preorder configuration.",
      );
    },

    async setAllowedLocations(preorderExperienceId, locationIds) {
      const { data, error } = await client.rpc(
        "set_preorder_experience_locations",
        {
          expected_business_id: businessId,
          target_preorder_experience_id: z.uuid().parse(preorderExperienceId),
          requested_location_ids: z
            .array(z.uuid())
            .min(1)
            .max(50)
            .parse(locationIds),
        },
      );

      return requireResult(data, error, "Could not update preorder Locations.");
    },
  };
}

export async function resolvePublicPreorder(
  client: SupabaseClient<Database>,
  businessSlug: string,
  pageSlug: string,
  preorderKey: string,
): Promise<PublicPreorderCatalogue | null> {
  const { data, error } = await client.rpc("resolve_public_preorder", {
    requested_business_slug: businessSlug,
    requested_page_slug: pageSlug,
    requested_preorder_key: preorderKey,
  });
  if (error) {
    throw new PreorderServiceError("Could not load the preorder page.", error);
  }
  return data === null ? null : publicPreorderCatalogueSchema.parse(data);
}

export async function submitPublicPreorder(
  client: SupabaseClient<Database>,
  businessSlug: string,
  pageSlug: string,
  preorderKey: string,
  input: PublicPreorderSubmission,
  requestHash: string,
): Promise<PublicPreorderResult> {
  const submission = publicPreorderSubmissionSchema.parse(input);
  const { data, error } = await client.rpc("submit_public_preorder", {
    requested_business_slug: businessSlug,
    requested_page_slug: pageSlug,
    requested_preorder_key: preorderKey,
    submission,
    requested_request_hash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(requestHash),
  });
  if (error) {
    throw new PreorderServiceError("Could not submit the preorder.", error);
  }
  return publicPreorderResultSchema.parse(data);
}

export async function claimPreorderConfirmationEmail(
  client: SupabaseClient<Database>,
  businessSlug: string,
  pageSlug: string,
  preorderKey: string,
  idempotencyToken: string,
): Promise<PublicPreorderConfirmation | null> {
  const { data, error } = await client.rpc(
    "claim_preorder_confirmation_email",
    {
      requested_business_slug: businessSlug,
      requested_page_slug: pageSlug,
      requested_preorder_key: preorderKey,
      requested_idempotency_token: z.uuid().parse(idempotencyToken),
    },
  );
  if (error) {
    throw new PreorderServiceError(
      "Could not prepare the confirmation email.",
      error,
    );
  }
  return data === null ? null : publicPreorderConfirmationSchema.parse(data);
}

export async function completePreorderConfirmationEmail(
  client: SupabaseClient<Database>,
  businessSlug: string,
  preorderKey: string,
  idempotencyToken: string,
  result: { succeeded: boolean; error?: string },
): Promise<boolean> {
  const deliveryResult = result.error
    ? {
        delivery_succeeded: result.succeeded,
        delivery_error: result.error,
      }
    : { delivery_succeeded: result.succeeded };
  const { data, error } = await client.rpc(
    "complete_preorder_confirmation_email",
    {
      requested_business_slug: businessSlug,
      requested_preorder_key: preorderKey,
      requested_idempotency_token: z.uuid().parse(idempotencyToken),
      ...deliveryResult,
    },
  );
  if (error) {
    throw new PreorderServiceError(
      "Could not record confirmation email delivery.",
      error,
    );
  }
  return data ?? false;
}
