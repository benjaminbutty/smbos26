import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Json } from "../../db/supabase/database.types";
import { callPublicRpc } from "./rpc";

const publicSiteFormResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      idempotent: z.boolean(),
      public_reference: z.string().optional(),
      confirmation: z.object({ public_reference: z.string() }).optional(),
    })
    .passthrough(),
  z
    .object({
      ok: z.literal(false),
      code: z.string(),
      message: z.string().optional(),
    })
    .passthrough(),
]);

export type PublicSiteFormResult = z.infer<typeof publicSiteFormResultSchema>;

export async function submitPublicSiteForm(
  client: SupabaseClient<Database>,
  input: {
    businessSlug: string;
    pageSlug: string;
    actionKey: string;
    releaseToken: string;
    idempotencyToken: string;
    submissionAttemptId?: string;
    answers: Record<string, Json>;
    grantIds: string[];
    requestHash: string;
  },
): Promise<PublicSiteFormResult> {
  const result = await callPublicRpc<Json>(
    client,
    "submit_public_site_form_v3",
    {
      requested_business_slug: input.businessSlug,
      requested_page_slug: input.pageSlug,
      requested_action_key: input.actionKey,
      requested_release_token: input.releaseToken,
      requested_idempotency_token: z.uuid().parse(input.idempotencyToken),
      requested_submission_attempt_id: z
        .uuid()
        .parse(input.submissionAttemptId ?? input.idempotencyToken),
      requested_answers: input.answers,
      requested_grant_ids: input.grantIds.map((grantId) =>
        z.uuid().parse(grantId),
      ),
      requested_request_hash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(input.requestHash),
    },
  );
  if (result.error) {
    throw new Error("Could not submit the public Site Form.", {
      cause: result.error,
    });
  }
  return publicSiteFormResultSchema.parse(result.data);
}
