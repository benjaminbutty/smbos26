import { describe, expect, it } from "vitest";

import { GET } from "../src/app/health/route";

describe("GET /health", () => {
  it("returns an uncached successful health response", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      service: "smbos",
      status: "ok",
    });
  });
});
