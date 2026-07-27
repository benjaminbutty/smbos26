import type { Database } from "../db/supabase/database.types";

export type BusinessRole = Database["public"]["Enums"]["business_role"];
export type Capability =
  | "manage_business"
  | "manage_configuration"
  | "manage_locations"
  | "manage_memberships"
  | "manage_ownership";

const roleCapabilities: Readonly<Record<BusinessRole, readonly Capability[]>> =
  {
    owner: [
      "manage_business",
      "manage_configuration",
      "manage_locations",
      "manage_memberships",
      "manage_ownership",
    ],
    admin: [
      "manage_business",
      "manage_configuration",
      "manage_locations",
      "manage_memberships",
    ],
    staff: [],
  };

export class AuthorizationError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function hasCapability(
  role: BusinessRole,
  capability: Capability,
): boolean {
  return roleCapabilities[role].includes(capability);
}

export function requireCapability(
  role: BusinessRole,
  capability: Capability,
): void {
  if (!hasCapability(role, capability)) {
    throw new AuthorizationError();
  }
}
