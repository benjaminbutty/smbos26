"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createServerClient } from "../db/supabase/server";

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
});

function redirectWithMessage(
  path: string,
  kind: "error" | "message",
  message: string,
): never {
  const params = new URLSearchParams({ [kind]: message });
  redirect(`${path}?${params.toString()}`);
}

async function redirectAfterAuthentication(): Promise<never> {
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
  const credentials = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!credentials.success) {
    redirectWithMessage(
      "/sign-up",
      "error",
      "Enter a valid email and a password of at least 8 characters.",
    );
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.signUp(credentials.data);

  if (error) {
    redirectWithMessage("/sign-up", "error", error.message);
  }

  if (!data.session) {
    redirectWithMessage(
      "/sign-in",
      "message",
      "Check your email to confirm your account, then sign in.",
    );
  }

  return redirectAfterAuthentication();
}

export async function signIn(formData: FormData): Promise<never> {
  const credentials = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!credentials.success) {
    redirectWithMessage(
      "/sign-in",
      "error",
      "Enter a valid email and password.",
    );
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signInWithPassword(credentials.data);

  if (error) {
    redirectWithMessage("/sign-in", "error", "Email or password is incorrect.");
  }

  return redirectAfterAuthentication();
}

export async function signOut(): Promise<never> {
  const supabase = await createServerClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/");
}
