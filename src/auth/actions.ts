"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createServerClient } from "../db/supabase/server";
import { emitAcquisitionEvent } from "../core/acquisition/events";

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
});

function redirectWithMessage(
  path: string,
  kind: "error" | "message",
  message: string,
  returnTo?: string,
): never {
  const params = new URLSearchParams({ [kind]: message });
  if (returnTo) {
    params.set("returnTo", returnTo);
  }
  redirect(`${path}?${params.toString()}`);
}

function safeReturnTo(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return undefined;
  }
  return value;
}

async function redirectAfterAuthentication(returnTo?: string): Promise<never> {
  if (returnTo) {
    redirect(returnTo);
  }

  const supabase = await createServerClient();
  const { data: business } = await supabase
    .from("businesses")
    .select("slug")
    .order("created_at")
    .limit(1)
    .maybeSingle();

  redirect(business ? `/app/${business.slug}` : "/onboarding");
}

export async function signUp(formData: FormData): Promise<never> {
  const returnTo = safeReturnTo(formData.get("returnTo"));
  const credentials = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!credentials.success) {
    redirectWithMessage(
      "/sign-up",
      "error",
      "Enter a valid email and a password of at least 8 characters.",
      returnTo,
    );
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.signUp(credentials.data);

  if (error) {
    redirectWithMessage(
      "/sign-up",
      "error",
      "We could not create your account. Please try again.",
      returnTo,
    );
  }

  if (!data.session) {
    redirectWithMessage(
      "/sign-in",
      "message",
      "Check your email to confirm your account, then sign in.",
      returnTo,
    );
  }

  if (returnTo === "/start/business") {
    emitAcquisitionEvent("signup_completed", { method: "sign_up" });
  }

  return redirectAfterAuthentication(returnTo);
}

export async function signIn(formData: FormData): Promise<never> {
  const returnTo = safeReturnTo(formData.get("returnTo"));
  const credentials = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!credentials.success) {
    redirectWithMessage(
      "/sign-in",
      "error",
      "Enter a valid email and password.",
      returnTo,
    );
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signInWithPassword(credentials.data);

  if (error) {
    redirectWithMessage(
      "/sign-in",
      "error",
      "Email or password is incorrect.",
      returnTo,
    );
  }

  if (returnTo === "/start/business") {
    emitAcquisitionEvent("signup_completed", { method: "sign_in" });
  }

  return redirectAfterAuthentication(returnTo);
}

export async function signOut(): Promise<never> {
  const supabase = await createServerClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/");
}
