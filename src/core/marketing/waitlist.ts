import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "../../db/supabase/database.types";

const optionalText = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : undefined,
  z.string().max(120).optional(),
);

export const waitlistSignupInputSchema = z.object({
  email: z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
    z.email(),
  ),
  businessType: optionalText,
});

export type WaitlistSignupInput = z.infer<typeof waitlistSignupInputSchema>;

export class WaitlistSignupError extends Error {
  readonly code = "waitlist_signup_failed";

  constructor() {
    super("The waitlist signup could not be saved.");
    this.name = "WaitlistSignupError";
  }
}

export type WaitlistSignupResult = "created" | "already_exists";

export async function saveWaitlistSignup(
  client: SupabaseClient<Database>,
  input: WaitlistSignupInput,
): Promise<WaitlistSignupResult> {
  const { error } = await client.from("marketing_waitlist_signups").insert({
    email: input.email,
    business_type: input.businessType ?? null,
  });

  if (!error) {
    return "created";
  }

  if (error.code === "23505") {
    return "already_exists";
  }

  throw new WaitlistSignupError();
}
