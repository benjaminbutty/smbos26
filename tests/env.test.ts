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

  it("does not expose server-only AI provider values through shared environment", () => {
    expect(
      parseEnvironment({
        NODE_ENV: "test",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
        AI_PROVIDER: "",
        OPENAI_API_KEY: "server-only-marker",
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

  it("requires trusted preorder secrets in production", () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      }),
    ).toThrow("SUPABASE_SERVICE_ROLE_KEY");

    expect(
      parseEnvironment({
        NODE_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        PREORDER_RATE_LIMIT_SECRET: "rate-limit-secret",
      }),
    ).toMatchObject({
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      PREORDER_RATE_LIMIT_SECRET: "rate-limit-secret",
    });
  });
});
