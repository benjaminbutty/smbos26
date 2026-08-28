import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "../src/db/supabase/database.types";

const adminHarness = vi.hoisted(() => ({
  client: undefined as unknown as SupabaseClient<Database>,
}));

vi.mock("server-only", () => ({}));
vi.mock("../src/db/supabase/admin", () => ({
  createAdminClient: () => adminHarness.client,
}));

import { joinEarlyAccess } from "../src/app/actions/marketing";
import { EARLY_ACCESS_INITIAL_STATE } from "../src/components/early-access-form-state";

function formData(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) {
    form.set(key, value);
  }
  return form;
}

function clientWithInsertResult(error: { code?: string } | null) {
  const insert = vi.fn().mockResolvedValue({ error });
  const client = {
    from: vi.fn().mockReturnValue({ insert }),
  } as unknown as SupabaseClient<Database>;
  adminHarness.client = client;
  return insert;
}

describe("early-access waitlist boundary", () => {
  it("exports only the async Server Action at runtime", async () => {
    const actions = await import("../src/app/actions/marketing");

    expect(Object.keys(actions)).toEqual(["joinEarlyAccess"]);
  });

  it("validates on the server and saves normalized input", async () => {
    const insert = clientWithInsertResult(null);

    const result = await joinEarlyAccess(
      EARLY_ACCESS_INITIAL_STATE,
      formData({
        email: "  OWNER@Example.COM ",
        businessType: "  Mobile service  ",
      }),
    );

    expect(result).toEqual({
      status: "success",
      message:
        "You’re on the list. We’ll let you know when early access opens up.",
    });
    expect(insert).toHaveBeenCalledWith({
      email: "owner@example.com",
      business_type: "Mobile service",
    });
  });

  it("treats duplicate email submissions as a safe success", async () => {
    clientWithInsertResult({ code: "23505" });

    await expect(
      joinEarlyAccess(
        EARLY_ACCESS_INITIAL_STATE,
        formData({ email: "owner@example.com" }),
      ),
    ).resolves.toMatchObject({ status: "success" });
  });

  it("returns owner-safe validation and storage errors", async () => {
    const invalid = await joinEarlyAccess(
      EARLY_ACCESS_INITIAL_STATE,
      formData({ email: "not-an-email" }),
    );
    expect(invalid).toEqual({
      status: "error",
      message: "Enter a valid email address to join early access.",
    });

    clientWithInsertResult({ code: "42501" });
    const failed = await joinEarlyAccess(
      EARLY_ACCESS_INITIAL_STATE,
      formData({ email: "owner@example.com" }),
    );
    expect(failed).toEqual({
      status: "error",
      message: "We couldn’t add you right now. Please try again.",
    });
    expect(JSON.stringify(failed)).not.toContain("42501");
  });
});
