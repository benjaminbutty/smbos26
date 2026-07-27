import { describe, expect, it } from "vitest";

import { parseEnvironment } from "../src/env";

describe("environment validation", () => {
  it("accepts a complete Milestone 1 environment", () => {
    expect(
      parseEnvironment({
        NODE_ENV: "test",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      }),
    ).toEqual({
      NODE_ENV: "test",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    });
  });

  it("normalizes empty future AI integration values", () => {
    expect(
      parseEnvironment({
        NODE_ENV: "test",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
        AI_PROVIDER: "",
        AI_PROVIDER_API_KEY: "",
      }),
    ).toEqual({
      NODE_ENV: "test",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    });
  });

  it("requires Supabase configuration", () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: "test",
      }),
    ).toThrow();
  });

  it("rejects a partially configured AI provider", () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: "test",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
        AI_PROVIDER: "future-provider",
      }),
    ).toThrow("AI_PROVIDER and AI_PROVIDER_API_KEY must be set together.");
  });
});
