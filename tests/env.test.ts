import { describe, expect, it } from "vitest";

import { parseEnvironment } from "../src/env";

describe("environment validation", () => {
  it("accepts the Milestone 0 defaults", () => {
    expect(
      parseEnvironment({
        NODE_ENV: "test",
      }),
    ).toEqual({
      NODE_ENV: "test",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    });
  });

  it("normalizes empty future integration values", () => {
    expect(
      parseEnvironment({
        NODE_ENV: "test",
        NEXT_PUBLIC_SUPABASE_URL: "",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
        AI_PROVIDER: "",
        AI_PROVIDER_API_KEY: "",
      }),
    ).toEqual({
      NODE_ENV: "test",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    });
  });

  it("rejects a partially configured Supabase integration", () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: "test",
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      }),
    ).toThrow(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set together.",
    );
  });

  it("rejects a partially configured AI provider", () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: "test",
        AI_PROVIDER: "future-provider",
      }),
    ).toThrow("AI_PROVIDER and AI_PROVIDER_API_KEY must be set together.");
  });
});
