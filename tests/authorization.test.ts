import { describe, expect, it } from "vitest";

import {
  AuthorizationError,
  hasCapability,
  requireCapability,
} from "../src/auth/capabilities";

describe("fixed v0.1 role capabilities", () => {
  it("allows owners to manage ownership and locations", () => {
    expect(hasCapability("owner", "manage_ownership")).toBe(true);
    expect(hasCapability("owner", "manage_locations")).toBe(true);
  });

  it("allows admins to manage locations but not ownership", () => {
    expect(hasCapability("admin", "manage_locations")).toBe(true);
    expect(hasCapability("admin", "manage_ownership")).toBe(false);
  });

  it("rejects staff from the future configuration-management path", () => {
    expect(() => requireCapability("staff", "manage_configuration")).toThrow(
      AuthorizationError,
    );
  });

  it("does not interpret reserved custom permissions", () => {
    expect(hasCapability("staff", "manage_locations")).toBe(false);
  });
});
