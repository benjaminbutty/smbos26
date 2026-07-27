import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";

import type { Database, Tables } from "../db/supabase/database.types";
import { createServerClient } from "../db/supabase/server";
export {
  AuthorizationError,
  hasCapability,
  requireCapability,
} from "./capabilities";

export interface AuthenticatedUser {
  id: string;
  email: string | null;
}

export interface TenantContext {
  business: Tables<"businesses">;
  membership: Tables<"business_memberships">;
  user: AuthenticatedUser;
}

export async function requireAuthenticatedUser(
  client?: SupabaseClient<Database>,
): Promise<AuthenticatedUser> {
  const supabase = client ?? (await createServerClient());
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error || typeof claims?.sub !== "string") {
    redirect("/sign-in");
  }

  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
  };
}

export async function resolveTenant(
  businessSlug: string,
  client?: SupabaseClient<Database>,
): Promise<TenantContext> {
  const supabase = client ?? (await createServerClient());
  const user = await requireAuthenticatedUser(supabase);

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("*")
    .eq("slug", businessSlug)
    .maybeSingle();

  if (businessError || !business) {
    notFound();
  }

  const { data: membership, error: membershipError } = await supabase
    .from("business_memberships")
    .select("*")
    .eq("business_id", business.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError || !membership) {
    notFound();
  }

  return { business, membership, user };
}
