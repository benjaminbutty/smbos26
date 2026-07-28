import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "../../db/supabase/database.types";
import {
  publicPreorderCatalogueSchema,
  publicPreorderConfirmationSchema,
  publicPreorderResultSchema,
  publicPreorderSubmissionSchema,
  type PublicPreorderCatalogue,
  type PublicPreorderConfirmation,
  type PublicPreorderResult,
  type PublicPreorderSubmission,
} from "./schemas";

export class PreorderServiceError extends Error {
  readonly code: string | null;

  constructor(message: string, cause?: PostgrestError | null) {
    super(message, { cause });
    this.name = "PreorderServiceError";
    this.code = cause?.code ?? null;
  }
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
  preorderKey: string,
  idempotencyToken: string,
): Promise<PublicPreorderConfirmation | null> {
  const { data, error } = await client.rpc(
    "claim_preorder_confirmation_email",
    {
      requested_business_slug: businessSlug,
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
