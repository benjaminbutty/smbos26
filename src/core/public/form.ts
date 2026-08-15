import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Json } from "../../db/supabase/database.types";
import { callPublicRpc } from "./rpc";

const publicFormResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    idempotent: z.boolean(),
    confirmation: z.object({
      public_reference: z.string().regex(/^PF-[A-F0-9]{8}$/),
    }),
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum(["not_found", "invalid_submission", "rate_limited"]),
  }),
]);

export type PublicFormResult = z.infer<typeof publicFormResultSchema>;

export async function submitPublicCreateForm(
  client: SupabaseClient<Database>,
  input: {
    businessSlug: string;
    pageSlug: string;
    formKey: string;
    idempotencyToken: string;
    data: Record<string, Json>;
    requestHash: string;
  },
): Promise<PublicFormResult> {
  const result = await callPublicRpc<Json>(
    client,
    "submit_public_create_form",
    {
      requested_business_slug: input.businessSlug,
      requested_page_slug: input.pageSlug,
      requested_form_key: input.formKey,
      requested_idempotency_token: z.uuid().parse(input.idempotencyToken),
      requested_data: input.data,
      requested_request_hash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(input.requestHash),
    },
  );
  if (result.error) {
    throw new Error("Could not submit the public Form.", {
      cause: result.error,
    });
  }
  return publicFormResultSchema.parse(result.data);
}
