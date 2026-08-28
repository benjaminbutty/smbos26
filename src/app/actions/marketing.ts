"use server";

import { createAdminClient } from "../../db/supabase/admin";
import {
  saveWaitlistSignup,
  waitlistSignupInputSchema,
} from "../../core/marketing/waitlist";
import type { EarlyAccessFormState } from "../../components/early-access-form-state";

export async function joinEarlyAccess(
  _previousState: EarlyAccessFormState,
  formData: FormData,
): Promise<EarlyAccessFormState> {
  const parsed = waitlistSignupInputSchema.safeParse({
    email: formData.get("email"),
    businessType: formData.get("businessType"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Enter a valid email address to join early access.",
    };
  }

  try {
    await saveWaitlistSignup(createAdminClient(), parsed.data);
  } catch {
    return {
      status: "error",
      message: "We couldn’t add you right now. Please try again.",
    };
  }

  return {
    status: "success",
    message:
      "You’re on the list. We’ll let you know when early access opens up.",
  };
}
